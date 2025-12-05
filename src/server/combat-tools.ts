import { z } from 'zod';
import { CombatEngine, CombatParticipant, CombatState, CombatActionResult } from '../engine/combat/engine.js';

import { PubSub } from '../engine/pubsub.js';

import { getCombatManager } from './state/combat-manager.js';
import { getDb } from '../storage/index.js';
import { EncounterRepository } from '../storage/repos/encounter.repo.js';
import { SessionContext } from './types.js';

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
        }))
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
                conditions: z.array(z.any()).default([])
            })).min(1)
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
        description: `Execute a combat action (attack, heal, etc.).

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
}`,
        inputSchema: z.object({
            encounterId: z.string().describe('The ID of the encounter'),
            action: z.enum(['attack', 'heal']),
            actorId: z.string(),
            targetId: z.string(),
            attackBonus: z.number().int().optional(),
            dc: z.number().int().optional(),
            damage: z.number().int().optional(),
            amount: z.number().int().optional()
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
    }
} as const;

// Tool handlers
export async function handleCreateEncounter(args: unknown, ctx: SessionContext) {
    const parsed = CombatTools.CREATE_ENCOUNTER.inputSchema.parse(args);

    // Create combat engine
    const engine = new CombatEngine(parsed.seed, pubsub || undefined);

    // Convert participants to proper format (preserve isEnemy if provided)
    const participants: CombatParticipant[] = parsed.participants.map(p => ({
        id: p.id,
        name: p.name,
        initiativeBonus: p.initiativeBonus,
        hp: p.hp,
        maxHp: p.maxHp,
        isEnemy: p.isEnemy,  // Will be auto-detected in startEncounter if undefined
        conditions: []
    }));

    // Start encounter
    const state = engine.startEncounter(participants);

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

    let result: CombatActionResult;
    let output = '';

    if (parsed.action === 'attack') {
        if (parsed.attackBonus === undefined || parsed.dc === undefined || parsed.damage === undefined) {
            throw new Error('Attack action requires attackBonus, dc, and damage');
        }

        // Use the new detailed attack method
        result = engine.executeAttack(
            parsed.actorId,
            parsed.targetId,
            parsed.attackBonus,
            parsed.dc,
            parsed.damage
        );

        output = formatAttackResult(result);
        
    } else if (parsed.action === 'heal') {
        if (parsed.amount === undefined) {
            throw new Error('Heal action requires amount');
        }

        result = engine.executeHeal(parsed.actorId, parsed.targetId, parsed.amount);
        output = formatHealResult(result);
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

// Helper for tests
export function clearCombatState() {
    // No-op or clear manager
}
