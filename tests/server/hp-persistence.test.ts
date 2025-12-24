import {
    handleCreateEncounter,
    handleExecuteCombatAction,
    handleEndEncounter,
    handleGetEncounterState,
    handleAdvanceTurn,
    clearCombatState
} from '../../src/server/combat-tools';
import {
    handleCreateCharacter,
    handleGetCharacter,
    closeTestDb
} from '../../src/server/crud-tools';
import { closeDb, getDb } from '../../src/storage';


// Helper to extract embedded JSON from formatted responses
function extractEmbeddedJson(responseText: string, tag: string = "DATA"): any {
    const regex = new RegExp(`<!--\\s*${tag}_JSON\\s*\n([\\s\\S]*?)\n${tag}_JSON\\s*-->`);
    const match = responseText.match(regex);
    if (match) {
        return JSON.parse(match[1]);
    }
    throw new Error(`Could not extract ${tag}_JSON from response`);
}
const mockCtx = { sessionId: 'test-session' };

function extractStateJson(responseText: string): any {
    const match = responseText.match(/<!-- STATE_JSON\n([\s\S]*?)\nSTATE_JSON -->/);
    if (match) {
        return JSON.parse(match[1]);
    }
    throw new Error('Could not extract state JSON from response');
}

/**
 * CRIT-001: HP Desynchronization After Combat
 *
 * Player Experience:
 * I created a character with 50 HP. Entered combat, took 20 damage (now at 30 HP).
 * Combat ended. Later I checked my character and they're back at 50 HP.
 * I basically can't die because damage doesn't persist.
 *
 * Root Cause:
 * Combat encounter has its own participant state that includes HP, but this HP
 * isn't synced back to the character table when the encounter ends.
 */
describe('CRIT-001: HP Persistence After Combat', () => {
    beforeEach(() => {
        closeDb();
        getDb(':memory:');
        clearCombatState();
    });

    afterEach(() => {
        closeTestDb();
    });

    it('should persist HP changes after encounter ends', async () => {
        // 1. Create a character with 50 HP
        const charResult = await handleCreateCharacter({
            name: 'Test Hero',
            stats: { str: 16, dex: 14, con: 15, int: 10, wis: 12, cha: 8 },
            hp: 50,
            maxHp: 50,
            ac: 16,
            level: 3,
            provisionEquipment: false
        }, mockCtx);
        const character = extractEmbeddedJson(charResult.content[0].text, "CHARACTER");
        expect(character.hp).toBe(50);

        // 2. Create an encounter with this character and an enemy
        const encounterResult = await handleCreateEncounter({
            seed: 'hp-persistence-test',
            participants: [
                {
                    id: character.id,
                    name: character.name,
                    initiativeBonus: 2,
                    hp: character.hp,
                    maxHp: character.maxHp,
                    conditions: []
                },
                {
                    id: 'enemy-goblin',
                    name: 'Goblin',
                    initiativeBonus: 1,
                    hp: 10,
                    maxHp: 10,
                    isEnemy: true,
                    conditions: []
                }
            ]
        }, mockCtx);

        // Extract encounter ID from the response
        const encounterText = encounterResult.content[0].text;
        const encounterIdMatch = encounterText.match(/Encounter ID: (encounter-[^\n]+)/);
        expect(encounterIdMatch).toBeTruthy();
        const encounterId = encounterIdMatch![1];

        // 3. Execute an attack that deals damage to the character
        // Use very high attack bonus to guarantee a hit
        const attackResult = await handleExecuteCombatAction({
            encounterId,
            action: 'attack',
            actorId: 'enemy-goblin',
            targetId: character.id,
            attackBonus: 20,  // Very high bonus to guarantee hit
            dc: 10,          // Low DC to ensure hit
            damage: 20       // Base damage (may be doubled on crit)
        }, mockCtx);

        // Verify the attack hit
        const attackText = attackResult.content[0].text;
        expect(attackText).toContain('HIT');

        // 4. Verify HP changed in encounter state
        const stateResult = await handleGetEncounterState({ encounterId }, mockCtx);
        const state = extractStateJson(stateResult.content[0].text);
        const heroInEncounter = state.participants.find(
            (p: any) => p.id === character.id
        );

        expect(heroInEncounter).toBeDefined();
        // HP should be less than 50 (took damage)
        expect(heroInEncounter.hp).toBeLessThan(50);
        const hpAfterCombat = heroInEncounter.hp;

        // 5. End the encounter
        await handleEndEncounter({ encounterId }, mockCtx);

        // 6. CRITICAL TEST: Check if HP persisted back to character record
        const reloadedResult = await handleGetCharacter({ id: character.id }, mockCtx);
        const reloadedCharacter = extractEmbeddedJson(reloadedResult.content[0].text, "CHARACTER");

        // HP in character record should match the HP at end of combat
        expect(reloadedCharacter.hp).toBe(hpAfterCombat);
    });

    it('should persist HP changes for multiple characters', async () => {
        // Create two characters
        const hero1Result = await handleCreateCharacter({
            name: 'Fighter',
            stats: { str: 16, dex: 14, con: 15, int: 10, wis: 12, cha: 8 },
            hp: 40,
            maxHp: 40,
            ac: 18,
            level: 3,
            provisionEquipment: false
        }, mockCtx);
        const hero1 = extractEmbeddedJson(hero1Result.content[0].text, "CHARACTER");

        const hero2Result = await handleCreateCharacter({
            name: 'Wizard',
            stats: { str: 8, dex: 14, con: 12, int: 18, wis: 13, cha: 10 },
            hp: 25,
            maxHp: 25,
            ac: 12,
            level: 3,
            provisionEquipment: false
        }, mockCtx);
        const hero2 = extractEmbeddedJson(hero2Result.content[0].text, "CHARACTER");

        // Create encounter
        const encounterResult = await handleCreateEncounter({
            seed: 'multi-hp-test',
            participants: [
                {
                    id: hero1.id,
                    name: hero1.name,
                    initiativeBonus: 2,
                    hp: hero1.hp,
                    maxHp: hero1.maxHp,
                    conditions: []
                },
                {
                    id: hero2.id,
                    name: hero2.name,
                    initiativeBonus: 1,
                    hp: hero2.hp,
                    maxHp: hero2.maxHp,
                    conditions: []
                },
                {
                    id: 'enemy-orc',
                    name: 'Orc',
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

        // Damage both heroes (use high bonus to guarantee hits)
        // Attack hero1
        await handleExecuteCombatAction({
            encounterId,
            action: 'attack',
            actorId: 'enemy-orc',
            targetId: hero1.id,
            attackBonus: 20,
            dc: 10,
            damage: 15
        }, mockCtx);

        // Advance turn to reset action economy for the orc
        await handleAdvanceTurn({ encounterId }, mockCtx);
        await handleAdvanceTurn({ encounterId }, mockCtx);
        await handleAdvanceTurn({ encounterId }, mockCtx);

        // Attack hero2
        await handleExecuteCombatAction({
            encounterId,
            action: 'attack',
            actorId: 'enemy-orc',
            targetId: hero2.id,
            attackBonus: 20,
            dc: 10,
            damage: 10
        }, mockCtx);

        // Get HP values after combat (before ending encounter)
        const stateResult = await handleGetEncounterState({ encounterId }, mockCtx);
        const state = extractStateJson(stateResult.content[0].text);
        const hero1InEncounter = state.participants.find((p: any) => p.id === hero1.id);
        const hero2InEncounter = state.participants.find((p: any) => p.id === hero2.id);

        expect(hero1InEncounter.hp).toBeLessThan(40); // Took damage
        expect(hero2InEncounter.hp).toBeLessThan(25); // Took damage

        const hp1AfterCombat = hero1InEncounter.hp;
        const hp2AfterCombat = hero2InEncounter.hp;

        // End encounter
        await handleEndEncounter({ encounterId }, mockCtx);

        // Verify both characters have updated HP that matches combat state
        const reloaded1 = extractEmbeddedJson(
            (await handleGetCharacter({ id: hero1.id }, mockCtx)).content[0].text,
            "CHARACTER"
        );
        const reloaded2 = extractEmbeddedJson(
            (await handleGetCharacter({ id: hero2.id }, mockCtx)).content[0].text,
            "CHARACTER"
        );

        expect(reloaded1.hp).toBe(hp1AfterCombat);
        expect(reloaded2.hp).toBe(hp2AfterCombat);
    });

    it('should not sync HP for enemies/NPCs that are not in character table', async () => {
        // Create a player character
        const heroResult = await handleCreateCharacter({
            name: 'Hero',
            stats: { str: 14, dex: 14, con: 14, int: 14, wis: 14, cha: 14 },
            hp: 30,
            maxHp: 30,
            ac: 15,
            level: 2,
            provisionEquipment: false
        }, mockCtx);
        const hero = extractEmbeddedJson(heroResult.content[0].text, "CHARACTER");

        // Create encounter with ad-hoc enemy (not in character table)
        const encounterResult = await handleCreateEncounter({
            seed: 'adhoc-enemy-test',
            participants: [
                {
                    id: hero.id,
                    name: hero.name,
                    initiativeBonus: 2,
                    hp: hero.hp,
                    maxHp: hero.maxHp,
                    conditions: []
                },
                {
                    id: 'random-goblin-123',
                    name: 'Random Goblin',
                    initiativeBonus: 1,
                    hp: 7,
                    maxHp: 7,
                    isEnemy: true,
                    conditions: []
                }
            ]
        }, mockCtx);

        const encounterText = encounterResult.content[0].text;
        const encounterIdMatch = encounterText.match(/Encounter ID: (encounter-[^\n]+)/);
        const encounterId = encounterIdMatch![1];

        // Hero takes damage (use high bonus to guarantee hit)
        await handleExecuteCombatAction({
            encounterId,
            action: 'attack',
            actorId: 'random-goblin-123',
            targetId: hero.id,
            attackBonus: 20,
            dc: 10,
            damage: 12
        }, mockCtx);

        // Get hero HP after combat
        const stateResult = await handleGetEncounterState({ encounterId }, mockCtx);
        const state = extractStateJson(stateResult.content[0].text);
        const heroInEncounter = state.participants.find((p: any) => p.id === hero.id);
        expect(heroInEncounter.hp).toBeLessThan(30); // Took damage
        const hpAfterCombat = heroInEncounter.hp;

        // End encounter - should NOT throw error for missing enemy in DB
        await handleEndEncounter({ encounterId }, mockCtx);

        // Hero HP should be synced to match combat state
        const reloadedHero = extractEmbeddedJson(
            (await handleGetCharacter({ id: hero.id }, mockCtx)).content[0].text,
            "CHARACTER"
        );
        expect(reloadedHero.hp).toBe(hpAfterCombat);

        // Ad-hoc enemy should not cause any errors (it's not in character table)
        // This test passes if no exception was thrown
    });
});
