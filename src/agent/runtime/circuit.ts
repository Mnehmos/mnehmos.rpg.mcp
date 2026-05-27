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
