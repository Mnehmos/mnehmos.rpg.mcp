import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Compare a presented credential with the expected one in constant time.
 *
 * `===` returns at the first differing character, so response timing leaks how
 * much of a guess was right. Both sides are hashed first so the comparison is
 * over equal-length buffers and reveals nothing about the token's length.
 */
export function tokensMatch(presented: unknown, expected: string | undefined): boolean {
    if (typeof presented !== 'string' || !presented || !expected) return false;
    const a = createHash('sha256').update(presented).digest();
    const b = createHash('sha256').update(expected).digest();
    return timingSafeEqual(a, b);
}
