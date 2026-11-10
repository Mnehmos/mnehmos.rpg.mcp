import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { handleCreateEncounter, handleExecuteCombatAction, clearCombatState } from '../../src/server/handlers/combat-handlers.js';
import { handleStrategyManage } from '../../src/server/consolidated/strategy-manage.js';
import { closeDb, getDb } from '../../src/storage/index.js';
import { CharacterRepository } from '../../src/storage/repos/character.repo.js';
import { WorldRepository } from '../../src/storage/repos/world.repo.js';
import { getInitialSpellSlots } from '../../src/engine/magic/spell-validator.js';

const ctx = { sessionId: 'test-session' } as any;
const STATS = { str: 10, dex: 10, con: 10, int: 18, wis: 10, cha: 10 };
const now = () => new Date().toISOString();

describe('spell rolls follow the encounter seed', () => {
    beforeEach(() => {
        closeDb();
        getDb(':memory:');
        clearCombatState();
    });

    /** One Fireball at two targets in a fresh encounter with the given seed. */
    async function castFireball(seed: string): Promise<string[]> {
        const id = randomUUID();
        new CharacterRepository(getDb()).create({
            id, name: 'Wiz', stats: STATS, hp: 30, maxHp: 30, ac: 12, level: 5,
            characterClass: 'wizard', knownSpells: ['Fireball'], preparedSpells: ['Fireball'], cantripsKnown: ['Fire Bolt'],
            spellSlots: getInitialSpellSlots('wizard' as any, 5), maxSpellLevel: 3, conditions: [],
            createdAt: now(), updatedAt: now(),
        } as any);
        const created = await handleCreateEncounter({
            seed,
            participants: [
                { id, name: 'Wiz', hp: 30, maxHp: 30, initiativeBonus: 50 },
                { id: `a-${id}`, name: 'A', hp: 500, maxHp: 500, initiativeBonus: 0, isEnemy: true, ac: 13 },
                { id: `b-${id}`, name: 'B', hp: 500, maxHp: 500, initiativeBonus: 0, isEnemy: true, ac: 13 },
            ],
        }, ctx);
        const encounterId = created.content[0].text.match(/Encounter ID: (encounter-[^\n`]+)/)![1];
        const outcome = (text: string) => text.split('<!--')[0].replace(new RegExp(id, 'g'), 'ID').replace(/encounter-\S+/g, 'ENC');

        const fireball = await handleExecuteCombatAction({
            encounterId, action: 'cast_spell', actorId: id, spellName: 'Fireball', slotLevel: 3, targetIds: [`a-${id}`, `b-${id}`],
        }, ctx);
        return [outcome(fireball.content[0].text)];
    }

    it('the same seed gives the same damage and saves', async () => {
        const first = await castFireball('replay-me');
        const second = await castFireball('replay-me');
        expect(second).toEqual(first);
    });

    it('a different seed gives a different result', async () => {
        const results = new Set<string>();
        for (const seed of ['s1', 's2', 's3', 's4', 's5']) results.add((await castFireball(seed)).join());
        expect(results.size).toBeGreaterThan(1);
    });
});

describe('a strategy turn is resolved once', () => {
    let worldId: string;
    beforeEach(() => {
        closeDb();
        const db = getDb(':memory:');
        worldId = randomUUID();
        new WorldRepository(db).create({ id: worldId, name: 'W', seed: 's', width: 20, height: 20, createdAt: now(), updatedAt: now() } as any);
    });
    const data = (result: any) => {
        const text = result.content[0].text;
        const match = text.match(/<!-- STRATEGY_MANAGE_JSON\n([\s\S]*?)\nSTRATEGY_MANAGE_JSON -->/);
        return JSON.parse(match ? match[1] : text);
    };
    const resolve = async (turnNumber: number) => data(await handleStrategyManage({ action: 'resolve_turn', worldId, turnNumber }, ctx));
    const food = async (nationId: string) =>
        data(await handleStrategyManage({ action: 'get_state', worldId, nationId, viewType: 'private' }, ctx));

    it('refuses to resolve the same turn twice, so the economy is not applied twice', async () => {
        const nation = data(await handleStrategyManage({
            action: 'create_nation', worldId, name: 'N', leader: 'L', ideology: 'democracy', aggression: 50, trust: 50, paranoia: 50,
        }, ctx));
        const nationId = nation.nationId ?? nation.nation?.id ?? nation.id;

        expect((await resolve(1)).success).toBe(true);
        const afterFirst = JSON.stringify(await food(nationId));

        const again = await resolve(1);
        expect(again.error).toBe(true);
        expect(again.message).toMatch(/already resolved/i);
        expect(JSON.stringify(await food(nationId))).toBe(afterFirst);
    });

    it('refuses an earlier turn, and accepts later ones', async () => {
        expect((await resolve(3)).success).toBe(true);
        expect((await resolve(2)).error).toBe(true);
        expect((await resolve(4)).success).toBe(true);
    });

    it('tracks each world separately', async () => {
        const other = randomUUID();
        new WorldRepository(getDb()).create({ id: other, name: 'O', seed: 's', width: 20, height: 20, createdAt: now(), updatedAt: now() } as any);
        expect((await resolve(1)).success).toBe(true);
        expect(data(await handleStrategyManage({ action: 'resolve_turn', worldId: other, turnNumber: 1 }, ctx)).success).toBe(true);
    });
});

describe('a campaign has a world size budget', () => {
    afterEach(() => { delete process.env.RPG_MAX_WORLD_TILES_PER_CAMPAIGN; });
    const world = (side: number) => ({ id: randomUUID(), name: 'W', seed: 's', width: side, height: side, createdAt: now(), updatedAt: now() } as any);

    it('refuses a world that would take the campaign over its tile budget', () => {
        process.env.RPG_MAX_WORLD_TILES_PER_CAMPAIGN = '2500000';
        closeDb();
        const repo = new WorldRepository(getDb(':memory:'));
        repo.create(world(1000));
        repo.create(world(1000));

        expect(() => repo.create(world(1000))).toThrow(/world size budget/i);
        expect(repo.findAll()).toHaveLength(2);
    });

    it('frees budget when a world is deleted', () => {
        process.env.RPG_MAX_WORLD_TILES_PER_CAMPAIGN = '1500000';
        closeDb();
        const repo = new WorldRepository(getDb(':memory:'));
        const first = world(1000);
        repo.create(first);
        expect(() => repo.create(world(1000))).toThrow(/world size budget/i);
        repo.delete(first.id);
        expect(() => repo.create(world(1000))).not.toThrow();
    });

    it('leaves ordinary campaigns alone', () => {
        closeDb();
        const repo = new WorldRepository(getDb(':memory:'));
        for (let i = 0; i < 30; i++) repo.create(world(100));
        expect(repo.findAll()).toHaveLength(30);
    });
});
