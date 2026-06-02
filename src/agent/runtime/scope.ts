/**
 * Scene-scope gate (SYSTEM.md Standing Rule 5: "Respect fog. Never leak one
 * agent's private state into another agent's context.")
 *
 * An agent must not be invoked into a scene their character is not in. The
 * only override is an in-fiction distance-contact mechanism passed as
 * `remoteContact` (sending spell, scrying, divine voice, telepathy, etc.).
 *
 * Scope resolution order:
 *   1. remoteContact present                 → honored, no presence check
 *   2. encounterId present                   → character must be in encounter.tokens
 *   3. sceneId present                       → character.currentRoomId must match
 *   4. neither + AGENT_SCENE_STRICT=true     → skipped (no_scene_context_strict)
 *   5. neither, default (compatibility)      → allowed (DM-direct invoke)
 *
 * Compatibility mode default is permissive on purpose: existing call sites
 * (DM-direct invokes from the System / main loop) shouldn't break. Strict
 * mode is opt-in via env var for stricter production runs where every
 * invoke must declare its scene.
 */

import { Character, NPC } from '../../schema/character.js';
import { AgentRuntimeDeps } from './deps.js';

export type RemoteContactMethod =
    | 'sending'
    | 'scrying'
    | 'voice_of_god'
    | 'telepathy'
    | 'sympathy'
    | 'dream'
    | 'omen'
    | 'echo';

export interface RemoteContact {
    method: RemoteContactMethod;
    /** Originator (character id or spell/source name). Optional for voice_of_god. */
    source?: string;
    payload: string;
    /** True when the channel does not permit a reply (e.g. voice_of_god, omen). */
    oneWay?: boolean;
    /** Sending-style word limit on the received message (for prompt context). */
    wordLimit?: number;
}

export interface SceneScopeInput {
    encounterId?: string;
    sceneId?: string;
    remoteContact?: RemoteContact;
}

export interface SceneScopeResult {
    skip: boolean;
    reason?: string;
}

/**
 * Three-state result so the gate can distinguish "encounter not found"
 * (we don't have the data, default-allow per compatibility mode) from
 * "encounter found and character not in it" (real fog leak, deny).
 */
type EncounterPresence = 'present' | 'absent' | 'no_data';

function characterInEncounter(
    encounterId: string,
    characterId: string,
    deps: AgentRuntimeDeps
): EncounterPresence {
    const row = deps.encounterRepo.findById(encounterId);
    if (!row) return 'no_data';
    let tokens: unknown;
    try {
        tokens = JSON.parse(row.tokens);
    } catch {
        return 'no_data';
    }
    if (!Array.isArray(tokens)) return 'no_data';
    const found = tokens.some((t: unknown) => {
        if (t && typeof t === 'object' && 'id' in t) {
            return (t as { id: unknown }).id === characterId;
        }
        return false;
    });
    return found ? 'present' : 'absent';
}

export function checkSceneScope(
    input: SceneScopeInput,
    character: Character | NPC | null,
    deps: AgentRuntimeDeps
): SceneScopeResult {
    // 1. Distance contact overrides presence — the channel itself carries the truth.
    if (input.remoteContact) return { skip: false };

    // 2. Encounter-anchored: must be a participant. If the encounter row is
    //    missing/unreadable we deliberately FALL THROUGH to the no-scene-
    //    context branch — we only deny when we KNOW the character is out,
    //    not when the data is absent. This keeps callers that pass a stale
    //    or placeholder encounterId from breaking on a phantom skip.
    if (input.encounterId) {
        if (!character) return { skip: true, reason: 'out_of_scene:character_not_found' };
        const presence = characterInEncounter(input.encounterId, character.id, deps);
        if (presence === 'present') return { skip: false };
        if (presence === 'absent') return { skip: true, reason: 'out_of_scene:not_in_encounter' };
        // 'no_data' → fall through
    }

    // 3. Room-anchored: currentRoomId must match.
    if (input.sceneId) {
        if (!character) return { skip: true, reason: 'out_of_scene:character_not_found' };
        const room = (character as { currentRoomId?: string }).currentRoomId;
        if (room === input.sceneId) return { skip: false };
        return { skip: true, reason: 'out_of_scene:room_mismatch' };
    }

    // 4. No scene context: strict opt-in skips; default compatibility allows.
    if (process.env.AGENT_SCENE_STRICT === 'true') {
        return { skip: true, reason: 'no_scene_context_strict' };
    }
    return { skip: false };
}

/**
 * When remoteContact is honored, synthesize a prefix that makes the channel
 * legible to the agent's prompt so it cannot pretend to see the scene
 * directly. Returned string replaces (or augments) the situation field.
 */
export function composeRemoteContactSituation(
    contact: RemoteContact,
    originalSituation: string | undefined
): string {
    const sourceLabel = contact.source ? ` from ${contact.source}` : '';
    const wordLimitLabel = contact.wordLimit ? ` (limited to ${contact.wordLimit} words)` : '';
    const oneWayLabel = contact.oneWay
        ? ' This is a one-way channel; you cannot reply through it.'
        : '';
    const prefix =
        `[REMOTE CONTACT — channel: ${contact.method}${sourceLabel}${wordLimitLabel}] ` +
        `You receive this through ${contact.method}${sourceLabel}. ` +
        `You do not see the scene directly.${oneWayLabel} ` +
        `The message is: "${contact.payload}"`;
    if (!originalSituation) return prefix;
    return `${prefix}\n\n${originalSituation}`;
}
