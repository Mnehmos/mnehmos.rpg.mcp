/**
 * Circuit breaker helpers.
 *
 * The repo owns the state mutation; this module classifies errors into
 * "should-trip-the-breaker" vs "leave-it-alone" decisions.
 */

import { ProviderError } from '../provider/types.js';

/**
 * Which provider error kinds should count toward the consecutive-failure budget.
 * Auth errors don't auto-pause — the key is bad, no amount of retry helps;
 * the DM should fix it explicitly.
 * Network/timeout/server errors DO count — they're the kind that recover.
 */
export function shouldTripCircuit(err: unknown): boolean {
    if (!(err instanceof ProviderError)) return true; // unknown -> count it
    // An empty response is a bounded provider/content failure, not evidence
    // that the NPC is persistently unavailable. Keep the agent invokable so a
    // later turn or an explicit retry can recover without recreating it.
    if (err.kind === 'malformed' && /empty (?:message )?content/i.test(err.message)) return false;
    switch (err.kind) {
        case 'timeout':
        case 'network':
        case 'server':
        case 'malformed':
        case 'rate_limited':
        case 'unknown':
            return true;
        case 'auth':
            return false; // bad key; don't churn the counter
    }
}
