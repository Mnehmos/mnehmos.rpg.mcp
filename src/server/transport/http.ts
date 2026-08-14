import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runInTenant, type TenantContext } from '../../storage/tenant-context.js';
import { verifyTenantToken } from './tenant-token.js';
import { deleteCampaignDatabase } from '../../storage/index.js';

export interface HttpServerTransportOptions {
    host?: string;
    authToken?: string;
    tenantSecret?: string;
    maxBodyBytes?: number;
}

const DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024;

/**
 * Service authentication only: proves the caller is the web service, says
 * nothing about which customer the request is for. Tenant identity comes from
 * the separate signed x-rpg-tenant header.
 *
 * The token is deliberately NOT accepted from the query string. Query
 * parameters are recorded by proxies, CDNs, and access logs, so a credential
 * placed there leaks into infrastructure that has no business holding it.
 */
function isAuthorized(req: IncomingMessage, authToken: string): boolean {
    const headerToken = req.headers['x-rpg-mcp-token'];
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    return headerToken === authToken || bearerToken === authToken;
}

/**
 * Resolves the tenant a request is acting for.
 *
 * Absent header is allowed and yields no tenant: meta-tools (search_tools,
 * load_tool_schema) are genuinely tenant-agnostic and the host's tool catalog
 * loads schemas before any campaign is in play. Those requests simply never
 * reach `requireTenant()`. Anything that touches tenant-owned storage fails
 * closed there instead, which keeps the boundary at the database rather than
 * at a transport rule that would have to enumerate which tools are safe.
 *
 * A header that is *present but invalid* is always rejected — that is a caller
 * asserting an identity it cannot prove, which is never a request we want to
 * serve unscoped.
 */
function resolveTenant(
    req: IncomingMessage,
    tenantSecret: string | undefined
): { ok: true; context?: TenantContext } | { ok: false; reason: string } {
    const raw = req.headers['x-rpg-tenant'];
    if (raw === undefined) return { ok: true };

    const token = Array.isArray(raw) ? raw[0] : raw;
    if (!tenantSecret) return { ok: false, reason: 'no_tenant_secret_configured' };

    const result = verifyTenantToken(token ?? '', tenantSecret);
    if (!result.ok) return { ok: false, reason: result.reason };
    return { ok: true, context: result.context };
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let total = 0;
        req.on('data', (chunk: Buffer) => {
            total += chunk.length;
            if (total > maxBytes) {
                reject(new Error('Request body too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            if (!raw) {
                resolve(undefined);
                return;
            }
            try {
                resolve(JSON.parse(raw));
            } catch (error) {
                reject(error as Error);
            }
        });
        req.on('error', reject);
    });
}

/**
 * Minimal HTTP server exposing the MCP Streamable HTTP transport at /mcp and
 * a plain health check at /health for platform healthchecks (Railway, etc).
 *
 * Runs in stateless mode (sessionIdGenerator: undefined). The SDK enforces
 * "one transport instance per request" in stateless mode — reusing a
 * transport across requests throws "Stateless transport cannot be reused
 * across requests" — so a fresh McpServer + StreamableHTTPServerTransport
 * pair is built per POST /mcp request via `serverFactory`. Pass a factory
 * that reuses your app-level singletons (DB, pubsub, audit logger) and only
 * constructs a new McpServer/tool-registration wrapper each call — tool
 * registration itself is cheap (no I/O).
 */
export async function startHttpServerTransport(
    serverFactory: () => McpServer,
    port: number,
    options: HttpServerTransportOptions = {}
): Promise<Server> {
    // Default to '::' (all IPv6 interfaces), which Node binds dual-stack so
    // IPv4 still works. Railway's private network is IPv6-only: a server bound
    // to '0.0.0.0' is reachable on its public domain but NOT on
    // <service>.railway.internal, so peer services can't reach it privately.
    const host = options.host ?? '::';
    const authToken = options.authToken ?? process.env.RPG_MCP_TRANSPORT_TOKEN;
    const tenantSecret = options.tenantSecret ?? process.env.RPG_MCP_TENANT_SECRET;
    const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

    // Fail closed rather than warn. Serving /mcp unauthenticated exposes every
    // campaign in the database to anyone who finds the URL; a service that
    // cannot authenticate its caller should not accept traffic at all.
    if (!authToken) {
        throw new Error(
            'RPG_MCP_TRANSPORT_TOKEN is not set. Refusing to start an unauthenticated /mcp endpoint.'
        );
    }
    if (!tenantSecret) {
        console.error(
            '[HTTP] WARNING: no RPG_MCP_TENANT_SECRET configured; ' +
            'tenant-scoped requests will be rejected and only tenant-agnostic meta-tools will work.'
        );
    }

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url || '/', 'http://localhost');

        if (url.pathname === '/health' && req.method === 'GET') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
                status: 'ok',
                service: 'rpg-mcp',
                environment: process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || 'development',
                transport: 'http',
                deployment: {
                    service: process.env.RAILWAY_SERVICE_NAME || 'rpg-mcp',
                    environment: process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || 'development',
                    commitSha: process.env.RAILWAY_GIT_COMMIT_SHA || null,
                    deploymentId: process.env.RAILWAY_DEPLOYMENT_ID || null,
                },
            }));
            return;
        }

        // Campaign erasure.
        //
        // Deliberately an HTTP route rather than an MCP tool: session_manage is
        // exposed to the model, and a prompt injection that could wipe a
        // campaign is not a capability worth handing over. Only the web host,
        // holding the service token and a signed tenant context, can reach this.
        if (url.pathname === '/campaign') {
            if (!isAuthorized(req, authToken)) {
                res.writeHead(401, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ error: 'unauthorized' }));
                return;
            }
            if (req.method !== 'DELETE') {
                res.writeHead(405, { 'content-type': 'application/json', allow: 'DELETE' });
                res.end(JSON.stringify({ error: 'method_not_allowed' }));
                return;
            }
            // Unlike /mcp, an absent tenant is not tolerated here: there is no
            // campaign to erase without one, and guessing is not an option.
            const scope = resolveTenant(req, tenantSecret);
            if (!scope.ok || !scope.context) {
                console.error(`[HTTP] Rejected campaign deletion: ${scope.ok ? 'no_tenant_context' : scope.reason}`);
                res.writeHead(401, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ error: 'invalid_tenant_context' }));
                return;
            }
            try {
                // The campaign comes from the signed context, never from the
                // request body — a caller cannot name someone else's campaign.
                const deleted = deleteCampaignDatabase(scope.context.campaignId);
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ deleted }));
            } catch (error) {
                console.error(`[HTTP] Campaign deletion failed: ${(error as Error).message}`);
                res.writeHead(400, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ error: 'delete_failed' }));
            }
            return;
        }

        if (url.pathname !== '/mcp') {
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'not_found' }));
            return;
        }

        if (!isAuthorized(req, authToken)) {
            res.writeHead(401, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'unauthorized' }));
            return;
        }

        if (req.method !== 'POST') {
            // Stateless mode has no session to resume (GET) or tear down (DELETE).
            res.writeHead(405, { 'content-type': 'application/json', allow: 'POST' });
            res.end(JSON.stringify({ error: 'method_not_allowed' }));
            return;
        }

        const tenant = resolveTenant(req, tenantSecret);
        if (!tenant.ok) {
            // Log the precise reason; return an opaque error. Telling a caller
            // whether a token was expired vs. forged helps an attacker more
            // than it helps a legitimate client.
            console.error(`[HTTP] Rejected tenant context: ${tenant.reason}`);
            res.writeHead(401, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid_tenant_context' }));
            return;
        }

        readBody(req, maxBodyBytes)
            .then(async (body) => {
                const handle = async () => {
                    const mcpServer = serverFactory();
                    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
                    res.on('close', () => {
                        void transport.close();
                    });
                    await mcpServer.connect(transport);
                    await transport.handleRequest(req, res, body);
                };
                // The tenant scope must wrap the entire handler subtree, not
                // just the dispatch, so every awaited continuation inside a
                // tool handler still resolves to this request's tenant.
                return tenant.context ? runInTenant(tenant.context, handle) : handle();
            })
            .catch((error: Error) => {
                console.error('[HTTP] Request failed:', error.message);
                if (!res.headersSent) {
                    res.writeHead(400, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ error: 'invalid_request', message: error.message }));
                }
            });
    });

    await new Promise<void>((resolve) => server.listen(port, host, resolve));
    return server;
}
