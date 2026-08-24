import { OpenRouterProvider } from '../../../src/agent/provider/openrouter.js';
import { ProviderError } from '../../../src/agent/provider/types.js';
import { REASONING_COMPLETION_FLOOR } from '../../../src/agent/provider/reasoning.js';

function mockFetch(opts: { status?: number; body: string }): {
    fn: typeof fetch;
    lastRequest: { url?: string; init?: RequestInit };
} {
    const captured: { url?: string; init?: RequestInit } = {};
    const fn: typeof fetch = async (input, init) => {
        captured.url = typeof input === 'string' ? input : input.toString();
        captured.init = init;
        return new Response(opts.body, {
            status: opts.status ?? 200,
            headers: { 'Content-Type': 'application/json' }
        });
    };
    return { fn, lastRequest: captured };
}

describe('OpenRouterProvider', () => {
    it('returns parsed assistant text', async () => {
        const mock = mockFetch({
            body: JSON.stringify({
                choices: [{ message: { content: 'I attack the orc.' }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 200, completion_tokens: 80 }
            })
        });

        const provider = new OpenRouterProvider({
            apiKey: 'or-test',
            referer: 'https://questkeeper.local',
            title: 'Quest Keeper AI',
            fetchImpl: mock.fn
        });

        const result = await provider.call({
            model: 'anthropic/claude-sonnet-4-5',
            messages: [{ role: 'user', content: "It's your turn." }]
        });

        expect(result.text).toBe('I attack the orc.');
        expect(result.promptTokens).toBe(200);
        expect(result.completionTokens).toBe(80);
    });

    it('preserves provider total, reasoning, and dollar cost metadata', async () => {
        const mock = mockFetch({
            body: JSON.stringify({
                id: 'gen-usage-1',
                choices: [{ message: { content: 'The guard nods.' }, finish_reason: 'stop' }],
                usage: {
                    prompt_tokens: 44,
                    completion_tokens: 12,
                    total_tokens: 56,
                    completion_tokens_details: { reasoning_tokens: 3 },
                    cost: 0.000456
                }
            })
        });
        const provider = new OpenRouterProvider({ apiKey: 'or-test', fetchImpl: mock.fn });

        const result = await provider.call({
            model: 'openai/gpt-5.6-luna',
            messages: [{ role: 'user', content: 'Greet the guard.' }],
            maxTokens: 100,
            reasoningEffort: 'medium'
        });

        expect(result.totalTokens).toBe(56);
        expect(result.reasoningTokens).toBe(3);
        expect(result.costUsd).toBe(0.000456);
        expect(result.costSource).toBe('provider');
    });

    it('sends attribution headers when configured', async () => {
        const mock = mockFetch({
            body: JSON.stringify({ choices: [{ message: { content: 'x' } }] })
        });

        const provider = new OpenRouterProvider({
            apiKey: 'or-test',
            referer: 'https://questkeeper.local',
            title: 'Quest Keeper AI',
            fetchImpl: mock.fn
        });
        await provider.call({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });

        const headers = mock.lastRequest.init?.headers as Record<string, string>;
        expect(headers['HTTP-Referer']).toBe('https://questkeeper.local');
        expect(headers['X-Title']).toBe('Quest Keeper AI');
        expect(headers['Authorization']).toBe('Bearer or-test');
    });

    it('omits attribution headers when not provided', async () => {
        const mock = mockFetch({
            body: JSON.stringify({ choices: [{ message: { content: 'x' } }] })
        });

        const provider = new OpenRouterProvider({ apiKey: 'or-test', fetchImpl: mock.fn });
        await provider.call({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });

        const headers = mock.lastRequest.init?.headers as Record<string, string>;
        expect(headers['HTTP-Referer']).toBeUndefined();
        expect(headers['X-Title']).toBeUndefined();
    });

    it('uses the OpenRouter base URL by default', async () => {
        const mock = mockFetch({
            body: JSON.stringify({ choices: [{ message: { content: 'x' } }] })
        });
        const provider = new OpenRouterProvider({ apiKey: 'or-test', fetchImpl: mock.fn });
        await provider.call({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });

        expect(mock.lastRequest.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    });

    it('uses reasoning parameters without raising the caller completion cap for namespaced GPT-5 models', async () => {
        const mock = mockFetch({
            body: JSON.stringify({ choices: [{ message: { content: 'x' } }] })
        });
        const provider = new OpenRouterProvider({ apiKey: 'or-test', fetchImpl: mock.fn });

        await provider.call({
            model: 'openai/gpt-5.6-luna',
            messages: [{ role: 'user', content: 'hi' }],
            temperature: 0.7,
            maxTokens: 300,
            reasoningEffort: 'medium'
        });

        const body = JSON.parse(mock.lastRequest.init?.body as string);
        expect(body.max_completion_tokens).toBe(300);
        expect(body.max_tokens).toBeUndefined();
        expect(body.temperature).toBeUndefined();
        expect(body.reasoning_effort).toBe('medium');
    });

    it('explains an empty reasoning response caused by a completion ceiling', async () => {
        const mock = mockFetch({
            body: JSON.stringify({ choices: [{ message: { content: '' }, finish_reason: 'length' }] })
        });
        const provider = new OpenRouterProvider({ apiKey: 'or-test', fetchImpl: mock.fn });

        await expect(provider.call({
            model: 'openai/gpt-5.6-luna',
            messages: [{ role: 'user', content: 'hi' }],
            maxTokens: 300,
            reasoningEffort: 'medium'
        })).rejects.toThrow(/reasoning tokens[\s\S]*Raise agent\.maxTokens/);
    });

    it('propagates 429 as rate_limited', async () => {
        const mock = mockFetch({ status: 429, body: 'busy' });
        const provider = new OpenRouterProvider({ apiKey: 'or', fetchImpl: mock.fn });

        try {
            await provider.call({ model: 'm', messages: [{ role: 'user', content: 'x' }] });
            throw new Error('should have thrown');
        } catch (err) {
            expect((err as ProviderError).kind).toBe('rate_limited');
        }
    });

    it('propagates 200 body with error field as server error', async () => {
        const mock = mockFetch({
            body: JSON.stringify({ error: { message: 'model_unavailable', code: 503 } })
        });
        const provider = new OpenRouterProvider({ apiKey: 'or', fetchImpl: mock.fn });

        try {
            await provider.call({ model: 'm', messages: [{ role: 'user', content: 'x' }] });
            throw new Error('should have thrown');
        } catch (err) {
            expect((err as ProviderError).kind).toBe('server');
            expect((err as ProviderError).message).toContain('model_unavailable');
        }
    });

    it('refuses construction without apiKey', () => {
        expect(() => new OpenRouterProvider({ apiKey: '' })).toThrow(/apiKey/);
    });
});
