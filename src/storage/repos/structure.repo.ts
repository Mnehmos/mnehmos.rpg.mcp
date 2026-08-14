import Database from 'better-sqlite3';
import { Structure, StructureSchema } from '../../schema/structure.js';

export class StructureRepository {
    public constructor(private readonly db: Database.Database) {}

    public create(structure: Structure): void {
        const validStructure = StructureSchema.parse(structure);
        this.db.prepare(`
            INSERT INTO structures (
                id, world_id, region_id, name, type, x, y, population,
                created_at, updated_at, metadata
            ) VALUES (
                @id, @worldId, @regionId, @name, @type, @x, @y, @population,
                @createdAt, @updatedAt, @metadata
            )
        `).run({
            id: validStructure.id,
            worldId: validStructure.worldId,
            regionId: validStructure.regionId ?? null,
            name: validStructure.name,
            type: validStructure.type,
            x: validStructure.x,
            y: validStructure.y,
            population: validStructure.population,
            createdAt: validStructure.createdAt,
            updatedAt: validStructure.updatedAt,
            metadata: null,
        });
    }

    public findById(id: string): Structure | null {
        const row = this.db.prepare('SELECT * FROM structures WHERE id = ?').get(id) as StructureRow | undefined;
        return row ? this.mapRow(row) : null;
    }

    public findByWorldId(worldId: string): Structure[] {
        const rows = this.db.prepare('SELECT * FROM structures WHERE world_id = ? ORDER BY id').all(worldId) as StructureRow[];
        return rows.map(row => this.mapRow(row));
    }

    private mapRow(row: StructureRow): Structure {
        return StructureSchema.parse({
            id: row.id,
            worldId: row.world_id,
            regionId: row.region_id ?? undefined,
            name: row.name,
            type: row.type,
            x: row.x,
            y: row.y,
            population: row.population,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        });
    }
}

interface StructureRow {
    id: string;
    world_id: string;
    region_id: string | null;
    name: string;
    type: string;
    x: number;
    y: number;
    population: number;
    created_at: string;
    updated_at: string;
}
