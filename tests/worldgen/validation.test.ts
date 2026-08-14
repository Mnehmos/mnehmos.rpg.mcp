import { BiomeType } from '../../src/schema/biome.js';
import { StructureType } from '../../src/schema/structure.js';
import { validateStructurePlacement } from '../../src/engine/worldgen/validation.js';

describe('worldgen structure placement validation', () => {
    it('accepts low-elevation land when the biome is land', () => {
        const result = validateStructurePlacement(StructureType.VILLAGE, 0, 0, {
            width: 1,
            height: 1,
            biomes: [[BiomeType.TAIGA]],
            elevation: new Uint8Array([1]),
        });

        expect(result).toMatchObject({ valid: true, biome: BiomeType.TAIGA, elevation: 1 });
    });

    it('continues to reject water biomes independently of elevation', () => {
        const result = validateStructurePlacement(StructureType.VILLAGE, 0, 0, {
            width: 1,
            height: 1,
            biomes: [[BiomeType.OCEAN]],
            elevation: new Uint8Array([100]),
        });

        expect(result.valid).toBe(false);
        expect(result.reason).toContain('water');
    });
});
