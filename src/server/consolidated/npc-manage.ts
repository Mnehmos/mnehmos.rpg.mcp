/**
 * Consolidated NPC Management Tool
 * Replaces 7 separate tools for NPC relationship and memory tracking:
 * get_npc_relationship, update_npc_relationship, record_conversation_memory,
 * get_conversation_history, get_recent_interactions, get_npc_context, interact_socially
 */

import { z } from 'zod';
import { createActionRouter, ActionDefinition, McpResponse } from '../../utils/action-router.js';
import { SessionContext } from '../types.js';
import { RichFormatter } from '../utils/formatter.js';
import { getDb } from '../../storage/index.js';
import { NpcMemoryRepository, Familiarity, Disposition, Importance } from '../../storage/repos/npc-memory.repo.js';
import { CharacterRepository } from '../../storage/repos/character.repo.js';
import { SpatialRepository } from '../../storage/repos/spatial.repo.js';
import { calculateHearingRadius, VolumeLevel } from '../../engine/social/hearing.js';
import { rollStealthVsPerception, isDeafened, getEnvironmentModifier } from '../../engine/social/stealth-perception.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const ACTIONS = ['get_relationship', 'update_relationship', 'record_memory', 'get_history', 'get_recent', 'get_context', 'interact'] as const;
type NpcManageAction = typeof ACTIONS[number];

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE HELPER
// ═══════════════════════════════════════════════════════════════════════════

function getRepo(): NpcMemoryRepository {
    const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
    return new NpcMemoryRepository(db);
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

const GetRelationshipSchema = z.object({
    action: z.literal('get_relationship'),
    characterId: z.string().describe('ID of the player character'),
    npcId: z.string().describe('ID of the NPC')
});

const UpdateRelationshipSchema = z.object({
    action: z.literal('update_relationship'),
    characterId: z.string().describe('ID of the player character'),
    npcId: z.string().describe('ID of the NPC'),
    familiarity: z.enum(['stranger', 'acquaintance', 'friend', 'close_friend', 'rival', 'enemy'])
        .describe('Level of familiarity'),
    disposition: z.enum(['hostile', 'unfriendly', 'neutral', 'friendly', 'helpful'])
        .describe('NPC attitude toward the character'),
    notes: z.string().optional().describe('Additional notes about the relationship')
});

const RecordMemorySchema = z.object({
    action: z.literal('record_memory'),
    characterId: z.string().describe('ID of the player character'),
    npcId: z.string().describe('ID of the NPC'),
    summary: z.string().describe('Summary of the conversation/interaction'),
    importance: z.enum(['low', 'medium', 'high', 'critical']).default('medium')
        .describe('How important this memory is'),
    topics: z.array(z.string()).default([])
        .describe('Keywords/topics for searching')
});

const GetHistorySchema = z.object({
    action: z.literal('get_history'),
    characterId: z.string().describe('ID of the player character'),
    npcId: z.string().describe('ID of the NPC'),
    minImportance: z.enum(['low', 'medium', 'high', 'critical']).optional()
        .describe('Minimum importance to include'),
    limit: z.number().int().positive().optional()
        .describe('Maximum number of memories to return')
});

const GetRecentSchema = z.object({
    action: z.literal('get_recent'),
    characterId: z.string().describe('ID of the player character'),
    limit: z.number().int().positive().default(10)
        .describe('Maximum number of memories to return')
});

const GetContextSchema = z.object({
    action: z.literal('get_context'),
    characterId: z.string().describe('ID of the player character'),
    npcId: z.string().describe('ID of the NPC'),
    memoryLimit: z.number().int().positive().default(5)
        .describe('Maximum number of memories to include')
});

const InteractSchema = z.object({
    action: z.literal('interact'),
    speakerId: z.string().describe('ID of the character speaking'),
    targetId: z.string().optional().describe('ID of the intended recipient'),
    content: z.string().min(1).describe('What is being said'),
    volume: z.enum(['WHISPER', 'TALK', 'SHOUT']).describe('Volume level of speech'),
    intent: z.string().optional().describe('Social intent: gossip, interrogate, negotiate, threaten, etc.')
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTION HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

async function handleGetRelationship(args: z.infer<typeof GetRelationshipSchema>): Promise<object> {
    const repo = getRepo();
    const relationship = repo.getRelationship(args.characterId, args.npcId);

    if (!relationship) {
        return {
            success: true,
            actionType: 'get_relationship',
            characterId: args.characterId,
            npcId: args.npcId,
            familiarity: 'stranger',
            disposition: 'neutral',
            notes: null,
            firstMetAt: null,
            lastInteractionAt: null,
            interactionCount: 0,
            isNew: true
        };
    }

    return {
        success: true,
        actionType: 'get_relationship',
        ...relationship,
        isNew: false
    };
}

async function handleUpdateRelationship(args: z.infer<typeof UpdateRelationshipSchema>): Promise<object> {
    const repo = getRepo();

    const relationship = repo.upsertRelationship({
        characterId: args.characterId,
        npcId: args.npcId,
        familiarity: args.familiarity as Familiarity,
        disposition: args.disposition as Disposition,
        notes: args.notes ?? null
    });

    return {
        success: true,
        actionType: 'update_relationship',
        relationship
    };
}

async function handleRecordMemory(args: z.infer<typeof RecordMemorySchema>): Promise<object> {
    const repo = getRepo();

    const memory = repo.recordMemory({
        characterId: args.characterId,
        npcId: args.npcId,
        summary: args.summary,
        importance: args.importance as Importance,
        topics: args.topics
    });

    return {
        success: true,
        actionType: 'record_memory',
        memory
    };
}

async function handleGetHistory(args: z.infer<typeof GetHistorySchema>): Promise<object> {
    const repo = getRepo();

    const memories = repo.getConversationHistory(
        args.characterId,
        args.npcId,
        {
            minImportance: args.minImportance as Importance | undefined,
            limit: args.limit
        }
    );

    return {
        success: true,
        actionType: 'get_history',
        characterId: args.characterId,
        npcId: args.npcId,
        count: memories.length,
        memories
    };
}

async function handleGetRecent(args: z.infer<typeof GetRecentSchema>): Promise<object> {
    const repo = getRepo();
    const memories = repo.getRecentInteractions(args.characterId, args.limit);

    return {
        success: true,
        actionType: 'get_recent',
        characterId: args.characterId,
        count: memories.length,
        memories
    };
}

async function handleGetContext(args: z.infer<typeof GetContextSchema>): Promise<object> {
    const repo = getRepo();

    const relationship = repo.getRelationship(args.characterId, args.npcId);
    const memories = repo.getConversationHistory(
        args.characterId,
        args.npcId,
        { limit: args.memoryLimit }
    );

    const defaultRelationship = {
        characterId: args.characterId,
        npcId: args.npcId,
        familiarity: 'stranger',
        disposition: 'neutral',
        notes: null,
        firstMetAt: null,
        lastInteractionAt: null,
        interactionCount: 0
    };

    return {
        success: true,
        actionType: 'get_context',
        relationship: relationship ?? defaultRelationship,
        recentMemories: memories,
        contextSummary: buildContextSummary(relationship, memories)
    };
}

async function handleInteract(args: z.infer<typeof InteractSchema>): Promise<object> {
    const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
    const charRepo = new CharacterRepository(db);
    const spatialRepo = new SpatialRepository(db);
    const memoryRepo = new NpcMemoryRepository(db);

    // Validate speaker exists
    const speaker = charRepo.findById(args.speakerId);
    if (!speaker) {
        return { error: true, message: `Speaker with ID ${args.speakerId} not found` };
    }

    // Check speaker is in a room
    if (!speaker.currentRoomId) {
        return { error: true, message: `Speaker ${speaker.name} is not in any room` };
    }

    const room = spatialRepo.findById(speaker.currentRoomId);
    if (!room) {
        return { error: true, message: `Room ${speaker.currentRoomId} not found` };
    }

    // Validate target if specified
    let target = null;
    if (args.targetId) {
        target = charRepo.findById(args.targetId);
        if (!target) {
            return { error: true, message: `Target with ID ${args.targetId} not found` };
        }
    }

    // Calculate hearing radius
    const hearingRadius = calculateHearingRadius({
        volume: args.volume as VolumeLevel,
        biomeContext: room.biomeContext,
        atmospherics: room.atmospherics
    });

    // Get environment modifier
    const envModifier = getEnvironmentModifier(room.atmospherics);

    // Find potential listeners
    const potentialListeners = room.entityIds
        .filter(id => id !== args.speakerId)
        .map(id => charRepo.findById(id))
        .filter((char): char is NonNullable<typeof char> => char !== null);

    // Track hearing results
    const hearingResults: Array<{
        listenerId: string;
        listenerName: string;
        heardFully: boolean;
        opposedRoll?: {
            speakerRoll: number;
            speakerTotal: number;
            listenerRoll: number;
            listenerTotal: number;
            success: boolean;
            margin: number;
        };
    }> = [];

    // Target always hears full content
    if (target && target.currentRoomId === room.id) {
        hearingResults.push({
            listenerId: target.id,
            listenerName: target.name,
            heardFully: true
        });

        memoryRepo.recordMemory({
            characterId: target.id,
            npcId: speaker.id,
            summary: `${speaker.name} said (${args.volume.toLowerCase()}): "${args.content}"${args.intent ? ` [Intent: ${args.intent}]` : ''}`,
            importance: args.volume === 'SHOUT' ? 'high' : 'medium',
            topics: args.intent ? [args.intent] : []
        });
    }

    // For eavesdroppers, roll Stealth vs Perception
    const eavesdroppers = potentialListeners.filter(listener =>
        listener.id !== args.targetId && !isDeafened(listener)
    );

    for (const listener of eavesdroppers) {
        const roll = rollStealthVsPerception(speaker, listener, envModifier);

        hearingResults.push({
            listenerId: listener.id,
            listenerName: listener.name,
            heardFully: false,
            opposedRoll: {
                speakerRoll: roll.speakerRoll,
                speakerTotal: roll.speakerTotal,
                listenerRoll: roll.listenerRoll,
                listenerTotal: roll.listenerTotal,
                success: roll.success,
                margin: roll.margin
            }
        });

        if (roll.success) {
            memoryRepo.recordMemory({
                characterId: listener.id,
                npcId: speaker.id,
                summary: `Overheard ${speaker.name} ${args.volume === 'WHISPER' ? 'whispering' : args.volume === 'SHOUT' ? 'shouting' : 'talking'}${target ? ` to ${target.name}` : ''} about something${args.intent ? ` (${args.intent})` : ''}`,
                importance: args.volume === 'SHOUT' ? 'medium' : 'low',
                topics: args.intent ? [args.intent, 'eavesdropped'] : ['eavesdropped']
            });
        }
    }

    return {
        success: true,
        actionType: 'interact',
        speaker: { id: speaker.id, name: speaker.name },
        target: target ? { id: target.id, name: target.name, heard: true } : null,
        volume: args.volume,
        hearingRadius,
        room: {
            id: room.id,
            name: room.name,
            biome: room.biomeContext,
            atmospherics: room.atmospherics
        },
        listeners: hearingResults,
        totalListeners: hearingResults.length,
        whoHeard: hearingResults.filter(r => r.heardFully || r.opposedRoll?.success).length,
        whoMissed: hearingResults.filter(r => !r.heardFully && !r.opposedRoll?.success).length
    };
}

/**
 * Build a human-readable context summary for LLM injection
 */
function buildContextSummary(
    relationship: { familiarity: string; disposition: string; notes: string | null; interactionCount: number } | null,
    memories: Array<{ summary: string; importance: string; topics: string[] }>
): string {
    const lines: string[] = [];

    if (relationship) {
        lines.push(`RELATIONSHIP: ${relationship.familiarity} (${relationship.disposition})`);
        lines.push(`Previous interactions: ${relationship.interactionCount}`);
        if (relationship.notes) {
            lines.push(`Notes: ${relationship.notes}`);
        }
    } else {
        lines.push(`RELATIONSHIP: First meeting (stranger, neutral)`);
    }

    if (memories.length > 0) {
        lines.push('');
        lines.push('PREVIOUS CONVERSATIONS:');
        for (const memory of memories) {
            const importance = memory.importance === 'critical' ? '!!!' :
                memory.importance === 'high' ? '!!' :
                    memory.importance === 'medium' ? '!' : '';
            lines.push(`${importance} ${memory.summary}`);
            if (memory.topics.length > 0) {
                lines.push(`  Topics: ${memory.topics.join(', ')}`);
            }
        }
    }

    return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION ROUTER
// ═══════════════════════════════════════════════════════════════════════════

const definitions: Record<NpcManageAction, ActionDefinition> = {
    get_relationship: {
        schema: GetRelationshipSchema,
        handler: handleGetRelationship,
        aliases: ['relationship', 'get_rel'],
        description: 'Get relationship status between PC and NPC'
    },
    update_relationship: {
        schema: UpdateRelationshipSchema,
        handler: handleUpdateRelationship,
        aliases: ['set_relationship', 'update_rel'],
        description: 'Update or create a PC-NPC relationship'
    },
    record_memory: {
        schema: RecordMemorySchema,
        handler: handleRecordMemory,
        aliases: ['remember', 'record', 'log_conversation'],
        description: 'Record a significant conversation/interaction'
    },
    get_history: {
        schema: GetHistorySchema,
        handler: handleGetHistory,
        aliases: ['history', 'conversations'],
        description: 'Get conversation history between PC and NPC'
    },
    get_recent: {
        schema: GetRecentSchema,
        handler: handleGetRecent,
        aliases: ['recent', 'recent_interactions'],
        description: 'Get recent conversation memories across all NPCs'
    },
    get_context: {
        schema: GetContextSchema,
        handler: handleGetContext,
        aliases: ['context', 'npc_context'],
        description: 'Get relationship + history for LLM dialogue prompts'
    },
    interact: {
        schema: InteractSchema,
        handler: handleInteract,
        aliases: ['speak', 'talk', 'social'],
        description: 'Social interaction with spatial awareness and hearing'
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

export const NpcManageTool = {
    name: 'npc_manage',
    description: `Manage NPC relationships, memories, and social interactions.
Actions: get_relationship, update_relationship, record_memory, get_history, get_recent, get_context, interact
Aliases: relationship→get_relationship, remember→record_memory, speak→interact

RELATIONSHIP LEVELS:
- Familiarity: stranger→acquaintance→friend→close_friend/rival/enemy
- Disposition: hostile→unfriendly→neutral→friendly→helpful

MEMORY IMPORTANCE:
- low: casual chat
- medium: standard interaction
- high: plot-relevant
- critical: game-changing

SOCIAL INTERACTION:
- interact action handles hearing range, stealth vs perception, memory recording
- Volume: WHISPER, TALK, SHOUT`,
    inputSchema: z.object({
        action: z.string().describe(`Action: ${ACTIONS.join(', ')}`),
        characterId: z.string().optional().describe('ID of the player character'),
        npcId: z.string().optional().describe('ID of the NPC'),
        speakerId: z.string().optional().describe('ID of speaker (for interact)'),
        targetId: z.string().optional().describe('ID of target (for interact)'),
        familiarity: z.enum(['stranger', 'acquaintance', 'friend', 'close_friend', 'rival', 'enemy']).optional(),
        disposition: z.enum(['hostile', 'unfriendly', 'neutral', 'friendly', 'helpful']).optional(),
        notes: z.string().optional(),
        summary: z.string().optional(),
        importance: z.enum(['low', 'medium', 'high', 'critical']).optional(),
        topics: z.array(z.string()).optional(),
        minImportance: z.enum(['low', 'medium', 'high', 'critical']).optional(),
        limit: z.number().optional(),
        memoryLimit: z.number().optional(),
        content: z.string().optional(),
        volume: z.enum(['WHISPER', 'TALK', 'SHOUT']).optional(),
        intent: z.string().optional()
    })
};

export async function handleNpcManage(args: unknown, _ctx: SessionContext): Promise<McpResponse> {
    const result = await router(args as Record<string, unknown>);
    const parsed = JSON.parse(result.content[0].text);

    let output = '';

    if (parsed.error) {
        output = RichFormatter.header('Error', '');
        output += RichFormatter.alert(parsed.message || 'Unknown error', 'error');
        if (parsed.suggestions) {
            output += '\n**Did you mean:**\n';
            parsed.suggestions.forEach((s: { action: string; similarity: number }) => {
                output += `  - ${s.action} (${s.similarity}% match)\n`;
            });
        }
    } else {
        switch (parsed.actionType) {
            case 'get_relationship':
                output = RichFormatter.header('NPC Relationship', '');
                output += RichFormatter.keyValue({
                    'Character': `\`${parsed.characterId}\``,
                    'NPC': `\`${parsed.npcId}\``,
                    'Familiarity': parsed.familiarity,
                    'Disposition': parsed.disposition,
                    'Interactions': parsed.interactionCount || 0
                });
                if (parsed.notes) output += `\n**Notes:** ${parsed.notes}`;
                break;

            case 'update_relationship':
                output = RichFormatter.header('Relationship Updated', '');
                if (parsed.relationship) {
                    output += RichFormatter.keyValue({
                        'Familiarity': parsed.relationship.familiarity,
                        'Disposition': parsed.relationship.disposition
                    });
                }
                break;

            case 'record_memory':
                output = RichFormatter.header('Memory Recorded', '');
                if (parsed.memory) {
                    output += RichFormatter.keyValue({
                        'Importance': parsed.memory.importance,
                        'Summary': parsed.memory.summary.substring(0, 50) + '...'
                    });
                }
                break;

            case 'get_history':
                output = RichFormatter.header(`Conversation History (${parsed.count})`, '');
                if (parsed.memories?.length > 0) {
                    parsed.memories.slice(0, 5).forEach((m: any) => {
                        const icon = m.importance === 'critical' ? '' : m.importance === 'high' ? '' : '';
                        output += `${icon} ${m.summary.substring(0, 60)}...\n`;
                    });
                    if (parsed.count > 5) output += `...and ${parsed.count - 5} more\n`;
                } else {
                    output += 'No conversation history.\n';
                }
                break;

            case 'get_recent':
                output = RichFormatter.header(`Recent Interactions (${parsed.count})`, '');
                if (parsed.memories?.length > 0) {
                    parsed.memories.slice(0, 5).forEach((m: any) => {
                        output += `- ${m.summary.substring(0, 50)}...\n`;
                    });
                }
                break;

            case 'get_context':
                output = RichFormatter.header('NPC Context', '');
                if (parsed.relationship) {
                    output += RichFormatter.keyValue({
                        'Familiarity': parsed.relationship.familiarity,
                        'Disposition': parsed.relationship.disposition
                    });
                }
                output += `\n**Memories:** ${parsed.recentMemories?.length || 0}\n`;
                break;

            case 'interact':
                output = RichFormatter.header('Social Interaction', '');
                output += RichFormatter.keyValue({
                    'Speaker': parsed.speaker?.name || 'Unknown',
                    'Target': parsed.target?.name || 'None',
                    'Volume': parsed.volume,
                    'Heard': `${parsed.whoHeard}/${parsed.totalListeners}`
                });
                break;

            default:
                output = RichFormatter.header('NPC', '');
                if (parsed.message) output += parsed.message + '\n';
        }
    }

    output += RichFormatter.embedJson(parsed, 'NPC_MANAGE');

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}
