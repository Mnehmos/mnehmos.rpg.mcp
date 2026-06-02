/**
 * Attentional-capacity arithmetic.
 *
 * The Operator's lens is metered. Looking through it costs attention,
 * and the meter only refills on a long rest. Capacity scaling mirrors
 * D&D 5e proficiency-tier cadence so the resource grows on the same
 * liturgical rhythm as the rest of the engine.
 *
 *   L1–L4  → max 3
 *   L5–L8  → max 4
 *   L9–L12 → max 5
 *   L13+   → max 6 (capped — structural fog, never omniscience)
 *
 * The resource is non-refundable on no_op_spoken: looking takes
 * attention even if nothing was there to see.
 */

import type { CharacterRepository } from '../../storage/repos/character.repo.js';
import type { Character, NPC } from '../../schema/character.js';

export const ATTENTIONAL_CAPACITY_KEY = 'attentional_capacity';

/**
 * Compute max attentional capacity from level, capped at 6.
 */
export function maxByLevel(level: number): number {
    const computed = 3 + Math.floor((level - 1) / 4);
    return Math.max(3, Math.min(6, computed));
}

export interface CapacityRead {
    current: number;
    max: number;
    lastRefilledAt: string | null;
    poolExists: boolean;
}

function readPool(character: Character | NPC): CapacityRead {
    const pool = (character.resourcePools ?? {})[ATTENTIONAL_CAPACITY_KEY];
    const maxFromLevel = maxByLevel(character.level);
    if (!pool) {
        return {
            current: 0,
            max: maxFromLevel,
            lastRefilledAt: null,
            poolExists: false,
        };
    }
    return {
        current: Math.min(pool.current, maxFromLevel),
        max: maxFromLevel,
        lastRefilledAt: pool.lastRefilledAt ?? null,
        poolExists: true,
    };
}

/**
 * Read capacity without mutating state. Returns max=3 default if the
 * pool has never been created.
 */
export function read(observerId: string, repo: CharacterRepository): CapacityRead | null {
    const character = repo.findById(observerId);
    if (!character) return null;
    return readPool(character);
}

/**
 * Spend `amount` (default 1) of attentional_capacity. Returns the
 * NEW remaining; throws if insufficient.
 */
export function debit(
    observerId: string,
    repo: CharacterRepository,
    amount: number = 1,
): { before: number; after: number; max: number } {
    const character = repo.findById(observerId);
    if (!character) throw new Error(`Observer ${observerId} not found`);

    const cap = readPool(character);
    if (cap.current < amount) {
        throw new Error(
            `Insufficient attentional_capacity: have ${cap.current}, need ${amount}`,
        );
    }

    const newCurrent = cap.current - amount;
    const updatedPools = {
        ...(character.resourcePools ?? {}),
        [ATTENTIONAL_CAPACITY_KEY]: {
            current: newCurrent,
            max: cap.max,
            lastRefilledAt: cap.lastRefilledAt ?? undefined,
        },
    };

    repo.update(observerId, { resourcePools: updatedPools });
    return { before: cap.current, after: newCurrent, max: cap.max };
}

/**
 * Refill attentional_capacity to max. Idempotent — if already full,
 * returns before==after and the caller can audit a no_op_spoken.
 */
export function refill(
    observerId: string,
    repo: CharacterRepository,
    when: string = new Date().toISOString(),
): { before: number; after: number; max: number; mutated: boolean } {
    const character = repo.findById(observerId);
    if (!character) throw new Error(`Observer ${observerId} not found`);

    const cap = readPool(character);
    if (cap.current === cap.max && cap.poolExists) {
        return { before: cap.current, after: cap.max, max: cap.max, mutated: false };
    }

    const updatedPools = {
        ...(character.resourcePools ?? {}),
        [ATTENTIONAL_CAPACITY_KEY]: {
            current: cap.max,
            max: cap.max,
            lastRefilledAt: when,
        },
    };

    repo.update(observerId, { resourcePools: updatedPools });
    return { before: cap.current, after: cap.max, max: cap.max, mutated: true };
}

/**
 * Initialise the pool for an observer (used on subsystem binding).
 * If the pool already exists, leaves it untouched.
 */
export function ensurePool(
    observerId: string,
    repo: CharacterRepository,
    when: string = new Date().toISOString(),
): boolean {
    const character = repo.findById(observerId);
    if (!character) return false;
    const cap = readPool(character);
    if (cap.poolExists) return false;

    const updatedPools = {
        ...(character.resourcePools ?? {}),
        [ATTENTIONAL_CAPACITY_KEY]: {
            current: cap.max,
            max: cap.max,
            lastRefilledAt: when,
        },
    };
    repo.update(observerId, { resourcePools: updatedPools });
    return true;
}
