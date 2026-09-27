import { z } from 'zod';
import { getTenant } from '../storage/tenant-context.js';
import { atomic, serialized } from '../storage/unit-of-work.js';
import { withErrorFlag } from '../utils/tool-response.js';

export interface SessionContext {
    sessionId: string;
    userId?: string;
    worldId?: string;
}

/**
 * Marks a request that carried no verified tenant.
 *
 * Only tenant-agnostic meta-tools (search_tools, load_tool_schema) legitimately
 * reach a handler this way; anything touching storage fails closed inside
 * getDb(). The value is deliberately not a plausible id — the previous
 * `'default'` fallback read like a real session and quietly pooled unrelated
 * callers into one bucket.
 */
const UNSCOPED = 'unscoped';

/**
 * Wraps a tool handler with its session context.
 *
 * The context is derived from the *verified* tenant established by the HTTP
 * transport, never from the arguments. Previously `sessionId` was read straight
 * out of the tool arguments — which are assembled from model output — so a
 * prompt-injected or hallucinated value became the request's identity. Any
 * `sessionId` a caller still sends is now simply stripped by the tool's own
 * schema and ignored.
 */
export function withSession<T extends z.ZodType<any>>(
    schema: T,
    handler: (args: z.infer<T>, ctx: SessionContext) => Promise<any>
) {
    return async (args: unknown) => {
        const parsed = schema.parse(args);
        const tenant = getTenant();
        const ctx: SessionContext = {
            sessionId: tenant ? `${tenant.accountId}:${tenant.campaignId}` : UNSCOPED,
            worldId: tenant?.worldId,
        };
        return handler(parsed, ctx);
    };
}

/**
 * Run a tool handler as one all-or-nothing unit of work (see storage/unit-of-work.ts).
 *
 * A response that reports an error — thrown, `isError`, or an `error` field in
 * its payload — rolls the whole call back, and goes out with `isError: true`.
 */
export function atomicHandler<A, R>(handler: (args: A) => Promise<R>) {
    return (args: A) => atomic(async () => withErrorFlag(await handler(args)));
}

/** Hold the request's per-connection lock around a handler (and anything it wraps). */
export function serializedHandler<A, R>(handler: (args: A) => Promise<R>) {
    return (args: A) => serialized(() => handler(args));
}
