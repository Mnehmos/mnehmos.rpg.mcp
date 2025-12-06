import Database from 'better-sqlite3';
import { Encounter, EncounterSchema, DEFAULT_GRID_BOUNDS } from '../../schema/encounter.js';

/**
 * EncounterRepository - Persistence layer for combat encounters
 *
 * PHASE 1: Position Persistence
 * - Positions are stored within the tokens JSON
 * - Terrain obstacles are stored in a separate terrain column
 * - Grid bounds define valid coordinate ranges
 *
 * Storage format:
 * - tokens: JSON array of TokenSchema (includes position, movementSpeed, size)
 * - terrain: JSON object with obstacles and difficultTerrain arrays
 * - grid_bounds: JSON object with minX, maxX, minY, maxY, minZ?, maxZ?
 */
export class EncounterRepository {
    constructor(private db: Database.Database) {
        // Ensure schema is up to date (add columns if missing)
        this.ensureSchema();
    }

    /**
     * Ensure the encounters table has all required columns
     * This handles migration for existing databases
     */
    private ensureSchema(): void {
        // Check if terrain column exists
        const tableInfo = this.db.prepare('PRAGMA table_info(encounters)').all() as { name: string }[];
        const columnNames = tableInfo.map(c => c.name);

        if (!columnNames.includes('terrain')) {
            this.db.prepare('ALTER TABLE encounters ADD COLUMN terrain TEXT').run();
        }
        if (!columnNames.includes('grid_bounds')) {
            this.db.prepare('ALTER TABLE encounters ADD COLUMN grid_bounds TEXT').run();
        }
    }

    create(encounter: Encounter): void {
        const validEncounter = EncounterSchema.parse(encounter);
        const stmt = this.db.prepare(`
      INSERT INTO encounters (id, region_id, tokens, round, active_token_id, status, terrain, grid_bounds, created_at, updated_at)
      VALUES (@id, @regionId, @tokens, @round, @activeTokenId, @status, @terrain, @gridBounds, @createdAt, @updatedAt)
    `);
        stmt.run({
            id: validEncounter.id,
            regionId: validEncounter.regionId || null,
            // PHASE 1: Tokens JSON now includes position data
            tokens: JSON.stringify(validEncounter.tokens),
            round: validEncounter.round,
            activeTokenId: validEncounter.activeTokenId || null,
            status: validEncounter.status,
            // PHASE 1: Persist terrain separately
            terrain: validEncounter.terrain ? JSON.stringify(validEncounter.terrain) : null,
            // PHASE 2: Persist grid bounds
            gridBounds: validEncounter.gridBounds ? JSON.stringify(validEncounter.gridBounds) : null,
            createdAt: validEncounter.createdAt,
            updatedAt: validEncounter.updatedAt,
        });
    }

    findByRegionId(regionId: string): Encounter[] {
        const stmt = this.db.prepare('SELECT * FROM encounters WHERE region_id = ?');
        const rows = stmt.all(regionId) as EncounterRow[];

        return rows.map((row) =>
            EncounterSchema.parse({
                id: row.id,
                regionId: row.region_id,
                tokens: JSON.parse(row.tokens),
                round: row.round,
                activeTokenId: row.active_token_id || undefined,
                status: row.status,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
            })
        );
    }
    /**
     * Save combat state to database
     * PHASE 1: Now persists positions, terrain, and grid bounds
     *
     * @param encounterId The encounter ID
     * @param state The CombatState object (includes participants with positions)
     */
    saveState(encounterId: string, state: any): void {
        const stmt = this.db.prepare(`
            UPDATE encounters
            SET tokens = ?, round = ?, active_token_id = ?, status = ?, terrain = ?, grid_bounds = ?, updated_at = ?
            WHERE id = ?
        `);

        // Map CombatState to DB format
        // PHASE 1: Participants now include position, movementSpeed, size, movementRemaining
        const currentTurnId = state.turnOrder[state.currentTurnIndex];

        stmt.run(
            JSON.stringify(state.participants),
            state.round,
            currentTurnId,
            'active',
            // PHASE 1: Persist terrain
            state.terrain ? JSON.stringify(state.terrain) : null,
            // PHASE 2: Persist grid bounds
            state.gridBounds ? JSON.stringify(state.gridBounds) : null,
            new Date().toISOString(),
            encounterId
        );
    }

    /**
     * Load combat state from database
     * PHASE 1: Now restores positions, terrain, and grid bounds
     *
     * @param encounterId The encounter ID
     * @returns CombatState object with all spatial data, or null if not found
     */
    loadState(encounterId: string): any | null {
        const row = this.findById(encounterId);
        if (!row) return null;

        // PHASE 1: Parse participants with position data
        const participants = JSON.parse(row.tokens);

        // PHASE 1: Parse terrain if present
        const terrain = row.terrain ? JSON.parse(row.terrain) : undefined;

        // PHASE 2: Parse grid bounds if present, else use defaults
        const gridBounds = row.grid_bounds
            ? JSON.parse(row.grid_bounds)
            : DEFAULT_GRID_BOUNDS;

        // Reconstruct turn order from participants (sorted by initiative)
        // Note: This assumes participants are stored in initiative order
        const sortedParticipants = [...participants].sort((a: any, b: any) => {
            const initA = a.initiative ?? 0;
            const initB = b.initiative ?? 0;
            if (initB !== initA) return initB - initA;
            return (a.id as string).localeCompare(b.id);
        });

        const turnOrder = sortedParticipants.map((p: any) => p.id);

        // Handle LAIR action if applicable
        const lairOwner = participants.find((p: any) => p.hasLairActions);
        if (lairOwner) {
            // Insert LAIR at initiative 20 position
            const lairIndex = sortedParticipants.findIndex((p: any) => (p.initiative ?? 0) <= 20);
            if (lairIndex === -1) {
                turnOrder.push('LAIR');
            } else {
                turnOrder.splice(lairIndex, 0, 'LAIR');
            }
        }

        return {
            participants: participants,
            turnOrder,
            currentTurnIndex: turnOrder.indexOf(row.active_token_id ?? turnOrder[0]),
            round: row.round,
            // PHASE 1: Restore terrain
            terrain,
            // PHASE 2: Restore grid bounds
            gridBounds,
            // LAIR action support
            hasLairActions: !!lairOwner,
            lairOwnerId: lairOwner?.id
        };
    }

    findById(id: string): EncounterRow | undefined {
        const stmt = this.db.prepare('SELECT * FROM encounters WHERE id = ?');
        return stmt.get(id) as EncounterRow | undefined;
    }

    delete(id: string): boolean {
        const stmt = this.db.prepare('DELETE FROM encounters WHERE id = ?');
        const result = stmt.run(id);
        return result.changes > 0;
    }
}

interface EncounterRow {
    id: string;
    region_id: string | null;
    tokens: string;
    round: number;
    active_token_id: string | null;
    status: string;
    // PHASE 1: Terrain and bounds persistence
    terrain: string | null;
    grid_bounds: string | null;
    created_at: string;
    updated_at: string;
}
