import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The tenant a request is acting on behalf of.
 *
 * This is derived exclusively from the signed `x-rpg-tenant` header verified at
 * the HTTP transport — never from tool arguments. Model-supplied arguments are
 * untrusted input: a prompt-injected or hallucinated campaign id must not be
 * able to select which database this process opens.
 */
export interface TenantContext {
    accountId: string;
    campaignId: string;
    /** Optional scope hints carried for logging/diagnostics; not used for routing. */
    worldId?: string;
    partyId?: string;
}

/**
 * AsyncLocalStorage rather than a module-level variable is load-bearing.
 *
 * Tool handlers are async and concurrent requests interleave at every `await`.
 * A plain "current tenant" variable would let one campaign's continuation
 * resume while another campaign's value is installed, handing the first
 * campaign the second one's database — precisely the cross-tenant bug this
 * module exists to prevent.
 */
const storage = new AsyncLocalStorage<TenantContext>();

/** Runs `fn` with `context` as the ambient tenant for the whole async subtree. */
export function runInTenant<T>(context: TenantContext, fn: () => T): T {
    return storage.run(context, fn);
}

/** The ambient tenant, or undefined outside any tenant scope. */
export function getTenant(): TenantContext | undefined {
    return storage.getStore();
}

/**
 * The ambient tenant, or a thrown error.
 *
 * Fails closed by design: callers that need tenant-owned storage must not be
 * able to proceed without a verified tenant. Meta-tools that touch no database
 * (search_tools, load_tool_schema) never call this and so keep working on
 * unscoped requests.
 */
export function requireTenant(): TenantContext {
    const context = storage.getStore();
    if (!context) {
        throw new Error(
            'No tenant context in scope. This request did not carry a verified x-rpg-tenant header, ' +
            'so tenant-owned storage cannot be opened.'
        );
    }
    return context;
}
