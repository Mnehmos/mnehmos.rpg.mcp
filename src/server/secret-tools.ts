import { z } from 'zod';
import { randomUUID } from 'crypto';
import { SecretRepository } from '../storage/repos/secret.repo.js';
import { RevealConditionSchema, GameEventSchema } from '../schema/secret.js';
import { getDb } from '../storage/index.js';
import { SessionContext } from './types.js';

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

export const SecretTools = {
    CREATE_SECRET: {
        name: 'create_secret',
        description: `Create a new secret that the AI DM knows but should not reveal to players.
        
Examples:
- NPC secret: "The innkeeper is actually a vampire"
- Location secret: "There's a trap at the entrance"
- Item secret: "The sword is cursed"
- Plot secret: "The king is the true villain"

The AI will use this secret to inform narration without revealing it directly.`,
        inputSchema: z.object({
            worldId: z.string().describe('The world this secret belongs to'),
            type: z.enum(['npc', 'location', 'item', 'quest', 'plot', 'mechanic', 'custom'])
                .describe('Category of entity this secret relates to'),
            category: z.string().describe('Subcategory like "motivation", "trap", "puzzle", "weakness"'),
            name: z.string().describe('Short name for the secret, e.g. "Innkeeper\'s True Identity"'),
            publicDescription: z.string().describe('What the player knows publicly'),
            secretDescription: z.string().describe('The hidden truth only the DM knows'),
            linkedEntityId: z.string().optional().describe('ID of related NPC, item, location, etc.'),
            linkedEntityType: z.string().optional().describe('Type of linked entity'),
            sensitivity: z.enum(['low', 'medium', 'high', 'critical']).default('medium')
                .describe('How important it is to keep this hidden'),
            leakPatterns: z.array(z.string()).default([])
                .describe('Keywords the AI should avoid saying, e.g. ["vampire", "undead"]'),
            revealConditions: z.array(RevealConditionSchema).default([])
                .describe('Conditions under which this secret can be revealed'),
            notes: z.string().optional().describe('DM notes about this secret')
        })
    },

    GET_SECRET: {
        name: 'get_secret',
        description: 'Get a single secret by ID (DM view only).',
        inputSchema: z.object({
            secretId: z.string()
        })
    },

    LIST_SECRETS: {
        name: 'list_secrets',
        description: 'List all secrets for a world. DM view - shows hidden information.',
        inputSchema: z.object({
            worldId: z.string(),
            includeRevealed: z.boolean().default(false).describe('Include already revealed secrets'),
            type: z.string().optional().describe('Filter by type'),
            linkedEntityId: z.string().optional().describe('Get secrets for a specific entity')
        })
    },

    UPDATE_SECRET: {
        name: 'update_secret',
        description: 'Update a secret\'s properties.',
        inputSchema: z.object({
            secretId: z.string(),
            publicDescription: z.string().optional(),
            secretDescription: z.string().optional(),
            sensitivity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
            leakPatterns: z.array(z.string()).optional(),
            revealConditions: z.array(RevealConditionSchema).optional(),
            notes: z.string().optional()
        })
    },

    DELETE_SECRET: {
        name: 'delete_secret',
        description: 'Delete a secret from the world.',
        inputSchema: z.object({
            secretId: z.string()
        })
    },

    REVEAL_SECRET: {
        name: 'reveal_secret',
        description: `Reveal a secret to the player. Call this when reveal conditions are met.

IMPORTANT: When presenting the reveal to the player, you MUST include the 'spoilerMarkdown' field 
from the response in your message. This creates a clickable spoiler that the player can choose to reveal.

Example response format:
"The moment of truth arrives..."

:::spoiler[🔮 Secret Name - Click to Reveal]
The dramatic revelation text goes here...
:::

The spoiler syntax (:::spoiler[Title]...:::) renders as a clickable reveal in the chat.`,
        inputSchema: z.object({
            secretId: z.string(),
            triggeredBy: z.string().describe('What triggered the reveal, e.g. "Insight check DC 15"'),
            partial: z.boolean().default(false).describe('If true, only hint at the secret')
        })
    },

    CHECK_REVEAL_CONDITIONS: {
        name: 'check_reveal_conditions',
        description: 'Check if any secrets should be revealed based on a game event.',
        inputSchema: z.object({
            worldId: z.string(),
            event: GameEventSchema
        })
    },

    GET_SECRETS_FOR_CONTEXT: {
        name: 'get_secrets_for_context',
        description: `Get all active (unrevealed) secrets formatted for LLM context injection.
        
Returns formatted text with DO NOT REVEAL instructions for the AI DM.`,
        inputSchema: z.object({
            worldId: z.string()
        })
    },

    CHECK_FOR_LEAKS: {
        name: 'check_for_leaks',
        description: 'Check if text contains potential secret leaks based on leak patterns.',
        inputSchema: z.object({
            worldId: z.string(),
            text: z.string().describe('The text to check for potential leaks')
        })
    }
} as const;

// ============= Tool Handlers =============

export async function handleCreateSecret(args: unknown, _ctx: SessionContext) {
    const { secretRepo } = ensureDb();
    const parsed = SecretTools.CREATE_SECRET.inputSchema.parse(args);

    const now = new Date().toISOString();
    const secret = {
        ...parsed,
        id: randomUUID(),
        revealed: false,
        createdAt: now,
        updatedAt: now
    };

    const created = secretRepo.create(secret);

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                message: `Created secret: "${created.name}"`,
                secret: created,
                warning: 'This information is hidden from players. Use leak patterns to prevent accidental disclosure.'
            }, null, 2)
        }]
    };
}

export async function handleGetSecret(args: unknown, _ctx: SessionContext) {
    const { secretRepo } = ensureDb();
    const parsed = SecretTools.GET_SECRET.inputSchema.parse(args);

    const secret = secretRepo.findById(parsed.secretId);
    if (!secret) {
        throw new Error(`Secret ${parsed.secretId} not found`);
    }

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify(secret, null, 2)
        }]
    };
}

export async function handleListSecrets(args: unknown, _ctx: SessionContext) {
    const { secretRepo } = ensureDb();
    const parsed = SecretTools.LIST_SECRETS.inputSchema.parse(args);

    const secrets = secretRepo.find({
        worldId: parsed.worldId,
        revealed: parsed.includeRevealed ? undefined : false,
        type: parsed.type,
        linkedEntityId: parsed.linkedEntityId
    });

    // Group by type for easier reading
    const grouped = new Map<string, typeof secrets>();
    for (const secret of secrets) {
        const existing = grouped.get(secret.type) || [];
        existing.push(secret);
        grouped.set(secret.type, existing);
    }

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                worldId: parsed.worldId,
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
            }, null, 2)
        }]
    };
}

export async function handleUpdateSecret(args: unknown, _ctx: SessionContext) {
    const { secretRepo } = ensureDb();
    const parsed = SecretTools.UPDATE_SECRET.inputSchema.parse(args);

    const { secretId, ...updates } = parsed;
    const updated = secretRepo.update(secretId, updates);

    if (!updated) {
        throw new Error(`Secret ${secretId} not found`);
    }

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                message: `Updated secret: "${updated.name}"`,
                secret: updated
            }, null, 2)
        }]
    };
}

export async function handleDeleteSecret(args: unknown, _ctx: SessionContext) {
    const { secretRepo } = ensureDb();
    const parsed = SecretTools.DELETE_SECRET.inputSchema.parse(args);

    const secret = secretRepo.findById(parsed.secretId);
    if (!secret) {
        throw new Error(`Secret ${parsed.secretId} not found`);
    }

    const deleted = secretRepo.delete(parsed.secretId);
    if (!deleted) {
        throw new Error('Failed to delete secret');
    }

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                message: `Deleted secret: "${secret.name}"`,
                id: secret.id
            }, null, 2)
        }]
    };
}

export async function handleRevealSecret(args: unknown, _ctx: SessionContext) {
    const { secretRepo } = ensureDb();
    const parsed = SecretTools.REVEAL_SECRET.inputSchema.parse(args);

    const secret = secretRepo.findById(parsed.secretId);
    if (!secret) {
        throw new Error(`Secret ${parsed.secretId} not found`);
    }

    if (secret.revealed) {
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    message: `Secret "${secret.name}" was already revealed`,
                    revealedAt: secret.revealedAt,
                    revealedBy: secret.revealedBy
                }, null, 2)
            }]
        };
    }

    // Generate reveal narration based on type
    let narration = '';
    let spoilerMarkdown = '';
    
    if (parsed.partial) {
        // Find partial reveal text from conditions
        const partialCondition = secret.revealConditions.find(
            (c: { partialReveal?: boolean; partialText?: string }) => c.partialReveal && c.partialText
        );
        narration = partialCondition?.partialText || 
            `Something seems off about ${secret.publicDescription.toLowerCase()}...`;
        
        // Partial reveals use a subtle hint format
        spoilerMarkdown = `\n\n> 💭 *${narration}*\n`;
    } else {
        // Full dramatic reveal with spoiler wrapper
        narration = generateRevealNarration(secret);
        
        // Format as clickable spoiler using custom syntax: :::spoiler[title]\ncontent\n:::
        spoilerMarkdown = `\n\n:::spoiler[🔮 ${secret.name} - Click to Reveal]\n${narration}\n:::\n`;
        
        // Actually mark as revealed in database
        secretRepo.reveal(parsed.secretId, parsed.triggeredBy);
    }

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                message: parsed.partial ? 'Hint revealed' : `Secret revealed: "${secret.name}"`,
                partial: parsed.partial,
                triggeredBy: parsed.triggeredBy,
                narration,
                spoilerMarkdown,
                instruction: 'Include the spoilerMarkdown in your response to the player. It will render as a clickable reveal.',
                secret: {
                    id: secret.id,
                    name: secret.name,
                    type: secret.type,
                    publicDescription: secret.publicDescription,
                    secretDescription: secret.secretDescription,
                    revealed: !parsed.partial
                }
            }, null, 2)
        }]
    };
}

export async function handleCheckRevealConditions(args: unknown, _ctx: SessionContext) {
    const { secretRepo } = ensureDb();
    const parsed = SecretTools.CHECK_REVEAL_CONDITIONS.inputSchema.parse(args);

    const secretsToReveal = secretRepo.checkRevealConditions(parsed.worldId, parsed.event);

    if (secretsToReveal.length === 0) {
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    message: 'No secrets triggered by this event',
                    event: parsed.event
                }, null, 2)
            }]
        };
    }

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                message: `${secretsToReveal.length} secret(s) can be revealed`,
                event: parsed.event,
                secretsToReveal: secretsToReveal.map(s => ({
                    id: s.id,
                    name: s.name,
                    type: s.type,
                    secretDescription: s.secretDescription,
                    matchedConditions: s.revealConditions.filter((c: { type: string; skill?: string; dc?: number }) => {
                        // Check which conditions matched
                        if (c.type !== parsed.event.type) return false;
                        if (c.type === 'skill_check') {
                            return parsed.event.skill === c.skill && 
                                   (parsed.event.result || 0) >= (c.dc || 0);
                        }
                        return true;
                    })
                })),
                instruction: 'Call reveal_secret for each secret you want to reveal'
            }, null, 2)
        }]
    };
}

export async function handleGetSecretsForContext(args: unknown, _ctx: SessionContext) {
    const { secretRepo } = ensureDb();
    const parsed = SecretTools.GET_SECRETS_FOR_CONTEXT.inputSchema.parse(args);

    const formattedContext = secretRepo.formatForLLM(parsed.worldId);
    const secrets = secretRepo.getActiveSecrets(parsed.worldId);

    if (secrets.length === 0) {
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    message: 'No active secrets for this world',
                    worldId: parsed.worldId,
                    context: ''
                }, null, 2)
            }]
        };
    }

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                worldId: parsed.worldId,
                secretCount: secrets.length,
                context: formattedContext,
                instruction: 'Inject this context into the LLM system prompt. The AI must follow DO NOT REVEAL instructions.'
            }, null, 2)
        }]
    };
}

export async function handleCheckForLeaks(args: unknown, _ctx: SessionContext) {
    const { secretRepo } = ensureDb();
    const parsed = SecretTools.CHECK_FOR_LEAKS.inputSchema.parse(args);

    const leaks = secretRepo.checkForLeaks(parsed.text, parsed.worldId);

    if (leaks.length === 0) {
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    message: 'No potential leaks detected',
                    clean: true
                }, null, 2)
            }]
        };
    }

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                message: `⚠️ Potential leaks detected: ${leaks.length}`,
                clean: false,
                leaks: leaks.map(l => ({
                    secretName: l.secretName,
                    pattern: l.pattern,
                    context: l.context,
                    severity: 'Check if this is actually revealing the secret'
                })),
                recommendation: 'Review the text and rephrase to avoid these patterns'
            }, null, 2)
        }]
    };
}

// ============= Helper Functions =============

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
        'item-power': `The true nature of the artifact reveals itself: ${secret.secretDescription}`,
        'plot-twist': `Everything you thought you knew shatters as the truth emerges: ${secret.secretDescription}`,
        'mechanic-weakness': `You've discovered a crucial weakness: ${secret.secretDescription}`,
    };

    const key = `${secret.type}-${secret.category}`;
    return templates[key] || 
           `The hidden truth about ${secret.name} is revealed: ${secret.secretDescription}`;
}
