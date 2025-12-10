/**
 * Tests for schema shorthand utilities
 * TIER 2: Token efficiency through input shorthand
 */
import { describe, it, expect } from 'vitest';
import {
    // Position
    parsePosition,
    parsePositions,
    formatPosition,
    // Damage
    parseDamage,
    formatDamage,
    parseMultiDamage,
    // Duration
    parseDuration,
    formatDuration,
    toRounds,
    // Range
    parseRange,
    formatRange,
    // Area of Effect
    parseAreaOfEffect,
    formatAreaOfEffect,
    // Dice
    rollDice,
    averageDice,
    // Zod schemas
    PositionSchema,
    DamageSchema,
    DurationSchema,
    RangeSchema,
    AreaOfEffectSchema
} from '../../src/utils/schema-shorthand.js';

describe('Schema Shorthand Utilities', () => {
    // ═══════════════════════════════════════════════════════════════════════════
    // POSITION PARSING
    // ═══════════════════════════════════════════════════════════════════════════

    describe('parsePosition', () => {
        it('parses "x,y" format', () => {
            const pos = parsePosition('10,5');
            expect(pos).toEqual({ x: 10, y: 5, z: 0 });
        });

        it('parses "x,y,z" format', () => {
            const pos = parsePosition('10,5,3');
            expect(pos).toEqual({ x: 10, y: 5, z: 3 });
        });

        it('handles whitespace', () => {
            const pos = parsePosition(' 10 , 5 ');
            expect(pos).toEqual({ x: 10, y: 5, z: 0 });
        });

        it('accepts object input with z', () => {
            const pos = parsePosition({ x: 10, y: 5, z: 3 });
            expect(pos).toEqual({ x: 10, y: 5, z: 3 });
        });

        it('accepts object input without z', () => {
            const pos = parsePosition({ x: 10, y: 5 });
            expect(pos).toEqual({ x: 10, y: 5, z: 0 });
        });
    });

    describe('parsePositions', () => {
        it('parses array of mixed formats', () => {
            const positions = parsePositions(['0,0', '10,5', { x: 20, y: 10 }]);
            expect(positions).toEqual([
                { x: 0, y: 0, z: 0 },
                { x: 10, y: 5, z: 0 },
                { x: 20, y: 10, z: 0 }
            ]);
        });
    });

    describe('formatPosition', () => {
        it('formats without z by default', () => {
            expect(formatPosition({ x: 10, y: 5, z: 0 })).toBe('10,5');
        });

        it('includes z when non-zero', () => {
            expect(formatPosition({ x: 10, y: 5, z: 3 })).toBe('10,5,3');
        });

        it('includes z when forced', () => {
            expect(formatPosition({ x: 10, y: 5, z: 0 }, true)).toBe('10,5,0');
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // DAMAGE PARSING
    // ═══════════════════════════════════════════════════════════════════════════

    describe('parseDamage', () => {
        it('parses basic dice notation "2d6"', () => {
            const damage = parseDamage('2d6');
            expect(damage).not.toBeNull();
            expect(damage?.count).toBe(2);
            expect(damage?.sides).toBe(6);
            expect(damage?.modifier).toBe(0);
            expect(damage?.type).toBe('untyped');
            expect(damage?.average).toBe(7);
            expect(damage?.min).toBe(2);
            expect(damage?.max).toBe(12);
        });

        it('parses dice with positive modifier "2d6+3"', () => {
            const damage = parseDamage('2d6+3');
            expect(damage?.modifier).toBe(3);
            expect(damage?.average).toBe(10);
            expect(damage?.min).toBe(5);
            expect(damage?.max).toBe(15);
        });

        it('parses dice with negative modifier "2d6-2"', () => {
            const damage = parseDamage('2d6-2');
            expect(damage?.modifier).toBe(-2);
            expect(damage?.average).toBe(5);
            expect(damage?.min).toBe(0); // Min is floored at 0
            expect(damage?.max).toBe(10);
        });

        it('parses dice with damage type "2d6 fire"', () => {
            const damage = parseDamage('2d6 fire');
            expect(damage?.type).toBe('fire');
        });

        it('parses full notation "2d6+3 fire"', () => {
            const damage = parseDamage('2d6+3 fire');
            expect(damage?.count).toBe(2);
            expect(damage?.sides).toBe(6);
            expect(damage?.modifier).toBe(3);
            expect(damage?.type).toBe('fire');
        });

        it('handles single die "d20"', () => {
            const damage = parseDamage('d20');
            expect(damage?.count).toBe(1);
            expect(damage?.sides).toBe(20);
            expect(damage?.dice).toBe('d20');
        });

        it('handles various damage types', () => {
            expect(parseDamage('1d8 slashing')?.type).toBe('slashing');
            expect(parseDamage('1d6 piercing')?.type).toBe('piercing');
            expect(parseDamage('2d10 radiant')?.type).toBe('radiant');
            expect(parseDamage('3d6 necrotic')?.type).toBe('necrotic');
        });

        it('handles abbreviated damage types', () => {
            expect(parseDamage('1d6 slash')?.type).toBe('slashing');
            expect(parseDamage('1d6 pierc')?.type).toBe('piercing');
        });

        it('returns null for invalid notation', () => {
            expect(parseDamage('invalid')).toBeNull();
            expect(parseDamage('2x6')).toBeNull();
        });
    });

    describe('formatDamage', () => {
        it('formats basic damage', () => {
            const damage = parseDamage('2d6')!;
            expect(formatDamage(damage)).toBe('2d6');
        });

        it('formats damage with modifier', () => {
            const damage = parseDamage('2d6+3')!;
            expect(formatDamage(damage)).toBe('2d6+3');
        });

        it('formats damage with type', () => {
            const damage = parseDamage('2d6+3 fire')!;
            expect(formatDamage(damage)).toBe('2d6+3 fire');
        });
    });

    describe('parseMultiDamage', () => {
        it('parses multiple damage expressions', () => {
            const damages = parseMultiDamage('2d6+3 slashing + 1d6 fire');
            expect(damages).toHaveLength(2);
            expect(damages[0].type).toBe('slashing');
            expect(damages[1].type).toBe('fire');
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // DURATION PARSING
    // ═══════════════════════════════════════════════════════════════════════════

    describe('parseDuration', () => {
        it('parses rounds "10r"', () => {
            const duration = parseDuration('10r');
            expect(duration).not.toBeNull();
            expect(duration?.value).toBe(10);
            expect(duration?.unit).toBe('rounds');
            expect(duration?.rounds).toBe(10);
        });

        it('parses minutes "1m"', () => {
            const duration = parseDuration('1m');
            expect(duration?.value).toBe(1);
            expect(duration?.unit).toBe('minutes');
            expect(duration?.rounds).toBe(10);
        });

        it('parses hours "1h"', () => {
            const duration = parseDuration('1h');
            expect(duration?.value).toBe(1);
            expect(duration?.unit).toBe('hours');
            expect(duration?.rounds).toBe(600);
        });

        it('parses days "7d"', () => {
            const duration = parseDuration('7d');
            expect(duration?.value).toBe(7);
            expect(duration?.unit).toBe('days');
            expect(duration?.rounds).toBe(7 * 14400);
        });

        it('parses long-form "10 rounds"', () => {
            const duration = parseDuration('10 rounds');
            expect(duration?.rounds).toBe(10);
        });

        it('parses "instant"', () => {
            const duration = parseDuration('instant');
            expect(duration?.unit).toBe('instantaneous');
            expect(duration?.rounds).toBe(0);
        });

        it('parses "concentration"', () => {
            const duration = parseDuration('concentration');
            expect(duration?.unit).toBe('concentration');
        });

        it('parses "permanent"', () => {
            const duration = parseDuration('permanent');
            expect(duration?.unit).toBe('permanent');
            expect(duration?.rounds).toBe(Infinity);
        });

        it('returns null for invalid duration', () => {
            expect(parseDuration('invalid')).toBeNull();
        });
    });

    describe('formatDuration', () => {
        it('formats short form', () => {
            expect(formatDuration(parseDuration('10r')!)).toBe('10r');
            expect(formatDuration(parseDuration('1h')!)).toBe('1h');
            expect(formatDuration(parseDuration('7d')!)).toBe('7d');
        });

        it('formats long form', () => {
            expect(formatDuration(parseDuration('10r')!, false)).toBe('10 rounds');
            expect(formatDuration(parseDuration('1h')!, false)).toBe('1 hour');
        });
    });

    describe('toRounds', () => {
        it('converts string duration to rounds', () => {
            expect(toRounds('10r')).toBe(10);
            expect(toRounds('1m')).toBe(10);
            expect(toRounds('1h')).toBe(600);
        });

        it('passes through numbers', () => {
            expect(toRounds(10)).toBe(10);
        });

        it('extracts rounds from Duration object', () => {
            expect(toRounds(parseDuration('1h')!)).toBe(600);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // RANGE PARSING
    // ═══════════════════════════════════════════════════════════════════════════

    describe('parseRange', () => {
        it('parses simple melee range "5ft"', () => {
            const range = parseRange('5ft');
            expect(range?.normal).toBe(5);
            expect(range?.long).toBeNull();
            expect(range?.type).toBe('melee');
        });

        it('parses ranged notation "30/120"', () => {
            const range = parseRange('30/120');
            expect(range?.normal).toBe(30);
            expect(range?.long).toBe(120);
            expect(range?.type).toBe('ranged');
        });

        it('parses reach notation "10 reach"', () => {
            const range = parseRange('10 reach');
            expect(range?.normal).toBe(10);
            expect(range?.type).toBe('reach');
        });

        it('parses "touch"', () => {
            const range = parseRange('touch');
            expect(range?.normal).toBe(5);
            expect(range?.type).toBe('melee');
        });

        it('parses "self"', () => {
            const range = parseRange('self');
            expect(range?.normal).toBe(0);
        });
    });

    describe('formatRange', () => {
        it('formats melee range', () => {
            expect(formatRange(parseRange('5ft')!)).toBe('5ft');
        });

        it('formats ranged notation', () => {
            expect(formatRange(parseRange('30/120')!)).toBe('30/120');
        });

        it('formats reach', () => {
            expect(formatRange(parseRange('10 reach')!)).toBe('10ft reach');
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // AREA OF EFFECT PARSING
    // ═══════════════════════════════════════════════════════════════════════════

    describe('parseAreaOfEffect', () => {
        it('parses cone "60ft cone"', () => {
            const aoe = parseAreaOfEffect('60ft cone');
            expect(aoe?.size).toBe(60);
            expect(aoe?.shape).toBe('cone');
        });

        it('parses cube "15ft cube"', () => {
            const aoe = parseAreaOfEffect('15ft cube');
            expect(aoe?.size).toBe(15);
            expect(aoe?.shape).toBe('cube');
        });

        it('parses sphere "20ft sphere"', () => {
            const aoe = parseAreaOfEffect('20ft sphere');
            expect(aoe?.size).toBe(20);
            expect(aoe?.shape).toBe('sphere');
        });

        it('parses radius (sphere alias) "20ft radius"', () => {
            const aoe = parseAreaOfEffect('20ft radius');
            expect(aoe?.shape).toBe('sphere');
        });

        it('parses line with dimensions "30x5 line"', () => {
            const aoe = parseAreaOfEffect('30x5 line');
            expect(aoe?.size).toBe(30);
            expect(aoe?.shape).toBe('line');
            expect(aoe?.secondarySize).toBe(5);
        });

        it('parses cylinder with height "20ft cylinder 40ft high"', () => {
            const aoe = parseAreaOfEffect('20ft cylinder 40ft high');
            expect(aoe?.size).toBe(20);
            expect(aoe?.shape).toBe('cylinder');
            expect(aoe?.secondarySize).toBe(40);
        });
    });

    describe('formatAreaOfEffect', () => {
        it('formats cone', () => {
            expect(formatAreaOfEffect(parseAreaOfEffect('60ft cone')!)).toBe('60ft cone');
        });

        it('formats line with dimensions', () => {
            expect(formatAreaOfEffect(parseAreaOfEffect('30x5 line')!)).toBe('30x5ft line');
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // DICE UTILITIES
    // ═══════════════════════════════════════════════════════════════════════════

    describe('rollDice', () => {
        it('rolls dice within expected range', () => {
            // Roll 100 times and check bounds
            for (let i = 0; i < 100; i++) {
                const roll = rollDice('2d6+3');
                expect(roll).toBeGreaterThanOrEqual(5);
                expect(roll).toBeLessThanOrEqual(15);
            }
        });

        it('handles simple modifier "+5"', () => {
            expect(rollDice('+5')).toBe(5);
            expect(rollDice('-3')).toBe(-3);
        });

        it('uses custom RNG', () => {
            // Always roll max
            const maxRng = () => 0.9999;
            expect(rollDice('1d6', maxRng)).toBe(6);

            // Always roll min
            const minRng = () => 0;
            expect(rollDice('1d6', minRng)).toBe(1);
        });
    });

    describe('averageDice', () => {
        it('calculates correct averages', () => {
            expect(averageDice('1d6')).toBe(3);
            expect(averageDice('2d6')).toBe(7);
            expect(averageDice('2d6+3')).toBe(10);
            expect(averageDice('1d8+5')).toBe(9);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // ZOD SCHEMA INTEGRATION
    // ═══════════════════════════════════════════════════════════════════════════

    describe('Zod Schemas', () => {
        it('PositionSchema transforms string to Position', () => {
            const result = PositionSchema.parse('10,5');
            expect(result).toEqual({ x: 10, y: 5, z: 0 });
        });

        it('PositionSchema transforms object to Position', () => {
            const result = PositionSchema.parse({ x: 10, y: 5 });
            expect(result).toEqual({ x: 10, y: 5, z: 0 });
        });

        it('PositionSchema rejects invalid string', () => {
            expect(() => PositionSchema.parse('invalid')).toThrow();
        });

        it('DamageSchema transforms string to DamageNotation', () => {
            const result = DamageSchema.parse('2d6+3 fire');
            expect(result.count).toBe(2);
            expect(result.type).toBe('fire');
        });

        it('DurationSchema transforms string to Duration', () => {
            const result = DurationSchema.parse('1h');
            expect(result.unit).toBe('hours');
            expect(result.rounds).toBe(600);
        });

        it('RangeSchema transforms string to Range', () => {
            const result = RangeSchema.parse('30/120');
            expect(result.normal).toBe(30);
            expect(result.long).toBe(120);
        });

        it('AreaOfEffectSchema transforms string to AreaOfEffect', () => {
            const result = AreaOfEffectSchema.parse('20ft cone');
            expect(result.size).toBe(20);
            expect(result.shape).toBe('cone');
        });
    });
});
