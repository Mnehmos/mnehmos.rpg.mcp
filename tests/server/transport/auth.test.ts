import { describe, it, expect } from 'vitest';
import { tokensMatch } from '../../../src/server/transport/auth';

describe('tokensMatch', () => {
    it('accepts the exact token', () => {
        expect(tokensMatch('s3cret-token', 's3cret-token')).toBe(true);
    });

    it('rejects anything else, including near misses and other lengths', () => {
        expect(tokensMatch('s3cret-tokeN', 's3cret-token')).toBe(false);
        expect(tokensMatch('s3cret', 's3cret-token')).toBe(false);
        expect(tokensMatch('s3cret-token-and-more', 's3cret-token')).toBe(false);
    });

    it('rejects missing or non-string credentials', () => {
        expect(tokensMatch(undefined, 's3cret-token')).toBe(false);
        expect(tokensMatch('', 's3cret-token')).toBe(false);
        expect(tokensMatch(['s3cret-token'], 's3cret-token')).toBe(false);
        expect(tokensMatch('anything', undefined)).toBe(false);
        expect(tokensMatch('', '')).toBe(false);
    });
});
