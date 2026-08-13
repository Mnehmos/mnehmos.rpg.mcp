import Database from 'better-sqlite3';
import { join, isAbsolute, dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { initDB } from './db.js';
import { migrate } from './migrations.js';
import { requireTenant } from './tenant-context.js';

/**
 * Explicitly injected database, used only by tests.
 *
 * Tests drive tool handlers directly, outside any HTTP request, so there is no
 * verified tenant to resolve against. They install an in-memory database here
 * (via setDb, or implicitly via getDb(':memory:')) and handlers then receive it
 * from the no-argument getDb() they use in production.
 */
let overrideDb: Database.Database | null = null;
let configuredDbPath: string | null = null;

/**
 * Open per-campaign handles, most-recently-used last.
 *
 * A Map preserves insertion order, which is all an LRU needs here: re-inserting
 * on read moves an entry to the end, so the oldest key is always evicted first.
 * Opening a SQLite file is sub-millisecond, so a modest cap serves far more
 * campaigns than it holds.
 */
const pool = new Map<string, Database.Database>();
const MAX_OPEN_DATABASES = 64;

/**
 * Campaign ids are UUIDs minted by the web host (reference-engine-adapter.ts).
 * The id becomes a path segment, so this is validated rather than sanitized —
 * a rejected id is a bug or an attack, and neither should be repaired into
 * something that opens a file.
 */
const CAMPAIGN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Get the platform-specific app data directory for rpg-mcp.
 * - Windows: %APPDATA%/rpg-mcp
 * - macOS: ~/Library/Application Support/rpg-mcp
 * - Linux: ~/.local/share/rpg-mcp
 */
function getAppDataDir(): string {
    const platform = process.platform;
    let appDataDir: string;

    if (platform === 'win32') {
        // Windows: %APPDATA% (typically C:\Users\<user>\AppData\Roaming)
        appDataDir = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
    } else if (platform === 'darwin') {
        // macOS: ~/Library/Application Support
        appDataDir = join(homedir(), 'Library', 'Application Support');
    } else {
        // Linux/Unix: ~/.local/share (XDG Base Directory spec)
        appDataDir = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
    }

    const rpgMcpDir = join(appDataDir, 'rpg-mcp');
    
    // Ensure the directory exists
    if (!existsSync(rpgMcpDir)) {
        mkdirSync(rpgMcpDir, { recursive: true });
        console.error(`[Database] Created app data directory: ${rpgMcpDir}`);
    }

    return rpgMcpDir;
}

/**
 * Get the default database path.
 * Uses environment variable, CLI argument, or falls back to app data directory.
 *
 * Priority:
 * 1. RPG_MCP_DB_PATH environment variable
 * 2. --db-path CLI argument
 * 3. Platform-specific app data directory (%APPDATA%/rpg-mcp on Windows)
 */
function getDefaultDbPath(): string {
    // Check for environment variable first
    if (process.env.RPG_MCP_DB_PATH) {
        return process.env.RPG_MCP_DB_PATH;
    }

    if (process.env.RPG_DATA_DIR) {
        return join(process.env.RPG_DATA_DIR, 'rpg.db');
    }

    // Check for CLI argument --db-path
    const args = process.argv;
    const dbPathIndex = args.indexOf('--db-path');
    if (dbPathIndex !== -1 && args[dbPathIndex + 1]) {
        return args[dbPathIndex + 1];
    }

    // Use platform-specific app data directory
    return join(getAppDataDir(), 'rpg.db');
}

/**
 * Resolve database path, ensuring it's absolute.
 */
function resolveDbPath(path?: string): string {
    const dbPath = path || configuredDbPath || getDefaultDbPath();

    // Special case: SQLite in-memory database
    if (dbPath === ':memory:') {
        return dbPath;
    }

    if (isAbsolute(dbPath)) {
        return dbPath;
    }

    // CRIT-005: If the path is the default 'rpg.db', use APPDATA instead of CWD
    // This ensures the database is always in a consistent location
    if (dbPath === 'rpg.db') {
        return join(getAppDataDir(), 'rpg.db');
    }

    // Make relative paths absolute based on CWD
    return join(process.cwd(), dbPath);
}

/**
 * Configure the database path before initialization.
 * Call this before getDb() to set a custom path.
 */
export function configureDbPath(path: string): void {
    if (overrideDb) {
        throw new Error('Cannot configure database path after database has been initialized');
    }
    configuredDbPath = isAbsolute(path) ? path : join(process.cwd(), path);
}

/**
 * Get the configured or default database path (for logging/debugging).
 */
export function getDbPath(): string {
    return resolveDbPath();
}

/**
 * Absolute path to a campaign's database.
 *
 * Sharded on the id's first two hex characters so no single directory ends up
 * holding tens of thousands of entries.
 */
export function campaignDbPath(campaignId: string): string {
    const root = process.env.RPG_DATA_DIR || getAppDataDir();
    return join(root, 'campaigns', campaignId.slice(0, 2), `${campaignId}.db`);
}

function openCampaignDb(campaignId: string): Database.Database {
    if (!CAMPAIGN_ID_PATTERN.test(campaignId)) {
        throw new Error('Refusing to open a database for a malformed campaign id.');
    }

    const existing = pool.get(campaignId);
    if (existing) {
        // Re-insert to mark most-recently-used.
        pool.delete(campaignId);
        pool.set(campaignId, existing);
        return existing;
    }

    const path = campaignDbPath(campaignId);
    mkdirSync(dirname(path), { recursive: true });
    const db = initDB(path);
    // Migrations run lazily per database on first open, so adding a campaign
    // never requires a separate migration pass over every existing file.
    migrate(db);
    pool.set(campaignId, db);
    evictBeyondCap();
    return db;
}

function evictBeyondCap(): void {
    while (pool.size > MAX_OPEN_DATABASES) {
        const oldest = pool.keys().next().value as string | undefined;
        if (oldest === undefined) return;
        const db = pool.get(oldest);
        pool.delete(oldest);
        try {
            db?.pragma('wal_checkpoint(TRUNCATE)');
            db?.close();
        } catch (e) {
            console.error(`[Database] Failed to close evicted campaign db: ${(e as Error).message}`);
        }
    }
}

/**
 * The database for the current request's campaign.
 *
 * Isolation here is physical rather than a predicate every query has to
 * remember: a campaign's rows are the only rows in the file, so a query that
 * forgets to scope cannot reach another tenant's data.
 *
 * `path` is a test-only escape hatch. Production callers pass nothing and get
 * the ambient tenant's database; passing a path outside tests would let a
 * caller select a database without a verified tenant, which is the whole class
 * of bug this change exists to remove.
 */
export function getDb(path?: string): Database.Database {
    if (path !== undefined) {
        if (process.env.NODE_ENV !== 'test') {
            throw new Error(
                'getDb(path) is test-only. Production callers must use getDb(), which resolves ' +
                'the database from the verified tenant context.'
            );
        }
        if (!overrideDb) {
            overrideDb = initDB(resolveDbPath(path));
            migrate(overrideDb);
        }
        return overrideDb;
    }

    if (overrideDb) return overrideDb;

    return openCampaignDb(requireTenant().campaignId);
}

export function setDb(database: Database.Database) {
    overrideDb = database;
}

/**
 * Close the injected database and every pooled campaign handle, checkpointing
 * WAL so nothing is left in a sidecar file.
 */
export function closeDb() {
    const close = (db: Database.Database, label: string) => {
        try {
            db.pragma('wal_checkpoint(TRUNCATE)');
        } catch (e) {
            console.error(`[Database] WAL checkpoint failed for ${label}: ${(e as Error).message}`);
        }
        try {
            db.close();
        } catch (e) {
            console.error(`[Database] Close failed for ${label}: ${(e as Error).message}`);
        }
    };

    if (overrideDb) {
        close(overrideDb, 'override');
        overrideDb = null;
    }
    for (const [campaignId, db] of pool) close(db, campaignId);
    pool.clear();
}

export * from './db.js';
export * from './migrations.js';
export * from './audit.repo.js';
