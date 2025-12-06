/**
 * IMPROVISATION TOOLS
 *
 * MCP tools for:
 * - Rule of Cool (Improvised Stunts)
 * - Custom Effects System
 * - Arcane Synthesis (Dynamic Spell Creation)
 *
 * Philosophy: "Players can attempt anything. The engine validates honestly."
 */

import { z } from 'zod';
import seedrandom from 'seedrandom';
import { getDb } from '../storage/index.js';
import { CustomEffectsRepository } from '../storage/repos/custom-effects.repo.js';
import { CharacterRepository } from '../storage/repos/character.repo.js';
import { SessionContext } from './types.js';
import {
    ResolveImprovisedStuntArgsSchema,
    ApplyCustomEffectArgsSchema,
    AttemptArcaneSynthesisArgsSchema,
    WILD_SURGE_TABLE,
    SKILL_TO_ABILITY,
    StuntResult,
    ArcaneSynthesisResult,
    CustomEffect,
    SynthesisOutcome,
    WildSurgeEffect,
    SkillName,
    AbilityName,
    TriggerEvent,
    ActorType
} from '../schema/improvisation.js';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function ensureDb() {
    const dbPath = process.env.NODE_ENV === 'test'
        ? ':memory:'
        : process.env.RPG_DATA_DIR
            ? `${process.env.RPG_DATA_DIR}/rpg.db`
            : 'rpg.db';
    const db = getDb(dbPath);
    const effectsRepo = new CustomEffectsRepository(db);
    const charRepo = new CharacterRepository(db);
    return { db, effectsRepo, charRepo };
}

/**
 * Roll dice from notation like "2d6+3"
 */
function rollDice(notation: string, rng?: seedrandom.PRNG): { total: number; rolls: number[]; notation: string } {
    const match = notation.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
    if (!match) {
        throw new Error(`Invalid dice notation: ${notation}`);
    }

    const count = parseInt(match[1], 10);
    const sides = parseInt(match[2], 10);
    const modifier = match[3] ? parseInt(match[3], 10) : 0;

    const rolls: number[] = [];
    const random = rng || Math.random;

    for (let i = 0; i < count; i++) {
        rolls.push(Math.floor(random() * sides) + 1);
    }

    const sum = rolls.reduce((a, b) => a + b, 0);
    return {
        total: Math.max(0, sum + modifier), // Minimum 0
        rolls,
        notation
    };
}

/**
 * Roll a d20 with optional advantage/disadvantage
 */
function rollD20(advantage?: boolean, disadvantage?: boolean, rng?: seedrandom.PRNG): { roll: number; rolls: number[] } {
    const random = rng || Math.random;
    const roll1 = Math.floor(random() * 20) + 1;

    if (!advantage && !disadvantage) {
        return { roll: roll1, rolls: [roll1] };
    }

    const roll2 = Math.floor(random() * 20) + 1;

    if (advantage && !disadvantage) {
        return { roll: Math.max(roll1, roll2), rolls: [roll1, roll2] };
    }

    if (disadvantage && !advantage) {
        return { roll: Math.min(roll1, roll2), rolls: [roll1, roll2] };
    }

    // Both cancel out
    return { roll: roll1, rolls: [roll1] };
}

/**
 * Get skill modifier from character stats
 */
function getSkillModifier(stats: Record<string, number>, skill: SkillName): number {
    const ability = SKILL_TO_ABILITY[skill];
    const abilityScore = stats[ability.substring(0, 3)] ?? stats[ability] ?? 10;
    return Math.floor((abilityScore - 10) / 2);
}

/**
 * Get ability modifier from score
 */
function getAbilityModifier(score: number): number {
    return Math.floor((score - 10) / 2);
}

// ============================================================================
// TOOL DEFINITIONS
// ============================================================================

export const ImprovisationTools = {
    // ========================================================================
    // RULE OF COOL - IMPROVISED STUNTS
    // ========================================================================
    RESOLVE_IMPROVISED_STUNT: {
        name: 'resolve_improvised_stunt',
        description: `Resolve a creative player action using the Rule of Cool.

When a player says "I want to kick the brazier of coals into the zombie horde" or
"I swing from the chandelier and kick both guards," this tool handles it mechanically.

DC Guidelines:
- 5: Trivial (kick open unlocked door)
- 10: Easy (swing from rope)
- 15: Medium (kick stuck mine cart)
- 20: Hard (catch thrown weapon)
- 25: Very Hard (run across crumbling bridge)
- 30: Nearly Impossible (catch arrow mid-flight)

Damage Guidelines:
- 1d4: Nuisance (thrown mug)
- 1d6: Light (chair smash)
- 2d6: Moderate (barrel roll)
- 3d6: Heavy (mine cart)
- 4d6: Severe (chandelier drop)
- 6d6: Massive (collapsing pillar)
- 8d6+: Catastrophic (building collapse)

Example:
{
  "encounter_id": 1,
  "actor_id": 1,
  "actor_type": "character",
  "target_ids": [5, 6],
  "target_types": ["npc", "npc"],
  "narrative_intent": "I kick the brazier of hot coals into the zombie horde",
  "skill_check": { "skill": "athletics", "dc": 15 },
  "action_cost": "action",
  "consequences": {
    "success_damage": "2d6",
    "damage_type": "fire",
    "area_of_effect": { "shape": "cone", "size": 15 }
  }
}`,
        inputSchema: ResolveImprovisedStuntArgsSchema
    },

    // ========================================================================
    // CUSTOM EFFECTS SYSTEM
    // ========================================================================
    APPLY_CUSTOM_EFFECT: {
        name: 'apply_custom_effect',
        description: `Apply a custom effect (divine boon, curse, transformation) to a target.

Power Level Guidelines:
1: Hours duration, +1/-1 bonus, minor condition (Lucky charm)
2: Days duration, +2/-2 bonus, advantage/disadvantage (Battle blessing)
3: Weeks duration, +3/-3 bonus, resistance/vulnerability (Champion's mantle)
4: Months duration, +5/-5 bonus, immunity, extra actions (Avatar's grace)
5: Permanent, reality-warping effects (Demigod status)

Mechanic Types:
- attack_bonus, damage_bonus, ac_bonus, saving_throw_bonus, skill_bonus
- advantage_on, disadvantage_on
- damage_resistance, damage_vulnerability, damage_immunity
- damage_over_time, healing_over_time
- extra_action, prevent_action, movement_modifier
- sense_granted, sense_removed, speak_language, cannot_speak
- custom_trigger

Example:
{
  "target_id": "char-123",
  "target_type": "character",
  "name": "Blessing of the Sun God",
  "description": "Golden light surrounds you, burning undead on contact",
  "source": { "type": "divine", "entity_name": "Pelor" },
  "category": "boon",
  "power_level": 3,
  "mechanics": [
    { "type": "damage_bonus", "value": 2, "condition": "against undead" },
    { "type": "damage_resistance", "value": "radiant" }
  ],
  "duration": { "type": "days", "value": 7 },
  "triggers": [{ "event": "on_attack", "condition": "against undead" }],
  "removal_conditions": [{ "type": "dispelled", "difficulty_class": 15 }]
}`,
        inputSchema: ApplyCustomEffectArgsSchema
    },

    GET_CUSTOM_EFFECTS: {
        name: 'get_custom_effects',
        description: 'Get all active effects on a target, with optional filtering.',
        inputSchema: z.object({
            target_id: z.string(),
            target_type: z.enum(['character', 'npc']),
            category: z.enum(['boon', 'curse', 'neutral', 'transformative']).optional(),
            source_type: z.enum(['divine', 'arcane', 'natural', 'cursed', 'psionic', 'unknown']).optional(),
            include_inactive: z.boolean().optional().default(false)
        })
    },

    REMOVE_CUSTOM_EFFECT: {
        name: 'remove_custom_effect',
        description: 'Remove a custom effect by ID or by name.',
        inputSchema: z.object({
            effect_id: z.number().int().optional(),
            target_id: z.string().optional(),
            target_type: z.enum(['character', 'npc']).optional(),
            effect_name: z.string().optional()
        })
    },

    PROCESS_EFFECT_TRIGGERS: {
        name: 'process_effect_triggers',
        description: `Fire effect triggers at specific events. Returns effects that should activate.

Trigger Events:
- always_active: Effect is always on
- start_of_turn: Fire at the start of a turn
- end_of_turn: Fire at the end of a turn
- on_attack: Fire when making an attack
- on_hit: Fire when landing a hit
- on_miss: Fire when missing an attack
- on_damage_taken: Fire when taking damage
- on_heal: Fire when receiving healing
- on_rest: Fire when taking a rest
- on_spell_cast: Fire when casting a spell
- on_death: Fire when reduced to 0 HP`,
        inputSchema: z.object({
            target_id: z.string(),
            target_type: z.enum(['character', 'npc']),
            event: z.enum([
                'always_active', 'start_of_turn', 'end_of_turn',
                'on_attack', 'on_hit', 'on_miss',
                'on_damage_taken', 'on_heal', 'on_rest',
                'on_spell_cast', 'on_death'
            ]),
            context: z.record(z.any()).optional().describe('Additional context for condition checking')
        })
    },

    ADVANCE_EFFECT_DURATIONS: {
        name: 'advance_effect_durations',
        description: 'Advance round-based effect durations. Call at end of each round.',
        inputSchema: z.object({
            target_id: z.string(),
            target_type: z.enum(['character', 'npc']),
            rounds: z.number().int().min(1).default(1)
        })
    },

    // ========================================================================
    // ARCANE SYNTHESIS - DYNAMIC SPELL CREATION
    // ========================================================================
    ATTEMPT_ARCANE_SYNTHESIS: {
        name: 'attempt_arcane_synthesis',
        description: `Attempt to create a spell on the fly through Arcane Synthesis.

DC Calculation:
Base DC = 10 + (Spell Level × 2)

Modifiers:
+2 if in combat (encounter_id provided)
+3 if novel effect (no similar spell known)
-1 per 100gp of material component (max -5)
-2 if related spell known
-2 if school specialization
-3 if near ley line/magical nexus
-2 if celestial event (blood moon, eclipse)
+2 if desperation/urgency

Outcomes:
- Mastery (nat 20 OR beat DC by 10+): Spell works AND permanently learned
- Success (beat DC): Spell works this time only
- Fizzle (within 5 of DC): Slot consumed, no effect, minor mishap
- Backfire (fail by 5-10): Spell damages caster (level × d6)
- Catastrophic (nat 1 OR fail by 10+): WILD SURGE!

Spell Level Damage Guidelines:
Level 1: Single 3d6, AoE 2d6 (10ft)
Level 2: Single 4d6, AoE 3d6 (15ft)
Level 3: Single 8d6, AoE 6d6 (20ft)
Level 4: Single 10d6, AoE 8d6 (30ft)
Level 5+: Progressively more powerful

Example:
{
  "caster_id": "wizard-1",
  "caster_type": "character",
  "narrative_intent": "I weave shadows together to blind the orc chieftain",
  "proposed_name": "Shadow Blind",
  "estimated_level": 2,
  "school": "illusion",
  "effect_specification": {
    "type": "status",
    "condition": "blinded",
    "condition_duration": "1 minute"
  },
  "targeting": { "type": "single", "range": 60 },
  "saving_throw": { "ability": "wisdom", "effect_on_save": "negates" },
  "components": { "verbal": true, "somatic": true },
  "concentration": true,
  "duration": "1 minute"
}`,
        inputSchema: AttemptArcaneSynthesisArgsSchema
    },

    GET_SYNTHESIZED_SPELLS: {
        name: 'get_synthesized_spells',
        description: 'Get all spells a character has permanently learned through Arcane Synthesis.',
        inputSchema: z.object({
            character_id: z.string(),
            school: z.enum([
                'abjuration', 'conjuration', 'divination', 'enchantment',
                'evocation', 'illusion', 'necromancy', 'transmutation'
            ]).optional()
        })
    }
} as const;

// ============================================================================
// TOOL HANDLERS
// ============================================================================

/**
 * Handle resolve_improvised_stunt
 */
export async function handleResolveImprovisedStunt(args: unknown, _ctx: SessionContext) {
    const parsed = ImprovisationTools.RESOLVE_IMPROVISED_STUNT.inputSchema.parse(args);
    const { charRepo } = ensureDb();

    // Create seeded RNG for reproducibility
    const seed = `stunt-${parsed.encounter_id}-${parsed.actor_id}-${Date.now()}`;
    const rng = seedrandom(seed);

    // Get actor stats for skill modifier
    let skillModifier = 0;
    try {
        const actor = charRepo.findById(String(parsed.actor_id));
        if (actor?.stats) {
            skillModifier = getSkillModifier(actor.stats as Record<string, number>, parsed.skill_check.skill);
        }
    } catch {
        // Actor not in DB, use 0 modifier
    }

    // Roll the skill check
    const d20Result = rollD20(parsed.skill_check.advantage, parsed.skill_check.disadvantage, rng);
    const total = d20Result.roll + skillModifier;

    // Determine success/failure
    const isNat20 = d20Result.roll === 20;
    const isNat1 = d20Result.roll === 1;
    const beatDC = total >= parsed.skill_check.dc;
    const criticalSuccess = isNat20 || (beatDC && total >= parsed.skill_check.dc + 10);
    const criticalFailure = isNat1 || (!beatDC && total <= parsed.skill_check.dc - 10);
    const success = isNat20 || (beatDC && !isNat1);

    // Build result
    const result: StuntResult = {
        success,
        roll: d20Result.roll,
        modifier: skillModifier,
        total,
        dc: parsed.skill_check.dc,
        critical_success: criticalSuccess,
        critical_failure: criticalFailure,
        narrative: '',
        audit_log: {
            seed,
            d20_rolls: d20Result.rolls,
            skill: parsed.skill_check.skill,
            advantage: parsed.skill_check.advantage,
            disadvantage: parsed.skill_check.disadvantage
        }
    };

    // Apply consequences
    if (success && parsed.consequences.success_damage) {
        const damageRoll = rollDice(parsed.consequences.success_damage, rng);
        let baseDamage = damageRoll.total;

        // Critical success doubles damage
        if (criticalSuccess) {
            baseDamage *= 2;
        }

        result.damage_dealt = baseDamage;
        result.targets_affected = [];

        // Build target name lookup map
        const targetNames: Map<string | number, string> = new Map();
        if (parsed.target_ids) {
            for (let i = 0; i < parsed.target_ids.length; i++) {
                const targetId = parsed.target_ids[i];
                try {
                    const char = charRepo.findById(String(targetId));
                    targetNames.set(targetId, char?.name || `Target ${i + 1}`);
                } catch {
                    targetNames.set(targetId, `Target ${i + 1}`);
                }
            }
        }

        // Apply to targets (simplified - in full impl would check saves)
        if (parsed.target_ids && parsed.target_types) {
            for (let i = 0; i < parsed.target_ids.length; i++) {
                let targetDamage = baseDamage;
                let saved = false;

                // Handle saving throw
                if (parsed.consequences.saving_throw) {
                    const saveRoll = Math.floor(rng() * 20) + 1;
                    saved = saveRoll >= parsed.consequences.saving_throw.dc;

                    if (saved && parsed.consequences.saving_throw.half_damage_on_save) {
                        targetDamage = Math.floor(targetDamage / 2);
                    } else if (saved) {
                        targetDamage = 0;
                    }
                }

                result.targets_affected.push({
                    id: parsed.target_ids[i],
                    name: targetNames.get(parsed.target_ids[i]) || `Target ${i + 1}`,
                    damage_taken: targetDamage,
                    saved,
                    condition_applied: !saved && parsed.consequences.apply_condition
                        ? parsed.consequences.apply_condition
                        : undefined
                });
            }
        }

        result.narrative = parsed.narrative_on_success ||
            `The stunt succeeds spectacularly! ${result.damage_dealt} ${parsed.consequences.damage_type || ''} damage dealt.`;
    } else if (!success) {
        // Failure
        if (criticalFailure && parsed.consequences.failure_damage) {
            const selfDamage = rollDice(parsed.consequences.failure_damage, rng);
            result.self_damage = selfDamage.total;
            result.narrative = parsed.narrative_on_failure ||
                `Critical failure! The stunt backfires, dealing ${result.self_damage} damage to the actor.`;
        } else {
            result.narrative = parsed.narrative_on_failure ||
                `The stunt fails. The attempt doesn't produce the intended effect.`;
        }
    }

    // Format output
    let output = `\n┌─────────────────────────────────────────┐\n`;
    output += `│ 🎭 IMPROVISED STUNT - RULE OF COOL\n`;
    output += `└─────────────────────────────────────────┘\n\n`;

    output += `📜 Intent: "${parsed.narrative_intent}"\n\n`;

    output += `🎲 ${parsed.skill_check.skill.toUpperCase()} Check (DC ${parsed.skill_check.dc})\n`;
    output += `   Roll: ${d20Result.roll}${d20Result.rolls.length > 1 ? ` (${d20Result.rolls.join(', ')})` : ''}`;
    output += ` + ${skillModifier} = ${total}\n`;

    if (isNat20) output += `   ⭐ NATURAL 20!\n`;
    if (isNat1) output += `   💥 NATURAL 1!\n`;

    output += `\n`;

    if (result.critical_success) {
        output += `✨ CRITICAL SUCCESS!\n`;
    } else if (result.success) {
        output += `✓ SUCCESS\n`;
    } else if (result.critical_failure) {
        output += `💥 CRITICAL FAILURE!\n`;
    } else {
        output += `✗ FAILURE\n`;
    }

    output += `\n${result.narrative}\n`;

    if (result.targets_affected && result.targets_affected.length > 0) {
        output += `\n🎯 Targets:\n`;
        for (const target of result.targets_affected) {
            output += `   • ${target.name}: ${target.damage_taken} damage`;
            if (target.saved) output += ` (saved)`;
            if (target.condition_applied) output += ` [${target.condition_applied}]`;
            output += `\n`;
        }
    }

    if (result.self_damage) {
        output += `\n⚠️ Self-damage: ${result.self_damage}\n`;
    }

    // Add audit log for transparency
    output += `\n<!-- STUNT_AUDIT\n${JSON.stringify(result.audit_log, null, 2)}\nSTUNT_AUDIT -->`;

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

/**
 * Handle apply_custom_effect
 */
export async function handleApplyCustomEffect(args: unknown, _ctx: SessionContext) {
    const parsed = ImprovisationTools.APPLY_CUSTOM_EFFECT.inputSchema.parse(args);
    const { effectsRepo } = ensureDb();

    const effect = effectsRepo.apply(parsed);

    let output = `\n┌─────────────────────────────────────────┐\n`;
    output += `│ ✨ CUSTOM EFFECT APPLIED\n`;
    output += `└─────────────────────────────────────────┘\n\n`;

    const categoryIcon = {
        boon: '🌟',
        curse: '💀',
        neutral: '⚖️',
        transformative: '🔮'
    }[effect.category];

    output += `${categoryIcon} ${effect.name}\n`;
    output += `   ${effect.description || 'No description'}\n\n`;

    output += `📊 Details:\n`;
    output += `   Source: ${effect.source_type}${effect.source_entity_name ? ` (${effect.source_entity_name})` : ''}\n`;
    output += `   Power Level: ${'★'.repeat(effect.power_level)}${'☆'.repeat(5 - effect.power_level)}\n`;
    output += `   Duration: ${effect.duration_type}${effect.duration_value ? ` (${effect.duration_value})` : ''}\n`;

    if (effect.rounds_remaining !== null) {
        output += `   Rounds Remaining: ${effect.rounds_remaining}\n`;
    }

    if (effect.stackable) {
        output += `   Stacks: ${effect.current_stacks}/${effect.max_stacks}\n`;
    }

    output += `\n📋 Mechanics:\n`;
    for (const mechanic of effect.mechanics) {
        output += `   • ${mechanic.type}: ${mechanic.value}${mechanic.condition ? ` (${mechanic.condition})` : ''}\n`;
    }

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

/**
 * Handle get_custom_effects
 */
export async function handleGetCustomEffects(args: unknown, _ctx: SessionContext) {
    const parsed = ImprovisationTools.GET_CUSTOM_EFFECTS.inputSchema.parse(args);
    const { effectsRepo } = ensureDb();

    const effects = effectsRepo.getEffectsOnTarget(
        parsed.target_id,
        parsed.target_type as ActorType,
        {
            category: parsed.category,
            source_type: parsed.source_type,
            is_active: parsed.include_inactive ? undefined : true
        }
    );

    let output = `\n┌─────────────────────────────────────────┐\n`;
    output += `│ 📋 EFFECTS ON ${parsed.target_id}\n`;
    output += `└─────────────────────────────────────────┘\n\n`;

    if (effects.length === 0) {
        output += `No active effects found.\n`;
    } else {
        const boons = effects.filter(e => e.category === 'boon');
        const curses = effects.filter(e => e.category === 'curse');
        const others = effects.filter(e => e.category !== 'boon' && e.category !== 'curse');

        if (boons.length > 0) {
            output += `🌟 BOONS:\n`;
            for (const effect of boons) {
                output += formatEffectSummary(effect);
            }
            output += `\n`;
        }

        if (curses.length > 0) {
            output += `💀 CURSES:\n`;
            for (const effect of curses) {
                output += formatEffectSummary(effect);
            }
            output += `\n`;
        }

        if (others.length > 0) {
            output += `⚖️ OTHER EFFECTS:\n`;
            for (const effect of others) {
                output += formatEffectSummary(effect);
            }
        }
    }

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

function formatEffectSummary(effect: CustomEffect): string {
    let str = `   • ${effect.name}`;
    if (effect.power_level) {
        str += ` [${'★'.repeat(effect.power_level)}]`;
    }
    if (effect.rounds_remaining !== null) {
        str += ` (${effect.rounds_remaining} rounds)`;
    } else if (effect.duration_type !== 'permanent' && effect.duration_type !== 'until_removed') {
        str += ` (${effect.duration_type})`;
    }
    if (!effect.is_active) {
        str += ` [INACTIVE]`;
    }
    str += `\n`;
    return str;
}

/**
 * Handle remove_custom_effect
 */
export async function handleRemoveCustomEffect(args: unknown, _ctx: SessionContext) {
    const parsed = ImprovisationTools.REMOVE_CUSTOM_EFFECT.inputSchema.parse(args);

    // Validate that either effect_id or (target_id, target_type, effect_name) are provided
    if (parsed.effect_id === undefined &&
        !(parsed.target_id && parsed.target_type && parsed.effect_name)) {
        throw new Error('Must provide either effect_id or (target_id, target_type, effect_name)');
    }

    const { effectsRepo } = ensureDb();

    let removed = false;
    let effectName = '';

    if (parsed.effect_id !== undefined) {
        const effect = effectsRepo.findById(parsed.effect_id);
        effectName = effect?.name || `ID ${parsed.effect_id}`;
        removed = effectsRepo.remove(parsed.effect_id);
    } else if (parsed.target_id && parsed.target_type && parsed.effect_name) {
        effectName = parsed.effect_name;
        removed = effectsRepo.removeByName(parsed.target_id, parsed.target_type as ActorType, parsed.effect_name);
    }

    let output = `\n`;
    if (removed) {
        output += `✓ Effect "${effectName}" has been removed.\n`;
    } else {
        output += `⚠️ Effect "${effectName}" not found or already removed.\n`;
    }

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

/**
 * Handle process_effect_triggers
 */
export async function handleProcessEffectTriggers(args: unknown, _ctx: SessionContext) {
    const parsed = ImprovisationTools.PROCESS_EFFECT_TRIGGERS.inputSchema.parse(args);
    const { effectsRepo } = ensureDb();

    const triggeredEffects = effectsRepo.getEffectsByTrigger(
        parsed.target_id,
        parsed.target_type as ActorType,
        parsed.event as TriggerEvent
    );

    let output = `\n┌─────────────────────────────────────────┐\n`;
    output += `│ ⚡ EFFECT TRIGGERS: ${parsed.event.toUpperCase()}\n`;
    output += `└─────────────────────────────────────────┘\n\n`;

    if (triggeredEffects.length === 0) {
        output += `No effects triggered by ${parsed.event}.\n`;
    } else {
        output += `${triggeredEffects.length} effect(s) triggered:\n\n`;

        for (const effect of triggeredEffects) {
            output += `🔮 ${effect.name}\n`;
            for (const mechanic of effect.mechanics) {
                output += `   → ${mechanic.type}: ${mechanic.value}`;
                if (mechanic.condition) {
                    output += ` (${mechanic.condition})`;
                }
                output += `\n`;
            }
            output += `\n`;
        }
    }

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

/**
 * Handle advance_effect_durations
 */
export async function handleAdvanceEffectDurations(args: unknown, _ctx: SessionContext) {
    const parsed = ImprovisationTools.ADVANCE_EFFECT_DURATIONS.inputSchema.parse(args);
    const { effectsRepo } = ensureDb();

    const { advanced, expired } = effectsRepo.advanceRounds(
        parsed.target_id,
        parsed.target_type as ActorType,
        parsed.rounds
    );

    // Also cleanup time-based expired effects
    const cleanedUp = effectsRepo.cleanupExpired();

    let output = `\n┌─────────────────────────────────────────┐\n`;
    output += `│ ⏱️ EFFECT DURATIONS ADVANCED\n`;
    output += `└─────────────────────────────────────────┘\n\n`;

    output += `Advanced ${parsed.rounds} round(s).\n\n`;

    if (expired.length > 0) {
        output += `💨 EXPIRED EFFECTS:\n`;
        for (const effect of expired) {
            output += `   • ${effect.name}\n`;
        }
        output += `\n`;
    }

    if (advanced.length > 0) {
        output += `📋 REMAINING EFFECTS:\n`;
        for (const effect of advanced) {
            if (effect.rounds_remaining !== null) {
                output += `   • ${effect.name}: ${effect.rounds_remaining} rounds remaining\n`;
            } else {
                output += `   • ${effect.name}: ${effect.duration_type}\n`;
            }
        }
    }

    if (cleanedUp > 0) {
        output += `\n(Also cleaned up ${cleanedUp} time-expired effect(s))\n`;
    }

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

/**
 * Handle attempt_arcane_synthesis
 */
export async function handleAttemptArcaneSynthesis(args: unknown, _ctx: SessionContext) {
    const parsed = ImprovisationTools.ATTEMPT_ARCANE_SYNTHESIS.inputSchema.parse(args);
    const { db, charRepo } = ensureDb();

    // Create seeded RNG
    const seed = `synthesis-${parsed.caster_id}-${Date.now()}`;
    const rng = seedrandom(seed);

    // Get caster for spellcasting ability modifier
    let spellcastingModifier = 0;
    let casterName = 'Caster';
    let knownSpells: string[] = [];

    try {
        const caster = charRepo.findById(parsed.caster_id);
        if (caster) {
            casterName = caster.name;
            knownSpells = caster.knownSpells || [];

            // Use Intelligence as default spellcasting ability
            const stats = caster.stats as Record<string, number>;
            const intScore = stats.int ?? stats.intelligence ?? 10;
            spellcastingModifier = getAbilityModifier(intScore);

            // Add proficiency bonus based on level (simplified: level/4 + 2)
            const profBonus = Math.floor((caster.level || 1) / 4) + 2;
            spellcastingModifier += profBonus;
        }
    } catch {
        // Caster not in DB
    }

    // Calculate DC
    let dc = 10 + (parsed.estimated_level * 2);
    const dcBreakdown: ArcaneSynthesisResult['dc_breakdown'] = {
        base: 10,
        spell_level: parsed.estimated_level * 2
    };

    // Apply modifiers
    if (parsed.encounter_id !== undefined) {
        dc += 2;
        dcBreakdown.in_combat = 2;
    }

    // Check if novel effect (simplified: no related spell known)
    const hasRelatedSpell = knownSpells.some(spell =>
        spell.toLowerCase().includes(parsed.school) ||
        spell.toLowerCase().includes(parsed.effect_specification.type)
    );

    if (!hasRelatedSpell) {
        dc += 3;
        dcBreakdown.novel_effect = 3;
    } else {
        dc -= 2;
        dcBreakdown.related_spell = -2;
    }

    // Material component reduction
    if (parsed.components.material?.value) {
        const reduction = Math.min(5, Math.floor(parsed.components.material.value / 100));
        dc -= reduction;
        dcBreakdown.material_reduction = -reduction;
    }

    // Circumstance modifiers
    if (parsed.circumstance_modifiers) {
        for (const modifier of parsed.circumstance_modifiers) {
            const lowerMod = modifier.toLowerCase();
            if (lowerMod.includes('ley line') || lowerMod.includes('magical nexus')) {
                dc -= 3;
                dcBreakdown.ley_line = -3;
            }
            if (lowerMod.includes('blood moon') || lowerMod.includes('eclipse') || lowerMod.includes('celestial')) {
                dc -= 2;
                dcBreakdown.celestial_event = -2;
            }
            if (lowerMod.includes('desperation') || lowerMod.includes('urgency')) {
                dc += 2;
                dcBreakdown.desperation = 2;
            }
        }
    }

    // Roll the synthesis check
    const d20Roll = Math.floor(rng() * 20) + 1;
    const total = d20Roll + spellcastingModifier;

    // Determine outcome
    const isNat20 = d20Roll === 20;
    const isNat1 = d20Roll === 1;
    const beatDC = total >= dc;
    const margin = total - dc;

    let outcome: SynthesisOutcome;
    if (isNat20 || margin >= 10) {
        outcome = 'mastery';
    } else if (beatDC) {
        outcome = 'success';
    } else if (margin >= -5) {
        outcome = 'fizzle';
    } else if (isNat1 || margin <= -10) {
        outcome = 'catastrophic';
    } else {
        outcome = 'backfire';
    }

    // Build result
    const result: ArcaneSynthesisResult = {
        outcome,
        roll: d20Roll,
        modifier: spellcastingModifier,
        total,
        dc,
        dc_breakdown: dcBreakdown,
        spell_worked: outcome === 'mastery' || outcome === 'success',
        spell_mastered: outcome === 'mastery',
        spell_slot_consumed: outcome !== 'mastery', // Mastery doesn't consume slot
        narrative: '',
        audit_log: { seed, caster: casterName, dc_calculation: dcBreakdown }
    };

    // Handle outcomes
    const spellName = parsed.proposed_name || `${casterName}'s ${parsed.school} ${parsed.effect_specification.type}`;

    switch (outcome) {
        case 'mastery': {
            result.narrative = `MASTERY! ${casterName} has not only cast the spell successfully, but has permanently learned "${spellName}"!`;

            // Save synthesized spell to database
            const stmt = db.prepare(`
                INSERT INTO synthesized_spells (
                    character_id, name, level, school, effect_type, effect_dice, damage_type,
                    targeting_type, targeting_range, targeting_area_size, targeting_max_targets,
                    saving_throw_ability, saving_throw_effect,
                    components_verbal, components_somatic, components_material,
                    concentration, duration, synthesis_dc, created_at, mastered_at, times_cast
                ) VALUES (
                    @characterId, @name, @level, @school, @effectType, @effectDice, @damageType,
                    @targetingType, @targetingRange, @targetingAreaSize, @targetingMaxTargets,
                    @savingThrowAbility, @savingThrowEffect,
                    @componentsVerbal, @componentsSomatic, @componentsMaterial,
                    @concentration, @duration, @synthesisDc, @createdAt, @masteredAt, @timesCast
                )
            `);

            try {
                stmt.run({
                    characterId: parsed.caster_id,
                    name: spellName,
                    level: parsed.estimated_level,
                    school: parsed.school,
                    effectType: parsed.effect_specification.type,
                    effectDice: parsed.effect_specification.dice || null,
                    damageType: parsed.effect_specification.damage_type || null,
                    targetingType: parsed.targeting.type,
                    targetingRange: parsed.targeting.range,
                    targetingAreaSize: parsed.targeting.area_size || null,
                    targetingMaxTargets: parsed.targeting.max_targets || null,
                    savingThrowAbility: parsed.saving_throw?.ability || null,
                    savingThrowEffect: parsed.saving_throw?.effect_on_save || null,
                    componentsVerbal: parsed.components.verbal ? 1 : 0,
                    componentsSomatic: parsed.components.somatic ? 1 : 0,
                    componentsMaterial: parsed.components.material
                        ? JSON.stringify(parsed.components.material)
                        : null,
                    concentration: parsed.concentration ? 1 : 0,
                    duration: parsed.duration,
                    synthesisDc: dc,
                    createdAt: new Date().toISOString(),
                    masteredAt: new Date().toISOString(),
                    timesCast: 1
                });
            } catch {
                // Spell may already exist
            }

            // Calculate effect
            if (parsed.effect_specification.dice) {
                const effectRoll = rollDice(parsed.effect_specification.dice, rng);
                if (parsed.effect_specification.type === 'damage') {
                    result.damage_dealt = effectRoll.total;
                } else if (parsed.effect_specification.type === 'healing') {
                    result.healing_done = effectRoll.total;
                }
            }
            break;
        }

        case 'success': {
            result.narrative = `Success! ${casterName} successfully channels the magical energy. "${spellName}" takes effect!`;

            if (parsed.effect_specification.dice) {
                const effectRoll = rollDice(parsed.effect_specification.dice, rng);
                if (parsed.effect_specification.type === 'damage') {
                    result.damage_dealt = effectRoll.total;
                } else if (parsed.effect_specification.type === 'healing') {
                    result.healing_done = effectRoll.total;
                }
            }
            break;
        }

        case 'fizzle': {
            result.narrative = `Fizzle. The magic slips away as ${casterName} attempts to shape it. The spell slot is consumed, but nothing happens.`;
            break;
        }

        case 'backfire': {
            const backfireDamage = rollDice(`${parsed.estimated_level}d6`, rng);
            result.backfire_damage = backfireDamage.total;
            result.narrative = `BACKFIRE! The spell turns against ${casterName}, dealing ${result.backfire_damage} force damage!`;
            break;
        }

        case 'catastrophic': {
            // Roll on wild surge table
            const surgeRoll = Math.floor(rng() * 20) + 1;
            const wildSurge = WILD_SURGE_TABLE.find(ws => ws.roll === surgeRoll) || WILD_SURGE_TABLE[0];
            result.wild_surge = wildSurge;
            result.narrative = `CATASTROPHIC FAILURE! WILD SURGE!\n\n${wildSurge.name}: ${wildSurge.effect}`;
            break;
        }
    }

    // Format output
    let output = `\n┌─────────────────────────────────────────┐\n`;
    output += `│ 🔮 ARCANE SYNTHESIS\n`;
    output += `└─────────────────────────────────────────┘\n\n`;

    output += `📜 Intent: "${parsed.narrative_intent}"\n`;
    output += `📚 School: ${parsed.school.charAt(0).toUpperCase() + parsed.school.slice(1)}\n`;
    output += `⚡ Level: ${parsed.estimated_level}\n\n`;

    output += `🎲 Synthesis Check (DC ${dc})\n`;
    output += `   Roll: ${d20Roll} + ${spellcastingModifier} = ${total}\n`;

    if (isNat20) output += `   ⭐ NATURAL 20!\n`;
    if (isNat1) output += `   💥 NATURAL 1!\n`;

    output += `\n📊 DC Breakdown:\n`;
    output += `   Base: ${dcBreakdown.base}\n`;
    output += `   Spell Level (×2): +${dcBreakdown.spell_level}\n`;
    if (dcBreakdown.in_combat) output += `   In Combat: +${dcBreakdown.in_combat}\n`;
    if (dcBreakdown.novel_effect) output += `   Novel Effect: +${dcBreakdown.novel_effect}\n`;
    if (dcBreakdown.related_spell) output += `   Related Spell Known: ${dcBreakdown.related_spell}\n`;
    if (dcBreakdown.material_reduction) output += `   Material Components: ${dcBreakdown.material_reduction}\n`;
    if (dcBreakdown.ley_line) output += `   Ley Line: ${dcBreakdown.ley_line}\n`;
    if (dcBreakdown.celestial_event) output += `   Celestial Event: ${dcBreakdown.celestial_event}\n`;
    if (dcBreakdown.desperation) output += `   Desperation: +${dcBreakdown.desperation}\n`;

    output += `\n`;

    const outcomeEmoji = {
        mastery: '⭐',
        success: '✓',
        fizzle: '💨',
        backfire: '💥',
        catastrophic: '🌀'
    }[outcome];

    output += `${outcomeEmoji} OUTCOME: ${outcome.toUpperCase()}\n\n`;
    output += `${result.narrative}\n`;

    if (result.damage_dealt) {
        output += `\n💥 Damage: ${result.damage_dealt}${parsed.effect_specification.damage_type ? ` ${parsed.effect_specification.damage_type}` : ''}\n`;
    }

    if (result.healing_done) {
        output += `\n💚 Healing: ${result.healing_done}\n`;
    }

    if (result.backfire_damage) {
        output += `\n⚠️ Backfire Damage to Caster: ${result.backfire_damage}\n`;
    }

    if (result.wild_surge) {
        output += `\n🌀 WILD SURGE (Roll: ${result.wild_surge.roll})\n`;
        output += `   ${result.wild_surge.name}\n`;
        output += `   ${result.wild_surge.effect}\n`;
    }

    if (result.spell_mastered) {
        output += `\n📖 "${spellName}" has been added to your spellbook!\n`;
    }

    if (!result.spell_slot_consumed) {
        output += `\n✨ Spell slot preserved (mastery bonus)!\n`;
    }

    // Audit log
    output += `\n<!-- SYNTHESIS_AUDIT\n${JSON.stringify(result.audit_log, null, 2)}\nSYNTHESIS_AUDIT -->`;

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

/**
 * Handle get_synthesized_spells
 */
export async function handleGetSynthesizedSpells(args: unknown, _ctx: SessionContext) {
    const parsed = ImprovisationTools.GET_SYNTHESIZED_SPELLS.inputSchema.parse(args);
    const { db } = ensureDb();

    let query = 'SELECT * FROM synthesized_spells WHERE character_id = ?';
    const params: any[] = [parsed.character_id];

    if (parsed.school) {
        query += ' AND school = ?';
        params.push(parsed.school);
    }

    query += ' ORDER BY level, name';

    const stmt = db.prepare(query);
    const rows = stmt.all(...params) as any[];

    let output = `\n┌─────────────────────────────────────────┐\n`;
    output += `│ 📖 SYNTHESIZED SPELLBOOK\n`;
    output += `└─────────────────────────────────────────┘\n\n`;

    if (rows.length === 0) {
        output += `No synthesized spells found.\n`;
        output += `\nMaster spells through Arcane Synthesis to add them here!\n`;
    } else {
        // Group by level
        const byLevel: Record<number, any[]> = {};
        for (const row of rows) {
            if (!byLevel[row.level]) byLevel[row.level] = [];
            byLevel[row.level].push(row);
        }

        for (const level of Object.keys(byLevel).map(Number).sort()) {
            output += `═══ LEVEL ${level} ═══\n`;
            for (const spell of byLevel[level]) {
                output += `\n📜 ${spell.name}\n`;
                output += `   School: ${spell.school}\n`;
                output += `   Effect: ${spell.effect_type}`;
                if (spell.effect_dice) output += ` (${spell.effect_dice})`;
                if (spell.damage_type) output += ` ${spell.damage_type}`;
                output += `\n`;
                output += `   Range: ${spell.targeting_range}ft (${spell.targeting_type})\n`;
                if (spell.concentration) output += `   ⚡ Concentration\n`;
                output += `   Duration: ${spell.duration}\n`;
                output += `   Times Cast: ${spell.times_cast}\n`;
            }
            output += `\n`;
        }
    }

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}
