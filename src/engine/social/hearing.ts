/**
 * PHASE-2: Social Hearing Mechanics - Hearing Range Engine
 *
 * Calculates how far sound travels based on:
 * - Volume (WHISPER, TALK, SHOUT)
 * - Environment/Biome (urban tavern vs quiet forest)
 * - Atmospheric effects (SILENCE, etc.)
 */

import { BiomeType, Atmospheric } from '../../schema/spatial.js';

export type VolumeLevel = 'WHISPER' | 'TALK' | 'SHOUT';

export interface HearingRangeConfig {
    volume: VolumeLevel;
    biomeContext: BiomeType;
    atmospherics: Atmospheric[];
}

/**
 * Base hearing ranges by environment (in feet)
 *
 * Design philosophy:
 * - Urban = noisy (taverns, markets) → shorter ranges
 * - Forest/Mountain = quiet → longer ranges
 * - Divine/Arcane = magical acoustics → moderate ranges
 * - Dungeon = echo chambers → moderate ranges
 */
const BASE_HEARING_RANGES: Record<BiomeType, { WHISPER: number; TALK: number; SHOUT: number }> = {
    // Noisy environments
    urban: {
        WHISPER: 5,    // Crowded tavern, market chatter
        TALK: 15,      // Need to speak up
        SHOUT: 40      // Cuts through noise
    },

    // Quiet natural environments
    forest: {
        WHISPER: 10,   // Birds, wind, but mostly quiet
        TALK: 60,      // Sound carries well
        SHOUT: 300     // Echo through trees
    },
    mountain: {
        WHISPER: 15,   // Thin air, less interference
        TALK: 100,     // Wide open spaces
        SHOUT: 500     // Mountain echo
    },
    coastal: {
        WHISPER: 5,    // Crashing waves drown it out
        TALK: 30,      // Have to compete with ocean
        SHOUT: 150     // Carries over water
    },

    // Underground/enclosed
    dungeon: {
        WHISPER: 10,   // Stone echoes whispers
        TALK: 40,      // Moderate echo
        SHOUT: 120     // Loud echo down corridors
    },
    cavern: {
        WHISPER: 15,   // Huge echo chamber
        TALK: 80,      // Sound bounces everywhere
        SHOUT: 400     // Massive echo
    },

    // Magical environments
    divine: {
        WHISPER: 10,   // Sacred silence
        TALK: 50,      // Reverent acoustics
        SHOUT: 200     // Booming temple voice
    },
    arcane: {
        WHISPER: 8,    // Magic dampens sound slightly
        TALK: 40,      // Unpredictable acoustics
        SHOUT: 180     // Magical amplification
    }
};

/**
 * Calculate how far sound travels in feet
 *
 * @param config - Volume, biome, and atmospheric conditions
 * @returns Distance in feet that sound can be heard
 */
export function calculateHearingRadius(config: HearingRangeConfig): number {
    // Start with base range for biome + volume
    let range = BASE_HEARING_RANGES[config.biomeContext][config.volume];

    // Apply atmospheric modifiers
    if (config.atmospherics.includes('SILENCE')) {
        // SILENCE reduces all hearing ranges by 50%
        range = Math.floor(range * 0.5);
    }

    // DARKNESS doesn't affect hearing (sound still works in dark)
    // FOG might muffle sound slightly, but we'll leave this for future expansion
    // ANTIMAGIC doesn't affect natural hearing
    // MAGICAL could amplify (but we keep it neutral for now)

    return range;
}

/**
 * Determine if a listener can hear based on distance
 *
 * @param distance - Distance between speaker and listener in feet
 * @param hearingRadius - Maximum hearing range calculated above
 * @returns true if within hearing range
 */
export function canHearAtDistance(distance: number, hearingRadius: number): boolean {
    return distance <= hearingRadius;
}

/**
 * Calculate distance penalty for adjacent rooms
 *
 * Sound travels through walls/doors, but with degradation:
 * - SHOUT can be heard in adjacent rooms (muffled)
 * - TALK can sometimes be heard (requires good perception)
 * - WHISPER never penetrates walls
 *
 * @param volume - Volume level of speech
 * @returns Distance penalty in feet (added to actual distance)
 */
export function getAdjacentRoomPenalty(volume: VolumeLevel): number {
    switch (volume) {
        case 'WHISPER':
            return 999; // Effectively blocks whispers
        case 'TALK':
            return 30;  // Adds 30ft effective distance
        case 'SHOUT':
            return 10;  // Shouts penetrate walls better
    }
}

/**
 * Get a description of hearing quality based on distance
 *
 * Used for flavor text in conversation memories
 */
export function getHearingQuality(distance: number, hearingRadius: number): string {
    const ratio = distance / hearingRadius;

    if (ratio <= 0.25) {
        return 'clearly';
    } else if (ratio <= 0.5) {
        return 'distinctly';
    } else if (ratio <= 0.75) {
        return 'faintly';
    } else {
        return 'barely';
    }
}
