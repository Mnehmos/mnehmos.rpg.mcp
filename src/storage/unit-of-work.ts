import { AsyncLocalStorage } from 'node:async_hooks';
import type Database from 'better-sqlite3';
import { getDb } from './index.js';

/**
 * Unit of work: one tool call either happens or it doesn't.
 *
 * A single game action (drink a potion, then Dash) can touch many rows across
 * many repositories. Each repository write used to autocommit on its own, so a
 * throw halfway through left the first writes durable and the rest missing —
 * a state no rule produced. `atomic()` wraps the whole call in one SQLite
 * transaction and rolls every write back if the call fails.
 *
 * Three things make this more than `BEGIN` / `COMMIT`:
 *
 * 1. **Serialization.** better-sqlite3 has one connection per database and
 *    tool handlers are async. While one call awaits (an LLM request inside
 *    `next_turn`, say) with its transaction open, any other call writing to
 *    the same connection would silently join that transaction and be rolled
 *    back with it. So every unit holds a per-connection lock for its whole
 *    lifetime. Calls on the same campaign run one at a time; different
 *    campaigns (different connections) still run concurrently.
 *
 * 2. **In-memory state.** SQLite rolls back; a JavaScript object does not.
 *    Anything that caches authoritative state in memory (the combat engines)
 *    registers an undo with `onRollback()` the first time it is touched in a
 *    unit, and the undo restores the snapshot taken before the unit changed it.
 *
 * 3. **Side effects.** Notifications about a change must not escape before the
 *    change is durable. `afterCommit()` defers them until COMMIT; on rollback
 *    they are discarded.
 *
 * Savepoints give nested all-or-nothing scopes inside a unit (used by
 * `batch_manage` so a failed step can be undone on its own).
 */

type Hook = () => void;

interface Frame {
    /** Undo callbacks, run in reverse order if this frame rolls back. */
    rollback: Array<{ key?: string; undo: Hook }>;
    /** Keys already registered in this frame, so only the first snapshot is kept. */
    keys: Set<string>;
    /** Deferred side effects, run after the outermost COMMIT. */
    afterCommit: Hook[];
}

interface Unit {
    db: Database.Database;
    frames: Frame[];
    savepointSeq: number;
}

interface LockScope {
    db: Database.Database;
}

const unitStore = new AsyncLocalStorage<Unit>();
const lockStore = new AsyncLocalStorage<LockScope>();
const locks = new WeakMap<Database.Database, Promise<void>>();

function newFrame(): Frame {
    return { rollback: [], keys: new Set(), afterCommit: [] };
}

function currentFrame(): Frame | undefined {
    const unit = unitStore.getStore();
    return unit ? unit.frames[unit.frames.length - 1] : undefined;
}

/** Resolves the current request's database, or null when there is none (meta-tools with no tenant). */
function tryGetDb(): Database.Database | null {
    try {
        return getDb();
    } catch {
        return null;
    }
}

/** True while inside an open unit of work. */
export function inUnitOfWork(): boolean {
    return unitStore.getStore() !== undefined;
}

/**
 * Register an undo for in-memory state touched inside the current unit.
 *
 * `key` dedupes within a frame: only the first registration for a key is kept,
 * because only the first snapshot reflects the state before the unit began.
 * Outside a unit this is a no-op.
 */
export function onRollback(undo: Hook, key?: string): void {
    const frame = currentFrame();
    if (!frame) return;
    if (key !== undefined) {
        if (frame.keys.has(key)) return;
        frame.keys.add(key);
    }
    frame.rollback.push({ key, undo });
}

/**
 * Defer a side effect until the unit commits. Outside a unit it runs now.
 * Dropped if the unit (or the savepoint it was registered in) rolls back.
 */
export function afterCommit(effect: Hook): void {
    const frame = currentFrame();
    if (!frame) {
        effect();
        return;
    }
    frame.afterCommit.push(effect);
}

function runRollbackHooks(frame: Frame): void {
    for (let i = frame.rollback.length - 1; i >= 0; i--) {
        try {
            frame.rollback[i].undo();
        } catch (error) {
            console.error('[UnitOfWork] Rollback hook failed:', error);
        }
    }
}

function runAfterCommit(frame: Frame): void {
    for (const effect of frame.afterCommit) {
        try {
            effect();
        } catch (error) {
            console.error('[UnitOfWork] afterCommit hook failed:', error);
        }
    }
}

/** Fold a released savepoint's hooks into its parent. The parent's earlier snapshot wins. */
function mergeInto(parent: Frame, child: Frame): void {
    for (const entry of child.rollback) {
        if (entry.key !== undefined) {
            if (parent.keys.has(entry.key)) continue;
            parent.keys.add(entry.key);
        }
        parent.rollback.push(entry);
    }
    parent.afterCommit.push(...child.afterCommit);
}

/**
 * Hold the per-connection lock for the duration of `fn`.
 *
 * Re-entrant within one async context, so a unit that is already serialized
 * does not deadlock on itself. Exposed separately from `atomic()` so work that
 * must happen *after* commit or rollback (the audit log) still runs while no
 * other unit can have a transaction open on the connection.
 */
export async function serialized<T>(fn: () => Promise<T>): Promise<T> {
    const db = tryGetDb();
    if (!db) return fn();

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

export interface AtomicOptions<T> {
    /**
     * Treat a returned value as a failure. Tool handlers report most errors by
     * returning `{ isError: true }` rather than throwing, so the default checks
     * for exactly that.
     */
    isFailure?: (result: T) => boolean;
}

export function isErrorResponse(result: unknown): boolean {
    return typeof result === 'object' && result !== null && (result as { isError?: unknown }).isError === true;
}

/**
 * Run `fn` as one all-or-nothing unit.
 *
 * - Throws, or returns a failure (see `isFailure`): every database write is
 *   rolled back, in-memory undos run, deferred side effects are dropped.
 * - Otherwise: one COMMIT, then deferred side effects run.
 *
 * Nested calls join the enclosing unit. With no database in scope (a meta-tool
 * on an unscoped request) `fn` simply runs.
 */
export async function atomic<T>(fn: () => Promise<T>, options: AtomicOptions<T> = {}): Promise<T> {
    if (inUnitOfWork()) return fn();

    const isFailure = options.isFailure ?? isErrorResponse;

    return serialized(async () => {
        const db = tryGetDb();
        if (!db) return fn();

        if (db.inTransaction) {
            // Something outside the unit-of-work left a transaction open on this
            // connection. Joining it would tie our fate to code we can't see.
            throw new Error('[UnitOfWork] Connection already has an open transaction outside a unit of work.');
        }

        const unit: Unit = { db, frames: [newFrame()], savepointSeq: 0 };
        db.exec('BEGIN IMMEDIATE');

        let result: T;
        try {
            result = await unitStore.run(unit, fn);
        } catch (error) {
            rollbackUnit(unit);
            throw error;
        }

        if (isFailure(result)) {
            rollbackUnit(unit);
            return result;
        }

        try {
            db.exec('COMMIT');
        } catch (error) {
            rollbackUnit(unit);
            throw error;
        }
        runAfterCommit(unit.frames[0]);
        return result;
    });
}

function rollbackUnit(unit: Unit): void {
    try {
        if (unit.db.inTransaction) unit.db.exec('ROLLBACK');
    } catch (error) {
        console.error('[UnitOfWork] ROLLBACK failed:', error);
    }
    // Innermost frames first: a savepoint that never released still owns its undos.
    for (let i = unit.frames.length - 1; i >= 0; i--) runRollbackHooks(unit.frames[i]);
}

/**
 * A nested all-or-nothing scope inside the current unit.
 *
 * On failure only this scope's writes and in-memory changes are undone; the
 * enclosing unit carries on. Outside a unit this behaves like `atomic()`.
 */
export async function savepoint<T>(fn: () => Promise<T>, options: AtomicOptions<T> = {}): Promise<T> {
    const unit = unitStore.getStore();
    if (!unit) return atomic(fn, options);

    const isFailure = options.isFailure ?? isErrorResponse;
    const name = `uow_sp_${++unit.savepointSeq}`;
    const frame = newFrame();

    unit.db.exec(`SAVEPOINT ${name}`);
    unit.frames.push(frame);

    const undo = () => {
        try {
            unit.db.exec(`ROLLBACK TO ${name}`);
            unit.db.exec(`RELEASE ${name}`);
        } catch (error) {
            console.error(`[UnitOfWork] ROLLBACK TO ${name} failed:`, error);
        }
        unit.frames.pop();
        runRollbackHooks(frame);
    };

    let result: T;
    try {
        result = await fn();
    } catch (error) {
        undo();
        throw error;
    }

    if (isFailure(result)) {
        undo();
        return result;
    }

    unit.db.exec(`RELEASE ${name}`);
    unit.frames.pop();
    mergeInto(unit.frames[unit.frames.length - 1], frame);
    return result;
}
