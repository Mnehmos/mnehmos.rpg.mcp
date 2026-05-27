import { shouldTripCircuit } from '../../../src/agent/runtime/circuit';
import { ProviderError } from '../../../src/agent/provider/types';

describe('shouldTripCircuit', () => {
    it('trips for timeout', () => {
        expect(shouldTripCircuit(new ProviderError('timed out', 'timeout'))).toBe(true);
    });

    it('trips for network errors', () => {
        expect(shouldTripCircuit(new ProviderError('econnreset', 'network'))).toBe(true);
    });

    it('trips for server errors', () => {
        expect(shouldTripCircuit(new ProviderError('500', 'server'))).toBe(true);
    });

    it('trips for malformed responses', () => {
        expect(shouldTripCircuit(new ProviderError('bad json', 'malformed'))).toBe(true);
    });

    it('trips for rate limits', () => {
        expect(shouldTripCircuit(new ProviderError('429', 'rate_limited'))).toBe(true);
    });

    it('trips for unknown errors', () => {
        expect(shouldTripCircuit(new ProviderError('?', 'unknown'))).toBe(true);
    });

    it('does NOT trip for auth errors (bad key — fix it explicitly)', () => {
        expect(shouldTripCircuit(new ProviderError('401', 'auth'))).toBe(false);
    });

    it('trips for unrecognized error types (defensive)', () => {
        expect(shouldTripCircuit(new Error('something else'))).toBe(true);
        expect(shouldTripCircuit('plain string')).toBe(true);
    });
});
