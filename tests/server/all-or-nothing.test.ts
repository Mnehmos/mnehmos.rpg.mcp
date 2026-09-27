/**
 * #108 / #95 follow-ups: batch_manage, the event inbox, and one writer per table.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb, useSingleUserDatabase } from '../../src/storage/index.js';
import { handleBatchManage } from '../../src/server/consolidated/batch-manage.js';
import { CharacterRepository } from '../../src/storage/repos/character.repo.js';
import { EventInboxRepository } from '../../src/storage/repos/event-inbox.repo.js';
import { ItemRepository } from '../../src/storage/repos/item.repo.js';
import { CorpseRepository } from '../../src/storage/repos/corpse.repo.js';
import { PubSub } from '../../src/engine/pubsub.js';
import { CombatEngine } from '../../src/engine/combat/engine.js';
import { registerEventInboxBridge } from '../../src/server/events.js';
import { parseToolResponse, responseFailure, withErrorFlag } from '../../src/utils/tool-response.js';
import { atomicHandler } from '../../src/server/types.js';

process.env.NODE_ENV = 'test';

const ctx = { sessionId: 'test-session' };

function batchPayload(result: { content: Array<{ text: string }> }) {
    const match = result.content[0].text.match(/<!-- BATCH_MANAGE_JSON\n([\s\S]*?)\nBATCH_MANAGE_JSON -->/);
    return JSON.parse(match![1]);
}

function characterNames(): string[] {
    return new CharacterRepository(getDb()).findAll().map(c => c.name).sort();
}

describe('batch_manage execute_sequence', () => {
    beforeEach(() => {
        closeDb();
        getDb(':memory:');
    });
    afterEach(() => closeDb());

    it('reports a failed step as failed (it used to print ✅ for everything)', async () => {
        const result = await handleBatchManage({
            action: 'execute_sequence',
            stopOnError: false,
            steps: [{ tool: 'character_manage', args: { action: 'get', characterId: 'does-not-exist' } }]
        }, ctx);

        const payload = batchPayload(result as any);
        expect(payload.failureCount).toBe(1);
        expect(payload.steps[0].success).toBe(false);
        expect(payload.steps[0].error).toMatch(/not found/i);
    });

    it('passes results between steps through {{step.field}} references', async () => {
        const result = await handleBatchManage({
            action: 'execute_sequence',
            steps: [
                { id: 'hero', tool: 'character_manage', args: { action: 'create', name: 'Vex', race: 'Halfling' } },
                { id: 'again', tool: 'character_manage', args: { action: 'get', characterId: '{{hero.id}}' } }
            ]
        }, ctx);

        const payload = batchPayload(result as any);
        expect(payload.failureCount).toBe(0);
        expect(payload.stepResults.again.name).toBe('Vex');
        expect((result as any).isError).toBeUndefined();
    });

    it('fails a step whose reference does not resolve instead of passing undefined along', async () => {
        const result = await handleBatchManage({
            action: 'execute_sequence',
            steps: [
                { id: 'hero', tool: 'character_manage', args: { action: 'create', name: 'Vex', race: 'Halfling' } },
                { tool: 'character_manage', args: { action: 'get', characterId: '{{hero.noSuchField}}' } }
            ]
        }, ctx);

        const payload = batchPayload(result as any);
        expect(payload.steps[1].success).toBe(false);
        expect(payload.steps[1].error).toContain('hero.noSuchField');
    });

    it('stopOnError (default): a failure undoes every earlier step — nothing is applied', async () => {
        const result = await handleBatchManage({
            action: 'execute_sequence',
            steps: [
                { tool: 'character_manage', args: { action: 'create', name: 'Vex', race: 'Halfling' } },
                { tool: 'character_manage', args: { action: 'create', name: 'Brakka', race: 'Orc' } },
                { tool: 'character_manage', args: { action: 'get', characterId: 'wall' } }
            ]
        }, ctx);

        const payload = batchPayload(result as any);
        expect(payload.rolledBack).toBe(true);
        expect((result as any).isError).toBe(true);
        expect(characterNames()).toEqual([]);
    });

    it('stopOnError=false: successful steps stand, the failed step leaves nothing behind', async () => {
        const result = await handleBatchManage({
            action: 'execute_sequence',
            stopOnError: false,
            steps: [
                { tool: 'character_manage', args: { action: 'create', name: 'Vex', race: 'Halfling' } },
                { tool: 'character_manage', args: { action: 'get', characterId: 'wall' } },
                { tool: 'character_manage', args: { action: 'create', name: 'Brakka', race: 'Orc' } }
            ]
        }, ctx);

        const payload = batchPayload(result as any);
        expect(payload.rolledBack).toBe(false);
        expect(payload.successCount).toBe(2);
        expect(characterNames()).toEqual(['Brakka', 'Vex']);
    });
});

describe('tool responses', () => {
    it('parses RichFormatter embedded JSON blocks', () => {
        const text = 'Hello\n<!-- CHARACTER_MANAGE_JSON\n{"id":"abc","error":true,"message":"nope"}\nCHARACTER_MANAGE_JSON -->\n';
        const parsed = parseToolResponse({ content: [{ type: 'text', text }] });
        expect(parsed.id).toBe('abc');
        expect(responseFailure({ content: [{ type: 'text', text }] })).toBe('nope');
    });

    it('flags rich-text error responses with isError', () => {
        const text = 'x\n<!-- X_JSON\n{"error":"validation_error"}\nX_JSON -->';
        expect(withErrorFlag({ content: [{ type: 'text', text }] }).isError).toBe(true);
        expect(withErrorFlag({ content: [{ type: 'text', text: '{"ok":true}' }] })).not.toHaveProperty('isError');
    });

    it('rolls back a tool call that reports an error in its payload without throwing', async () => {
        closeDb();
        getDb(':memory:');
        const handler = atomicHandler(async () => {
            new CharacterRepository(getDb()).create({
                id: '11111111-1111-4111-8111-111111111111', name: 'Half a turn', race: 'Human',
                characterClass: 'Fighter', characterType: 'pc', level: 1, hp: 10, maxHp: 10, ac: 10,
                stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
                createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
            } as any);
            return { content: [{ type: 'text', text: 'boom\n<!-- T_JSON\n{"error":true,"message":"boom"}\nT_JSON -->' }] };
        });

        const response = await handler({});
        expect(response.isError).toBe(true);
        expect(characterNames()).toEqual([]);
        closeDb();
    });
});

describe('event inbox (#95 review findings)', () => {
    afterEach(() => closeDb());

    it('pollAndConsume claims each event exactly once', () => {
        closeDb();
        const repo = new EventInboxRepository(getDb(':memory:'));
        repo.push({ eventType: 'world_change', sourceType: 'world', priority: 1, payload: { n: 1 } } as any);
        repo.push({ eventType: 'world_change', sourceType: 'world', priority: 1, payload: { n: 2 } } as any);

        const first = repo.pollAndConsume(10);
        const second = repo.pollAndConsume(10);

        expect(first).toHaveLength(2);
        expect(first.every(e => typeof e.consumedAt === 'string')).toBe(true);
        expect(second).toHaveLength(0);
    });

    it('persists events on single-user transports, which carry no tenant', () => {
        closeDb();
        useSingleUserDatabase(':memory:');
        const pubsub = new PubSub();
        const unregister = registerEventInboxBridge(pubsub);

        pubsub.publish('combat', { type: 'attack_executed', encounterId: 'enc-1' });

        const events = new EventInboxRepository(getDb()).poll({ limit: 10 });
        expect(events).toHaveLength(1);
        expect(events[0].sourceId).toBe('enc-1');
        unregister();
    });

    it('combat engines stamp their encounter id on published events', () => {
        const pubsub = new PubSub();
        const seen: any[] = [];
        pubsub.subscribe('combat', payload => seen.push(payload));

        const engine = new CombatEngine('seed', pubsub, 'encounter-42');
        engine.startEncounter([
            { id: 'rogue', name: 'Rogue', initiativeBonus: 3, hp: 10, maxHp: 10, conditions: [] } as any
        ]);

        expect(seen.length).toBeGreaterThan(0);
        expect(seen[0].encounterId).toBe('encounter-42');
    });
});

describe('one writer per table', () => {
    beforeEach(() => {
        closeDb();
        getDb(':memory:');
    });
    afterEach(() => closeDb());

    it('harvested items are written by ItemRepository and keep their properties column', () => {
        const db = getDb();
        const now = new Date().toISOString();
        new CharacterRepository(db).create({
            id: '22222222-2222-4222-8222-222222222222', name: 'Ranger', race: 'Elf',
            characterClass: 'Ranger', characterType: 'pc', level: 1, hp: 10, maxHp: 10, ac: 10,
            stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
            createdAt: now, updatedAt: now
        } as any);
        new CharacterRepository(db).create({
            id: '33333333-3333-4333-8333-333333333333', name: 'Wolf', race: 'Beast',
            characterClass: 'Beast', characterType: 'enemy', level: 1, hp: 0, maxHp: 10, ac: 10,
            stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
            createdAt: now, updatedAt: now
        } as any);

        const corpses = new CorpseRepository(db);
        const corpse = corpses.createFromDeath('33333333-3333-4333-8333-333333333333', 'Wolf', 'enemy', { worldId: 'w' });
        db.prepare('UPDATE corpses SET harvestable = 1, harvestable_resources = ? WHERE id = ?')
            .run(JSON.stringify([{ resourceType: 'wolf pelt', quantity: 1, harvested: false }]), corpse.id);

        const result = corpses.harvestResource(corpse.id, 'wolf pelt', '22222222-2222-4222-8222-222222222222', { createItem: true });
        expect(result.success).toBe(true);

        const row = db.prepare('SELECT properties FROM items WHERE id = ?').get(result.itemId) as { properties: string | null };
        expect(row.properties).toBe('{}');
        expect(new ItemRepository(db).findById(result.itemId!)!.properties).toEqual({});
    });
});
