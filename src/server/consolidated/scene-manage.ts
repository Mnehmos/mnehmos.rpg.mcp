/**
 * scene_manage — DM-committed shared narrative state.
 *
 * The DM is the System; the System is the DM. set_scene commits the current
 * narrative frame to the engine. Every agent invocation auto-pulls the
 * latest scene the character is a participant in — so every party-mate
 * reads the same narration, the same engine state, the same NPC list.
 * Zero drift on shared facts. Agents contribute only their character's
 * INTENT; the DM (this tool) authors the world.
 *
 * Actions:
 *   set      — commit a new scene (DM "GM screen" voice)
 *   list     — recent scenes for a world
 *   get      — fetch one by id
 *   current  — the latest scene for a participant (debug; auto-injection
 *              uses the same query under the hood)
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';
import { SessionContext } from '../types.js';
import { getDb } from '../../storage/index.js';
import { SceneRepository } from '../../storage/repos/scene.repo.js';
import { createActionRouter, ActionDefinition, McpResponse } from '../../utils/action-router.js';

const ACTIONS = ['set', 'list', 'get', 'current'] as const;
type SceneAction = typeof ACTIONS[number];

function ensureDb() {
    const dbPath = process.env.NODE_ENV === 'test'
        ? ':memory:'
        : process.env.RPG_DATA_DIR
            ? `${process.env.RPG_DATA_DIR}/rpg.db`
            : 'rpg.db';
    return getDb(dbPath);
}

const SetSchema = z.object({
    action: z.literal('set'),
    worldId: z.string().describe('World/campaign ID'),
    title: z.string().optional().describe('Short scene title (e.g., "What the Hour Can Honestly Hold")'),
    whenLabel: z.string().optional().describe('In-world time label (e.g., "PD 606 · Day 1 · 00:15")'),
    placeLabel: z.string().optional().describe('In-world place label (e.g., "Vocation House Inner Chamber, Sebastopyr")'),
    narration: z.string().min(1).describe('DM-authored prose for the scene — the shared world state every participant sees'),
    engineState: z.record(z.any()).optional().describe('Engine-tracked meters / hazards / flags for this moment (e.g., vas_halidani: "6412/15468", brass_nail_line: "nominal"). Free-form key/value.'),
    participants: z.array(z.string()).min(1).describe('Character IDs at the table for this scene — only these characters\' agents will see this scene on invoke'),
    previousSceneId: z.string().optional().describe('Optional back-pointer to the prior scene (for transcript / linked-list ordering)'),
    sceneId: z.string().optional().describe('Optional explicit scene ID (default: auto-generated UUID)')
});

const ListSchema = z.object({
    action: z.literal('list'),
    worldId: z.string().describe('World/campaign ID'),
    limit: z.number().int().min(1).max(100).optional().default(20)
});

const GetSchema = z.object({
    action: z.literal('get'),
    sceneId: z.string().describe('Scene ID')
});

const CurrentSchema = z.object({
    action: z.literal('current'),
    worldId: z.string(),
    characterId: z.string().describe('Character whose latest participating scene to fetch')
});

async function handleSet(args: z.infer<typeof SetSchema>): Promise<object> {
    const db = ensureDb();

    const worldCheck = db.prepare('SELECT id FROM worlds WHERE id = ?').get(args.worldId);
    if (!worldCheck) {
        return {
            error: true,
            code: 'WORLD_NOT_FOUND',
            message: `World "${args.worldId}" not found. Create it first with world_manage.`,
            suggestion: `Call: world_manage action: 'create' with id: '${args.worldId}'`
        };
    }

    // Verify all participants exist as characters (or NPCs sharing the characters table).
    const missing: string[] = [];
    for (const id of args.participants) {
        const row = db.prepare('SELECT id FROM characters WHERE id = ?').get(id);
        if (!row) missing.push(id);
    }
    if (missing.length > 0) {
        return {
            error: true,
            code: 'PARTICIPANT_NOT_FOUND',
            message: `Participant characters not found: ${missing.join(', ')}`,
            suggestion: 'Verify character IDs with character_manage action: "list" or "get".'
        };
    }

    const repo = new SceneRepository(db);
    const scene = repo.create({
        id: args.sceneId ?? randomUUID(),
        worldId: args.worldId,
        title: args.title ?? null,
        whenLabel: args.whenLabel ?? null,
        placeLabel: args.placeLabel ?? null,
        narration: args.narration,
        engineState: args.engineState ?? {},
        participants: args.participants,
        previousSceneId: args.previousSceneId ?? null,
        createdAt: new Date().toISOString()
    });

    return {
        actionType: 'set',
        success: true,
        sceneId: scene.id,
        scene,
        message: `Scene committed. ${scene.participants.length} participant(s) will see this on next invoke.`
    };
}

async function handleList(args: z.infer<typeof ListSchema>): Promise<object> {
    const repo = new SceneRepository(ensureDb());
    const scenes = repo.listRecent(args.worldId, args.limit);
    return { actionType: 'list', count: scenes.length, scenes };
}

async function handleGet(args: z.infer<typeof GetSchema>): Promise<object> {
    const repo = new SceneRepository(ensureDb());
    const scene = repo.findById(args.sceneId);
    if (!scene) {
        return { error: true, code: 'NOT_FOUND', message: `Scene "${args.sceneId}" not found.` };
    }
    return { actionType: 'get', scene };
}

async function handleCurrent(args: z.infer<typeof CurrentSchema>): Promise<object> {
    const repo = new SceneRepository(ensureDb());
    const scene = repo.findLatestForParticipant(args.worldId, args.characterId);
    if (!scene) {
        return {
            actionType: 'current',
            scene: null,
            message: `No scene committed yet for character ${args.characterId} in world ${args.worldId}.`
        };
    }
    return { actionType: 'current', scene };
}

const definitions: Record<SceneAction, ActionDefinition> = {
    set: {
        schema: SetSchema,
        handler: handleSet,
        aliases: ['commit', 'set_scene', 'create', 'new', 'frame', 'narrate_scene'],
        description: 'Commit a new scene — DM voice. Auto-injected into all participants\' next invoke.'
    },
    list: {
        schema: ListSchema,
        handler: handleList,
        aliases: ['recent', 'history', 'transcript'],
        description: 'List recent scenes for a world (newest-first).'
    },
    get: {
        schema: GetSchema,
        handler: handleGet,
        aliases: ['fetch', 'read'],
        description: 'Fetch a single scene by id.'
    },
    current: {
        schema: CurrentSchema,
        handler: handleCurrent,
        aliases: ['now', 'present', 'latest'],
        description: 'The latest scene a given character is a participant in (preview what their next invoke will see).'
    }
};

const router = createActionRouter({
    actions: ACTIONS,
    definitions,
    threshold: 0.6
});

export const SceneManageTool = {
    name: 'scene_manage',
    description: `Manage DM-committed shared scenes — the engine-side source of truth for "what is happening now."

🎬 SET A SCENE (DM voice):
  scene_manage action: 'set'
  - worldId, narration, participants[] required
  - title, whenLabel, placeLabel, engineState, previousSceneId optional

🎭 AUTO-INJECTION:
  After set, every participant agent's invoke will automatically include this
  scene as a system slice — same narration, same engine state, same party
  roster for everyone. Agents submit INTENT; they do not author the scene.

⏪ AUDIT:
  - 'list' for recent scenes in a world
  - 'get' for one by id
  - 'current' to preview what a given character's next invoke will see

Actions: set, list, get, current
Aliases: commit/set_scene/frame/narrate_scene→set, recent/history→list, now/latest→current`,
    actionSchemas: router.actionSchemas,
    inputSchema: z.object({
        action: z.string().describe('Action: set, list, get, current'),
        worldId: z.string().optional(),
        sceneId: z.string().optional(),
        characterId: z.string().optional(),
        title: z.string().optional(),
        whenLabel: z.string().optional(),
        placeLabel: z.string().optional(),
        narration: z.string().optional(),
        engineState: z.record(z.any()).optional(),
        participants: z.array(z.string()).optional(),
        previousSceneId: z.string().optional(),
        limit: z.number().optional()
    })
};

export async function handleSceneManage(args: unknown, _ctx: SessionContext): Promise<McpResponse> {
    return router(args as Record<string, unknown>);
}
