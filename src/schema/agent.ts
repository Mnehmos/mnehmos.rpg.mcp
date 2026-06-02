import { z } from 'zod';

// ============================================================================
// AGENT — LLM-driven character bindings
// ============================================================================

export const AgentProviderSchema = z.enum(['openai', 'openrouter']);
export type AgentProvider = z.infer<typeof AgentProviderSchema>;

export const AgentStatusSchema = z.enum(['active', 'paused', 'retired']);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const AgentCircuitStateSchema = z.enum(['closed', 'open', 'half_open']);
export type AgentCircuitState = z.infer<typeof AgentCircuitStateSchema>;

export const ReasoningEffortSchema = z.enum(['low', 'medium', 'high', 'xhigh']);
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

export const CompetencySourceSchema = z.enum(['stat_derived', 'override']);
export type CompetencySource = z.infer<typeof CompetencySourceSchema>;

export const CompetencyOverrideSchema = z.object({
    model: z.string().min(1).refine((model) => !/-pro\b/i.test(model), {
        message: 'Pro model variants are not allowed'
    }).optional(),
    reasoningEffort: ReasoningEffortSchema.nullable().optional()
});
export type CompetencyOverride = z.infer<typeof CompetencyOverrideSchema>;

export const AgentSchema = z.object({
    id: z.string(),
    characterId: z.string(),
    provider: AgentProviderSchema,
    model: z.string().min(1),
    status: AgentStatusSchema.default('active'),
    autoOnTurn: z.boolean().default(false),
    temperature: z.number().min(0).max(2).default(0.7),
    maxTokens: z.number().int().positive().default(800),
    budgetTokens: z.number().int().positive().nullable().default(null),
    tokensUsed: z.number().int().nonnegative().default(0),
    timeoutMs: z.number().int().positive().default(25000),
    consecutiveFailures: z.number().int().nonnegative().default(0),
    circuitState: AgentCircuitStateSchema.default('closed'),
    competencyOverride: CompetencyOverrideSchema.nullable().default(null),
    createdAt: z.string(),
    updatedAt: z.string()
});
export type Agent = z.infer<typeof AgentSchema>;

// ============================================================================
// PROMPT SLICE — modular system-prompt fragments
// ============================================================================

export const AgentSliceKindSchema = z.enum([
    'persona',
    'directive',
    'secrets',
    'narrative_feed',
    'recent',
    'character_state',
    'custom'
]);
export type AgentSliceKind = z.infer<typeof AgentSliceKindSchema>;

export const AgentPromptSliceSchema = z.object({
    id: z.string(),
    agentId: z.string(),
    kind: AgentSliceKindSchema,
    label: z.string().nullable().default(null),
    content: z.string(),
    orderIndex: z.number().int(),
    enabled: z.boolean().default(true),
    updatedAt: z.string()
});
export type AgentPromptSlice = z.infer<typeof AgentPromptSliceSchema>;

// ============================================================================
// SECRET — agent-private knowledge (separate from npc_voice narrative notes)
// ============================================================================

export const AgentSecretImportanceSchema = z.enum(['low', 'medium', 'high', 'critical']);
export type AgentSecretImportance = z.infer<typeof AgentSecretImportanceSchema>;

export const AgentSecretSchema = z.object({
    id: z.string(),
    agentId: z.string(),
    content: z.string().min(1),
    importance: AgentSecretImportanceSchema.nullable().default(null),
    createdAt: z.string()
});
export type AgentSecret = z.infer<typeof AgentSecretSchema>;

// ============================================================================
// JOURNAL — first-person log
// ============================================================================

export const AgentJournalKindSchema = z.enum([
    'response',
    'observation',
    'plan',
    'reflection',
    'dm_note'
]);
export type AgentJournalKind = z.infer<typeof AgentJournalKindSchema>;

export const AgentJournalEntrySchema = z.object({
    id: z.string(),
    agentId: z.string(),
    kind: AgentJournalKindSchema,
    encounterId: z.string().nullable().default(null),
    round: z.number().int().nullable().default(null),
    content: z.string(),
    createdAt: z.string()
});
export type AgentJournalEntry = z.infer<typeof AgentJournalEntrySchema>;

// ============================================================================
// CALL — audit + replay log of every LLM call
// ============================================================================

export const AgentCallStatusSchema = z.enum([
    'ok',
    'timeout',
    'rate_limited',
    'error',
    'circuit_open',
    'budget_exhausted',
    'incapable',
    'paused',
    'skipped'
]);
export type AgentCallStatus = z.infer<typeof AgentCallStatusSchema>;

export const AgentCallSchema = z.object({
    id: z.string(),
    agentId: z.string(),
    requestId: z.string().nullable().default(null),
    provider: AgentProviderSchema,
    model: z.string(),
    messagesJson: z.string(),
    rawResponse: z.string().nullable().default(null),
    promptTokens: z.number().int().nonnegative().nullable().default(null),
    completionTokens: z.number().int().nonnegative().nullable().default(null),
    durationMs: z.number().int().nonnegative().nullable().default(null),
    status: AgentCallStatusSchema,
    reasoningEffort: ReasoningEffortSchema.nullable().default(null),
    competencySource: CompetencySourceSchema.nullable().default(null),
    errorMessage: z.string().nullable().default(null),
    createdAt: z.string()
});
export type AgentCall = z.infer<typeof AgentCallSchema>;

// ============================================================================
// CREATE/UPDATE input types — repo accepts these, fills in id/timestamps
// ============================================================================

export const AgentCreateInputSchema = z.object({
    id: z.string().optional(),
    characterId: z.string(),
    provider: AgentProviderSchema,
    model: z.string().min(1),
    status: AgentStatusSchema.optional(),
    autoOnTurn: z.boolean().optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
    budgetTokens: z.number().int().positive().nullable().optional(),
    tokensUsed: z.number().int().nonnegative().optional(),
    timeoutMs: z.number().int().positive().optional(),
    consecutiveFailures: z.number().int().nonnegative().optional(),
    circuitState: AgentCircuitStateSchema.optional(),
    competencyOverride: CompetencyOverrideSchema.nullable().optional()
});
export type AgentCreateInput = z.infer<typeof AgentCreateInputSchema>;

export const AgentUpdateInputSchema = AgentSchema.omit({
    id: true,
    characterId: true,
    createdAt: true,
    updatedAt: true
}).partial();
export type AgentUpdateInput = z.infer<typeof AgentUpdateInputSchema>;
