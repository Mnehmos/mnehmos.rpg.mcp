import { Server, Socket } from 'net';

import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

/**
 * A TCP transport for the MCP server.
 * This implementation uses a simple line-based JSON protocol over TCP.
 * Note: The official SDK doesn't have a built-in TCP transport yet, so we implement a basic one
 * that mimics the behavior needed for MCP.
 * 
 * However, for better compatibility with existing tools, we might want to use SSE or Stdio.
 * If we strictly need TCP, we need to define the framing.
 * 
 * For this implementation, we will use a simple newline-delimited JSON format,
 * similar to how StdioTransport works but over a socket.
 */
export class TCPServerTransport implements Transport {
    private server: Server;
    private clients: Set<Socket> = new Set();
    private requestClients: Map<string, Socket> = new Map();
    private authorizedClients: Set<Socket> = new Set();
    private _onclose?: () => void;
    private _onerror?: (error: Error) => void;
    private _onmessage?: (message: JSONRPCMessage) => void;
    private readonly host: string;
    private readonly authToken?: string;
    private readonly maxMessageBytes: number;

    constructor(
        private port: number = 3000,
        options: { host?: string; authToken?: string; maxMessageBytes?: number } = {}
    ) {
        this.host = options.host ?? '127.0.0.1';
        this.authToken = options.authToken || process.env.RPG_MCP_TRANSPORT_TOKEN;
        this.maxMessageBytes = options.maxMessageBytes ?? 1024 * 1024;

        this.server = new Server((socket) => {
            console.error('TCP client connected');
            this.clients.add(socket);

            let buffer = '';
            socket.on('data', (data) => {
                buffer += data.toString();
                if (buffer.length > this.maxMessageBytes) {
                    const error = new Error('TCP message exceeded maximum size');
                    this._onerror?.(error);
                    socket.destroy(error);
                    return;
                }

                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.trim()) {
                        try {
                            const message = JSON.parse(line);
                            if (!this.authenticateMessage(socket, message)) {
                                continue;
                            }
                            const key = this.messageIdKey(message);
                            if (key) {
                                this.requestClients.set(key, socket);
                            }
                            this._onmessage?.(message);
                        } catch (error) {
                            console.error('Failed to parse message:', error);
                            this._onerror?.(error as Error);
                        }
                    }
                }
            });

            socket.on('error', (err) => {
                console.error('Socket error:', err);
                this._onerror?.(err);
            });

            socket.on('close', () => {
                console.error('TCP client disconnected');
                this.clients.delete(socket);
                this.authorizedClients.delete(socket);
                for (const [id, client] of this.requestClients.entries()) {
                    if (client === socket) this.requestClients.delete(id);
                }
                if (this.clients.size === 0) {
                    this._onclose?.();
                }
            });
        });
    }

    async start(): Promise<void> {
        return new Promise((resolve) => {
            this.server.listen(this.port, this.host, () => {
                console.error(`TCP Server listening on ${this.host}:${this.port}`);
                resolve();
            });
        });
    }

    async close(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server.close((err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async send(message: JSONRPCMessage): Promise<void> {
        if (this.clients.size === 0) {
            throw new Error('No client connected');
        }

        const payload = JSON.stringify(message) + '\n';
        const key = this.messageIdKey(message);
        if (key) {
            const client = this.requestClients.get(key);
            this.requestClients.delete(key);
            if (client && !client.destroyed) {
                client.write(payload);
            }
            return;
        }

        for (const client of this.clients) {
            if (!client.destroyed) client.write(payload);
        }
    }

    set onclose(handler: () => void) {
        this._onclose = handler;
    }

    set onerror(handler: (error: Error) => void) {
        this._onerror = handler;
    }

    set onmessage(handler: (message: JSONRPCMessage) => void) {
        this._onmessage = handler;
    }

    private messageIdKey(message: JSONRPCMessage): string | null {
        return 'id' in message && message.id !== undefined && message.id !== null
            ? String(message.id)
            : null;
    }

    private authenticateMessage(socket: Socket, message: any): message is JSONRPCMessage {
        if (!this.authToken || this.authorizedClients.has(socket)) {
            return true;
        }

        const token = message?.authToken || message?.params?._transportAuthToken;
        if (token === this.authToken) {
            this.authorizedClients.add(socket);
            if (message && typeof message === 'object' && message.params) {
                delete message.params._transportAuthToken;
            }
            return message?.jsonrpc === '2.0';
        }

        const error = new Error('Unauthorized TCP client');
        this._onerror?.(error);
        socket.destroy(error);
        return false;
    }
}
