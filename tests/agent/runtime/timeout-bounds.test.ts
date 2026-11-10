import { describe, it, expect } from 'vitest';
import { AgentCreateInputSchema, AgentUpdateInputSchema, MAX_AGENT_TIMEOUT_MS, effectiveTimeoutMs } from '../../../src/schema/agent';

/**
 * An agent's provider call runs inside its campaign's unit of work, which
 * holds the campaign's lock and an open write transaction. The timeout is the
 * only thing bounding that, so it cannot be arbitrarily large.
 */
describe('agent timeout bounds', () => {
    const base = { characterId: 'c1', provider: 'openai', model: 'gpt-4o-mini' };

    it('rejects a timeout above the maximum on create and update', () => {
        expect(AgentCreateInputSchema.safeParse({ ...base, timeoutMs: MAX_AGENT_TIMEOUT_MS + 1 }).success).toBe(false);
        expect(AgentUpdateInputSchema.safeParse({ timeoutMs: 3_600_000 }).success).toBe(false);
    });

    it('accepts timeouts up to the maximum', () => {
        expect(AgentCreateInputSchema.safeParse({ ...base, timeoutMs: MAX_AGENT_TIMEOUT_MS }).success).toBe(true);
        expect(AgentCreateInputSchema.safeParse({ ...base, timeoutMs: 25_000 }).success).toBe(true);
    });

    it('clamps a stored timeout that predates the limit', () => {
        expect(effectiveTimeoutMs(3_600_000)).toBe(MAX_AGENT_TIMEOUT_MS);
        expect(effectiveTimeoutMs(25_000)).toBe(25_000);
    });
});
