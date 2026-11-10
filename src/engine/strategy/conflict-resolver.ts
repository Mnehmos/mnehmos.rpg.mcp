import { Nation } from '../../schema/nation.js';
import { Region } from '../../schema/region.js';
import seedrandom from 'seedrandom';

/** Control a nation holds over a region it has just taken. */
const MIN_CONQUEST_CONTROL = 10;
const MAX_CONTROL = 100;

export interface ConflictResult {
    /** Who won the battle. Not necessarily who holds the region afterwards. */
    battleWinnerId: string;
    /** Same as battleWinnerId; kept for existing callers. */
    winnerId: string;
    /** The side the winner beat: the owner when an attacker wins, otherwise the strongest challenger. */
    loserId: string;
    /** Who holds the region after the battle, or null if it stays unowned. */
    newOwnerId: string | null;
    /** True when the region changed hands. */
    conquered: boolean;
    regionId: string;
    /** Always 0-100. */
    newControlLevel: number;
    log: string;
}

export class ConflictResolver {
    resolveRegionConflict(
        region: Region,
        claimants: Nation[],
        seed: string
    ): ConflictResult {
        const rng = seedrandom(seed);

        // Calculate scores
        const scores = claimants.map(nation => {
            // Power = GDP + Resources
            const power = nation.gdp + (nation.resources.oil * 2) + nation.resources.metal;

            // Aggression bonus (aggressive nations fight harder but maybe recklessly)
            const aggressionBonus = nation.aggression * 0.5;

            // Paranoia penalty (too cautious)
            const paranoiaPenalty = nation.paranoia * 0.2;

            // Random factor (d20 equivalent)
            const luck = Math.floor(rng() * 20) + 1;

            return {
                nationId: nation.id,
                score: power + aggressionBonus - paranoiaPenalty + luck,
                raw: { power, aggressionBonus, paranoiaPenalty, luck }
            };
        });

        // Sort by score descending
        scores.sort((a, b) => b.score - a.score);

        const winner = scores[0];
        const runnerUp = scores[1];
        const ownerId = region.ownerNationId ?? null;

        if (winner.nationId === ownerId) {
            // Defender won: it consolidates control.
            const newControlLevel = Math.min(MAX_CONTROL, region.controlLevel + 10);
            return {
                battleWinnerId: winner.nationId,
                winnerId: winner.nationId,
                loserId: runnerUp?.nationId ?? 'wilderness',
                newOwnerId: ownerId,
                conquered: false,
                regionId: region.id,
                newControlLevel,
                log: `Defender ${winner.nationId} repelled attack. Control increased to ${newControlLevel}.`
            };
        }

        // Attacker won. It beat the owner if there is one, otherwise the next claimant.
        const ownerScore = scores.find(s => s.nationId === ownerId);
        const beaten = ownerScore ?? runnerUp;
        const diff = winner.score - (beaten?.score ?? 0);
        const damage = Math.max(10, Math.floor(diff / 2));
        const remaining = region.controlLevel - damage;

        if (remaining <= 0) {
            // The region changes hands. Whatever force was left over becomes
            // the new owner's control, within the scale: a crushing victory
            // used to leave control in the tens of thousands, and one that
            // landed exactly on zero left the region with no owner at all.
            const newControlLevel = Math.min(MAX_CONTROL, Math.max(MIN_CONQUEST_CONTROL, -remaining));
            return {
                battleWinnerId: winner.nationId,
                winnerId: winner.nationId,
                loserId: beaten?.nationId ?? 'wilderness',
                newOwnerId: winner.nationId,
                conquered: true,
                regionId: region.id,
                newControlLevel,
                log: `Attacker ${winner.nationId} conquered region from ${ownerId || 'wilderness'}!`
            };
        }

        return {
            battleWinnerId: winner.nationId,
            winnerId: winner.nationId,
            loserId: beaten?.nationId ?? 'wilderness',
            newOwnerId: ownerId,
            conquered: false,
            regionId: region.id,
            newControlLevel: remaining,
            log: `Attacker ${winner.nationId} won battle but failed to conquer. Control reduced to ${remaining}.`
        };
    }
}
