/**
 * Tests for consolidated session_manage tool
 * Validates all 2 actions: initialize, get_context
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { handleSessionManage, SessionManageTool } from '../../../src/server/consolidated/session-manage.js';
import { getDb, closeDb } from '../../../src/storage/index.js';
import { WorldRepository } from '../../../src/storage/repos/world.repo.js';
import { PartyRepository } from '../../../src/storage/repos/party.repo.js';
import { CharacterRepository } from '../../../src/storage/repos/character.repo.js';
import { QuestRepository } from '../../../src/storage/repos/quest.repo.js';
import { randomUUID } from 'crypto';

process.env.NODE_ENV = 'test';

function parseResult(result: { content: Array<{ type: string; text: string }> }) {
    const text = result.content[0].text;
    const jsonMatch = text.match(/<!-- SESSION_MANAGE_JSON\n([\s\S]*?)\nSESSION_MANAGE_JSON -->/);
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

describe('session_manage consolidated tool', () => {
    let testWorldId: string;
    let testPartyId: string;
    let testCharacterId: string;
    const ctx = { sessionId: 'test-session' };

    beforeEach(async () => {
        closeDb();
        const db = getDb(':memory:');
        const now = new Date().toISOString();

        // Create test world
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

        // Create test character
        const charRepo = new CharacterRepository(db);
        testCharacterId = randomUUID();
        charRepo.create({
            id: testCharacterId,
            name: 'Test Hero',
            race: 'Human',
            characterClass: 'Fighter',
            characterType: 'pc',
            level: 5,
            hp: 45,
            maxHp: 50,
            ac: 18,
            stats: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 10 },
            createdAt: now,
            updatedAt: now
        } as any);

        // Create test party with member
        const partyRepo = new PartyRepository(db);
        testPartyId = randomUUID();
        partyRepo.create({
            id: testPartyId,
            name: 'Test Party',
            createdAt: now,
            updatedAt: now
        });
        partyRepo.addMember({
            id: randomUUID(),
            partyId: testPartyId,
            characterId: testCharacterId,
            role: 'leader',
            isActive: true,
            position: 0,
            sharePercentage: 100,
            joinedAt: now,
            notes: ''
        });

        // Create test quest
        const questRepo = new QuestRepository(db);
        questRepo.create({
            id: randomUUID(),
            worldId: testWorldId,
            name: 'Slay the Dragon',
            description: 'A dragon terrorizes the village',
            status: 'active',
            objectives: [
                { id: '1', description: 'Find the dragon lair', type: 'explore', target: 'lair', required: 1, current: 0, completed: false },
                { id: '2', description: 'Defeat the dragon', type: 'kill', target: 'dragon', required: 1, current: 0, completed: false }
            ],
            rewards: { experience: 500, gold: 100, items: [] },
            prerequisites: [],
            createdAt: now,
            updatedAt: now
        });

        // Create test narrative table and data (direct SQL since no repo exists)
        try {
            db.exec(`
                CREATE TABLE IF NOT EXISTS narrative_notes (
                    id TEXT PRIMARY KEY,
                    world_id TEXT,
                    type TEXT,
                    content TEXT,
                    status TEXT,
                    created_at TEXT,
                    updated_at TEXT
                )
            `);
            db.prepare(`
                INSERT INTO narrative_notes (id, world_id, type, content, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(randomUUID(), testWorldId, 'action', 'The party entered the dark forest', 'active', now, now);
        } catch {
            // Ignore errors
        }
    });

    describe('Tool Definition', () => {
        it('should have correct tool name', () => {
            expect(SessionManageTool.name).toBe('session_manage');
        });

        it('should list all available actions in description', () => {
            expect(SessionManageTool.description).toContain('initialize');
            expect(SessionManageTool.description).toContain('get_context');
        });
    });

    describe('initialize action', () => {
        it('should initialize session with existing world and party', async () => {
            const result = await handleSessionManage({
                action: 'initialize',
                worldId: testWorldId,
                partyId: testPartyId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('initialize');
            expect(data.sessionId).toBe('test-session');
            expect(data.worldId).toBe(testWorldId);
            expect(data.partyId).toBe(testPartyId);
        });

        it('should create new world and party when requested', async () => {
            const result = await handleSessionManage({
                action: 'initialize',
                createNew: true,
                worldName: 'New Adventure World',
                partyName: 'The Heroes'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.worldName).toBe('New Adventure World');
            expect(data.partyName).toBe('The Heroes');
            expect(data.created.world).toBe(true);
            expect(data.created.party).toBe(true);
        });

        it('should find existing world if not specified', async () => {
            const result = await handleSessionManage({
                action: 'initialize'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.worldId).toBe(testWorldId);
        });

        it('should include party members in response', async () => {
            const result = await handleSessionManage({
                action: 'initialize',
                partyId: testPartyId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.partyMembers.length).toBe(1);
            expect(data.partyMembers[0].name).toBe('Test Hero');
        });

        it('should accept "init" alias', async () => {
            const result = await handleSessionManage({
                action: 'init',
                worldId: testWorldId
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('initialize');
        });

        it('should accept "start" alias', async () => {
            const result = await handleSessionManage({
                action: 'start'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('initialize');
        });
    });

    describe('get_context action', () => {
        it('should get full context', async () => {
            const result = await handleSessionManage({
                action: 'get_context',
                partyId: testPartyId,
                worldId: testWorldId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('get_context');
        });

        it('should include party details', async () => {
            const result = await handleSessionManage({
                action: 'get_context',
                partyId: testPartyId,
                includeParty: true
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.party).toBeDefined();
            expect(data.party.name).toBe('Test Party');
            expect(data.party.members.length).toBe(1);
        });

        it('should include active quests', async () => {
            const result = await handleSessionManage({
                action: 'get_context',
                includeQuests: true
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.quests).toBeDefined();
            expect(data.quests.length).toBeGreaterThan(0);
            expect(data.quests[0].title).toBe('Slay the Dragon');
        });

        it('should include world state', async () => {
            const result = await handleSessionManage({
                action: 'get_context',
                worldId: testWorldId,
                includeWorld: true
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.world).toBeDefined();
            expect(data.world.name).toBe('Test World');
        });

        it('should include recent narrative', async () => {
            const result = await handleSessionManage({
                action: 'get_context',
                includeNarrative: true,
                narrativeLimit: 5
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.narrative).toBeDefined();
            // narrative_notes table may or may not have data depending on db state
            expect(Array.isArray(data.narrative)).toBe(true);
        });

        it('should respect include flags', async () => {
            const result = await handleSessionManage({
                action: 'get_context',
                partyId: testPartyId,
                includeParty: true,
                includeQuests: false,
                includeWorld: false,
                includeNarrative: false,
                includeCombat: false
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.party).toBeDefined();
            expect(data.quests).toBeUndefined();
            expect(data.world).toBeUndefined();
            expect(data.narrative).toBeUndefined();
        });

        it('should accept "context" alias', async () => {
            const result = await handleSessionManage({
                action: 'context',
                partyId: testPartyId
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('get_context');
        });

        it('should accept "narrative" alias', async () => {
            const result = await handleSessionManage({
                action: 'narrative'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('get_context');
        });
    });

    describe('fuzzy matching', () => {
        it('should auto-correct close typos', async () => {
            const result = await handleSessionManage({
                action: 'initalize',  // Typo
                worldId: testWorldId
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('initialize');
        });

        it('should provide helpful error for unknown action', async () => {
            const result = await handleSessionManage({
                action: 'xyz'
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe('invalid_action');
            expect(data.message).toContain('Unknown action');
        });
    });

    describe('output formatting', () => {
        it('should include rich text formatting for initialize', async () => {
            const result = await handleSessionManage({
                action: 'initialize'
            }, ctx);

            const text = result.content[0].text;
            expect(text.toUpperCase()).toContain('SESSION');
            expect(text.toUpperCase()).toContain('INITIALIZED');
        });

        it('should include rich text formatting for context', async () => {
            const result = await handleSessionManage({
                action: 'get_context',
                partyId: testPartyId
            }, ctx);

            const text = result.content[0].text;
            expect(text.toUpperCase()).toContain('CONTEXT');
        });

        it('should embed JSON for parsing', async () => {
            const result = await handleSessionManage({
                action: 'initialize'
            }, ctx);

            const text = result.content[0].text;
            expect(text).toContain('<!-- SESSION_MANAGE_JSON');
        });
    });
});
