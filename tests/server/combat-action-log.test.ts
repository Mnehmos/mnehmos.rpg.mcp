import {
    handleCreateEncounter,
    handleExecuteCombatAction,
    handleEndEncounter,
    clearCombatState
} from '../../src/server/combat-tools';
import {
    handleCreateCharacter,
    closeTestDb
} from '../helpers/legacy-handlers.js';
import { closeDb, getDb } from '../../src/storage';
import { CombatActionLogRepository } from '../../src/storage/repos/combat-action-log.repo';

const mockCtx = { sessionId: 'test-session' };

function extractEmbeddedJson(responseText: string, tag: string = "DATA"): any {
    const regex = new RegExp(`<!--\\s*${tag}_JSON\\s*\n([\\s\\S]*?)\n${tag}_JSON\\s*-->`);
    const match = responseText.match(regex);
    if (match) {
        return JSON.parse(match[1]);
    }
    throw new Error(`Could not extract ${tag}_JSON from response`);
}

/**
 * PLAYTEST-FIX: Combat Action History Log
 *
 * When Claude's context window compacts mid-combat, the narrative of what
 * happened is lost. This test verifies that combat actions are logged to
 * the database and can be retrieved for context reconstruction.
 */
describe('PLAYTEST-FIX: Combat Action History Log', () => {
    beforeEach(() => {
        closeDb();
        getDb(':memory:');
        clearCombatState();
    });

    afterEach(() => {
        closeTestDb();
    });

    it('should log attack actions to database', async () => {
        // Create characters
        const heroResult = await handleCreateCharacter({
            name: 'Action Log Hero',
            stats: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
            hp: 40,
            maxHp: 40,
            ac: 16,
            level: 3,
            provisionEquipment: false
        }, mockCtx);
        const hero = extractEmbeddedJson(heroResult.content[0].text, "CHARACTER");

        // Create encounter
        const encounterResult = await handleCreateEncounter({
            seed: 'action-log-test',
            participants: [
                {
                    id: hero.id,
                    name: hero.name,
                    initiativeBonus: 2,
                    hp: 40,
                    maxHp: 40,
                    conditions: []
                },
                {
                    id: 'enemy-goblin',
                    name: 'Goblin',
                    initiativeBonus: 0,
                    hp: 15,
                    maxHp: 15,
                    isEnemy: true,
                    conditions: []
                }
            ]
        }, mockCtx);

        const encounterText = encounterResult.content[0].text;
        const encounterIdMatch = encounterText.match(/Encounter ID: (encounter-[^\n]+)/);
        const encounterId = encounterIdMatch![1];

        // Execute an attack
        await handleExecuteCombatAction({
            encounterId,
            action: 'attack',
            actorId: hero.id,
            targetId: 'enemy-goblin',
            attackBonus: 5,
            dc: 12,
            damage: 8
        }, mockCtx);

        // Check that action was logged
        const db = getDb(':memory:');
        const actionLogRepo = new CombatActionLogRepository(db);
        const actions = actionLogRepo.getByEncounter(encounterId);

        expect(actions.length).toBeGreaterThanOrEqual(1);

        const attackAction = actions.find(a => a.actionType === 'attack');
        expect(attackAction).toBeDefined();
        expect(attackAction!.actorName).toBe(hero.name);
        expect(attackAction!.resultSummary).toContain(hero.name);
    });

    it('should log heal actions', async () => {
        const heroResult = await handleCreateCharacter({
            name: 'Heal Log Hero',
            stats: { str: 10, dex: 14, con: 14, int: 10, wis: 16, cha: 12 },
            hp: 20,
            maxHp: 40,
            ac: 14,
            level: 3,
            provisionEquipment: false
        }, mockCtx);
        const hero = extractEmbeddedJson(heroResult.content[0].text, "CHARACTER");

        const encounterResult = await handleCreateEncounter({
            seed: 'heal-log-test',
            participants: [
                {
                    id: hero.id,
                    name: hero.name,
                    initiativeBonus: 2,
                    hp: 20,
                    maxHp: 40,
                    conditions: []
                },
                {
                    id: 'enemy-2',
                    name: 'Enemy',
                    initiativeBonus: 0,
                    hp: 15,
                    maxHp: 15,
                    isEnemy: true,
                    conditions: []
                }
            ]
        }, mockCtx);

        const encounterText = encounterResult.content[0].text;
        const encounterIdMatch = encounterText.match(/Encounter ID: (encounter-[^\n]+)/);
        const encounterId = encounterIdMatch![1];

        // Execute a heal
        await handleExecuteCombatAction({
            encounterId,
            action: 'heal',
            actorId: hero.id,
            targetId: hero.id,
            amount: 15
        }, mockCtx);

        // Check that heal was logged
        const db = getDb(':memory:');
        const actionLogRepo = new CombatActionLogRepository(db);
        const actions = actionLogRepo.getByEncounter(encounterId);

        const healAction = actions.find(a => a.actionType === 'heal');
        expect(healAction).toBeDefined();
        expect(healAction!.healingDone).toBe(15);
        expect(healAction!.resultSummary).toContain('healed');
    });

    it('should provide context reconstruction summary', async () => {
        const heroResult = await handleCreateCharacter({
            name: 'Summary Hero',
            stats: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
            hp: 50,
            maxHp: 50,
            ac: 16,
            level: 4,
            provisionEquipment: false
        }, mockCtx);
        const hero = extractEmbeddedJson(heroResult.content[0].text, "CHARACTER");

        const encounterResult = await handleCreateEncounter({
            seed: 'summary-test',
            participants: [
                {
                    id: hero.id,
                    name: hero.name,
                    initiativeBonus: 3,
                    hp: 50,
                    maxHp: 50,
                    conditions: []
                },
                {
                    id: 'orc-1',
                    name: 'Orc',
                    initiativeBonus: 1,
                    hp: 20,
                    maxHp: 20,
                    isEnemy: true,
                    conditions: []
                }
            ]
        }, mockCtx);

        const encounterText = encounterResult.content[0].text;
        const encounterIdMatch = encounterText.match(/Encounter ID: (encounter-[^\n]+)/);
        const encounterId = encounterIdMatch![1];

        // Execute multiple actions
        await handleExecuteCombatAction({
            encounterId,
            action: 'attack',
            actorId: hero.id,
            targetId: 'orc-1',
            attackBonus: 6,
            dc: 13,
            damage: 10
        }, mockCtx);

        // Get summary for context reconstruction
        const db = getDb(':memory:');
        const actionLogRepo = new CombatActionLogRepository(db);
        const summary = actionLogRepo.getSummary(encounterId);

        expect(summary).toContain('COMBAT HISTORY');
        expect(summary).toContain('Round');
    });

    it('should retrieve actions by round', async () => {
        const heroResult = await handleCreateCharacter({
            name: 'Round Test',
            stats: { str: 14, dex: 14, con: 14, int: 14, wis: 14, cha: 14 },
            hp: 30,
            maxHp: 30,
            ac: 15,
            level: 2,
            provisionEquipment: false
        }, mockCtx);
        const hero = extractEmbeddedJson(heroResult.content[0].text, "CHARACTER");

        const encounterResult = await handleCreateEncounter({
            seed: 'round-test',
            participants: [
                {
                    id: hero.id,
                    name: hero.name,
                    initiativeBonus: 2,
                    hp: 30,
                    maxHp: 30,
                    conditions: []
                },
                {
                    id: 'enemy-r',
                    name: 'Enemy',
                    initiativeBonus: 0,
                    hp: 15,
                    maxHp: 15,
                    isEnemy: true,
                    conditions: []
                }
            ]
        }, mockCtx);

        const encounterText = encounterResult.content[0].text;
        const encounterIdMatch = encounterText.match(/Encounter ID: (encounter-[^\n]+)/);
        const encounterId = encounterIdMatch![1];

        // Attack in round 1
        await handleExecuteCombatAction({
            encounterId,
            action: 'attack',
            actorId: hero.id,
            targetId: 'enemy-r',
            attackBonus: 5,
            dc: 12,
            damage: 5
        }, mockCtx);

        // Get actions from round 1
        const db = getDb(':memory:');
        const actionLogRepo = new CombatActionLogRepository(db);
        const round1Actions = actionLogRepo.getByRound(encounterId, 1);

        expect(round1Actions.length).toBeGreaterThanOrEqual(1);
        expect(round1Actions.every(a => a.round === 1)).toBe(true);
    });

    it('should return empty results for non-existent encounter', async () => {
        const db = getDb(':memory:');
        const actionLogRepo = new CombatActionLogRepository(db);

        const actions = actionLogRepo.getByEncounter('non-existent-encounter');
        expect(actions).toEqual([]);

        const summary = actionLogRepo.getSummary('non-existent-encounter');
        expect(summary).toContain('No combat actions recorded');
    });
});
