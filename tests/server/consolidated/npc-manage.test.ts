/**
 * Tests for consolidated npc_manage tool
 * Validates all 7 actions: get_relationship, update_relationship, record_memory,
 * get_history, get_recent, get_context, interact
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { handleNpcManage, NpcManageTool } from '../../../src/server/consolidated/npc-manage.js';
import { getDb, closeDb } from '../../../src/storage/index.js';
import { CharacterRepository } from '../../../src/storage/repos/character.repo.js';
import { WorldRepository } from '../../../src/storage/repos/world.repo.js';
import { randomUUID } from 'crypto';

process.env.NODE_ENV = 'test';

function parseResult(result: { content: Array<{ type: string; text: string }> }) {
    const text = result.content[0].text;
    const jsonMatch = text.match(/<!-- NPC_MANAGE_JSON\n([\s\S]*?)\nNPC_MANAGE_JSON -->/);
    if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
    }
    try {
        const parsed = JSON.parse(text);
        if (typeof parsed === 'object' && parsed !== null) {
            return parsed;
        }
    } catch {
        // Not valid JSON
    }
    return { error: 'parse_failed', rawText: text };
}

describe('npc_manage consolidated tool', () => {
    let testCharacterId: string;
    let testNpcId: string;
    let testWorldId: string;
    const ctx = { sessionId: 'test-session' };

    beforeEach(async () => {
        closeDb();
        const db = getDb(':memory:');
        const now = new Date().toISOString();

        // Create a test world
        const worldRepo = new WorldRepository(db);
        testWorldId = randomUUID();
        worldRepo.create({
            id: testWorldId,
            name: 'Test World',
            seed: '12345',
            width: 100,
            height: 100,
            tileData: '{}',
            createdAt: now,
            updatedAt: now
        });

        // Create test character (PC)
        const characterRepo = new CharacterRepository(db);
        testCharacterId = randomUUID();
        characterRepo.create({
            id: testCharacterId,
            name: 'Test Hero',
            class: 'Fighter',
            level: 5,
            race: 'Human',
            stats: { str: 16, dex: 14, con: 15, int: 10, wis: 12, cha: 8 },
            hp: 45,
            maxHp: 45,
            ac: 18,
            worldId: testWorldId,
            createdAt: now,
            updatedAt: now
        });

        // Create test NPC
        testNpcId = randomUUID();
        characterRepo.create({
            id: testNpcId,
            name: 'Village Elder',
            class: 'Commoner',
            level: 1,
            race: 'Human',
            stats: { str: 8, dex: 10, con: 10, int: 14, wis: 16, cha: 12 },
            hp: 10,
            maxHp: 10,
            ac: 10,
            worldId: testWorldId,
            characterType: 'npc',
            createdAt: now,
            updatedAt: now
        });
    });

    describe('Tool Definition', () => {
        it('should have correct tool name', () => {
            expect(NpcManageTool.name).toBe('npc_manage');
        });

        it('should list all available actions in description', () => {
            expect(NpcManageTool.description).toContain('get_relationship');
            expect(NpcManageTool.description).toContain('update_relationship');
            expect(NpcManageTool.description).toContain('record_memory');
            expect(NpcManageTool.description).toContain('get_history');
            expect(NpcManageTool.description).toContain('get_recent');
            expect(NpcManageTool.description).toContain('get_context');
            expect(NpcManageTool.description).toContain('interact');
        });
    });

    describe('get_relationship action', () => {
        it('should return stranger status for new relationship', async () => {
            const result = await handleNpcManage({
                action: 'get_relationship',
                characterId: testCharacterId,
                npcId: testNpcId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('get_relationship');
            expect(data.familiarity).toBe('stranger');
            expect(data.disposition).toBe('neutral');
            expect(data.isNew).toBe(true);
        });

        it('should accept "relationship" alias', async () => {
            const result = await handleNpcManage({
                action: 'relationship',
                characterId: testCharacterId,
                npcId: testNpcId
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('get_relationship');
        });
    });

    describe('update_relationship action', () => {
        it('should create a new relationship', async () => {
            const result = await handleNpcManage({
                action: 'update_relationship',
                characterId: testCharacterId,
                npcId: testNpcId,
                familiarity: 'acquaintance',
                disposition: 'friendly',
                notes: 'Met at the tavern'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('update_relationship');
            expect(data.relationship.familiarity).toBe('acquaintance');
            expect(data.relationship.disposition).toBe('friendly');
        });

        it('should update an existing relationship', async () => {
            // First create
            await handleNpcManage({
                action: 'update_relationship',
                characterId: testCharacterId,
                npcId: testNpcId,
                familiarity: 'acquaintance',
                disposition: 'neutral'
            }, ctx);

            // Then update
            const result = await handleNpcManage({
                action: 'update_relationship',
                characterId: testCharacterId,
                npcId: testNpcId,
                familiarity: 'friend',
                disposition: 'helpful'
            }, ctx);

            const data = parseResult(result);
            expect(data.relationship.familiarity).toBe('friend');
            expect(data.relationship.disposition).toBe('helpful');
        });

        it('should accept "set_relationship" alias', async () => {
            const result = await handleNpcManage({
                action: 'set_relationship',
                characterId: testCharacterId,
                npcId: testNpcId,
                familiarity: 'acquaintance',
                disposition: 'friendly'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('update_relationship');
        });
    });

    describe('record_memory action', () => {
        it('should record a conversation memory', async () => {
            const result = await handleNpcManage({
                action: 'record_memory',
                characterId: testCharacterId,
                npcId: testNpcId,
                summary: 'The elder spoke about the dragon threat',
                importance: 'high',
                topics: ['dragon', 'quest', 'danger']
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('record_memory');
            expect(data.memory).toBeDefined();
        });

        it('should accept "remember" alias', async () => {
            const result = await handleNpcManage({
                action: 'remember',
                characterId: testCharacterId,
                npcId: testNpcId,
                summary: 'Discussed the weather'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('record_memory');
        });
    });

    describe('get_history action', () => {
        beforeEach(async () => {
            // Record some memories
            await handleNpcManage({
                action: 'record_memory',
                characterId: testCharacterId,
                npcId: testNpcId,
                summary: 'First meeting',
                importance: 'medium'
            }, ctx);

            await handleNpcManage({
                action: 'record_memory',
                characterId: testCharacterId,
                npcId: testNpcId,
                summary: 'Important quest details',
                importance: 'high'
            }, ctx);
        });

        it('should get conversation history', async () => {
            const result = await handleNpcManage({
                action: 'get_history',
                characterId: testCharacterId,
                npcId: testNpcId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('get_history');
            expect(data.count).toBeGreaterThanOrEqual(2);
        });

        it('should filter by minimum importance', async () => {
            const result = await handleNpcManage({
                action: 'get_history',
                characterId: testCharacterId,
                npcId: testNpcId,
                minImportance: 'high'
            }, ctx);

            const data = parseResult(result);
            expect(data.count).toBeGreaterThanOrEqual(1);
        });

        it('should accept "history" alias', async () => {
            const result = await handleNpcManage({
                action: 'history',
                characterId: testCharacterId,
                npcId: testNpcId
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('get_history');
        });
    });

    describe('get_recent action', () => {
        beforeEach(async () => {
            // Record some memories
            await handleNpcManage({
                action: 'record_memory',
                characterId: testCharacterId,
                npcId: testNpcId,
                summary: 'Recent conversation'
            }, ctx);
        });

        it('should get recent interactions', async () => {
            const result = await handleNpcManage({
                action: 'get_recent',
                characterId: testCharacterId,
                limit: 10
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('get_recent');
            expect(data.count).toBeGreaterThanOrEqual(1);
        });

        it('should accept "recent" alias', async () => {
            const result = await handleNpcManage({
                action: 'recent',
                characterId: testCharacterId
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('get_recent');
        });
    });

    describe('get_context action', () => {
        beforeEach(async () => {
            // Set up relationship and memories
            await handleNpcManage({
                action: 'update_relationship',
                characterId: testCharacterId,
                npcId: testNpcId,
                familiarity: 'friend',
                disposition: 'friendly',
                notes: 'Known for years'
            }, ctx);

            await handleNpcManage({
                action: 'record_memory',
                characterId: testCharacterId,
                npcId: testNpcId,
                summary: 'Shared stories about the old days',
                importance: 'medium'
            }, ctx);
        });

        it('should get full NPC context', async () => {
            const result = await handleNpcManage({
                action: 'get_context',
                characterId: testCharacterId,
                npcId: testNpcId,
                memoryLimit: 5
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('get_context');
            expect(data.relationship).toBeDefined();
            expect(data.recentMemories).toBeDefined();
            expect(data.contextSummary).toBeDefined();
        });

        it('should accept "context" alias', async () => {
            const result = await handleNpcManage({
                action: 'context',
                characterId: testCharacterId,
                npcId: testNpcId
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('get_context');
        });
    });

    describe('interact action', () => {
        // Note: interact action requires spatial setup which is complex
        // These tests verify basic validation

        it('should return error for non-existent speaker', async () => {
            const result = await handleNpcManage({
                action: 'interact',
                speakerId: 'non-existent',
                content: 'Hello there!',
                volume: 'TALK'
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe(true);
        });

        it('should accept "speak" alias', async () => {
            const result = await handleNpcManage({
                action: 'speak',
                speakerId: testCharacterId,
                content: 'Hello!',
                volume: 'TALK'
            }, ctx);

            const data = parseResult(result);
            // Will error because character not in room, but action should be recognized
            expect(data.error).toBe(true);
            expect(data.message).toContain('not in any room');
        });
    });

    describe('fuzzy matching', () => {
        it('should auto-correct close typos', async () => {
            const result = await handleNpcManage({
                action: 'get_relationshi',  // Missing 'p'
                characterId: testCharacterId,
                npcId: testNpcId
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('get_relationship');
        });

        it('should provide helpful error for unknown action', async () => {
            const result = await handleNpcManage({
                action: 'xyz'
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe('invalid_action');
            expect(data.message).toContain('Unknown action');
        });
    });

    describe('output formatting', () => {
        it('should include rich text formatting', async () => {
            const result = await handleNpcManage({
                action: 'get_relationship',
                characterId: testCharacterId,
                npcId: testNpcId
            }, ctx);

            const text = result.content[0].text;
            expect(text).toContain('NPC RELATIONSHIP');
        });

        it('should embed JSON for parsing', async () => {
            const result = await handleNpcManage({
                action: 'get_relationship',
                characterId: testCharacterId,
                npcId: testNpcId
            }, ctx);

            const text = result.content[0].text;
            expect(text).toContain('<!-- NPC_MANAGE_JSON');
        });
    });
});
