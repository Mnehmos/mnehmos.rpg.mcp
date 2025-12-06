import { z } from 'zod';
import { CharacterTypeSchema } from './party.js';
import {
    CharacterClassSchema,
    SubclassSchema,
    SpellSlotsSchema,
    PactMagicSlotsSchema,
    SpellcastingAbilitySchema
} from './spell.js';

export const CharacterSchema = z.object({
    id: z.string(),
    name: z.string()
        .min(1, 'Character name cannot be empty')
        .max(100, 'Character name cannot exceed 100 characters'),
    stats: z.object({
        str: z.number().int().min(0),
        dex: z.number().int().min(0),
        con: z.number().int().min(0),
        int: z.number().int().min(0),
        wis: z.number().int().min(0),
        cha: z.number().int().min(0),
    }),
    hp: z.number().int().min(0),
    maxHp: z.number().int().min(0),
    ac: z.number().int().min(0),
    level: z.number().int().min(1),
    characterType: CharacterTypeSchema.optional().default('pc'),

    // PHASE-2: Social Hearing Mechanics - skill bonuses for opposed rolls
    perceptionBonus: z.number().int().optional().default(0)
        .describe('Proficiency bonus for Perception checks (WIS-based)'),
    stealthBonus: z.number().int().optional().default(0)
        .describe('Proficiency bonus for Stealth checks (DEX-based)'),

    // Spellcasting fields (CRIT-002/006)
    // Flexible character class - allows any string (standard D&D classes or custom like "Chronomancer")
    characterClass: z.string().optional().default('fighter'),
    subclass: SubclassSchema.optional(),
    spellSlots: SpellSlotsSchema.optional(),
    pactMagicSlots: PactMagicSlotsSchema.optional(), // Warlock only
    knownSpells: z.array(z.string()).optional().default([]),
    preparedSpells: z.array(z.string()).optional().default([]),
    cantripsKnown: z.array(z.string()).optional().default([]),
    maxSpellLevel: z.number().int().min(0).max(9).optional().default(0),
    spellcastingAbility: SpellcastingAbilitySchema.optional(),
    spellSaveDC: z.number().int().optional(),
    spellAttackBonus: z.number().int().optional(),
    concentratingOn: z.string().nullable().optional().default(null),
    activeSpells: z.array(z.string()).optional().default([]),
    conditions: z.array(z.string()).optional().default([]),
    position: z.object({
        x: z.number(),
        y: z.number()
    }).optional(),

    // PHASE-1: Spatial Graph System - current room for spatial awareness
    currentRoomId: z.string().uuid().optional()
        .describe('ID of the room the character is currently in'),

    // HIGH-007: Legendary creature fields
    legendaryActions: z.number().int().min(0).optional()
        .describe('Total legendary actions per round (usually 3)'),
    legendaryActionsRemaining: z.number().int().min(0).optional()
        .describe('Remaining legendary actions this round'),
    legendaryResistances: z.number().int().min(0).optional()
        .describe('Total legendary resistances per day (usually 3)'),
    legendaryResistancesRemaining: z.number().int().min(0).optional()
        .describe('Remaining legendary resistances'),
    hasLairActions: z.boolean().optional().default(false)
        .describe('Whether this creature can use lair actions on initiative 20'),

    // HIGH-002: Damage modifiers
    resistances: z.array(z.string()).optional().default([])
        .describe('Damage types that deal half damage (e.g., ["fire", "cold"])'),
    vulnerabilities: z.array(z.string()).optional().default([])
        .describe('Damage types that deal double damage'),
    immunities: z.array(z.string()).optional().default([])
        .describe('Damage types that deal no damage'),

    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
});

export type Character = z.infer<typeof CharacterSchema>;

export const NPCSchema = CharacterSchema.extend({
    factionId: z.string().optional(),
    behavior: z.string().optional(),
});

export type NPC = z.infer<typeof NPCSchema>;
