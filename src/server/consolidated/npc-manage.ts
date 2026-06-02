/**
 * Consolidated NPC Management Tool
 * Replaces 7 separate tools for NPC relationship and memory tracking:
 * get_npc_relationship, update_npc_relationship, record_conversation_memory,
 * get_conversation_history, get_recent_interactions, get_npc_context, interact_socially
 */

import { z } from 'zod';
import { createActionRouter, ActionDefinition, McpResponse } from '../../utils/action-router.js';
import { SessionContext } from '../types.js';
import { RichFormatter } from '../utils/formatter.js';
import { getDb } from '../../storage/index.js';
import { NpcMemoryRepository, Familiarity, Disposition, Importance } from '../../storage/repos/npc-memory.repo.js';
import { CharacterRepository } from '../../storage/repos/character.repo.js';
import { SpatialRepository } from '../../storage/repos/spatial.repo.js';
import { AgentRepository } from '../../storage/repos/agent.repo.js';
import { ConcentrationRepository } from '../../storage/repos/concentration.repo.js';
import { InventoryRepository } from '../../storage/repos/inventory.repo.js';
import { calculateHearingRadius, VolumeLevel } from '../../engine/social/hearing.js';
import { rollStealthVsPerception, isDeafened, getEnvironmentModifier } from '../../engine/social/stealth-perception.js';
import { handleCreate as handleCharacterCreate } from './character-manage.js';
import {
    handleCreate as handleAgentCreate,
    handleSetSlice as handleAgentSetSlice,
    handleAddSecret as handleAgentAddSecret
} from './agent-manage.js';
import { buildCharacterStateSlice } from '../../agent/prompt/slices/character_state.js';
import { CharacterOriginSchema } from '../../schema/character.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const ACTIONS = [
    'create',
    'get_full_context',
    'get_relationship',
    'update_relationship',
    'record_memory',
    'get_history',
    'get_recent',
    'get_context',
    'interact'
] as const;
type NpcManageAction = typeof ACTIONS[number];

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE HELPER
// ═══════════════════════════════════════════════════════════════════════════

function getRepo(): NpcMemoryRepository {
    const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
    return new NpcMemoryRepository(db);
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

// ----- Composite create (sheet + optional agent + optional seeds) -----

const StatsSchema = z.object({
    str: z.number().int().min(0).default(10),
    dex: z.number().int().min(0).default(10),
    con: z.number().int().min(0).default(10),
    int: z.number().int().min(0).default(10),
    wis: z.number().int().min(0).default(10),
    cha: z.number().int().min(0).default(10)
});

const NewCreateSchema = z.object({
    action: z.literal('create'),
    name: z.string().min(1).describe('NPC name (required)'),
    class: z.string().optional().default('Commoner'),
    race: z.string().optional().default('Human'),
    background: z.string().optional().default('Folk Hero'),
    alignment: z.string().optional(),
    stats: StatsSchema.optional().default({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }),
    hp: z.number().int().min(1).optional(),
    maxHp: z.number().int().min(1).optional(),
    ac: z.number().int().min(0).optional().default(10),
    level: z.number().int().min(1).optional().default(1),
    characterType: z.enum(['pc', 'npc', 'enemy', 'neutral']).optional().default('npc'),
    factionId: z.string().optional(),
    behavior: z.string().optional(),
    knownSpells: z.array(z.string()).optional().default([]),
    preparedSpells: z.array(z.string()).optional().default([]),
    resistances: z.array(z.string()).optional().default([]),
    vulnerabilities: z.array(z.string()).optional().default([]),
    immunities: z.array(z.string()).optional().default([]),
    origin: CharacterOriginSchema.optional(),
    provisionEquipment: z.boolean().optional().default(false),
    customEquipment: z.array(z.string()).optional(),
    startingGold: z.number().int().min(0).optional(),

    seedRelationship: z.object({
        withCharacterId: z.string(),
        familiarity: z.enum(['stranger', 'acquaintance', 'friend', 'close_friend', 'rival', 'enemy']),
        disposition: z.enum(['hostile', 'unfriendly', 'neutral', 'friendly', 'helpful']),
        notes: z.string().optional()
    }).optional(),

    seedMemory: z.object({
        forCharacterId: z.string(),
        summary: z.string().min(1),
        importance: z.enum(['low', 'medium', 'high', 'critical']).optional().default('medium'),
        topics: z.array(z.string()).optional().default([])
    }).optional(),

    agent: z.object({
        provider: z.enum(['openai', 'openrouter']),
        model: z.string().min(1),
        persona: z.string().optional(),
        directive: z.string().optional(),
        secrets: z.array(z.object({
            content: z.string().min(1),
            importance: z.enum(['minor', 'major', 'critical']).optional()
        })).optional(),
        autoOnTurn: z.boolean().optional().default(false),
        temperature: z.number().min(0).max(2).optional(),
        maxTokens: z.number().int().positive().optional(),
        budgetTokens: z.number().int().positive().optional(),
        timeoutMs: z.number().int().positive().optional()
    }).optional()
});

// ----- Full context bundle -----

const GetFullContextSchema = z.object({
    action: z.literal('get_full_context'),
    characterId: z.string(),
    includeSheet: z.boolean().optional().default(true),
    includePersona: z.boolean().optional().default(true),
    includeRelationships: z.boolean().optional().default(true),
    includeMemories: z.boolean().optional().default(true),
    includeRecentHistory: z.boolean().optional().default(true),
    includeLocation: z.boolean().optional().default(true),
    includeEncounter: z.boolean().optional().default(true),
    includeFaction: z.boolean().optional().default(true),
    includeInventory: z.boolean().optional().default(true),
    includePromptBlob: z.boolean().optional().default(true),
    memoryLimit: z.number().int().positive().optional().default(20),
    historyLimit: z.number().int().positive().optional().default(10),
    relationshipLimit: z.number().int().positive().optional().default(50)
});

const GetRelationshipSchema = z.object({
    action: z.literal('get_relationship'),
    characterId: z.string().describe('ID of the player character'),
    npcId: z.string().describe('ID of the NPC')
});

const UpdateRelationshipSchema = z.object({
    action: z.literal('update_relationship'),
    characterId: z.string().describe('ID of the player character'),
    npcId: z.string().describe('ID of the NPC'),
    familiarity: z.enum(['stranger', 'acquaintance', 'friend', 'close_friend', 'rival', 'enemy'])
        .describe('Level of familiarity'),
    disposition: z.enum(['hostile', 'unfriendly', 'neutral', 'friendly', 'helpful'])
        .describe('NPC attitude toward the character'),
    notes: z.string().optional().describe('Additional notes about the relationship')
});

const RecordMemorySchema = z.object({
    action: z.literal('record_memory'),
    characterId: z.string().describe('ID of the player character'),
    npcId: z.string().describe('ID of the NPC'),
    summary: z.string().describe('Summary of the conversation/interaction'),
    importance: z.enum(['low', 'medium', 'high', 'critical']).default('medium')
        .describe('How important this memory is'),
    topics: z.array(z.string()).default([])
        .describe('Keywords/topics for searching')
});

const GetHistorySchema = z.object({
    action: z.literal('get_history'),
    characterId: z.string().describe('ID of the player character'),
    npcId: z.string().describe('ID of the NPC'),
    minImportance: z.enum(['low', 'medium', 'high', 'critical']).optional()
        .describe('Minimum importance to include'),
    limit: z.number().int().positive().optional()
        .describe('Maximum number of memories to return')
});

const GetRecentSchema = z.object({
    action: z.literal('get_recent'),
    characterId: z.string().describe('ID of the player character'),
    limit: z.number().int().positive().default(10)
        .describe('Maximum number of memories to return')
});

const GetContextSchema = z.object({
    action: z.literal('get_context'),
    characterId: z.string().describe('ID of the player character'),
    npcId: z.string().describe('ID of the NPC'),
    memoryLimit: z.number().int().positive().default(5)
        .describe('Maximum number of memories to include')
});

const InteractSchema = z.object({
    action: z.literal('interact'),
    speakerId: z.string().describe('ID of the character speaking'),
    targetId: z.string().optional().describe('ID of the intended recipient'),
    content: z.string().min(1).describe('What is being said'),
    volume: z.enum(['WHISPER', 'TALK', 'SHOUT']).describe('Volume level of speech'),
    intent: z.string().optional().describe('Social intent: gossip, interrogate, negotiate, threaten, etc.')
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTION HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

// ----- Composite NPC create -----
//
// The character row is the single hard-commit point. Agent binding, relationship
// and memory seeding are all best-effort: any failure becomes a warning, never
// invalidates the character.

async function handleCreateNpc(args: z.infer<typeof NewCreateSchema>): Promise<object> {
    const warnings: string[] = [];

    // STEP 1: Delegate to character_manage.handleCreate. If this throws, fail
    // fast — there's nothing yet to clean up.
    const charArgs = {
        action: 'create' as const,
        name: args.name,
        class: args.class,
        race: args.race,
        background: args.background,
        alignment: args.alignment,
        stats: args.stats,
        hp: args.hp,
        maxHp: args.maxHp,
        ac: args.ac,
        level: args.level,
        characterType: args.characterType,
        factionId: args.factionId,
        behavior: args.behavior,
        knownSpells: args.knownSpells,
        preparedSpells: args.preparedSpells,
        resistances: args.resistances,
        vulnerabilities: args.vulnerabilities,
        immunities: args.immunities,
        origin: args.origin,
        provisionEquipment: args.provisionEquipment,
        customEquipment: args.customEquipment,
        startingGold: args.startingGold
    };

    const charResult = await handleCharacterCreate(charArgs as any) as any;
    if (charResult?.error) {
        return { error: true, message: charResult.message || 'Character creation failed' };
    }

    const characterId = charResult.id as string;
    const characterSummary = {
        id: charResult.id,
        name: charResult.name,
        characterClass: charResult.characterClass,
        race: charResult.race,
        level: charResult.level,
        hp: charResult.hp,
        maxHp: charResult.maxHp,
        ac: charResult.ac,
        stats: charResult.stats,
        characterType: charResult.characterType,
        background: charResult.background,
        alignment: charResult.alignment,
        origin: charResult.origin
    };

    const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
    const memoryRepo = new NpcMemoryRepository(db);

    // STEP 5: Seed initial relationship (best-effort)
    let relationshipSeeded = false;
    if (args.seedRelationship) {
        try {
            memoryRepo.upsertRelationship({
                characterId: args.seedRelationship.withCharacterId,
                npcId: characterId,
                familiarity: args.seedRelationship.familiarity as Familiarity,
                disposition: args.seedRelationship.disposition as Disposition,
                notes: args.seedRelationship.notes ?? null
            });
            relationshipSeeded = true;
        } catch (e) {
            warnings.push(`seedRelationship failed: ${(e as Error).message}`);
        }
    }

    // STEP 6: Seed initial memory (best-effort)
    let memorySeeded = false;
    if (args.seedMemory) {
        try {
            memoryRepo.recordMemory({
                characterId: args.seedMemory.forCharacterId,
                npcId: characterId,
                summary: args.seedMemory.summary,
                importance: args.seedMemory.importance as Importance,
                topics: args.seedMemory.topics
            });
            memorySeeded = true;
        } catch (e) {
            warnings.push(`seedMemory failed: ${(e as Error).message}`);
        }
    }

    // STEP 7: Bind agent (best-effort — failure becomes a warning)
    let agentId: string | null = null;
    let agentRecord: unknown = null;
    if (args.agent) {
        try {
            const agentResult = await handleAgentCreate({
                action: 'create' as const,
                characterId,
                provider: args.agent.provider,
                model: args.agent.model,
                autoOnTurn: args.agent.autoOnTurn,
                temperature: args.agent.temperature,
                maxTokens: args.agent.maxTokens,
                budgetTokens: args.agent.budgetTokens,
                timeoutMs: args.agent.timeoutMs
            } as any) as any;

            if (agentResult?.error) {
                warnings.push(`agent binding failed: ${agentResult.message || 'unknown'}`);
            } else if (agentResult?.agent?.id) {
                agentId = agentResult.agent.id as string;
                agentRecord = agentResult.agent;

                // Set persona + directive slices
                if (args.agent.persona) {
                    try {
                        await handleAgentSetSlice({
                            action: 'set_slice' as const,
                            agentId,
                            kind: 'persona' as const,
                            content: args.agent.persona
                        } as any);
                    } catch (e) {
                        warnings.push(`agent persona slice failed: ${(e as Error).message}`);
                    }
                }
                if (args.agent.directive) {
                    try {
                        await handleAgentSetSlice({
                            action: 'set_slice' as const,
                            agentId,
                            kind: 'directive' as const,
                            content: args.agent.directive
                        } as any);
                    } catch (e) {
                        warnings.push(`agent directive slice failed: ${(e as Error).message}`);
                    }
                }
                // Add secrets one by one
                if (args.agent.secrets && args.agent.secrets.length > 0) {
                    for (const secret of args.agent.secrets) {
                        try {
                            await handleAgentAddSecret({
                                action: 'add_secret' as const,
                                agentId,
                                content: secret.content,
                                importance: secret.importance
                            } as any);
                        } catch (e) {
                            warnings.push(`agent secret add failed: ${(e as Error).message}`);
                        }
                    }
                }
            }
        } catch (e) {
            warnings.push(`agent binding failed: ${(e as Error).message}`);
        }
    }

    const message = agentId
        ? `Created NPC ${args.name} with bound agent ${agentId}`
        : args.agent
            ? `Created NPC ${args.name} (agent binding failed — see warnings)`
            : `Created NPC ${args.name} (no agent bound)`;

    const response: Record<string, unknown> = {
        success: true,
        actionType: 'create',
        characterId,
        character: characterSummary,
        agentId,
        agent: agentRecord,
        relationshipSeeded,
        memorySeeded,
        message
    };
    if (warnings.length > 0) response.warnings = warnings;

    return response;
}

// ----- Full context bundle -----

async function handleGetFullContext(args: z.infer<typeof GetFullContextSchema>): Promise<object> {
    const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
    const charRepo = new CharacterRepository(db);
    const agentRepo = new AgentRepository(db);
    const memoryRepo = new NpcMemoryRepository(db);
    const spatialRepo = new SpatialRepository(db);
    const concentrationRepo = new ConcentrationRepository(db);
    const inventoryRepo = new InventoryRepository(db);

    const character = charRepo.findById(args.characterId);
    if (!character) {
        return {
            error: true,
            actionType: 'get_full_context',
            message: `Character ${args.characterId} not found`
        };
    }

    const sectionsIncluded: string[] = [];
    const sectionsSkipped: string[] = [];
    const warningsArr: string[] = [];

    // Resolve agent once for persona / recentHistory
    const agent = agentRepo.findByCharacterId(args.characterId);

    // ── Sheet ─────────────────────────────────────────────────────
    let sheet: Record<string, unknown> | null = null;
    if (args.includeSheet !== false) {
        try {
            const c = character as any;
            sheet = {
                id: c.id,
                name: c.name,
                characterClass: c.characterClass,
                race: c.race,
                background: c.background,
                alignment: c.alignment,
                level: c.level,
                hp: c.hp,
                maxHp: c.maxHp,
                ac: c.ac,
                stats: c.stats,
                characterType: c.characterType,
                factionId: c.factionId,
                behavior: c.behavior,
                knownSpells: c.knownSpells ?? [],
                preparedSpells: c.preparedSpells ?? [],
                cantripsKnown: c.cantripsKnown ?? [],
                spellSlots: c.spellSlots,
                pactMagicSlots: c.pactMagicSlots,
                spellcastingAbility: c.spellcastingAbility,
                spellSaveDC: c.spellSaveDC,
                spellAttackBonus: c.spellAttackBonus,
                saveProficiencies: c.saveProficiencies,
                skillProficiencies: c.skillProficiencies,
                expertise: c.expertise,
                resistances: c.resistances ?? [],
                vulnerabilities: c.vulnerabilities ?? [],
                immunities: c.immunities ?? [],
                conditions: c.conditions ?? [],
                legendaryActions: c.legendaryActions,
                legendaryActionsRemaining: c.legendaryActionsRemaining,
                xp: c.xp,
                currentRoomId: c.currentRoomId
            };
            sectionsIncluded.push('sheet');
        } catch (e) {
            warningsArr.push(`sheet build failed: ${(e as Error).message}`);
        }
    } else {
        sectionsSkipped.push('sheet');
    }

    // ── Persona ───────────────────────────────────────────────────
    let persona: Record<string, unknown> | null = null;
    if (args.includePersona !== false) {
        if (agent) {
            try {
                const personaSlices = agentRepo.listSlices(agent.id, { kind: 'persona' });
                const directiveSlices = agentRepo.listSlices(agent.id, { kind: 'directive' });
                const allEnabled = agentRepo.listSlices(agent.id, { enabled: true });

                const personaText = personaSlices.filter(s => s.enabled).map(s => s.content).join('\n') || null;
                const directiveText = directiveSlices.filter(s => s.enabled).map(s => s.content).join('\n') || null;

                persona = {
                    agentId: agent.id,
                    personaText,
                    directiveText,
                    sliceCount: allEnabled.length,
                    enabledSlices: allEnabled.map(s => ({
                        id: s.id,
                        kind: s.kind,
                        label: s.label,
                        orderIndex: s.orderIndex
                    }))
                };
            } catch (e) {
                warningsArr.push(`persona build failed: ${(e as Error).message}`);
            }
            sectionsIncluded.push('persona');
        } else {
            // No agent bound — explicitly null
            persona = null;
            sectionsIncluded.push('persona');
        }
    } else {
        sectionsSkipped.push('persona');
    }

    // ── Relationships ─────────────────────────────────────────────
    let relationships: Record<string, unknown> | null = null;
    if (args.includeRelationships !== false) {
        try {
            const rels = memoryRepo.getNpcRelationships(args.characterId);
            const cap = rels.slice(0, args.relationshipLimit ?? 50);
            relationships = {
                count: cap.length,
                items: cap
            };
            sectionsIncluded.push('relationships');
        } catch (e) {
            warningsArr.push(`relationships build failed: ${(e as Error).message}`);
            relationships = { count: 0, items: [] };
        }
    } else {
        sectionsSkipped.push('relationships');
    }

    // ── Memories ─────────────────────────────────────────────────
    let memories: Record<string, unknown> | null = null;
    if (args.includeMemories !== false) {
        try {
            const mems = memoryRepo.getRecentInteractions(args.characterId, args.memoryLimit ?? 20);
            memories = { count: mems.length, items: mems };
            sectionsIncluded.push('memories');
        } catch (e) {
            warningsArr.push(`memories build failed: ${(e as Error).message}`);
            memories = { count: 0, items: [] };
        }
    } else {
        sectionsSkipped.push('memories');
    }

    // ── Recent history (agent journal) ────────────────────────────
    let recentHistory: Record<string, unknown> | null = null;
    if (args.includeRecentHistory !== false) {
        if (agent) {
            try {
                const entries = agentRepo.listJournal(agent.id, { limit: args.historyLimit ?? 10 });
                recentHistory = { count: entries.length, items: entries };
            } catch (e) {
                warningsArr.push(`recentHistory build failed: ${(e as Error).message}`);
            }
            sectionsIncluded.push('recentHistory');
        } else {
            recentHistory = null;
            sectionsIncluded.push('recentHistory');
        }
    } else {
        sectionsSkipped.push('recentHistory');
    }

    // ── Faction ──────────────────────────────────────────────────
    let faction: Record<string, unknown> | null = null;
    if (args.includeFaction !== false) {
        const c = character as any;
        if (c.factionId) {
            faction = { id: c.factionId, name: null };
            sectionsIncluded.push('faction');
        } else {
            faction = null;
            sectionsIncluded.push('faction');
        }
    } else {
        sectionsSkipped.push('faction');
    }

    // ── Location ─────────────────────────────────────────────────
    let location: Record<string, unknown> | null = null;
    if (args.includeLocation !== false) {
        const c = character as any;
        if (c.currentRoomId) {
            try {
                const room = spatialRepo.findById(c.currentRoomId);
                if (room) {
                    const otherIds = room.entityIds.filter((id: string) => id !== args.characterId);
                    const occupants = otherIds
                        .map((id: string) => {
                            const other = charRepo.findById(id);
                            return other ? { characterId: id, name: other.name } : null;
                        })
                        .filter((o: { characterId: string; name: string } | null): o is { characterId: string; name: string } => o !== null);
                    location = {
                        roomId: room.id,
                        name: room.name,
                        biome: (room as any).biomeContext ?? null,
                        atmospherics: (room as any).atmospherics ?? null,
                        occupants
                    };
                }
            } catch (e) {
                warningsArr.push(`location build failed: ${(e as Error).message}`);
            }
            sectionsIncluded.push('location');
        } else {
            location = null;
            sectionsIncluded.push('location');
        }
    } else {
        sectionsSkipped.push('location');
    }

    // ── Current encounter ────────────────────────────────────────
    let currentEncounter: Record<string, unknown> | null = null;
    if (args.includeEncounter !== false) {
        try {
            const rows = db.prepare("SELECT * FROM encounters WHERE status = 'active'").all() as any[];
            for (const row of rows) {
                const tokens = row.tokens ? JSON.parse(row.tokens) : [];
                const found = tokens.find((t: any) => t.id === args.characterId || t.characterId === args.characterId);
                if (found) {
                    const sortedTokens = [...tokens].sort((a: any, b: any) => (b.initiative ?? 0) - (a.initiative ?? 0));
                    const activeId = row.active_token_id;
                    currentEncounter = {
                        encounterId: row.id,
                        name: row.name ?? null,
                        round: row.round,
                        turnIndex: sortedTokens.findIndex((t: any) => t.id === activeId),
                        isActiveTurn: activeId === args.characterId || activeId === (found.id ?? found.characterId),
                        initiative: sortedTokens.map((t: any) => ({
                            characterId: t.id ?? t.characterId,
                            name: t.name ?? null,
                            initiative: t.initiative ?? 0,
                            hasActed: t.hasActed ?? false
                        }))
                    };
                    break;
                }
            }
            sectionsIncluded.push('currentEncounter');
        } catch (e) {
            warningsArr.push(`encounter scan failed: ${(e as Error).message}`);
        }
    } else {
        sectionsSkipped.push('currentEncounter');
    }

    // ── Inventory ────────────────────────────────────────────────
    let inventory: Record<string, unknown> | null = null;
    if (args.includeInventory !== false) {
        try {
            const inv = inventoryRepo.getInventoryWithDetails(args.characterId);
            inventory = {
                equipped: inv.items.filter(i => i.equipped).map(i => ({
                    name: i.item.name,
                    type: i.item.type,
                    equipped: true
                })),
                carried: inv.items.filter(i => !i.equipped).map(i => ({
                    name: i.item.name,
                    type: i.item.type,
                    quantity: i.quantity,
                    equipped: false
                })),
                currency: inv.currency
            };
            sectionsIncluded.push('inventory');
        } catch (e) {
            warningsArr.push(`inventory query failed: ${(e as Error).message}`);
            inventory = { equipped: [], carried: [], currency: { gold: 0, silver: 0, copper: 0 } };
        }
    } else {
        sectionsSkipped.push('inventory');
    }

    // ── Prompt blob ──────────────────────────────────────────────
    let prompt: Record<string, unknown> = {
        sheet: null,
        persona: null,
        relationshipSummary: '',
        recentMemoriesSummary: '',
        locationSummary: null,
        encounterSummary: null,
        combined: ''
    };

    if (args.includePromptBlob !== false) {
        try {
            const sheetStr = buildCharacterStateSlice(args.characterId, {
                characterRepo: charRepo,
                concentrationRepo,
                inventoryRepo
            });

            let personaStr: string | null = null;
            if (persona && (persona.personaText || persona.directiveText)) {
                const parts: string[] = [];
                if (persona.personaText) parts.push(`PERSONA:\n${persona.personaText}`);
                if (persona.directiveText) parts.push(`DIRECTIVE:\n${persona.directiveText}`);
                personaStr = parts.join('\n\n');
            }

            const relItems = (relationships?.items as any[]) || [];
            const relLines = relItems.length === 0
                ? 'No known relationships.'
                : relItems.map((r: any) => `- ${r.characterId}: ${r.familiarity} / ${r.disposition}${r.notes ? ` — ${r.notes}` : ''}`).join('\n');
            const relSummary = relLines;

            const memItems = (memories?.items as any[]) || [];
            const memLines = memItems.length === 0
                ? 'No memories.'
                : memItems.slice(0, 5).map((m: any) => {
                    const mark = m.importance === 'critical' ? '!!!' : m.importance === 'high' ? '!!' : m.importance === 'medium' ? '!' : '';
                    return `${mark} ${m.summary}`;
                }).join('\n');
            const memSummary = memLines;

            let locationSummary: string | null = null;
            if (location) {
                const occNames = (location.occupants as any[] || []).map((o: any) => o.name).join(', ');
                locationSummary = `In ${location.biome ?? 'an unknown area'} room "${location.name}"${occNames ? `, with: ${occNames}` : ''}`;
            }

            let encounterSummary: string | null = null;
            if (currentEncounter) {
                encounterSummary = `Round ${currentEncounter.round}, turn ${currentEncounter.turnIndex}${currentEncounter.isActiveTurn ? ' (YOUR TURN)' : ''}`;
            }

            const combinedParts = [sheetStr, personaStr, relSummary, memSummary, locationSummary, encounterSummary]
                .filter((s): s is string => typeof s === 'string' && s.length > 0);
            const combined = combinedParts.join('\n\n---\n\n');

            prompt = {
                sheet: sheetStr,
                persona: personaStr,
                relationshipSummary: relSummary,
                recentMemoriesSummary: memSummary,
                locationSummary,
                encounterSummary,
                combined
            };
        } catch (e) {
            warningsArr.push(`prompt build failed: ${(e as Error).message}`);
        }
    } else {
        sectionsSkipped.push('prompt');
    }

    return {
        success: true,
        actionType: 'get_full_context',
        characterId: args.characterId,
        sheet,
        persona,
        relationships,
        memories,
        recentHistory,
        faction,
        location,
        currentEncounter,
        inventory,
        prompt,
        meta: {
            sectionsIncluded,
            sectionsSkipped,
            warnings: warningsArr
        }
    };
}

async function handleGetRelationship(args: z.infer<typeof GetRelationshipSchema>): Promise<object> {
    const repo = getRepo();
    const relationship = repo.getRelationship(args.characterId, args.npcId);

    if (!relationship) {
        return {
            success: true,
            actionType: 'get_relationship',
            characterId: args.characterId,
            npcId: args.npcId,
            familiarity: 'stranger',
            disposition: 'neutral',
            notes: null,
            firstMetAt: null,
            lastInteractionAt: null,
            interactionCount: 0,
            isNew: true
        };
    }

    return {
        success: true,
        actionType: 'get_relationship',
        ...relationship,
        isNew: false
    };
}

async function handleUpdateRelationship(args: z.infer<typeof UpdateRelationshipSchema>): Promise<object> {
    const repo = getRepo();

    const relationship = repo.upsertRelationship({
        characterId: args.characterId,
        npcId: args.npcId,
        familiarity: args.familiarity as Familiarity,
        disposition: args.disposition as Disposition,
        notes: args.notes ?? null
    });

    return {
        success: true,
        actionType: 'update_relationship',
        relationship
    };
}

async function handleRecordMemory(args: z.infer<typeof RecordMemorySchema>): Promise<object> {
    const repo = getRepo();

    const memory = repo.recordMemory({
        characterId: args.characterId,
        npcId: args.npcId,
        summary: args.summary,
        importance: args.importance as Importance,
        topics: args.topics
    });

    return {
        success: true,
        actionType: 'record_memory',
        memory
    };
}

async function handleGetHistory(args: z.infer<typeof GetHistorySchema>): Promise<object> {
    const repo = getRepo();

    const memories = repo.getConversationHistory(
        args.characterId,
        args.npcId,
        {
            minImportance: args.minImportance as Importance | undefined,
            limit: args.limit
        }
    );

    return {
        success: true,
        actionType: 'get_history',
        characterId: args.characterId,
        npcId: args.npcId,
        count: memories.length,
        memories
    };
}

async function handleGetRecent(args: z.infer<typeof GetRecentSchema>): Promise<object> {
    const repo = getRepo();
    const memories = repo.getRecentInteractions(args.characterId, args.limit);

    return {
        success: true,
        actionType: 'get_recent',
        characterId: args.characterId,
        count: memories.length,
        memories
    };
}

async function handleGetContext(args: z.infer<typeof GetContextSchema>): Promise<object> {
    const repo = getRepo();

    const relationship = repo.getRelationship(args.characterId, args.npcId);
    const memories = repo.getConversationHistory(
        args.characterId,
        args.npcId,
        { limit: args.memoryLimit }
    );

    const defaultRelationship = {
        characterId: args.characterId,
        npcId: args.npcId,
        familiarity: 'stranger',
        disposition: 'neutral',
        notes: null,
        firstMetAt: null,
        lastInteractionAt: null,
        interactionCount: 0
    };

    return {
        success: true,
        actionType: 'get_context',
        relationship: relationship ?? defaultRelationship,
        recentMemories: memories,
        contextSummary: buildContextSummary(relationship, memories)
    };
}

async function handleInteract(args: z.infer<typeof InteractSchema>): Promise<object> {
    const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
    const charRepo = new CharacterRepository(db);
    const spatialRepo = new SpatialRepository(db);
    const memoryRepo = new NpcMemoryRepository(db);

    // Validate speaker exists
    const speaker = charRepo.findById(args.speakerId);
    if (!speaker) {
        return { error: true, message: `Speaker with ID ${args.speakerId} not found` };
    }

    // Check speaker is in a room
    if (!speaker.currentRoomId) {
        return { error: true, message: `Speaker ${speaker.name} is not in any room` };
    }

    const room = spatialRepo.findById(speaker.currentRoomId);
    if (!room) {
        return { error: true, message: `Room ${speaker.currentRoomId} not found` };
    }

    // Validate target if specified
    let target = null;
    if (args.targetId) {
        target = charRepo.findById(args.targetId);
        if (!target) {
            return { error: true, message: `Target with ID ${args.targetId} not found` };
        }
    }

    // Calculate hearing radius
    const hearingRadius = calculateHearingRadius({
        volume: args.volume as VolumeLevel,
        biomeContext: room.biomeContext,
        atmospherics: room.atmospherics
    });

    // Get environment modifier
    const envModifier = getEnvironmentModifier(room.atmospherics);

    // Find potential listeners
    const potentialListeners = room.entityIds
        .filter(id => id !== args.speakerId)
        .map(id => charRepo.findById(id))
        .filter((char): char is NonNullable<typeof char> => char !== null);

    // Track hearing results
    const hearingResults: Array<{
        listenerId: string;
        listenerName: string;
        heardFully: boolean;
        opposedRoll?: {
            speakerRoll: number;
            speakerTotal: number;
            listenerRoll: number;
            listenerTotal: number;
            success: boolean;
            margin: number;
        };
    }> = [];

    // Target always hears full content
    if (target && target.currentRoomId === room.id) {
        hearingResults.push({
            listenerId: target.id,
            listenerName: target.name,
            heardFully: true
        });

        memoryRepo.recordMemory({
            characterId: target.id,
            npcId: speaker.id,
            summary: `${speaker.name} said (${args.volume.toLowerCase()}): "${args.content}"${args.intent ? ` [Intent: ${args.intent}]` : ''}`,
            importance: args.volume === 'SHOUT' ? 'high' : 'medium',
            topics: args.intent ? [args.intent] : []
        });
    }

    // For eavesdroppers, roll Stealth vs Perception
    const eavesdroppers = potentialListeners.filter(listener =>
        listener.id !== args.targetId && !isDeafened(listener)
    );

    for (const listener of eavesdroppers) {
        const roll = rollStealthVsPerception(speaker, listener, envModifier);

        hearingResults.push({
            listenerId: listener.id,
            listenerName: listener.name,
            heardFully: false,
            opposedRoll: {
                speakerRoll: roll.speakerRoll,
                speakerTotal: roll.speakerTotal,
                listenerRoll: roll.listenerRoll,
                listenerTotal: roll.listenerTotal,
                success: roll.success,
                margin: roll.margin
            }
        });

        if (roll.success) {
            memoryRepo.recordMemory({
                characterId: listener.id,
                npcId: speaker.id,
                summary: `Overheard ${speaker.name} ${args.volume === 'WHISPER' ? 'whispering' : args.volume === 'SHOUT' ? 'shouting' : 'talking'}${target ? ` to ${target.name}` : ''} about something${args.intent ? ` (${args.intent})` : ''}`,
                importance: args.volume === 'SHOUT' ? 'medium' : 'low',
                topics: args.intent ? [args.intent, 'eavesdropped'] : ['eavesdropped']
            });
        }
    }

    return {
        success: true,
        actionType: 'interact',
        speaker: { id: speaker.id, name: speaker.name },
        target: target ? { id: target.id, name: target.name, heard: true } : null,
        volume: args.volume,
        hearingRadius,
        room: {
            id: room.id,
            name: room.name,
            biome: room.biomeContext,
            atmospherics: room.atmospherics
        },
        listeners: hearingResults,
        totalListeners: hearingResults.length,
        whoHeard: hearingResults.filter(r => r.heardFully || r.opposedRoll?.success).length,
        whoMissed: hearingResults.filter(r => !r.heardFully && !r.opposedRoll?.success).length
    };
}

/**
 * Build a human-readable context summary for LLM injection
 */
function buildContextSummary(
    relationship: { familiarity: string; disposition: string; notes: string | null; interactionCount: number } | null,
    memories: Array<{ summary: string; importance: string; topics: string[] }>
): string {
    const lines: string[] = [];

    if (relationship) {
        lines.push(`RELATIONSHIP: ${relationship.familiarity} (${relationship.disposition})`);
        lines.push(`Previous interactions: ${relationship.interactionCount}`);
        if (relationship.notes) {
            lines.push(`Notes: ${relationship.notes}`);
        }
    } else {
        lines.push(`RELATIONSHIP: First meeting (stranger, neutral)`);
    }

    if (memories.length > 0) {
        lines.push('');
        lines.push('PREVIOUS CONVERSATIONS:');
        for (const memory of memories) {
            const importance = memory.importance === 'critical' ? '!!!' :
                memory.importance === 'high' ? '!!' :
                    memory.importance === 'medium' ? '!' : '';
            lines.push(`${importance} ${memory.summary}`);
            if (memory.topics.length > 0) {
                lines.push(`  Topics: ${memory.topics.join(', ')}`);
            }
        }
    }

    return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION ROUTER
// ═══════════════════════════════════════════════════════════════════════════

const definitions: Record<NpcManageAction, ActionDefinition> = {
    create: {
        schema: NewCreateSchema,
        handler: handleCreateNpc,
        aliases: ['new', 'add', 'spawn', 'bootstrap'],
        description: 'Create an NPC (sheet + optional agent + optional seed relationship/memory)'
    },
    get_full_context: {
        schema: GetFullContextSchema,
        handler: handleGetFullContext,
        aliases: ['full_context', 'bundle', 'context_bundle'],
        description: 'Full table-ready bundle: sheet + persona + relationships + memories + location + encounter + inventory + prompt blob'
    },
    get_relationship: {
        schema: GetRelationshipSchema,
        handler: handleGetRelationship,
        aliases: ['relationship', 'get_rel'],
        description: 'Get relationship status between PC and NPC'
    },
    update_relationship: {
        schema: UpdateRelationshipSchema,
        handler: handleUpdateRelationship,
        aliases: ['set_relationship', 'update_rel'],
        description: 'Update or create a PC-NPC relationship'
    },
    record_memory: {
        schema: RecordMemorySchema,
        handler: handleRecordMemory,
        aliases: ['remember', 'record', 'log_conversation'],
        description: 'Record a significant conversation/interaction'
    },
    get_history: {
        schema: GetHistorySchema,
        handler: handleGetHistory,
        aliases: ['history', 'conversations'],
        description: 'Get conversation history between PC and NPC'
    },
    get_recent: {
        schema: GetRecentSchema,
        handler: handleGetRecent,
        aliases: ['recent', 'recent_interactions'],
        description: 'Get recent conversation memories across all NPCs'
    },
    get_context: {
        schema: GetContextSchema,
        handler: handleGetContext,
        aliases: ['context', 'npc_context'],
        description: 'Get relationship + history for LLM dialogue prompts'
    },
    interact: {
        schema: InteractSchema,
        handler: handleInteract,
        aliases: ['speak', 'talk', 'social'],
        description: 'Social interaction with spatial awareness and hearing'
    }
};

const router = createActionRouter({
    actions: ACTIONS,
    definitions,
    threshold: 0.6
});

// ═══════════════════════════════════════════════════════════════════════════
// TOOL DEFINITION & HANDLER
// ═══════════════════════════════════════════════════════════════════════════

export const NpcManageTool = {
    name: 'npc_manage',
    description: `Track NPC relationships, memories, and social interactions.

🎭 SOCIAL AI WORKFLOW:
1. get_context - Before NPC dialogue, get relationship + memory summary
2. Inject into system prompt for informed roleplay
3. record_memory - After significant interactions
4. update_relationship - When familiarity/disposition changes

📊 RELATIONSHIP PROGRESSION:
Familiarity: stranger → acquaintance → friend → close_friend (or rival/enemy)
Disposition: hostile → unfriendly → neutral → friendly → helpful

🗣️ SPATIAL INTERACTIONS:
- interact: Volume affects who hears (WHISPER/TALK/SHOUT)
- Eavesdroppers roll Stealth vs Perception
- Memories auto-recorded for participants

💡 AI TIP:
Always call get_context before generating NPC dialogue!
Response includes formatted summary for prompt injection.

Actions: create, get_full_context, get_relationship, update_relationship, record_memory, get_history, get_recent, get_context, interact`,
    actionSchemas: router.actionSchemas,
    inputSchema: z.object({
        action: z.string().describe(`Action: ${ACTIONS.join(', ')}`),
        characterId: z.string().optional().describe('ID of the player character (or the NPC for get_full_context)'),
        npcId: z.string().optional().describe('ID of the NPC'),
        speakerId: z.string().optional().describe('ID of speaker (for interact)'),
        targetId: z.string().optional().describe('ID of target (for interact)'),
        // create fields
        name: z.string().optional(),
        class: z.string().optional(),
        race: z.string().optional(),
        background: z.string().optional(),
        alignment: z.string().optional(),
        stats: StatsSchema.partial().optional(),
        hp: z.number().int().optional(),
        maxHp: z.number().int().optional(),
        ac: z.number().int().optional(),
        level: z.number().int().optional(),
        characterType: z.enum(['pc', 'npc', 'enemy', 'neutral']).optional(),
        factionId: z.string().optional(),
        behavior: z.string().optional(),
        knownSpells: z.array(z.string()).optional(),
        preparedSpells: z.array(z.string()).optional(),
        resistances: z.array(z.string()).optional(),
        vulnerabilities: z.array(z.string()).optional(),
        immunities: z.array(z.string()).optional(),
        origin: CharacterOriginSchema.optional(),
        provisionEquipment: z.boolean().optional(),
        customEquipment: z.array(z.string()).optional(),
        startingGold: z.number().int().optional(),
        seedRelationship: z.any().optional(),
        seedMemory: z.any().optional(),
        agent: z.any().optional(),
        // get_full_context include toggles
        includeSheet: z.boolean().optional(),
        includePersona: z.boolean().optional(),
        includeRelationships: z.boolean().optional(),
        includeMemories: z.boolean().optional(),
        includeRecentHistory: z.boolean().optional(),
        includeLocation: z.boolean().optional(),
        includeEncounter: z.boolean().optional(),
        includeFaction: z.boolean().optional(),
        includeInventory: z.boolean().optional(),
        includePromptBlob: z.boolean().optional(),
        historyLimit: z.number().int().optional(),
        relationshipLimit: z.number().int().optional(),
        // existing fields
        familiarity: z.enum(['stranger', 'acquaintance', 'friend', 'close_friend', 'rival', 'enemy']).optional(),
        disposition: z.enum(['hostile', 'unfriendly', 'neutral', 'friendly', 'helpful']).optional(),
        notes: z.string().optional(),
        summary: z.string().optional(),
        importance: z.enum(['low', 'medium', 'high', 'critical']).optional(),
        topics: z.array(z.string()).optional(),
        minImportance: z.enum(['low', 'medium', 'high', 'critical']).optional(),
        limit: z.number().optional(),
        memoryLimit: z.number().optional(),
        content: z.string().optional(),
        volume: z.enum(['WHISPER', 'TALK', 'SHOUT']).optional(),
        intent: z.string().optional()
    })
};

export async function handleNpcManage(args: unknown, _ctx: SessionContext): Promise<McpResponse> {
    const result = await router(args as Record<string, unknown>);
    const parsed = JSON.parse(result.content[0].text);

    let output = '';

    if (parsed.error) {
        output = RichFormatter.header('Error', '');
        output += RichFormatter.alert(parsed.message || 'Unknown error', 'error');
        if (parsed.suggestions) {
            output += '\n**Did you mean:**\n';
            parsed.suggestions.forEach((s: { action: string; similarity: number }) => {
                output += `  - ${s.action} (${s.similarity}% match)\n`;
            });
        }
    } else {
        switch (parsed.actionType) {
            case 'create':
                output = RichFormatter.header(`NPC Created: ${parsed.character?.name ?? 'Unknown'}`, '');
                output += RichFormatter.keyValue({
                    'Character ID': parsed.characterId,
                    'Agent ID': parsed.agentId ?? '(none)',
                    'Relationship seeded': parsed.relationshipSeeded ? 'yes' : 'no',
                    'Memory seeded': parsed.memorySeeded ? 'yes' : 'no'
                });
                if (Array.isArray(parsed.warnings) && parsed.warnings.length > 0) {
                    output += '\n**Warnings:**\n';
                    for (const w of parsed.warnings) output += `- ${w}\n`;
                }
                break;

            case 'get_full_context':
                output = RichFormatter.header(`Full Context: ${parsed.sheet?.name ?? parsed.characterId}`, '');
                output += RichFormatter.keyValue({
                    'Character ID': parsed.characterId,
                    'Sheet': parsed.sheet ? 'yes' : 'no',
                    'Persona': parsed.persona ? 'yes' : 'no',
                    'Relationships': parsed.relationships?.count ?? 0,
                    'Memories': parsed.memories?.count ?? 0,
                    'Recent history': parsed.recentHistory?.count ?? 0,
                    'Location': parsed.location ? 'yes' : 'no',
                    'Encounter': parsed.currentEncounter ? 'yes' : 'no'
                });
                break;

            case 'get_relationship':
                output = RichFormatter.header('NPC Relationship', '');
                output += RichFormatter.keyValue({
                    'Character': `\`${parsed.characterId}\``,
                    'NPC': `\`${parsed.npcId}\``,
                    'Familiarity': parsed.familiarity,
                    'Disposition': parsed.disposition,
                    'Interactions': parsed.interactionCount || 0
                });
                if (parsed.notes) output += `\n**Notes:** ${parsed.notes}`;
                break;

            case 'update_relationship':
                output = RichFormatter.header('Relationship Updated', '');
                if (parsed.relationship) {
                    output += RichFormatter.keyValue({
                        'Familiarity': parsed.relationship.familiarity,
                        'Disposition': parsed.relationship.disposition
                    });
                }
                break;

            case 'record_memory':
                output = RichFormatter.header('Memory Recorded', '');
                if (parsed.memory) {
                    output += RichFormatter.keyValue({
                        'Importance': parsed.memory.importance,
                        'Summary': parsed.memory.summary.substring(0, 50) + '...'
                    });
                }
                break;

            case 'get_history':
                output = RichFormatter.header(`Conversation History (${parsed.count})`, '');
                if (parsed.memories?.length > 0) {
                    parsed.memories.slice(0, 5).forEach((m: { importance: string; summary: string }) => {
                        const icon = m.importance === 'critical' ? '' : m.importance === 'high' ? '' : '';
                        output += `${icon} ${m.summary.substring(0, 60)}...\n`;
                    });
                    if (parsed.count > 5) output += `...and ${parsed.count - 5} more\n`;
                } else {
                    output += 'No conversation history.\n';
                }
                break;

            case 'get_recent':
                output = RichFormatter.header(`Recent Interactions (${parsed.count})`, '');
                if (parsed.memories?.length > 0) {
                    parsed.memories.slice(0, 5).forEach((m: { summary: string }) => {
                        output += `- ${m.summary.substring(0, 50)}...\n`;
                    });
                }
                break;

            case 'get_context':
                output = RichFormatter.header('NPC Context', '');
                if (parsed.relationship) {
                    output += RichFormatter.keyValue({
                        'Familiarity': parsed.relationship.familiarity,
                        'Disposition': parsed.relationship.disposition
                    });
                }
                output += `\n**Memories:** ${parsed.recentMemories?.length || 0}\n`;
                break;

            case 'interact':
                output = RichFormatter.header('Social Interaction', '');
                output += RichFormatter.keyValue({
                    'Speaker': parsed.speaker?.name || 'Unknown',
                    'Target': parsed.target?.name || 'None',
                    'Volume': parsed.volume,
                    'Heard': `${parsed.whoHeard}/${parsed.totalListeners}`
                });
                break;

            default:
                output = RichFormatter.header('NPC', '');
                if (parsed.message) output += parsed.message + '\n';
        }
    }

    output += RichFormatter.embedJson(parsed, 'NPC_MANAGE');

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}
