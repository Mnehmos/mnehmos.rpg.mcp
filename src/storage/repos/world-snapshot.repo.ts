import Database from 'better-sqlite3';
import { GeneratedWorld } from '../../engine/worldgen/index.js';

interface SerializedGeneratedWorld {
    seed: string;
    width: number;
    height: number;
    elevation: number[];
    temperature: number[];
    moisture: number[];
    biomes: GeneratedWorld['biomes'];
    rivers: number[];
    regions: GeneratedWorld['regions'];
    regionMap: number[];
    structures: GeneratedWorld['structures'];
}

/** Durable canonical world state used to rehydrate after cache eviction/restart. */
export class WorldSnapshotRepository {
    public constructor(private readonly db: Database.Database) {}

    public save(worldId: string, world: GeneratedWorld): void {
        const snapshot: SerializedGeneratedWorld = {
            seed: world.seed,
            width: world.width,
            height: world.height,
            elevation: Array.from(world.elevation),
            temperature: Array.from(world.temperature),
            moisture: Array.from(world.moisture),
            biomes: world.biomes,
            rivers: Array.from(world.rivers),
            regions: world.regions,
            regionMap: Array.from(world.regionMap),
            structures: world.structures,
        };
        this.db.prepare(`
            INSERT INTO world_snapshots (world_id, snapshot, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(world_id) DO UPDATE SET
                snapshot = excluded.snapshot,
                updated_at = excluded.updated_at
        `).run(worldId, JSON.stringify(snapshot), new Date().toISOString());
    }

    public load(worldId: string): GeneratedWorld | null {
        const row = this.db.prepare(
            'SELECT snapshot FROM world_snapshots WHERE world_id = ?'
        ).get(worldId) as { snapshot: string } | undefined;
        if (!row) return null;

        const parsed = JSON.parse(row.snapshot) as SerializedGeneratedWorld;
        return {
            seed: parsed.seed,
            width: parsed.width,
            height: parsed.height,
            elevation: Uint8Array.from(parsed.elevation),
            temperature: Int8Array.from(parsed.temperature),
            moisture: Uint8Array.from(parsed.moisture),
            biomes: parsed.biomes,
            rivers: Uint8Array.from(parsed.rivers),
            regions: parsed.regions,
            regionMap: Int32Array.from(parsed.regionMap),
            structures: parsed.structures,
        };
    }
}
