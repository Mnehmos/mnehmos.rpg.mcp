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
 * Runs the MCP server in stateless mode: app-level session state already
 * flows through the explicit `sessionId` tool argument, so no MCP
 * protocol-level session affinity is required here.
 */
export async function startHttpServerTransport(
    mcpServer: McpServer,
    port: number,
    options: HttpServerTransportOptions = {}
): Promise<Server> {
    const host = options.host ?? '0.0.0.0';
    const authToken = options.authToken ?? process.env.RPG_MCP_TRANSPORT_TOKEN;
    const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

    if (!authToken) {
        console.error('[HTTP] WARNING: no RPG_MCP_TRANSPORT_TOKEN configured; /mcp is unauthenticated.');
    }

    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
    });
    await mcpServer.connect(transport);

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

        if (req.method === 'POST') {
            readBody(req, maxBodyBytes)
                .then((body) => transport.handleRequest(req, res, body))
                .catch((error: Error) => {
                    console.error('[HTTP] Failed to read/parse request body:', error.message);
                    if (!res.headersSent) {
                        res.writeHead(400, { 'content-type': 'application/json' });
                        res.end(JSON.stringify({ error: 'invalid_request', message: error.message }));
                    }
                });
            return;
        }

        // GET (SSE stream resumption) and DELETE (session teardown) carry no body.
        transport.handleRequest(req, res).catch((error: Error) => {
            console.error('[HTTP] Transport request failed:', error.message);
            if (!res.headersSent) {
                res.writeHead(500, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ error: 'internal_error' }));
            }
        });
    });

    await new Promise<void>((resolve) => server.listen(port, host, resolve));
    return server;
}
