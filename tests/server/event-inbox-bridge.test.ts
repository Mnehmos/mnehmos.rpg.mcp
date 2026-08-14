import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PubSub } from '../../src/engine/pubsub.js';
import { closeDb, getDb } from '../../src/storage/index.js';
import { runInTenant, type TenantContext } from '../../src/storage/tenant-context.js';
import { EventInboxRepository } from '../../src/storage/repos/event-inbox.repo.js';
import { handlePollEvents, registerEventInboxBridge } from '../../src/server/events.js';

const tenant: TenantContext = {
    accountId: 'account-event-test',
    campaignId: '00000000-0000-4000-8000-000000000075'
};

describe('durable event inbox bridge', () => {
    beforeEach(() => {
        closeDb();
        getDb(':memory:');
    });

    afterEach(() => closeDb());

    it('persists world and combat notifications in the producing tenant', () => {
        const pubsub = new PubSub();
        const unregister = registerEventInboxBridge(pubsub);

        runInTenant(tenant, () => {
            pubsub.publish('combat', { type: 'attack_executed', encounterId: 'encounter-1' });
            pubsub.publish('world', { type: 'patch_applied', worldId: 'world-1' });
        });

        const events = runInTenant(tenant, () => new EventInboxRepository(getDb()).poll({ limit: 10 }));
        expect(events).toHaveLength(2);
        expect(events.map(event => event.eventType)).toEqual(['combat_update', 'world_change']);
        expect(events[0].sourceId).toBe('encounter-1');
        expect(events[1].sourceId).toBe('world-1');
        expect(events[0].payload).not.toHaveProperty('tenant');

        unregister();
    });

    it('drops unscoped notifications and supports durable poll/consume', async () => {
        const pubsub = new PubSub();
        const unregister = registerEventInboxBridge(pubsub);
        pubsub.publish('world', { type: 'unscoped' });

        runInTenant(tenant, () => {
            pubsub.publish('world', { type: 'scoped', worldId: 'world-2' });
        });

        const first = await runInTenant(tenant, () => handlePollEvents({ limit: 10, consume: false }));
        const firstPayload = JSON.parse(first.content[0].text);
        expect(firstPayload.count).toBe(1);
        expect(firstPayload.events[0].payload.type).toBe('scoped');

        const consumed = await runInTenant(tenant, () => handlePollEvents({ limit: 10, consume: true }));
        const consumedPayload = JSON.parse(consumed.content[0].text);
        expect(consumedPayload.count).toBe(1);
        expect(consumedPayload.consumed).toBe(true);

        const remaining = runInTenant(tenant, () => new EventInboxRepository(getDb()).poll(10));
        expect(remaining).toEqual([]);
        unregister();
    });
});
