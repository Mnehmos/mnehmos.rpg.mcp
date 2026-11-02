/**
 * All-or-nothing tool calls (#108).
 *
 * A turn either happened or it didn't: every write a tool call makes commits
 * together or not at all, and in-memory state and notifications follow suit.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '../../src/storage/index.js';
import { atomic, savepoint, afterCommit, serialized } from '../../src/storage/unit-of-work.js';
import { PubSub } from '../../src/engine/pubsub.js';
import { CombatManager } from '../../src/server/state/combat-manager.js';
import { CombatEngine } from '../../src/engine/combat/engine.js';
import { formatMcpError } from '../../src/utils/action-router.js';

process.env.NODE_ENV = 'test';

function setup() {
    const db = getDb(':memory:');
    db.exec('CREATE TABLE IF NOT EXISTS uow_probe (id INTEGER PRIMARY KEY, label TEXT NOT NULL)');
    db.exec('DELETE FROM uow_probe');
    return db;
}

function labels(): string[] {
    return (getDb().prepare('SELECT label FROM uow_probe ORDER BY id').all() as Array<{ label: string }>).map(r => r.label);
}

function write(label: string) {
    getDb().prepare('INSERT INTO uow_probe (label) VALUES (?)').run(label);
}

const tick = () => new Promise(resolve => setTimeout(resolve, 5));

describe('unit of work', () => {
    beforeEach(() => {
        closeDb();
        setup();
    });
    afterEach(() => closeDb());

    it('commits every write of a successful call together', async () => {
        await atomic(async () => {
            write('potion leaves inventory');
            await tick();
            write('hp restored');
        });
        expect(labels()).toEqual(['potion leaves inventory', 'hp restored']);
    });

    it('rolls back every write when the call throws partway (the drink-then-Dash tear)', async () => {
        await expect(atomic(async () => {
            write('potion leaves inventory');
            write('hp restored');
            await tick();
            throw new Error('Dashed into a wall');
        })).rejects.toThrow('Dashed into a wall');

        expect(labels()).toEqual([]);
    });

    it('rolls back when the call returns an isError response instead of throwing', async () => {
        const result = await atomic(async () => {
            write('half a turn');
            return formatMcpError('bad tile id', { action: 'move' });
        });

        expect(result.isError).toBe(true);
        expect(labels()).toEqual([]);
    });

    it('serializes units on one connection so a rollback never eats another call\'s work', async () => {
        const order: string[] = [];

        const failing = atomic(async () => {
            order.push('A start');
            write('A');
            await tick();
            await tick();
            order.push('A throw');
            throw new Error('A fails');
        }).catch(() => undefined);

        const succeeding = atomic(async () => {
            order.push('B start');
            write('B');
        });

        await Promise.all([failing, succeeding]);

        // B waited for A to finish, so B was never inside A's transaction.
        expect(order).toEqual(['A start', 'A throw', 'B start']);
        expect(labels()).toEqual(['B']);
    });

    it('nested atomic calls join the outer unit instead of committing early', async () => {
        await expect(atomic(async () => {
            await atomic(async () => { write('inner'); });
            throw new Error('outer fails');
        })).rejects.toThrow();

        expect(labels()).toEqual([]);
    });

    it('savepoints undo only their own writes', async () => {
        await atomic(async () => {
            write('kept');
            await savepoint(async () => {
                write('undone');
                throw new Error('step failed');
            }).catch(() => undefined);
            write('also kept');
        });

        expect(labels()).toEqual(['kept', 'also kept']);
    });

    it('serialized() is re-entrant and does not deadlock with atomic() inside it', async () => {
        await serialized(async () => {
            await atomic(async () => { write('inside lock'); });
        });
        expect(labels()).toEqual(['inside lock']);
    });

    it('defers side effects until commit and drops them on rollback', async () => {
        const fired: string[] = [];

        await atomic(async () => {
            afterCommit(() => fired.push('committed'));
            expect(fired).toEqual([]);
        });
        expect(fired).toEqual(['committed']);

        await atomic(async () => {
            afterCommit(() => fired.push('should not fire'));
            throw new Error('rolled back');
        }).catch(() => undefined);
        expect(fired).toEqual(['committed']);
    });

    it('does not deliver pubsub notifications for a rolled-back call', async () => {
        const pubsub = new PubSub();
        const seen: unknown[] = [];
        pubsub.subscribe('combat', payload => seen.push(payload));

        await atomic(async () => {
            pubsub.publish('combat', { type: 'ghost' });
            throw new Error('rolled back');
        }).catch(() => undefined);
        expect(seen).toEqual([]);

        await atomic(async () => {
            pubsub.publish('combat', { type: 'real' });
        });
        expect(seen).toEqual([{ type: 'real' }]);
    });

    it('restores in-memory combat state when the call rolls back', async () => {
        const manager = new CombatManager();
        const engine = new CombatEngine('enc-1');
        engine.loadState({ round: 1, currentTurnIndex: 0, turnOrder: ['rogue'], participants: [{ id: 'rogue', hp: 5 }] } as any);
        manager.create('s:enc-1', engine);

        await atomic(async () => {
            const live = manager.get('s:enc-1')!;
            const state = live.getState() as any;
            state.participants[0].hp = 12;       // potion
            state.currentTurnIndex = 1;          // turn advanced
            manager.create('s:enc-2', new CombatEngine('enc-2')); // created mid-call
            throw new Error('Dash into a wall');
        }).catch(() => undefined);

        const after = manager.get('s:enc-1')!.getState() as any;
        expect(after.participants[0].hp).toBe(5);
        expect(after.currentTurnIndex).toBe(0);
        expect(manager.get('s:enc-2')).toBeNull();
    });

    it('rewinds the dice with the state, so a retried action rolls the same', async () => {
        const manager = new CombatManager();
        const engine = new CombatEngine('dice-seed');
        engine.loadState({ round: 1, currentTurnIndex: 0, turnOrder: [], participants: [] } as any);
        manager.create('s:enc-1', engine);
        const rng = (e: CombatEngine) => (e as any).rng;

        let firstTry = 0;
        await atomic(async () => {
            firstTry = rng(manager.get('s:enc-1')!).roll('1d20');
            throw new Error('rolled back');
        }).catch(() => undefined);

        const retry = rng(manager.get('s:enc-1')!).roll('1d20');
        expect(retry).toBe(firstTry);
    });

    it('keeps rollback hooks separate for two managers guarding the same id', async () => {
        const a = new CombatManager();
        const b = new CombatManager();
        for (const m of [a, b]) {
            const e = new CombatEngine('x');
            e.loadState({ round: 1, currentTurnIndex: 0, turnOrder: [], participants: [] } as any);
            m.create('s:enc-1', e);
        }

        await atomic(async () => {
            (a.get('s:enc-1')!.getState() as any).round = 9;
            (b.get('s:enc-1')!.getState() as any).round = 9;
            throw new Error('rolled back');
        }).catch(() => undefined);

        expect((a.get('s:enc-1')!.getState() as any).round).toBe(1);
        expect((b.get('s:enc-1')!.getState() as any).round).toBe(1);
    });

    it('delivers transactional subscribers inside the transaction and live ones after commit', async () => {
        const pubsub = new PubSub();
        const order: string[] = [];
        pubsub.subscribe('world', () => order.push(`inbox (inTransaction=${getDb().inTransaction})`), { transactional: true });
        pubsub.subscribe('world', () => order.push(`live (inTransaction=${getDb().inTransaction})`));

        await atomic(async () => { pubsub.publish('world', { type: 'x' }); });

        expect(order).toEqual(['inbox (inTransaction=true)', 'live (inTransaction=false)']);
    });

    it('brings back an engine deleted by a rolled-back call', async () => {
        const manager = new CombatManager();
        const engine = new CombatEngine('enc-1');
        engine.loadState({ round: 3, currentTurnIndex: 0, turnOrder: [], participants: [] } as any);
        manager.create('s:enc-1', engine);

        await atomic(async () => {
            manager.delete('s:enc-1');
            throw new Error('end_encounter failed after delete');
        }).catch(() => undefined);

        expect((manager.get('s:enc-1')!.getState() as any).round).toBe(3);
    });
});

describe('router errors', () => {
    it('formatMcpError sets isError so callers can tell a failure from a success', () => {
        expect(formatMcpError('nope', {}).isError).toBe(true);
    });
});
