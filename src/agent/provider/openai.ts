/**
 * OpenAI Chat Completions provider.
 *
 * Plain text responses (no response_format / JSON schema enforcement).
 * Uses native fetch (Node 20+).
 */

import {
    LLMProvider,
    ProviderCallOpts,
    ProviderCallResult,
    ProviderError,
    classifyFetchError,
    classifyHttpStatus
} from './types.js';

const DEFAULT_BASE = 'https://api.openai.com/v1';

export interface OpenAIProviderConfig {
    apiKey: string;
    baseUrl?: string;
    organization?: string;
    /** Allow tests to inject a custom fetch implementation. */
    fetchImpl?: typeof fetch;
}

interface OpenAIChatResponse {
    choices?: Array<{
        message?: { content?: string | null };
        finish_reason?: string;
    }>;
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
    };
    error?: { message?: string; type?: string };
}

/**
 * OpenAI's reasoning models (o1, o3, gpt-5 family) reject `max_tokens` —
 * they require `max_completion_tokens` instead, because the old name was
 * misleading once reasoning tokens entered the picture. They also reject
 * any non-default temperature value.
 *
 * Detect by model-name prefix. If OpenAI adds a new reasoning family in the
 * future, add the prefix here. Exported for testing.
 */
export function isReasoningModel(model: string): boolean {
    const m = model.toLowerCase();
    return m.startsWith('o1')
        || m.startsWith('o3')
        || m.startsWith('o4')
        || m.startsWith('gpt-5');
}

export class OpenAIProvider implements LLMProvider {
    readonly name = 'openai' as const;
    private readonly apiKey: string;
    private readonly baseUrl: string;
    private readonly organization?: string;
    private readonly fetchImpl: typeof fetch;

    constructor(config: OpenAIProviderConfig) {
        if (!config.apiKey) {
            throw new Error('OpenAIProvider requires apiKey');
        }
        this.apiKey = config.apiKey;
        this.baseUrl = (config.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
        this.organization = config.organization;
        this.fetchImpl = config.fetchImpl ?? fetch;
    }

    async call(opts: ProviderCallOpts): Promise<ProviderCallResult> {
        const start = Date.now();
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
        };
        if (this.organization) headers['OpenAI-Organization'] = this.organization;

        // OpenAI's reasoning/GPT-5 family rejects `max_tokens` and only accepts
        // `max_completion_tokens`. They also reject any custom temperature
        // (only default 1 is allowed). Detect and switch parameter shape.
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

        let parsed: OpenAIChatResponse;
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
            throw new ProviderError('Provider returned empty message content', 'malformed', response.status, rawText);
        }

        return {
            text,
            promptTokens: parsed.usage?.prompt_tokens,
            completionTokens: parsed.usage?.completion_tokens,
            raw: rawText,
            durationMs,
            finishReason: choice?.finish_reason
        };
    }
}
