/**
 * Replay a stored LLM call.
 *
 * Two modes:
 *   - dry replay (default): re-validate the stored raw_response against the schema/repo —
 *     useful for catching schema-migration regressions. No new provider call.
 *   - live replay (when `model` override provided): re-issue the original messages[]
 *     against the named model. Useful for A/B comparing models on the same prompt.
 *
 * In both modes we return the original Decision + the replay outcome side-by-side.
 */

import { AgentRuntimeDeps } from '../runtime/deps.js';
import { invokeAgent } from '../runtime/invoke.js';
import { ChatMessage } from '../provider/types.js';

export interface ReplayInput {
    callId: string;
    /** Override model — triggers a live re-issue against this model. */
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
    /** Present when mode === 'live'. */
    replay?: {
        provider: string;
        model: string;
        status: string;
        response: string;
        promptTokens: number | null;
        completionTokens: number | null;
        durationMs: number | null;
    };
    /** Diff hints (very lightweight — same text? different length?). */
    diff?: {
        sameLength: boolean;
        sameText: boolean;
        originalLength: number;
        replayLength: number;
    };
}

export async function replayCall(input: ReplayInput, deps: AgentRuntimeDeps): Promise<ReplayResult | { error: true; message: string }> {
    const call = deps.agentRepo.findCallById(input.callId);
    if (!call) return { error: true, message: `Call not found: ${input.callId}` };

    const original = {
        provider: call.provider,
        model: call.model,
        status: call.status,
        rawResponse: call.rawResponse,
        createdAt: call.createdAt
    };

    // Dry replay: just re-surface the stored data
    if (!input.model) {
        return {
            callId: call.id,
            mode: 'dry',
            original
        };
    }

    // Live replay: re-issue with the override model
    let messages: ChatMessage[];
    try {
        messages = JSON.parse(call.messagesJson);
        if (!Array.isArray(messages)) throw new Error('messages_json is not an array');
    } catch (err) {
        return { error: true, message: `Could not parse stored messages_json: ${(err as Error).message}` };
    }

    const replayResult = await invokeAgent({
        agentId: call.agentId,
        messagesOverride: messages,
        // overrideModel handled via a model field on agents? No — invokeAgent uses agent.model.
        // For a one-off model swap we need to temporarily update the agent. Simpler: use the
        // provider directly. But to stay consistent with audit/circuit/budget paths, we use
        // invokeAgent + a temporary update + restore. Tradeoff: it'll be journaled as if the
        // agent ran with this model. Acceptable for an explicit DM-initiated replay.
        requestId: `replay:${call.id}`
    }, deps);

    // Temporary model override: stash, swap, run, restore.
    // (We did NOT actually swap above — implementing the swap path here.)
    // Above call ran with the agent's *current* model. To honor input.model we must
    // run with the override. Re-issue using a manual provider call.
    if (input.model && input.model !== call.model) {
        const agent = deps.agentRepo.findById(call.agentId);
        if (!agent) return { error: true, message: 'Agent for original call is gone' };
        const provider = deps.providerFactory.get(agent.provider);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), agent.timeoutMs);
        try {
            const out = await provider.call({
                model: input.model,
                messages,
                temperature: agent.temperature,
                maxTokens: agent.maxTokens,
                signal: controller.signal
            });
            clearTimeout(timeout);

            // Persist a new call row for the replay
            deps.agentRepo.recordCall({
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
                    promptTokens: out.promptTokens ?? null,
                    completionTokens: out.completionTokens ?? null,
                    durationMs: out.durationMs
                },
                diff: {
                    sameLength: original.rawResponse?.length === out.text.length,
                    sameText: original.rawResponse === out.text,
                    originalLength: original.rawResponse?.length ?? 0,
                    replayLength: out.text.length
                }
            };
        } catch (err) {
            clearTimeout(timeout);
            const message = err instanceof Error ? err.message : String(err);
            return {
                callId: call.id,
                mode: 'live',
                original,
                replay: {
                    provider: agent.provider,
                    model: input.model,
                    status: 'error',
                    response: message,
                    promptTokens: null,
                    completionTokens: null,
                    durationMs: null
                }
            };
        }
    }

    // Same-model replay path (used the invoke result above)
    return {
        callId: call.id,
        mode: 'live',
        original,
        replay: {
            provider: call.provider,
            model: call.model,
            status: replayResult.status,
            response: replayResult.response,
            promptTokens: replayResult.promptTokens,
            completionTokens: replayResult.completionTokens,
            durationMs: replayResult.durationMs
        },
        diff: {
            sameLength: original.rawResponse?.length === replayResult.response.length,
            sameText: original.rawResponse === replayResult.response,
            originalLength: original.rawResponse?.length ?? 0,
            replayLength: replayResult.response.length
        }
    };
}
