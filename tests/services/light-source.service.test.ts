import { describe, expect, it } from 'vitest';
import { getLightSourceProfile } from '../../src/services/light-source.service.js';

describe('light source profiles', () => {
    it('recognizes the pinned SRD torch rules', () => {
        expect(getLightSourceProfile({ name: 'Torch', properties: {} })).toEqual({
            kind: 'torch',
            durationMinutes: 60,
            brightRadiusFeet: 20,
            dimRadiusFeet: 20,
            shape: 'radius',
        });
    });

    it('recognizes a bullseye lantern as a cone', () => {
        expect(getLightSourceProfile({ name: 'Lantern, Bullseye', properties: {} })).toMatchObject({
            kind: 'bullseye_lantern',
            durationMinutes: 360,
            brightRadiusFeet: 60,
            dimRadiusFeet: 60,
            shape: 'cone',
        });
    });

    it('recognizes Open5e punctuation order for a hooded lantern', () => {
        expect(getLightSourceProfile({ name: 'Lantern, Hooded', properties: {} })).toMatchObject({
            kind: 'hooded_lantern',
            durationMinutes: 360,
            brightRadiusFeet: 30,
            dimRadiusFeet: 30,
            shape: 'radius',
        });
    });

    it('accepts an explicit profile for authored items', () => {
        expect(getLightSourceProfile({
            name: 'Moon-glass lamp',
            properties: {
                lightSource: {
                    kind: 'moon_glass_lamp',
                    durationMinutes: 90,
                    brightRadiusFeet: 10,
                    dimRadiusFeet: 20,
                },
            },
        })).toMatchObject({
            kind: 'moon_glass_lamp',
            durationMinutes: 90,
            brightRadiusFeet: 10,
            dimRadiusFeet: 20,
            shape: 'radius',
        });
    });
});
