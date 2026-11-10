/**
 * Replay a stored LLM call.
 *
 * Two modes (driven by whether input.model is provided):
 *   - dry  (default): re-surface the stored call data without any LLM round-trip.
 *           Useful for inspecting past behavior + catching schema-migration regressions.
 *   - live (input.model present): re-issue the stored messages[] against input.model
 *           via a direct provider call, persist a new agent_calls row for the replay,
 *           and return original + replay side-by-side with a lightweight text diff.
 *
 * Live mode does NOT go through invokeAgent — it bypasses preflight, circuit
 * breaker, journal append, and event_inbox emission on purpose. A replay is a
 * DM-initiated audit action, not a turn the agent is taking.
 */

import { AgentRuntimeDeps } from '../runtime/deps.js';
import { ChatMessage, ProviderError } from '../provider/types.js';
import { effectiveTimeoutMs, isProModel } from '../../schema/agent.js';

export interface ReplayInput {
    callId: string;
    /** When provided, runs a live re-issue against this model (live mode). */
    model?: string;
}

export interface ReplayResult {
    callId: string;
    mode: 'dry' | 'live';
    original: {
        provider: string;
        model: string;
        status: string;
        rawResponse: string | null;
        createdAt: string;
    };
    /** Present only when mode === 'live'. */
    replay?: {
        provider: string;
        model: string;
        status: 'ok' | 'timeout' | 'error';
        response: string;
        replayCallId: string;
        promptTokens: number | null;
        completionTokens: number | null;
        durationMs: number | null;
        errorMessage?: string;
    };
    /** Lightweight text diff between original.rawResponse and replay.response. */
    diff?: {
        sameLength: boolean;
        sameText: boolean;
        originalLength: number;
        replayLength: number;
    };
}

export async function replayCall(
    input: ReplayInput,
    deps: AgentRuntimeDeps
): Promise<ReplayResult | { error: true; message: string }> {
    const call = deps.agentRepo.findCallById(input.callId);
    if (!call) {
        return { error: true, message: `Call not found: ${input.callId}` };
    }

    const original = {
        provider: call.provider,
        model: call.model,
        status: call.status,
        rawResponse: call.rawResponse,
        createdAt: call.createdAt
    };

    // ─── Dry mode: no LLM call, just re-surface stored data ───
    if (!input.model) {
        return {
            callId: call.id,
            mode: 'dry',
            original
        };
    }

    // ─── Live mode: direct provider call with the override model ───
    // The model comes straight from the caller here, so the rule that invoke
    // enforces through the competency ladder has to be applied explicitly.
    if (isProModel(input.model)) {
        return { error: true, message: `Pro model variants are not allowed: ${input.model}` };
    }

    const agent = deps.agentRepo.findById(call.agentId);
    if (!agent) {
        return { error: true, message: `Agent for original call is gone: ${call.agentId}` };
    }

    // A live replay is a real provider call, so it is charged to the agent's
    // budget like one and refused once the budget is gone. It still skips the
    // other invoke gates on purpose: a paused agent can be replayed, and a
    // failed replay does not trip the circuit breaker.
    if (agent.budgetTokens !== null && agent.tokensUsed >= agent.budgetTokens) {
        return {
            error: true,
            message: `Agent token budget is exhausted (used ${agent.tokensUsed} of ${agent.budgetTokens}); ` +
                'a live replay would spend more. Raise the budget, or replay without a model for the stored result.'
        };
    }

    let messages: ChatMessage[];
    try {
        const parsed = JSON.parse(call.messagesJson);
        if (!Array.isArray(parsed)) throw new Error('messages_json is not an array');
        messages = parsed as ChatMessage[];
    } catch (err) {
        return {
            error: true,
            message: `Could not parse stored messages_json: ${(err as Error).message}`
        };
    }

    let provider;
    try {
        provider = deps.providerFactory.get(agent.provider);
    } catch (err) {
        return {
            error: true,
            message: `Provider unavailable for replay: ${(err as Error).message}`
        };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), effectiveTimeoutMs(agent.timeoutMs));

    try {
        const out = await provider.call({
            model: input.model,
            messages,
            temperature: agent.temperature,
            maxTokens: agent.maxTokens,
            signal: controller.signal
        });
        clearTimeout(timeout);

        // Charge what the provider reported; estimate when a gateway omits usage.
        const estimate = (text: string) => Math.max(1, Math.ceil(text.length / 4));
        const tokensSpent = (out.promptTokens ?? estimate(call.messagesJson))
            + (out.completionTokens ?? estimate(out.text));
        deps.agentRepo.incrementTokensUsed(agent.id, tokensSpent);

        const replayCallRow = deps.agentRepo.recordCall({
            agentId: agent.id,
            requestId: `replay:${call.id}`,
            provider: agent.provider,
            model: input.model,
            messagesJson: call.messagesJson,
            rawResponse: out.raw,
            promptTokens: out.promptTokens ?? null,
            completionTokens: out.completionTokens ?? null,
            durationMs: out.durationMs,
            status: 'ok'
        });

        return {
            callId: call.id,
            mode: 'live',
            original,
            replay: {
                provider: agent.provider,
                model: input.model,
                status: 'ok',
                response: out.text,
                replayCallId: replayCallRow.id,
                promptTokens: out.promptTokens ?? null,
                completionTokens: out.completionTokens ?? null,
                durationMs: out.durationMs
            },
            diff: buildDiff(original.rawResponse, out.text)
        };
    } catch (err) {
        clearTimeout(timeout);
        const providerErr = err instanceof ProviderError ? err : null;
        const status: 'timeout' | 'error' = providerErr?.kind === 'timeout' ? 'timeout' : 'error';
        const errorMessage = err instanceof Error ? err.message : String(err);

        const replayCallRow = deps.agentRepo.recordCall({
            agentId: agent.id,
            requestId: `replay:${call.id}`,
            provider: agent.provider,
            model: input.model,
            messagesJson: call.messagesJson,
            rawResponse: providerErr?.raw ?? null,
            promptTokens: null,
            completionTokens: null,
            durationMs: null,
            status,
            errorMessage
        });

        return {
            callId: call.id,
            mode: 'live',
            original,
            replay: {
                provider: agent.provider,
                model: input.model,
                status,
                response: '',
                replayCallId: replayCallRow.id,
                promptTokens: null,
                completionTokens: null,
                durationMs: null,
                errorMessage
            }
        };
    }
}

function buildDiff(originalText: string | null, replayText: string): NonNullable<ReplayResult['diff']> {
    const originalLength = originalText?.length ?? 0;
    const replayLength = replayText.length;
    return {
        sameLength: originalLength === replayLength,
        sameText: originalText === replayText,
        originalLength,
        replayLength
    };
}
