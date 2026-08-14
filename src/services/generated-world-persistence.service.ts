import Database from 'better-sqlite3';
import { BiomeType } from '../schema/biome.js';
import { Region } from '../schema/region.js';
import { StructureType } from '../schema/structure.js';
import { GeneratedWorld } from '../engine/worldgen/index.js';
import { RegionRepository } from '../storage/repos/region.repo.js';
import { StructureRepository } from '../storage/repos/structure.repo.js';

const REGION_COLORS = ['#6b7280', '#2563eb', '#059669', '#d97706', '#9333ea', '#dc2626'];

function regionTypeForBiome(biome: BiomeType): Region['type'] {
    switch (biome) {
        case BiomeType.DESERT:
            return 'desert';
        case BiomeType.FOREST:
        case BiomeType.RAINFOREST:
            return 'forest';
        case BiomeType.TAIGA:
        case BiomeType.TUNDRA:
        case BiomeType.GLACIER:
            return 'mountain';
        case BiomeType.SWAMP:
            return 'wilderness';
        case BiomeType.GRASSLAND:
        case BiomeType.SAVANNA:
            return 'plains';
        case BiomeType.OCEAN:
        case BiomeType.DEEP_OCEAN:
        case BiomeType.LAKE:
            return 'water';
        default:
            return 'wilderness';
    }
}

function populationForStructure(type: StructureType): number {
    switch (type) {
        case StructureType.CITY:
            return 10_000;
        case StructureType.TOWN:
            return 1_000;
        case StructureType.VILLAGE:
            return 250;
        case StructureType.CASTLE:
            return 500;
        case StructureType.TEMPLE:
            return 100;
        case StructureType.RUINS:
        case StructureType.DUNGEON:
            return 0;
    }
}

/** Persist the relational projections of a newly generated procedural world. */
export function persistGeneratedWorldEntities(
    db: Database.Database,
    worldId: string,
    world: GeneratedWorld,
): void {
    const regionRepo = new RegionRepository(db);
    const structureRepo = new StructureRepository(db);
    const now = new Date().toISOString();
    const regionIds = new Map<number, string>();

    for (const region of world.regions) {
        const id = `${worldId}:region:${region.id}`;
        regionIds.set(region.id, id);
        regionRepo.create({
            id,
            worldId,
            name: region.name,
            type: regionTypeForBiome(region.biome),
            centerX: region.capital.x,
            centerY: region.capital.y,
            color: REGION_COLORS[region.id % REGION_COLORS.length],
            controlLevel: 0,
            createdAt: now,
            updatedAt: now,
        });
    }

    for (const [index, structure] of world.structures.entries()) {
        const tileIndex = structure.location.y * world.width + structure.location.x;
        const generatedRegionId = world.regionMap[tileIndex];
        structureRepo.create({
            id: `${worldId}:structure:${index}`,
            worldId,
            regionId: generatedRegionId >= 0 ? regionIds.get(generatedRegionId) : undefined,
            name: structure.name,
            type: structure.type,
            x: structure.location.x,
            y: structure.location.y,
            population: populationForStructure(structure.type),
            createdAt: now,
            updatedAt: now,
        });
    }
}
