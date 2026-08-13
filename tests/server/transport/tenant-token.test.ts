import { createHmac } from 'node:crypto';
import { verifyTenantToken } from '../../../src/server/transport/tenant-token';

const SECRET = 'test-tenant-secret-value';
const NOW = 1_700_000_000;

/**
 * Signs independently of the production signer, using raw crypto.
 *
 * Deliberately NOT reusing a shared helper: this is the contract the web host
 * (a separate repository, separate build) has to reproduce byte-for-byte. A
 * round-trip through our own signer would still pass if both sides drifted
 * together, which is exactly the failure this test exists to catch.
 */
function sign(payload: Record<string, unknown>, secret: string = SECRET): string {
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
    return `${encoded}.${signature}`;
}

const validPayload = {
    accountId: 'user_2abc',
    campaignId: '3f8a1c22-9d4e-4b7a-8f21-0c9d5e7a1b33',
    worldId: 'world-1',
    partyId: 'party-1',
    iat: NOW - 10,
    exp: NOW + 300,
};

describe('verifyTenantToken', () => {
    it('accepts a correctly signed, unexpired token and returns its tenant', () => {
        const result = verifyTenantToken(sign(validPayload), SECRET, NOW);

        expect(result).toEqual({
            ok: true,
            context: {
                accountId: 'user_2abc',
                campaignId: '3f8a1c22-9d4e-4b7a-8f21-0c9d5e7a1b33',
                worldId: 'world-1',
                partyId: 'party-1',
            },
        });
    });

    it('rejects a token signed with a different secret', () => {
        const result = verifyTenantToken(sign(validPayload, 'staging-secret'), SECRET, NOW);

        expect(result).toEqual({ ok: false, reason: 'bad_signature' });
    });

    it('rejects a payload tampered with after signing', () => {
        const token = sign(validPayload);
        const [, signature] = token.split('.');
        const forged = Buffer.from(
            JSON.stringify({ ...validPayload, campaignId: 'someone-elses-campaign' }),
            'utf8'
        ).toString('base64url');

        // The attack this models: swap in another tenant's campaign id while
        // keeping a signature that was valid for your own.
        const result = verifyTenantToken(`${forged}.${signature}`, SECRET, NOW);

        expect(result).toEqual({ ok: false, reason: 'bad_signature' });
    });

    it('rejects an expired token', () => {
        const result = verifyTenantToken(sign({ ...validPayload, exp: NOW - 3600 }), SECRET, NOW);

        expect(result).toEqual({ ok: false, reason: 'expired' });
    });

    it('tolerates small clock skew rather than failing a barely-expired token', () => {
        const result = verifyTenantToken(sign({ ...validPayload, exp: NOW - 30 }), SECRET, NOW);

        expect(result.ok).toBe(true);
    });

    it('rejects a token issued far in the future', () => {
        const result = verifyTenantToken(
            sign({ ...validPayload, iat: NOW + 3600, exp: NOW + 7200 }),
            SECRET,
            NOW
        );

        expect(result).toEqual({ ok: false, reason: 'issued_in_future' });
    });

    it.each([
        ['missing accountId', { ...validPayload, accountId: '' }, 'missing_account_id'],
        ['missing campaignId', { ...validPayload, campaignId: '' }, 'missing_campaign_id'],
    ])('rejects a token with %s', (_label, payload, reason) => {
        expect(verifyTenantToken(sign(payload), SECRET, NOW)).toEqual({ ok: false, reason });
    });

    it('rejects a token with no exp claim', () => {
        const { exp: _exp, ...withoutExp } = validPayload;

        expect(verifyTenantToken(sign(withoutExp), SECRET, NOW)).toEqual({
            ok: false,
            reason: 'missing_exp',
        });
    });

    it.each([
        ['empty string', ''],
        ['no separator', 'not-a-token'],
        ['too many segments', 'a.b.c'],
    ])('rejects a malformed token (%s)', (_label, token) => {
        expect(verifyTenantToken(token, SECRET, NOW).ok).toBe(false);
    });

    it('rejects a signature of the wrong length without throwing', () => {
        // timingSafeEqual throws on length mismatch; the guard must catch this
        // before the comparison rather than surfacing a 500.
        const [encoded] = sign(validPayload).split('.');
        const shortSignature = Buffer.from('too-short', 'utf8').toString('base64url');

        expect(() => verifyTenantToken(`${encoded}.${shortSignature}`, SECRET, NOW)).not.toThrow();
        expect(verifyTenantToken(`${encoded}.${shortSignature}`, SECRET, NOW)).toEqual({
            ok: false,
            reason: 'bad_signature',
        });
    });

    it('refuses to verify anything when no secret is configured', () => {
        expect(verifyTenantToken(sign(validPayload), '', NOW)).toEqual({
            ok: false,
            reason: 'no_secret_configured',
        });
    });
});
