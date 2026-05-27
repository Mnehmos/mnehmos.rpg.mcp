/**
 * Consolidated agent_manage tool
 *
 * LLM-driven NPCs bound to characters. Each agent owns a private mind state
 * (modular prompt slices, secrets, journal) and a configured provider/model.
 * Outputs plain text intent declarations; the DM dispatches downstream tools.
 *
 * Actions: 22 total
 *   Lifecycle (8): create, get, list, update, delete, resume, health, budget
 *   Prompt assembly (7): set_slice, remove_slice, toggle_slice, list_slices,
 *                        narrate, broadcast, preview_prompt
 *   Mind state (5): add_secret, list_secrets, remove_secret, add_journal, get_journal
 *   Invocation (2): invoke, replay
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';
import { SessionContext } from '../types.js';
import { getDb } from '../../storage/index.js';
import { AgentRepository } from '../../storage/repos/agent.repo.js';
import { CharacterRepository } from '../../storage/repos/character.repo.js';
import {
    AgentProviderSchema,
    AgentStatusSchema,
    AgentSliceKindSchema,
    AgentSecretImportanceSchema,
    AgentJournalKindSchema
} from '../../schema/agent.js';
import { createActionRouter, ActionDefinition, McpResponse } from '../../utils/action-router.js';
import { RichFormatter } from '../utils/formatter.js';
import { getAgentRuntime, buildAgentRuntime } from '../../agent/runtime/deps.js';
import { invokeAgent } from '../../agent/runtime/invoke.js';
import { composePrompt } from '../../agent/prompt/compose.js';
import { replayCall } from '../../agent/audit/replay.js';
import { ProviderFactory } from '../../agent/provider/factory.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const ACTIONS = [
    // Lifecycle
    'create', 'get', 'list', 'update', 'delete', 'resume', 'health', 'budget',
    // Prompt assembly
    'set_slice', 'remove_slice', 'toggle_slice', 'list_slices',
    'narrate', 'broadcast', 'preview_prompt',
    // Mind state
    'add_secret', 'list_secrets', 'remove_secret', 'add_journal', 'get_journal',
    // Invocation
    'invoke', 'replay'
] as const;
type AgentManageAction = typeof ACTIONS[number];

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
    return {
        db,
        agentRepo: new AgentRepository(db),
        characterRepo: new CharacterRepository(db)
    };
}

function resolveAgent(repo: AgentRepository, args: { agentId?: string; characterId?: string }): ReturnType<AgentRepository['findById']> {
    if (args.agentId) return repo.findById(args.agentId);
    if (args.characterId) return repo.findByCharacterId(args.characterId);
    return null;
}

/**
 * Get the agent runtime, lazily initializing one bound to the current DB if
 * the server didn't pre-wire it. This makes the tool usable in tests and in
 * any environment where the runtime hasn't been explicitly registered.
 */
function ensureRuntime() {
    const existing = getAgentRuntime();
    if (existing) return existing;

    const { db } = ensureDb();
    // Lazy fallback factory — reads env keys only, no startup wiring required.
    const factory = new ProviderFactory();
    factory.initialize();
    return buildAgentRuntime(db, factory);
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

// ----- Lifecycle -----

const CreateSchema = z.object({
    action: z.literal('create'),
    characterId: z.string().describe('Character to bind this agent to (1:1)'),
    provider: AgentProviderSchema.describe('LLM provider: openai or openrouter'),
    model: z.string().min(1).describe('Model identifier (e.g. gpt-4o-mini, anthropic/claude-sonnet-4-5)'),
    status: AgentStatusSchema.optional(),
    autoOnTurn: z.boolean().optional().describe('Auto-invoke when this character\'s turn comes up in combat'),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
    budgetTokens: z.number().int().positive().optional(),
    timeoutMs: z.number().int().positive().optional()
});

const GetSchema = z.object({
    action: z.literal('get'),
    agentId: z.string().optional(),
    characterId: z.string().optional()
}).refine(d => d.agentId || d.characterId, { message: 'agentId or characterId required' });

const ListSchema = z.object({
    action: z.literal('list'),
    status: AgentStatusSchema.optional(),
    autoOnTurn: z.boolean().optional()
});

const UpdateSchema = z.object({
    action: z.literal('update'),
    agentId: z.string().optional(),
    characterId: z.string().optional(),
    provider: AgentProviderSchema.optional(),
    model: z.string().min(1).optional(),
    status: AgentStatusSchema.optional(),
    autoOnTurn: z.boolean().optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
    budgetTokens: z.number().int().positive().nullable().optional(),
    timeoutMs: z.number().int().positive().optional()
}).refine(d => d.agentId || d.characterId, { message: 'agentId or characterId required' });

const DeleteSchema = z.object({
    action: z.literal('delete'),
    agentId: z.string().optional(),
    characterId: z.string().optional()
}).refine(d => d.agentId || d.characterId, { message: 'agentId or characterId required' });

const ResumeSchema = z.object({
    action: z.literal('resume'),
    agentId: z.string().optional(),
    characterId: z.string().optional()
}).refine(d => d.agentId || d.characterId, { message: 'agentId or characterId required' });

const HealthSchema = z.object({
    action: z.literal('health'),
    agentId: z.string().optional(),
    characterId: z.string().optional()
}).refine(d => d.agentId || d.characterId, { message: 'agentId or characterId required' });

const BudgetSchema = z.object({
    action: z.literal('budget'),
    agentId: z.string().optional(),
    characterId: z.string().optional(),
    setBudget: z.number().int().positive().nullable().optional().describe('Set new budget_tokens (null clears)'),
    resetUsage: z.boolean().optional().describe('Reset tokens_used to 0')
}).refine(d => d.agentId || d.characterId, { message: 'agentId or characterId required' });

// ----- Prompt assembly -----

const SetSliceSchema = z.object({
    action: z.literal('set_slice'),
    agentId: z.string().optional(),
    characterId: z.string().optional(),
    kind: AgentSliceKindSchema,
    content: z.string().min(1),
    label: z.string().nullable().optional(),
    orderIndex: z.number().int().optional(),
    enabled: z.boolean().optional()
}).refine(d => d.agentId || d.characterId, { message: 'agentId or characterId required' });

const RemoveSliceSchema = z.object({
    action: z.literal('remove_slice'),
    sliceId: z.string()
});

const ToggleSliceSchema = z.object({
    action: z.literal('toggle_slice'),
    sliceId: z.string(),
    enabled: z.boolean()
});

const ListSlicesSchema = z.object({
    action: z.literal('list_slices'),
    agentId: z.string().optional(),
    characterId: z.string().optional(),
    enabled: z.boolean().optional(),
    kind: AgentSliceKindSchema.optional()
}).refine(d => d.agentId || d.characterId, { message: 'agentId or characterId required' });

const NarrateSchema = z.object({
    action: z.literal('narrate'),
    agentId: z.string().optional(),
    characterId: z.string().optional(),
    content: z.string().min(1).describe('Observation to append to the agent\'s rolling narrative_feed slice')
}).refine(d => d.agentId || d.characterId, { message: 'agentId or characterId required' });

const BroadcastSchema = z.object({
    action: z.literal('broadcast'),
    characterIds: z.array(z.string()).min(1).describe('Character IDs whose agents receive this observation'),
    content: z.string().min(1)
});

const PreviewPromptSchema = z.object({
    action: z.literal('preview_prompt'),
    agentId: z.string().optional(),
    characterId: z.string().optional(),
    situation: z.string().optional()
}).refine(d => d.agentId || d.characterId, { message: 'agentId or characterId required' });

// ----- Mind state -----

const AddSecretSchema = z.object({
    action: z.literal('add_secret'),
    agentId: z.string().optional(),
    characterId: z.string().optional(),
    content: z.string().min(1),
    importance: AgentSecretImportanceSchema.optional()
}).refine(d => d.agentId || d.characterId, { message: 'agentId or characterId required' });

const ListSecretsSchema = z.object({
    action: z.literal('list_secrets'),
    agentId: z.string().optional(),
    characterId: z.string().optional()
}).refine(d => d.agentId || d.characterId, { message: 'agentId or characterId required' });

const RemoveSecretSchema = z.object({
    action: z.literal('remove_secret'),
    secretId: z.string()
});

const AddJournalSchema = z.object({
    action: z.literal('add_journal'),
    agentId: z.string().optional(),
    characterId: z.string().optional(),
    kind: AgentJournalKindSchema,
    content: z.string().min(1),
    encounterId: z.string().optional(),
    round: z.number().int().optional()
}).refine(d => d.agentId || d.characterId, { message: 'agentId or characterId required' });

const GetJournalSchema = z.object({
    action: z.literal('get_journal'),
    agentId: z.string().optional(),
    characterId: z.string().optional(),
    limit: z.number().int().positive().optional(),
    kinds: z.array(AgentJournalKindSchema).optional(),
    encounterId: z.string().optional()
}).refine(d => d.agentId || d.characterId, { message: 'agentId or characterId required' });

// ----- Invocation -----

const InvokeSchema = z.object({
    action: z.literal('invoke'),
    agentId: z.string().optional(),
    characterId: z.string().optional(),
    situation: z.string().optional().describe('DM-supplied scene narrative for this invocation'),
    encounterId: z.string().optional(),
    systemOverride: z.string().optional().describe('Replace all assembled slices for this one call'),
    messagesOverride: z.array(z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string()
    })).optional().describe('Replace messages[] entirely (maximum control)')
}).refine(d => d.agentId || d.characterId, { message: 'agentId or characterId required' });

const ReplaySchema = z.object({
    action: z.literal('replay'),
    callId: z.string(),
    model: z.string().optional().describe('Override model for the replay (otherwise uses the original)')
});

// ═══════════════════════════════════════════════════════════════════════════
// HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

// ----- Lifecycle -----

async function handleCreate(args: z.infer<typeof CreateSchema>): Promise<object> {
    const { agentRepo, characterRepo } = ensureDb();

    const character = characterRepo.findById(args.characterId);
    if (!character) {
        return { error: true, message: `Character not found: ${args.characterId}` };
    }

    const existing = agentRepo.findByCharacterId(args.characterId);
    if (existing) {
        return { error: true, message: `Agent already bound to ${character.name} (id=${existing.id})`, agentId: existing.id };
    }

    const agent = agentRepo.create({
        characterId: args.characterId,
        provider: args.provider,
        model: args.model,
        status: args.status,
        autoOnTurn: args.autoOnTurn ?? false,
        temperature: args.temperature,
        maxTokens: args.maxTokens,
        budgetTokens: args.budgetTokens ?? null,
        timeoutMs: args.timeoutMs
    });

    return {
        actionType: 'create',
        success: true,
        agent,
        characterName: character.name,
        message: `Agent created for ${character.name} (${args.provider}:${args.model})`
    };
}

async function handleGet(args: z.infer<typeof GetSchema>): Promise<object> {
    const { agentRepo, characterRepo } = ensureDb();
    const agent = resolveAgent(agentRepo, args);
    if (!agent) return { error: true, message: 'Agent not found' };

    const slices = agentRepo.listSlices(agent.id);
    const character = characterRepo.findById(agent.characterId);

    return {
        actionType: 'get',
        agent,
        characterName: character?.name ?? null,
        sliceCount: slices.length,
        slices: slices.map(s => ({ id: s.id, kind: s.kind, label: s.label, enabled: s.enabled, orderIndex: s.orderIndex }))
    };
}

async function handleList(args: z.infer<typeof ListSchema>): Promise<object> {
    const { agentRepo } = ensureDb();
    const agents = agentRepo.list({ status: args.status, autoOnTurn: args.autoOnTurn });
    return { actionType: 'list', count: agents.length, agents };
}

async function handleUpdate(args: z.infer<typeof UpdateSchema>): Promise<object> {
    const { agentRepo } = ensureDb();
    const agent = resolveAgent(agentRepo, args);
    if (!agent) return { error: true, message: 'Agent not found' };

    const { action: _a, agentId: _id, characterId: _cid, ...updates } = args;
    const updated = agentRepo.update(agent.id, updates);
    return { actionType: 'update', success: true, agent: updated };
}

async function handleDelete(args: z.infer<typeof DeleteSchema>): Promise<object> {
    const { agentRepo } = ensureDb();
    const agent = resolveAgent(agentRepo, args);
    if (!agent) return { error: true, message: 'Agent not found' };

    const deleted = agentRepo.delete(agent.id);
    return { actionType: 'delete', success: deleted, agentId: agent.id };
}

async function handleResume(args: z.infer<typeof ResumeSchema>): Promise<object> {
    const { agentRepo } = ensureDb();
    const agent = resolveAgent(agentRepo, args);
    if (!agent) return { error: true, message: 'Agent not found' };

    agentRepo.recordSuccess(agent.id);
    const updated = agentRepo.update(agent.id, { status: 'active' });
    return {
        actionType: 'resume',
        success: true,
        agent: updated,
        message: 'Agent resumed; circuit closed; failure counter reset.'
    };
}

async function handleHealth(args: z.infer<typeof HealthSchema>): Promise<object> {
    const { agentRepo } = ensureDb();
    const agent = resolveAgent(agentRepo, args);
    if (!agent) return { error: true, message: 'Agent not found' };

    const recentCalls = agentRepo.listCalls(agent.id, { limit: 10 });
    const lastCall = recentCalls[0];

    return {
        actionType: 'health',
        agentId: agent.id,
        status: agent.status,
        circuitState: agent.circuitState,
        consecutiveFailures: agent.consecutiveFailures,
        tokensUsed: agent.tokensUsed,
        budgetTokens: agent.budgetTokens,
        budgetRemaining: agent.budgetTokens === null ? null : Math.max(0, agent.budgetTokens - agent.tokensUsed),
        lastCallAt: lastCall?.createdAt ?? null,
        lastCallStatus: lastCall?.status ?? null,
        recentCallStatuses: recentCalls.map(c => c.status)
    };
}

async function handleBudget(args: z.infer<typeof BudgetSchema>): Promise<object> {
    const { agentRepo } = ensureDb();
    const agent = resolveAgent(agentRepo, args);
    if (!agent) return { error: true, message: 'Agent not found' };

    const updates: Parameters<AgentRepository['update']>[1] = {};
    if (args.setBudget !== undefined) updates.budgetTokens = args.setBudget;
    if (args.resetUsage) updates.tokensUsed = 0;

    const updated = Object.keys(updates).length > 0 ? agentRepo.update(agent.id, updates) : agent;

    return {
        actionType: 'budget',
        agentId: agent.id,
        budgetTokens: updated?.budgetTokens ?? null,
        tokensUsed: updated?.tokensUsed ?? 0,
        budgetRemaining: updated?.budgetTokens === null || updated?.budgetTokens === undefined
            ? null
            : Math.max(0, updated.budgetTokens - (updated.tokensUsed ?? 0))
    };
}

// ----- Prompt assembly -----

async function handleSetSlice(args: z.infer<typeof SetSliceSchema>): Promise<object> {
    const { agentRepo } = ensureDb();
    const agent = resolveAgent(agentRepo, args);
    if (!agent) return { error: true, message: 'Agent not found' };

    const slice = agentRepo.upsertSlice({
        agentId: agent.id,
        kind: args.kind,
        content: args.content,
        label: args.label ?? null,
        orderIndex: args.orderIndex,
        enabled: args.enabled
    });

    return { actionType: 'set_slice', success: true, slice };
}

async function handleRemoveSlice(args: z.infer<typeof RemoveSliceSchema>): Promise<object> {
    const { agentRepo } = ensureDb();
    const removed = agentRepo.deleteSlice(args.sliceId);
    return { actionType: 'remove_slice', success: removed, sliceId: args.sliceId };
}

async function handleToggleSlice(args: z.infer<typeof ToggleSliceSchema>): Promise<object> {
    const { agentRepo } = ensureDb();
    const toggled = agentRepo.toggleSlice(args.sliceId, args.enabled);
    return { actionType: 'toggle_slice', success: toggled, sliceId: args.sliceId, enabled: args.enabled };
}

async function handleListSlices(args: z.infer<typeof ListSlicesSchema>): Promise<object> {
    const { agentRepo } = ensureDb();
    const agent = resolveAgent(agentRepo, args);
    if (!agent) return { error: true, message: 'Agent not found' };

    const slices = agentRepo.listSlices(agent.id, { enabled: args.enabled, kind: args.kind });
    return { actionType: 'list_slices', agentId: agent.id, count: slices.length, slices };
}

async function handleNarrate(args: z.infer<typeof NarrateSchema>): Promise<object> {
    const { agentRepo } = ensureDb();
    const agent = resolveAgent(agentRepo, args);
    if (!agent) return { error: true, message: 'Agent not found' };

    // narrative_feed slices are append-only. Label = ISO timestamp + random suffix
    // so two narrate calls in the same millisecond don't collide on the
    // (agent_id, kind, label) upsert path in agentRepo.upsertSlice.
    const label = `${new Date().toISOString()}-${randomUUID().slice(0, 8)}`;
    const slice = agentRepo.upsertSlice({
        agentId: agent.id,
        kind: 'narrative_feed',
        content: args.content,
        label
    });

    return {
        actionType: 'narrate',
        success: true,
        sliceId: slice.id,
        agentId: agent.id,
        message: 'Observation appended to narrative_feed.'
    };
}

async function handleBroadcast(args: z.infer<typeof BroadcastSchema>): Promise<object> {
    const { agentRepo } = ensureDb();
    // Each broadcast entry gets its own unique label so multiple broadcasts in
    // the same millisecond — or to the same agent within a single call — don't
    // collide on the upsert key.
    const ts = new Date().toISOString();

    const results: { characterId: string; agentId: string | null; success: boolean; reason?: string }[] = [];

    for (const characterId of args.characterIds) {
        const agent = agentRepo.findByCharacterId(characterId);
        if (!agent) {
            results.push({ characterId, agentId: null, success: false, reason: 'no_agent' });
            continue;
        }
        agentRepo.upsertSlice({
            agentId: agent.id,
            kind: 'narrative_feed',
            content: args.content,
            label: `${ts}-${randomUUID().slice(0, 8)}`
        });
        results.push({ characterId, agentId: agent.id, success: true });
    }

    return {
        actionType: 'broadcast',
        deliveredTo: results.filter(r => r.success).length,
        skipped: results.filter(r => !r.success).length,
        results
    };
}

async function handlePreviewPrompt(args: z.infer<typeof PreviewPromptSchema>): Promise<object> {
    const runtime = ensureRuntime();
    const agent = resolveAgent(runtime.agentRepo, args);
    if (!agent) return { error: true, message: 'Agent not found' };

    const composed = composePrompt(
        {
            agentId: agent.id,
            characterId: agent.characterId,
            situation: args.situation
        },
        runtime
    );

    return {
        actionType: 'preview_prompt',
        agentId: agent.id,
        characterId: agent.characterId,
        messages: composed.messages,
        estimatedPromptTokens: composed.estimatedPromptTokens,
        slicesIncluded: composed.slicesIncluded,
        slicesSkipped: composed.slicesSkipped
    };
}

// ----- Mind state -----

async function handleAddSecret(args: z.infer<typeof AddSecretSchema>): Promise<object> {
    const { agentRepo } = ensureDb();
    const agent = resolveAgent(agentRepo, args);
    if (!agent) return { error: true, message: 'Agent not found' };

    const secret = agentRepo.addSecret({
        agentId: agent.id,
        content: args.content,
        importance: args.importance ?? null
    });

    return { actionType: 'add_secret', success: true, secret };
}

async function handleListSecrets(args: z.infer<typeof ListSecretsSchema>): Promise<object> {
    const { agentRepo } = ensureDb();
    const agent = resolveAgent(agentRepo, args);
    if (!agent) return { error: true, message: 'Agent not found' };

    const secrets = agentRepo.listSecrets(agent.id);
    return { actionType: 'list_secrets', agentId: agent.id, count: secrets.length, secrets };
}

async function handleRemoveSecret(args: z.infer<typeof RemoveSecretSchema>): Promise<object> {
    const { agentRepo } = ensureDb();
    const removed = agentRepo.deleteSecret(args.secretId);
    return { actionType: 'remove_secret', success: removed, secretId: args.secretId };
}

async function handleAddJournal(args: z.infer<typeof AddJournalSchema>): Promise<object> {
    const { agentRepo } = ensureDb();
    const agent = resolveAgent(agentRepo, args);
    if (!agent) return { error: true, message: 'Agent not found' };

    const entry = agentRepo.addJournalEntry({
        agentId: agent.id,
        kind: args.kind,
        content: args.content,
        encounterId: args.encounterId ?? null,
        round: args.round ?? null
    });

    return { actionType: 'add_journal', success: true, entry };
}

async function handleGetJournal(args: z.infer<typeof GetJournalSchema>): Promise<object> {
    const { agentRepo } = ensureDb();
    const agent = resolveAgent(agentRepo, args);
    if (!agent) return { error: true, message: 'Agent not found' };

    const entries = agentRepo.listJournal(agent.id, {
        limit: args.limit,
        kinds: args.kinds,
        encounterId: args.encounterId
    });

    return { actionType: 'get_journal', agentId: agent.id, count: entries.length, entries };
}

// ----- Invocation -----

async function handleInvoke(args: z.infer<typeof InvokeSchema>, ctx?: SessionContext): Promise<object> {
    const runtime = ensureRuntime();

    const result = await invokeAgent({
        agentId: args.agentId,
        characterId: args.characterId,
        situation: args.situation,
        encounterId: args.encounterId,
        systemOverride: args.systemOverride,
        messagesOverride: args.messagesOverride,
        requestId: ctx?.sessionId
    }, runtime);

    return {
        actionType: 'invoke',
        ...result
    };
}

async function handleReplay(args: z.infer<typeof ReplaySchema>): Promise<object> {
    const runtime = ensureRuntime();
    const result = await replayCall({ callId: args.callId, model: args.model }, runtime);

    if ('error' in result) {
        return { error: true, message: result.message };
    }

    return {
        actionType: 'replay',
        ...result
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION ROUTER
// ═══════════════════════════════════════════════════════════════════════════

const definitions: Record<AgentManageAction, ActionDefinition> = {
    create:         { schema: CreateSchema,         handler: handleCreate,         aliases: ['new', 'bind'],          description: 'Create an agent bound to a character' },
    get:            { schema: GetSchema,            handler: handleGet,            aliases: ['fetch', 'find'],        description: 'Get agent by id or character id' },
    list:           { schema: ListSchema,           handler: handleList,           aliases: ['all', 'query'],         description: 'List agents (filter by status / auto-on-turn)' },
    update:         { schema: UpdateSchema,         handler: handleUpdate,         aliases: ['modify', 'edit'],       description: 'Update agent configuration' },
    delete:         { schema: DeleteSchema,         handler: handleDelete,         aliases: ['remove', 'unbind'],     description: 'Delete agent (character preserved)' },
    resume:         { schema: ResumeSchema,         handler: handleResume,         aliases: ['unpause', 'reactivate'], description: 'Resume agent: close circuit + reset failures' },
    health:         { schema: HealthSchema,         handler: handleHealth,         aliases: ['status', 'state'],      description: 'Get agent operational health' },
    budget:         { schema: BudgetSchema,         handler: handleBudget,         aliases: ['tokens'],               description: 'Query/update token budget' },

    set_slice:      { schema: SetSliceSchema,       handler: handleSetSlice,       aliases: ['slice', 'upsert_slice'], description: 'Upsert a prompt slice (persona/directive/secrets/etc)' },
    remove_slice:   { schema: RemoveSliceSchema,    handler: handleRemoveSlice,    aliases: ['delete_slice'],         description: 'Delete a prompt slice by id' },
    toggle_slice:   { schema: ToggleSliceSchema,    handler: handleToggleSlice,    aliases: ['enable_slice', 'disable_slice'], description: 'Enable or disable a slice without deleting' },
    list_slices:    { schema: ListSlicesSchema,     handler: handleListSlices,     aliases: ['slices', 'get_slices'], description: 'List slices for an agent' },
    narrate:        { schema: NarrateSchema,        handler: handleNarrate,        aliases: ['observe', 'feed'],      description: 'Append an observation to the agent\'s narrative_feed slice' },
    broadcast:      { schema: BroadcastSchema,      handler: handleBroadcast,      aliases: ['fan_out'],              description: 'Append same observation to multiple agents\' narrative_feed' },
    preview_prompt: { schema: PreviewPromptSchema,  handler: handlePreviewPrompt,  aliases: ['preview', 'dry_run'],   description: 'Build the prompt without calling the LLM (debug/cost)' },

    add_secret:     { schema: AddSecretSchema,      handler: handleAddSecret,      aliases: ['secret'],               description: 'Add private knowledge the agent knows' },
    list_secrets:   { schema: ListSecretsSchema,    handler: handleListSecrets,    aliases: ['secrets'],              description: 'List agent secrets' },
    remove_secret:  { schema: RemoveSecretSchema,   handler: handleRemoveSecret,   aliases: ['delete_secret'],        description: 'Remove a secret by id' },
    add_journal:    { schema: AddJournalSchema,     handler: handleAddJournal,     aliases: ['journal', 'log'],       description: 'Append to the agent\'s first-person journal' },
    get_journal:    { schema: GetJournalSchema,     handler: handleGetJournal,     aliases: ['journal_log'],          description: 'Read agent journal entries' },

    invoke:         { schema: InvokeSchema,         handler: handleInvoke,         aliases: ['call', 'ask'],          description: 'Invoke the LLM for this agent and return plain-text intent' },
    replay:         { schema: ReplaySchema,         handler: handleReplay,         aliases: ['rerun'],                description: 'Replay a stored call (audit/debug)' }
};

const router = createActionRouter({
    actions: ACTIONS,
    definitions,
    threshold: 0.6
});

// ═══════════════════════════════════════════════════════════════════════════
// TOOL DEFINITION
// ═══════════════════════════════════════════════════════════════════════════

export const AgentManageTool = {
    name: 'agent_manage',
    description: `Manage LLM-driven NPCs ("agents") bound to characters.

Each agent owns a private mind state — modular system-prompt slices (persona, directive, secrets, narrative_feed, recent, character_state), a first-person journal, and audit-logged LLM calls. The LLM emits plain-text intent declarations; the DM dispatches downstream tools (combat_action, npc_manage, math_manage, etc.).

🧠 LIFECYCLE
  create / get / list / update / delete / resume / health / budget

📝 PROMPT ASSEMBLY (DM controls every slice)
  set_slice (kind = persona | directive | secrets | narrative_feed | recent | character_state | custom)
  remove_slice / toggle_slice / list_slices
  narrate     — append an observation to ONE agent's narrative_feed
  broadcast   — same observation, fanned out to many agents
  preview_prompt — build messages[] without calling the LLM

🔐 MIND STATE
  add_secret / list_secrets / remove_secret   (separate from npc_voice narrative notes by design)
  add_journal / get_journal                   (kinds: response, observation, plan, reflection, dm_note)

⚡ INVOCATION
  invoke   — call LLM; returns plain-text intent for DM to dispatch
  replay   — re-run a stored call for audit/debug

🤖 AUTONOMY: Agents default to PROPOSAL mode. The engine never executes their decisions. The DM reads response and makes the appropriate tool calls — same loop as a human player declaring intent.

🎯 DIALOGUE: The DM is the broadcast bus. Agents do NOT hear each other automatically; what an agent "knows" comes through narrate/broadcast.

Actions: create, get, list, update, delete, resume, health, budget, set_slice, remove_slice, toggle_slice, list_slices, narrate, broadcast, preview_prompt, add_secret, list_secrets, remove_secret, add_journal, get_journal, invoke, replay`,
    actionSchemas: router.actionSchemas,
    inputSchema: z.object({
        action: z.string().describe(`Action: ${ACTIONS.join(', ')}`),
        // identifiers
        agentId: z.string().optional(),
        characterId: z.string().optional(),
        sliceId: z.string().optional(),
        secretId: z.string().optional(),
        callId: z.string().optional(),
        encounterId: z.string().optional(),
        // create/update
        provider: AgentProviderSchema.optional(),
        model: z.string().optional(),
        status: AgentStatusSchema.optional(),
        autoOnTurn: z.boolean().optional(),
        temperature: z.number().optional(),
        maxTokens: z.number().optional(),
        budgetTokens: z.number().nullable().optional(),
        timeoutMs: z.number().optional(),
        // budget
        setBudget: z.number().nullable().optional(),
        resetUsage: z.boolean().optional(),
        // slice
        kind: AgentSliceKindSchema.optional(),
        content: z.string().optional(),
        label: z.string().nullable().optional(),
        orderIndex: z.number().optional(),
        enabled: z.boolean().optional(),
        // broadcast
        characterIds: z.array(z.string()).optional(),
        // secret
        importance: AgentSecretImportanceSchema.optional(),
        // journal
        round: z.number().optional(),
        limit: z.number().optional(),
        kinds: z.array(AgentJournalKindSchema).optional(),
        // invoke
        situation: z.string().optional(),
        systemOverride: z.string().optional(),
        messagesOverride: z.array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string() })).optional()
    })
};

// ═══════════════════════════════════════════════════════════════════════════
// MCP HANDLER
// ═══════════════════════════════════════════════════════════════════════════

export async function handleAgentManage(args: unknown, ctx: SessionContext): Promise<McpResponse> {
    const result = await router(args as Record<string, unknown>, ctx);

    // result already has { content: [{ type: 'text', text: <json> }] }
    // Wrap with RichFormatter banner for consistency with other tools
    try {
        const parsed = JSON.parse(result.content[0].text);
        let output = '';

        if (parsed.error) {
            output = RichFormatter.header('Agent Error', '');
            output += RichFormatter.alert(parsed.message || 'Unknown error', 'error');
        } else {
            switch (parsed.actionType) {
                case 'create':
                    output = RichFormatter.header(`Agent created: ${parsed.characterName || parsed.agent?.characterId}`, '');
                    output += RichFormatter.keyValue({
                        'Agent ID': parsed.agent?.id,
                        'Provider': `${parsed.agent?.provider}:${parsed.agent?.model}`,
                        'Status': parsed.agent?.status,
                        'Auto-on-turn': parsed.agent?.autoOnTurn ? 'yes' : 'no'
                    });
                    break;
                case 'get':
                    output = RichFormatter.header(`Agent (${parsed.characterName || parsed.agent?.characterId})`, '');
                    output += RichFormatter.keyValue({
                        'Provider': `${parsed.agent?.provider}:${parsed.agent?.model}`,
                        'Status': parsed.agent?.status,
                        'Circuit': parsed.agent?.circuitState,
                        'Slices': parsed.sliceCount,
                        'Tokens used': parsed.agent?.tokensUsed
                    });
                    break;
                case 'list':
                    output = RichFormatter.header(`Agents (${parsed.count})`, '');
                    if (parsed.agents?.length) {
                        const rows = parsed.agents.map((a: { id: string; characterId: string; provider: string; model: string; status: string }) => [a.id.slice(0, 8), a.characterId.slice(0, 8), `${a.provider}:${a.model}`, a.status]);
                        output += RichFormatter.table(['Agent', 'Char', 'Provider', 'Status'], rows);
                    }
                    break;
                case 'health':
                    output = RichFormatter.header('Agent Health', '');
                    output += RichFormatter.keyValue({
                        'Status': parsed.status,
                        'Circuit': parsed.circuitState,
                        'Failures': parsed.consecutiveFailures,
                        'Tokens used': parsed.tokensUsed,
                        'Budget remaining': parsed.budgetRemaining ?? 'unlimited',
                        'Last call': parsed.lastCallAt ?? 'never'
                    });
                    break;
                case 'invoke': {
                    const name = parsed.characterName || parsed.characterId || 'agent';
                    if (parsed.status === 'ok') {
                        output = RichFormatter.header(`${name} speaks`, '');
                        output += RichFormatter.keyValue({
                            'Status': parsed.status,
                            'Tokens': `${parsed.promptTokens ?? '?'} in / ${parsed.completionTokens ?? '?'} out`,
                            'Duration': parsed.durationMs !== null ? `${parsed.durationMs}ms` : '—',
                            'Call ID': parsed.callId
                        });
                        output += '\n**Response:**\n';
                        output += `> ${String(parsed.response).split('\n').join('\n> ')}\n`;
                    } else {
                        // status: error / timeout / circuit_open / budget_exhausted / incapable / paused / rate_limited
                        const alertType = parsed.status === 'incapable' || parsed.status === 'paused' ? 'warning' : 'error';
                        output = RichFormatter.header(`Agent invoke — ${parsed.status}`, '');
                        output += RichFormatter.alert(parsed.reason || `Agent returned status: ${parsed.status}`, alertType);
                        if (parsed.callId) {
                            output += RichFormatter.keyValue({
                                'Agent': name,
                                'Call ID': parsed.callId,
                                'Status': parsed.status
                            });
                        }
                    }
                    break;
                }
                case 'preview_prompt': {
                    output = RichFormatter.header('Prompt preview', '');
                    output += RichFormatter.keyValue({
                        'Agent ID': parsed.agentId,
                        'Messages': parsed.messages?.length ?? 0,
                        'Estimated prompt tokens': parsed.estimatedPromptTokens ?? 0,
                        'Slices included': Array.isArray(parsed.slicesIncluded) ? parsed.slicesIncluded.join(', ') : '—',
                        'Slices skipped': Array.isArray(parsed.slicesSkipped) ? parsed.slicesSkipped.join(', ') : '—'
                    });
                    break;
                }
                case 'replay': {
                    output = RichFormatter.header(`Replay (${parsed.mode})`, '');
                    if (parsed.original) {
                        output += '**Original:** ';
                        output += `${parsed.original.provider}:${parsed.original.model} — status ${parsed.original.status} @ ${parsed.original.createdAt}\n`;
                    }
                    if (parsed.replay) {
                        output += '**Replay:** ';
                        output += `${parsed.replay.provider}:${parsed.replay.model} — status ${parsed.replay.status}`;
                        if (parsed.replay.promptTokens) output += ` (${parsed.replay.promptTokens} in / ${parsed.replay.completionTokens} out)`;
                        output += '\n';
                    }
                    if (parsed.diff) {
                        output += `**Diff:** ${parsed.diff.sameText ? 'identical' : `different (orig=${parsed.diff.originalLength} chars, replay=${parsed.diff.replayLength} chars)`}\n`;
                    }
                    break;
                }
                default:
                    output = RichFormatter.header(`Agent ${parsed.actionType || 'operation'}`, '');
                    if (parsed.message) output += parsed.message + '\n';
            }
        }

        output += RichFormatter.embedJson(parsed, 'AGENT_MANAGE');
        return { content: [{ type: 'text', text: output }] };
    } catch {
        // If JSON parsing fails, return router's original response
        return result;
    }
}
