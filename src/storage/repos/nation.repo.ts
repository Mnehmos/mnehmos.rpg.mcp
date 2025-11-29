import Database from 'better-sqlite3';
import { Nation, NationSchema, NationResources } from '../../schema/nation.js';

export class NationRepository {
    constructor(private db: Database.Database) { }

    create(nation: Nation): void {
        const validNation = NationSchema.parse(nation);
        const stmt = this.db.prepare(`
      INSERT INTO nations (
        id, world_id, name, leader, ideology, aggression, trust, paranoia,
        gdp, resources, relations, private_memory, public_intent,
        created_at, updated_at
      )
      VALUES (
        @id, @worldId, @name, @leader, @ideology, @aggression, @trust, @paranoia,
        @gdp, @resources, @relations, @privateMemory, @publicIntent,
        @createdAt, @updatedAt
      )
    `);

        stmt.run({
            ...validNation,
            resources: JSON.stringify(validNation.resources),
            relations: JSON.stringify(validNation.relations || {}), // Default to empty object if undefined
            privateMemory: JSON.stringify(validNation.privateMemory || {}),
            publicIntent: validNation.publicIntent || null
        });
    }

    findById(id: string): Nation | null {
        const stmt = this.db.prepare('SELECT * FROM nations WHERE id = ?');
        const row = stmt.get(id) as any;

        if (!row) return null;

        return this.mapRowToNation(row);
    }

    findByWorldId(worldId: string): Nation[] {
        const stmt = this.db.prepare('SELECT * FROM nations WHERE world_id = ?');
        const rows = stmt.all(worldId) as any[];

        return rows.map(row => this.mapRowToNation(row));
    }

    updateResources(nationId: string, resources: NationResources): void {
        const stmt = this.db.prepare(`
      UPDATE nations 
      SET resources = ?, updated_at = ?
      WHERE id = ?
    `);
        stmt.run(JSON.stringify(resources), new Date().toISOString(), nationId);
    }

    updateTraits(nationId: string, traits: { aggression?: number; trust?: number; paranoia?: number }): void {
        const updates: string[] = [];
        const params: any[] = [];

        if (traits.aggression !== undefined) {
            updates.push('aggression = ?');
            params.push(traits.aggression);
        }
        if (traits.trust !== undefined) {
            updates.push('trust = ?');
            params.push(traits.trust);
        }
        if (traits.paranoia !== undefined) {
            updates.push('paranoia = ?');
            params.push(traits.paranoia);
        }

        if (updates.length === 0) return;

        updates.push('updated_at = ?');
        params.push(new Date().toISOString());
        params.push(nationId);

        const stmt = this.db.prepare(`UPDATE nations SET ${updates.join(', ')} WHERE id = ?`);
        stmt.run(...params);
    }

    private mapRowToNation(row: any): Nation {
        return NationSchema.parse({
            id: row.id,
            worldId: row.world_id,
            name: row.name,
            leader: row.leader,
            ideology: row.ideology,
            aggression: row.aggression,
            trust: row.trust,
            paranoia: row.paranoia,
            gdp: row.gdp,
            resources: JSON.parse(row.resources),
            relations: JSON.parse(row.relations || '{}'), // Handle potentially null relations in DB
            privateMemory: row.private_memory ? JSON.parse(row.private_memory) : undefined,
            publicIntent: row.public_intent || undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        });
    }
}
