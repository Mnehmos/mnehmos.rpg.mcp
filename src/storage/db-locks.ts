import { AsyncLocalStorage } from 'node:async_hooks';
import type Database from 'better-sqlite3';

/**
 * One lock per database connection.
 *
 * Lives apart from the unit of work so the handle pool can ask "is a call
 * running on this connection?" before closing it, without the two modules
 * importing each other.
 */
interface LockScope {
    db: Database.Database;
}

const lockStore = new AsyncLocalStorage<LockScope>();
const locks = new WeakMap<Database.Database, Promise<void>>();

/** True while a call holds, or is queued for, this connection's lock. */
export function isDatabaseBusy(db: Database.Database): boolean {
    return locks.has(db);
}

/**
 * Run `fn` holding `db`'s lock. Calls on one connection run one at a time, in
 * arrival order. Re-entrant within one async context, so a holder that asks
 * again does not deadlock on itself.
 */
export async function withDatabaseLock<T>(db: Database.Database, fn: () => Promise<T>): Promise<T> {
    const held = lockStore.getStore();
    if (held && held.db === db) return fn();

    const previous = locks.get(db) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    const tail = previous.then(() => current);
    locks.set(db, tail);

    await previous;
    try {
        return await lockStore.run({ db }, fn);
    } finally {
        release();
        if (locks.get(db) === tail) locks.delete(db);
    }
}
