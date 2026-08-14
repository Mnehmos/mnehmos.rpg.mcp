import Database from 'better-sqlite3';

export interface PointOfInterest {
    id: string;
    worldId: string;
    name: string;
    type: string;
    x: number;
    y: number;
    discoveryState: string;
    discoveryDc?: number;
    networkId?: string;
    createdAt: string;
    updatedAt: string;
}

type PoiRow = Record<string, unknown>;

/** Repository for world-map POIs, including compatibility with the old camelCase table. */
export class PoiRepository {
    private readonly columns: {
        worldId: string;
        discoveryState: string;
        discoveryDc: string | null;
        networkId: string;
        createdAt: string;
        updatedAt: string;
    };

    constructor(private readonly db: Database.Database) {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS pois (
                id TEXT PRIMARY KEY,
                world_id TEXT NOT NULL,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                x INTEGER NOT NULL,
                y INTEGER NOT NULL,
                discovery_state TEXT NOT NULL DEFAULT 'unknown',
                discovery_dc INTEGER,
                network_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        `);

        const columns = this.db.prepare('PRAGMA table_info(pois)').all() as Array<{ name: string }>;
        const names = new Set(columns.map(column => column.name));
        this.columns = {
            worldId: names.has('world_id') ? 'world_id' : 'worldId',
            discoveryState: names.has('discovery_state') ? 'discovery_state' : 'discoveryState',
            discoveryDc: names.has('discovery_dc')
                ? 'discovery_dc'
                : names.has('discoveryDc')
                    ? 'discoveryDc'
                    : null,
            networkId: names.has('network_id') ? 'network_id' : 'networkId',
            createdAt: names.has('created_at') ? 'created_at' : 'createdAt',
            updatedAt: names.has('updated_at') ? 'updated_at' : 'updatedAt'
        };

        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_pois_world ON pois(${this.columns.worldId});
            CREATE INDEX IF NOT EXISTS idx_pois_network ON pois(${this.columns.networkId});
        `);
    }

    getById(id: string): PointOfInterest | null {
        const row = this.db.prepare('SELECT * FROM pois WHERE id = ?').get(id) as PoiRow | undefined;
        return row ? this.rowToPoi(row) : null;
    }

    create(poi: PointOfInterest): void {
        const c = this.columns;
        const columns = [
            'id', c.worldId, 'name', 'type', 'x', 'y', c.discoveryState,
            c.discoveryDc, c.networkId, c.createdAt, c.updatedAt
        ].filter((column): column is string => Boolean(column));
        const values: unknown[] = [
            poi.id, poi.worldId, poi.name, poi.type, poi.x, poi.y,
            poi.discoveryState,
            ...(c.discoveryDc ? [poi.discoveryDc ?? null] : []),
            poi.networkId ?? null,
            poi.createdAt, poi.updatedAt
        ];
        this.db.prepare(`
            INSERT OR REPLACE INTO pois (${columns.join(', ')})
            VALUES (${columns.map(() => '?').join(', ')})
        `).run(...values);
    }

    markDiscovered(id: string, updatedAt = new Date().toISOString()): boolean {
        const result = this.db.prepare(
            `UPDATE pois SET ${this.columns.discoveryState} = ?, ${this.columns.updatedAt} = ? WHERE id = ?`
        ).run('discovered', updatedAt, id);
        return result.changes > 0;
    }

    private rowToPoi(row: PoiRow): PointOfInterest {
        const c = this.columns;
        return {
            id: String(row.id),
            worldId: String(row[c.worldId]),
            name: String(row.name),
            type: String(row.type),
            x: Number(row.x),
            y: Number(row.y),
            discoveryState: String(row[c.discoveryState] ?? 'unknown'),
            discoveryDc: c.discoveryDc && row[c.discoveryDc] != null
                ? Number(row[c.discoveryDc])
                : undefined,
            networkId: row[c.networkId] == null ? undefined : String(row[c.networkId]),
            createdAt: String(row[c.createdAt]),
            updatedAt: String(row[c.updatedAt])
        };
    }
}
