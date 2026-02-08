/**
 * TDD Tests for Combat Tool LLM Interactions
 * 
 * These tests emulate what LLMs will try to do when using combat tools.
 * Based on the tool instructions, we anticipate common patterns and edge cases.
 * 
 * The goal is to ensure the game handles LLM tool calls gracefully,
 * even when they don't follow the optimal format.
 */

import { v4 as uuid } from 'uuid';

// Core imports
import { CharacterRepository } from '../../src/storage/repos/character.repo.js';
import { 
    handleCreateEncounter,
    handleGetEncounterState,
    handleExecuteCombatAction,
    handleAdvanceTurn,
    handleEndEncounter,
    clearCombatState
} from '../../src/server/handlers/combat-handlers.js';
import { closeDb, getDb } from '../../src/storage/index.js';
import { getInitialSpellSlots, getMaxSpellLevel } from '../../src/engine/magic/spell-validator.js';
import type { CharacterClass } from '../../src/schema/spell.js';

// Test utilities
let charRepo: CharacterRepository;
const TEST_SESSION_ID = 'llm-test-session';

function getTestContext() {
    return { sessionId: TEST_SESSION_ID };
}

beforeEach(() => {
    closeDb();
    const db = getDb(':memory:');
    clearCombatState();
    charRepo = new CharacterRepository(db);
});

afterEach(() => {
    closeDb();
});

// ============================================================================
// HELPER FUNCTIONS (adapted from spellcasting tests)
// ============================================================================

interface CharacterOptions {
    id?: string;
    name?: string;
    stats?: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
    hp?: number;
    maxHp?: number;
    ac?: number;
    level?: number;
    characterClass?: string;
    knownSpells?: string[];
    preparedSpells?: string[];
    cantripsKnown?: string[];
    spellSlots?: Record<string, { current: number; max: number }>;
    position?: { x: number; y: number };
}

async function createTestCharacter(overrides: CharacterOptions = {}) {
    const defaults: CharacterOptions = {
        id: uuid(),
        name: 'Test Character',
        stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
        hp: 20,
        maxHp: 20,
        ac: 10,
        level: 1,
        characterClass: 'fighter',
    };
    const merged = { ...defaults, ...overrides };
    const charClass = (merged.characterClass || 'fighter') as CharacterClass;
    const maxSpellLevel = getMaxSpellLevel(charClass, merged.level || 1);

    charRepo.create({
        id: merged.id!,
        name: merged.name!,
        stats: merged.stats!,
        hp: merged.hp!,
        maxHp: merged.maxHp!,
        ac: merged.ac!,
        level: merged.level!,
        characterClass: charClass,
        knownSpells: merged.knownSpells || [],
        preparedSpells: merged.preparedSpells || [],
        cantripsKnown: merged.cantripsKnown || [],
        spellSlots: merged.spellSlots,
        maxSpellLevel,
        conditions: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    } as any);

    return merged;
}

async function createWizard(level: number, overrides: CharacterOptions = {}) {
    const defaultKnownSpells = overrides.knownSpells || ['Magic Missile', 'Shield', 'Fireball'];
    const defaultPreparedSpells = overrides.preparedSpells || defaultKnownSpells;

    return createTestCharacter({
        name: `Wizard L${level}`,
        characterClass: 'wizard',
        level,
        stats: { str: 8, dex: 14, con: 12, int: 18, wis: 10, cha: 10 },
        knownSpells: defaultKnownSpells,
        preparedSpells: defaultPreparedSpells,
        cantripsKnown: overrides.cantripsKnown || ['Fire Bolt'],
        spellSlots: getInitialSpellSlots('wizard' as CharacterClass, level),
        ...overrides
    });
}

// Helper to extract JSON state from combat tool responses
function extractStateJson(responseText: string): any {
    const match = responseText.match(/<!-- STATE_JSON\n([\s\S]*?)\nSTATE_JSON -->/);
    if (match && match[1]) {
        return JSON.parse(match[1]);
    }
    return null;
}

// Extract encounter ID from create_encounter response
function extractEncounterId(responseText: string): string {
    const match = responseText.match(/Encounter ID: (encounter-[^\n]+)/);
    if (!match) {
        throw new Error(`Could not extract encounter ID from response: ${responseText.substring(0, 100)}`);
    }
    return match[1];
}

// ============================================================
// SCENARIO 1: LLM AoE Spell Casting Patterns
// Anticipating how LLMs format multi-target spells
// ============================================================
describe('LLM AoE Spell Casting Patterns', () => {
    
    it('should accept comma-separated targetId string for AoE spells', async () => {
        /**
         * ANTICIPATED LLM BEHAVIOR:
         * LLMs often format multiple targets as: "goblin-1,goblin-2,goblin-3"
         * instead of using the targetIds array parameter.
         * 
         * ROBUST CONSIDERATION:
         * Parse comma-separated strings and treat as multiple targets.
         */
        const wizard = await createWizard(5, { 
            id: 'wizard-aoe-1',
            knownSpells: ['Fireball'] 
        });
        
        const createResult = await handleCreateEncounter({
            seed: `aoe-comma-test-${uuid()}`,
            participants: [
                { id: wizard.id!, name: 'Wizard', hp: 25, maxHp: 25, initiativeBonus: 10, isEnemy: false },
                { id: 'goblin-1', name: 'Goblin A', hp: 7, maxHp: 7, initiativeBonus: 0, isEnemy: true, position: { x: 5, y: 5 } },
                { id: 'goblin-2', name: 'Goblin B', hp: 7, maxHp: 7, initiativeBonus: 0, isEnemy: true, position: { x: 6, y: 5 } },
            ]
        }, getTestContext() as any);
        
        const encounterId = extractEncounterId(createResult.content[0].text);

        // Cast Fireball with comma-separated targets (LLM pattern)
        const result = await handleExecuteCombatAction({
            encounterId,
            action: 'cast_spell',
            actorId: wizard.id!,
            targetId: 'goblin-1,goblin-2',  // Comma-separated
            spellName: 'Fireball',
            slotLevel: 3,
            dc: 14
        }, getTestContext() as any);

        const text = result.content[0].text;
        // Should damage both goblins
        expect(text).toMatch(/Goblin A|goblin-1/i);
        expect(text).toMatch(/Goblin B|goblin-2/i);
    });

    it('should accept targetIds array for AoE spells', async () => {
        /**
         * OPTIMAL FORMAT:
         * Tool instructions specify targetIds as an array.
         * This tests the happy path.
         */
        const wizard = await createWizard(5, { 
            id: 'wizard-aoe-2',
            knownSpells: ['Fireball'] 
        });
        
        const createResult = await handleCreateEncounter({
            seed: `aoe-array-test-${uuid()}`,
            participants: [
                { id: wizard.id!, name: 'Wizard', hp: 25, maxHp: 25, initiativeBonus: 10, isEnemy: false },
                { id: 'orc-1', name: 'Orc A', hp: 15, maxHp: 15, initiativeBonus: 0, isEnemy: true },
                { id: 'orc-2', name: 'Orc B', hp: 15, maxHp: 15, initiativeBonus: 0, isEnemy: true },
            ]
        }, getTestContext() as any);
        
        const encounterId = extractEncounterId(createResult.content[0].text);

        const result = await handleExecuteCombatAction({
            encounterId,
            action: 'cast_spell',
            actorId: wizard.id!,
            targetIds: ['orc-1', 'orc-2'],  // Array format
            spellName: 'Fireball',
            slotLevel: 3,
            dc: 14
        }, getTestContext() as any);

        const text = result.content[0].text;
        expect(text).toMatch(/Orc A|orc-1/i);
        expect(text).toMatch(/Orc B|orc-2/i);
    });

    it('should allow damage: 0 parameter (LLMs often include defaults)', async () => {
        /**
         * ANTICIPATED LLM BEHAVIOR:
         * LLMs often include all optional parameters with default values.
         * damage: 0 should be ignored for spells (spell calculates its own damage).
         * 
         * ROBUST CONSIDERATION:
         * Only reject damage > 0 for cast_spell, allow 0.
         */
        const wizard = await createWizard(1, { 
            id: 'wizard-damage-0',
            knownSpells: ['Magic Missile'] 
        });
        
        const createResult = await handleCreateEncounter({
            seed: `damage-zero-test-${uuid()}`,
            participants: [
                { id: wizard.id!, name: 'Wizard', hp: 20, maxHp: 20, initiativeBonus: 10, isEnemy: false },
                { id: 'dummy', name: 'Dummy', hp: 100, maxHp: 100, initiativeBonus: 0, isEnemy: true },
            ]
        }, getTestContext() as any);
        
        const encounterId = extractEncounterId(createResult.content[0].text);

        // LLM sends damage: 0 (should be ignored, not rejected)
        const result = await handleExecuteCombatAction({
            encounterId,
            action: 'cast_spell',
            actorId: wizard.id!,
            targetId: 'dummy',
            spellName: 'Magic Missile',
            slotLevel: 1,
            dc: 10,
            damage: 0,      // Should be ignored
            damageType: ''  // Also common
        }, getTestContext() as any);

        // Should not throw - spell should cast successfully
        expect(result.content[0].text).not.toContain('damage parameter not allowed');
        expect(result.content[0].text).toContain('Magic Missile');
    });

    it('should reject damage > 0 for cast_spell (anti-hallucination)', async () => {
        /**
         * SECURITY CONSIDERATION:
         * LLMs might try to hallucinate damage values.
         * Reject non-zero damage for cast_spell action.
         */
        const wizard = await createWizard(5, { 
            id: 'wizard-damage-reject',
            knownSpells: ['Fireball'] 
        });
        
        const createResult = await handleCreateEncounter({
            seed: `damage-reject-test-${uuid()}`,
            participants: [
                { id: wizard.id!, name: 'Wizard', hp: 25, maxHp: 25, initiativeBonus: 10, isEnemy: false },
                { id: 'target', name: 'Target', hp: 50, maxHp: 50, initiativeBonus: 0, isEnemy: true },
            ]
        }, getTestContext() as any);
        
        const encounterId = extractEncounterId(createResult.content[0].text);

        await expect(handleExecuteCombatAction({
            encounterId,
            action: 'cast_spell',
            actorId: wizard.id!,
            targetId: 'target',
            spellName: 'Fireball',
            slotLevel: 3,
            dc: 14,
            damage: 999  // LLM hallucinating massive damage
        }, getTestContext() as any)).rejects.toThrow(/damage parameter not allowed/i);
    });
});

// ============================================================
// SCENARIO 2: Dead Creature Turn Skipping
// Backend should auto-skip, frontend should not spam
// ============================================================
describe('Dead Creature Turn Skipping', () => {

    it('should skip dead creatures automatically on advance_turn', async () => {
        /**
         * EXPECTED BEHAVIOR:
         * When a creature dies, their turn should be skipped automatically.
         * 
         * ROBUST CONSIDERATION:
         * Backend's nextTurnWithConditions() checks HP <= 0 and skips.
         */
        const fighter = await createTestCharacter({
            id: 'fighter-skip-test',
            name: 'Fighter',
            hp: 50,
            maxHp: 50,
            characterClass: 'fighter',
            level: 5
        });
        
        const createResult = await handleCreateEncounter({
            seed: `skip-dead-test-${uuid()}`,
            participants: [
                { id: fighter.id!, name: 'Fighter', hp: 50, maxHp: 50, initiativeBonus: 20, isEnemy: false },
                { id: 'goblin-weak', name: 'Weak Goblin', hp: 7, maxHp: 7, initiativeBonus: 10, isEnemy: true },
                { id: 'orc-tough', name: 'Tough Orc', hp: 30, maxHp: 30, initiativeBonus: 5, isEnemy: true },
            ]
        }, getTestContext() as any);
        
        const encounterId = extractEncounterId(createResult.content[0].text);

        // Kill the weak goblin
        await handleExecuteCombatAction({
            encounterId,
            action: 'attack',
            actorId: fighter.id!,
            targetId: 'goblin-weak',
            attackBonus: 20,  // Guaranteed hit
            damage: 100,      // Overkill
            dc: 10
        }, getTestContext() as any);

        // Advance turn - should skip dead goblin, go to orc
        const result = await handleAdvanceTurn({ encounterId }, getTestContext() as any);
        const state = extractStateJson(result.content[0].text);

        // Current turn should NOT be the dead goblin
        expect(state.currentTurn.id).not.toBe('goblin-weak');
        expect(state.currentTurn.name).not.toBe('Weak Goblin');
    });

    it('should handle all enemies dying gracefully (no infinite loop)', async () => {
        /**
         * EDGE CASE:
         * If all enemies die, combat should continue without crash.
         * 
         * ROBUST CONSIDERATION:
         * Backend has maxIterations safety limit to prevent infinite loops.
         */
        const fighter = await createTestCharacter({
            id: 'fighter-kill-all',
            name: 'Fighter',
            hp: 50,
            maxHp: 50,
            characterClass: 'fighter',
            level: 5
        });
        
        const createResult = await handleCreateEncounter({
            seed: `kill-all-test-${uuid()}`,
            participants: [
                { id: fighter.id!, name: 'Fighter', hp: 50, maxHp: 50, initiativeBonus: 20, isEnemy: false },
                { id: 'minion-1', name: 'Minion 1', hp: 1, maxHp: 1, initiativeBonus: 5, isEnemy: true },
                { id: 'minion-2', name: 'Minion 2', hp: 1, maxHp: 1, initiativeBonus: 4, isEnemy: true },
            ]
        }, getTestContext() as any);
        
        const encounterId = extractEncounterId(createResult.content[0].text);

        // Kill first minion
        await handleExecuteCombatAction({
            encounterId,
            action: 'attack',
            actorId: fighter.id!,
            targetId: 'minion-1',
            attackBonus: 20,
            damage: 100,
            dc: 10
        }, getTestContext() as any);

        // Advance to next round (need to go through full cycle)
        await handleAdvanceTurn({ encounterId }, getTestContext() as any);
        await handleAdvanceTurn({ encounterId }, getTestContext() as any);

        // Kill second minion
        await handleExecuteCombatAction({
            encounterId,
            action: 'attack',
            actorId: fighter.id!,
            targetId: 'minion-2',
            attackBonus: 20,
            damage: 100,
            dc: 10
        }, getTestContext() as any);

        // Advance turn - should not crash even though all enemies dead
        const result = await handleAdvanceTurn({ encounterId }, getTestContext() as any);
        expect(result.content[0].text).toBeDefined();
        
        // State should show fighter as current (only one alive)
        const state = extractStateJson(result.content[0].text);
        expect(state).toBeDefined();
    });
});

// ============================================================
// SCENARIO 3: LLM Turn Inquiry Patterns
// User asks "Who's turn is it?" - LLM calls get_encounter_state
// ============================================================
describe('LLM Turn Inquiry Patterns', () => {

    it('should return current turn info in get_encounter_state', async () => {
        /**
         * ANTICIPATED LLM BEHAVIOR:
         * LLM will call get_encounter_state to figure out whose turn it is.
         * 
         * ROBUST CONSIDERATION:
         * Response must include currentTurn with id and name.
         */
        const hero = await createTestCharacter({
            id: 'hero-inquiry',
            name: 'Hero',
            hp: 30,
            maxHp: 30
        });
        
        const createResult = await handleCreateEncounter({
            seed: `inquiry-test-${uuid()}`,
            participants: [
                { id: hero.id!, name: 'Hero', hp: 30, maxHp: 30, initiativeBonus: 10, isEnemy: false },
                { id: 'villain', name: 'Villain', hp: 20, maxHp: 20, initiativeBonus: 5, isEnemy: true },
            ]
        }, getTestContext() as any);
        
        const encounterId = extractEncounterId(createResult.content[0].text);

        const result = await handleGetEncounterState({ encounterId }, getTestContext() as any);
        const state = extractStateJson(result.content[0].text);

        expect(state).toBeDefined();
        expect(state.currentTurn).toBeDefined();
        expect(state.currentTurn.name).toBeDefined();
        expect(state.currentTurn.id).toBeDefined();
        expect(state.round).toBeGreaterThanOrEqual(1);
    });

    it('should show HP updates after damage in get_encounter_state', async () => {
        /**
         * EXPECTED BEHAVIOR:
         * After dealing damage, get_encounter_state should show updated HP.
         * No stale values allowed.
         */
        const hero = await createTestCharacter({
            id: 'hero-hp-sync',
            name: 'Hero',
            hp: 30,
            maxHp: 30
        });
        
        const createResult = await handleCreateEncounter({
            seed: `hp-sync-test-${uuid()}`,
            participants: [
                { id: hero.id!, name: 'Hero', hp: 30, maxHp: 30, initiativeBonus: 10, isEnemy: false },
                { id: 'enemy-1', name: 'Enemy', hp: 20, maxHp: 20, initiativeBonus: 5, isEnemy: true },
            ]
        }, getTestContext() as any);
        
        const encounterId = extractEncounterId(createResult.content[0].text);

        // Deal damage
        await handleExecuteCombatAction({
            encounterId,
            action: 'attack',
            actorId: hero.id!,
            targetId: 'enemy-1',
            attackBonus: 20,
            damage: 10,
            dc: 10
        }, getTestContext() as any);

        // Get state
        const result = await handleGetEncounterState({ encounterId }, getTestContext() as any);
        const state = extractStateJson(result.content[0].text);

        const enemy = state.participants.find((p: any) => p.id === 'enemy-1');
        expect(enemy.hp).toBeLessThan(enemy.maxHp);
    });
});

// ============================================================
// SCENARIO 4: Chat Output Expectations
// What the user should SEE in the chat
// ============================================================
describe('Chat Output Formatting', () => {

    it('should display initiative order in combat start', async () => {
        /**
         * USER EXPERIENCE:
         * When combat starts, user should see initiative order.
         */
        const createResult = await handleCreateEncounter({
            seed: `output-init-test-${uuid()}`,
            participants: [
                { id: 'gandalf', name: 'Gandalf', hp: 40, maxHp: 40, initiativeBonus: 4, isEnemy: false },
                { id: 'balrog', name: 'Balrog', hp: 100, maxHp: 100, initiativeBonus: 3, isEnemy: true },
            ]
        }, getTestContext() as any);

        const text = createResult.content[0].text;
        // Should contain turn order info
        expect(text).toMatch(/ROUND|INITIATIVE|turn/i);
    });

    it('should show damage dealt with attacker and target names', async () => {
        /**
         * USER EXPERIENCE:
         * "Gandalf attacks Balrog and deals 15 damage!"
         */
        const gandalf = await createTestCharacter({
            id: 'gandalf-output',
            name: 'Gandalf',
            hp: 40,
            maxHp: 40
        });
        
        const createResult = await handleCreateEncounter({
            seed: `output-damage-test-${uuid()}`,
            participants: [
                { id: gandalf.id!, name: 'Gandalf', hp: 40, maxHp: 40, initiativeBonus: 10, isEnemy: false },
                { id: 'balrog-out', name: 'Balrog', hp: 100, maxHp: 100, initiativeBonus: 5, isEnemy: true },
            ]
        }, getTestContext() as any);
        
        const encounterId = extractEncounterId(createResult.content[0].text);

        const result = await handleExecuteCombatAction({
            encounterId,
            action: 'attack',
            actorId: gandalf.id!,
            targetId: 'balrog-out',
            attackBonus: 10,
            damage: 15,
            dc: 12
        }, getTestContext() as any);

        const text = result.content[0].text;
        // Should mention attacker and action type
        expect(text.toLowerCase()).toMatch(/gandalf|attack/i);
    });

    it('should indicate defeat when creature reaches 0 HP', async () => {
        /**
         * USER EXPERIENCE:
         * Clear indication when an enemy is defeated.
         */
        const hero = await createTestCharacter({
            id: 'hero-defeat',
            name: 'Hero',
            hp: 50,
            maxHp: 50
        });
        
        const createResult = await handleCreateEncounter({
            seed: `defeat-test-${uuid()}`,
            participants: [
                { id: hero.id!, name: 'Hero', hp: 50, maxHp: 50, initiativeBonus: 10, isEnemy: false },
                { id: 'minion-defeat', name: 'Minion', hp: 5, maxHp: 5, initiativeBonus: 5, isEnemy: true },
            ]
        }, getTestContext() as any);
        
        const encounterId = extractEncounterId(createResult.content[0].text);

        const result = await handleExecuteCombatAction({
            encounterId,
            action: 'attack',
            actorId: hero.id!,
            targetId: 'minion-defeat',
            attackBonus: 50,
            damage: 200,  // Guaranteed kill
            dc: 12
        }, getTestContext() as any);

        const text = result.content[0].text;
        // Should indicate defeat
        expect(text.toLowerCase()).toMatch(/defeat|unconscious|0.*hp|falls|down|dies|killed/);
    });
});

// ============================================================
// SCENARIO 5: Edge Cases LLMs Might Trigger
// ============================================================
describe('LLM Edge Cases', () => {

    it('should handle non-existent targetId gracefully', async () => {
        /**
         * ANTICIPATED LLM ERROR:
         * LLM targets a creature that doesn't exist or misspells ID.
         */
        const hero = await createTestCharacter({
            id: 'hero-edge',
            name: 'Hero',
            hp: 30,
            maxHp: 30
        });
        
        const createResult = await handleCreateEncounter({
            seed: `edge-target-test-${uuid()}`,
            participants: [
                { id: hero.id!, name: 'Hero', hp: 30, maxHp: 30, initiativeBonus: 10, isEnemy: false },
            ]
        }, getTestContext() as any);
        
        const encounterId = extractEncounterId(createResult.content[0].text);

        // Try to attack non-existent target
        await expect(handleExecuteCombatAction({
            encounterId,
            action: 'attack',
            actorId: hero.id!,
            targetId: 'nonexistent-goblin',
            attackBonus: 5,
            damage: 10,
            dc: 10
        }, getTestContext() as any)).rejects.toThrow(/not found/i);
    });

    it('should handle empty sessionId gracefully', async () => {
        /**
         * ANTICIPATED LLM ERROR:
         * LLM forgets to include sessionId.
         */
        const result = await handleCreateEncounter({
            seed: `edge-session-test-${uuid()}`,
            participants: [
                { id: 'pc-empty-session', name: 'Hero', hp: 30, maxHp: 30, initiativeBonus: 10, isEnemy: false },
            ]
        }, { sessionId: '' });

        // Should still work with default/empty session
        expect(result.content[0].text).toContain('COMBAT STARTED');
    });

    it('should handle whitespace in comma-separated targetId', async () => {
        /**
         * ANTICIPATED LLM BEHAVIOR:
         * LLM might include spaces: "goblin-1, goblin-2, goblin-3"
         * 
         * ROBUST CONSIDERATION:
         * Trim whitespace when parsing.
         */
        const wizard = await createWizard(5, { 
            id: 'wizard-whitespace',
            knownSpells: ['Fireball'] 
        });
        
        const createResult = await handleCreateEncounter({
            seed: `whitespace-test-${uuid()}`,
            participants: [
                { id: wizard.id!, name: 'Wizard', hp: 25, maxHp: 25, initiativeBonus: 10, isEnemy: false },
                { id: 'goblin-ws-1', name: 'Goblin 1', hp: 7, maxHp: 7, initiativeBonus: 0, isEnemy: true },
                { id: 'goblin-ws-2', name: 'Goblin 2', hp: 7, maxHp: 7, initiativeBonus: 0, isEnemy: true },
            ]
        }, getTestContext() as any);
        
        const encounterId = extractEncounterId(createResult.content[0].text);

        // targetId with spaces around commas
        const result = await handleExecuteCombatAction({
            encounterId,
            action: 'cast_spell',
            actorId: wizard.id!,
            targetId: 'goblin-ws-1, goblin-ws-2',  // Spaces included
            spellName: 'Fireball',
            slotLevel: 3,
            dc: 14
        }, getTestContext() as any);

        const text = result.content[0].text;
        expect(text).toMatch(/Goblin 1|goblin-ws-1/i);
        expect(text).toMatch(/Goblin 2|goblin-ws-2/i);
    });
});
