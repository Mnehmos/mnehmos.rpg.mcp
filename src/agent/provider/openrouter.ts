/**
 * OpenRouter provider.
 *
 * OpenRouter speaks the OpenAI Chat Completions wire format with one extra
 * convention: it expects `HTTP-Referer` and `X-Title` headers so the model
 * provider can attribute usage. Otherwise the request/response shape is identical.
 */

import {
    LLMProvider,
    ProviderCallOpts,
    ProviderCallResult,
    ProviderError,
    classifyFetchError,
    classifyHttpStatus
} from './types.js';
import { isReasoningModel } from './reasoning.js';

const DEFAULT_BASE = 'https://openrouter.ai/api/v1';

export interface OpenRouterProviderConfig {
    apiKey: string;
    baseUrl?: string;
    referer?: string;
    title?: string;
    /** Allow tests to inject a custom fetch implementation. */
    fetchImpl?: typeof fetch;
}

interface OpenRouterChatResponse {
    choices?: Array<{
        message?: { content?: string | null };
        finish_reason?: string;
    }>;
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        completion_tokens_details?: { reasoning_tokens?: number };
        cost?: number;
        cost_details?: { upstream_inference_cost?: number };
    };
    error?: { message?: string; code?: number };
}

export class OpenRouterProvider implements LLMProvider {
    readonly name = 'openrouter' as const;
    private readonly apiKey: string;
    private readonly baseUrl: string;
    private readonly referer?: string;
    private readonly title?: string;
    private readonly fetchImpl: typeof fetch;

    constructor(config: OpenRouterProviderConfig) {
        if (!config.apiKey) {
            throw new Error('OpenRouterProvider requires apiKey');
        }
        this.apiKey = config.apiKey;
        this.baseUrl = (config.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
        this.referer = config.referer;
        this.title = config.title;
        this.fetchImpl = config.fetchImpl ?? fetch;
    }

    async call(opts: ProviderCallOpts): Promise<ProviderCallResult> {
        const start = Date.now();
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
        };
        if (this.referer) headers['HTTP-Referer'] = this.referer;
        if (this.title) headers['X-Title'] = this.title;

        const reasoningModel = isReasoningModel(opts.model);
        const body: Record<string, unknown> = {
            model: opts.model,
            messages: opts.messages
        };
        if (opts.maxTokens !== undefined) {
            body[reasoningModel ? 'max_completion_tokens' : 'max_tokens'] = opts.maxTokens;
        }
        if (opts.temperature !== undefined && !reasoningModel) {
            body.temperature = opts.temperature;
        }
        if (opts.reasoningEffort !== undefined && opts.reasoningEffort !== null && reasoningModel) {
            body.reasoning_effort = opts.reasoningEffort;
        }

        let response: Response;
        try {
            response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: opts.signal
            });
        } catch (err) {
            throw classifyFetchError(err);
        }

        const rawText = await response.text();
        const durationMs = Date.now() - start;

        if (!response.ok) {
            throw classifyHttpStatus(response.status, rawText);
        }

        let parsed: OpenRouterChatResponse;
        try {
            parsed = JSON.parse(rawText);
        } catch (err) {
            throw new ProviderError(`Malformed JSON response: ${(err as Error).message}`, 'malformed', response.status, rawText);
        }

        if (parsed.error) {
            throw new ProviderError(parsed.error.message ?? 'Unknown provider error', 'server', response.status, rawText);
        }

        const choice = parsed.choices?.[0];
        const text = choice?.message?.content ?? '';
        if (!text) {
            if (choice?.finish_reason === 'length') {
                const budget = body.max_completion_tokens ?? body.max_tokens;
                throw new ProviderError(
                    `Provider returned empty content with finish_reason="length": the completion budget (${budget}) was exhausted before any text was produced` +
                    (reasoningModel ? ', consumed by reasoning tokens. Raise agent.maxTokens.' : '. Raise agent.maxTokens.'),
                    'malformed', response.status, rawText
                );
            }
            throw new ProviderError('Provider returned empty message content', 'malformed', response.status, rawText);
        }

        return {
            text,
            promptTokens: parsed.usage?.prompt_tokens,
            completionTokens: parsed.usage?.completion_tokens,
            totalTokens: parsed.usage?.total_tokens,
            reasoningTokens: parsed.usage?.completion_tokens_details?.reasoning_tokens,
            ...(typeof parsed.usage?.cost === 'number'
                ? { costUsd: parsed.usage.cost, costSource: 'provider' as const }
                : typeof parsed.usage?.cost_details?.upstream_inference_cost === 'number'
                    ? { costUsd: parsed.usage.cost_details.upstream_inference_cost, costSource: 'provider_upstream' as const }
                    : {}),
            raw: rawText,
            durationMs,
            finishReason: choice?.finish_reason
        };
    }
}
