import { z } from 'zod';
import { PubSub } from '../engine/pubsub.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDomainServices } from './domain-services.js';
import { runInTenant, type TenantContext } from '../storage/tenant-context.js';
import type { EventPollOptions, EventType, SourceType } from '../storage/repos/event-inbox.repo.js';
import { withSession, type SessionContext } from './types.js';

export const EventTools = {
    SUBSCRIBE: {
        name: 'subscribe_to_events',
        description: 'Subscribe to real-time events on world or combat topics. Events sent as JSON-RPC notifications.',
        inputSchema: z.object({
            topics: z.array(z.enum(['world', 'combat'])).min(1)
        })
    },
    POLL: {
        name: 'poll_events',
        description: 'Read durable world and combat events produced in this campaign. Set consume=true to acknowledge the returned events.',
        inputSchema: z.object({
            limit: z.number().int().min(1).max(100).optional(),
            eventType: z.enum(['npc_action', 'combat_update', 'world_change', 'quest_update', 'time_passage', 'environmental', 'system']).optional(),
            sourceType: z.enum(['npc', 'combat', 'world', 'system', 'scheduler']).optional(),
            consume: z.boolean().optional().default(false)
        })
    }
} as const;

// Track subscriptions per session
const activeSubscriptions: Map<string, Array<() => void>> = new Map();

const BRIDGED_TOPICS = ['world', 'combat'] as const;
type BridgedTopic = typeof BRIDGED_TOPICS[number];

function sourceIdFromPayload(payload: Record<string, unknown>): string | undefined {
    const result = payload.result;
    const nested = result && typeof result === 'object' ? result as Record<string, unknown> : undefined;
    for (const candidate of [
        payload.encounterId,
        payload.worldId,
        payload.participantId,
        nested?.encounterId,
        nested?.worldId,
    ]) {
        if (typeof candidate === 'string' && candidate.length > 0) return candidate;
    }
    return undefined;
}

function eventPayload(payload: unknown): Record<string, unknown> {
    if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
        return payload as Record<string, unknown>;
    }
    return { value: payload };
}

/**
 * Bridge process-local world/combat notifications into the durable,
 * tenant-owned inbox.  PubSub carries producer provenance out-of-band, so a
 * model cannot choose a campaign by putting an id in an event payload.
 */
export function registerEventInboxBridge(pubsub: PubSub): () => void {
    const subscriptions = BRIDGED_TOPICS.map((topic: BridgedTopic) =>
        pubsub.subscribe(topic, (payload) => {
            const tenant = pubsub.getTenantContext(payload);
            if (!tenant) {
                console.error(`[EventBridge] Dropped ${topic} event without verified tenant context`);
                return;
            }

            persistBridgedEvent(topic, payload, tenant);
        })
    );

    return () => subscriptions.forEach(unsubscribe => unsubscribe());
}

function persistBridgedEvent(topic: BridgedTopic, payload: unknown, tenant: TenantContext): void {
    runInTenant(tenant, () => {
        try {
            const normalized = eventPayload(payload);
            const eventType: EventType = topic === 'combat' ? 'combat_update' : 'world_change';
            const sourceType: SourceType = topic;
            getDomainServices().eventInbox.push({
                eventType,
                sourceType,
                sourceId: sourceIdFromPayload(normalized),
                priority: topic === 'combat' ? 5 : 2,
                payload: normalized,
            });
        } catch (error) {
            // A notification must never make the originating game action fail.
            console.error(`[EventBridge] Failed to persist ${topic} event:`, error);
        }
    });
}

export async function handlePollEvents(
    args: z.infer<typeof EventTools.POLL.inputSchema>,
    _ctx?: SessionContext
) {
    const options: EventPollOptions = {
        limit: args.limit,
        eventType: args.eventType,
        sourceType: args.sourceType,
    };
    const events = args.consume
        ? getDomainServices().eventInbox.pollAndConsume(options)
        : getDomainServices().eventInbox.poll(options);

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                success: true,
                events,
                count: events.length,
                consumed: args.consume,
            })
        }]
    };
}

export function registerEventTools(server: McpServer, pubsub: PubSub) {
    server.tool(
        EventTools.SUBSCRIBE.name,
        EventTools.SUBSCRIBE.description,
        EventTools.SUBSCRIBE.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        withSession(EventTools.SUBSCRIBE.inputSchema, async (args, ctx) => {
            const { sessionId } = ctx;

            // Clean up previous subscriptions for this session
            const existing = activeSubscriptions.get(sessionId) || [];
            existing.forEach(unsub => unsub());

            const newSubs: Array<() => void> = [];

            for (const topic of args.topics) {
                const unsub = pubsub.subscribe(topic, (payload) => {
                    server.server.notification({
                        method: 'notifications/rpg/event',
                        params: {
                            topic,
                            payload,
                            sessionId // Optional: include sessionId in notification so client knows which session it's for
                        }
                    });
                });
                newSubs.push(unsub);
            }

            activeSubscriptions.set(sessionId, newSubs);

            return {
                content: [{
                    type: 'text',
                    text: `Subscribed to topics: ${args.topics.join(', ')}`
                }]
            };
        })
    );

    // Add unsubscribe tool
    const unsubscribeSchema = z.object({});
    server.tool(
        'unsubscribe_from_events',
        'Unsubscribe from all event topics',
        unsubscribeSchema.extend({ sessionId: z.string().optional() }).shape,
        withSession(unsubscribeSchema, async (_args, ctx) => {
            const { sessionId } = ctx;
            const subs = activeSubscriptions.get(sessionId) || [];
            subs.forEach(unsub => unsub());
            activeSubscriptions.delete(sessionId);
            return { content: [{ type: 'text', text: 'Unsubscribed from all topics' }] };
        })
    );

    server.tool(
        EventTools.POLL.name,
        EventTools.POLL.description,
        EventTools.POLL.inputSchema.extend({ sessionId: z.string().optional() }).shape,
        withSession(EventTools.POLL.inputSchema, handlePollEvents)
    );
}
