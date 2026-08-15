import type { Item } from '../schema/inventory.js';

export type LightSourceShape = 'radius' | 'cone';

export interface LightSourceProfile {
    kind: string;
    durationMinutes: number;
    brightRadiusFeet: number;
    dimRadiusFeet: number;
    shape: LightSourceShape;
    consumesItem: boolean;
}

function positiveInteger(value: unknown): number | null {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

function profileFromProperties(properties: Record<string, unknown>): LightSourceProfile | null {
    const raw = properties.lightSource;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

    const source = raw as Record<string, unknown>;
    const durationMinutes = positiveInteger(source.durationMinutes)
        ?? (positiveInteger(source.durationHours) ? positiveInteger(source.durationHours)! * 60 : null);
    const brightRadiusFeet = positiveInteger(source.brightRadiusFeet);
    const dimRadiusFeet = positiveInteger(source.dimRadiusFeet);
    if (!durationMinutes || !brightRadiusFeet || !dimRadiusFeet) return null;

    const kind = typeof source.kind === 'string' && source.kind.trim() ? source.kind.trim() : 'custom';
    return {
        kind,
        durationMinutes,
        brightRadiusFeet,
        dimRadiusFeet,
        shape: source.shape === 'cone' ? 'cone' : 'radius',
        consumesItem: typeof source.consumesItem === 'boolean' ? source.consumesItem : kind === 'torch',
    };
}

/**
 * Return the authoritative D&D light profile for an item. Open5e's pinned
 * item records carry the prose rule text, while authored items may provide a
 * structured `properties.lightSource` profile. The engine resolves either
 * into the same persisted state when the item is used.
 */
export function getLightSourceProfile(item: Pick<Item, 'name' | 'properties'>): LightSourceProfile | null {
    const properties = item.properties ?? {};
    const explicit = profileFromProperties(properties);
    if (explicit) return explicit;

    const name = item.name.trim().toLowerCase();
    if (name === 'torch' || name.endsWith(' torch')) {
        return {
            kind: 'torch',
            durationMinutes: 60,
            brightRadiusFeet: 20,
            dimRadiusFeet: 20,
            shape: 'radius',
            consumesItem: true,
        };
    }
    if (name.includes('bullseye') && name.includes('lantern')) {
        return {
            kind: 'bullseye_lantern',
            durationMinutes: 360,
            brightRadiusFeet: 60,
            dimRadiusFeet: 60,
            shape: 'cone',
            consumesItem: false,
        };
    }
    if (name === 'lantern' || (name.includes('hooded') && name.includes('lantern'))) {
        return {
            kind: 'hooded_lantern',
            durationMinutes: 360,
            brightRadiusFeet: 30,
            dimRadiusFeet: 30,
            shape: 'radius',
            consumesItem: false,
        };
    }
    return null;
}

export function lightSourceProperties(profile: LightSourceProfile): Record<string, unknown> {
    return {
        kind: profile.kind,
        durationMinutes: profile.durationMinutes,
        brightRadiusFeet: profile.brightRadiusFeet,
        dimRadiusFeet: profile.dimRadiusFeet,
        shape: profile.shape,
        consumesItem: profile.consumesItem,
    };
}
