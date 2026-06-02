/**
 * Blind-spot detector — the §3.5 thesis encoded.
 *
 * Asserts the engine STAYS MUTE when narration is ambiguous and no
 * row exists to back it. This is the test that proves the engine
 * cannot be tricked into inventing creatures from fiction-text.
 */

import { detectBlindSpots } from '../../../src/engine/perception/blind-spot-detector.js';
import { getDb, closeDb } from '../../../src/storage/index.js';
import { SpatialRepository } from '../../../src/storage/repos/spatial.repo.js';
import { randomUUID } from 'crypto';

describe('blind-spot-detector', () => {
    let db: ReturnType<typeof getDb>;

    beforeEach(() => {
        closeDb();
        db = getDb(':memory:');
    });

    it('flags missing room_exits when exits array is empty', () => {
        const spatial = new SpatialRepository(db);
        const roomId = randomUUID();
        const now = new Date().toISOString();
        spatial.create({
            id: roomId,
            name: 'Empty Chamber',
            baseDescription: 'A chamber with no recorded exits, props, or atmospherics.',
            biomeContext: 'dungeon',
            atmospherics: [],
            exits: [],
            entityIds: [],
            createdAt: now,
            updatedAt: now,
            visitedCount: 0,
        });

        const blind = detectBlindSpots(
            { kind: 'room', roomId },
            [],
            { db },
        );
        const kinds = blind.map(b => b.whatKindOfDataIsMissing);
        expect(kinds).toContain('room_exits');
        expect(kinds).toContain('room_atmospherics');
        expect(kinds).toContain('room_entities');
    });

    it('REFUSES to fabricate from ambiguous scene narration — emits unknown blind-spot instead', () => {
        const worldId = randomUUID();
        const now = new Date().toISOString();
        db.prepare(`
            INSERT INTO worlds (id, name, seed, width, height, created_at, updated_at)
            VALUES (?, 'W', 's', 10, 10, ?, ?)
        `).run(worldId, now, now);

        const noteId = randomUUID();
        db.prepare(`
            INSERT INTO narrative_notes (id, world_id, type, content, metadata, visibility, tags, entity_id, entity_type, status, created_at, updated_at)
            VALUES (?, ?, 'session_log', 'something moves in the shadow at the back of the chamber', '{}', 'dm_only', '[]', NULL, NULL, 'active', ?, ?)
        `).run(noteId, worldId, now, now);

        const blind = detectBlindSpots(
            { kind: 'scene', sceneNarrativeNoteId: noteId },
            [],
            { db },
        );
        const kinds = blind.map(b => b.whatKindOfDataIsMissing);
        expect(kinds).toContain('scene_creature_row');
        // ALSO: the engine emits the missing-participants flag because no entity is bound
        expect(kinds).toContain('scene_participants');
    });

    it('does NOT emit scene_creature_row when narration is bland and uneventful', () => {
        const worldId = randomUUID();
        const now = new Date().toISOString();
        db.prepare(`
            INSERT INTO worlds (id, name, seed, width, height, created_at, updated_at)
            VALUES (?, 'W', 's', 10, 10, ?, ?)
        `).run(worldId, now, now);

        const noteId = randomUUID();
        db.prepare(`
            INSERT INTO narrative_notes (id, world_id, type, content, metadata, visibility, tags, entity_id, entity_type, status, created_at, updated_at)
            VALUES (?, ?, 'session_log', 'The hall is well-lit and quiet.', '{}', 'dm_only', '[]', NULL, NULL, 'active', ?, ?)
        `).run(noteId, worldId, now, now);

        const blind = detectBlindSpots(
            { kind: 'scene', sceneNarrativeNoteId: noteId },
            [],
            { db },
        );
        const kinds = blind.map(b => b.whatKindOfDataIsMissing);
        // scene_participants is still flagged (no entityId), but no creature_row
        expect(kinds).not.toContain('scene_creature_row');
        expect(kinds).toContain('scene_participants');
    });
});
