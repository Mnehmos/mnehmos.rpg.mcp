/**
 * Hazard detector — reads from committed state only.
 *
 * The cardinal rule: NEVER invent a hazard. Every emitted Hazard must
 * carry sourceEvidence pointing at a real row in a real table. If the
 * scene-text says "something moves in the shadow" but no creature row
 * exists, this module emits nothing — the blind-spot detector picks
 * that up instead.
 *
 * Per SPEC §3.5 — resolution = information. Honest absence is a
 * different answer from fog, and the engine refuses to conflate them.
 */

import type Database from 'better-sqlite3';
import { Hazard, TargetRef } from '../../schema/perception.js';

export interface ScanDeps {
    db: Database.Database;
}

interface RoomRow {
    id: string;
    name: string;
    atmospherics: string;
    entity_ids: string;
    created_at: string;
    updated_at: string;
}

interface CharacterRow {
    id: string;
    name: string;
    character_type: string | null;
    created_at: string;
}

interface EncounterRow {
    id: string;
    tokens: string;
    status: string;
    created_at: string;
    updated_at: string;
}

interface NarrativeRow {
    id: string;
    content: string;
    metadata: string;
    tags: string;
    type: string;
    created_at: string;
}

/**
 * Map a hazardous atmospheric to an environmental hazard.
 */
const ATMOSPHERIC_TO_HAZARD: Record<string, { name: string; severity: Hazard['severity'] }> = {
    DARKNESS: { name: 'Darkness', severity: 'moderate' },
    ANTIMAGIC: { name: 'Antimagic Field', severity: 'severe' },
    FOG: { name: 'Heavy Fog', severity: 'mild' },
    SILENCE: { name: 'Magical Silence', severity: 'moderate' },
    MAGICAL: { name: 'Magical Disturbance', severity: 'moderate' },
};

function scanRoom(roomId: string, deps: ScanDeps): Hazard[] {
    const hazards: Hazard[] = [];
    const room = deps.db.prepare(
        'SELECT * FROM room_nodes WHERE id = ?'
    ).get(roomId) as RoomRow | undefined;
    if (!room) return [];

    // Hazardous atmospherics
    let atmos: string[] = [];
    try { atmos = JSON.parse(room.atmospherics) as string[]; } catch { /* empty */ }
    for (const a of atmos) {
        const mapped = ATMOSPHERIC_TO_HAZARD[a];
        if (mapped) {
            hazards.push({
                id: `room_${roomId}_atmos_${a}`,
                name: mapped.name,
                kind: 'environmental',
                severity: mapped.severity,
                sourceEvidence: {
                    tool: 'spatial_manage',
                    rowId: room.id,
                    committedAt: room.updated_at ?? room.created_at,
                },
            });
        }
    }

    // Hostile entities living in the room
    let entityIds: string[] = [];
    try { entityIds = JSON.parse(room.entity_ids) as string[]; } catch { /* empty */ }
    for (const eid of entityIds) {
        const entity = deps.db.prepare(
            'SELECT id, name, character_type, created_at FROM characters WHERE id = ?'
        ).get(eid) as CharacterRow | undefined;
        if (!entity) continue;
        if (entity.character_type === 'pc') continue; // PCs aren't hazards
        hazards.push({
            id: `creature_${entity.id}`,
            name: entity.name,
            kind: 'creature',
            severity: 'severe',
            sourceEvidence: {
                tool: 'npc_manage',
                rowId: entity.id,
                committedAt: entity.created_at,
            },
        });
    }

    return hazards;
}

function scanEncounter(encounterId: string, deps: ScanDeps): Hazard[] {
    const hazards: Hazard[] = [];
    const enc = deps.db.prepare(
        'SELECT * FROM encounters WHERE id = ?'
    ).get(encounterId) as EncounterRow | undefined;
    if (!enc) return [];

    let tokens: Array<{ id?: string; characterId?: string; name?: string; hostile?: boolean }> = [];
    try { tokens = JSON.parse(enc.tokens); } catch { /* empty */ }

    for (const tok of tokens) {
        const tid = tok.characterId ?? tok.id;
        if (!tid) continue;
        hazards.push({
            id: `combatant_${tid}`,
            name: tok.name ?? `Combatant ${tid.slice(0, 8)}`,
            kind: 'creature',
            severity: 'severe',
            sourceEvidence: {
                tool: 'combat_manage',
                rowId: enc.id,
                committedAt: enc.updated_at ?? enc.created_at,
            },
        });
    }

    return hazards;
}

function scanScene(sceneNoteId: string, deps: ScanDeps): Hazard[] {
    const hazards: Hazard[] = [];
    const note = deps.db.prepare(
        'SELECT * FROM narrative_notes WHERE id = ?'
    ).get(sceneNoteId) as NarrativeRow | undefined;
    if (!note) return [];

    let tags: string[] = [];
    try { tags = JSON.parse(note.tags) as string[]; } catch { /* empty */ }

    // Only narrative notes EXPLICITLY tagged hazard:* are hazards.
    // Ambiguous narrative text is NOT a hazard — that's the §3.5 thesis.
    const hazardTags = tags.filter(t => t.startsWith('hazard:'));
    for (const tag of hazardTags) {
        const name = tag.slice('hazard:'.length) || 'Unspecified narrative hazard';
        hazards.push({
            id: `narrative_${note.id}_${tag}`,
            name,
            kind: 'social',
            severity: 'moderate',
            sourceEvidence: {
                tool: 'narrative_manage',
                rowId: note.id,
                committedAt: note.created_at,
            },
        });
    }

    return hazards;
}

export function scanHazards(target: TargetRef, deps: ScanDeps): Hazard[] {
    switch (target.kind) {
        case 'room':       return scanRoom(target.roomId, deps);
        case 'encounter':  return scanEncounter(target.encounterId, deps);
        case 'scene':      return scanScene(target.sceneNarrativeNoteId, deps);
    }
}

/**
 * Does the target row actually exist? Used by perception-manage to
 * reject INVALID_TARGET before any work is done.
 */
export function targetExists(target: TargetRef, deps: ScanDeps): boolean {
    switch (target.kind) {
        case 'room':
            return !!deps.db.prepare('SELECT id FROM room_nodes WHERE id = ?').get(target.roomId);
        case 'encounter':
            return !!deps.db.prepare('SELECT id FROM encounters WHERE id = ?').get(target.encounterId);
        case 'scene':
            return !!deps.db.prepare('SELECT id FROM narrative_notes WHERE id = ?').get(target.sceneNarrativeNoteId);
    }
}
