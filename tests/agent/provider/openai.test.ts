import { OpenAIProvider, isReasoningModel } from '../../../src/agent/provider/openai.js';
import { ProviderError } from '../../../src/agent/provider/types.js';

/**
 * Build a fetch mock that returns a fixed Response.
 * Captures the last request for assertions.
 */
function mockFetch(opts: {
    status?: number;
    body: string;
    headers?: Record<string, string>;
}): { fn: typeof fetch; lastRequest: { url?: string; init?: RequestInit } } {
    const captured: { url?: string; init?: RequestInit } = {};
    const fn: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        captured.url = typeof input === 'string' ? input : input.toString();
        captured.init = init;
        return new Response(opts.body, {
            status: opts.status ?? 200,
            headers: opts.headers ?? { 'Content-Type': 'application/json' }
        });
    };
    return { fn, lastRequest: captured };
}

describe('OpenAIProvider', () => {
    it('returns parsed assistant text with token usage', async () => {
        const mock = mockFetch({
            body: JSON.stringify({
                choices: [{
                    message: { content: 'Hello, world.' },
                    finish_reason: 'stop'
                }],
                usage: { prompt_tokens: 12, completion_tokens: 4 }
            })
        });

        const provider = new OpenAIProvider({ apiKey: 'test-key', fetchImpl: mock.fn });
        const result = await provider.call({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: 'Hi' }],
            temperature: 0.7,
            maxTokens: 200
        });

        expect(result.text).toBe('Hello, world.');
        expect(result.promptTokens).toBe(12);
        expect(result.completionTokens).toBe(4);
        expect(result.finishReason).toBe('stop');
        expect(result.raw.length).toBeGreaterThan(0);
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('sends the expected request shape', async () => {
        const mock = mockFetch({
            body: JSON.stringify({ choices: [{ message: { content: 'x' } }] })
        });

        const provider = new OpenAIProvider({ apiKey: 'sk-abc', fetchImpl: mock.fn });
        await provider.call({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: 'You are Kara.' },
                { role: 'user', content: 'Your turn.' }
            ],
            temperature: 0.3,
            maxTokens: 500
        });

        expect(mock.lastRequest.url).toContain('/chat/completions');
        expect(mock.lastRequest.init?.method).toBe('POST');

        const headers = mock.lastRequest.init?.headers as Record<string, string>;
        expect(headers['Authorization']).toBe('Bearer sk-abc');
        expect(headers['Content-Type']).toBe('application/json');

        const body = JSON.parse(mock.lastRequest.init?.body as string);
        expect(body.model).toBe('gpt-4o');
        expect(body.temperature).toBe(0.3);
        expect(body.max_tokens).toBe(500);
        expect(body.max_completion_tokens).toBeUndefined();
        expect(body.messages.length).toBe(2);
    });

    describe('reasoning/GPT-5 model parameter shape (regression for HTTP 400 max_tokens)', () => {
        it.each(['gpt-5', 'gpt-5-mini', 'gpt-5-turbo', 'o1', 'o1-mini', 'o3', 'o3-mini', 'o4-mini'])(
            'uses max_completion_tokens (not max_tokens) for model "%s"',
            async (model) => {
                const mock = mockFetch({
                    body: JSON.stringify({ choices: [{ message: { content: 'x' } }] })
                });
                const provider = new OpenAIProvider({ apiKey: 'sk', fetchImpl: mock.fn });

                await provider.call({
                    model,
                    messages: [{ role: 'user', content: 'hi' }],
                    temperature: 0.7,
                    maxTokens: 200
                });

                const body = JSON.parse(mock.lastRequest.init?.body as string);
                expect(body.max_completion_tokens, `${model} should use max_completion_tokens`).toBe(200);
                expect(body.max_tokens, `${model} must NOT send max_tokens`).toBeUndefined();
            }
        );

        it.each(['gpt-5', 'o1', 'o3-mini'])(
            'omits temperature on reasoning model "%s" (only default is allowed)',
            async (model) => {
                const mock = mockFetch({
                    body: JSON.stringify({ choices: [{ message: { content: 'x' } }] })
                });
                const provider = new OpenAIProvider({ apiKey: 'sk', fetchImpl: mock.fn });

                await provider.call({
                    model,
                    messages: [{ role: 'user', content: 'hi' }],
                    temperature: 0.7
                });

                const body = JSON.parse(mock.lastRequest.init?.body as string);
                expect(body.temperature).toBeUndefined();
            }
        );

        it.each(['gpt-4', 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'])(
            'keeps max_tokens + temperature for legacy model "%s"',
            async (model) => {
                const mock = mockFetch({
                    body: JSON.stringify({ choices: [{ message: { content: 'x' } }] })
                });
                const provider = new OpenAIProvider({ apiKey: 'sk', fetchImpl: mock.fn });

                await provider.call({
                    model,
                    messages: [{ role: 'user', content: 'hi' }],
                    temperature: 0.5,
                    maxTokens: 300
                });

                const body = JSON.parse(mock.lastRequest.init?.body as string);
                expect(body.max_tokens).toBe(300);
                expect(body.temperature).toBe(0.5);
                expect(body.max_completion_tokens).toBeUndefined();
            }
        );

        it('omits both fields when caller doesn\'t set them', async () => {
            const mock = mockFetch({
                body: JSON.stringify({ choices: [{ message: { content: 'x' } }] })
            });
            const provider = new OpenAIProvider({ apiKey: 'sk', fetchImpl: mock.fn });

            await provider.call({
                model: 'gpt-5',
                messages: [{ role: 'user', content: 'hi' }]
            });

            const body = JSON.parse(mock.lastRequest.init?.body as string);
            expect(body.max_tokens).toBeUndefined();
            expect(body.max_completion_tokens).toBeUndefined();
            expect(body.temperature).toBeUndefined();
        });
    });

    describe('isReasoningModel', () => {
        it.each(['o1', 'o1-mini', 'o3', 'o3-mini', 'o4-mini', 'gpt-5', 'gpt-5-mini', 'gpt-5-turbo'])(
            '"%s" → true',
            (m) => expect(isReasoningModel(m)).toBe(true)
        );

        it.each(['gpt-4', 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'chatgpt-4o-latest'])(
            '"%s" → false',
            (m) => expect(isReasoningModel(m)).toBe(false)
        );

        it('is case-insensitive', () => {
            expect(isReasoningModel('GPT-5')).toBe(true);
            expect(isReasoningModel('O1-Mini')).toBe(true);
        });
    });

    it('passes organization header when configured', async () => {
        const mock = mockFetch({
            body: JSON.stringify({ choices: [{ message: { content: 'x' } }] })
        });

        const provider = new OpenAIProvider({
            apiKey: 'sk-abc',
            organization: 'org-xyz',
            fetchImpl: mock.fn
        });
        await provider.call({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] });

        const headers = mock.lastRequest.init?.headers as Record<string, string>;
        expect(headers['OpenAI-Organization']).toBe('org-xyz');
    });

    it('uses custom baseUrl when configured', async () => {
        const mock = mockFetch({
            body: JSON.stringify({ choices: [{ message: { content: 'x' } }] })
        });

        const provider = new OpenAIProvider({
            apiKey: 'sk',
            baseUrl: 'https://my-proxy.example/v1/',
            fetchImpl: mock.fn
        });
        await provider.call({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] });

        expect(mock.lastRequest.url).toBe('https://my-proxy.example/v1/chat/completions');
    });

    it('throws auth error for 401', async () => {
        const mock = mockFetch({ status: 401, body: '{"error":"unauthorized"}' });
        const provider = new OpenAIProvider({ apiKey: 'bad', fetchImpl: mock.fn });

        await expect(provider.call({
            model: 'gpt-4o',
            messages: [{ role: 'user', content: 'hi' }]
        })).rejects.toMatchObject({ kind: 'auth', status: 401 });
    });

    it('throws rate_limited error for 429', async () => {
        const mock = mockFetch({ status: 429, body: '{"error":"too many requests"}' });
        const provider = new OpenAIProvider({ apiKey: 'k', fetchImpl: mock.fn });

        try {
            await provider.call({ model: 'gpt-4o', messages: [{ role: 'user', content: 'x' }] });
            throw new Error('should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(ProviderError);
            expect((err as ProviderError).kind).toBe('rate_limited');
        }
    });

    it('throws server error for 500', async () => {
        const mock = mockFetch({ status: 500, body: 'oops' });
        const provider = new OpenAIProvider({ apiKey: 'k', fetchImpl: mock.fn });

        try {
            await provider.call({ model: 'gpt-4o', messages: [{ role: 'user', content: 'x' }] });
            throw new Error('should have thrown');
        } catch (err) {
            expect((err as ProviderError).kind).toBe('server');
            expect((err as ProviderError).status).toBe(500);
        }
    });

    it('throws malformed for non-JSON 200 body', async () => {
        const mock = mockFetch({ body: 'not json at all' });
        const provider = new OpenAIProvider({ apiKey: 'k', fetchImpl: mock.fn });

        try {
            await provider.call({ model: 'gpt-4o', messages: [{ role: 'user', content: 'x' }] });
            throw new Error('should have thrown');
        } catch (err) {
            expect((err as ProviderError).kind).toBe('malformed');
        }
    });

    it('throws malformed for missing message content', async () => {
        const mock = mockFetch({
            body: JSON.stringify({ choices: [{ message: { content: null } }] })
        });
        const provider = new OpenAIProvider({ apiKey: 'k', fetchImpl: mock.fn });

        try {
            await provider.call({ model: 'gpt-4o', messages: [{ role: 'user', content: 'x' }] });
            throw new Error('should have thrown');
        } catch (err) {
            expect((err as ProviderError).kind).toBe('malformed');
        }
    });

    it('classifies AbortError as timeout', async () => {
        const fn: typeof fetch = async (_input, init) => {
            // simulate fetch aborting due to AbortSignal
            return new Promise((_resolve, reject) => {
                const signal = init?.signal;
                if (signal?.aborted) {
                    const e = new Error('aborted');
                    e.name = 'AbortError';
                    reject(e);
                } else {
                    signal?.addEventListener('abort', () => {
                        const e = new Error('aborted');
                        e.name = 'AbortError';
                        reject(e);
                    });
                }
            });
        };

        const provider = new OpenAIProvider({ apiKey: 'k', fetchImpl: fn });
        const controller = new AbortController();
        const pending = provider.call({
            model: 'gpt-4o',
            messages: [{ role: 'user', content: 'x' }],
            signal: controller.signal
        });
        controller.abort();

        try {
            await pending;
            throw new Error('should have thrown');
        } catch (err) {
            expect((err as ProviderError).kind).toBe('timeout');
        }
    });

    it('throws ProviderError when error field is present in 200 body', async () => {
        const mock = mockFetch({
            body: JSON.stringify({ error: { message: 'model_not_found', type: 'invalid_request' } })
        });
        const provider = new OpenAIProvider({ apiKey: 'k', fetchImpl: mock.fn });

        try {
            await provider.call({ model: 'gpt-4o', messages: [{ role: 'user', content: 'x' }] });
            throw new Error('should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(ProviderError);
            expect((err as ProviderError).message).toContain('model_not_found');
        }
    });

    it('refuses construction without apiKey', () => {
        expect(() => new OpenAIProvider({ apiKey: '' })).toThrow(/apiKey/);
    });
});
