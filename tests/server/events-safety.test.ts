import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PubSub } from '../../src/engine/pubsub';
import { registerEventTools } from '../../src/server/events';
import { runInTenant } from '../../src/storage/tenant-context';

const TENANT_A = { accountId: 'acct-a', campaignId: '11111111-1111-4111-8111-111111111111' };
const TENANT_B = { accountId: 'acct-b', campaignId: '22222222-2222-4222-8222-222222222222' };

function harness(options?: Parameters<typeof registerEventTools>[2]) {
    const tools = new Map<string, Function>();
    const notification = vi.fn();
    const server = {
        tool: (name: string, _desc: string, _schema: unknown, handler: Function) => { tools.set(name, handler); },
        server: { notification },
    } as unknown as McpServer;
    const pubsub = new PubSub();
    registerEventTools(server, pubsub, options);
    return { tools, notification, pubsub };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

describe('subscribe_to_events safety', () => {
    let unhandled: unknown[];

    beforeEach(() => {
        unhandled = [];
        const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
        process.on('unhandledRejection', onUnhandled);
        return () => { process.off('unhandledRejection', onUnhandled); };
    });

    it('survives a subscriber whose connection has gone away', async () => {
        const { tools, notification, pubsub } = harness();
        // What the SDK does once the transport is closed.
        notification.mockRejectedValue(new Error('Not connected'));

        await tools.get('subscribe_to_events')!({ topics: ['combat'] });
        pubsub.publish('combat', { encounterId: 'e1' });
        await settle();

        expect(notification).toHaveBeenCalledTimes(1);
        expect(unhandled).toEqual([]);

        // A dead connection is dropped rather than retried on every event.
        pubsub.publish('combat', { encounterId: 'e1' });
        await settle();
        expect(notification).toHaveBeenCalledTimes(1);
    });

    it('survives a notification that throws synchronously', async () => {
        const { tools, notification, pubsub } = harness();
        notification.mockImplementation(() => { throw new Error('Not connected'); });

        await tools.get('subscribe_to_events')!({ topics: ['world'] });
        expect(() => pubsub.publish('world', { worldId: 'w1' })).not.toThrow();
        await settle();
        expect(unhandled).toEqual([]);
    });

    it('never delivers one campaign\'s events to another campaign\'s subscriber', async () => {
        const { tools, notification, pubsub } = harness();
        notification.mockResolvedValue(undefined);

        await runInTenant(TENANT_A, () => tools.get('subscribe_to_events')!({ topics: ['combat'] }));

        runInTenant(TENANT_B, () => pubsub.publish('combat', { encounterId: 'b-secret' }));
        await settle();
        expect(notification).not.toHaveBeenCalled();

        runInTenant(TENANT_A, () => pubsub.publish('combat', { encounterId: 'a-own' }));
        await settle();
        expect(notification).toHaveBeenCalledTimes(1);
        expect(notification.mock.calls[0][0].params.payload).toEqual({ encounterId: 'a-own' });
    });

    it('does not deliver tenant events to an unscoped subscriber', async () => {
        const { tools, notification, pubsub } = harness();
        notification.mockResolvedValue(undefined);

        await tools.get('subscribe_to_events')!({ topics: ['combat'] });
        runInTenant(TENANT_B, () => pubsub.publish('combat', { encounterId: 'b-secret' }));
        await settle();
        expect(notification).not.toHaveBeenCalled();
    });

    it('registers nothing when the transport cannot push notifications', async () => {
        const { tools, notification, pubsub } = harness({ liveNotifications: false });
        const subscribeSpy = vi.spyOn(pubsub, 'subscribe');

        const result = await tools.get('subscribe_to_events')!({ topics: ['world', 'combat'] });

        expect(result.isError).toBeUndefined();
        expect(result.content[0].text).toMatch(/poll_events/);
        expect(subscribeSpy).not.toHaveBeenCalled();

        pubsub.publish('combat', { encounterId: 'e1' });
        await settle();
        expect(notification).not.toHaveBeenCalled();

        const unsub = await tools.get('unsubscribe_from_events')!({});
        expect(unsub.isError).toBeUndefined();
    });
});
