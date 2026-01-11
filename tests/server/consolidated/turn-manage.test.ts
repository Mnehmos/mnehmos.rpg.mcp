/**
 * Tests for consolidated turn_manage tool
 * Validates all 5 actions: init, get_status, submit_actions, mark_ready, poll_results
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { handleTurnManage, TurnManageTool } from '../../../src/server/consolidated/turn-manage.js';
import { getDb, closeDb } from '../../../src/storage/index.js';
import { WorldRepository } from '../../../src/storage/repos/world.repo.js';
import { NationRepository } from '../../../src/storage/repos/nation.repo.js';
import { RegionRepository } from '../../../src/storage/repos/region.repo.js';
import { randomUUID } from 'crypto';

process.env.NODE_ENV = 'test';

function parseResult(result: { content: Array<{ type: string; text: string }> }) {
    const text = result.content[0].text;
    const jsonMatch = text.match(/<!-- TURN_MANAGE_JSON\n([\s\S]*?)\nTURN_MANAGE_JSON -->/);
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

describe('turn_manage consolidated tool', () => {
    let testWorldId: string;
    let testNationId: string;
    let testNation2Id: string;
    let testRegionId: string;
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
            name: 'Test Turn World',
            seed: '12345',
            width: 100,
            height: 100,
            tileData: '{}',
            createdAt: now,
            updatedAt: now
        });

        // Create test region
        const regionRepo = new RegionRepository(db);
        testRegionId = randomUUID();
        regionRepo.create({
            id: testRegionId,
            worldId: testWorldId,
            name: 'Contested Territory',
            type: 'plains',
            centerX: 50,
            centerY: 50,
            color: '#90EE90',
            createdAt: now,
            updatedAt: now
        });

        // Create test nations
        const nationRepo = new NationRepository(db);

        testNationId = randomUUID();
        nationRepo.create({
            id: testNationId,
            worldId: testWorldId,
            name: 'Nation Alpha',
            leader: 'Alpha Leader',
            ideology: 'democracy',
            aggression: 40,
            trust: 60,
            paranoia: 30,
            gdp: 1000,
            resources: { food: 100, metal: 50, oil: 10 },
            relations: {},
            createdAt: now,
            updatedAt: now
        });

        testNation2Id = randomUUID();
        nationRepo.create({
            id: testNation2Id,
            worldId: testWorldId,
            name: 'Nation Beta',
            leader: 'Beta Leader',
            ideology: 'autocracy',
            aggression: 70,
            trust: 30,
            paranoia: 60,
            gdp: 1200,
            resources: { food: 80, metal: 70, oil: 20 },
            relations: {},
            createdAt: now,
            updatedAt: now
        });
    });

    describe('Tool Definition', () => {
        it('should have correct tool name', () => {
            expect(TurnManageTool.name).toBe('turn_manage');
        });

        it('should list all available actions in description', () => {
            expect(TurnManageTool.description).toContain('init');
            expect(TurnManageTool.description).toContain('get_status');
            expect(TurnManageTool.description).toContain('submit_actions');
            expect(TurnManageTool.description).toContain('mark_ready');
            expect(TurnManageTool.description).toContain('poll_results');
        });
    });

    describe('init action', () => {
        it('should initialize turn state for a world', async () => {
            const result = await handleTurnManage({
                action: 'init',
                worldId: testWorldId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('init');
            expect(data.worldId).toBe(testWorldId);
            expect(data.currentTurn).toBe(1);
            expect(data.phase).toBe('planning');
        });

        it('should not reinitialize if already exists', async () => {
            // First init
            await handleTurnManage({
                action: 'init',
                worldId: testWorldId
            }, ctx);

            // Second init should indicate already initialized
            const result = await handleTurnManage({
                action: 'init',
                worldId: testWorldId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.alreadyInitialized).toBe(true);
        });

        it('should accept "initialize" alias', async () => {
            const result = await handleTurnManage({
                action: 'initialize',
                worldId: testWorldId
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('init');
        });
    });

    describe('get_status action', () => {
        beforeEach(async () => {
            await handleTurnManage({
                action: 'init',
                worldId: testWorldId
            }, ctx);
        });

        it('should get turn status', async () => {
            const result = await handleTurnManage({
                action: 'get_status',
                worldId: testWorldId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('get_status');
            expect(data.currentTurn).toBe(1);
            expect(data.phase).toBe('planning');
            expect(data.nationsReady).toBe(0);
            expect(data.totalNations).toBe(2);
            expect(data.canSubmitActions).toBe(true);
        });

        it('should show waiting nations', async () => {
            const result = await handleTurnManage({
                action: 'get_status',
                worldId: testWorldId
            }, ctx);

            const data = parseResult(result);
            expect(data.waitingFor.length).toBe(2);
            expect(data.waitingFor.some((n: { name: string }) => n.name === 'Nation Alpha')).toBe(true);
            expect(data.waitingFor.some((n: { name: string }) => n.name === 'Nation Beta')).toBe(true);
        });

        it('should return error if not initialized', async () => {
            const newWorldId = randomUUID();
            const db = getDb(':memory:');
            const worldRepo = new WorldRepository(db);
            worldRepo.create({
                id: newWorldId,
                name: 'Uninitialized World',
                seed: '99999',
                width: 50,
                height: 50,
                tileData: '{}',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });

            const result = await handleTurnManage({
                action: 'get_status',
                worldId: newWorldId
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe(true);
            expect(data.message).toContain('not initialized');
        });

        it('should accept "status" alias', async () => {
            const result = await handleTurnManage({
                action: 'status',
                worldId: testWorldId
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('get_status');
        });
    });

    describe('submit_actions action', () => {
        beforeEach(async () => {
            await handleTurnManage({
                action: 'init',
                worldId: testWorldId
            }, ctx);
        });

        it('should submit actions for a nation', async () => {
            const result = await handleTurnManage({
                action: 'submit_actions',
                worldId: testWorldId,
                nationId: testNationId,
                actions: [
                    { type: 'claim_region', regionId: testRegionId, justification: 'Strategic importance' },
                    { type: 'declare_intent', intent: 'Peaceful expansion' }
                ]
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('submit_actions');
            expect(data.nationName).toBe('Nation Alpha');
            expect(data.actionsSubmitted).toBe(2);
            expect(data.processedActions.length).toBe(2);
        });

        it('should process alliance proposal', async () => {
            const result = await handleTurnManage({
                action: 'submit_actions',
                worldId: testWorldId,
                nationId: testNationId,
                actions: [
                    { type: 'propose_alliance', toNationId: testNation2Id }
                ]
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.processedActions).toContain(`Alliance proposed to ${testNation2Id}`);
        });

        it('should return error if not in planning phase', async () => {
            // This test is harder to trigger since phase only changes when all nations are ready
            // For now, test the basic error case with non-existent world
            const result = await handleTurnManage({
                action: 'submit_actions',
                worldId: 'non-existent',
                nationId: testNationId,
                actions: []
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe(true);
        });

        it('should return error for non-existent nation', async () => {
            const result = await handleTurnManage({
                action: 'submit_actions',
                worldId: testWorldId,
                nationId: 'non-existent',
                actions: []
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe(true);
        });

        it('should accept "submit" alias', async () => {
            const result = await handleTurnManage({
                action: 'submit',
                worldId: testWorldId,
                nationId: testNationId,
                actions: []
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('submit_actions');
        });
    });

    describe('mark_ready action', () => {
        beforeEach(async () => {
            await handleTurnManage({
                action: 'init',
                worldId: testWorldId
            }, ctx);
        });

        it('should mark a nation as ready', async () => {
            const result = await handleTurnManage({
                action: 'mark_ready',
                worldId: testWorldId,
                nationId: testNationId
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('mark_ready');
            expect(data.nationName).toBe('Nation Alpha');
            expect(data.allReady).toBe(false);
            expect(data.nationsReady).toBe(1);
            expect(data.totalNations).toBe(2);
        });

        it('should auto-resolve turn when all nations ready', async () => {
            // Mark first nation ready
            await handleTurnManage({
                action: 'mark_ready',
                worldId: testWorldId,
                nationId: testNationId
            }, ctx);

            // Mark second nation ready - should trigger resolution
            const result = await handleTurnManage({
                action: 'mark_ready',
                worldId: testWorldId,
                nationId: testNation2Id
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.allReady).toBe(true);
            expect(data.turnResolved).toBe(1);
            expect(data.nextTurn).toBe(2);
        });

        it('should return error for non-existent nation', async () => {
            const result = await handleTurnManage({
                action: 'mark_ready',
                worldId: testWorldId,
                nationId: 'non-existent'
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe(true);
        });

        it('should accept "ready" alias', async () => {
            const result = await handleTurnManage({
                action: 'ready',
                worldId: testWorldId,
                nationId: testNationId
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('mark_ready');
        });
    });

    describe('poll_results action', () => {
        beforeEach(async () => {
            await handleTurnManage({
                action: 'init',
                worldId: testWorldId
            }, ctx);
        });

        it('should show turn not resolved if still in planning', async () => {
            const result = await handleTurnManage({
                action: 'poll_results',
                worldId: testWorldId,
                turnNumber: 1
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('poll_results');
            expect(data.resolved).toBe(false);
            expect(data.phase).toBe('planning');
        });

        it('should show turn resolved after all nations ready', async () => {
            // Mark both nations ready to trigger turn resolution
            await handleTurnManage({
                action: 'mark_ready',
                worldId: testWorldId,
                nationId: testNationId
            }, ctx);
            await handleTurnManage({
                action: 'mark_ready',
                worldId: testWorldId,
                nationId: testNation2Id
            }, ctx);

            // Poll for turn 1 results
            const result = await handleTurnManage({
                action: 'poll_results',
                worldId: testWorldId,
                turnNumber: 1
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.resolved).toBe(true);
            expect(data.nextTurn).toBe(2);
        });

        it('should handle future turn numbers', async () => {
            const result = await handleTurnManage({
                action: 'poll_results',
                worldId: testWorldId,
                turnNumber: 5  // Future turn
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.resolved).toBe(false);
            expect(data.message).toContain('future');
        });

        it('should return error for non-existent world', async () => {
            const result = await handleTurnManage({
                action: 'poll_results',
                worldId: 'non-existent',
                turnNumber: 1
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe(true);
        });

        it('should accept "results" alias', async () => {
            const result = await handleTurnManage({
                action: 'results',
                worldId: testWorldId,
                turnNumber: 1
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('poll_results');
        });
    });

    describe('full turn cycle', () => {
        it('should complete a full turn cycle', async () => {
            // 1. Initialize
            const initResult = await handleTurnManage({
                action: 'init',
                worldId: testWorldId
            }, ctx);
            expect(parseResult(initResult).currentTurn).toBe(1);

            // 2. Both nations submit actions
            await handleTurnManage({
                action: 'submit_actions',
                worldId: testWorldId,
                nationId: testNationId,
                actions: [{ type: 'declare_intent', intent: 'Peace' }]
            }, ctx);

            await handleTurnManage({
                action: 'submit_actions',
                worldId: testWorldId,
                nationId: testNation2Id,
                actions: [{ type: 'claim_region', regionId: testRegionId }]
            }, ctx);

            // 3. Both mark ready
            await handleTurnManage({
                action: 'mark_ready',
                worldId: testWorldId,
                nationId: testNationId
            }, ctx);

            const readyResult = await handleTurnManage({
                action: 'mark_ready',
                worldId: testWorldId,
                nationId: testNation2Id
            }, ctx);

            // Turn should have resolved
            expect(parseResult(readyResult).allReady).toBe(true);
            expect(parseResult(readyResult).nextTurn).toBe(2);

            // 4. Check status for turn 2
            const statusResult = await handleTurnManage({
                action: 'get_status',
                worldId: testWorldId
            }, ctx);

            expect(parseResult(statusResult).currentTurn).toBe(2);
            expect(parseResult(statusResult).phase).toBe('planning');
            expect(parseResult(statusResult).nationsReady).toBe(0);
        });
    });

    describe('fuzzy matching', () => {
        it('should auto-correct close typos', async () => {
            const result = await handleTurnManage({
                action: 'ini',  // Incomplete
                worldId: testWorldId
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('init');
        });

        it('should provide helpful error for unknown action', async () => {
            const result = await handleTurnManage({
                action: 'xyz',
                worldId: testWorldId
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe('invalid_action');
            expect(data.message).toContain('Unknown action');
        });
    });

    describe('output formatting', () => {
        beforeEach(async () => {
            await handleTurnManage({
                action: 'init',
                worldId: testWorldId
            }, ctx);
        });

        it('should include rich text formatting', async () => {
            const result = await handleTurnManage({
                action: 'get_status',
                worldId: testWorldId
            }, ctx);

            const text = result.content[0].text;
            expect(text.toUpperCase()).toContain('TURN STATUS');
        });

        it('should embed JSON for parsing', async () => {
            const result = await handleTurnManage({
                action: 'get_status',
                worldId: testWorldId
            }, ctx);

            const text = result.content[0].text;
            expect(text).toContain('<!-- TURN_MANAGE_JSON');
        });
    });
});
