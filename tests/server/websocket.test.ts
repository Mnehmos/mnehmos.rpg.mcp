import { WebSocket } from 'ws';
import { WebSocketServerTransport } from '../../src/server/transport/websocket';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

describe('WebSocket Transport', () => {
    let transport: WebSocketServerTransport;
    let client: WebSocket;
    const PORT = 3002; // Use a different port for testing

    beforeEach(async () => {
        transport = new WebSocketServerTransport(PORT);
        await transport.start();
    });

    afterEach(async () => {
        if (client && client.readyState === WebSocket.OPEN) {
            client.close();
        }
        await transport.close();
    });

    it('should accept connections and handle messages', async () => {
        return new Promise<void>((resolve, reject) => {
            client = new WebSocket(`ws://localhost:${PORT}`);

            client.on('open', async () => {
                try {
                    // Send a message from client to server
                    const message: JSONRPCMessage = {
                        jsonrpc: '2.0',
                        id: 1,
                        method: 'ping',
                        params: {}
                    };

                    // Mock server handling
                    transport.onmessage = (msg) => {
                        try {
                            expect(msg).toEqual(message);

                            // Send response back
                            transport.send({
                                jsonrpc: '2.0',
                                id: 1,
                                result: { message: 'pong' }
                            });
                        } catch (e) {
                            reject(e);
                        }
                    };

                    client.send(JSON.stringify(message));
                } catch (e) {
                    reject(e);
                }
            });

            client.on('message', (data) => {
                try {
                    const response = JSON.parse(data.toString());
                    expect(response).toEqual({
                        jsonrpc: '2.0',
                        id: 1,
                        result: { message: 'pong' }
                    });
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });

            client.on('error', reject);
        });
    });

    it('should broadcast notifications to all clients', async () => {
        const client2 = new WebSocket(`ws://localhost:${PORT}`);
        client = new WebSocket(`ws://localhost:${PORT}`);

        const notification: JSONRPCMessage = {
            jsonrpc: '2.0',
            method: 'notifications/test',
            params: { data: 'hello' }
        };

        const waitForNotification = (ws: WebSocket) => {
            return new Promise<void>((resolve, reject) => {
                ws.on('message', (data) => {
                    try {
                        const msg = JSON.parse(data.toString());
                        expect(msg).toEqual(notification);
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                });
            });
        };

        await new Promise<void>((resolve) => {
            let connected = 0;
            const checkConnected = () => {
                connected++;
                if (connected === 2) resolve();
            };
            if (client.readyState === WebSocket.OPEN) checkConnected();
            else client.on('open', checkConnected);

            if (client2.readyState === WebSocket.OPEN) checkConnected();
            else client2.on('open', checkConnected);
        });

        const p1 = waitForNotification(client);
        const p2 = waitForNotification(client2);

        transport.broadcast(notification);

        await Promise.all([p1, p2]);
        client2.close();
    });

    it('should route id responses only to the requesting client', async () => {
        const client2 = new WebSocket(`ws://localhost:${PORT}`);
        client = new WebSocket(`ws://localhost:${PORT}`);

        await new Promise<void>((resolve) => {
            let connected = 0;
            const checkConnected = () => {
                connected++;
                if (connected === 2) resolve();
            };
            client.on('open', checkConnected);
            client2.on('open', checkConnected);
        });

        const unexpectedMessages: unknown[] = [];
        client2.on('message', (data) => {
            unexpectedMessages.push(JSON.parse(data.toString()));
        });

        const responsePromise = new Promise<void>((resolve, reject) => {
            client.on('message', (data) => {
                try {
                    expect(JSON.parse(data.toString())).toEqual({
                        jsonrpc: '2.0',
                        id: 42,
                        result: { ok: true }
                    });
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
        });

        transport.onmessage = (msg) => {
            expect(msg).toEqual({
                jsonrpc: '2.0',
                id: 42,
                method: 'ping',
                params: {}
            });
        };

        client.send(JSON.stringify({
            jsonrpc: '2.0',
            id: 42,
            method: 'ping',
            params: {}
        }));

        await new Promise(resolve => setTimeout(resolve, 10));
        await transport.send({
            jsonrpc: '2.0',
            id: 42,
            result: { ok: true }
        });

        await responsePromise;
        await new Promise(resolve => setTimeout(resolve, 25));

        expect(unexpectedMessages).toEqual([]);
        client2.close();
    });
});
