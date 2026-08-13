import { createHmac, timingSafeEqual } from 'node:crypto';
import type { TenantContext } from '../../storage/tenant-context.js';

/**
 * Verification for the signed tenant context the web host sends as
 * `x-rpg-tenant`.
 *
 * Wire format (must stay byte-identical to the host's signer):
 *
 *     base64url(payloadJson) + "." + base64url(hmacSha256(secret, base64url(payloadJson)))
 *
 * The HMAC covers the *encoded* payload segment, not the decoded JSON, so
 * verification never has to re-serialize and can't be broken by key ordering
 * or whitespace differences between the two runtimes.
 *
 * This token answers "which customer is this request for". The separate
 * RPG_MCP_TRANSPORT_TOKEN answers "is this the web service at all". Conflating
 * them is what left the engine unable to distinguish tenants in the first
 * place, so they are deliberately different secrets with different lifetimes.
 */

export interface TenantTokenPayload {
    accountId: string;
    campaignId: string;
    worldId?: string;
    partyId?: string;
    /** Issued-at, seconds since epoch. */
    iat: number;
    /** Expiry, seconds since epoch. */
    exp: number;
}

export type TenantTokenResult =
    | { ok: true; context: TenantContext }
    | { ok: false; reason: string };

/**
 * Small tolerance for clock drift between the web service and the engine.
 * Without it, a token minted on a host whose clock runs slightly fast is
 * rejected as not-yet-valid and the request fails for no real reason.
 */
const CLOCK_SKEW_SECONDS = 60;

function base64urlDecode(segment: string): Buffer {
    return Buffer.from(segment, 'base64url');
}

function expectedSignature(secret: string, encodedPayload: string): Buffer {
    return createHmac('sha256', secret).update(encodedPayload).digest();
}

/**
 * Verifies a tenant token and returns the tenant it names.
 *
 * Returns a reason rather than throwing so the transport can log precisely why
 * a token failed while still returning an opaque 401 to the caller — the
 * distinction between "bad signature" and "expired" is useful in our logs and
 * useful to an attacker, so it stays on our side of the boundary.
 */
export function verifyTenantToken(
    token: string,
    secret: string,
    nowSeconds: number = Math.floor(Date.now() / 1000)
): TenantTokenResult {
    if (!secret) return { ok: false, reason: 'no_secret_configured' };
    if (!token) return { ok: false, reason: 'empty_token' };

    const parts = token.split('.');
    if (parts.length !== 2) return { ok: false, reason: 'malformed_token' };

    const [encodedPayload, encodedSignature] = parts;
    if (!encodedPayload || !encodedSignature) return { ok: false, reason: 'malformed_token' };

    const provided = base64urlDecode(encodedSignature);
    const expected = expectedSignature(secret, encodedPayload);
    // timingSafeEqual throws on length mismatch, so guard before comparing.
    if (provided.length !== expected.length) return { ok: false, reason: 'bad_signature' };
    if (!timingSafeEqual(provided, expected)) return { ok: false, reason: 'bad_signature' };

    let payload: TenantTokenPayload;
    try {
        payload = JSON.parse(base64urlDecode(encodedPayload).toString('utf8')) as TenantTokenPayload;
    } catch {
        return { ok: false, reason: 'undecodable_payload' };
    }

    if (typeof payload?.accountId !== 'string' || payload.accountId.length === 0) {
        return { ok: false, reason: 'missing_account_id' };
    }
    if (typeof payload?.campaignId !== 'string' || payload.campaignId.length === 0) {
        return { ok: false, reason: 'missing_campaign_id' };
    }
    if (typeof payload?.exp !== 'number' || !Number.isFinite(payload.exp)) {
        return { ok: false, reason: 'missing_exp' };
    }
    if (payload.exp + CLOCK_SKEW_SECONDS < nowSeconds) {
        return { ok: false, reason: 'expired' };
    }
    if (typeof payload.iat === 'number' && payload.iat - CLOCK_SKEW_SECONDS > nowSeconds) {
        return { ok: false, reason: 'issued_in_future' };
    }

    return {
        ok: true,
        context: {
            accountId: payload.accountId,
            campaignId: payload.campaignId,
            worldId: typeof payload.worldId === 'string' ? payload.worldId : undefined,
            partyId: typeof payload.partyId === 'string' ? payload.partyId : undefined,
        },
    };
}
