import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface HttpServerTransportOptions {
    host?: string;
    authToken?: string;
    maxBodyBytes?: number;
}

const DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024;

function isAuthorized(req: IncomingMessage, authToken: string | undefined): boolean {
    if (!authToken) return true;
    const url = new URL(req.url || '/', 'http://localhost');
    const queryToken = url.searchParams.get('token');
    const headerToken = req.headers['x-rpg-mcp-token'];
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    return queryToken === authToken || headerToken === authToken || bearerToken === authToken;
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
    const host = options.host ?? '0.0.0.0';
    const authToken = options.authToken ?? process.env.RPG_MCP_TRANSPORT_TOKEN;
    const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

    if (!authToken) {
        console.error('[HTTP] WARNING: no RPG_MCP_TRANSPORT_TOKEN configured; /mcp is unauthenticated.');
    }

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url || '/', 'http://localhost');

        if (url.pathname === '/health' && req.method === 'GET') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', service: 'rpg-mcp', transport: 'http' }));
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

        readBody(req, maxBodyBytes)
            .then(async (body) => {
                const mcpServer = serverFactory();
                const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
                res.on('close', () => {
                    void transport.close();
                });
                await mcpServer.connect(transport);
                await transport.handleRequest(req, res, body);
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
