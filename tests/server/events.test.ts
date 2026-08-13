import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PubSub } from '../../src/engine/pubsub';
import { registerEventTools } from '../../src/server/events';

describe('Event Tools', () => {
    let server: McpServer;
    let pubsub: PubSub;
    let registeredTools: Map<string, Function>;

    beforeEach(() => {
        // Mock McpServer
        registeredTools = new Map();
        server = {
            tool: (name: string, desc: string, schema: any, handler: Function) => {
                registeredTools.set(name, handler);
            },
            server: {
                notification: vi.fn()
            }
        } as any;

        pubsub = new PubSub();
        registerEventTools(server, pubsub);
    });

    it('should subscribe to topics', async () => {
        const subscribe = registeredTools.get('subscribe_to_events');
        expect(subscribe).toBeDefined();

        const result = await subscribe!({ topics: ['world'] });
        expect(result.content[0].text).toContain('Subscribed to topics: world');

        // Verify subscription works
        const notificationSpy = vi.spyOn(server.server, 'notification');
        pubsub.publish('world', { data: 'test' });
        expect(notificationSpy).toHaveBeenCalledWith({
            method: 'notifications/rpg/event',
            // 'unscoped' rather than the old 'default': this subscription was
            // made outside any verified tenant, and the sentinel should not
            // read like a real session id that callers could be pooled into.
            params: { topic: 'world', payload: { data: 'test' }, sessionId: 'unscoped' }
        });
    });

    it('should replace previous subscriptions on re-subscribe', async () => {
        const subscribe = registeredTools.get('subscribe_to_events');

        // 1. Subscribe first time
        await subscribe!({ topics: ['world'] });

        // Spy on pubsub.subscribe to catch the unsubscribe function
        // But since we can't easily spy on the *returned* function from inside,
        // we can check if the old subscription is gone by publishing.

        // Actually, let's spy on pubsub.subscribe
        const subscribeSpy = vi.spyOn(pubsub, 'subscribe');

        // 2. Subscribe again (should trigger cleanup of first)
        await subscribe!({ topics: ['combat'] });

        // 3. Publish to 'world' - should NOT trigger notification if cleaned up
        const notificationSpy = vi.spyOn(server.server, 'notification');
        notificationSpy.mockClear();

        pubsub.publish('world', { data: 'should not receive' });
        expect(notificationSpy).not.toHaveBeenCalled();

        // 4. Publish to 'combat' - SHOULD trigger
        pubsub.publish('combat', { data: 'should receive' });
        expect(notificationSpy).toHaveBeenCalled();
    });

    it('should unsubscribe from all events', async () => {
        const subscribe = registeredTools.get('subscribe_to_events');
        const unsubscribe = registeredTools.get('unsubscribe_from_events');
        expect(unsubscribe).toBeDefined();

        // 1. Subscribe
        await subscribe!({ topics: ['world', 'combat'] });

        // 2. Unsubscribe
        const result = await unsubscribe!({});
        expect(result.content[0].text).toBe('Unsubscribed from all topics');

        // 3. Verify no notifications
        const notificationSpy = vi.spyOn(server.server, 'notification');
        pubsub.publish('world', { data: 'test' });
        pubsub.publish('combat', { data: 'test' });
        expect(notificationSpy).not.toHaveBeenCalled();
    });
});
