import { z } from 'zod';
import { getDb } from '../storage/index.js';
import { CharacterRepository } from '../storage/repos/character.repo.js';
import { InventoryRepository } from '../storage/repos/inventory.repo.js';
import { DiceEngine } from '../math/dice.js';
import { SessionContext } from './types.js';

/**
 * Skill Check Tools - Stat-based dice rolling
 * Reads character stats/proficiencies and rolls with bonuses
 */

// All 18 D&D 5e skills
export const SkillEnum = z.enum([
    'acrobatics', 'animal_handling', 'arcana', 'athletics', 'deception',
    'history', 'insight', 'intimidation', 'investigation', 'medicine',
    'nature', 'perception', 'performance', 'persuasion', 'religion',
    'sleight_of_hand', 'stealth', 'survival'
]);

export const AbilityEnum = z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']);

// Skill → Ability mapping (D&D 5e)
const SKILL_ABILITY_MAP: Record<string, 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'> = {
    athletics: 'str',
    acrobatics: 'dex',
    sleight_of_hand: 'dex',
    stealth: 'dex',
    arcana: 'int',
    history: 'int',
    investigation: 'int',
    nature: 'int',
    religion: 'int',
    animal_handling: 'wis',
    insight: 'wis',
    medicine: 'wis',
    perception: 'wis',
    survival: 'wis',
    deception: 'cha',
    intimidation: 'cha',
    performance: 'cha',
    persuasion: 'cha'
};

function ensureDb() {
    const dbPath = process.env.NODE_ENV === 'test' 
        ? ':memory:' 
        : process.env.RPG_DATA_DIR 
            ? `${process.env.RPG_DATA_DIR}/rpg.db`
            : 'rpg.db';
    const db = getDb(dbPath);
    const charRepo = new CharacterRepository(db);
    const invRepo = new InventoryRepository(db);
    return { charRepo, invRepo };
}

/**
 * Check if character has equipped armor that imposes stealth disadvantage
 */
function hasArmorStealthDisadvantage(invRepo: InventoryRepository, characterId: string): { hasDisadvantage: boolean; armorName?: string } {
    try {
        const inventory = invRepo.getInventoryWithDetails(characterId);
        
        // Find equipped armor with stealth disadvantage
        for (const entry of inventory.items) {
            if (entry.equipped && entry.item.type === 'armor') {
                const props = entry.item.properties;
                if (props && props.stealthDisadvantage === true) {
                    return { hasDisadvantage: true, armorName: entry.item.name };
                }
            }
        }
        return { hasDisadvantage: false };
    } catch {
        // If inventory check fails, don't block the roll
        return { hasDisadvantage: false };
    }
}

/**
 * Calculate proficiency bonus by level (D&D 5e)
 */
function getProficiencyBonus(level: number): number {
    return Math.floor((level - 1) / 4) + 2;
}

/**
 * Calculate ability modifier
 */
function getAbilityModifier(abilityScore: number): number {
    return Math.floor((abilityScore - 10) / 2);
}

export const SkillCheckTools = {
    ROLL_SKILL_CHECK: {
        name: 'roll_skill_check',
        description: `Roll a skill check using character stats. PREFERRED over math_manage for skill rolls!

🎯 AUTO-CALCULATES:
- Ability modifier from character stats
- Proficiency bonus if character is proficient
- Expertise (double proficiency) if applicable
- Armor stealth disadvantage (automatically detected)

Skills: perception, stealth, athletics, acrobatics, arcana, history, investigation, nature, religion, animal_handling, insight, medicine, survival, deception, intimidation, performance, persuasion, sleight_of_hand

Example: { characterId: "abc123", skill: "perception", dc: 15 }`,
        inputSchema: z.object({
            characterId: z.string().describe('ID of the character making the check'),
            skill: SkillEnum.describe('Skill to roll (e.g., perception, stealth, athletics)'),
            advantage: z.boolean().optional().default(false).describe('Roll with advantage'),
            disadvantage: z.boolean().optional().default(false).describe('Roll with disadvantage'),
            dc: z.number().int().min(1).optional().describe('Difficulty Class - if provided, returns pass/fail'),
            bonusModifier: z.number().int().optional().default(0).describe('Additional situational modifier')
        })
    },

    ROLL_ABILITY_CHECK: {
        name: 'roll_ability_check',
        description: `Roll a raw ability check (no skill proficiency). PREFERRED over math_manage!

🎯 AUTO-CALCULATES:
- Ability modifier from character stats

Use for: Initiative, grapple contests, raw strength/dex tests

Example: { characterId: "abc123", ability: "str", dc: 12 }`,
        inputSchema: z.object({
            characterId: z.string().describe('ID of the character making the check'),
            ability: AbilityEnum.describe('Ability score to use (str, dex, con, int, wis, cha)'),
            advantage: z.boolean().optional().default(false),
            disadvantage: z.boolean().optional().default(false),
            dc: z.number().int().min(1).optional(),
            bonusModifier: z.number().int().optional().default(0)
        })
    },

    ROLL_SAVING_THROW: {
        name: 'roll_saving_throw',
        description: `Roll a saving throw. PREFERRED over math_manage for saves!

🎯 AUTO-CALCULATES:
- Ability modifier from character stats
- Proficiency bonus if character has save proficiency

Use for: Trap saves, environmental hazards, out-of-combat saves.
Note: In-combat spell saves are handled automatically by combat_action cast_spell.

Example: { characterId: "abc123", ability: "dex", dc: 14 }`,
        inputSchema: z.object({
            characterId: z.string().describe('ID of the character making the save'),
            ability: AbilityEnum.describe('Saving throw type (str, dex, con, int, wis, cha)'),
            advantage: z.boolean().optional().default(false),
            disadvantage: z.boolean().optional().default(false),
            dc: z.number().int().min(1).optional().describe('DC to beat'),
            bonusModifier: z.number().int().optional().default(0)
        })
    }
} as const;

export async function handleRollSkillCheck(args: unknown, _ctx: SessionContext) {
    const { charRepo, invRepo } = ensureDb();
    const parsed = SkillCheckTools.ROLL_SKILL_CHECK.inputSchema.parse(args);

    const character = charRepo.findById(parsed.characterId);
    if (!character) {
        throw new Error(`Character not found: ${parsed.characterId}`);
    }

    // Get the ability for this skill
    const ability = SKILL_ABILITY_MAP[parsed.skill];
    const abilityScore = character.stats[ability];
    const abilityMod = getAbilityModifier(abilityScore);

    // Check proficiency
    const skillProfs = (character as any).skillProficiencies || [];
    const expertise = (character as any).expertise || [];
    const isProficient = skillProfs.includes(parsed.skill);
    const hasExpertise = expertise.includes(parsed.skill);

    const profBonus = getProficiencyBonus(character.level);
    let totalMod = abilityMod + parsed.bonusModifier!;
    
    if (hasExpertise) {
        totalMod += profBonus * 2;
    } else if (isProficient) {
        totalMod += profBonus;
    }

    // Check for armor stealth disadvantage (D&D 5e rule)
    let armorDisadvantage: { hasDisadvantage: boolean; armorName?: string } = { hasDisadvantage: false };
    if (parsed.skill === 'stealth') {
        armorDisadvantage = hasArmorStealthDisadvantage(invRepo, parsed.characterId);
    }

    // Determine final advantage/disadvantage state
    // D&D 5e: advantage and disadvantage cancel out
    let hasAdvantage = parsed.advantage === true;
    let hasDisadvantage = parsed.disadvantage === true || armorDisadvantage.hasDisadvantage;
    
    // If both advantage and disadvantage, they cancel
    if (hasAdvantage && hasDisadvantage) {
        hasAdvantage = false;
        hasDisadvantage = false;
    }

    // Roll with advantage/disadvantage
    const dice = new DiceEngine();
    const diceExpr = {
        count: 1,
        sides: 20,
        modifier: totalMod,
        explode: false,
        advantage: hasAdvantage,
        disadvantage: hasDisadvantage
    };

    const result = dice.roll(diceExpr);

    // Format skill name nicely
    const skillName = parsed.skill.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const abilityName = ability.toUpperCase();

    const rollTotal = typeof result.result === 'number' ? result.result : parseInt(String(result.result), 10);
    const rolls = (result.metadata as any)?.rolls as number[] | undefined;

    // Build response with armor disadvantage info for transparency
    const response: Record<string, unknown> = {
        character: character.name,
        skill: skillName,
        ability: abilityName,
        roll: rollTotal,
        breakdown: {
            d20: rolls?.[0] ?? (rollTotal - totalMod),
            abilityMod,
            proficiencyBonus: hasExpertise ? profBonus * 2 : (isProficient ? profBonus : 0),
            bonusModifier: parsed.bonusModifier,
            total: rollTotal
        },
        proficient: isProficient,
        expertise: hasExpertise,
        advantage: hasAdvantage,
        disadvantage: hasDisadvantage
    };

    // Add armor disadvantage info if applicable
    if (armorDisadvantage.hasDisadvantage) {
        response.armorDisadvantage = true;
        response.armorName = armorDisadvantage.armorName;
    }

    if (parsed.dc !== undefined) {
        response.dc = parsed.dc;
        response.success = rollTotal >= parsed.dc;
        response.margin = rollTotal - parsed.dc;
    }

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify(response, null, 2)
        }]
    };
}

export async function handleRollAbilityCheck(args: unknown, _ctx: SessionContext) {
    const { charRepo } = ensureDb();
    const parsed = SkillCheckTools.ROLL_ABILITY_CHECK.inputSchema.parse(args);

    const character = charRepo.findById(parsed.characterId);
    if (!character) {
        throw new Error(`Character not found: ${parsed.characterId}`);
    }

    const abilityScore = character.stats[parsed.ability];
    const abilityMod = getAbilityModifier(abilityScore);
    const totalMod = abilityMod + parsed.bonusModifier!;

    const dice = new DiceEngine();
    const diceExpr = {
        count: 1,
        sides: 20,
        modifier: totalMod,
        explode: false,
        advantage: parsed.advantage && !parsed.disadvantage,
        disadvantage: parsed.disadvantage && !parsed.advantage
    };

    const result = dice.roll(diceExpr);
    const rollTotal = typeof result.result === 'number' ? result.result : parseInt(String(result.result), 10);
    const rolls = (result.metadata as any)?.rolls as number[] | undefined;
    const abilityName = parsed.ability.toUpperCase();

    const response: Record<string, unknown> = {
        character: character.name,
        ability: abilityName,
        roll: rollTotal,
        breakdown: {
            d20: rolls?.[0] ?? (rollTotal - totalMod),
            abilityMod,
            bonusModifier: parsed.bonusModifier,
            total: rollTotal
        },
        advantage: parsed.advantage,
        disadvantage: parsed.disadvantage
    };

    if (parsed.dc !== undefined) {
        response.dc = parsed.dc;
        response.success = rollTotal >= parsed.dc;
        response.margin = rollTotal - parsed.dc;
    }

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify(response, null, 2)
        }]
    };
}

export async function handleRollSavingThrow(args: unknown, _ctx: SessionContext) {
    const { charRepo } = ensureDb();
    const parsed = SkillCheckTools.ROLL_SAVING_THROW.inputSchema.parse(args);

    const character = charRepo.findById(parsed.characterId);
    if (!character) {
        throw new Error(`Character not found: ${parsed.characterId}`);
    }

    const abilityScore = character.stats[parsed.ability];
    const abilityMod = getAbilityModifier(abilityScore);

    // Check save proficiency
    const saveProfs = (character as any).saveProficiencies || [];
    const isProficient = saveProfs.includes(parsed.ability);
    const profBonus = isProficient ? getProficiencyBonus(character.level) : 0;

    const totalMod = abilityMod + profBonus + parsed.bonusModifier!;

    const dice = new DiceEngine();
    const diceExpr = {
        count: 1,
        sides: 20,
        modifier: totalMod,
        explode: false,
        advantage: parsed.advantage && !parsed.disadvantage,
        disadvantage: parsed.disadvantage && !parsed.advantage
    };

    const result = dice.roll(diceExpr);
    const rollTotal = typeof result.result === 'number' ? result.result : parseInt(String(result.result), 10);
    const rolls = (result.metadata as any)?.rolls as number[] | undefined;
    const abilityName = parsed.ability.toUpperCase();

    const response: Record<string, unknown> = {
        character: character.name,
        savingThrow: `${abilityName} Save`,
        roll: rollTotal,
        breakdown: {
            d20: rolls?.[0] ?? (rollTotal - totalMod),
            abilityMod,
            proficiencyBonus: profBonus,
            bonusModifier: parsed.bonusModifier,
            total: rollTotal
        },
        proficient: isProficient,
        advantage: parsed.advantage,
        disadvantage: parsed.disadvantage
    };

    if (parsed.dc !== undefined) {
        response.dc = parsed.dc;
        response.success = rollTotal >= parsed.dc;
        response.margin = rollTotal - parsed.dc;
    }

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify(response, null, 2)
        }]
    };
}
