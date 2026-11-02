/**
 * Simple Pub/Sub system for event streaming.
 */
import { getTenant, type TenantContext } from '../storage/tenant-context.js';
import { afterCommit, inUnitOfWork } from '../storage/unit-of-work.js';

type Subscriber = (payload: any) => void;

export interface SubscribeOptions {
    /**
     * Deliver inside the publishing call's transaction, not after it commits.
     *
     * For subscribers that *write* the event (the durable inbox): the write
     * then commits or rolls back with the change it describes, so a committed
     * change can never be missing its inbox row. Default subscribers announce
     * the change to the outside world and are held until COMMIT.
     */
    transactional?: boolean;
}

export class PubSub {
    private subscribers: Map<string, Map<Subscriber, SubscribeOptions>> = new Map();
    /** Provenance is kept out of the payload so clients cannot forge it. */
    private readonly tenantByPayload = new WeakMap<object, TenantContext>();

    subscribe(topic: string, callback: Subscriber, options: SubscribeOptions = {}): () => void {
        if (!this.subscribers.has(topic)) {
            this.subscribers.set(topic, new Map());
        }

        this.subscribers.get(topic)!.set(callback, options);

        return () => {
            const subs = this.subscribers.get(topic);
            if (subs) {
                subs.delete(callback);
                if (subs.size === 0) {
                    this.subscribers.delete(topic);
                }
            }
        };
    }

    publish(topic: string, payload: any): void {
        const tenant = getTenant();
        // Event consumers need the verified tenant that produced an event, but
        // that provenance must never become model- or client-visible payload.
        // A shallow clone gives the bridge an object identity to look up while
        // preserving the existing event shape for subscribers.
        const publishedPayload = tenant && payload !== null && typeof payload === 'object'
            ? (Array.isArray(payload) ? [...payload] : { ...payload })
            : payload;

        if (tenant && publishedPayload !== null && typeof publishedPayload === 'object') {
            this.tenantByPayload.set(publishedPayload, tenant);
        }

        // Transactional subscribers (the durable inbox) run now, inside the
        // publishing call's transaction. Everyone else waits for COMMIT, so no
        // one is told about a change that then rolls back. Outside a unit of
        // work both run immediately.
        this.deliver(topic, publishedPayload, true);
        afterCommit(() => this.deliver(topic, publishedPayload, false));
    }

    private deliver(topic: string, publishedPayload: any, transactional: boolean): void {
        const subs = this.subscribers.get(topic);
        if (!subs) return;
        // Copy first: a callback may unsubscribe while we iterate.
        for (const [callback, options] of [...subs]) {
            if (Boolean(options.transactional) !== transactional) continue;
            try {
                callback(publishedPayload);
            } catch (error) {
                // A transactional subscriber is part of the change: if it fails
                // inside a unit of work, the change must fail with it, or the
                // unit would commit a change with no record of it.
                if (transactional && inUnitOfWork()) throw error;
                console.error(`Error in subscriber for topic ${topic}:`, error);
            }
        }
    }

    /** Return the verified producer context associated with a published payload. */
    getTenantContext(payload: unknown): TenantContext | undefined {
        if (payload === null || typeof payload !== 'object') return undefined;
        return this.tenantByPayload.get(payload);
    }
}
