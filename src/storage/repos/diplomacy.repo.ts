import Database from 'better-sqlite3';
import {
    DiplomaticRelation, DiplomaticRelationSchema,
    TerritorialClaim, TerritorialClaimSchema,
    NationEvent, NationEventSchema
} from '../../schema/diplomacy.js';

export class DiplomacyRepository {
    constructor(private db: Database.Database) { }

    upsertRelation(relation: DiplomaticRelation): void {
        const validRelation = DiplomaticRelationSchema.parse(relation);
        const stmt = this.db.prepare(`
      INSERT INTO diplomatic_relations (
        from_nation_id, to_nation_id, opinion, is_allied, truce_until, updated_at
      )
      VALUES (
        @fromNationId, @toNationId, @opinion, @isAllied, @truceUntil, @updatedAt
      )
      ON CONFLICT(from_nation_id, to_nation_id) DO UPDATE SET
        opinion = excluded.opinion,
        is_allied = excluded.is_allied,
        truce_until = excluded.truce_until,
        updated_at = excluded.updated_at
    `);

        stmt.run({
            ...validRelation,
            isAllied: validRelation.isAllied ? 1 : 0,
            truceUntil: validRelation.truceUntil || null
        });
    }

    getRelation(fromNationId: string, toNationId: string): DiplomaticRelation | null {
        const stmt = this.db.prepare(`
      SELECT * FROM diplomatic_relations 
      WHERE from_nation_id = ? AND to_nation_id = ?
    `);
        const row = stmt.get(fromNationId, toNationId) as any;

        if (!row) return null;

        return DiplomaticRelationSchema.parse({
            fromNationId: row.from_nation_id,
            toNationId: row.to_nation_id,
            opinion: row.opinion,
            isAllied: Boolean(row.is_allied),
            truceUntil: row.truce_until || undefined,
            updatedAt: row.updated_at
        });
    }

    createClaim(claim: TerritorialClaim): void {
        const validClaim = TerritorialClaimSchema.parse(claim);
        const stmt = this.db.prepare(`
      INSERT INTO territorial_claims (
        id, nation_id, region_id, claim_strength, justification, created_at
      )
      VALUES (
        @id, @nationId, @regionId, @claimStrength, @justification, @createdAt
      )
    `);

        stmt.run(validClaim);
    }

    getClaimsByRegion(regionId: string): TerritorialClaim[] {
        const stmt = this.db.prepare('SELECT * FROM territorial_claims WHERE region_id = ?');
        const rows = stmt.all(regionId) as any[];

        return rows.map(row => TerritorialClaimSchema.parse({
            id: row.id,
            nationId: row.nation_id,
            regionId: row.region_id,
            claimStrength: row.claim_strength,
            justification: row.justification || undefined,
            createdAt: row.created_at
        }));
    }

    logEvent(event: NationEvent): void {
        // Omit ID since it's auto-increment
        const { id, ...eventData } = event;
        const validEvent = NationEventSchema.omit({ id: true }).parse(eventData);

        const stmt = this.db.prepare(`
      INSERT INTO nation_events (
        world_id, turn_number, event_type, involved_nations, details, timestamp
      )
      VALUES (
        @worldId, @turnNumber, @eventType, @involvedNations, @details, @timestamp
      )
    `);

        stmt.run({
            ...validEvent,
            involvedNations: JSON.stringify(validEvent.involvedNations),
            details: JSON.stringify(validEvent.details)
        });
    }

    getEventsByWorld(worldId: string, turnNumber?: number): NationEvent[] {
        let query = 'SELECT * FROM nation_events WHERE world_id = ?';
        const params: any[] = [worldId];

        if (turnNumber !== undefined) {
            query += ' AND turn_number = ?';
            params.push(turnNumber);
        }

        const stmt = this.db.prepare(query);
        const rows = stmt.all(...params) as any[];

        return rows.map(row => NationEventSchema.parse({
            id: row.id,
            worldId: row.world_id,
            turnNumber: row.turn_number,
            eventType: row.event_type,
            involvedNations: JSON.parse(row.involved_nations),
            details: JSON.parse(row.details),
            timestamp: row.timestamp
        }));
    }
}
