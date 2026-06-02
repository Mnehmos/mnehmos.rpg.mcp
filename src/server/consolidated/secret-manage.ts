/**
 * Consolidated Secret Management Tool
 *
 * Replaces 9 individual secret tools with a single action-based tool:
 * - create_secret -> action: 'create'
 * - get_secret -> action: 'get'
 * - list_secrets -> action: 'list'
 * - update_secret -> action: 'update'
 * - delete_secret -> action: 'delete'
 * - reveal_secret -> action: 'reveal'
 * - check_reveal_conditions -> action: 'check_conditions'
 * - get_secrets_for_context -> action: 'get_context'
 * - check_for_leaks -> action: 'check_leaks'
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';
import { SecretRepository } from '../../storage/repos/secret.repo.js';
import { RevealConditionSchema, GameEventSchema } from '../../schema/secret.js';
import { getDb } from '../../storage/index.js';
import { SessionContext } from '../types.js';
import { createActionRouter, ActionDefinition, McpResponse } from '../../utils/action-router.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const ACTIONS = [
    'create',
    'get',
    'list',
    'update',
    'delete',
    'reveal',
    'check_conditions',
    'get_context',
    'check_leaks'
] as const;

type SecretAction = typeof ACTIONS[number];

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE HELPER
// ═══════════════════════════════════════════════════════════════════════════

function ensureDb() {
    const dbPath = process.env.NODE_ENV === 'test'
        ? ':memory:'
        : process.env.RPG_DATA_DIR
            ? `${process.env.RPG_DATA_DIR}/rpg.db`
            : 'rpg.db';
    const db = getDb(dbPath);
    const secretRepo = new SecretRepository(db);
    return { secretRepo };
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

const CreateSchema = z.object({
    action: z.literal('create'),
    worldId: z.string().describe('The world this secret belongs to'),
    type: z.enum(['npc', 'location', 'item', 'quest', 'plot', 'mechanic', 'custom'])
        .describe('Category of entity this secret relates to'),
    category: z.string().describe('Subcategory like "motivation", "trap", "puzzle", "weakness"'),
    name: z.string().describe('Short name for the secret'),
    publicDescription: z.string().describe('What the player knows publicly'),
    secretDescription: z.string().describe('The hidden truth only the DM knows'),
    linkedEntityId: z.string().optional().describe('ID of related NPC, item, location'),
    linkedEntityType: z.string().optional().describe('Type of linked entity'),
    sensitivity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
    leakPatterns: z.array(z.string()).default([]).describe('Keywords to avoid'),
    revealConditions: z.array(RevealConditionSchema).default([]),
    notes: z.string().optional().describe('DM notes')
});

const GetSchema = z.object({
    action: z.literal('get'),
    secretId: z.string().describe('Secret UUID or name')
});

const ListSchema = z.object({
    action: z.literal('list'),
    worldId: z.string(),
    includeRevealed: z.boolean().default(false),
    type: z.string().optional(),
    linkedEntityId: z.string().optional()
});

const UpdateSchema = z.object({
    action: z.literal('update'),
    secretId: z.string(),
    publicDescription: z.string().optional(),
    secretDescription: z.string().optional(),
    sensitivity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    leakPatterns: z.array(z.string()).optional(),
    revealConditions: z.array(RevealConditionSchema).optional(),
    notes: z.string().optional()
});

const DeleteSchema = z.object({
    action: z.literal('delete'),
    secretId: z.string()
});

const RevealSchema = z.object({
    action: z.literal('reveal'),
    secretId: z.string(),
    triggeredBy: z.string().describe('What triggered the reveal'),
    partial: z.boolean().default(false)
});

const CheckConditionsSchema = z.object({
    action: z.literal('check_conditions'),
    worldId: z.string(),
    event: GameEventSchema
});

const GetContextSchema = z.object({
    action: z.literal('get_context'),
    worldId: z.string()
});

const CheckLeaksSchema = z.object({
    action: z.literal('check_leaks'),
    worldId: z.string(),
    text: z.string().describe('Text to check for potential leaks')
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTION HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

async function handleCreate(args: z.infer<typeof CreateSchema>): Promise<object> {
    const { secretRepo } = ensureDb();
    const { action, ...data } = args;

    const now = new Date().toISOString();
    const secret = {
        ...data,
        id: randomUUID(),
        revealed: false,
        createdAt: now,
        updatedAt: now
    };

    const created = secretRepo.create(secret);

    return {
        message: `Created secret: "${created.name}"`,
        secret: created,
        warning: 'This information is hidden from players.'
    };
}

async function handleGet(args: z.infer<typeof GetSchema>): Promise<object> {
    const { secretRepo } = ensureDb();

    const secret = secretRepo.findById(args.secretId);
    if (!secret) {
        throw new Error(`Secret ${args.secretId} not found`);
    }

    return secret;
}

async function handleList(args: z.infer<typeof ListSchema>): Promise<object> {
    const { secretRepo } = ensureDb();
    const { action, ...filters } = args;

    const secrets = secretRepo.find({
        worldId: filters.worldId,
        revealed: filters.includeRevealed ? undefined : false,
        type: filters.type,
        linkedEntityId: filters.linkedEntityId
    });

    const grouped = new Map<string, typeof secrets>();
    for (const secret of secrets) {
        const existing = grouped.get(secret.type) || [];
        existing.push(secret);
        grouped.set(secret.type, existing);
    }

    return {
        worldId: filters.worldId,
        count: secrets.length,
        secretsByType: Object.fromEntries(grouped),
        secrets: secrets.map(s => ({
            id: s.id,
            name: s.name,
            type: s.type,
            category: s.category,
            sensitivity: s.sensitivity,
            revealed: s.revealed,
            linkedTo: s.linkedEntityId ? `${s.linkedEntityType}:${s.linkedEntityId}` : null
        }))
    };
}

async function handleUpdate(args: z.infer<typeof UpdateSchema>): Promise<object> {
    const { secretRepo } = ensureDb();
    const { action, secretId, ...updates } = args;

    const updated = secretRepo.update(secretId, updates);
    if (!updated) {
        throw new Error(`Secret ${secretId} not found`);
    }

    return {
        message: `Updated secret: "${updated.name}"`,
        secret: updated
    };
}

async function handleDelete(args: z.infer<typeof DeleteSchema>): Promise<object> {
    const { secretRepo } = ensureDb();

    const secret = secretRepo.findById(args.secretId);
    if (!secret) {
        throw new Error(`Secret ${args.secretId} not found`);
    }

    const deleted = secretRepo.delete(args.secretId);
    if (!deleted) {
        throw new Error('Failed to delete secret');
    }

    return {
        message: `Deleted secret: "${secret.name}"`,
        id: secret.id
    };
}

async function handleReveal(args: z.infer<typeof RevealSchema>): Promise<object> {
    const { secretRepo } = ensureDb();

    const secret = secretRepo.findById(args.secretId);
    if (!secret) {
        throw new Error(`Secret ${args.secretId} not found`);
    }

    if (secret.revealed) {
        return {
            message: `Secret "${secret.name}" was already revealed`,
            revealedAt: secret.revealedAt,
            revealedBy: secret.revealedBy
        };
    }

    let narration = '';
    let spoilerMarkdown = '';

    if (args.partial) {
        const partialCondition = secret.revealConditions.find(
            (c: { partialReveal?: boolean; partialText?: string }) => c.partialReveal && c.partialText
        );
        narration = partialCondition?.partialText ||
            `Something seems off about ${secret.publicDescription.toLowerCase()}...`;
        spoilerMarkdown = `\n\n> *${narration}*\n`;
    } else {
        narration = generateRevealNarration(secret);
        spoilerMarkdown = `\n\n:::spoiler[${secret.name} - Click to Reveal]\n${narration}\n:::\n`;
        secretRepo.reveal(args.secretId, args.triggeredBy);
    }

    return {
        message: args.partial ? 'Hint revealed' : `Secret revealed: "${secret.name}"`,
        partial: args.partial,
        triggeredBy: args.triggeredBy,
        narration,
        spoilerMarkdown,
        instruction: 'Include spoilerMarkdown in response for clickable reveal.',
        secret: {
            id: secret.id,
            name: secret.name,
            type: secret.type,
            publicDescription: secret.publicDescription,
            secretDescription: secret.secretDescription,
            revealed: !args.partial
        }
    };
}

async function handleCheckConditions(args: z.infer<typeof CheckConditionsSchema>): Promise<object> {
    const { secretRepo } = ensureDb();

    const secretsToReveal = secretRepo.checkRevealConditions(args.worldId, args.event);

    if (secretsToReveal.length === 0) {
        return {
            message: 'No secrets triggered by this event',
            event: args.event
        };
    }

    return {
        message: `${secretsToReveal.length} secret(s) can be revealed`,
        event: args.event,
        secretsToReveal: secretsToReveal.map(s => ({
            id: s.id,
            name: s.name,
            type: s.type,
            secretDescription: s.secretDescription,
            matchedConditions: s.revealConditions.filter((c: { type: string; skill?: string; dc?: number }) => {
                if (c.type !== args.event.type) return false;
                if (c.type === 'skill_check') {
                    return args.event.skill === c.skill &&
                           (args.event.result || 0) >= (c.dc || 0);
                }
                return true;
            })
        })),
        instruction: 'Call secret_manage with action: "reveal" for each secret to reveal'
    };
}

async function handleGetContext(args: z.infer<typeof GetContextSchema>): Promise<object> {
    const { secretRepo } = ensureDb();

    const formattedContext = secretRepo.formatForLLM(args.worldId);
    const secrets = secretRepo.getActiveSecrets(args.worldId);

    if (secrets.length === 0) {
        return {
            message: 'No active secrets for this world',
            worldId: args.worldId,
            context: ''
        };
    }

    return {
        worldId: args.worldId,
        secretCount: secrets.length,
        context: formattedContext,
        instruction: 'Inject this context into the LLM system prompt.'
    };
}

async function handleCheckLeaks(args: z.infer<typeof CheckLeaksSchema>): Promise<object> {
    const { secretRepo } = ensureDb();

    const leaks = secretRepo.checkForLeaks(args.text, args.worldId);

    if (leaks.length === 0) {
        return {
            message: 'No potential leaks detected',
            clean: true
        };
    }

    return {
        message: `Potential leaks detected: ${leaks.length}`,
        clean: false,
        leaks: leaks.map(l => ({
            secretName: l.secretName,
            pattern: l.pattern,
            context: l.context,
            severity: 'Review and rephrase'
        })),
        recommendation: 'Rephrase text to avoid these patterns'
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function generateRevealNarration(secret: {
    type: string;
    category: string;
    secretDescription: string;
    name: string;
}): string {
    const templates: Record<string, string> = {
        'npc-motivation': `The truth becomes horrifyingly clear: ${secret.secretDescription}`,
        'npc-identity': `A shocking revelation - ${secret.secretDescription}`,
        'location-trap': `With a click and a rumble, you realize: ${secret.secretDescription}`,
        'location-hidden': `Your eyes adjust, and you discover: ${secret.secretDescription}`,
        'item-curse': `A dark aura pulses as you realize: ${secret.secretDescription}`,
        'item-power': `The true nature reveals itself: ${secret.secretDescription}`,
        'plot-twist': `Everything you thought you knew shatters: ${secret.secretDescription}`,
        'mechanic-weakness': `You've discovered a crucial weakness: ${secret.secretDescription}`,
    };

    const key = `${secret.type}-${secret.category}`;
    return templates[key] ||
           `The hidden truth about ${secret.name} is revealed: ${secret.secretDescription}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION ROUTER
// ═══════════════════════════════════════════════════════════════════════════

const definitions: Record<SecretAction, ActionDefinition> = {
    create: {
        schema: CreateSchema,
        handler: handleCreate,
        aliases: ['new', 'add'],
        description: 'Create a DM-only secret'
    },
    get: {
        schema: GetSchema,
        handler: handleGet,
        aliases: ['fetch', 'read'],
        description: 'Get a secret by ID'
    },
    list: {
        schema: ListSchema,
        handler: handleList,
        aliases: ['all', 'query'],
        description: 'List secrets for a world'
    },
    update: {
        schema: UpdateSchema,
        handler: handleUpdate,
        aliases: ['modify', 'edit'],
        description: 'Update secret properties'
    },
    delete: {
        schema: DeleteSchema,
        handler: handleDelete,
        aliases: ['remove'],
        description: 'Delete a secret'
    },
    reveal: {
        schema: RevealSchema,
        handler: handleReveal,
        aliases: ['disclose', 'show'],
        description: 'Reveal a secret to players'
    },
    check_conditions: {
        schema: CheckConditionsSchema,
        handler: handleCheckConditions,
        aliases: ['check'],
        description: 'Check if event triggers reveals'
    },
    get_context: {
        schema: GetContextSchema,
        handler: handleGetContext,
        aliases: ['context'],
        description: 'Get secrets for LLM context'
    },
    check_leaks: {
        schema: CheckLeaksSchema,
        handler: handleCheckLeaks,
        aliases: ['leaks'],
        description: 'Check text for secret leaks'
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

export const SecretManageTool = {
    name: 'secret_manage',
    description: `Manage DM secrets - hidden information players shouldn't see.

🔒 SECRET WORKFLOW:
1. create - Define secret with publicDescription + secretDescription
2. check_conditions - When game events occur, check if secrets should reveal
3. reveal - Disclose secret to players (full or partial)
4. check_leaks - Scan LLM output for accidental spoilers

🎭 SECRET TYPES:
- npc: Motivations, true identities
- location: Traps, hidden rooms
- item: Curses, true powers
- plot: Twists, revelations
- mechanic: Enemy weaknesses

🛡️ SENSITIVITY LEVELS:
low → medium → high → critical

⚠️ IMPORTANT: Never include secretDescription in player-visible output!
Use get_context to inject secrets into system prompt for DM-aware responses.

Actions: ${ACTIONS.join(', ')}
Aliases: new→create, reveal→disclose, check→check_conditions`,
    actionSchemas: router.actionSchemas,
    inputSchema: z.object({
        action: z.string().describe(`Action: ${ACTIONS.join(', ')}`),
        // All optional - validated per action
        worldId: z.string().optional(),
        secretId: z.string().optional(),
        type: z.enum(['npc', 'location', 'item', 'quest', 'plot', 'mechanic', 'custom']).optional(),
        category: z.string().optional(),
        name: z.string().optional(),
        publicDescription: z.string().optional(),
        secretDescription: z.string().optional(),
        linkedEntityId: z.string().optional(),
        linkedEntityType: z.string().optional(),
        sensitivity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
        leakPatterns: z.array(z.string()).optional(),
        revealConditions: z.array(RevealConditionSchema).optional(),
        notes: z.string().optional(),
        includeRevealed: z.boolean().optional(),
        triggeredBy: z.string().optional(),
        partial: z.boolean().optional(),
        event: GameEventSchema.optional(),
        text: z.string().optional()
    })
};

export async function handleSecretManage(args: unknown, _ctx: SessionContext): Promise<McpResponse> {
    return router(args as Record<string, unknown>);
}
