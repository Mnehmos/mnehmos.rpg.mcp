import { Nation } from '../../schema/nation.js';
import { Region } from '../../schema/region.js';
import seedrandom from 'seedrandom';

export interface ConflictResult {
    winnerId: string;
    loserId: string;
    regionId: string;
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
        const loser = scores[1]; // Main contender

        // Calculate control level change
        // If winner already owned it, they consolidate control
        // If challenger won, they reduce control or flip it

        let newControlLevel = region.controlLevel;
        let winnerId = region.ownerNationId || winner.nationId;
        let log = '';

        if (winner.nationId === region.ownerNationId) {
            // Defender won
            newControlLevel = Math.min(100, newControlLevel + 10);
            log = `Defender ${winner.nationId} repelled attack. Control increased to ${newControlLevel}.`;
        } else {
            // Attacker won
            // Damage control based on score difference
            const diff = winner.score - (loser?.score || 0);
            const damage = Math.max(10, Math.floor(diff / 2));

            newControlLevel -= damage;

            if (newControlLevel <= 0) {
                // Flip ownership
                winnerId = winner.nationId;
                newControlLevel = Math.abs(newControlLevel); // Excess becomes new control
                log = `Attacker ${winner.nationId} conquered region from ${region.ownerNationId || 'wilderness'}!`;
            } else {
                // Just reduced control
                winnerId = region.ownerNationId!; // Still owned by defender
                log = `Attacker ${winner.nationId} won battle but failed to conquer. Control reduced to ${newControlLevel}.`;
            }
        }

        return {
            winnerId, // Battle winner, not necessarily region owner
            loserId: scores[1]?.nationId || 'wilderness',
            regionId: region.id,
            newControlLevel,
            log
        };
    }
}
