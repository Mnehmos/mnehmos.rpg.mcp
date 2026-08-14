/**
 * Simple Pub/Sub system for event streaming.
 */
import { getTenant, type TenantContext } from '../storage/tenant-context.js';

export class PubSub {
    private subscribers: Map<string, Set<(payload: any) => void>> = new Map();
    /** Provenance is kept out of the payload so clients cannot forge it. */
    private readonly tenantByPayload = new WeakMap<object, TenantContext>();

    subscribe(topic: string, callback: (payload: any) => void): () => void {
        if (!this.subscribers.has(topic)) {
            this.subscribers.set(topic, new Set());
        }

        this.subscribers.get(topic)!.add(callback);

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

        const subs = this.subscribers.get(topic);
        if (subs) {
            subs.forEach(callback => {
                try {
                    callback(publishedPayload);
                } catch (error) {
                    console.error(`Error in subscriber for topic ${topic}:`, error);
                }
            });
        }
    }

    /** Return the verified producer context associated with a published payload. */
    getTenantContext(payload: unknown): TenantContext | undefined {
        if (payload === null || typeof payload !== 'object') return undefined;
        return this.tenantByPayload.get(payload);
    }
}
