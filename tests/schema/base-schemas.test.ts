import { describe, it, expect } from 'vitest';
import {
    IdField,
    UuidField,
    WorldIdField,
    DateTimeField,
    TimestampFields,
    GridXField,
    GridYField,
    GridCoordinates,
    TacticalPosition,
    BoundingBox,
    NameField,
    ShortDescriptionField,
    LongDescriptionField,
    NonNegativeInt,
    PositiveInt,
    PopulationField,
    LevelField,
    DCField,
    HpField,
    AcField,
    PercentageField,
    PercentageInt,
    AbilityScoreField,
    AbilityScores,
    SizeCategory,
    DamageTypeEnum,
    DamageTypeArray,
    ConditionTypeEnum,
    CurrencyFields,
    EncounterStatusEnum,
    MovementSpeedField,
    DiscoveryStateEnum,
    DirectionEnum,
    ExitTypeEnum,
    CoverTypeEnum,
    createEntitySchema,
    createUuidEntitySchema,
    createWorldEntitySchema,
} from '../../src/schema/base-schemas';
import { z } from 'zod';

describe('base-schemas', () => {
    describe('Identifier Fields', () => {
        it('IdField rejects empty strings', () => {
            expect(() => IdField.parse('')).toThrow();
            expect(IdField.parse('valid-id')).toBe('valid-id');
        });

        it('UuidField validates UUID format', () => {
            expect(() => UuidField.parse('not-a-uuid')).toThrow();
            expect(UuidField.parse('550e8400-e29b-41d4-a716-446655440000'))
                .toBe('550e8400-e29b-41d4-a716-446655440000');
        });

        it('WorldIdField accepts any non-empty string', () => {
            expect(WorldIdField.parse('world-1')).toBe('world-1');
        });
    });

    describe('Timestamp Fields', () => {
        it('DateTimeField validates ISO 8601 format', () => {
            expect(() => DateTimeField.parse('not-a-date')).toThrow();
            expect(DateTimeField.parse('2024-01-15T12:00:00.000Z'))
                .toBe('2024-01-15T12:00:00.000Z');
        });

        it('TimestampFields can be spread into schemas', () => {
            const TestSchema = z.object({
                id: z.string(),
                ...TimestampFields,
            });

            const result = TestSchema.parse({
                id: 'test-1',
                createdAt: '2024-01-15T12:00:00.000Z',
                updatedAt: '2024-01-15T12:00:00.000Z',
            });

            expect(result.createdAt).toBe('2024-01-15T12:00:00.000Z');
            expect(result.updatedAt).toBe('2024-01-15T12:00:00.000Z');
        });
    });

    describe('Coordinate Fields', () => {
        it('GridXField and GridYField reject negative values', () => {
            expect(() => GridXField.parse(-1)).toThrow();
            expect(() => GridYField.parse(-5)).toThrow();
            expect(GridXField.parse(0)).toBe(0);
            expect(GridYField.parse(100)).toBe(100);
        });

        it('GridCoordinates validates x and y together', () => {
            const coords = GridCoordinates.parse({ x: 50, y: 75 });
            expect(coords.x).toBe(50);
            expect(coords.y).toBe(75);
        });

        it('TacticalPosition allows floating point and optional z', () => {
            const pos = TacticalPosition.parse({ x: 5.5, y: 10.25 });
            expect(pos.x).toBe(5.5);
            expect(pos.y).toBe(10.25);
            expect(pos.z).toBeUndefined();

            const pos3d = TacticalPosition.parse({ x: 5, y: 10, z: 2 });
            expect(pos3d.z).toBe(2);
        });

        it('BoundingBox validates all four corners', () => {
            const bbox = BoundingBox.parse({
                minX: 0,
                maxX: 100,
                minY: 0,
                maxY: 50,
            });
            expect(bbox.minX).toBe(0);
            expect(bbox.maxX).toBe(100);
        });
    });

    describe('Name and Text Fields', () => {
        it('NameField rejects empty and whitespace-only names', () => {
            expect(() => NameField.parse('')).toThrow();
            expect(() => NameField.parse('   ')).toThrow();
            expect(NameField.parse('Valid Name')).toBe('Valid Name');
        });

        it('NameField rejects names over 100 characters', () => {
            const longName = 'a'.repeat(101);
            expect(() => NameField.parse(longName)).toThrow();
        });

        it('ShortDescriptionField limits to 500 characters', () => {
            const longDesc = 'a'.repeat(501);
            expect(() => ShortDescriptionField.parse(longDesc)).toThrow();
            expect(ShortDescriptionField.parse('Short desc')).toBe('Short desc');
        });

        it('LongDescriptionField requires minimum 10 characters', () => {
            expect(() => LongDescriptionField.parse('Too short')).toThrow();
            expect(LongDescriptionField.parse('This is a sufficiently long description')).toBeDefined();
        });
    });

    describe('Numeric Fields', () => {
        it('NonNegativeInt allows 0 but not negative', () => {
            expect(() => NonNegativeInt.parse(-1)).toThrow();
            expect(NonNegativeInt.parse(0)).toBe(0);
            expect(NonNegativeInt.parse(100)).toBe(100);
        });

        it('PositiveInt requires at least 1', () => {
            expect(() => PositiveInt.parse(0)).toThrow();
            expect(PositiveInt.parse(1)).toBe(1);
        });

        it('LevelField validates 1-20 range', () => {
            expect(() => LevelField.parse(0)).toThrow();
            expect(() => LevelField.parse(21)).toThrow();
            expect(LevelField.parse(1)).toBe(1);
            expect(LevelField.parse(20)).toBe(20);
        });

        it('DCField validates 5-30 range', () => {
            expect(() => DCField.parse(4)).toThrow();
            expect(() => DCField.parse(31)).toThrow();
            expect(DCField.parse(5)).toBe(5);
            expect(DCField.parse(30)).toBe(30);
        });

        it('PercentageField validates 0-1 decimal range', () => {
            expect(() => PercentageField.parse(-0.1)).toThrow();
            expect(() => PercentageField.parse(1.1)).toThrow();
            expect(PercentageField.parse(0.5)).toBe(0.5);
        });

        it('PercentageInt validates 0-100 integer range', () => {
            expect(() => PercentageInt.parse(-1)).toThrow();
            expect(() => PercentageInt.parse(101)).toThrow();
            expect(PercentageInt.parse(50)).toBe(50);
        });
    });

    describe('D&D Ability Scores', () => {
        it('AbilityScoreField validates 0-30 range', () => {
            expect(() => AbilityScoreField.parse(-1)).toThrow();
            expect(() => AbilityScoreField.parse(31)).toThrow();
            expect(AbilityScoreField.parse(10)).toBe(10);
        });

        it('AbilityScores validates all six abilities', () => {
            const scores = AbilityScores.parse({
                str: 10,
                dex: 14,
                con: 12,
                int: 8,
                wis: 16,
                cha: 18,
            });
            expect(scores.str).toBe(10);
            expect(scores.cha).toBe(18);
        });
    });

    describe('Enum Fields', () => {
        it('SizeCategory validates D&D size categories', () => {
            expect(SizeCategory.parse('medium')).toBe('medium');
            expect(SizeCategory.parse('huge')).toBe('huge');
            expect(() => SizeCategory.parse('invalid')).toThrow();
        });

        it('DamageTypeEnum validates damage types', () => {
            expect(DamageTypeEnum.parse('fire')).toBe('fire');
            expect(DamageTypeEnum.parse('necrotic')).toBe('necrotic');
            expect(() => DamageTypeEnum.parse('invalid')).toThrow();
        });

        it('DamageTypeArray defaults to empty array', () => {
            const result = DamageTypeArray.parse(undefined);
            expect(result).toEqual([]);

            const resistances = DamageTypeArray.parse(['fire', 'cold']);
            expect(resistances).toEqual(['fire', 'cold']);
        });

        it('ConditionTypeEnum validates conditions', () => {
            expect(ConditionTypeEnum.parse('stunned')).toBe('stunned');
            expect(ConditionTypeEnum.parse('prone')).toBe('prone');
        });

        it('DiscoveryStateEnum validates discovery states', () => {
            expect(DiscoveryStateEnum.parse('unknown')).toBe('unknown');
            expect(DiscoveryStateEnum.parse('discovered')).toBe('discovered');
        });

        it('DirectionEnum validates directions', () => {
            expect(DirectionEnum.parse('north')).toBe('north');
            expect(DirectionEnum.parse('up')).toBe('up');
            expect(DirectionEnum.parse('northeast')).toBe('northeast');
        });

        it('ExitTypeEnum validates exit types', () => {
            expect(ExitTypeEnum.parse('OPEN')).toBe('OPEN');
            expect(ExitTypeEnum.parse('LOCKED')).toBe('LOCKED');
            expect(ExitTypeEnum.parse('HIDDEN')).toBe('HIDDEN');
        });

        it('CoverTypeEnum validates cover types', () => {
            expect(CoverTypeEnum.parse('half')).toBe('half');
            expect(CoverTypeEnum.parse('three_quarter')).toBe('three_quarter');
        });

        it('EncounterStatusEnum validates statuses', () => {
            expect(EncounterStatusEnum.parse('active')).toBe('active');
            expect(EncounterStatusEnum.parse('completed')).toBe('completed');
        });
    });

    describe('Currency Fields', () => {
        it('CurrencyFields defaults to zeros', () => {
            const currency = CurrencyFields.parse(undefined);
            expect(currency).toEqual({ gold: 0, silver: 0, copper: 0 });
        });

        it('CurrencyFields validates partial input', () => {
            const currency = CurrencyFields.parse({ gold: 100 });
            expect(currency.gold).toBe(100);
            expect(currency.silver).toBe(0);
        });
    });

    describe('Movement Fields', () => {
        it('MovementSpeedField defaults to 30', () => {
            const speed = MovementSpeedField.parse(undefined);
            expect(speed).toBe(30);
        });

        it('MovementSpeedField validates non-negative', () => {
            expect(() => MovementSpeedField.parse(-5)).toThrow();
            expect(MovementSpeedField.parse(0)).toBe(0);
        });
    });

    describe('Helper Functions', () => {
        it('createEntitySchema creates schema with ID and timestamps', () => {
            const TestSchema = createEntitySchema({
                name: z.string(),
                value: z.number(),
            });

            const result = TestSchema.parse({
                id: 'test-1',
                name: 'Test',
                value: 42,
                createdAt: '2024-01-15T12:00:00.000Z',
                updatedAt: '2024-01-15T12:00:00.000Z',
            });

            expect(result.id).toBe('test-1');
            expect(result.name).toBe('Test');
            expect(result.createdAt).toBeDefined();
        });

        it('createUuidEntitySchema requires valid UUID', () => {
            const TestSchema = createUuidEntitySchema({
                name: z.string(),
            });

            expect(() => TestSchema.parse({
                id: 'not-a-uuid',
                name: 'Test',
                createdAt: '2024-01-15T12:00:00.000Z',
                updatedAt: '2024-01-15T12:00:00.000Z',
            })).toThrow();

            const result = TestSchema.parse({
                id: '550e8400-e29b-41d4-a716-446655440000',
                name: 'Test',
                createdAt: '2024-01-15T12:00:00.000Z',
                updatedAt: '2024-01-15T12:00:00.000Z',
            });

            expect(result.id).toBe('550e8400-e29b-41d4-a716-446655440000');
        });

        it('createWorldEntitySchema includes worldId and coordinates', () => {
            const TestSchema = createWorldEntitySchema({
                name: z.string(),
                type: z.string(),
            });

            const result = TestSchema.parse({
                id: 'struct-1',
                worldId: 'world-1',
                x: 50,
                y: 75,
                name: 'Test City',
                type: 'city',
                createdAt: '2024-01-15T12:00:00.000Z',
                updatedAt: '2024-01-15T12:00:00.000Z',
            });

            expect(result.worldId).toBe('world-1');
            expect(result.x).toBe(50);
            expect(result.y).toBe(75);
            expect(result.regionId).toBeUndefined();
        });

        it('createWorldEntitySchema allows optional regionId', () => {
            const TestSchema = createWorldEntitySchema({
                name: z.string(),
            });

            const result = TestSchema.parse({
                id: 'struct-1',
                worldId: 'world-1',
                regionId: 'region-5',
                x: 50,
                y: 75,
                name: 'Test',
                createdAt: '2024-01-15T12:00:00.000Z',
                updatedAt: '2024-01-15T12:00:00.000Z',
            });

            expect(result.regionId).toBe('region-5');
        });
    });
});
