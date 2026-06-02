/**
 * Blind-spot detector — the §3.5 fog-as-information thesis encoded.
 *
 * For each kind of target_ref, an EXPECTED CATEGORIES list says what
 * kinds of rows the engine SHOULD have if this target had been fully
 * committed:
 *
 *   room        → atmospherics, exits, props/entities, room description
 *   encounter   → tokens, round, grid_bounds
 *   scene       → participants (entityId on narrative note), stakes (status)
 *
 * If an expected category has NO rows, the detector emits a blind_spot
 * naming the missing data AND a suggested_query that would commit it.
 * This is the difference between honest absence and fog:
 *
 *   commit  + hazards=[]    = scanned, nothing here.
 *   unknown + blind_spots[] = scanned, but the room itself isn't fully written.
 */

import type Database from 'better-sqlite3';
import { BlindSpot, Hazard, TargetRef } from '../../schema/perception.js';
import { ScanDeps } from './hazard-detector.js';

interface RoomRow {
    id: string;
    atmospherics: string;
    exits: string;
    entity_ids: string;
    base_description: string;
}

interface EncounterRow {
    id: string;
    tokens: string;
    grid_bounds: string | null;
}

interface NarrativeRow {
    id: string;
    content: string;
    entity_id: string | null;
    status: string | null;
}

function isEmptyJsonArray(s: string | null | undefined): boolean {
    if (!s) return true;
    try {
        const v = JSON.parse(s);
        return Array.isArray(v) && v.length === 0;
    } catch {
        return true;
    }
}

function detectRoomBlindSpots(roomId: string, deps: ScanDeps): BlindSpot[] {
    const blind: BlindSpot[] = [];
    const room = deps.db.prepare(
        'SELECT id, atmospherics, exits, entity_ids, base_description FROM room_nodes WHERE id = ?'
    ).get(roomId) as RoomRow | undefined;
    if (!room) return blind;

    if (isEmptyJsonArray(room.atmospherics)) {
        blind.push({
            whatKindOfDataIsMissing: 'room_atmospherics',
            whyItMatters:
                'Environmental hazards (darkness, antimagic, fog) are read from the room\'s atmospherics array. ' +
                'An empty array means either honestly no atmospherics, or never committed — both look the same here.',
            suggestedQuery:
                'spatial_manage action:"update" roomId:"' + roomId + '" atmospherics:[...]',
        });
    }
    if (isEmptyJsonArray(room.exits)) {
        blind.push({
            whatKindOfDataIsMissing: 'room_exits',
            whyItMatters:
                'Elimination-tier controls (close-the-door, withdraw-through-an-exit) cannot be ranked ' +
                'without knowing what exits actually exist. The lens drops to PPE-tier confidence partial.',
            suggestedQuery:
                'spatial_manage action:"get_exits" roomId:"' + roomId + '"',
        });
    }
    if (isEmptyJsonArray(room.entity_ids)) {
        blind.push({
            whatKindOfDataIsMissing: 'room_entities',
            whyItMatters:
                'No creatures or props are committed to this room. If the scene-text implied any, ' +
                'they need to be spawned for the lens to see them.',
            suggestedQuery:
                'spawn_manage action:"spawn_character" roomId:"' + roomId + '"',
        });
    }
    if (!room.base_description || room.base_description.trim().length < 10) {
        blind.push({
            whatKindOfDataIsMissing: 'room_description',
            whyItMatters:
                'Room has no committed description — the social-hazard surface (who might be listening, ' +
                'what tone the place carries) is not queryable.',
            suggestedQuery:
                'spatial_manage action:"update" roomId:"' + roomId + '" baseDescription:"..."',
        });
    }

    return blind;
}

function detectEncounterBlindSpots(encId: string, deps: ScanDeps): BlindSpot[] {
    const blind: BlindSpot[] = [];
    const enc = deps.db.prepare(
        'SELECT id, tokens, grid_bounds FROM encounters WHERE id = ?'
    ).get(encId) as EncounterRow | undefined;
    if (!enc) return blind;

    if (isEmptyJsonArray(enc.tokens)) {
        blind.push({
            whatKindOfDataIsMissing: 'encounter_tokens',
            whyItMatters: 'Encounter has no tokens — combatants and ranges are not queryable.',
            suggestedQuery: 'combat_manage action:"start_encounter" with combatants',
        });
    }
    if (!enc.grid_bounds) {
        blind.push({
            whatKindOfDataIsMissing: 'encounter_grid_bounds',
            whyItMatters:
                'Without grid bounds the engineering-tier controls (interpose a wall, withdraw to range) ' +
                'cannot be reasoned about geometrically.',
            suggestedQuery: 'combat_map action:"set_grid_bounds" encounterId:"' + encId + '"',
        });
    }
    return blind;
}

function detectSceneBlindSpots(noteId: string, deps: ScanDeps): BlindSpot[] {
    const blind: BlindSpot[] = [];
    const note = deps.db.prepare(
        'SELECT id, content, entity_id, status FROM narrative_notes WHERE id = ?'
    ).get(noteId) as NarrativeRow | undefined;
    if (!note) return blind;

    if (!note.entity_id) {
        blind.push({
            whatKindOfDataIsMissing: 'scene_participants',
            whyItMatters:
                'Scene narration has no committed entityId — the actual creatures or NPCs implied by ' +
                'the text are not queryable, so no commit-quality answer about them is possible.',
            suggestedQuery: 'npc_manage action:"spawn" or narrative_manage action:"update" entityId:"<id>"',
        });
    }

    // Ambiguous fiction-text test: if the content mentions "moves",
    // "lurks", "shadow", "creature", etc. but no entity row is bound,
    // that's exactly the §3.5 blind-spot pattern.
    const ambiguousHints = /(moves?|lurks?|shadow|creature|figure|thing|something)/i;
    if (!note.entity_id && ambiguousHints.test(note.content)) {
        blind.push({
            whatKindOfDataIsMissing: 'scene_creature_row',
            whyItMatters:
                'Narration hints at a creature ("something moves in the shadow") but no creature row ' +
                'backs the narration. The engine stays mute rather than invent.',
            suggestedQuery: 'spawn_manage action:"spawn_character" or npc_manage action:"create"',
        });
    }

    return blind;
}

export function detectBlindSpots(
    target: TargetRef,
    _scannedHazards: Hazard[],
    deps: ScanDeps,
): BlindSpot[] {
    switch (target.kind) {
        case 'room':      return detectRoomBlindSpots(target.roomId, deps);
        case 'encounter': return detectEncounterBlindSpots(target.encounterId, deps);
        case 'scene':     return detectSceneBlindSpots(target.sceneNarrativeNoteId, deps);
    }
}
