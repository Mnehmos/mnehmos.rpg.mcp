/**
 * LLM provider interface for the agent runtime.
 *
 * Implementations: OpenAI Chat Completions, OpenRouter (same shape, different base URL).
 * Plain-text responses only — no structured-output / JSON schema enforcement.
 */

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
    role: ChatRole;
    content: string;
}

export interface ProviderCallOpts {
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    maxTokens?: number;
    /** AbortSignal — runtime sets this from agents.timeout_ms */
    signal?: AbortSignal;
}

export interface ProviderCallResult {
    /** The assistant's reply text. */
    text: string;
    /** Tokens charged by the provider (prompt). May be undefined for some providers. */
    promptTokens?: number;
    /** Tokens charged by the provider (completion). May be undefined for some providers. */
    completionTokens?: number;
    /** Raw response body as a string (for replay/debug). */
    raw: string;
    /** Wall-clock duration of the request, milliseconds. */
    durationMs: number;
    /** finish_reason from provider (stop / length / content_filter / etc). */
    finishReason?: string;
}

export class ProviderError extends Error {
    constructor(
        message: string,
        public readonly kind: 'timeout' | 'rate_limited' | 'auth' | 'network' | 'malformed' | 'server' | 'unknown',
        public readonly status?: number,
        public readonly raw?: string
    ) {
        super(message);
        this.name = 'ProviderError';
    }
}

export interface LLMProvider {
    readonly name: 'openai' | 'openrouter';
    call(opts: ProviderCallOpts): Promise<ProviderCallResult>;
}

/**
 * Classify a fetch / HTTP failure into a ProviderError kind.
 * Shared by both OpenAI and OpenRouter implementations.
 */
export function classifyFetchError(err: unknown): ProviderError {
    if (err instanceof ProviderError) return err;
    if (err instanceof Error) {
        const msg = err.message.toLowerCase();
        if (err.name === 'AbortError' || msg.includes('aborted') || msg.includes('timeout')) {
            return new ProviderError(err.message, 'timeout');
        }
        if (msg.includes('econnreset') || msg.includes('enotfound') || msg.includes('econnrefused') || msg.includes('network')) {
            return new ProviderError(err.message, 'network');
        }
        return new ProviderError(err.message, 'unknown');
    }
    return new ProviderError(String(err), 'unknown');
}

/**
 * Classify an HTTP status code into a ProviderError kind.
 */
export function classifyHttpStatus(status: number, body: string): ProviderError {
    if (status === 401 || status === 403) {
        return new ProviderError(`Auth failed (${status}): ${body.slice(0, 200)}`, 'auth', status, body);
    }
    if (status === 429) {
        return new ProviderError(`Rate limited (${status}): ${body.slice(0, 200)}`, 'rate_limited', status, body);
    }
    if (status >= 500) {
        return new ProviderError(`Server error (${status}): ${body.slice(0, 200)}`, 'server', status, body);
    }
    return new ProviderError(`HTTP ${status}: ${body.slice(0, 200)}`, 'unknown', status, body);
}
