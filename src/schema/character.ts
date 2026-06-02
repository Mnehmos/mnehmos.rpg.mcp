import { z } from 'zod';
import { CharacterTypeSchema } from './party.js';
import {
    SubclassSchema,
    SpellSlotsSchema,
    PactMagicSlotsSchema,
    SpellcastingAbilitySchema
} from './spell.js';

/**
 * Bastion world-brief origin tracker.
 *
 * The world's central conceit is that almost no one is native to Bastion —
 * the population is summoned from every fictional universe (Forgotten Realms,
 * Konoha, contemporary Earth, ...). origin records where a soul came from
 * and when it arrived, so tools can enforce/expose that fact.
 */
export const CharacterOriginSchema = z.object({
    universe: z.string().min(1)
        .describe('Source universe (e.g. "Contemporary Earth — Arizona Mine", "Forgotten Realms", "Konoha")'),
    native: z.boolean().default(false)
        .describe('True iff born in Bastion; false for summoned souls'),
    arrivedAt: z.string().optional()
        .describe('PD-year or ISO date the soul arrived in Bastion'),
    arrivedInCohortId: z.string().uuid().optional()
        .describe('Optional cohort/wave ID the soul arrived with')
});

export type CharacterOrigin = z.infer<typeof CharacterOriginSchema>;

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
    xp: z.number().int().min(0).default(0).describe('Current experience points'),
    characterType: CharacterTypeSchema.optional().default('pc'),

    // PHASE-2: Social Hearing Mechanics - skill bonuses for opposed rolls
    perceptionBonus: z.number().int().optional().default(0)
        .describe('Proficiency bonus for Perception checks (WIS-based)'),
    stealthBonus: z.number().int().optional().default(0)
        .describe('Proficiency bonus for Stealth checks (DEX-based)'),

    // Spellcasting fields (CRIT-002/006)
    // Flexible character class - allows any string (standard D&D classes or custom like "Chronomancer")
    characterClass: z.string().optional().default('fighter'),
    race: z.string().optional().default('Human')
        .describe('Character race - any string allowed (Human, Elf, Dragonborn, Mousefolk...)'),
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
    conditions: z.array(z.object({
        name: z.string().describe('Condition name (e.g., Poisoned, Frightened)'),
        duration: z.number().int().optional().describe('Duration in rounds'),
        source: z.string().optional().describe('Source of the condition')
    })).optional().default([]),
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

    // §10.3 forward-compat: generalized resource pools.
    // Operator's attentional_capacity lives here (resourcePools.attentional_capacity).
    // Backwards-compatible — existing 5e characters keep spellSlots untouched.
    resourcePools: z.record(z.string(), z.object({
        current: z.number(),
        max: z.number(),
        lastRefilledAt: z.string().optional(),
    })).optional().default({}),

    // Skill and Save Proficiencies
    skillProficiencies: z.array(z.enum([
        'acrobatics', 'animal_handling', 'arcana', 'athletics', 'deception',
        'history', 'insight', 'intimidation', 'investigation', 'medicine',
        'nature', 'perception', 'performance', 'persuasion', 'religion',
        'sleight_of_hand', 'stealth', 'survival'
    ])).optional().default([]).describe('Skills the character is proficient in'),
    saveProficiencies: z.array(z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']))
        .optional().default([]).describe('Saving throws the character is proficient in'),
    expertise: z.array(z.string()).optional().default([])
        .describe('Skills with double proficiency bonus (rogues, bards)'),

    // Background and alignment — accepted previously but silently dropped on
    // persistence (no migration column). See docs/bastion/05-world-brief-vs-tool-surface.md.
    background: z.string().optional()
        .describe('Character background (e.g. "Soldier", "Charlatan", "Folk Hero")'),
    alignment: z.string().optional()
        .describe('Character alignment (free-form string, e.g. "lawful_good", "chaotic_neutral")'),

    // Bastion-world origin tracker (universe of origin, native-ness, arrival data).
    origin: CharacterOriginSchema.optional()
        .describe('Source universe / Bastion-arrival metadata'),

    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
});

export type Character = z.infer<typeof CharacterSchema>;

export const NPCSchema = CharacterSchema.extend({
    factionId: z.string().optional(),
    behavior: z.string().optional(),
});

export type NPC = z.infer<typeof NPCSchema>;
