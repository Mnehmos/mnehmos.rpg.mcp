import { BiomeType } from '../../schema/biome.js';
import { StructureType } from '../../schema/structure.js';

/**
 * Defines which biomes are INVALID for each structure type.
 * If a structure type isn't listed, it can be placed anywhere on land.
 */
const INVALID_BIOME_PLACEMENTS: Partial<Record<StructureType, BiomeType[]>> = {
    [StructureType.CITY]: [
        BiomeType.OCEAN,
        BiomeType.DEEP_OCEAN,
        BiomeType.LAKE,
        BiomeType.GLACIER,
    ],
    [StructureType.TOWN]: [
        BiomeType.OCEAN,
        BiomeType.DEEP_OCEAN,
        BiomeType.LAKE,
        BiomeType.GLACIER,
    ],
    [StructureType.VILLAGE]: [
        BiomeType.OCEAN,
        BiomeType.DEEP_OCEAN,
        BiomeType.LAKE,
        BiomeType.GLACIER,
    ],
    [StructureType.CASTLE]: [
        BiomeType.OCEAN,
        BiomeType.DEEP_OCEAN,
        BiomeType.LAKE,
        BiomeType.SWAMP,
    ],
    [StructureType.TEMPLE]: [
        BiomeType.OCEAN,
        BiomeType.DEEP_OCEAN,
        BiomeType.LAKE,
    ],
    // Ruins and Dungeons can be almost anywhere (even underwater for ancient ruins)
    [StructureType.RUINS]: [
        BiomeType.DEEP_OCEAN, // Too deep
    ],
    [StructureType.DUNGEON]: [
        BiomeType.OCEAN,
        BiomeType.DEEP_OCEAN,
        BiomeType.LAKE,
    ],
};

/**
 * Water biomes where no standard settlements should exist
 */
export const WATER_BIOMES: BiomeType[] = [
    BiomeType.OCEAN,
    BiomeType.DEEP_OCEAN,
    BiomeType.LAKE,
];

/**
 * Checks if a structure type can be placed on a given biome
 */
export function canPlaceStructureOnBiome(
    structureType: StructureType,
    biome: BiomeType
): { valid: boolean; reason?: string } {
    const invalidBiomes = INVALID_BIOME_PLACEMENTS[structureType];
    
    // If no restrictions defined, allow placement
    if (!invalidBiomes) {
        return { valid: true };
    }
    
    if (invalidBiomes.includes(biome)) {
        const isWater = WATER_BIOMES.includes(biome);
        return {
            valid: false,
            reason: isWater 
                ? `Cannot place ${structureType} in water (${biome})`
                : `Cannot place ${structureType} on ${biome} terrain`
        };
    }
    
    return { valid: true };
}

/**
 * Validates a structure placement against world data
 */
export function validateStructurePlacement(
    structureType: StructureType,
    x: number,
    y: number,
    world: {
        width: number;
        height: number;
        biomes: BiomeType[][];
        elevation: Uint8Array;
    }
): { valid: boolean; reason?: string; biome?: BiomeType; elevation?: number } {
    // Bounds check
    if (x < 0 || x >= world.width || y < 0 || y >= world.height) {
        return {
            valid: false,
            reason: `Coordinates (${x}, ${y}) are out of bounds (world is ${world.width}x${world.height})`
        };
    }
    
    const biome = world.biomes[y][x];
    const idx = y * world.width + x;
    const elevation = world.elevation[idx];
    
    // Check biome compatibility
    const biomeCheck = canPlaceStructureOnBiome(structureType, biome);
    if (!biomeCheck.valid) {
        return {
            ...biomeCheck,
            biome,
            elevation
        };
    }
    
    // Biome classification is authoritative for land/water. Generated land
    // can legitimately have a low normalized elevation, so a numeric cutoff
    // here incorrectly rejects valid lowland and coastal structures.
    return { valid: true, biome, elevation };
}

/**
 * Biome suitability scores for settlements (higher = better)
 */
export const BIOME_HABITABILITY: Record<BiomeType, number> = {
    [BiomeType.GRASSLAND]: 15,
    [BiomeType.FOREST]: 12,
    [BiomeType.SAVANNA]: 8,
    [BiomeType.TAIGA]: 5,
    [BiomeType.RAINFOREST]: 6,
    [BiomeType.DESERT]: -5,
    [BiomeType.SWAMP]: -8,
    [BiomeType.TUNDRA]: -10,
    [BiomeType.GLACIER]: -20,
    [BiomeType.OCEAN]: -100,
    [BiomeType.DEEP_OCEAN]: -100,
    [BiomeType.LAKE]: -100,
};

/**
 * Get a human-readable suggestion for where to place a structure
 */
export function getSuggestedBiomesForStructure(structureType: StructureType): BiomeType[] {
    const goodBiomes: BiomeType[] = [];
    
    for (const [biome, score] of Object.entries(BIOME_HABITABILITY)) {
        if (score > 0) {
            const check = canPlaceStructureOnBiome(structureType, biome as BiomeType);
            if (check.valid) {
                goodBiomes.push(biome as BiomeType);
            }
        }
    }
    
    return goodBiomes;
}
