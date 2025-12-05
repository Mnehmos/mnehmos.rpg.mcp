/**
 * Spell Resolver - Handles spell effects (damage, healing, conditions)
 * Calculates actual damage/healing based on dice rolls and spell level
 */

import type { Spell, DamageType, SpellCastResult } from '../../schema/spell.js';
import type { Character } from '../../schema/character.js';
import { calculateUpcastDice } from './spell-database.js';
import { calculateSpellSaveDC, calculateSpellAttackBonus } from './spell-validator.js';

/**
 * Roll dice and return total
 * @param diceNotation - e.g., "8d6", "3d4+3", "1d8+4"
 */
export function rollDice(diceNotation: string): { total: number; rolls: number[]; notation: string } {
    const notation = diceNotation.trim();
    const rolls: number[] = [];
    let total = 0;

    // Parse dice notation: XdY+Z or XdY-Z
    const match = notation.match(/^(\d+)d(\d+)([+-]\d+)?$/);
    if (!match) {
        // Try to parse as just a number
        const num = parseInt(notation);
        if (!isNaN(num)) {
            return { total: num, rolls: [num], notation };
        }
        return { total: 0, rolls: [], notation };
    }

    const count = parseInt(match[1]);
    const size = parseInt(match[2]);
    const modifier = match[3] ? parseInt(match[3]) : 0;

    for (let i = 0; i < count; i++) {
        const roll = Math.floor(Math.random() * size) + 1;
        rolls.push(roll);
        total += roll;
    }

    total += modifier;

    return { total: Math.max(0, total), rolls, notation };
}

/**
 * Get cantrip damage dice based on character level
 */
export function getCantripDamage(baseDice: string, characterLevel: number): string {
    const match = baseDice.match(/^(\d+)d(\d+)/);
    if (!match) return baseDice;

    const baseCount = parseInt(match[1]);
    const diceSize = match[2];

    let diceCount = baseCount;
    if (characterLevel >= 5) diceCount = baseCount * 2;
    if (characterLevel >= 11) diceCount = baseCount * 3;
    if (characterLevel >= 17) diceCount = baseCount * 4;

    return `${diceCount}d${diceSize}`;
}

/**
 * Calculate Magic Missile dart count based on slot level
 */
export function getMagicMissileDarts(slotLevel: number): number {
    return 3 + (slotLevel - 1); // Base 3 darts + 1 per level above 1st
}

export interface SpellResolutionOptions {
    targetSaveRoll?: number; // For testing - mock the save roll
    targetAC?: number; // For spell attack rolls
    casterAbilityMod?: number; // Override ability modifier
}

export interface SpellResolutionResult {
    success: boolean;
    spellName: string;
    slotUsed?: number; // undefined for cantrips
    damage?: number;
    damageType?: DamageType;
    healing?: number;
    diceRolled: string;
    damageRolled?: number;
    damageApplied?: number;
    saveResult?: 'passed' | 'failed' | 'none';
    saveDC?: number;
    attackRoll?: number;
    attackTotal?: number;
    hit?: boolean;
    autoHit?: boolean;
    acBonus?: number; // For Shield
    dartCount?: number; // For Magic Missile
    concentration?: boolean;
    conditionsApplied?: string[];
    error?: string;
}

/**
 * Resolve a spell's effects
 */
export function resolveSpell(
    spell: Spell,
    caster: Character,
    slotLevel: number,
    options: SpellResolutionOptions = {}
): SpellResolutionResult {
    const result: SpellResolutionResult = {
        success: true,
        spellName: spell.name,
        slotUsed: spell.level === 0 ? undefined : slotLevel,
        diceRolled: '',
        concentration: spell.concentration
    };

    // Get caster's spell save DC and attack bonus
    const spellSaveDC = caster.spellSaveDC || calculateSpellSaveDC(caster);
    const spellAttackBonus = caster.spellAttackBonus || calculateSpellAttackBonus(caster);

    // Process effects
    for (const effect of spell.effects) {
        switch (effect.type) {
            case 'damage': {
                // Calculate dice to roll
                let diceNotation: string;
                if (spell.level === 0) {
                    // Cantrip - scales with character level
                    diceNotation = getCantripDamage(effect.dice || '1d10', caster.level);
                } else {
                    // Leveled spell - may scale with slot level
                    diceNotation = calculateUpcastDice(spell, slotLevel);
                }

                result.diceRolled = diceNotation;
                result.damageType = effect.damageType;

                // Special handling for Magic Missile
                if (spell.name.toLowerCase() === 'magic missile') {
                    const darts = getMagicMissileDarts(slotLevel);
                    result.dartCount = darts;
                    // Each dart does 1d4+1
                    let totalDamage = 0;
                    for (let i = 0; i < darts; i++) {
                        totalDamage += Math.floor(Math.random() * 4) + 1 + 1;
                    }
                    result.damage = totalDamage;
                    result.damageRolled = totalDamage;
                    result.damageApplied = totalDamage;
                    result.autoHit = true;
                    result.diceRolled = `${darts}d4+${darts}`;
                    break;
                }

                // Roll damage
                const damageRoll = rollDice(diceNotation);
                result.damageRolled = damageRoll.total;

                // Check if spell requires attack roll or saving throw
                if (spell.autoHit) {
                    result.autoHit = true;
                    result.damageApplied = damageRoll.total;
                    result.damage = damageRoll.total;
                } else if (effect.saveType && effect.saveType !== 'none') {
                    // Saving throw spell
                    result.saveDC = spellSaveDC;

                    // Roll save (or use provided mock)
                    const saveRoll = options.targetSaveRoll ?? (Math.floor(Math.random() * 20) + 1);
                    const saveTotal = saveRoll; // TODO: Add target's save modifier

                    if (saveTotal >= spellSaveDC) {
                        result.saveResult = 'passed';
                        if (effect.saveEffect === 'half') {
                            result.damageApplied = Math.floor(damageRoll.total / 2);
                        } else {
                            result.damageApplied = 0;
                        }
                    } else {
                        result.saveResult = 'failed';
                        result.damageApplied = damageRoll.total;
                    }
                    result.damage = result.damageApplied;
                } else {
                    // Spell attack roll
                    const attackRoll = Math.floor(Math.random() * 20) + 1;
                    result.attackRoll = attackRoll;
                    result.attackTotal = attackRoll + spellAttackBonus;

                    const targetAC = options.targetAC ?? 10;
                    result.hit = result.attackTotal >= targetAC;

                    if (result.hit) {
                        result.damageApplied = damageRoll.total;
                        result.damage = damageRoll.total;
                    } else {
                        result.damageApplied = 0;
                        result.damage = 0;
                    }
                }

                // Apply conditions if any
                if (effect.conditions && effect.conditions.length > 0) {
                    result.conditionsApplied = effect.conditions;
                }
                break;
            }

            case 'healing': {
                // Calculate healing dice
                let healingDice = effect.dice || '1d8';

                // Add upcast bonus if applicable
                if (effect.upcastBonus && slotLevel > spell.level) {
                    const bonusLevels = Math.floor((slotLevel - spell.level) / effect.upcastBonus.perLevel);
                    const bonusMatch = effect.upcastBonus.dice.match(/^(\d+)d(\d+)/);
                    const baseMatch = healingDice.match(/^(\d+)d(\d+)/);

                    if (bonusMatch && baseMatch) {
                        const newCount = parseInt(baseMatch[1]) + (parseInt(bonusMatch[1]) * bonusLevels);
                        healingDice = `${newCount}d${baseMatch[2]}`;
                    }
                }

                result.diceRolled = healingDice;

                // Roll healing
                const healingRoll = rollDice(healingDice);

                // Add spellcasting modifier
                const abilityMod = options.casterAbilityMod ?? Math.floor((caster.stats.wis - 10) / 2);
                result.healing = healingRoll.total + abilityMod;
                break;
            }

            case 'buff': {
                // Apply buff conditions
                if (effect.conditions && effect.conditions.length > 0) {
                    result.conditionsApplied = effect.conditions;

                    // Special handling for Shield
                    if (effect.conditions.includes('AC_BONUS_5')) {
                        result.acBonus = 5;
                    }
                }

                if (effect.dice) {
                    result.diceRolled = effect.dice;
                }
                break;
            }

            case 'debuff': {
                // Saving throw for debuff
                if (effect.saveType && effect.saveType !== 'none') {
                    result.saveDC = spellSaveDC;
                    const saveRoll = options.targetSaveRoll ?? (Math.floor(Math.random() * 20) + 1);

                    if (saveRoll >= spellSaveDC) {
                        result.saveResult = 'passed';
                    } else {
                        result.saveResult = 'failed';
                        if (effect.conditions && effect.conditions.length > 0) {
                            result.conditionsApplied = effect.conditions;
                        }
                    }
                } else {
                    if (effect.conditions && effect.conditions.length > 0) {
                        result.conditionsApplied = effect.conditions;
                    }
                }
                break;
            }

            case 'utility': {
                // Utility spells don't have direct numerical effects
                result.success = true;
                break;
            }

            case 'summon': {
                // TODO: Implement summoning
                result.success = true;
                break;
            }
        }
    }

    return result;
}

/**
 * Convert spell resolution result to SpellCastResult schema
 */
export function toSpellCastResult(resolution: SpellResolutionResult): SpellCastResult {
    return {
        success: resolution.success,
        spellName: resolution.spellName,
        slotUsed: resolution.slotUsed,
        damage: resolution.damage,
        damageType: resolution.damageType,
        healing: resolution.healing,
        diceRolled: resolution.diceRolled,
        damageRolled: resolution.damageRolled,
        damageApplied: resolution.damageApplied,
        saveResult: resolution.saveResult,
        autoHit: resolution.autoHit,
        attackRoll: resolution.attackRoll,
        acBonus: resolution.acBonus,
        dartCount: resolution.dartCount,
        concentration: resolution.concentration,
        error: resolution.error
    };
}
