import { handleCreateCharacter, handleGetCharacter } from '../../src/server/crud-tools.js';
import { handleTakeLongRest, handleTakeShortRest } from '../../src/server/rest-tools.js';
import { closeDb, getDb } from '../../src/storage/index.js';


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

/**
 * CRIT-002: Spell Slots Never Recover
 *
 * Foundation: Rest mechanics for HP restoration.
 * Spell slot restoration will be added when spellcasting system exists.
 *
 * Long Rest: Restores HP to max
 * Short Rest: Restores some HP (simulates spending hit dice)
 */
describe('CRIT-002: Rest Mechanics', () => {
    beforeEach(() => {
        closeDb();
        getDb(':memory:');
    });

    describe('Long Rest', () => {
        it('should restore HP to max after long rest', async () => {
            // Create character with damaged HP
            const createResult = await handleCreateCharacter({
                name: 'Wounded Warrior',
                stats: { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
                hp: 20,
                maxHp: 50,
                ac: 15,
                level: 5
            }, mockCtx);
            const character = extractEmbeddedJson(createResult.content[0].text, "CHARACTER");
            expect(character.hp).toBe(20);
            expect(character.maxHp).toBe(50);

            // Take long rest
            const restResult = await handleTakeLongRest({
                characterId: character.id
            }, mockCtx);
            const restData = JSON.parse(restResult.content[0].text);

            // Verify HP restored
            expect(restData.hpRestored).toBe(30);
            expect(restData.newHp).toBe(50);

            // Verify character record updated
            const reloadedResult = await handleGetCharacter({ id: character.id }, mockCtx);
            const reloaded = extractEmbeddedJson(reloadedResult.content[0].text, "CHARACTER");
            expect(reloaded.hp).toBe(50);
        });

        it('should not overheal past maxHp', async () => {
            // Create character already at full HP
            const createResult = await handleCreateCharacter({
                name: 'Healthy Hero',
                stats: { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
                hp: 50,
                maxHp: 50,
                ac: 15,
                level: 5
            }, mockCtx);
            const character = extractEmbeddedJson(createResult.content[0].text, "CHARACTER");

            // Take long rest
            const restResult = await handleTakeLongRest({
                characterId: character.id
            }, mockCtx);
            const restData = JSON.parse(restResult.content[0].text);

            expect(restData.hpRestored).toBe(0);
            expect(restData.newHp).toBe(50);
        });

        it('should throw error for non-existent character', async () => {
            await expect(handleTakeLongRest({
                characterId: 'non-existent-id'
            }, mockCtx)).rejects.toThrow();
        });
    });

    describe('Short Rest', () => {
        it('should restore some HP after short rest', async () => {
            // Create character with damaged HP
            const createResult = await handleCreateCharacter({
                name: 'Wounded Warrior',
                stats: { str: 14, dex: 12, con: 16, int: 10, wis: 10, cha: 10 }, // CON 16 = +3 modifier
                hp: 20,
                maxHp: 50,
                ac: 15,
                level: 5
            }, mockCtx);
            const character = extractEmbeddedJson(createResult.content[0].text, "CHARACTER");

            // Take short rest spending 2 hit dice
            const restResult = await handleTakeShortRest({
                characterId: character.id,
                hitDiceToSpend: 2
            }, mockCtx);
            const restData = JSON.parse(restResult.content[0].text);

            // Should heal some HP (hit dice roll + CON modifier per die)
            expect(restData.hpRestored).toBeGreaterThan(0);
            expect(restData.newHp).toBeGreaterThan(20);
            expect(restData.newHp).toBeLessThanOrEqual(50);
        });

        it('should not heal past maxHp on short rest', async () => {
            // Create character almost at full HP
            const createResult = await handleCreateCharacter({
                name: 'Slightly Wounded',
                stats: { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
                hp: 48,
                maxHp: 50,
                ac: 15,
                level: 5
            }, mockCtx);
            const character = extractEmbeddedJson(createResult.content[0].text, "CHARACTER");

            // Take short rest
            const restResult = await handleTakeShortRest({
                characterId: character.id,
                hitDiceToSpend: 5 // Try to spend many dice
            }, mockCtx);
            const restData = JSON.parse(restResult.content[0].text);

            // Should cap at maxHp
            expect(restData.newHp).toBe(50);
        });

        it('should default to 1 hit die if not specified', async () => {
            const createResult = await handleCreateCharacter({
                name: 'Test Character',
                stats: { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
                hp: 20,
                maxHp: 50,
                ac: 15,
                level: 5
            }, mockCtx);
            const character = extractEmbeddedJson(createResult.content[0].text, "CHARACTER");

            // Take short rest without specifying dice
            const restResult = await handleTakeShortRest({
                characterId: character.id
            }, mockCtx);
            const restData = JSON.parse(restResult.content[0].text);

            expect(restData.hitDiceSpent).toBe(1);
        });
    });
});
