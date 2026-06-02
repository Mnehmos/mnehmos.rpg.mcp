import { Server, Socket } from 'net';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';

/**
 * A Unix Socket (or Named Pipe) transport for the MCP server.
 * Uses newline-delimited JSON, similar to TCP and Stdio.
 */
export class UnixServerTransport implements Transport {
    private server: Server;
    private clients: Set<Socket> = new Set();
    private requestClients: Map<string, Socket> = new Map();
    private _onclose?: () => void;
    private _onerror?: (error: Error) => void;
    private _onmessage?: (message: JSONRPCMessage) => void;
    private readonly maxMessageBytes: number;

    constructor(private path: string, options: { maxMessageBytes?: number } = {}) {
        this.maxMessageBytes = options.maxMessageBytes ?? 1024 * 1024;

        this.server = new Server((socket) => {
            console.error('Client connected to socket');
            this.clients.add(socket);

            let buffer = '';
            socket.on('data', (data) => {
                buffer += data.toString();
                if (buffer.length > this.maxMessageBytes) {
                    const error = new Error('Unix socket message exceeded maximum size');
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
                console.error('Client disconnected');
                this.clients.delete(socket);
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
        // Cleanup existing socket file if it exists (and is not a named pipe on Windows)
        if (process.platform !== 'win32' && fs.existsSync(this.path)) {
            fs.unlinkSync(this.path);
        }

        return new Promise((resolve) => {
            this.server.listen(this.path, () => {
                console.error(`Unix Server listening on ${this.path}`);
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
}
