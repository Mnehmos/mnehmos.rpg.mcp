/**
 * Consolidated Narrative Management Tool
 *
 * Replaces 6 individual narrative tools with a single action-based tool:
 * - add_narrative_note -> action: 'add'
 * - search_narrative_notes -> action: 'search'
 * - update_narrative_note -> action: 'update'
 * - get_narrative_note -> action: 'get'
 * - delete_narrative_note -> action: 'delete'
 * - get_narrative_context_notes -> action: 'get_context'
 */

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { SessionContext } from '../types.js';
import { getDb } from '../../storage/index.js';
import { createActionRouter, ActionDefinition, McpResponse } from '../../utils/action-router.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS & ENUMS
// ═══════════════════════════════════════════════════════════════════════════

const ACTIONS = ['add', 'batch_add', 'search', 'update', 'get', 'delete', 'get_context'] as const;
type NarrativeAction = typeof ACTIONS[number];

const NoteTypeEnum = z.enum([
    'plot_thread',
    'canonical_moment',
    'npc_voice',
    'foreshadowing',
    'session_log'
]);

const NoteStatusEnum = z.enum([
    'active',
    'resolved',
    'dormant',
    'archived'
]);

const VisibilityEnum = z.enum([
    'dm_only',
    'player_visible'
]);

// Type-specific metadata schemas
const PlotThreadMetadata = z.object({
    urgency: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    hooks: z.array(z.string()).optional().default([]),
    resolution_conditions: z.array(z.string()).optional().default([])
});

const CanonicalMomentMetadata = z.object({
    speaker: z.string().optional(),
    participants: z.array(z.string()).optional().default([]),
    location: z.string().optional(),
    session_number: z.number().optional()
});

const NpcVoiceMetadata = z.object({
    speech_pattern: z.string().optional(),
    vocabulary: z.array(z.string()).optional().default([]),
    mannerisms: z.array(z.string()).optional().default([]),
    current_goal: z.string().optional(),
    secrets: z.array(z.string()).optional().default([])
});

const ForeshadowingMetadata = z.object({
    target: z.string().describe('What this foreshadows'),
    hints_given: z.array(z.string()).optional().default([]),
    hints_remaining: z.array(z.string()).optional().default([]),
    trigger: z.string().optional().describe('When to reveal fully')
});

const SessionLogMetadata = z.object({
    session_number: z.number().optional(),
    xp_awarded: z.number().optional(),
    player_count: z.number().optional()
});

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE HELPER
// ═══════════════════════════════════════════════════════════════════════════

function ensureDb() {
    const dbPath = process.env.NODE_ENV === 'test'
        ? ':memory:'
        : process.env.RPG_DATA_DIR
            ? `${process.env.RPG_DATA_DIR}/rpg.db`
            : 'rpg.db';
    return getDb(dbPath);
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

const AddSchema = z.object({
    action: z.literal('add'),
    worldId: z.string().describe('World/campaign ID'),
    type: NoteTypeEnum.describe('Note type: plot_thread, canonical_moment, npc_voice, foreshadowing, session_log'),
    content: z.string().min(1).describe('Main text content'),
    metadata: z.record(z.any()).optional().default({}).describe('Type-specific structured data'),
    visibility: VisibilityEnum.optional().default('dm_only'),
    tags: z.array(z.string()).optional().default([]).describe('Tags for filtering'),
    entityId: z.string().optional().describe('Link to character/NPC/location'),
    entityType: z.enum(['character', 'npc', 'location', 'item']).optional(),
    status: NoteStatusEnum.optional().default('active')
});

const BatchAddSchema = z.object({
    action: z.literal('batch_add'),
    worldId: z.string().describe('World/campaign ID'),
    notes: z.array(z.object({
        type: NoteTypeEnum.describe('Note type'),
        content: z.string().min(1),
        metadata: z.record(z.any()).optional().default({}),
        visibility: VisibilityEnum.optional().default('dm_only'),
        tags: z.array(z.string()).optional().default([]),
        entityId: z.string().optional(),
        entityType: z.enum(['character', 'npc', 'location', 'item']).optional(),
        status: NoteStatusEnum.optional().default('active')
    })).min(1).max(20).describe('1–20 notes to create in one transaction')
});

const SearchSchema = z.object({
    action: z.literal('search'),
    worldId: z.string().describe('World/campaign ID'),
    query: z.string().optional().describe('Text search in content'),
    type: NoteTypeEnum.optional().describe('Filter by note type'),
    status: NoteStatusEnum.optional().describe('Filter by status'),
    tags: z.array(z.string()).optional().describe('Filter by tags (AND logic)'),
    entityId: z.string().optional().describe('Filter by linked entity'),
    visibility: VisibilityEnum.optional().describe('Filter by visibility'),
    limit: z.number().optional().default(20).describe('Max results'),
    orderBy: z.enum(['created_at', 'updated_at']).optional().default('created_at')
});

const UpdateSchema = z.object({
    action: z.literal('update'),
    noteId: z.string().describe('ID of the note to update'),
    content: z.string().optional().describe('New content'),
    metadata: z.record(z.any()).optional().describe('Merge into existing metadata'),
    status: NoteStatusEnum.optional().describe('Change status'),
    visibility: VisibilityEnum.optional(),
    tags: z.array(z.string()).optional().describe('Replace tags')
});

const GetSchema = z.object({
    action: z.literal('get'),
    noteId: z.string().describe('ID of the note to retrieve')
});

const DeleteSchema = z.object({
    action: z.literal('delete'),
    noteId: z.string().describe('ID of the note to delete')
});

const GetContextSchema = z.object({
    action: z.literal('get_context'),
    worldId: z.string().describe('World/campaign ID'),
    includeTypes: z.array(NoteTypeEnum).optional().default(['plot_thread', 'canonical_moment', 'npc_voice', 'foreshadowing']),
    maxPerType: z.number().optional().default(5).describe('Max notes per type'),
    statusFilter: z.array(NoteStatusEnum).optional().default(['active']).describe('Only notes with these statuses'),
    forPlayer: z.boolean().optional().default(false).describe('Only return player_visible notes')
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTION HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

async function handleAdd(args: z.infer<typeof AddSchema>): Promise<object> {
    const db = ensureDb();
    const id = uuidv4();
    const now = new Date().toISOString();

    // PLAYTEST-FIX: Validate world exists before insert to give helpful error
    const worldCheck = db.prepare('SELECT id, name FROM worlds WHERE id = ?').get(args.worldId) as { id: string; name: string } | undefined;
    if (!worldCheck) {
        return {
            error: true,
            code: 'WORLD_NOT_FOUND',
            message: `World "${args.worldId}" not found. Create it first with world_manage.`,
            suggestion: `Call: world_manage action: 'create' with id: '${args.worldId}'`,
            providedWorldId: args.worldId
        };
    }

    // Validate metadata against type-specific schema
    let validatedMetadata = args.metadata;
    try {
        switch (args.type) {
            case 'plot_thread':
                validatedMetadata = PlotThreadMetadata.parse(args.metadata);
                break;
            case 'canonical_moment':
                validatedMetadata = CanonicalMomentMetadata.parse(args.metadata);
                break;
            case 'npc_voice':
                validatedMetadata = NpcVoiceMetadata.parse(args.metadata);
                break;
            case 'foreshadowing':
                validatedMetadata = ForeshadowingMetadata.parse(args.metadata);
                break;
            case 'session_log':
                validatedMetadata = SessionLogMetadata.parse(args.metadata);
                break;
        }
    } catch {
        // Allow flexible metadata, just use as-is
    }

    db.prepare(`
        INSERT INTO narrative_notes (id, world_id, type, content, metadata, visibility, tags, entity_id, entity_type, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        id,
        args.worldId,
        args.type,
        args.content,
        JSON.stringify(validatedMetadata),
        args.visibility,
        JSON.stringify(args.tags),
        args.entityId || null,
        args.entityType || null,
        args.status,
        now,
        now
    );

    return {
        success: true,
        noteId: id,
        type: args.type,
        message: `Created ${args.type} note: "${args.content.substring(0, 50)}${args.content.length > 50 ? '...' : ''}"`
    };
}

async function handleBatchAdd(args: z.infer<typeof BatchAddSchema>): Promise<object> {
    const db = ensureDb();

    const worldCheck = db.prepare('SELECT id FROM worlds WHERE id = ?').get(args.worldId);
    if (!worldCheck) {
        return {
            error: true,
            code: 'WORLD_NOT_FOUND',
            message: `World "${args.worldId}" not found. Create it first with world_manage.`
        };
    }

    const now = new Date().toISOString();
    const stmt = db.prepare(`
        INSERT INTO narrative_notes (id, world_id, type, content, metadata, visibility, tags, entity_id, entity_type, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const created: Array<{ noteId: string; type: string; content: string }> = [];

    const insertAll = db.transaction(() => {
        for (const note of args.notes) {
            const id = uuidv4();
            stmt.run(
                id,
                args.worldId,
                note.type,
                note.content,
                JSON.stringify(note.metadata ?? {}),
                note.visibility ?? 'dm_only',
                JSON.stringify(note.tags ?? []),
                note.entityId ?? null,
                note.entityType ?? null,
                note.status ?? 'active',
                now,
                now
            );
            created.push({
                noteId: id,
                type: note.type,
                content: note.content.substring(0, 60) + (note.content.length > 60 ? '...' : '')
            });
        }
    });

    insertAll();

    return {
        success: true,
        createdCount: created.length,
        notes: created
    };
}

async function handleSearch(args: z.infer<typeof SearchSchema>): Promise<object> {
    const db = ensureDb();

    let sql = `SELECT * FROM narrative_notes WHERE world_id = ?`;
    const params: unknown[] = [args.worldId];

    if (args.type) {
        sql += ` AND type = ?`;
        params.push(args.type);
    }

    if (args.status) {
        sql += ` AND status = ?`;
        params.push(args.status);
    }

    if (args.visibility) {
        sql += ` AND visibility = ?`;
        params.push(args.visibility);
    }

    if (args.entityId) {
        sql += ` AND entity_id = ?`;
        params.push(args.entityId);
    }

    if (args.query) {
        sql += ` AND content LIKE ?`;
        params.push(`%${args.query}%`);
    }

    // Tag filtering (AND logic)
    if (args.tags && args.tags.length > 0) {
        for (const tag of args.tags) {
            sql += ` AND tags LIKE ?`;
            params.push(`%"${tag}"%`);
        }
    }

    sql += ` ORDER BY ${args.orderBy} DESC LIMIT ?`;
    params.push(args.limit);

    const notes = db.prepare(sql).all(...params) as NarrativeNoteRow[];

    const results = notes.map(note => ({
        id: note.id,
        worldId: note.world_id,
        type: note.type,
        content: note.content,
        metadata: JSON.parse(note.metadata || '{}'),
        visibility: note.visibility,
        tags: JSON.parse(note.tags || '[]'),
        entityId: note.entity_id,
        entityType: note.entity_type,
        status: note.status,
        createdAt: note.created_at,
        updatedAt: note.updated_at
    }));

    return {
        count: results.length,
        notes: results
    };
}

async function handleUpdate(args: z.infer<typeof UpdateSchema>): Promise<object> {
    const db = ensureDb();

    const existing = db.prepare('SELECT * FROM narrative_notes WHERE id = ?').get(args.noteId) as NarrativeNoteRow | undefined;
    if (!existing) {
        return {
            error: true,
            message: `Note ${args.noteId} not found`
        };
    }

    const updates: string[] = [];
    const params: unknown[] = [];

    if (args.content !== undefined) {
        updates.push('content = ?');
        params.push(args.content);
    }

    if (args.status !== undefined) {
        updates.push('status = ?');
        params.push(args.status);
    }

    if (args.visibility !== undefined) {
        updates.push('visibility = ?');
        params.push(args.visibility);
    }

    if (args.tags !== undefined) {
        updates.push('tags = ?');
        params.push(JSON.stringify(args.tags));
    }

    if (args.metadata !== undefined) {
        const existingMeta = JSON.parse(existing.metadata || '{}');
        const merged = { ...existingMeta, ...args.metadata };
        updates.push('metadata = ?');
        params.push(JSON.stringify(merged));
    }

    if (updates.length === 0) {
        return {
            success: true,
            message: 'No updates provided'
        };
    }

    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(args.noteId);

    db.prepare(`UPDATE narrative_notes SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    return {
        success: true,
        noteId: args.noteId,
        message: `Updated note. Changes: ${updates.slice(0, -1).join(', ')}`
    };
}

async function handleGet(args: z.infer<typeof GetSchema>): Promise<object> {
    const db = ensureDb();

    const note = db.prepare('SELECT * FROM narrative_notes WHERE id = ?').get(args.noteId) as NarrativeNoteRow | undefined;

    if (!note) {
        return {
            error: true,
            message: `Note ${args.noteId} not found`
        };
    }

    return {
        id: note.id,
        worldId: note.world_id,
        type: note.type,
        content: note.content,
        metadata: JSON.parse(note.metadata || '{}'),
        visibility: note.visibility,
        tags: JSON.parse(note.tags || '[]'),
        entityId: note.entity_id,
        entityType: note.entity_type,
        status: note.status,
        createdAt: note.created_at,
        updatedAt: note.updated_at
    };
}

async function handleDelete(args: z.infer<typeof DeleteSchema>): Promise<object> {
    const db = ensureDb();

    const result = db.prepare('DELETE FROM narrative_notes WHERE id = ?').run(args.noteId);

    return {
        success: result.changes > 0,
        deleted: result.changes > 0,
        message: result.changes > 0 ? 'Note deleted' : 'Note not found'
    };
}

async function handleGetContext(args: z.infer<typeof GetContextSchema>): Promise<object> {
    const db = ensureDb();

    const typePriority: Record<string, number> = {
        'foreshadowing': 100,
        'plot_thread': 90,
        'npc_voice': 80,
        'canonical_moment': 70,
        'session_log': 50
    };

    const typeLabels: Record<string, string> = {
        'foreshadowing': 'FORESHADOWING HINTS',
        'plot_thread': 'ACTIVE PLOT THREADS',
        'npc_voice': 'NPC VOICE NOTES',
        'canonical_moment': 'CANONICAL MOMENTS',
        'session_log': 'SESSION LOGS'
    };

    const sections: { title: string; notes: unknown[]; priority: number }[] = [];

    for (const noteType of args.includeTypes) {
        let sql = `SELECT * FROM narrative_notes WHERE world_id = ? AND type = ?`;
        const params: unknown[] = [args.worldId, noteType];

        if (args.statusFilter.length > 0) {
            sql += ` AND status IN (${args.statusFilter.map(() => '?').join(',')})`;
            params.push(...args.statusFilter);
        }

        if (args.forPlayer) {
            sql += ` AND visibility = 'player_visible'`;
        }

        sql += ` ORDER BY created_at DESC LIMIT ?`;
        params.push(args.maxPerType);

        const notes = db.prepare(sql).all(...params) as NarrativeNoteRow[];

        if (notes.length > 0) {
            sections.push({
                title: typeLabels[noteType] || noteType.toUpperCase(),
                notes: notes.map(n => ({
                    id: n.id,
                    content: n.content,
                    metadata: JSON.parse(n.metadata || '{}'),
                    tags: JSON.parse(n.tags || '[]'),
                    status: n.status,
                    entityId: n.entity_id,
                    entityType: n.entity_type,
                    createdAt: n.created_at
                })),
                priority: typePriority[noteType] || 0
            });
        }
    }

    sections.sort((a, b) => b.priority - a.priority);

    // Format for LLM injection
    let contextText = '';
    for (const section of sections) {
        contextText += `--- ${section.title} ---\n`;
        for (const note of section.notes as Array<{ content: string; metadata: Record<string, unknown>; tags: string[] }>) {
            contextText += `- ${note.content}`;
            if (note.metadata && Object.keys(note.metadata).length > 0) {
                const metaStr = Object.entries(note.metadata)
                    .filter(([_, v]) => v !== undefined && v !== null && (Array.isArray(v) ? v.length > 0 : true))
                    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
                    .join(' | ');
                if (metaStr) contextText += ` [${metaStr}]`;
            }
            if (note.tags && note.tags.length > 0) {
                contextText += ` #${note.tags.join(' #')}`;
            }
            contextText += '\n';
        }
        contextText += '\n';
    }

    if (!contextText.trim()) {
        return {
            message: 'No narrative notes found for this world',
            context: '',
            sectionCount: 0
        };
    }

    return {
        sectionCount: sections.length,
        noteCount: sections.reduce((sum, s) => sum + s.notes.length, 0),
        context: contextText.trim()
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION ROUTER
// ═══════════════════════════════════════════════════════════════════════════

const definitions: Record<NarrativeAction, ActionDefinition> = {
    add: {
        schema: AddSchema,
        handler: handleAdd,
        aliases: ['create', 'new'],
        description: 'Create a single typed narrative note (use batch_add for multiple)'
    },
    batch_add: {
        schema: BatchAddSchema,
        handler: handleBatchAdd,
        aliases: ['add_many', 'bulk_add', 'multi_add', 'log_session'],
        description: 'Create multiple narrative notes in one transaction — preferred over repeated add calls'
    },
    search: {
        schema: SearchSchema,
        handler: handleSearch,
        aliases: ['find', 'list', 'query'],
        description: 'Search and filter narrative notes'
    },
    update: {
        schema: UpdateSchema,
        handler: handleUpdate,
        aliases: ['edit', 'modify'],
        description: 'Update an existing note'
    },
    get: {
        schema: GetSchema,
        handler: handleGet,
        aliases: ['fetch', 'read'],
        description: 'Retrieve a single note by ID'
    },
    delete: {
        schema: DeleteSchema,
        handler: handleDelete,
        aliases: ['remove'],
        description: 'Delete a narrative note'
    },
    get_context: {
        schema: GetContextSchema,
        handler: handleGetContext,
        aliases: ['context', 'inject'],
        description: 'Get aggregated context for LLM prompt injection'
    }
};

const router = createActionRouter({
    actions: ACTIONS,
    definitions,
    threshold: 0.6
});

// ═══════════════════════════════════════════════════════════════════════════
// TOOL DEFINITION & HANDLER
// ═══════════════════════════════════════════════════════════════════════════

export const NarrativeManageTool = {
    name: 'narrative_manage',
    description: `Manage narrative notes for AI-driven storytelling.

📝 NOTE TYPES:
- plot_thread: Active storylines (urgency, hooks, resolution conditions)
- canonical_moment: Key events (quotes, memorable scenes)
- npc_voice: Character voice notes (speech patterns, mannerisms, secrets)
- foreshadowing: Hints about future reveals (what it foreshadows, trigger)
- session_log: Session summaries (XP, attendance, events)

🎯 AI WORKFLOW:
1. batch_add - PREFERRED: Create multiple notes at end-of-session (one call, one transaction)
2. add - Create a single note during play when something notable happens
3. get_context - Inject into system prompt for informed storytelling
4. update - Mark plot_threads as 'resolved' when completed

⚡ BATCH FIRST: When cataloguing session events, plot threads, or foreshadowing at once,
   use batch_add with a notes[] array instead of making multiple add calls.
   Example: { action: "batch_add", worldId: "...", notes: [
     { type: "plot_thread", content: "..." },
     { type: "foreshadowing", content: "..." },
     { type: "session_log", content: "..." }
   ]}

👀 VISIBILITY:
- dm_only: Only DM sees (default) - secrets, NPC true motivations
- player_visible: Can be shown to players - session logs, known lore

Actions: add, batch_add, search, update, get, delete, get_context
Aliases: add_many/bulk_add/log_session→batch_add, create→add, find→search, context→get_context`,
    actionSchemas: router.actionSchemas,
    inputSchema: z.object({
        action: z.string().describe('Action: add, batch_add, search, update, get, delete, get_context'),
        worldId: z.string().optional().describe('World ID (required for add, search, get_context)'),
        noteId: z.string().optional().describe('Note ID (required for get, update, delete)'),
        type: NoteTypeEnum.optional().describe('Note type: plot_thread, canonical_moment, npc_voice, foreshadowing, session_log'),
        content: z.string().optional().describe('Note content (required for add)'),
        metadata: z.record(z.any()).optional().describe('Type-specific metadata'),
        visibility: VisibilityEnum.optional(),
        tags: z.array(z.string()).optional(),
        status: NoteStatusEnum.optional(),
        entityId: z.string().optional(),
        entityType: z.enum(['character', 'npc', 'location', 'item']).optional(),
        notes: z.array(z.object({
            type: NoteTypeEnum,
            content: z.string().min(1),
            metadata: z.record(z.any()).optional(),
            visibility: VisibilityEnum.optional(),
            tags: z.array(z.string()).optional(),
            entityId: z.string().optional(),
            entityType: z.enum(['character', 'npc', 'location', 'item']).optional(),
            status: NoteStatusEnum.optional()
        })).optional().describe('Array of notes for batch_add (1–20)'),
        query: z.string().optional().describe('Text search (for search action)'),
        limit: z.number().optional(),
        orderBy: z.enum(['created_at', 'updated_at']).optional(),
        includeTypes: z.array(NoteTypeEnum).optional(),
        maxPerType: z.number().optional(),
        statusFilter: z.array(NoteStatusEnum).optional(),
        forPlayer: z.boolean().optional()
    })
};

export async function handleNarrativeManage(args: unknown, _ctx: SessionContext): Promise<McpResponse> {
    return router(args as Record<string, unknown>);
}

// ═══════════════════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

interface NarrativeNoteRow {
    id: string;
    world_id: string;
    type: string;
    content: string;
    metadata: string;
    visibility: string;
    tags: string;
    entity_id: string | null;
    entity_type: string | null;
    status: string;
    created_at: string;
    updated_at: string;
}
