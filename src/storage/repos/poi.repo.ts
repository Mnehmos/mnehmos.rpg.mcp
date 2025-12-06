/**
 * POI Repository - Persistence layer for Points of Interest
 *
 * Bridges world-level structures with room networks for navigation.
 *
 * @module storage/repos/poi
 */

import Database from 'better-sqlite3';
import {
    POI,
    POISchema,
    POICategory,
    POIDiscoveryState
} from '../../schema/poi.js';

export class POIRepository {
    constructor(private db: Database.Database) {
        this.ensureSchema();
    }

    /**
     * Ensure the POI table exists with all required columns
     */
    private ensureSchema(): void {
        // Create POI table without foreign key constraints for flexibility
        // Network/room linking is optional and may reference entities created later
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS pois (
                id TEXT PRIMARY KEY,
                world_id TEXT NOT NULL,
                region_id TEXT,
                x INTEGER NOT NULL,
                y INTEGER NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                category TEXT NOT NULL,
                icon TEXT NOT NULL,
                structure_id TEXT,
                network_id TEXT,
                entrance_room_id TEXT,
                discovery_state TEXT NOT NULL DEFAULT 'unknown',
                discovered_by TEXT NOT NULL DEFAULT '[]',
                discovery_dc INTEGER,
                parent_poi_id TEXT,
                child_poi_ids TEXT NOT NULL DEFAULT '[]',
                population INTEGER NOT NULL DEFAULT 0,
                level INTEGER,
                tags TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        `);

        // Create indexes for common queries
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_pois_world ON pois(world_id);
            CREATE INDEX IF NOT EXISTS idx_pois_coords ON pois(world_id, x, y);
            CREATE INDEX IF NOT EXISTS idx_pois_category ON pois(world_id, category);
            CREATE INDEX IF NOT EXISTS idx_pois_discovery ON pois(world_id, discovery_state);
            CREATE INDEX IF NOT EXISTS idx_pois_network ON pois(network_id);
            CREATE INDEX IF NOT EXISTS idx_pois_structure ON pois(structure_id);
        `);
    }

    // ============================================================
    // CRUD OPERATIONS
    // ============================================================

    create(poi: POI): void {
        const validated = POISchema.parse(poi);

        const stmt = this.db.prepare(`
            INSERT INTO pois (
                id, world_id, region_id, x, y, name, description,
                category, icon, structure_id, network_id, entrance_room_id,
                discovery_state, discovered_by, discovery_dc,
                parent_poi_id, child_poi_ids, population, level, tags,
                created_at, updated_at
            ) VALUES (
                @id, @worldId, @regionId, @x, @y, @name, @description,
                @category, @icon, @structureId, @networkId, @entranceRoomId,
                @discoveryState, @discoveredBy, @discoveryDC,
                @parentPOIId, @childPOIIds, @population, @level, @tags,
                @createdAt, @updatedAt
            )
        `);

        stmt.run({
            id: validated.id,
            worldId: validated.worldId,
            regionId: validated.regionId || null,
            x: validated.x,
            y: validated.y,
            name: validated.name,
            description: validated.description || null,
            category: validated.category,
            icon: validated.icon,
            structureId: validated.structureId || null,
            networkId: validated.networkId || null,
            entranceRoomId: validated.entranceRoomId || null,
            discoveryState: validated.discoveryState,
            discoveredBy: JSON.stringify(validated.discoveredBy),
            discoveryDC: validated.discoveryDC ?? null,
            parentPOIId: validated.parentPOIId || null,
            childPOIIds: JSON.stringify(validated.childPOIIds),
            population: validated.population,
            level: validated.level ?? null,
            tags: JSON.stringify(validated.tags),
            createdAt: validated.createdAt,
            updatedAt: validated.updatedAt
        });
    }

    findById(id: string): POI | null {
        const stmt = this.db.prepare('SELECT * FROM pois WHERE id = ?');
        const row = stmt.get(id) as POIRow | undefined;
        if (!row) return null;
        return this.rowToPOI(row);
    }

    findByWorldId(worldId: string): POI[] {
        const stmt = this.db.prepare('SELECT * FROM pois WHERE world_id = ? ORDER BY name');
        const rows = stmt.all(worldId) as POIRow[];
        return rows.map(row => this.rowToPOI(row));
    }

    findByCoordinates(worldId: string, x: number, y: number): POI | null {
        const stmt = this.db.prepare('SELECT * FROM pois WHERE world_id = ? AND x = ? AND y = ?');
        const row = stmt.get(worldId, x, y) as POIRow | undefined;
        if (!row) return null;
        return this.rowToPOI(row);
    }

    findByCategory(worldId: string, category: POICategory): POI[] {
        const stmt = this.db.prepare(
            'SELECT * FROM pois WHERE world_id = ? AND category = ? ORDER BY name'
        );
        const rows = stmt.all(worldId, category) as POIRow[];
        return rows.map(row => this.rowToPOI(row));
    }

    findByNetworkId(networkId: string): POI | null {
        const stmt = this.db.prepare('SELECT * FROM pois WHERE network_id = ?');
        const row = stmt.get(networkId) as POIRow | undefined;
        if (!row) return null;
        return this.rowToPOI(row);
    }

    findByStructureId(structureId: string): POI | null {
        const stmt = this.db.prepare('SELECT * FROM pois WHERE structure_id = ?');
        const row = stmt.get(structureId) as POIRow | undefined;
        if (!row) return null;
        return this.rowToPOI(row);
    }

    update(id: string, updates: Partial<POI>): POI | null {
        const existing = this.findById(id);
        if (!existing) return null;

        const updated: POI = {
            ...existing,
            ...updates,
            updatedAt: new Date().toISOString()
        };

        const validated = POISchema.parse(updated);

        const stmt = this.db.prepare(`
            UPDATE pois SET
                region_id = ?, x = ?, y = ?, name = ?, description = ?,
                category = ?, icon = ?, structure_id = ?, network_id = ?,
                entrance_room_id = ?, discovery_state = ?, discovered_by = ?,
                discovery_dc = ?, parent_poi_id = ?, child_poi_ids = ?,
                population = ?, level = ?, tags = ?, updated_at = ?
            WHERE id = ?
        `);

        stmt.run(
            validated.regionId || null,
            validated.x,
            validated.y,
            validated.name,
            validated.description || null,
            validated.category,
            validated.icon,
            validated.structureId || null,
            validated.networkId || null,
            validated.entranceRoomId || null,
            validated.discoveryState,
            JSON.stringify(validated.discoveredBy),
            validated.discoveryDC ?? null,
            validated.parentPOIId || null,
            JSON.stringify(validated.childPOIIds),
            validated.population,
            validated.level ?? null,
            JSON.stringify(validated.tags),
            validated.updatedAt,
            id
        );

        return validated;
    }

    delete(id: string): boolean {
        const stmt = this.db.prepare('DELETE FROM pois WHERE id = ?');
        const result = stmt.run(id);
        return result.changes > 0;
    }

    // ============================================================
    // DISCOVERY OPERATIONS
    // ============================================================

    /**
     * Mark a POI as discovered by a character
     */
    discoverPOI(poiId: string, characterId: string): POI | null {
        const poi = this.findById(poiId);
        if (!poi) return null;

        if (!poi.discoveredBy.includes(characterId)) {
            poi.discoveredBy.push(characterId);
        }

        // Update discovery state if not already discovered
        if (poi.discoveryState === 'unknown') {
            poi.discoveryState = 'discovered';
        }

        return this.update(poiId, {
            discoveredBy: poi.discoveredBy,
            discoveryState: poi.discoveryState
        });
    }

    /**
     * Get all POIs discovered by a character
     */
    findDiscoveredByCharacter(worldId: string, characterId: string): POI[] {
        const stmt = this.db.prepare(
            `SELECT * FROM pois WHERE world_id = ? AND discovered_by LIKE ? ORDER BY name`
        );
        const rows = stmt.all(worldId, `%"${characterId}"%`) as POIRow[];
        return rows.map(row => this.rowToPOI(row));
    }

    /**
     * Get POIs in a specific discovery state
     */
    findByDiscoveryState(worldId: string, state: POIDiscoveryState): POI[] {
        const stmt = this.db.prepare(
            'SELECT * FROM pois WHERE world_id = ? AND discovery_state = ? ORDER BY name'
        );
        const rows = stmt.all(worldId, state) as POIRow[];
        return rows.map(row => this.rowToPOI(row));
    }

    // ============================================================
    // SPATIAL QUERIES
    // ============================================================

    /**
     * Find POIs within a bounding box
     */
    findInBoundingBox(
        worldId: string,
        minX: number,
        maxX: number,
        minY: number,
        maxY: number
    ): POI[] {
        const stmt = this.db.prepare(`
            SELECT * FROM pois
            WHERE world_id = ?
              AND x >= ? AND x <= ?
              AND y >= ? AND y <= ?
            ORDER BY x, y
        `);
        const rows = stmt.all(worldId, minX, maxX, minY, maxY) as POIRow[];
        return rows.map(row => this.rowToPOI(row));
    }

    /**
     * Find POIs within a radius of a point
     */
    findNearby(worldId: string, x: number, y: number, radius: number): POI[] {
        // Use bounding box for initial filter, then check actual distance
        const stmt = this.db.prepare(`
            SELECT *,
                   ((x - ?) * (x - ?) + (y - ?) * (y - ?)) as dist_sq
            FROM pois
            WHERE world_id = ?
              AND x >= ? AND x <= ?
              AND y >= ? AND y <= ?
            ORDER BY dist_sq
        `);
        const rows = stmt.all(
            x, x, y, y, // For distance calculation
            worldId,
            x - radius, x + radius,
            y - radius, y + radius
        ) as (POIRow & { dist_sq: number })[];

        const radiusSq = radius * radius;
        return rows
            .filter(row => row.dist_sq <= radiusSq)
            .map(row => this.rowToPOI(row));
    }

    /**
     * Find the nearest POI to a point
     */
    findNearest(worldId: string, x: number, y: number): POI | null {
        const stmt = this.db.prepare(`
            SELECT *,
                   ((x - ?) * (x - ?) + (y - ?) * (y - ?)) as dist_sq
            FROM pois
            WHERE world_id = ?
            ORDER BY dist_sq
            LIMIT 1
        `);
        const row = stmt.get(x, x, y, y, worldId) as POIRow | undefined;
        if (!row) return null;
        return this.rowToPOI(row);
    }

    // ============================================================
    // LINKING OPERATIONS
    // ============================================================

    /**
     * Link a POI to a NodeNetwork
     */
    linkToNetwork(poiId: string, networkId: string, entranceRoomId?: string): POI | null {
        return this.update(poiId, {
            networkId,
            entranceRoomId
        });
    }

    /**
     * Link a POI to a Structure
     */
    linkToStructure(poiId: string, structureId: string): POI | null {
        return this.update(poiId, { structureId });
    }

    /**
     * Add a child POI (sub-location)
     */
    addChildPOI(parentId: string, childId: string): POI | null {
        const parent = this.findById(parentId);
        if (!parent) return null;

        if (!parent.childPOIIds.includes(childId)) {
            parent.childPOIIds.push(childId);
        }

        // Also update child's parent reference
        this.update(childId, { parentPOIId: parentId });

        return this.update(parentId, { childPOIIds: parent.childPOIIds });
    }

    // ============================================================
    // SEARCH & FILTER
    // ============================================================

    /**
     * Search POIs by tag
     */
    findByTag(worldId: string, tag: string): POI[] {
        const stmt = this.db.prepare(
            `SELECT * FROM pois WHERE world_id = ? AND tags LIKE ? ORDER BY name`
        );
        const rows = stmt.all(worldId, `%"${tag}"%`) as POIRow[];
        return rows.map(row => this.rowToPOI(row));
    }

    /**
     * Full-text search on name and description
     */
    search(worldId: string, query: string): POI[] {
        const stmt = this.db.prepare(`
            SELECT * FROM pois
            WHERE world_id = ?
              AND (name LIKE ? OR description LIKE ?)
            ORDER BY name
        `);
        const pattern = `%${query}%`;
        const rows = stmt.all(worldId, pattern, pattern) as POIRow[];
        return rows.map(row => this.rowToPOI(row));
    }

    // ============================================================
    // HELPERS
    // ============================================================

    private rowToPOI(row: POIRow): POI {
        return POISchema.parse({
            id: row.id,
            worldId: row.world_id,
            regionId: row.region_id || undefined,
            x: row.x,
            y: row.y,
            name: row.name,
            description: row.description || undefined,
            category: row.category,
            icon: row.icon,
            structureId: row.structure_id || undefined,
            networkId: row.network_id || undefined,
            entranceRoomId: row.entrance_room_id || undefined,
            discoveryState: row.discovery_state,
            discoveredBy: JSON.parse(row.discovered_by),
            discoveryDC: row.discovery_dc ?? undefined,
            parentPOIId: row.parent_poi_id || undefined,
            childPOIIds: JSON.parse(row.child_poi_ids),
            population: row.population,
            level: row.level ?? undefined,
            tags: JSON.parse(row.tags),
            createdAt: row.created_at,
            updatedAt: row.updated_at
        });
    }
}

interface POIRow {
    id: string;
    world_id: string;
    region_id: string | null;
    x: number;
    y: number;
    name: string;
    description: string | null;
    category: string;
    icon: string;
    structure_id: string | null;
    network_id: string | null;
    entrance_room_id: string | null;
    discovery_state: string;
    discovered_by: string;
    discovery_dc: number | null;
    parent_poi_id: string | null;
    child_poi_ids: string;
    population: number;
    level: number | null;
    tags: string;
    created_at: string;
    updated_at: string;
}
