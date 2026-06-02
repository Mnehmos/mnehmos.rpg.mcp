import { WebSocketServer, WebSocket } from 'ws';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { IncomingMessage } from 'http';

export interface WebSocketServerTransportOptions {
    host?: string;
    authToken?: string;
    maxMessageBytes?: number;
}

const DEFAULT_MAX_MESSAGE_BYTES = 1024 * 1024;

function messageIdKey(message: JSONRPCMessage): string | null {
    return 'id' in message && message.id !== undefined && message.id !== null
        ? String(message.id)
        : null;
}

export class WebSocketServerTransport implements Transport {
    private wss: WebSocketServer;
    private clients: Set<WebSocket> = new Set();
    private requestClients: Map<string, WebSocket> = new Map();
    private readonly authToken?: string;
    public onclose?: () => void;
    public onerror?: (error: Error) => void;
    public onmessage?: (message: JSONRPCMessage) => void;

    constructor(port: number = 3001, options: WebSocketServerTransportOptions = {}) {
        const host = options.host ?? '127.0.0.1';
        this.authToken = options.authToken || process.env.RPG_MCP_TRANSPORT_TOKEN;

        this.wss = new WebSocketServer({
            port,
            host,
            maxPayload: options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES,
            verifyClient: (info, done) => {
                done(this.isAllowedRequest(info.req));
            }
        });

        this.wss.on('connection', (ws) => {
            console.error(`[WebSocket] Client connected (total: ${this.clients.size + 1})`);
            this.clients.add(ws);

            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString()) as JSONRPCMessage;
                    const key = messageIdKey(message);
                    if (key) {
                        this.requestClients.set(key, ws);
                    }
                    this.onmessage?.(message);
                } catch (e) {
                    this.onerror?.(e as Error);
                }
            });

            ws.on('close', () => {
                this.clients.delete(ws);
                for (const [id, client] of this.requestClients.entries()) {
                    if (client === ws) this.requestClients.delete(id);
                }
                console.error(`[WebSocket] Client disconnected (total: ${this.clients.size})`);
            });

            ws.on('error', (error) => {
                this.onerror?.(error);
            });
        });

        this.wss.on('error', (error) => {
            this.onerror?.(error);
        });

        console.error(`[WebSocket] Server listening on ${host}:${port}`);
    }

    async send(message: JSONRPCMessage): Promise<void> {
        const data = JSON.stringify(message);
        const key = messageIdKey(message);
        if (key) {
            const client = this.requestClients.get(key);
            this.requestClients.delete(key);
            if (client?.readyState === WebSocket.OPEN) {
                await new Promise<void>((resolve, reject) => {
                    client.send(data, (error) => {
                        if (error) reject(error);
                        else resolve();
                    });
                });
            }
            return;
        }

        const promises: Promise<void>[] = [];

        for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
                promises.push(
                    new Promise((resolve, reject) => {
                        client.send(data, (error) => {
                            if (error) reject(error);
                            else resolve();
                        });
                    })
                );
            }
        }

        await Promise.all(promises);
    }

    async start(): Promise<void> {
        // Server starts in constructor
        return Promise.resolve();
    }

    async close(): Promise<void> {
        // Close all client connections
        for (const client of this.clients) {
            client.close();
        }
        this.clients.clear();

        // Close the WebSocket server
        return new Promise((resolve, reject) => {
            this.wss.close((error) => {
                if (error) reject(error);
                else {
                    this.onclose?.();
                    resolve();
                }
            });
        });
    }

    // Broadcast to all connected clients (useful for notifications)
    broadcast(message: JSONRPCMessage): void {
        const data = JSON.stringify(message);
        for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(data);
            }
        }
    }

    private isAllowedRequest(req: IncomingMessage): boolean {
        if (!this.hasAllowedOrigin(req)) {
            return false;
        }

        if (!this.authToken) {
            return true;
        }

        const requestUrl = new URL(req.url || '/', 'ws://localhost');
        const queryToken = requestUrl.searchParams.get('token');
        const headerToken = req.headers['x-rpg-mcp-token'];
        const authHeader = req.headers.authorization;
        const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

        return queryToken === this.authToken ||
            headerToken === this.authToken ||
            bearerToken === this.authToken;
    }

    private hasAllowedOrigin(req: IncomingMessage): boolean {
        const origin = req.headers.origin;
        if (!origin) return true;

        try {
            const hostname = new URL(origin).hostname;
            return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
        } catch {
            return false;
        }
    }
}
