/**
 * Agent invoke runtime.
 *
 * Flow:
 *   1. Resolve agent + character
 *   2. Preflight gates (paused / circuit_open / budget / incapable)
 *   3. Get provider from factory (fails with `error` status if not configured)
 *   4. Compose prompt
 *   5. Call provider with AbortController bounded by agents.timeout_ms
 *   6. On success: record_call(ok), increment tokens_used, recordSuccess (close circuit),
 *      append journal kind='response', return result
 *   7. On provider error: record_call(<kind>), recordFailure (may open circuit), return result
 *
 * Never throws to the caller — always returns a structured result the DM/UI can display.
 */

import { Agent, AgentCallStatus } from '../../schema/agent.js';
import { Character, NPC } from '../../schema/character.js';
import { AgentRuntimeDeps } from './deps.js';
import { preflight } from './preflight.js';
import { shouldTripCircuit } from './circuit.js';
import { composePrompt } from '../prompt/compose.js';
import { ProviderError, ChatMessage } from '../provider/types.js';

export interface InvokeInput {
    agentId?: string;
    characterId?: string;
    situation?: string;
    encounterId?: string;
    round?: number;
    systemOverride?: string;
    messagesOverride?: ChatMessage[];
    requestId?: string;
}

export interface InvokeResult {
    callId: string | null;
    agentId: string | null;
    characterId: string | null;
    characterName: string | null;
    response: string;
    status: AgentCallStatus;
    reason?: string;
    promptTokens: number | null;
    completionTokens: number | null;
    durationMs: number | null;
    finishReason?: string;
}

function notFound(reason: string): InvokeResult {
    return {
        callId: null,
        agentId: null,
        characterId: null,
        characterName: null,
        response: '',
        status: 'error',
        reason,
        promptTokens: null,
        completionTokens: null,
        durationMs: null
    };
}

function emptyResult(agent: Agent, character: Character | NPC | null, status: AgentCallStatus, reason: string): InvokeResult {
    return {
        callId: null,
        agentId: agent.id,
        characterId: agent.characterId,
        characterName: character?.name ?? null,
        response: '',
        status,
        reason,
        promptTokens: null,
        completionTokens: null,
        durationMs: null
    };
}

function resolveAgent(deps: AgentRuntimeDeps, input: InvokeInput): Agent | null {
    if (input.agentId) return deps.agentRepo.findById(input.agentId);
    if (input.characterId) return deps.agentRepo.findByCharacterId(input.characterId);
    return null;
}

export async function invokeAgent(input: InvokeInput, deps: AgentRuntimeDeps): Promise<InvokeResult> {
    // 1. Resolve agent + character
    const agent = resolveAgent(deps, input);
    if (!agent) return notFound('agent_not_found');

    const character = deps.characterRepo.findById(agent.characterId);

    // 2. Preflight gates
    const pre = preflight({ agent, character });
    if (pre.skipped) {
        // Persist a call row so health/audit reflects the skip
        const call = deps.agentRepo.recordCall({
            agentId: agent.id,
            requestId: input.requestId ?? null,
            provider: agent.provider,
            model: agent.model,
            messagesJson: '[]',
            status: pre.status,
            errorMessage: pre.reason
        });
        return {
            ...emptyResult(agent, character, pre.status, pre.reason),
            callId: call.id
        };
    }

    // 3. Provider lookup
    let provider;
    try {
        provider = deps.providerFactory.get(agent.provider);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const call = deps.agentRepo.recordCall({
            agentId: agent.id,
            requestId: input.requestId ?? null,
            provider: agent.provider,
            model: agent.model,
            messagesJson: '[]',
            status: 'error',
            errorMessage: message
        });
        return {
            ...emptyResult(agent, character, 'error', message),
            callId: call.id
        };
    }

    // 4. Compose prompt
    const composed = composePrompt(
        {
            agentId: agent.id,
            characterId: agent.characterId,
            situation: input.situation,
            systemOverride: input.systemOverride,
            messagesOverride: input.messagesOverride
        },
        deps
    );

    // 5. Call provider with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), agent.timeoutMs);

    try {
        const result = await provider.call({
            model: agent.model,
            messages: composed.messages,
            temperature: agent.temperature,
            maxTokens: agent.maxTokens,
            signal: controller.signal
        });
        clearTimeout(timeout);

        // 6. Success path
        const call = deps.agentRepo.recordCall({
            agentId: agent.id,
            requestId: input.requestId ?? null,
            provider: agent.provider,
            model: agent.model,
            messagesJson: JSON.stringify(composed.messages),
            rawResponse: result.raw,
            promptTokens: result.promptTokens ?? null,
            completionTokens: result.completionTokens ?? null,
            durationMs: result.durationMs,
            status: 'ok'
        });

        const tokensSpent = (result.promptTokens ?? 0) + (result.completionTokens ?? 0);
        if (tokensSpent > 0) {
            deps.agentRepo.incrementTokensUsed(agent.id, tokensSpent);
        }

        // Close the circuit on success.
        if (agent.consecutiveFailures > 0 || agent.circuitState !== 'closed') {
            deps.agentRepo.recordSuccess(agent.id);
        }

        // Auto-append response to agent journal.
        deps.agentRepo.addJournalEntry({
            agentId: agent.id,
            kind: 'response',
            content: result.text,
            encounterId: input.encounterId ?? null,
            round: input.round ?? null
        });

        return {
            callId: call.id,
            agentId: agent.id,
            characterId: agent.characterId,
            characterName: character?.name ?? null,
            response: result.text,
            status: 'ok',
            promptTokens: result.promptTokens ?? null,
            completionTokens: result.completionTokens ?? null,
            durationMs: result.durationMs,
            finishReason: result.finishReason
        };
    } catch (err) {
        clearTimeout(timeout);

        // 7. Failure path
        const providerErr = err instanceof ProviderError ? err : null;
        const status: AgentCallStatus = providerErr
            ? (providerErr.kind === 'timeout' ? 'timeout'
                : providerErr.kind === 'rate_limited' ? 'rate_limited'
                    : 'error')
            : 'error';
        const message = err instanceof Error ? err.message : String(err);

        const call = deps.agentRepo.recordCall({
            agentId: agent.id,
            requestId: input.requestId ?? null,
            provider: agent.provider,
            model: agent.model,
            messagesJson: JSON.stringify(composed.messages),
            rawResponse: providerErr?.raw ?? null,
            durationMs: null,
            status,
            errorMessage: message
        });

        if (shouldTripCircuit(err)) {
            deps.agentRepo.recordFailure(agent.id);
        }

        return {
            callId: call.id,
            agentId: agent.id,
            characterId: agent.characterId,
            characterName: character?.name ?? null,
            response: '',
            status,
            reason: message,
            promptTokens: null,
            completionTokens: null,
            durationMs: null
        };
    }
}
