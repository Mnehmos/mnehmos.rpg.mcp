/**
 * Provider factory.
 *
 * Reads credentials from environment variables, instantiates providers,
 * and selects by name. Single source of truth for provider configuration.
 */

import { LLMProvider } from './types.js';
import { OpenAIProvider } from './openai.js';
import { OpenRouterProvider } from './openrouter.js';

export type ProviderName = 'openai' | 'openrouter';

export interface ProviderFactoryConfig {
    /** OpenAI API key. Read from OPENAI_API_KEY if omitted. */
    openaiApiKey?: string;
    openaiBaseUrl?: string;
    openaiOrganization?: string;
    /** OpenRouter API key. Read from OPENROUTER_API_KEY if omitted. */
    openrouterApiKey?: string;
    openrouterBaseUrl?: string;
    /** Site URL OpenRouter uses for attribution. Read from OPENROUTER_REFERER if omitted. */
    openrouterReferer?: string;
    /** App title OpenRouter uses for attribution. Read from OPENROUTER_TITLE if omitted. */
    openrouterTitle?: string;
    /** Allow tests to inject a fetch impl into both providers. */
    fetchImpl?: typeof fetch;
}

export class ProviderFactory {
    private readonly providers: Map<ProviderName, LLMProvider> = new Map();
    private readonly config: ProviderFactoryConfig;

    constructor(config: ProviderFactoryConfig = {}) {
        this.config = config;
    }

    /**
     * Eagerly instantiate every provider that has credentials available.
     * Returns the list of provider names that were successfully configured.
     * Providers without keys are silently skipped — they'll throw clearly
     * if anyone tries to use them later.
     */
    initialize(): ProviderName[] {
        const openaiKey = this.config.openaiApiKey ?? process.env.OPENAI_API_KEY;
        if (openaiKey) {
            this.providers.set('openai', new OpenAIProvider({
                apiKey: openaiKey,
                baseUrl: this.config.openaiBaseUrl,
                organization: this.config.openaiOrganization,
                fetchImpl: this.config.fetchImpl
            }));
        }

        const openrouterKey = this.config.openrouterApiKey ?? process.env.OPENROUTER_API_KEY;
        if (openrouterKey) {
            this.providers.set('openrouter', new OpenRouterProvider({
                apiKey: openrouterKey,
                baseUrl: this.config.openrouterBaseUrl,
                referer: this.config.openrouterReferer ?? process.env.OPENROUTER_REFERER,
                title: this.config.openrouterTitle ?? process.env.OPENROUTER_TITLE,
                fetchImpl: this.config.fetchImpl
            }));
        }

        return Array.from(this.providers.keys());
    }

    /**
     * Return the configured provider, throwing a clear error if it isn't available.
     * Use this at agent_manage.create time to fail fast.
     */
    get(name: ProviderName): LLMProvider {
        const provider = this.providers.get(name);
        if (!provider) {
            throw new Error(
                `Provider '${name}' is not configured. ` +
                `Set ${name === 'openai' ? 'OPENAI_API_KEY' : 'OPENROUTER_API_KEY'} in the environment ` +
                `(or pass ${name === 'openai' ? 'openaiApiKey' : 'openrouterApiKey'} to ProviderFactory).`
            );
        }
        return provider;
    }

    /** Non-throwing variant — useful for health checks / readiness probes. */
    tryGet(name: ProviderName): LLMProvider | null {
        return this.providers.get(name) ?? null;
    }

    available(): ProviderName[] {
        return Array.from(this.providers.keys());
    }

    /** Register a pre-built provider (test fixtures, custom implementations). */
    register(name: ProviderName, provider: LLMProvider): void {
        this.providers.set(name, provider);
    }
}

// ─────────────────────────────────────────────────────────────────────────
// MODULE-LEVEL DEFAULT (mirrors setCombatPubSub pattern)
// Wire-up happens once at server startup in src/server/index.ts
// ─────────────────────────────────────────────────────────────────────────

let defaultFactory: ProviderFactory | null = null;

export function setProviderFactory(factory: ProviderFactory): void {
    defaultFactory = factory;
}

export function getProviderFactory(): ProviderFactory | null {
    return defaultFactory;
}

/** Reset (test cleanup). */
export function clearProviderFactory(): void {
    defaultFactory = null;
}
