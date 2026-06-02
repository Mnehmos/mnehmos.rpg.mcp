import Database from 'better-sqlite3';
import { existsSync, mkdirSync, renameSync } from 'fs';
import { basename, dirname, join } from 'path';

export interface DatabaseIntegrityResult {
    ok: boolean;
    errors: string[];
}

/**
 * Check database integrity using SQLite's integrity_check pragma.
 */
export function checkDatabaseIntegrity(db: Database.Database): DatabaseIntegrityResult {
    try {
        const result = db.pragma('integrity_check') as { integrity_check: string }[];
        const errors = result
            .map(row => row.integrity_check)
            .filter(msg => msg !== 'ok');

        return {
            ok: errors.length === 0,
            errors
        };
    } catch (e) {
        return {
            ok: false,
            errors: [(e as Error).message]
        };
    }
}

/**
 * Attempt to recover a corrupted database by quarantining existing files and
 * creating a fresh one. Preserving the old files gives operators a chance to
 * recover campaign data instead of losing it during startup.
 */
function handleCorruptedDatabase(path: string, error: Error): void {
    console.error(`[Database] CRITICAL: Database corruption detected at ${path}`);
    console.error(`[Database] Error: ${error.message}`);

    // Check for WAL files
    const walPath = `${path}-wal`;
    const shmPath = `${path}-shm`;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const quarantineDir = join(dirname(path), `${basename(path)}.corrupt-${timestamp}`);

    console.error(`[Database] Attempting recovery by quarantining corrupted files in ${quarantineDir}...`);

    try {
        mkdirSync(quarantineDir, { recursive: true });

        for (const sourcePath of [path, walPath, shmPath]) {
            if (!existsSync(sourcePath)) continue;
            const targetPath = join(quarantineDir, basename(sourcePath));
            renameSync(sourcePath, targetPath);
            console.error(`[Database] Quarantined ${sourcePath} -> ${targetPath}`);
        }

        console.error('[Database] Recovery complete. A fresh database will be created.');
    } catch (cleanupError) {
        console.error(`[Database] Failed to clean up corrupted files: ${(cleanupError as Error).message}`);
        throw new Error(`Database is corrupted and quarantine failed. Please manually back up and remove: ${path}, ${walPath}, ${shmPath}`);
    }
}

export function initDB(path: string): Database.Database {
    console.error(`[Database] Opening database: ${path}`);

    let db: Database.Database;

    try {
        db = new Database(path);
    } catch (e) {
        const error = e as Error;
        // If we can't even open the database, it's likely corrupted
        if (error.message.includes('SQLITE_CORRUPT') || error.message.includes('malformed')) {
            handleCorruptedDatabase(path, error);
            // Try again with fresh database
            db = new Database(path);
        } else {
            throw e;
        }
    }

    // Set pragmas
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    // BUSY-TIMEOUT FIX: better-sqlite3 is synchronous; without an explicit
    // busy_timeout, any write-lock contention either fails instantly with
    // SQLITE_BUSY or — with a hot WAL/-shm being recovered — stalls the entire
    // Node event loop, freezing the stdio MCP transport until the client times
    // out. A bounded wait lets a contended write retry instead of hanging.
    db.pragma('busy_timeout = 5000');
    db.pragma('synchronous = NORMAL');

    // Run integrity check on existing databases
    const integrity = checkDatabaseIntegrity(db);
    if (!integrity.ok) {
        console.error('[Database] Integrity check failed:');
        integrity.errors.forEach(err => console.error(`  - ${err}`));

        // Close the corrupted database
        db.close();

        // Handle the corruption
        handleCorruptedDatabase(path, new Error(integrity.errors.join(', ')));

        // Create fresh database
        db = new Database(path);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        db.pragma('busy_timeout = 5000');
        db.pragma('synchronous = NORMAL');

        console.error('[Database] Fresh database created after corruption recovery');
    } else {
        console.error('[Database] Integrity check passed');
        // HOT-WAL FIX: fold any leftover WAL from an unclean shutdown back into
        // the main db file on open, so a stranded -wal/-shm can't block the
        // first writer of the next session.
        try {
            db.pragma('wal_checkpoint(TRUNCATE)');
        } catch (e) {
            console.error('[Database] Startup WAL checkpoint skipped:', (e as Error).message);
        }
    }

    return db;
}
