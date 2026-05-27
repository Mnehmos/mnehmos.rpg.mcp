import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import {
    Agent,
    AgentSchema,
    AgentCreateInput,
    AgentUpdateInput,
    AgentPromptSlice,
    AgentPromptSliceSchema,
    AgentSliceKind,
    AgentSecret,
    AgentSecretSchema,
    AgentSecretImportance,
    AgentJournalEntry,
    AgentJournalEntrySchema,
    AgentJournalKind,
    AgentCall,
    AgentCallSchema,
    AgentCallStatus,
    AgentProvider,
    AgentCircuitState
} from '../../schema/agent.js';

// ============================================================================
// ROW TYPES (snake_case from SQLite)
// ============================================================================

interface AgentRow {
    id: string;
    character_id: string;
    provider: string;
    model: string;
    status: string;
    auto_on_turn: number;
    auto_on_legendary: number;
    temperature: number;
    max_tokens: number;
    budget_tokens: number | null;
    tokens_used: number;
    timeout_ms: number;
    consecutive_failures: number;
    circuit_state: string;
    created_at: string;
    updated_at: string;
}

interface SliceRow {
    id: string;
    agent_id: string;
    kind: string;
    label: string | null;
    content: string;
    order_index: number;
    enabled: number;
    updated_at: string;
}

interface SecretRow {
    id: string;
    agent_id: string;
    content: string;
    importance: string | null;
    created_at: string;
}

interface JournalRow {
    id: string;
    agent_id: string;
    kind: string;
    encounter_id: string | null;
    round: number | null;
    content: string;
    created_at: string;
}

interface CallRow {
    id: string;
    agent_id: string;
    request_id: string | null;
    provider: string;
    model: string;
    messages_json: string;
    raw_response: string | null;
    prompt_tokens: number | null;
    completion_tokens: number | null;
    duration_ms: number | null;
    status: string;
    error_message: string | null;
    created_at: string;
}

// ============================================================================
// ROW → ENTITY MAPPERS
// ============================================================================

function rowToAgent(row: AgentRow): Agent {
    return AgentSchema.parse({
        id: row.id,
        characterId: row.character_id,
        provider: row.provider as AgentProvider,
        model: row.model,
        status: row.status,
        autoOnTurn: row.auto_on_turn === 1,
        autoOnLegendary: row.auto_on_legendary === 1,
        temperature: row.temperature,
        maxTokens: row.max_tokens,
        budgetTokens: row.budget_tokens,
        tokensUsed: row.tokens_used,
        timeoutMs: row.timeout_ms,
        consecutiveFailures: row.consecutive_failures,
        circuitState: row.circuit_state as AgentCircuitState,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    });
}

function rowToSlice(row: SliceRow): AgentPromptSlice {
    return AgentPromptSliceSchema.parse({
        id: row.id,
        agentId: row.agent_id,
        kind: row.kind,
        label: row.label,
        content: row.content,
        orderIndex: row.order_index,
        enabled: row.enabled === 1,
        updatedAt: row.updated_at
    });
}

function rowToSecret(row: SecretRow): AgentSecret {
    return AgentSecretSchema.parse({
        id: row.id,
        agentId: row.agent_id,
        content: row.content,
        importance: row.importance,
        createdAt: row.created_at
    });
}

function rowToJournal(row: JournalRow): AgentJournalEntry {
    return AgentJournalEntrySchema.parse({
        id: row.id,
        agentId: row.agent_id,
        kind: row.kind,
        encounterId: row.encounter_id,
        round: row.round,
        content: row.content,
        createdAt: row.created_at
    });
}

function rowToCall(row: CallRow): AgentCall {
    return AgentCallSchema.parse({
        id: row.id,
        agentId: row.agent_id,
        requestId: row.request_id,
        provider: row.provider as AgentProvider,
        model: row.model,
        messagesJson: row.messages_json,
        rawResponse: row.raw_response,
        promptTokens: row.prompt_tokens,
        completionTokens: row.completion_tokens,
        durationMs: row.duration_ms,
        status: row.status as AgentCallStatus,
        errorMessage: row.error_message,
        createdAt: row.created_at
    });
}

// ============================================================================
// REPOSITORY
// ============================================================================

export class AgentRepository {
    constructor(private db: Database.Database) {}

    // ---------- AGENT CRUD ----------

    create(input: AgentCreateInput): Agent {
        const id = input.id ?? randomUUID();
        const now = new Date().toISOString();

        const stmt = this.db.prepare(`
            INSERT INTO agents (
                id, character_id, provider, model, status,
                auto_on_turn, auto_on_legendary, temperature, max_tokens, budget_tokens,
                tokens_used, timeout_ms, consecutive_failures, circuit_state,
                created_at, updated_at
            ) VALUES (
                @id, @characterId, @provider, @model, @status,
                @autoOnTurn, @autoOnLegendary, @temperature, @maxTokens, @budgetTokens,
                @tokensUsed, @timeoutMs, @consecutiveFailures, @circuitState,
                @createdAt, @updatedAt
            )
        `);

        stmt.run({
            id,
            characterId: input.characterId,
            provider: input.provider,
            model: input.model,
            status: input.status ?? 'active',
            autoOnTurn: input.autoOnTurn ? 1 : 0,
            autoOnLegendary: input.autoOnLegendary ? 1 : 0,
            temperature: input.temperature ?? 0.7,
            maxTokens: input.maxTokens ?? 800,
            budgetTokens: input.budgetTokens ?? null,
            tokensUsed: input.tokensUsed ?? 0,
            timeoutMs: input.timeoutMs ?? 25000,
            consecutiveFailures: input.consecutiveFailures ?? 0,
            circuitState: input.circuitState ?? 'closed',
            createdAt: now,
            updatedAt: now
        });

        const created = this.findById(id);
        if (!created) throw new Error(`Failed to create agent ${id}`);
        return created;
    }

    findById(id: string): Agent | null {
        const row = this.db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow | undefined;
        return row ? rowToAgent(row) : null;
    }

    findByCharacterId(characterId: string): Agent | null {
        const row = this.db.prepare('SELECT * FROM agents WHERE character_id = ?').get(characterId) as AgentRow | undefined;
        return row ? rowToAgent(row) : null;
    }

    list(filter?: { status?: string; autoOnTurn?: boolean }): Agent[] {
        const conditions: string[] = [];
        const params: unknown[] = [];

        if (filter?.status) {
            conditions.push('status = ?');
            params.push(filter.status);
        }
        if (filter?.autoOnTurn !== undefined) {
            conditions.push('auto_on_turn = ?');
            params.push(filter.autoOnTurn ? 1 : 0);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const rows = this.db.prepare(`SELECT * FROM agents ${where} ORDER BY created_at DESC`).all(...params) as AgentRow[];
        return rows.map(rowToAgent);
    }

    update(id: string, updates: AgentUpdateInput): Agent | null {
        const existing = this.findById(id);
        if (!existing) return null;

        const fields: string[] = [];
        const params: Record<string, unknown> = { id };

        const map: Record<keyof AgentUpdateInput, string> = {
            provider: 'provider',
            model: 'model',
            status: 'status',
            autoOnTurn: 'auto_on_turn',
            autoOnLegendary: 'auto_on_legendary',
            temperature: 'temperature',
            maxTokens: 'max_tokens',
            budgetTokens: 'budget_tokens',
            tokensUsed: 'tokens_used',
            timeoutMs: 'timeout_ms',
            consecutiveFailures: 'consecutive_failures',
            circuitState: 'circuit_state'
        };

        for (const [key, column] of Object.entries(map) as [keyof AgentUpdateInput, string][]) {
            const value = updates[key];
            if (value === undefined) continue;
            fields.push(`${column} = @${key}`);
            params[key] = typeof value === 'boolean' ? (value ? 1 : 0) : value;
        }

        if (fields.length === 0) return existing;

        fields.push('updated_at = @updatedAt');
        params.updatedAt = new Date().toISOString();

        this.db.prepare(`UPDATE agents SET ${fields.join(', ')} WHERE id = @id`).run(params);
        return this.findById(id);
    }

    delete(id: string): boolean {
        const result = this.db.prepare('DELETE FROM agents WHERE id = ?').run(id);
        return result.changes > 0;
    }

    incrementTokensUsed(id: string, delta: number): void {
        this.db.prepare('UPDATE agents SET tokens_used = tokens_used + ?, updated_at = ? WHERE id = ?')
            .run(delta, new Date().toISOString(), id);
    }

    // ---------- SLICE CRUD ----------

    upsertSlice(input: {
        agentId: string;
        kind: AgentSliceKind;
        content: string;
        label?: string | null;
        orderIndex?: number;
        enabled?: boolean;
    }): AgentPromptSlice {
        // Find existing slice of same kind+label (label nullable; treat null and undefined as same)
        const existing = this.db.prepare(`
            SELECT * FROM agent_prompt_slices
            WHERE agent_id = ? AND kind = ? AND (label IS ? OR label = ?)
            LIMIT 1
        `).get(input.agentId, input.kind, input.label ?? null, input.label ?? '') as SliceRow | undefined;

        const now = new Date().toISOString();

        if (existing) {
            this.db.prepare(`
                UPDATE agent_prompt_slices
                SET content = ?, order_index = ?, enabled = ?, updated_at = ?
                WHERE id = ?
            `).run(
                input.content,
                input.orderIndex ?? existing.order_index,
                input.enabled === undefined ? existing.enabled : (input.enabled ? 1 : 0),
                now,
                existing.id
            );
            return rowToSlice({
                ...existing,
                content: input.content,
                order_index: input.orderIndex ?? existing.order_index,
                enabled: input.enabled === undefined ? existing.enabled : (input.enabled ? 1 : 0),
                updated_at: now
            });
        }

        const id = randomUUID();
        const orderIndex = input.orderIndex ?? this.nextSliceOrderIndex(input.agentId);

        this.db.prepare(`
            INSERT INTO agent_prompt_slices (id, agent_id, kind, label, content, order_index, enabled, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            input.agentId,
            input.kind,
            input.label ?? null,
            input.content,
            orderIndex,
            input.enabled === false ? 0 : 1,
            now
        );

        return rowToSlice({
            id,
            agent_id: input.agentId,
            kind: input.kind,
            label: input.label ?? null,
            content: input.content,
            order_index: orderIndex,
            enabled: input.enabled === false ? 0 : 1,
            updated_at: now
        });
    }

    listSlices(agentId: string, filter?: { enabled?: boolean; kind?: AgentSliceKind }): AgentPromptSlice[] {
        const conditions: string[] = ['agent_id = ?'];
        const params: unknown[] = [agentId];

        if (filter?.enabled !== undefined) {
            conditions.push('enabled = ?');
            params.push(filter.enabled ? 1 : 0);
        }
        if (filter?.kind) {
            conditions.push('kind = ?');
            params.push(filter.kind);
        }

        const rows = this.db.prepare(
            `SELECT * FROM agent_prompt_slices WHERE ${conditions.join(' AND ')} ORDER BY order_index ASC, updated_at ASC`
        ).all(...params) as SliceRow[];

        return rows.map(rowToSlice);
    }

    findSliceById(id: string): AgentPromptSlice | null {
        const row = this.db.prepare('SELECT * FROM agent_prompt_slices WHERE id = ?').get(id) as SliceRow | undefined;
        return row ? rowToSlice(row) : null;
    }

    toggleSlice(id: string, enabled: boolean): boolean {
        const result = this.db.prepare(
            'UPDATE agent_prompt_slices SET enabled = ?, updated_at = ? WHERE id = ?'
        ).run(enabled ? 1 : 0, new Date().toISOString(), id);
        return result.changes > 0;
    }

    deleteSlice(id: string): boolean {
        const result = this.db.prepare('DELETE FROM agent_prompt_slices WHERE id = ?').run(id);
        return result.changes > 0;
    }

    private nextSliceOrderIndex(agentId: string): number {
        const row = this.db.prepare(
            'SELECT COALESCE(MAX(order_index), -1) + 1 AS next FROM agent_prompt_slices WHERE agent_id = ?'
        ).get(agentId) as { next: number };
        return row.next;
    }

    // ---------- SECRET CRUD ----------

    addSecret(input: { agentId: string; content: string; importance?: AgentSecretImportance | null }): AgentSecret {
        const id = randomUUID();
        const now = new Date().toISOString();

        this.db.prepare(`
            INSERT INTO agent_secrets (id, agent_id, content, importance, created_at)
            VALUES (?, ?, ?, ?, ?)
        `).run(id, input.agentId, input.content, input.importance ?? null, now);

        return rowToSecret({
            id,
            agent_id: input.agentId,
            content: input.content,
            importance: input.importance ?? null,
            created_at: now
        });
    }

    listSecrets(agentId: string): AgentSecret[] {
        const rows = this.db.prepare(
            'SELECT * FROM agent_secrets WHERE agent_id = ? ORDER BY created_at ASC'
        ).all(agentId) as SecretRow[];
        return rows.map(rowToSecret);
    }

    deleteSecret(id: string): boolean {
        const result = this.db.prepare('DELETE FROM agent_secrets WHERE id = ?').run(id);
        return result.changes > 0;
    }

    // ---------- JOURNAL ----------

    addJournalEntry(input: {
        agentId: string;
        kind: AgentJournalKind;
        content: string;
        encounterId?: string | null;
        round?: number | null;
    }): AgentJournalEntry {
        const id = randomUUID();
        const now = new Date().toISOString();

        this.db.prepare(`
            INSERT INTO agent_journal (id, agent_id, kind, encounter_id, round, content, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            input.agentId,
            input.kind,
            input.encounterId ?? null,
            input.round ?? null,
            input.content,
            now
        );

        return rowToJournal({
            id,
            agent_id: input.agentId,
            kind: input.kind,
            encounter_id: input.encounterId ?? null,
            round: input.round ?? null,
            content: input.content,
            created_at: now
        });
    }

    listJournal(agentId: string, options?: { limit?: number; kinds?: AgentJournalKind[]; encounterId?: string }): AgentJournalEntry[] {
        const conditions: string[] = ['agent_id = ?'];
        const params: unknown[] = [agentId];

        if (options?.kinds && options.kinds.length > 0) {
            conditions.push(`kind IN (${options.kinds.map(() => '?').join(',')})`);
            params.push(...options.kinds);
        }
        if (options?.encounterId) {
            conditions.push('encounter_id = ?');
            params.push(options.encounterId);
        }

        const limit = options?.limit ?? 50;
        params.push(limit);

        const rows = this.db.prepare(
            `SELECT * FROM agent_journal WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC, rowid DESC LIMIT ?`
        ).all(...params) as JournalRow[];

        return rows.map(rowToJournal);
    }

    // ---------- CALLS (audit log) ----------

    recordCall(input: {
        agentId: string;
        requestId?: string | null;
        provider: AgentProvider;
        model: string;
        messagesJson: string;
        rawResponse?: string | null;
        promptTokens?: number | null;
        completionTokens?: number | null;
        durationMs?: number | null;
        status: AgentCallStatus;
        errorMessage?: string | null;
    }): AgentCall {
        const id = randomUUID();
        const now = new Date().toISOString();

        this.db.prepare(`
            INSERT INTO agent_calls (
                id, agent_id, request_id, provider, model, messages_json, raw_response,
                prompt_tokens, completion_tokens, duration_ms, status, error_message, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            input.agentId,
            input.requestId ?? null,
            input.provider,
            input.model,
            input.messagesJson,
            input.rawResponse ?? null,
            input.promptTokens ?? null,
            input.completionTokens ?? null,
            input.durationMs ?? null,
            input.status,
            input.errorMessage ?? null,
            now
        );

        return rowToCall({
            id,
            agent_id: input.agentId,
            request_id: input.requestId ?? null,
            provider: input.provider,
            model: input.model,
            messages_json: input.messagesJson,
            raw_response: input.rawResponse ?? null,
            prompt_tokens: input.promptTokens ?? null,
            completion_tokens: input.completionTokens ?? null,
            duration_ms: input.durationMs ?? null,
            status: input.status,
            error_message: input.errorMessage ?? null,
            created_at: now
        });
    }

    findCallById(id: string): AgentCall | null {
        const row = this.db.prepare('SELECT * FROM agent_calls WHERE id = ?').get(id) as CallRow | undefined;
        return row ? rowToCall(row) : null;
    }

    listCalls(agentId: string, options?: { limit?: number; status?: AgentCallStatus }): AgentCall[] {
        const conditions: string[] = ['agent_id = ?'];
        const params: unknown[] = [agentId];

        if (options?.status) {
            conditions.push('status = ?');
            params.push(options.status);
        }

        const limit = options?.limit ?? 50;
        params.push(limit);

        const rows = this.db.prepare(
            `SELECT * FROM agent_calls WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC, rowid DESC LIMIT ?`
        ).all(...params) as CallRow[];

        return rows.map(rowToCall);
    }

    // ---------- CIRCUIT BREAKER HELPERS ----------

    recordFailure(agentId: string): { failures: number; circuitState: AgentCircuitState } {
        const agent = this.findById(agentId);
        if (!agent) throw new Error(`Agent not found: ${agentId}`);

        const failures = agent.consecutiveFailures + 1;
        const circuitState: AgentCircuitState = failures >= 3 ? 'open' : agent.circuitState;

        this.db.prepare(
            'UPDATE agents SET consecutive_failures = ?, circuit_state = ?, updated_at = ? WHERE id = ?'
        ).run(failures, circuitState, new Date().toISOString(), agentId);

        return { failures, circuitState };
    }

    recordSuccess(agentId: string): void {
        this.db.prepare(
            "UPDATE agents SET consecutive_failures = 0, circuit_state = 'closed', updated_at = ? WHERE id = ?"
        ).run(new Date().toISOString(), agentId);
    }
}
