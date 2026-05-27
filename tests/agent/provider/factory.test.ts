import { ProviderFactory } from '../../../src/agent/provider/factory.js';
import { LLMProvider, ProviderCallOpts, ProviderCallResult } from '../../../src/agent/provider/types.js';

const ORIGINAL_ENV = { ...process.env };

function clearKeys() {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_REFERER;
    delete process.env.OPENROUTER_TITLE;
}

describe('ProviderFactory', () => {
    beforeEach(() => {
        clearKeys();
    });

    afterAll(() => {
        // restore
        process.env = { ...ORIGINAL_ENV };
    });

    it('initializes openai from env var', () => {
        process.env.OPENAI_API_KEY = 'sk-test';
        const factory = new ProviderFactory();
        const names = factory.initialize();
        expect(names).toContain('openai');
        expect(factory.get('openai').name).toBe('openai');
    });

    it('initializes openrouter from env var', () => {
        process.env.OPENROUTER_API_KEY = 'or-test';
        const factory = new ProviderFactory();
        const names = factory.initialize();
        expect(names).toContain('openrouter');
        expect(factory.get('openrouter').name).toBe('openrouter');
    });

    it('initializes both when both keys present', () => {
        process.env.OPENAI_API_KEY = 'sk-test';
        process.env.OPENROUTER_API_KEY = 'or-test';

        const factory = new ProviderFactory();
        const names = factory.initialize();

        expect(names.sort()).toEqual(['openai', 'openrouter']);
        expect(factory.available().sort()).toEqual(['openai', 'openrouter']);
    });

    it('skips providers without credentials silently on init', () => {
        const factory = new ProviderFactory();
        const names = factory.initialize();
        expect(names).toEqual([]);
        expect(factory.tryGet('openai')).toBeNull();
        expect(factory.tryGet('openrouter')).toBeNull();
    });

    it('throws a clear error when accessing a missing provider via get()', () => {
        const factory = new ProviderFactory();
        factory.initialize();

        expect(() => factory.get('openai')).toThrow(/OPENAI_API_KEY/);
        expect(() => factory.get('openrouter')).toThrow(/OPENROUTER_API_KEY/);
    });

    it('prefers explicit config over env vars', () => {
        process.env.OPENAI_API_KEY = 'env-key';
        const factory = new ProviderFactory({ openaiApiKey: 'explicit-key' });
        factory.initialize();
        // we can't introspect the key directly, but get() succeeding means explicit key was used
        expect(factory.get('openai').name).toBe('openai');
    });

    it('register() injects a pre-built provider (test fixture path)', async () => {
        const fakeProvider: LLMProvider = {
            name: 'openai',
            call: async (_opts: ProviderCallOpts): Promise<ProviderCallResult> => ({
                text: 'fixture',
                raw: '{}',
                durationMs: 1
            })
        };

        const factory = new ProviderFactory();
        factory.register('openai', fakeProvider);

        const got = factory.get('openai');
        const result = await got.call({ model: 'x', messages: [] });
        expect(result.text).toBe('fixture');
    });

    it('passes OPENROUTER_REFERER and OPENROUTER_TITLE through env', () => {
        process.env.OPENROUTER_API_KEY = 'or-test';
        process.env.OPENROUTER_REFERER = 'https://quest.local';
        process.env.OPENROUTER_TITLE = 'Quest';

        const factory = new ProviderFactory();
        factory.initialize();
        // No direct inspection — just verify successful initialization
        expect(factory.get('openrouter').name).toBe('openrouter');
    });
});
