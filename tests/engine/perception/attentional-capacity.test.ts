/**
 * Attentional-capacity arithmetic — debit, refill, max-by-level.
 */

import {
    maxByLevel,
    debit,
    refill,
    read,
    ensurePool,
    ATTENTIONAL_CAPACITY_KEY,
} from '../../../src/engine/perception/attentional-capacity.js';
import { getDb, closeDb } from '../../../src/storage/index.js';
import { CharacterRepository } from '../../../src/storage/repos/character.repo.js';
import { randomUUID } from 'crypto';

function makeCharacter(repo: CharacterRepository, level: number): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    repo.create({
        id, name: 'X', characterType: 'pc', level,
        hp: 10, maxHp: 10, ac: 10,
        stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
        createdAt: now, updatedAt: now,
    });
    return id;
}

describe('attentional-capacity', () => {
    let db: ReturnType<typeof getDb>;
    let repo: CharacterRepository;

    beforeEach(() => {
        closeDb();
        db = getDb(':memory:');
        repo = new CharacterRepository(db);
    });

    describe('maxByLevel', () => {
        it('returns 3 at L1-L4, 4 at L5-L8, 5 at L9-L12, 6 at L13+', () => {
            expect(maxByLevel(1)).toBe(3);
            expect(maxByLevel(4)).toBe(3);
            expect(maxByLevel(5)).toBe(4);
            expect(maxByLevel(8)).toBe(4);
            expect(maxByLevel(9)).toBe(5);
            expect(maxByLevel(12)).toBe(5);
            expect(maxByLevel(13)).toBe(6);
            expect(maxByLevel(20)).toBe(6);
        });

        it('caps at 6 — no omniscience', () => {
            expect(maxByLevel(100)).toBe(6);
        });
    });

    describe('ensurePool', () => {
        it('initialises pool to max for a fresh observer', () => {
            const id = makeCharacter(repo, 5);
            expect(ensurePool(id, repo)).toBe(true);
            const c = repo.findById(id);
            expect(c?.resourcePools?.[ATTENTIONAL_CAPACITY_KEY]).toEqual(
                expect.objectContaining({ current: 4, max: 4 }),
            );
        });

        it('is idempotent on already-initialised observer', () => {
            const id = makeCharacter(repo, 1);
            ensurePool(id, repo);
            expect(ensurePool(id, repo)).toBe(false);
        });
    });

    describe('debit / refill', () => {
        it('debit decrements current; refill restores to max', () => {
            const id = makeCharacter(repo, 1);
            ensurePool(id, repo);
            const after1 = debit(id, repo);
            expect(after1.before).toBe(3);
            expect(after1.after).toBe(2);
            const after2 = debit(id, repo);
            expect(after2.after).toBe(1);

            const r = refill(id, repo);
            expect(r.before).toBe(1);
            expect(r.after).toBe(3);
            expect(r.mutated).toBe(true);
        });

        it('refill on full pool is no-op (mutated=false)', () => {
            const id = makeCharacter(repo, 1);
            ensurePool(id, repo);
            const r = refill(id, repo);
            expect(r.mutated).toBe(false);
            expect(r.before).toBe(3);
            expect(r.after).toBe(3);
        });

        it('debit throws when insufficient capacity', () => {
            const id = makeCharacter(repo, 1);
            ensurePool(id, repo);
            debit(id, repo);
            debit(id, repo);
            debit(id, repo);
            expect(() => debit(id, repo)).toThrow();
        });
    });

    describe('read', () => {
        it('returns default max (3) when pool not initialised', () => {
            const id = makeCharacter(repo, 1);
            const cap = read(id, repo);
            expect(cap?.current).toBe(0);
            expect(cap?.max).toBe(3);
        });

        it('returns max=4 at L5 even before pool is initialised', () => {
            const id = makeCharacter(repo, 5);
            const cap = read(id, repo);
            expect(cap?.max).toBe(4);
        });
    });
});
