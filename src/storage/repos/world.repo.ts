import { gzipSync, gunzipSync } from 'zlib';
import Database from 'better-sqlite3';
import {
    normalizeWorldEnvironment,
    World,
    WorldEnvironmentSchema,
    WorldSchema,
} from '../../schema/world.js';

export class WorldRepository {
    constructor(private db: Database.Database) { 
        this.ensureEnvironmentColumn();
    }

    private ensureEnvironmentColumn() {
        try {
            const columns = this.db.prepare(`PRAGMA table_info(worlds)`).all() as any[];
            const hasEnv = columns.some(col => col.name === 'environment');
            if (!hasEnv) {
                this.db.exec(`ALTER TABLE worlds ADD COLUMN environment TEXT`);
            }
        } catch (err) {
            // Ignore if table doesn't exist yet; creation/migrations will handle it
        }
    }

    create(world: World): void {
        const validWorld = WorldSchema.parse(world);
        const stmt = this.db.prepare(`
      INSERT INTO worlds (id, name, seed, width, height, created_at, updated_at, environment)
      VALUES (@id, @name, @seed, @width, @height, @createdAt, @updatedAt, @environment)
    `);
        stmt.run({
            id: validWorld.id,
            name: validWorld.name,
            seed: validWorld.seed,
            width: validWorld.width,
            height: validWorld.height,
            createdAt: validWorld.createdAt,
            updatedAt: validWorld.updatedAt,
            environment: JSON.stringify(validWorld.environment || {})
        });
    }

    findById(id: string): World | null {
        const stmt = this.db.prepare('SELECT * FROM worlds WHERE id = ?');
        const row = stmt.get(id) as WorldRow | undefined;

        if (!row) return null;

        let environment: ReturnType<typeof normalizeWorldEnvironment> = {};
        if (row.environment) {
            try {
                environment = normalizeWorldEnvironment(JSON.parse(row.environment));
            } catch {
                environment = {};
            }
        }

        return WorldSchema.parse({
            id: row.id,
            name: row.name,
            seed: row.seed,
            width: row.width,
            height: row.height,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            environment,
        });
    }

    findAll(): World[] {
        const stmt = this.db.prepare('SELECT * FROM worlds');
        const rows = stmt.all() as WorldRow[];

        return rows.map((row) =>
            WorldSchema.parse({
                id: row.id,
                name: row.name,
                seed: row.seed,
                width: row.width,
                height: row.height,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
                environment: (() => {
                    if (!row.environment) return {};
                    try {
                        return normalizeWorldEnvironment(JSON.parse(row.environment));
                    } catch {
                        return {};
                    }
                })(),
            })
        );
    }

    /** Adds the tile_cache column on databases created before it existed. */
    private ensureTileCacheColumn(): void {
        const columns = this.db.prepare(`PRAGMA table_info(worlds)`).all() as Array<{ name: string }>;
        if (!columns.some(col => col.name === 'tile_cache')) {
            this.db.exec(`ALTER TABLE worlds ADD COLUMN tile_cache BLOB`);
        }
    }

    /** Decompressed tile cache for a world, or null if none is stored. */
    getTileCache(id: string): unknown | null {
        this.ensureTileCacheColumn();
        const row = this.db.prepare('SELECT tile_cache FROM worlds WHERE id = ?').get(id) as { tile_cache?: Buffer | null } | undefined;
        if (!row?.tile_cache) return null;
        return JSON.parse(gunzipSync(row.tile_cache).toString('utf-8'));
    }

    /** Store a gzipped tile cache for a world. Returns the compressed size in bytes. */
    setTileCache(id: string, tileData: unknown): number {
        this.ensureTileCacheColumn();
        const compressed = gzipSync(JSON.stringify(tileData));
        this.db.prepare('UPDATE worlds SET tile_cache = ? WHERE id = ?').run(compressed, id);
        return compressed.length;
    }

    clearTileCache(id: string): void {
        this.ensureTileCacheColumn();
        this.db.prepare('UPDATE worlds SET tile_cache = NULL WHERE id = ?').run(id);
    }

    delete(id: string): void {
        const stmt = this.db.prepare('DELETE FROM worlds WHERE id = ?');
        stmt.run(id);
    }

    updateEnvironment(id: string, envPatch: Record<string, any>): World | null {
        const current = this.findById(id);
        if (!current) return null;

        const canonicalPatch = normalizeWorldEnvironment(envPatch);
        const mergedEnv = WorldEnvironmentSchema.parse({ ...(current.environment || {}), ...canonicalPatch });
        const updatedAt = new Date().toISOString();

        const stmt = this.db.prepare(`
          UPDATE worlds
          SET environment = @environment,
              updated_at = @updatedAt
          WHERE id = @id
        `);

        stmt.run({
            id,
            environment: JSON.stringify(mergedEnv),
            updatedAt,
        });

        return {
            ...current,
            environment: mergedEnv,
            updatedAt,
        };
    }
}

interface WorldRow {
    id: string;
    name: string;
    seed: string;
    width: number;
    height: number;
    created_at: string;
    updated_at: string;
    environment?: string | null;
}
