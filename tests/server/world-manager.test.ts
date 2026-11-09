import { describe, it, expect, afterEach } from 'vitest';
import { WorldManager } from '../../src/server/state/world-manager';
import { runInTenant } from '../../src/storage/tenant-context';
import type { GeneratedWorld } from '../../src/engine/worldgen/index';

const A = { accountId: 'acct-a', campaignId: '11111111-1111-4111-8111-111111111111' };
const B = { accountId: 'acct-b', campaignId: '22222222-2222-4222-8222-222222222222' };
const world = (label: string) => ({ label } as unknown as GeneratedWorld);

describe('WorldManager', () => {
    afterEach(() => { delete process.env.RPG_MAX_CACHED_WORLDS; });

    it('keeps each campaign\'s worlds to itself', () => {
        const manager = new WorldManager();
        // World ids are world-<seed>-<timestamp>: guessable, so the id alone
        // must not be enough to read another campaign's world.
        runInTenant(A, () => manager.create('world-42-1', world('a')));

        expect(runInTenant(B, () => manager.get('world-42-1'))).toBeNull();
        expect(runInTenant(B, () => manager.list())).toEqual([]);
        expect(manager.get('world-42-1')).toBeNull();
        expect(runInTenant(A, () => manager.get('world-42-1'))).toEqual(world('a'));
    });

    it('lets two campaigns use the same world id without colliding', () => {
        const manager = new WorldManager();
        runInTenant(A, () => manager.create('world-42-1', world('a')));
        expect(() => runInTenant(B, () => manager.create('world-42-1', world('b')))).not.toThrow();

        runInTenant(B, () => manager.delete('world-42-1'));
        expect(runInTenant(A, () => manager.get('world-42-1'))).toEqual(world('a'));
    });

    it('still refuses a duplicate id within one campaign', () => {
        const manager = new WorldManager();
        runInTenant(A, () => manager.create('w', world('a')));
        expect(() => runInTenant(A, () => manager.create('w', world('again')))).toThrow(/already exists/);
    });

    it('holds a bounded number of worlds, dropping the least recently used', () => {
        process.env.RPG_MAX_CACHED_WORLDS = '2';
        const manager = new WorldManager();
        manager.create('w1', world('1'));
        manager.create('w2', world('2'));
        manager.get('w1'); // w2 is now the least recently used
        manager.create('w3', world('3'));

        expect(manager.get('w2')).toBeNull();
        expect(manager.get('w1')).toEqual(world('1'));
        expect(manager.get('w3')).toEqual(world('3'));
    });
});
