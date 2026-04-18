/**
 * Consolidated Combat Management Tool
 * Replaces 7 separate tools for encounter lifecycle management:
 * create_encounter, get_encounter_state, end_encounter, load_encounter,
 * advance_turn, roll_death_save, execute_lair_action
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';
import { createActionRouter, ActionDefinition, McpResponse } from '../../utils/action-router.js';
import { SessionContext } from '../types.js';
import { RichFormatter } from '../utils/formatter.js';
import {
    handleCreateEncounter,
    handleGetEncounterState,
    handleEndEncounter,
    handleLoadEncounter,
    handleAdvanceTurn,
    handleRollDeathSave,
    handleExecuteLairAction
} from '../handlers/combat-handlers.js';
import { expandCreatureTemplate, listAllTemplates } from '../../data/creature-presets.js';
import { getDb } from '../../storage/index.js';
import { CombatActionLogRepository } from '../../storage/repos/combat-action-log.repo.js';
import { getCombatManager } from '../state/combat-manager.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const ACTIONS = ['create', 'get', 'end', 'load', 'advance', 'death_save', 'lair_action', 'spawn_quick_enemy', 'get_history'] as const;
type CombatManageAction = typeof ACTIONS[number];

// ═══════════════════════════════════════════════════════════════════════════
// ACTION SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

const ParticipantSchema = z.object({
    id: z.string(),
    name: z.string(),
    initiativeBonus: z.number().int(),
    hp: z.number().int().nonnegative(), // Allow 0 HP for dying characters
    maxHp: z.number().int().positive(),
    isEnemy: z.boolean().optional(),
    /**
     * Convenience alias for `isEnemy`. Values "enemy" / "hostile" map to
     * isEnemy=true; "party" / "ally" / "friendly" / "neutral" map to false.
     * If both `side` and `isEnemy` are provided, `isEnemy` wins.
     */
    side: z.enum(['party', 'enemy', 'hostile', 'ally', 'friendly', 'neutral']).optional(),
    conditions: z.array(z.string()).default([]),
    position: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number().optional()
    }).optional(),
    resistances: z.array(z.string()).optional(),
    vulnerabilities: z.array(z.string()).optional(),
    immunities: z.array(z.string()).optional()
});

/**
 * Coerce a participant's `side` into an `isEnemy` boolean.
 * Explicit `isEnemy` wins; otherwise derived from `side`.
 */
function deriveIsEnemy(p: { isEnemy?: boolean; side?: string }): boolean | undefined {
    if (typeof p.isEnemy === 'boolean') return p.isEnemy;
    if (!p.side) return undefined;
    return p.side === 'enemy' || p.side === 'hostile';
}

const TerrainSchema = z.object({
    obstacles: z.array(z.string()).default([]),
    difficultTerrain: z.array(z.string()).optional(),
    water: z.array(z.string()).optional()
}).optional();

const CreateSchema = z.object({
    action: z.literal('create'),
    seed: z.string().describe('Seed for deterministic combat resolution'),
    participants: z.array(ParticipantSchema).min(1),
    terrain: TerrainSchema
});

const GetSchema = z.object({
    action: z.literal('get'),
    encounterId: z.string().describe('The ID of the encounter')
});

const EndSchema = z.object({
    action: z.literal('end'),
    encounterId: z.string().describe('The ID of the encounter')
});

const LoadSchema = z.object({
    action: z.literal('load'),
    encounterId: z.string().describe('The ID of the encounter to load')
});

const AdvanceSchema = z.object({
    action: z.literal('advance'),
    encounterId: z.string().describe('The ID of the encounter')
});

const DeathSaveSchema = z.object({
    action: z.literal('death_save'),
    encounterId: z.string().describe('The ID of the encounter'),
    characterId: z.string().describe('The ID of the character at 0 HP')
});

const LairActionSchema = z.object({
    action: z.literal('lair_action'),
    encounterId: z.string().describe('The ID of the encounter'),
    actionDescription: z.string().describe('Description of the lair action'),
    targetIds: z.array(z.string()).optional(),
    damage: z.number().int().min(0).optional(),
    damageType: z.string().optional(),
    savingThrow: z.object({
        ability: z.enum(['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma']),
        dc: z.number().int().min(1).max(30)
    }).optional(),
    halfDamageOnSave: z.boolean().default(true)
});

const SpawnQuickEnemySchema = z.object({
    action: z.literal('spawn_quick_enemy'),
    creature: z.string().describe('Creature name or template (e.g., "goblin", "orc:warrior")'),
    count: z.number().int().min(1).max(10).default(1).describe('Number of enemies to spawn'),
    position: z.object({ x: z.number(), y: z.number() }).optional().describe('Starting position (defaults to random)'),
    encounterId: z.string().optional().describe('Add to existing encounter (creates new if omitted)'),
    seed: z.string().optional().describe('Seed for deterministic combat (auto-generated if omitted)')
});

const GetHistorySchema = z.object({
    action: z.literal('get_history'),
    encounterId: z.string().describe('The ID of the encounter'),
    round: z.number().int().optional().describe('Get actions from a specific round (omit for all)'),
    limit: z.number().int().min(1).max(100).default(20).describe('Max actions to return (default 20)')
});

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXT HOLDER (for passing session context to handlers)
// ═══════════════════════════════════════════════════════════════════════════

let currentContext: SessionContext | null = null;

// ═══════════════════════════════════════════════════════════════════════════
// ACTION DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

const definitions: Record<CombatManageAction, ActionDefinition> = {
    create: {
        schema: CreateSchema,
        handler: async (params: z.infer<typeof CreateSchema>) => {
            if (!currentContext) throw new Error('No session context');
            // Map convenience `side` field down to canonical `isEnemy` and drop `side`
            // before forwarding to handleCreateEncounter (which doesn't accept it).
            const normalizedParticipants = params.participants.map((p) => {
                const { side: _side, ...rest } = p;
                const derived = deriveIsEnemy(p);
                return derived === undefined ? rest : { ...rest, isEnemy: derived };
            });
            const originalParams = {
                seed: params.seed,
                participants: normalizedParticipants,
                terrain: params.terrain
            };
            const result = await handleCreateEncounter(originalParams, currentContext);
            return extractResultData(result, 'create');
        },
        aliases: ['start', 'new', 'begin', 'init']
    },

    get: {
        schema: GetSchema,
        handler: async (params: z.infer<typeof GetSchema>) => {
            if (!currentContext) throw new Error('No session context');
            const result = await handleGetEncounterState({ encounterId: params.encounterId }, currentContext);
            return extractResultData(result, 'get');
        },
        aliases: ['state', 'status', 'show']
    },

    end: {
        schema: EndSchema,
        handler: async (params: z.infer<typeof EndSchema>) => {
            if (!currentContext) throw new Error('No session context');
            const result = await handleEndEncounter({ encounterId: params.encounterId }, currentContext);
            return extractResultData(result, 'end');
        },
        aliases: ['finish', 'complete', 'stop', 'close']
    },

    load: {
        schema: LoadSchema,
        handler: async (params: z.infer<typeof LoadSchema>) => {
            if (!currentContext) throw new Error('No session context');
            const result = await handleLoadEncounter({ encounterId: params.encounterId }, currentContext);
            return extractResultData(result, 'load');
        },
        aliases: ['restore', 'resume', 'continue']
    },

    advance: {
        schema: AdvanceSchema,
        handler: async (params: z.infer<typeof AdvanceSchema>) => {
            if (!currentContext) throw new Error('No session context');
            const result = await handleAdvanceTurn({ encounterId: params.encounterId }, currentContext);
            return extractResultData(result, 'advance');
        },
        aliases: ['next', 'next_turn', 'advance_turn']
    },

    death_save: {
        schema: DeathSaveSchema,
        handler: async (params: z.infer<typeof DeathSaveSchema>) => {
            if (!currentContext) throw new Error('No session context');
            const result = await handleRollDeathSave({
                encounterId: params.encounterId,
                characterId: params.characterId
            }, currentContext);
            return extractResultData(result, 'death_save');
        },
        aliases: ['death_saving_throw', 'save_death', 'dying']
    },

    lair_action: {
        schema: LairActionSchema,
        handler: async (params: z.infer<typeof LairActionSchema>) => {
            if (!currentContext) throw new Error('No session context');
            const { action, ...lairParams } = params;
            const result = await handleExecuteLairAction(lairParams, currentContext);
            return extractResultData(result, 'lair_action');
        },
        aliases: ['lair', 'legendary', 'boss_action']
    },

    spawn_quick_enemy: {
        schema: SpawnQuickEnemySchema,
        handler: async (params: z.infer<typeof SpawnQuickEnemySchema>) => {
            if (!currentContext) throw new Error('No session context');

            // Expand creature template
            const preset = expandCreatureTemplate(params.creature);
            if (!preset) {
                const available = listAllTemplates();
                return {
                    error: true,
                    actionType: 'spawn_quick_enemy',
                    message: `Unknown creature: "${params.creature}"`,
                    availableCreatures: available.slice(0, 20),
                    hint: `Try one of: ${available.slice(0, 5).join(', ')}...`
                };
            }

            // Build participants from preset
            const count = params.count || 1;
            const participants = [];

            for (let i = 0; i < count; i++) {
                const id = `enemy-${randomUUID().slice(0, 8)}`;
                const basePos = params.position || { x: 10, y: 10 };
                const pos = count > 1
                    ? { x: basePos.x + (i % 3) * 2, y: basePos.y + Math.floor(i / 3) * 2 }
                    : basePos;

                participants.push({
                    id,
                    name: count > 1 ? `${preset.name} ${i + 1}` : preset.name,
                    initiativeBonus: Math.floor((preset.stats.dex - 10) / 2),
                    hp: preset.hp,
                    maxHp: preset.maxHp,
                    ac: preset.ac,
                    attackDamage: preset.defaultAttack?.damage,
                    attackBonus: preset.defaultAttack?.toHit,
                    isEnemy: true,
                    conditions: [],
                    position: pos,
                    resistances: preset.resistances || [],
                    vulnerabilities: preset.vulnerabilities || [],
                    immunities: preset.immunities || []
                });
            }

            // If encounterId is supplied and refers to an active encounter, append
            // the new enemies to it instead of creating a fresh encounter.
            if (params.encounterId) {
                const engine = getCombatManager().get(`${currentContext.sessionId}:${params.encounterId}`);
                if (engine) {
                    const state = engine.addParticipants(participants as unknown as Parameters<typeof engine.addParticipants>[0]);
                    return {
                        success: true,
                        actionType: 'spawn_quick_enemy',
                        encounterId: params.encounterId,
                        creature: params.creature,
                        spawnedCount: count,
                        appendedToExisting: true,
                        enemies: participants.map(p => ({
                            id: p.id,
                            name: p.name,
                            hp: p.hp,
                            maxHp: p.maxHp,
                            ac: preset.ac,
                            position: p.position,
                            attack: preset.defaultAttack
                        })),
                        turnOrder: state.turnOrder,
                        currentTurn: state.participants[state.currentTurnIndex]?.id,
                        readyForCombat: true,
                        hint: `Added ${count} ${preset.name}(s) to existing encounter. Initiative re-sorted.`
                    };
                }
                // encounterId given but engine not found — fall through to new-encounter path
                // with a message noting the fallback.
            }

            // Create encounter with these participants
            const seed = params.seed || `quick-${Date.now()}`;
            const createParams = {
                seed,
                participants,
                terrain: { obstacles: [], difficultTerrain: [], water: [] }
            };

            const result = await handleCreateEncounter(createParams, currentContext);
            const resultData = extractResultData(result, 'spawn_quick_enemy');

            // Enhance with spawn info
            return {
                ...resultData,
                actionType: 'spawn_quick_enemy',
                creature: params.creature,
                spawnedCount: count,
                enemies: participants.map(p => ({
                    id: p.id,
                    name: p.name,
                    hp: p.hp,
                    maxHp: p.maxHp,
                    ac: preset.ac,
                    position: p.position,
                    attack: preset.defaultAttack
                })),
                creatureStats: {
                    name: preset.name,
                    hp: preset.hp,
                    ac: preset.ac,
                    cr: preset.cr,
                    traits: preset.traits
                },
                readyForCombat: true,
                hint: 'Use combat_action to attack, combat_map to render grid'
            };
        },
        aliases: ['quick', 'spawn', 'summon', 'add_enemy']
    },

    get_history: {
        schema: GetHistorySchema,
        handler: async (params: z.infer<typeof GetHistorySchema>) => {
            const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
            const actionLogRepo = new CombatActionLogRepository(db);

            let actions;
            if (params.round !== undefined) {
                actions = actionLogRepo.getByRound(params.encounterId, params.round);
            } else {
                actions = actionLogRepo.getRecent(params.encounterId, params.limit);
            }

            if (actions.length === 0) {
                return {
                    success: true,
                    actionType: 'get_history',
                    encounterId: params.encounterId,
                    actions: [],
                    summary: 'No combat actions recorded for this encounter.',
                    hint: 'Actions are logged automatically when using combat_action.'
                };
            }

            // Build summary for context reconstruction
            const summary = actionLogRepo.getSummary(params.encounterId);

            return {
                success: true,
                actionType: 'get_history',
                encounterId: params.encounterId,
                totalActions: actions.length,
                actions: actions.map(a => ({
                    round: a.round,
                    actor: a.actorName,
                    action: a.actionType,
                    summary: a.resultSummary,
                    damage: a.damageDealt,
                    healing: a.healingDone,
                    timestamp: a.timestamp
                })),
                summary,
                hint: 'Use this to reconstruct combat state after context compaction.'
            };
        },
        aliases: ['history', 'log', 'replay', 'actions']
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function extractResultData(result: McpResponse, actionType: string): Record<string, unknown> {
    const text = result.content[0].text;

    // Try to extract STATE_JSON
    const stateMatch = text.match(/<!-- STATE_JSON\n([\s\S]*?)\nSTATE_JSON -->/);
    if (stateMatch) {
        try {
            const stateData = JSON.parse(stateMatch[1]);
            return {
                success: true,
                actionType,
                ...stateData,
                rawText: text.replace(/<!-- STATE_JSON[\s\S]*?STATE_JSON -->/, '').trim()
            };
        } catch {
            // Fall through to text parsing
        }
    }

    // Return as raw text
    return {
        success: true,
        actionType,
        message: text
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// ROUTER & TOOL DEFINITION
// ═══════════════════════════════════════════════════════════════════════════

const router = createActionRouter({
    actions: ACTIONS,
    definitions,
    threshold: 0.6
});

export const CombatManageTool = {
    name: 'combat_manage',
    description: `Unified combat encounter management. Actions: ${ACTIONS.join(', ')}.
Aliases: start/begin→create, state/status→get, finish/stop→end, restore/resume→load, next→advance, quick/spawn→spawn_quick_enemy.

⚔️ QUICK START:
- spawn_quick_enemy: Instantly create combat with preset creatures (goblin, orc, skeleton, etc.)
  Example: { action: "spawn_quick_enemy", creature: "goblin", count: 3 }

⚔️ FULL WORKFLOW:
1. create - Start encounter with custom participants and terrain
2. get - View current state
3. advance - Move to next turn
4. death_save - Roll death save for downed character
5. lair_action - Execute boss lair action
6. end - Finish combat

For combat ACTIONS (attack, move, cast), use combat_action tool instead.
For MAP operations (render, aoe, terrain), use combat_map tool instead.
For CORPSES after combat, use corpse_manage tool.`,
    inputSchema: z.object({
        action: z.string().describe(`Action: ${ACTIONS.join(', ')}`),
        encounterId: z.string().optional().describe('Encounter ID (required for most actions)'),
        seed: z.string().optional().describe('Seed for new encounter (create only)'),
        participants: z.array(z.any()).optional().describe('Array of participants (create only)'),
        terrain: z.any().optional().describe('Terrain configuration (create only)'),
        characterId: z.string().optional().describe('Character ID (death_save only)'),
        actionDescription: z.string().optional().describe('Lair action description'),
        targetIds: z.array(z.string()).optional().describe('Target IDs for lair action'),
        damage: z.number().optional().describe('Lair action damage'),
        damageType: z.string().optional().describe('Damage type'),
        savingThrow: z.any().optional().describe('Saving throw for lair action'),
        halfDamageOnSave: z.boolean().optional().describe('Half damage on save'),
        // spawn_quick_enemy fields
        creature: z.string().optional().describe('Creature template (e.g., "goblin", "orc:warrior")'),
        count: z.number().optional().describe('Number of enemies to spawn (1-10)'),
        position: z.object({ x: z.number(), y: z.number() }).optional().describe('Starting position')
    })
};

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════════════════════════

export async function handleCombatManage(args: unknown, ctx: SessionContext): Promise<McpResponse> {
    // Store context for handlers
    currentContext = ctx;

    try {
        const result = await router(args as Record<string, unknown>);
        const parsed = JSON.parse(result.content[0].text);

        let output = '';

        if (parsed.error) {
            output = RichFormatter.header('Error', '❌');
            output += RichFormatter.alert(parsed.message || 'Unknown error', 'error');
            if (parsed.suggestions) {
                output += '\n**Did you mean:**\n';
                parsed.suggestions.forEach((s: { action: string; similarity: number }) => {
                    output += `  • ${s.action} (${s.similarity}% match)\n`;
                });
            }
        } else {
            // Format based on action type
            switch (parsed.actionType) {
                case 'create':
                    output = RichFormatter.header('Combat Started', '⚔️');
                    if (parsed.encounterId) {
                        output += RichFormatter.keyValue({ 'Encounter ID': `\`${parsed.encounterId}\`` });
                    }
                    break;
                case 'spawn_quick_enemy':
                    output = RichFormatter.header('Quick Combat Ready', '👹');
                    if (parsed.encounterId) {
                        output += RichFormatter.keyValue({
                            'Encounter ID': `\`${parsed.encounterId}\``,
                            'Creature': parsed.creature,
                            'Count': parsed.spawnedCount
                        });
                    }
                    if (parsed.creatureStats) {
                        output += '\n**Creature Stats:**\n';
                        output += RichFormatter.keyValue({
                            'HP': parsed.creatureStats.hp,
                            'AC': parsed.creatureStats.ac,
                            'CR': parsed.creatureStats.cr || 'N/A'
                        });
                        if (parsed.creatureStats.traits?.length > 0) {
                            output += '\n**Traits:** ' + parsed.creatureStats.traits.join(', ') + '\n';
                        }
                    }
                    if (parsed.enemies?.length > 0) {
                        output += '\n**Enemies Spawned:**\n';
                        const rows = parsed.enemies.map((e: { name: string; hp: number; position: { x: number; y: number }; attack?: { name: string; damage: string } }) =>
                            [e.name, `${e.hp} HP`, `(${e.position.x}, ${e.position.y})`, e.attack?.damage || '-']
                        );
                        output += RichFormatter.table(['Name', 'HP', 'Position', 'Attack'], rows);
                    }
                    output += '\n' + RichFormatter.alert('Combat ready! Use combat_action to attack.', 'success');
                    break;
                case 'get':
                    output = RichFormatter.header('Encounter State', '📋');
                    break;
                case 'end':
                    output = RichFormatter.header('Combat Ended', '🏁');
                    break;
                case 'load':
                    output = RichFormatter.header('Encounter Loaded', '📂');
                    break;
                case 'advance':
                    output = RichFormatter.header('Turn Advanced', '⏭️');
                    break;
                case 'death_save':
                    output = RichFormatter.header('Death Save', '💀');
                    break;
                case 'lair_action':
                    output = RichFormatter.header('Lair Action', '🏰');
                    break;
                default:
                    output = RichFormatter.header('Combat', '⚔️');
            }

            // Add raw text if present
            if (parsed.rawText) {
                output += '\n' + parsed.rawText + '\n';
            } else if (parsed.message) {
                output += '\n' + parsed.message + '\n';
            }

            // Add state info if present
            if (parsed.round !== undefined) {
                output += RichFormatter.keyValue({
                    'Round': parsed.round,
                    'Active': parsed.activeParticipant || 'N/A'
                });
            }
        }

        output += RichFormatter.embedJson(parsed, 'COMBAT_MANAGE');

        return {
            content: [{
                type: 'text' as const,
                text: output
            }]
        };
    } finally {
        currentContext = null;
    }
}
