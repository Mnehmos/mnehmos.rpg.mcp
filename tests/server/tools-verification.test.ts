import { describe, it, expect } from 'vitest';
import { handleCreateEncounter, clearCombatState } from '../../src/server/combat-tools';
import { handleCreateWorld, handleDeleteWorld, getTestDb, closeTestDb } from '../../src/server/crud-tools';

// Helper to extract embedded JSON from human-readable output
function extractStateJson(text: string): Record<string, any> {
    const match = text.match(/<!-- STATE_JSON\n([\s\S]*?)\nSTATE_JSON -->/);
    return match ? JSON.parse(match[1]) : {};
}

describe('Registered Tools Verification', () => {
    describe('Combat Tools', () => {
        it('should create an encounter', async () => {
            clearCombatState();
            const result = await handleCreateEncounter({
                seed: 'test-combat',
                participants: [
                    { id: 'p1', name: 'Player', initiativeBonus: 0, hp: 10, maxHp: 10 },
                    { id: 'e1', name: 'Enemy', initiativeBonus: 0, hp: 10, maxHp: 10 }
                ]
            }, { sessionId: 'test-session' });

            expect(result.content).toBeDefined();
            // Combat tools return human-readable text with embedded JSON
            const content = extractStateJson(result.content[0].text);
            expect(content.encounterId).toBeDefined();
            expect(content.round).toBe(1);
            expect(content.participants).toBeDefined();
        });
    });

    describe('CRUD Tools', () => {
        it('should create and delete a world', async () => {
            // Setup DB
            getTestDb();

            // Create
            const createResult = await handleCreateWorld({
                name: 'Test World',
                seed: 'test-seed',
                width: 50,
                height: 50
            }, { sessionId: 'test-session' });
            const created = JSON.parse(createResult.content[0].text);
            expect(created.id).toBeDefined();

            // Delete
            const deleteResult = await handleDeleteWorld({ id: created.id }, { sessionId: 'test-session' });
            const deleted = JSON.parse(deleteResult.content[0].text);
            expect(deleted.message).toBe('World deleted');

            // Cleanup
            closeTestDb();
        });
    });
});
