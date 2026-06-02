/**
 * Scene slice — current DM-committed scene for this character.
 *
 * Looked up from the scenes table at compose time. Renders the shared
 * narrative frame (when, place, narration, engine_state, party roster)
 * so every participating agent reads the same world state. The agent's
 * job is to declare INTENT; the DM/engine adjudicates the next frame.
 */

import { SceneRepository, Scene } from '../../../storage/repos/scene.repo.js';
import { CharacterRepository } from '../../../storage/repos/character.repo.js';
import { Character, NPC } from '../../../schema/character.js';

const HEADER = '--- CURRENT SCENE (DM-COMMITTED · SHARED ACROSS PARTY) ---';

export interface SceneSliceOptions {
    /** How many recent scenes to include (default 1 — just the current). */
    lookback?: number;
}

function formatRoster(participants: string[], characterRepo: CharacterRepository): string {
    if (participants.length === 0) return '(no participants recorded)';
    const lines: string[] = [];
    for (const id of participants) {
        const char = characterRepo.findById(id) as Character | NPC | null;
        if (!char) {
            lines.push(`  - ${id} (unknown — character record missing)`);
            continue;
        }
        const cls = char.characterClass ? ` ${char.characterClass}` : '';
        const lvl = typeof char.level === 'number' ? ` L${char.level}` : '';
        const hp = typeof char.hp === 'number' && typeof char.maxHp === 'number'
            ? ` · HP ${char.hp}/${char.maxHp}`
            : '';
        const ac = typeof char.ac === 'number' ? ` · AC ${char.ac}` : '';
        lines.push(`  - ${char.name}${cls ? ' —' + cls : ''}${lvl}${hp}${ac}`);
    }
    return lines.join('\n');
}

function formatEngineState(state: Record<string, unknown>): string {
    const entries = Object.entries(state);
    if (entries.length === 0) return '';
    const lines = entries.map(([k, v]) => {
        if (v === null || v === undefined) return null;
        if (Array.isArray(v)) {
            if (v.length === 0) return null;
            return `  - ${k}: ${v.join(', ')}`;
        }
        if (typeof v === 'object') {
            return `  - ${k}: ${JSON.stringify(v)}`;
        }
        return `  - ${k}: ${String(v)}`;
    }).filter((s): s is string => s !== null);
    if (lines.length === 0) return '';
    return `ENGINE STATE:\n${lines.join('\n')}`;
}

function formatScene(scene: Scene, characterRepo: CharacterRepository, isCurrent: boolean): string {
    const parts: string[] = [];
    const header = isCurrent ? '' : '(PRIOR SCENE) ';
    if (scene.title) parts.push(`${header}TITLE: ${scene.title}`);
    if (scene.whenLabel) parts.push(`WHEN: ${scene.whenLabel}`);
    if (scene.placeLabel) parts.push(`PLACE: ${scene.placeLabel}`);
    if (parts.length > 0) parts.push('');
    parts.push(scene.narration.trim());
    const engineState = formatEngineState(scene.engineState);
    if (engineState) {
        parts.push('');
        parts.push(engineState);
    }
    parts.push('');
    parts.push('PARTICIPANTS (this is your party — they are at the table with you):');
    parts.push(formatRoster(scene.participants, characterRepo));
    return parts.join('\n');
}

export function buildSceneSlice(
    characterId: string,
    sceneRepo: SceneRepository,
    characterRepo: CharacterRepository,
    options: SceneSliceOptions = {}
): string | null {
    const lookback = Math.max(1, options.lookback ?? 1);
    const scenes = sceneRepo.listLatestForParticipant(characterId, lookback);
    if (scenes.length === 0) return null;

    // Scenes come back newest-first; prior scenes render before the current one.
    const ordered = [...scenes].reverse();
    const blocks: string[] = [HEADER];
    for (let i = 0; i < ordered.length; i++) {
        const isCurrent = i === ordered.length - 1;
        blocks.push(formatScene(ordered[i], characterRepo, isCurrent));
        if (!isCurrent) blocks.push('---');
    }
    blocks.push('');
    blocks.push('THIS IS THE SHARED WORLD STATE. You do not author the scene. You do not invent NPCs, locations, or facts not in the narration above. You submit your CHARACTER\'S INTENT — what they say, what they do, what queries they fire — and the DM/engine adjudicates the result.');
    return blocks.join('\n');
}
