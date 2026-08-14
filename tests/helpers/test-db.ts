import { afterAll, beforeAll } from 'vitest';
import { closeDb, getDb } from '../../src/storage/index.js';

/**
 * Installs an in-memory database for the calling suite.
 *
 * Tool handlers resolve their database from the ambient tenant, which only
 * exists inside a real HTTP request. Tests drive handlers directly, so they
 * install an explicit database instead — `getDb(':memory:')` is the test-only
 * escape hatch that sets it, and handlers' plain `getDb()` then receives it.
 *
 * Scoped with beforeAll rather than beforeEach on purpose: these suites build
 * state in one test and read it in the next, which is what the previous
 * implicitly-created singleton allowed. Resetting per test would break them in
 * a way unrelated to what they are actually checking.
 */
export function useInMemoryDatabase(): void {
    beforeAll(() => {
        closeDb();
        getDb(':memory:');
    });

    afterAll(() => {
        closeDb();
    });
}
