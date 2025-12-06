import { z } from 'zod';
import { CombatEngine, CombatParticipant, CombatState, CombatActionResult } from '../engine/combat/engine.js';
import { SpatialEngine } from '../engine/spatial/engine.js';

import { PubSub } from '../engine/pubsub.js';

import { getCombatManager } from './state/combat-manager.js';
import { getDb } from '../storage/index.js';
import { EncounterRepository } from '../storage/repos/encounter.repo.js';
import { SessionContext } from './types.js';

// CRIT-006: Import spellcasting validation and resolution
import { validateSpellCast, consumeSpellSlot } from '../engine/magic/spell-validator.js';
import { resolveSpell } from '../engine/magic/spell-resolver.js';
import { CharacterRepository } from '../storage/repos/character.repo.js';
import { ConcentrationRepository } from '../storage/repos/concentration.repo.js';
import { startConcentration, checkConcentration, breakConcentration } from '../engine/magic/concentration.js';
import type { Character } from '../schema/character.js';

// Global combat state (in-memory for MVP)
let pubsub: PubSub | null = null;

export function setCombatPubSub(instance: PubSub) {
    pubsub = instance;
}

// ============================================================
// FORMATTING - Both human-readable AND machine-readable
// ============================================================

/**
 * Build a machine-readable state object for frontend sync
 */
function buildStateJson(state: CombatState, encounterId: string) {
    const currentParticipant = state.participants.find(
        (p) => p.id === state.turnOrder[state.currentTurnIndex]
    );

    return {
        encounterId,
        round: state.round,
        currentTurnIndex: state.currentTurnIndex,
        currentTurn: currentParticipant ? {
            id: currentParticipant.id,
            name: currentParticipant.name,
            isEnemy: currentParticipant.isEnemy
        } : null,
        turnOrder: state.turnOrder.map(id => {
            const p = state.participants.find(part => part.id === id);
            return p?.name || id;
        }),
        participants: state.participants.map(p => ({
            id: p.id,
            name: p.name,
            hp: p.hp,
            maxHp: p.maxHp,
            initiative: p.initiative,
            isEnemy: p.isEnemy,
            conditions: p.conditions.map(c => c.type),
            isDefeated: p.hp <= 0,
            isCurrentTurn: p.id === currentParticipant?.id
        })),
        // HIGH-006: Lair action status
        isLairActionPending: state.turnOrder[state.currentTurnIndex] === 'LAIR',
        hasLairActions: state.hasLairActions ?? false,
        lairOwnerId: state.lairOwnerId
    };
}

/**
 * Format combat state for human reading in chat
 */
function formatCombatStateText(state: CombatState): string {
    const currentParticipant = state.participants.find(
        (p) => p.id === state.turnOrder[state.currentTurnIndex]
    );

    const isEnemy = currentParticipant?.isEnemy ?? false;

    // Header with round info
    const turnIcon = isEnemy ? '👹' : '⚔️';
    let output = `\n┌─────────────────────────────────────────┐\n`;
    output += `│ ${turnIcon} ROUND ${state.round} — ${currentParticipant?.name}'s Turn\n`;
    output += `└─────────────────────────────────────────┘\n\n`;

    // Initiative order with clear formatting
    output += `📋 INITIATIVE ORDER\n`;
    output += `───────────────────────────────────────────\n`;
    
    state.turnOrder.forEach((id: string, index: number) => {
        const p = state.participants.find((part) => part.id === id);
        if (!p) return;

        const isCurrent = index === state.currentTurnIndex;
        const icon = p.isEnemy ? '👹' : '🧙';
        const hpPct = p.maxHp > 0 ? (p.hp / p.maxHp) * 100 : 0;
        const hpBar = createHpBar(hpPct);
        const marker = isCurrent ? '▶' : ' ';
        const status = p.hp <= 0 ? '💀 DEFEATED' : '';
        
        output += `${marker} ${icon} ${p.name.padEnd(18)} ${hpBar} ${p.hp}/${p.maxHp} HP  [Init: ${p.initiative}] ${status}\n`;
    });
    
    output += `\n`;

    // Find valid targets for guidance
    const validPlayerTargets = state.participants
        .filter(p => !p.isEnemy && p.hp > 0)
        .map(p => `${p.name} (${p.id})`);
    
    const validEnemyTargets = state.participants
        .filter(p => p.isEnemy && p.hp > 0)
        .map(p => `${p.name} (${p.id})`);

    // Action guidance
    if (isEnemy && currentParticipant && currentParticipant.hp > 0) {
        output += `⚡ ENEMY TURN\n`;
        output += `   Available targets: ${validPlayerTargets.join(', ') || 'None'}\n`;
        output += `   → Execute attack, then call advance_turn\n`;
    } else if (currentParticipant && currentParticipant.hp > 0) {
        output += `🎮 PLAYER TURN\n`;
        output += `   Available targets: ${validEnemyTargets.join(', ') || 'None'}\n`;
        output += `   → Awaiting player action\n`;
    } else {
        output += `⏭️ Current combatant is defeated — call advance_turn\n`;
    }

    return output;
}

/**
 * Create a visual HP bar
 */
function createHpBar(percentage: number): string {
    const filled = Math.round(percentage / 10);
    const empty = 10 - filled;
    
    // Simple ASCII bar for cleaner output
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    return `[${bar}]`;
}

/**
 * Format an attack result for display
 */
function formatAttackResult(result: CombatActionResult): string {
    let output = `\n┌─────────────────────────────────────────┐\n`;
    output += `│ ⚔️  ATTACK ACTION\n`;
    output += `└─────────────────────────────────────────┘\n\n`;
    
    output += `${result.actor.name} attacks ${result.target.name}!\n\n`;
    output += result.detailedBreakdown;
    
    if (result.defeated) {
        output += `\n\n💀 ${result.target.name} has been defeated!`;
    }
    
    output += `\n\n→ Call advance_turn to proceed`;
    
    return output;
}

/**
 * Format a heal result for display
 */
function formatHealResult(result: CombatActionResult): string {
    let output = `\n┌─────────────────────────────────────────┐\n`;
    output += `│ 💚 HEAL ACTION\n`;
    output += `└─────────────────────────────────────────┘\n\n`;

    output += `${result.actor.name} heals ${result.target.name}!\n\n`;
    output += result.detailedBreakdown;
    output += `\n\n→ Call advance_turn to proceed`;

    return output;
}

/**
 * CRIT-006: Format spell cast result for display
 */
function formatSpellCastResult(
    casterName: string,
    resolution: { spellName: string; damage?: number; damageType?: string; healing?: number; diceRolled: string; saveResult?: string; saveDC?: number; autoHit?: boolean; dartCount?: number; concentration?: boolean },
    target: { name: string; hp: number; maxHp: number } | undefined,
    targetHpBefore: number
): string {
    let output = `\n┌─────────────────────────────────────────┐\n`;
    output += `│ ✨ SPELL CAST\n`;
    output += `└─────────────────────────────────────────┘\n\n`;

    output += `${casterName} casts ${resolution.spellName}!\n\n`;

    // Dice rolled
    if (resolution.diceRolled) {
        output += `🎲 Rolled: ${resolution.diceRolled}\n`;
    }

    // Special: Magic Missile darts
    if (resolution.dartCount) {
        output += `✨ Darts: ${resolution.dartCount}\n`;
    }

    // Save info
    if (resolution.saveResult && resolution.saveDC) {
        const saveIcon = resolution.saveResult === 'passed' ? '✓' : '✗';
        output += `🛡️ Save DC ${resolution.saveDC}: ${saveIcon} ${resolution.saveResult}\n`;
    }

    // Auto-hit
    if (resolution.autoHit) {
        output += `🎯 Auto-hit!\n`;
    }

    // Damage
    if (resolution.damage && resolution.damage > 0) {
        const damageType = resolution.damageType || 'magical';
        output += `💥 Damage: ${resolution.damage} ${damageType}\n`;

        if (target) {
            output += `\n${target.name}: ${targetHpBefore} → ${target.hp} HP`;
            if (target.hp <= 0) {
                output += ` 💀 DEFEATED!`;
            }
        }
    }

    // Healing
    if (resolution.healing && resolution.healing > 0) {
        output += `💚 Healing: ${resolution.healing}\n`;

        if (target) {
            output += `\n${target.name}: ${targetHpBefore} → ${target.hp} HP`;
        }
    }

    // Concentration
    if (resolution.concentration) {
        output += `\n⚡ Concentration required`;
    }

    output += `\n\n→ Call advance_turn to proceed`;

    return output;
}

/**
 * HIGH-003: Format disengage result for display
 */
function formatDisengageResult(actorName: string): string {
    let output = `\n┌─────────────────────────────────────────┐\n`;
    output += `│ 🏃 DISENGAGE ACTION\n`;
    output += `└─────────────────────────────────────────┘\n\n`;
    output += `${actorName} takes the Disengage action.\n`;
    output += `Movement this turn will not provoke opportunity attacks.\n`;
    output += `\n→ Call advance_turn to proceed (or move first)`;
    return output;
}

/**
 * HIGH-003: Format opportunity attack result for display
 */
function formatOpportunityAttackResult(result: CombatActionResult): string {
    let output = `\n┌─────────────────────────────────────────┐\n`;
    output += `│ ⚡ OPPORTUNITY ATTACK\n`;
    output += `└─────────────────────────────────────────┘\n\n`;
    output += result.detailedBreakdown;
    return output;
}

/**
 * CRIT-003: Format a move result for display
 */
function formatMoveResult(
    actorName: string,
    fromPos: { x: number; y: number } | undefined,
    toPos: { x: number; y: number },
    success: boolean,
    failReason: string | null,
    distance?: number
): string {
    let output = `\n┌─────────────────────────────────────────┐\n`;
    output += `│ 🚶 MOVE ACTION\n`;
    output += `└─────────────────────────────────────────┘\n\n`;

    if (success) {
        if (fromPos) {
            output += `${actorName} moved from (${fromPos.x}, ${fromPos.y}) to (${toPos.x}, ${toPos.y})`;
            if (distance !== undefined) {
                output += ` [${distance} tiles]`;
            }
            output += `\n`;
        } else {
            output += `${actorName} placed at (${toPos.x}, ${toPos.y})\n`;
        }
    } else {
        output += `${actorName} cannot move to (${toPos.x}, ${toPos.y})\n`;
        output += `Reason: ${failReason}\n`;
    }

    output += `\n→ Call advance_turn to proceed`;
    return output;
}

// Tool definitions
export const CombatTools = {
    CREATE_ENCOUNTER: {
        name: 'create_encounter',
        description: `Create a new combat encounter with the specified participants.
Initiative is rolled automatically (1d20 + initiativeBonus).
Enemy detection is automatic based on ID/name patterns, but you can override with isEnemy.

Example:
{
  "seed": "battle-1",
  "participants": [
    {
      "id": "hero-1",
      "name": "Valeros",
      "initiativeBonus": 2,
      "hp": 20,
      "maxHp": 20,
      "isEnemy": false
    },
    {
      "id": "goblin-1",
      "name": "Goblin",
      "initiativeBonus": 1,
      "hp": 7,
      "maxHp": 7,
      "isEnemy": true
    }
  ]
}`,
        inputSchema: z.object({
            seed: z.string().describe('Seed for deterministic combat resolution'),
            participants: z.array(z.object({
                id: z.string(),
                name: z.string(),
                initiativeBonus: z.number().int(),
                hp: z.number().int().positive(),
                maxHp: z.number().int().positive(),
                isEnemy: z.boolean().optional().describe('Whether this is an enemy (auto-detected if not set)'),
                conditions: z.array(z.string()).default([]),
                position: z.object({ x: z.number(), y: z.number(), z: z.number().optional() }).optional()
                    .describe('CRIT-003: Spatial position for movement (x, y coordinates)'),
                // HIGH-002: Damage modifiers
                resistances: z.array(z.string()).optional()
                    .describe('Damage types that deal half damage (e.g., ["fire", "cold"])'),
                vulnerabilities: z.array(z.string()).optional()
                    .describe('Damage types that deal double damage'),
                immunities: z.array(z.string()).optional()
                    .describe('Damage types that deal no damage')
            })).min(1),
            terrain: z.object({
                obstacles: z.array(z.string()).default([]).describe('Array of "x,y" strings for blocking tiles'),
                difficultTerrain: z.array(z.string()).optional().describe('Array of "x,y" strings for difficult terrain')
            }).optional().describe('CRIT-003: Terrain configuration for collision')
        })
    },
    GET_ENCOUNTER_STATE: {
        name: 'get_encounter_state',
        description: 'Get the current state of the active combat encounter.',
        inputSchema: z.object({
            encounterId: z.string().describe('The ID of the encounter')
        })
    },
    EXECUTE_COMBAT_ACTION: {
        name: 'execute_combat_action',
        description: `Execute a combat action (attack, heal, move, cast_spell, etc.).

Examples:
{
  "action": "attack",
  "actorId": "hero-1",
  "targetId": "goblin-1",
  "attackBonus": 5,
  "dc": 12,
  "damage": 6
}

{
  "action": "heal",
  "actorId": "cleric-1",
  "targetId": "hero-1",
  "amount": 8
}

{
  "action": "move",
  "actorId": "hero-1",
  "targetPosition": { "x": 5, "y": 3 }
}

{
  "action": "disengage",
  "actorId": "hero-1"
}

{
  "action": "cast_spell",
  "actorId": "wizard-1",
  "spellName": "Fireball",
  "targetId": "goblin-1",
  "slotLevel": 3
}`,
        inputSchema: z.object({
            encounterId: z.string().describe('The ID of the encounter'),
            action: z.enum(['attack', 'heal', 'move', 'disengage', 'cast_spell']),
            actorId: z.string(),
            targetId: z.string().optional().describe('Target ID for attack/heal/cast_spell actions'),
            attackBonus: z.number().int().optional(),
            dc: z.number().int().optional(),
            damage: z.number().int().optional(),
            damageType: z.string().optional()
                .describe('HIGH-002: Damage type (e.g., "fire", "cold", "slashing") for resistance calculation'),
            amount: z.number().int().optional(),
            targetPosition: z.object({ x: z.number(), y: z.number() }).optional()
                .describe('CRIT-003: Target position for move action'),
            // CRIT-006: Spell casting fields
            spellName: z.string().optional()
                .describe('CRIT-006: Name of the spell to cast (must exist in spell database)'),
            slotLevel: z.number().int().min(1).max(9).optional()
                .describe('CRIT-006: Spell slot level to use (for upcasting)')
        })
    },
    ADVANCE_TURN: {
        name: 'advance_turn',
        description: 'Advance to the next combatant\'s turn.',
        inputSchema: z.object({
            encounterId: z.string().describe('The ID of the encounter')
        })
    },
    END_ENCOUNTER: {
        name: 'end_encounter',
        description: 'End the current combat encounter.',
        inputSchema: z.object({
            encounterId: z.string().describe('The ID of the encounter')
        })
    },
    LOAD_ENCOUNTER: {
        name: 'load_encounter',
        description: 'Load a combat encounter from the database.',
        inputSchema: z.object({
            encounterId: z.string().describe('The ID of the encounter to load')
        })
    },
    ROLL_DEATH_SAVE: {
        name: 'roll_death_save',
        description: `Roll a death saving throw for a character at 0 HP.

D&D 5e Death Saving Throw Rules:
- Roll d20 at the start of each turn when at 0 HP
- 10+ = success
- 9 or less = failure
- Natural 20 = regain 1 HP and become conscious
- Natural 1 = counts as 2 failures
- 3 successes = stabilized (unconscious but won't die)
- 3 failures = dead

Only valid for characters at 0 HP who are not stabilized or dead.`,
        inputSchema: z.object({
            encounterId: z.string().describe('The ID of the encounter'),
            characterId: z.string().describe('The ID of the character at 0 HP')
        })
    },
    EXECUTE_LAIR_ACTION: {
        name: 'execute_lair_action',
        description: `Execute a lair action when it's initiative 20 (the lair's turn).

Lair actions are special environmental effects that legendary creatures can trigger in their lair.
Examples:
- Magma geysers erupt
- Ceiling collapses
- Shadow tentacles emerge
- Poison gas vents open

This tool should only be called when isLairActionPending is true in the encounter state.
The effect and targets are provided by the caller (DM/LLM) - the engine validates timing and applies damage.`,
        inputSchema: z.object({
            encounterId: z.string().describe('The ID of the encounter'),
            actionDescription: z.string().describe('Description of the lair action'),
            targetIds: z.array(z.string()).optional().describe('IDs of affected participants (optional)'),
            damage: z.number().int().min(0).optional().describe('Damage dealt by the lair action'),
            damageType: z.string().optional().describe('Type of damage (fire, cold, etc.)'),
            savingThrow: z.object({
                ability: z.enum(['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma']),
                dc: z.number().int().min(1).max(30)
            }).optional().describe('Saving throw required to avoid/reduce effect'),
            halfDamageOnSave: z.boolean().default(true).describe('Whether successful save halves damage')
        })
    }
} as const;

// Tool handlers
export async function handleCreateEncounter(args: unknown, ctx: SessionContext) {
    const parsed = CombatTools.CREATE_ENCOUNTER.inputSchema.parse(args);

    // Create combat engine
    const engine = new CombatEngine(parsed.seed, pubsub || undefined);

    // Convert participants to proper format (preserve isEnemy, position, and resistances)
    const participants: CombatParticipant[] = parsed.participants.map(p => ({
        id: p.id,
        name: p.name,
        initiativeBonus: p.initiativeBonus,
        hp: p.hp,
        maxHp: p.maxHp,
        isEnemy: p.isEnemy,  // Will be auto-detected in startEncounter if undefined
        conditions: [],
        position: p.position,  // CRIT-003: Preserve spatial position
        // HIGH-002: Preserve damage modifiers
        resistances: p.resistances,
        vulnerabilities: p.vulnerabilities,
        immunities: p.immunities
    } as CombatParticipant));

    // Start encounter
    const state = engine.startEncounter(participants);

    // CRIT-003: Add terrain to state if provided
    if (parsed.terrain && state) {
        (state as any).terrain = parsed.terrain;
    }

    // Generate encounter ID
    const encounterId = `encounter-${parsed.seed}-${Date.now()}`;
    // Store with session namespace
    getCombatManager().create(`${ctx.sessionId}:${encounterId}`, engine);

    // Persist initial state
    const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
    const repo = new EncounterRepository(db);

    // Create the encounter record first (with initiative and isEnemy)
    repo.create({
        id: encounterId,
        tokens: state.participants.map(p => ({
            id: p.id,
            name: p.name,
            initiativeBonus: p.initiativeBonus,
            initiative: p.initiative,    // Store rolled initiative
            isEnemy: p.isEnemy,          // Store enemy flag
            hp: p.hp,
            maxHp: p.maxHp,
            conditions: p.conditions,
            abilityScores: p.abilityScores
        })),
        round: state.round,
        activeTokenId: state.turnOrder[state.currentTurnIndex],
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    });

    // Build response with BOTH text and JSON
    const stateJson = buildStateJson(state, encounterId);
    const formattedText = formatCombatStateText(state);
    
    let output = `⚔️ COMBAT STARTED\n`;
    output += `Encounter ID: ${encounterId}\n`;
    output += formattedText;
    
    // Append JSON for frontend parsing (marked clearly)
    output += `\n\n<!-- STATE_JSON\n${JSON.stringify(stateJson)}\nSTATE_JSON -->`;

    return {
        content: [
            {
                type: 'text' as const,
                text: output
            }
        ]
    };
}

export async function handleGetEncounterState(args: unknown, ctx: SessionContext) {
    const parsed = CombatTools.GET_ENCOUNTER_STATE.inputSchema.parse(args);
    let engine = getCombatManager().get(`${ctx.sessionId}:${parsed.encounterId}`);

    // Auto-load from database if not in memory
    if (!engine) {
        const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
        const repo = new EncounterRepository(db);
        const state = repo.loadState(parsed.encounterId);

        if (!state) {
            throw new Error(`Encounter ${parsed.encounterId} not found.`);
        }

        // Create engine and load state
        engine = new CombatEngine(parsed.encounterId, pubsub || undefined);
        engine.loadState(state);
        getCombatManager().create(`${ctx.sessionId}:${parsed.encounterId}`, engine);
    }

    const state = engine.getState();
    if (!state) {
        throw new Error('No active encounter');
    }

    // CRITICAL FIX: Return JSON for frontend sync, wrapped in content
    // The frontend expects to parse this as JSON
    const stateJson = buildStateJson(state, parsed.encounterId);
    
    // Return the JSON directly - the server will stringify it
    return stateJson;
}

export async function handleExecuteCombatAction(args: unknown, ctx: SessionContext) {
    const parsed = CombatTools.EXECUTE_COMBAT_ACTION.inputSchema.parse(args);
    let engine = getCombatManager().get(`${ctx.sessionId}:${parsed.encounterId}`);

    // Auto-load from database if not in memory
    if (!engine) {
        const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
        const repo = new EncounterRepository(db);
        const state = repo.loadState(parsed.encounterId);

        if (!state) {
            throw new Error(`Encounter ${parsed.encounterId} not found.`);
        }

        engine = new CombatEngine(parsed.encounterId, pubsub || undefined);
        engine.loadState(state);
        getCombatManager().create(`${ctx.sessionId}:${parsed.encounterId}`, engine);
    }

    let result: CombatActionResult | undefined;
    let output = '';

    if (parsed.action === 'attack') {
        if (parsed.attackBonus === undefined || parsed.dc === undefined || parsed.damage === undefined) {
            throw new Error('Attack action requires attackBonus, dc, and damage');
        }
        if (!parsed.targetId) {
            throw new Error('Attack action requires targetId');
        }

        // Use the new detailed attack method with optional damageType for HIGH-002
        result = engine.executeAttack(
            parsed.actorId,
            parsed.targetId,
            parsed.attackBonus,
            parsed.dc,
            parsed.damage,
            parsed.damageType  // HIGH-002: Pass damage type for resistance calculation
        );

        // Check concentration if target took damage and is concentrating
        if (result.success && result.damage && result.damage > 0) {
            const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
            const concentrationRepo = new ConcentrationRepository(db);
            const charRepo = new CharacterRepository(db);
            const targetChar = charRepo.findById(parsed.targetId);

            if (targetChar && concentrationRepo.isConcentrating(parsed.targetId)) {
                const concentrationCheck = checkConcentration(targetChar, result.damage, concentrationRepo);
                if (concentrationCheck.broken) {
                    // Break concentration
                    breakConcentration(
                        { characterId: parsed.targetId, reason: 'damage', damageAmount: result.damage },
                        concentrationRepo,
                        charRepo
                    );
                }
            }
        }

        output = formatAttackResult(result);
        
    } else if (parsed.action === 'heal') {
        if (parsed.amount === undefined) {
            throw new Error('Heal action requires amount');
        }
        if (!parsed.targetId) {
            throw new Error('Heal action requires targetId');
        }

        result = engine.executeHeal(parsed.actorId, parsed.targetId, parsed.amount);
        output = formatHealResult(result);
    } else if (parsed.action === 'disengage') {
        // HIGH-003: Disengage action - prevents opportunity attacks
        const currentState = engine.getState();
        if (!currentState) {
            throw new Error('No combat state');
        }

        const actor = currentState.participants.find(p => p.id === parsed.actorId);
        if (!actor) {
            throw new Error(`Actor ${parsed.actorId} not found`);
        }

        // Mark as disengaged using engine method
        engine.disengage(parsed.actorId);

        output = formatDisengageResult(actor.name);

        // Create result for consistency
        result = {
            type: 'attack', // Placeholder type
            success: true,
            actor: { id: actor.id, name: actor.name },
            target: { id: actor.id, name: actor.name, hpBefore: actor.hp, hpAfter: actor.hp, maxHp: actor.maxHp },
            defeated: false,
            message: `${actor.name} disengages`,
            detailedBreakdown: output
        };
    } else if (parsed.action === 'move') {
        // CRIT-003: Spatial movement with collision checking
        if (!parsed.targetPosition) {
            throw new Error('Move action requires targetPosition');
        }

        const currentState = engine.getState();
        if (!currentState) {
            throw new Error('No combat state');
        }

        const actor = currentState.participants.find(p => p.id === parsed.actorId);
        if (!actor) {
            throw new Error(`Actor ${parsed.actorId} not found`);
        }

        // Get actor's current position
        const actorPos = (actor as any).position;
        if (!actorPos) {
            // No position set - just set the target position directly
            (actor as any).position = parsed.targetPosition;
            output = formatMoveResult(actor.name, undefined, parsed.targetPosition, true, null);
        } else {
            // HIGH-003: Check for opportunity attacks BEFORE moving
            const opportunityAttackers = engine.getOpportunityAttackers(
                parsed.actorId,
                actorPos,
                parsed.targetPosition
            );

            // Execute any triggered opportunity attacks
            let opportunityAttackOutput = '';
            for (const attacker of opportunityAttackers) {
                const oaResult = engine.executeOpportunityAttack(attacker.id, parsed.actorId);
                opportunityAttackOutput += formatOpportunityAttackResult(oaResult) + '\n';

                // If the mover is defeated by an opportunity attack, they can't complete the move
                if (oaResult.defeated) {
                    output = opportunityAttackOutput;
                    output += `\n${actor.name} was defeated while attempting to move and cannot complete the movement!`;
                    result = {
                        type: 'attack',
                        success: false,
                        actor: { id: actor.id, name: actor.name },
                        target: { id: actor.id, name: actor.name, hpBefore: oaResult.target.hpBefore, hpAfter: oaResult.target.hpAfter, maxHp: actor.maxHp },
                        defeated: true,
                        message: `${actor.name} defeated by opportunity attack`,
                        detailedBreakdown: output
                    };
                    // Skip to saving state
                    break;
                }
            }

            // Only continue with move if not defeated
            const updatedActor = currentState.participants.find(p => p.id === parsed.actorId);
            if (updatedActor && updatedActor.hp > 0) {
                // Build obstacle set from other participants and terrain
                const obstacles = new Set<string>();

                // Add other participant positions as obstacles
                for (const p of currentState.participants) {
                    if (p.id !== parsed.actorId && (p as any).position) {
                        const pos = (p as any).position;
                        obstacles.add(`${pos.x},${pos.y}`);
                    }
                }

                // Add terrain obstacles if available
                const terrain = (currentState as any).terrain;
                if (terrain?.obstacles) {
                    for (const obs of terrain.obstacles) {
                        obstacles.add(obs);
                    }
                }

                // Check if destination is blocked
                const destKey = `${parsed.targetPosition.x},${parsed.targetPosition.y}`;
                if (obstacles.has(destKey)) {
                    output = opportunityAttackOutput + formatMoveResult(actor.name, actorPos, parsed.targetPosition, false, 'Destination is blocked');
                } else {
                    // Use spatial engine to find path
                    const spatial = new SpatialEngine();
                    const path = spatial.findPath(
                        { x: actorPos.x, y: actorPos.y },
                        { x: parsed.targetPosition.x, y: parsed.targetPosition.y },
                        obstacles
                    );

                    if (path === null) {
                        // No valid path
                        output = opportunityAttackOutput + formatMoveResult(actor.name, actorPos, parsed.targetPosition, false, 'No valid path - blocked by obstacles');
                    } else {
                        // Move successful - update position
                        (updatedActor as any).position = parsed.targetPosition;
                        output = opportunityAttackOutput + formatMoveResult(actor.name, actorPos, parsed.targetPosition, true, null, path.length - 1);
                    }
                }

                // Create result for consistency
                result = {
                    type: 'attack',
                    success: output.includes('moved'),
                    actor: { id: actor.id, name: actor.name },
                    target: { id: actor.id, name: actor.name, hpBefore: actor.hp, hpAfter: updatedActor.hp, maxHp: actor.maxHp },
                    defeated: updatedActor.hp <= 0,
                    message: output.includes('moved') ? `${actor.name} moved` : `${actor.name} could not move`,
                    detailedBreakdown: output
                };
            }
        }

        // Create dummy result if not set (for the case where no position was set initially)
        if (!result) {
            result = {
                type: 'attack',
                success: output.includes('moved') || output.includes('placed'),
                actor: { id: actor.id, name: actor.name },
                target: { id: actor.id, name: actor.name, hpBefore: actor.hp, hpAfter: actor.hp, maxHp: actor.maxHp },
                defeated: false,
                message: `${actor.name} moved`,
                detailedBreakdown: output
            };
        }
    } else if (parsed.action === 'cast_spell') {
        // CRIT-006: Validated spell casting - prevents LLM hallucination
        if (!parsed.spellName) {
            throw new Error('cast_spell action requires spellName');
        }

        // CRIT-006: Block raw damage parameter for spell casting
        if (parsed.damage !== undefined) {
            throw new Error('damage parameter not allowed for cast_spell - damage is calculated from spell');
        }

        const currentState = engine.getState();
        if (!currentState) {
            throw new Error('No combat state');
        }

        const actor = currentState.participants.find(p => p.id === parsed.actorId);
        if (!actor) {
            throw new Error(`Actor ${parsed.actorId} not found`);
        }

        // Load character data for spellcasting validation
        const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
        const charRepo = new CharacterRepository(db);
        let casterChar: Character | null = null;

        try {
            casterChar = charRepo.findById(parsed.actorId);
        } catch {
            // Character might not exist in DB (e.g., test setup)
            // Create minimal character for validation
        }

        // If no character record, create minimal one from participant data
        if (!casterChar) {
            // This is a fallback - ideally all casters are in the character table
            throw new Error(`Character ${parsed.actorId} not found in database. Spellcasting requires a character record with class and spell slots.`);
        }

        // Validate spell cast (CRIT-006 core validation)
        const validation = validateSpellCast(casterChar, parsed.spellName, parsed.slotLevel);

        if (!validation.valid) {
            throw new Error(validation.error?.message || 'Invalid spell cast');
        }

        // Spell is valid - resolve effects
        const spell = validation.spell!;
        const effectiveSlotLevel = validation.effectiveSlotLevel || spell.level;

        // Get target for damage/effects
        let target = currentState.participants.find(p => p.id === parsed.targetId);
        const targetHpBefore = target?.hp || 0;

        // Resolve spell effects
        const resolution = resolveSpell(spell, casterChar, effectiveSlotLevel, {
            targetAC: target ? (target as any).ac || 10 : 10
        });

        // Apply damage/healing to target
        if (resolution.damage && resolution.damage > 0 && target) {
            const damageType = resolution.damageType || 'force';

            // Use engine to apply damage (handles resistances/immunities)
            engine.executeAttack(
                parsed.actorId,
                parsed.targetId!,
                100, // Auto-hit for spell damage
                0,   // DC doesn't matter
                resolution.damage,
                damageType
            );

            target = currentState.participants.find(p => p.id === parsed.targetId);

            // Check concentration if target is concentrating
            if (target) {
                const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
                const concentrationRepo = new ConcentrationRepository(db);
                const targetChar = charRepo.findById(parsed.targetId!);

                if (targetChar && concentrationRepo.isConcentrating(parsed.targetId!)) {
                    const concentrationCheck = checkConcentration(targetChar, resolution.damage, concentrationRepo);
                    if (concentrationCheck.broken) {
                        // Break concentration
                        breakConcentration(
                            { characterId: parsed.targetId!, reason: 'damage', damageAmount: resolution.damage },
                            concentrationRepo,
                            charRepo
                        );
                    }
                }
            }
        }

        if (resolution.healing && resolution.healing > 0 && target) {
            engine.executeHeal(parsed.actorId, parsed.targetId!, resolution.healing);
            target = currentState.participants.find(p => p.id === parsed.targetId);
        }

        // Consume spell slot (if not cantrip)
        if (effectiveSlotLevel > 0) {
            const updatedChar = consumeSpellSlot(casterChar, effectiveSlotLevel);
            charRepo.update(casterChar.id, updatedChar);
        }

        // Handle concentration
        if (spell.concentration) {
            const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
            const concentrationRepo = new ConcentrationRepository(db);
            const currentState = engine.getState();

            // Parse duration from spell (e.g., "Concentration, up to 1 minute")
            let maxDuration: number | undefined;
            const durationMatch = spell.duration.match(/(\d+)\s+(minute|hour)/i);
            if (durationMatch) {
                const value = parseInt(durationMatch[1]);
                const unit = durationMatch[2].toLowerCase();
                // Convert to rounds (1 round = 6 seconds)
                if (unit === 'minute') {
                    maxDuration = value * 10; // 1 minute = 10 rounds
                } else if (unit === 'hour') {
                    maxDuration = value * 600; // 1 hour = 600 rounds
                }
            }

            // Start concentration
            startConcentration(
                casterChar.id,
                spell.name,
                effectiveSlotLevel,
                currentState?.round || 1,
                maxDuration,
                parsed.targetId ? [parsed.targetId] : undefined,
                concentrationRepo,
                charRepo
            );
        }

        // Format output with SPELL tag for test parsing
        output = formatSpellCastResult(actor.name, resolution, target, targetHpBefore);
        output += `\n[SPELL: ${spell.name}, SLOT: ${effectiveSlotLevel > 0 ? effectiveSlotLevel : 'cantrip'}, DMG: ${resolution.damage || 0}, HEAL: ${resolution.healing || 0}]`;

        // Create result
        result = {
            type: 'attack',
            success: resolution.success,
            actor: { id: actor.id, name: actor.name },
            target: target ? {
                id: target.id,
                name: target.name,
                hpBefore: targetHpBefore,
                hpAfter: target.hp,
                maxHp: target.maxHp
            } : { id: 'none', name: 'none', hpBefore: 0, hpAfter: 0, maxHp: 0 },
            defeated: target ? target.hp <= 0 : false,
            message: `${actor.name} cast ${spell.name}`,
            // CRIT-006: Include spell damage/healing in result for testing and frontend
            damage: resolution.damage,
            healAmount: resolution.healing,
            detailedBreakdown: output
        };
    } else {
        throw new Error(`Unknown action: ${parsed.action}`);
    }

    // Save state
    const state = engine.getState();
    if (state) {
        const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
        const repo = new EncounterRepository(db);
        repo.saveState(parsed.encounterId, state);
        
        // Append current state JSON for frontend
        const stateJson = buildStateJson(state, parsed.encounterId);
        output += `\n\n<!-- STATE_JSON\n${JSON.stringify(stateJson)}\nSTATE_JSON -->`;
    }

    return {
        content: [
            {
                type: 'text' as const,
                text: output
            }
        ]
    };
}

export async function handleAdvanceTurn(args: unknown, ctx: SessionContext) {
    const parsed = CombatTools.ADVANCE_TURN.inputSchema.parse(args);
    let engine = getCombatManager().get(`${ctx.sessionId}:${parsed.encounterId}`);

    // Auto-load from database if not in memory
    if (!engine) {
        const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
        const repo = new EncounterRepository(db);
        const state = repo.loadState(parsed.encounterId);

        if (!state) {
            throw new Error(`Encounter ${parsed.encounterId} not found.`);
        }

        engine = new CombatEngine(parsed.encounterId, pubsub || undefined);
        engine.loadState(state);
        getCombatManager().create(`${ctx.sessionId}:${parsed.encounterId}`, engine);
    }

    const previousParticipant = engine.getCurrentParticipant();
    engine.nextTurnWithConditions();
    const state = engine.getState();

    // Save state
    if (state) {
        const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
        const repo = new EncounterRepository(db);
        repo.saveState(parsed.encounterId, state);
    }

    let output = `\n⏭️ TURN ENDED: ${previousParticipant?.name}\n`;
    output += state ? formatCombatStateText(state) : 'No combat state';
    
    // Append JSON for frontend
    if (state) {
        const stateJson = buildStateJson(state, parsed.encounterId);
        output += `\n\n<!-- STATE_JSON\n${JSON.stringify(stateJson)}\nSTATE_JSON -->`;
    }

    return {
        content: [
            {
                type: 'text' as const,
                text: output
            }
        ]
    };
}

export async function handleEndEncounter(args: unknown, ctx: SessionContext) {
    const parsed = CombatTools.END_ENCOUNTER.inputSchema.parse(args);
    const namespacedId = `${ctx.sessionId}:${parsed.encounterId}`;

    // Get the engine BEFORE deleting to access final state
    const engine = getCombatManager().get(namespacedId);

    if (!engine) {
        throw new Error(`Encounter ${parsed.encounterId} not found.`);
    }

    const finalState = engine.getState();

    // CRIT-001 FIX: Sync HP changes back to character records
    const syncResults: { id: string; name: string; hp: number; synced: boolean }[] = [];

    if (finalState) {
        const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
        const { CharacterRepository } = await import('../storage/repos/character.repo.js');
        const charRepo = new CharacterRepository(db);

        for (const participant of finalState.participants) {
            // Try to find this participant in the character database
            const character = charRepo.findById(participant.id);

            if (character) {
                // Sync HP back to character record
                charRepo.update(participant.id, { hp: participant.hp });
                syncResults.push({
                    id: participant.id,
                    name: participant.name,
                    hp: participant.hp,
                    synced: true
                });
            } else {
                // Ad-hoc participant (not in DB) - skip silently
                syncResults.push({
                    id: participant.id,
                    name: participant.name,
                    hp: participant.hp,
                    synced: false
                });
            }
        }
    }

    // Now delete the encounter from memory
    getCombatManager().delete(namespacedId);

    // Build response with sync information
    let output = `\n🏁 COMBAT ENDED\nEncounter ID: ${parsed.encounterId}\n\n`;

    const syncedChars = syncResults.filter(r => r.synced);
    if (syncedChars.length > 0) {
        output += `📊 Character HP Synced:\n`;
        for (const char of syncedChars) {
            output += `   • ${char.name}: ${char.hp} HP\n`;
        }
    }

    output += `\nAll combatants have been removed from the battlefield.`;

    return {
        content: [
            {
                type: 'text' as const,
                text: output
            }
        ]
    };
}

export async function handleLoadEncounter(args: unknown, ctx: SessionContext) {
    const parsed = CombatTools.LOAD_ENCOUNTER.inputSchema.parse(args);
    const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
    const repo = new EncounterRepository(db);

    const state = repo.loadState(parsed.encounterId);
    if (!state) {
        throw new Error(`Encounter ${parsed.encounterId} not found in database.`);
    }

    // Create engine and load state
    const engine = new CombatEngine(parsed.encounterId, pubsub || undefined);
    engine.loadState(state);

    getCombatManager().create(`${ctx.sessionId}:${parsed.encounterId}`, engine);

    const stateJson = buildStateJson(state, parsed.encounterId);
    let output = `📥 ENCOUNTER LOADED\nEncounter ID: ${parsed.encounterId}\n`;
    output += formatCombatStateText(state);
    output += `\n\n<!-- STATE_JSON\n${JSON.stringify(stateJson)}\nSTATE_JSON -->`;

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

/**
 * MED-003: Roll a death saving throw for a character at 0 HP
 */
export async function handleRollDeathSave(args: unknown, ctx: SessionContext) {
    const parsed = CombatTools.ROLL_DEATH_SAVE.inputSchema.parse(args);
    const engine = getCombatManager().get(`${ctx.sessionId}:${parsed.encounterId}`);

    if (!engine) {
        throw new Error(`No active encounter with ID ${parsed.encounterId}`);
    }

    const state = engine.getState();
    if (!state) {
        throw new Error('Encounter has no active state');
    }

    const participant = state.participants.find(p => p.id === parsed.characterId);
    if (!participant) {
        throw new Error(`Participant ${parsed.characterId} not found in encounter`);
    }

    // Validate state
    if (participant.hp > 0) {
        throw new Error(`${participant.name} is not at 0 HP and cannot make death saving throws`);
    }

    if (participant.isDead) {
        throw new Error(`${participant.name} is already dead`);
    }

    if (participant.isStabilized) {
        return {
            content: [{
                type: 'text' as const,
                text: `${participant.name} is already stabilized and does not need to make death saving throws.`
            }]
        };
    }

    // Roll the death save
    const result = engine.rollDeathSave(parsed.characterId);

    if (!result) {
        throw new Error('Failed to roll death save');
    }

    // Build output
    let output = `\n┌─────────────────────────────────────────┐\n`;
    output += `│ 💀 DEATH SAVING THROW\n`;
    output += `└─────────────────────────────────────────┘\n\n`;
    output += `${participant.name} makes a death saving throw...\n\n`;

    output += `🎲 Roll: d20 = ${result.roll}`;

    if (result.isNat20) {
        output += ` ⭐ NATURAL 20!\n\n`;
        output += `✨ ${participant.name} regains 1 HP and is conscious again!\n`;
    } else if (result.isNat1) {
        output += ` 💥 NATURAL 1! (Counts as 2 failures)\n\n`;
    } else if (result.success) {
        output += ` ✓ SUCCESS (10+)\n\n`;
    } else {
        output += ` ✗ FAILURE (9 or less)\n\n`;
    }

    // Status summary
    const successMarkers = '●'.repeat(result.successes) + '○'.repeat(3 - result.successes);
    const failureMarkers = '●'.repeat(result.failures) + '○'.repeat(3 - result.failures);

    output += `Successes: [${successMarkers}] ${result.successes}/3\n`;
    output += `Failures:  [${failureMarkers}] ${result.failures}/3\n\n`;

    if (result.isStabilized) {
        output += `🛡️ ${participant.name} is STABILIZED! (Unconscious but no longer dying)\n`;
    } else if (result.isDead) {
        output += `☠️ ${participant.name} has DIED!\n`;
    }

    // Save state
    const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
    const repo = new EncounterRepository(db);
    repo.saveState(parsed.encounterId, engine.getState()!);

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

/**
 * HIGH-006: Execute a lair action on initiative 20
 */
export async function handleExecuteLairAction(args: unknown, ctx: SessionContext) {
    const parsed = CombatTools.EXECUTE_LAIR_ACTION.inputSchema.parse(args);
    const engine = getCombatManager().get(`${ctx.sessionId}:${parsed.encounterId}`);

    if (!engine) {
        throw new Error(`No active encounter with ID ${parsed.encounterId}`);
    }

    const state = engine.getState();
    if (!state) {
        throw new Error('Encounter has no active state');
    }

    // Validate it's the lair's turn
    if (!engine.isLairActionPending()) {
        throw new Error('Cannot execute lair action: it is not the lair\'s turn (initiative 20)');
    }

    let output = `\n┌─────────────────────────────────────────┐\n`;
    output += `│ 🏰 LAIR ACTION (Initiative 20)\n`;
    output += `└─────────────────────────────────────────┘\n\n`;
    output += `${parsed.actionDescription}\n\n`;

    const results: Array<{
        targetId: string;
        targetName: string;
        saveRoll?: number;
        saveTotal?: number;
        saved: boolean;
        damageTaken: number;
    }> = [];

    // Apply damage to targets if specified
    if (parsed.targetIds && parsed.targetIds.length > 0 && parsed.damage) {
        for (const targetId of parsed.targetIds) {
            const target = state.participants.find(p => p.id === targetId);
            if (!target) {
                output += `⚠️ Target ${targetId} not found in encounter\n`;
                continue;
            }

            let damageTaken = parsed.damage;
            let saved = false;
            let saveRoll: number | undefined;
            let saveTotal: number | undefined;

            // Handle saving throw if specified
            if (parsed.savingThrow) {
                // Roll saving throw
                saveRoll = Math.floor(Math.random() * 20) + 1;
                const abilityScore = target.abilityScores?.[parsed.savingThrow.ability] ?? 10;
                const modifier = Math.floor((abilityScore - 10) / 2);
                saveTotal = saveRoll + modifier;
                saved = saveTotal >= parsed.savingThrow.dc;

                if (saved && parsed.halfDamageOnSave) {
                    damageTaken = Math.floor(parsed.damage / 2);
                } else if (saved) {
                    damageTaken = 0;
                }
            }

            // Apply damage (considering resistances/immunities/vulnerabilities)
            const damageType = parsed.damageType?.toLowerCase() || 'untyped';
            if (target.immunities?.includes(damageType)) {
                damageTaken = 0;
            } else if (target.resistances?.includes(damageType)) {
                damageTaken = Math.floor(damageTaken / 2);
            } else if (target.vulnerabilities?.includes(damageType)) {
                damageTaken = damageTaken * 2;
            }

            // Deal damage via engine
            if (damageTaken > 0) {
                engine.applyDamage(targetId, damageTaken);
            }

            results.push({
                targetId,
                targetName: target.name,
                saveRoll,
                saveTotal,
                saved,
                damageTaken
            });

            // Format result
            output += `🎯 ${target.name}`;
            if (parsed.savingThrow) {
                const saveAbility = parsed.savingThrow.ability.charAt(0).toUpperCase() + parsed.savingThrow.ability.slice(1);
                output += ` - ${saveAbility} Save: ${saveRoll} + ${Math.floor(((target.abilityScores?.[parsed.savingThrow.ability] ?? 10) - 10) / 2)} = ${saveTotal} vs DC ${parsed.savingThrow.dc}`;
                output += saved ? ' ✓ SAVED' : ' ✗ FAILED';
            }
            output += `\n`;
            output += `   Damage: ${damageTaken}${parsed.damageType ? ` ${parsed.damageType}` : ''}\n`;

            const updatedTarget = engine.getState()!.participants.find(p => p.id === targetId);
            if (updatedTarget) {
                output += `   HP: ${updatedTarget.hp}/${updatedTarget.maxHp}`;
                if (updatedTarget.hp <= 0) {
                    output += ' 💀 DEFEATED';
                }
                output += '\n';
            }
        }
    } else {
        output += `(No mechanical effect - narrative only)\n`;
    }

    output += `\n→ Call advance_turn to proceed to the next combatant`;

    // Save state
    const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
    const repo = new EncounterRepository(db);
    repo.saveState(parsed.encounterId, engine.getState()!);

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

// Helper for tests
export function clearCombatState() {
    // No-op or clear manager
}
