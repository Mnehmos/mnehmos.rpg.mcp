/**
 * Consolidated Improvisation Management Tool
 * Replaces 8 separate tools for stunts, custom effects, and arcane synthesis:
 * resolve_improvised_stunt, apply_custom_effect, get_custom_effects, remove_custom_effect,
 * process_effect_triggers, advance_effect_durations, attempt_arcane_synthesis, get_synthesized_spells
 */

import { z } from 'zod';
import seedrandom from 'seedrandom';
import { createActionRouter, ActionDefinition, McpResponse } from '../../utils/action-router.js';
import { SessionContext } from '../types.js';
import { RichFormatter } from '../utils/formatter.js';
import { getDb } from '../../storage/index.js';
import { CustomEffectsRepository } from '../../storage/repos/custom-effects.repo.js';
import { CharacterRepository } from '../../storage/repos/character.repo.js';
import {
    WILD_SURGE_TABLE,
    SKILL_TO_ABILITY,
    SkillName,
    TriggerEvent,
    ActorType
} from '../../schema/improvisation.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const ACTIONS = [
    'stunt', 'apply_effect', 'get_effects', 'remove_effect',
    'process_triggers', 'advance_durations', 'synthesize', 'get_spellbook'
] as const;
type ImprovisationAction = typeof ACTIONS[number];

const SkillEnum = z.enum([
    'acrobatics', 'animal_handling', 'arcana', 'athletics', 'deception',
    'history', 'insight', 'intimidation', 'investigation', 'medicine',
    'nature', 'perception', 'performance', 'persuasion', 'religion',
    'sleight_of_hand', 'stealth', 'survival'
]);

const DamageTypeEnum = z.enum([
    'bludgeoning', 'piercing', 'slashing', 'fire', 'cold', 'lightning',
    'thunder', 'poison', 'acid', 'necrotic', 'radiant', 'force', 'psychic'
]);

const SchoolEnum = z.enum([
    'abjuration', 'conjuration', 'divination', 'enchantment',
    'evocation', 'illusion', 'necromancy', 'transmutation'
]);

const TriggerEventEnum = z.enum([
    'always_active', 'start_of_turn', 'end_of_turn',
    'on_attack', 'on_hit', 'on_miss',
    'on_damage_taken', 'on_heal', 'on_rest',
    'on_spell_cast', 'on_death'
]);

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE HELPER
// ═══════════════════════════════════════════════════════════════════════════

function ensureDb() {
    const dbPath = process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db';
    const db = getDb(dbPath);
    const effectsRepo = new CustomEffectsRepository(db);
    const charRepo = new CharacterRepository(db);
    return { db, effectsRepo, charRepo };
}

// ═══════════════════════════════════════════════════════════════════════════
// DICE HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function rollDice(notation: string, rng?: seedrandom.PRNG): { total: number; rolls: number[]; notation: string } {
    const match = notation.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
    if (!match) throw new Error(`Invalid dice notation: ${notation}`);

    const count = parseInt(match[1], 10);
    const sides = parseInt(match[2], 10);
    const modifier = match[3] ? parseInt(match[3], 10) : 0;
    const rolls: number[] = [];
    const random = rng || Math.random;

    for (let i = 0; i < count; i++) {
        rolls.push(Math.floor(random() * sides) + 1);
    }

    return {
        total: Math.max(0, rolls.reduce((a, b) => a + b, 0) + modifier),
        rolls,
        notation
    };
}

function rollD20(advantage?: boolean, disadvantage?: boolean, rng?: seedrandom.PRNG): { roll: number; rolls: number[] } {
    const random = rng || Math.random;
    const roll1 = Math.floor(random() * 20) + 1;

    if (!advantage && !disadvantage) return { roll: roll1, rolls: [roll1] };

    const roll2 = Math.floor(random() * 20) + 1;

    if (advantage && !disadvantage) return { roll: Math.max(roll1, roll2), rolls: [roll1, roll2] };
    if (disadvantage && !advantage) return { roll: Math.min(roll1, roll2), rolls: [roll1, roll2] };
    return { roll: roll1, rolls: [roll1] };
}

function getSkillModifier(stats: Record<string, number>, skill: SkillName): number {
    const ability = SKILL_TO_ABILITY[skill];
    const abilityScore = stats[ability.substring(0, 3)] ?? stats[ability] ?? 10;
    return Math.floor((abilityScore - 10) / 2);
}

function getAbilityModifier(score: number): number {
    return Math.floor((score - 10) / 2);
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

const StuntSchema = z.object({
    action: z.literal('stunt'),
    encounterId: z.string().optional(),
    actorId: z.string(),
    actorType: z.enum(['character', 'npc']).default('character'),
    targetIds: z.array(z.string()).optional(),
    targetTypes: z.array(z.enum(['character', 'npc'])).optional(),
    narrativeIntent: z.string(),
    skill: SkillEnum,
    dc: z.number().int().min(5).max(35),
    advantage: z.boolean().optional(),
    disadvantage: z.boolean().optional(),
    actionCost: z.enum(['action', 'bonus_action', 'reaction', 'free']).default('action'),
    successDamage: z.string().optional(),
    failureDamage: z.string().optional(),
    damageType: DamageTypeEnum.optional(),
    applyCondition: z.string().optional(),
    savingThrowAbility: z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']).optional(),
    savingThrowDc: z.number().int().optional(),
    halfDamageOnSave: z.boolean().optional()
});

const ApplyEffectSchema = z.object({
    action: z.literal('apply_effect'),
    targetId: z.string(),
    targetType: z.enum(['character', 'npc']),
    name: z.string(),
    description: z.string().optional(),
    category: z.enum(['boon', 'curse', 'neutral', 'transformative']),
    powerLevel: z.number().int().min(1).max(5).default(1),
    sourceType: z.enum(['divine', 'arcane', 'natural', 'cursed', 'psionic', 'unknown']).default('unknown'),
    sourceEntityName: z.string().optional(),
    mechanics: z.array(z.object({
        type: z.string(),
        value: z.union([z.string(), z.number()]),
        condition: z.string().optional()
    })),
    durationType: z.enum(['rounds', 'minutes', 'hours', 'days', 'permanent', 'until_removed']),
    durationValue: z.number().int().optional(),
    triggers: z.array(z.object({
        event: TriggerEventEnum,
        condition: z.string().optional()
    })).optional()
});

const GetEffectsSchema = z.object({
    action: z.literal('get_effects'),
    targetId: z.string(),
    targetType: z.enum(['character', 'npc']),
    category: z.enum(['boon', 'curse', 'neutral', 'transformative']).optional(),
    sourceType: z.enum(['divine', 'arcane', 'natural', 'cursed', 'psionic', 'unknown']).optional(),
    includeInactive: z.boolean().optional().default(false)
});

const RemoveEffectSchema = z.object({
    action: z.literal('remove_effect'),
    effectId: z.number().int().optional(),
    targetId: z.string().optional(),
    targetType: z.enum(['character', 'npc']).optional(),
    effectName: z.string().optional()
});

const ProcessTriggersSchema = z.object({
    action: z.literal('process_triggers'),
    targetId: z.string(),
    targetType: z.enum(['character', 'npc']),
    event: TriggerEventEnum,
    context: z.record(z.any()).optional()
});

const AdvanceDurationsSchema = z.object({
    action: z.literal('advance_durations'),
    targetId: z.string(),
    targetType: z.enum(['character', 'npc']),
    rounds: z.number().int().min(1).default(1)
});

const SynthesizeSchema = z.object({
    action: z.literal('synthesize'),
    casterId: z.string(),
    casterType: z.enum(['character', 'npc']).default('character'),
    narrativeIntent: z.string(),
    proposedName: z.string().optional(),
    estimatedLevel: z.number().int().min(1).max(9),
    school: SchoolEnum,
    effectType: z.enum(['damage', 'healing', 'status', 'utility', 'control', 'summoning']),
    effectDice: z.string().optional(),
    damageType: DamageTypeEnum.optional(),
    condition: z.string().optional(),
    targetingType: z.enum(['self', 'single', 'multiple', 'area', 'line', 'cone']),
    targetingRange: z.number().int().min(0),
    areaSize: z.number().int().optional(),
    maxTargets: z.number().int().optional(),
    savingThrowAbility: z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']).optional(),
    savingThrowEffect: z.enum(['negates', 'half_damage', 'partial']).optional(),
    verbal: z.boolean().default(true),
    somatic: z.boolean().default(true),
    materialValue: z.number().int().optional(),
    concentration: z.boolean().default(false),
    duration: z.string().default('instantaneous'),
    encounterId: z.string().optional(),
    circumstanceModifiers: z.array(z.string()).optional()
});

const GetSpellbookSchema = z.object({
    action: z.literal('get_spellbook'),
    characterId: z.string(),
    school: SchoolEnum.optional()
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTION HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

async function handleStunt(args: z.infer<typeof StuntSchema>): Promise<object> {
    const { charRepo } = ensureDb();
    const seed = `stunt-${args.encounterId || 'free'}-${args.actorId}-${Date.now()}`;
    const rng = seedrandom(seed);

    let skillModifier = 0;
    let actorName = 'Actor';
    try {
        const actor = charRepo.findById(args.actorId);
        if (actor?.stats) {
            actorName = actor.name;
            skillModifier = getSkillModifier(actor.stats as Record<string, number>, args.skill);
        }
    } catch { /* use defaults */ }

    const d20Result = rollD20(args.advantage, args.disadvantage, rng);
    const total = d20Result.roll + skillModifier;
    const isNat20 = d20Result.roll === 20;
    const isNat1 = d20Result.roll === 1;
    const beatDC = total >= args.dc;
    const criticalSuccess = isNat20 || (beatDC && total >= args.dc + 10);
    const criticalFailure = isNat1 || (!beatDC && total <= args.dc - 10);
    const success = isNat20 || (beatDC && !isNat1);

    const result: any = {
        success,
        actionType: 'stunt',
        roll: d20Result.roll,
        rolls: d20Result.rolls,
        modifier: skillModifier,
        total,
        dc: args.dc,
        criticalSuccess,
        criticalFailure,
        skill: args.skill,
        actor: actorName
    };

    if (success && args.successDamage) {
        const damageRoll = rollDice(args.successDamage, rng);
        result.damage = criticalSuccess ? damageRoll.total * 2 : damageRoll.total;
        result.damageType = args.damageType || 'bludgeoning';

        if (args.targetIds) {
            result.targets = [];
            for (let i = 0; i < args.targetIds.length; i++) {
                let targetDamage = result.damage;
                let saved = false;

                if (args.savingThrowAbility && args.savingThrowDc) {
                    const saveRoll = Math.floor(rng() * 20) + 1;
                    saved = saveRoll >= args.savingThrowDc;
                    if (saved && args.halfDamageOnSave) targetDamage = Math.floor(targetDamage / 2);
                    else if (saved) targetDamage = 0;
                }

                result.targets.push({
                    id: args.targetIds[i],
                    damage: targetDamage,
                    saved,
                    condition: !saved && args.applyCondition ? args.applyCondition : undefined
                });
            }
        }
    } else if (!success && criticalFailure && args.failureDamage) {
        const selfDamage = rollDice(args.failureDamage, rng);
        result.selfDamage = selfDamage.total;
    }

    return result;
}

async function handleApplyEffect(args: z.infer<typeof ApplyEffectSchema>): Promise<object> {
    const { effectsRepo } = ensureDb();

    const effect = effectsRepo.apply({
        target_id: args.targetId,
        target_type: args.targetType,
        name: args.name,
        description: args.description || `${args.category} effect: ${args.name}`,
        category: args.category,
        power_level: args.powerLevel,
        source: { type: args.sourceType, entity_name: args.sourceEntityName },
        mechanics: args.mechanics as any,
        duration: { type: args.durationType as any, value: args.durationValue },
        triggers: args.triggers?.map(t => ({ event: t.event as any, condition: t.condition })) || [],
        removal_conditions: [{ type: 'duration_expires' as const }],
        stackable: false,
        max_stacks: 1
    });

    return {
        success: true,
        actionType: 'apply_effect',
        effect,
        message: `Effect "${args.name}" applied to ${args.targetId}`
    };
}

async function handleGetEffects(args: z.infer<typeof GetEffectsSchema>): Promise<object> {
    const { effectsRepo } = ensureDb();

    const effects = effectsRepo.getEffectsOnTarget(
        args.targetId,
        args.targetType as ActorType,
        {
            category: args.category,
            source_type: args.sourceType,
            is_active: args.includeInactive ? undefined : true
        }
    );

    return {
        success: true,
        actionType: 'get_effects',
        targetId: args.targetId,
        count: effects.length,
        boons: effects.filter(e => e.category === 'boon'),
        curses: effects.filter(e => e.category === 'curse'),
        other: effects.filter(e => e.category !== 'boon' && e.category !== 'curse'),
        effects
    };
}

async function handleRemoveEffect(args: z.infer<typeof RemoveEffectSchema>): Promise<object> {
    if (args.effectId === undefined && !(args.targetId && args.targetType && args.effectName)) {
        return { error: true, message: 'Must provide either effectId or (targetId, targetType, effectName)' };
    }

    const { effectsRepo } = ensureDb();
    let removed = false;
    let effectName = '';

    if (args.effectId !== undefined) {
        const effect = effectsRepo.findById(args.effectId);
        effectName = effect?.name || `ID ${args.effectId}`;
        removed = effectsRepo.remove(args.effectId);
    } else if (args.targetId && args.targetType && args.effectName) {
        effectName = args.effectName;
        removed = effectsRepo.removeByName(args.targetId, args.targetType as ActorType, args.effectName);
    }

    return {
        success: removed,
        actionType: 'remove_effect',
        effectName,
        message: removed ? `Effect "${effectName}" removed` : `Effect "${effectName}" not found`
    };
}

async function handleProcessTriggers(args: z.infer<typeof ProcessTriggersSchema>): Promise<object> {
    const { effectsRepo } = ensureDb();

    const triggeredEffects = effectsRepo.getEffectsByTrigger(
        args.targetId,
        args.targetType as ActorType,
        args.event as TriggerEvent
    );

    return {
        success: true,
        actionType: 'process_triggers',
        event: args.event,
        targetId: args.targetId,
        triggeredCount: triggeredEffects.length,
        effects: triggeredEffects.map(e => ({
            name: e.name,
            mechanics: e.mechanics
        }))
    };
}

async function handleAdvanceDurations(args: z.infer<typeof AdvanceDurationsSchema>): Promise<object> {
    const { effectsRepo } = ensureDb();

    const { advanced, expired } = effectsRepo.advanceRounds(
        args.targetId,
        args.targetType as ActorType,
        args.rounds
    );

    const cleanedUp = effectsRepo.cleanupExpired();

    return {
        success: true,
        actionType: 'advance_durations',
        rounds: args.rounds,
        expiredCount: expired.length,
        expiredEffects: expired.map(e => e.name),
        remainingCount: advanced.length,
        remainingEffects: advanced.map(e => ({
            name: e.name,
            roundsRemaining: e.rounds_remaining
        })),
        cleanedUp
    };
}

async function handleSynthesize(args: z.infer<typeof SynthesizeSchema>): Promise<object> {
    const { db, charRepo } = ensureDb();
    const seed = `synthesis-${args.casterId}-${Date.now()}`;
    const rng = seedrandom(seed);

    let spellcastingModifier = 0;
    let casterName = 'Caster';
    let knownSpells: string[] = [];

    try {
        const caster = charRepo.findById(args.casterId);
        if (caster) {
            casterName = caster.name;
            knownSpells = caster.knownSpells || [];
            const stats = caster.stats as Record<string, number>;
            const intScore = stats.int ?? stats.intelligence ?? 10;
            spellcastingModifier = getAbilityModifier(intScore);
            const profBonus = Math.floor((caster.level || 1) / 4) + 2;
            spellcastingModifier += profBonus;
        }
    } catch { /* use defaults */ }

    // Calculate DC
    let dc = 10 + (args.estimatedLevel * 2);
    const dcBreakdown: Record<string, number> = {
        base: 10,
        spellLevel: args.estimatedLevel * 2
    };

    if (args.encounterId) {
        dc += 2;
        dcBreakdown.inCombat = 2;
    }

    const hasRelatedSpell = knownSpells.some(spell =>
        spell.toLowerCase().includes(args.school) ||
        spell.toLowerCase().includes(args.effectType)
    );

    if (!hasRelatedSpell) {
        dc += 3;
        dcBreakdown.novelEffect = 3;
    } else {
        dc -= 2;
        dcBreakdown.relatedSpell = -2;
    }

    if (args.materialValue) {
        const reduction = Math.min(5, Math.floor(args.materialValue / 100));
        dc -= reduction;
        dcBreakdown.materialReduction = -reduction;
    }

    if (args.circumstanceModifiers) {
        for (const modifier of args.circumstanceModifiers) {
            const lowerMod = modifier.toLowerCase();
            if (lowerMod.includes('ley line') || lowerMod.includes('magical nexus')) {
                dc -= 3;
                dcBreakdown.leyLine = -3;
            }
            if (lowerMod.includes('blood moon') || lowerMod.includes('eclipse')) {
                dc -= 2;
                dcBreakdown.celestialEvent = -2;
            }
            if (lowerMod.includes('desperation') || lowerMod.includes('urgency')) {
                dc += 2;
                dcBreakdown.desperation = 2;
            }
        }
    }

    const d20Roll = Math.floor(rng() * 20) + 1;
    const total = d20Roll + spellcastingModifier;
    const isNat20 = d20Roll === 20;
    const isNat1 = d20Roll === 1;
    const margin = total - dc;

    let outcome: string;
    if (isNat20 || margin >= 10) outcome = 'mastery';
    else if (total >= dc) outcome = 'success';
    else if (margin >= -5) outcome = 'fizzle';
    else if (isNat1 || margin <= -10) outcome = 'catastrophic';
    else outcome = 'backfire';

    const spellName = args.proposedName || `${casterName}'s ${args.school} ${args.effectType}`;
    const result: any = {
        success: outcome === 'mastery' || outcome === 'success',
        actionType: 'synthesize',
        outcome,
        roll: d20Roll,
        modifier: spellcastingModifier,
        total,
        dc,
        dcBreakdown,
        spellName,
        spellMastered: outcome === 'mastery',
        spellSlotConsumed: outcome !== 'mastery'
    };

    if (outcome === 'mastery' || outcome === 'success') {
        if (args.effectDice) {
            const effectRoll = rollDice(args.effectDice, rng);
            if (args.effectType === 'damage') result.damage = effectRoll.total;
            else if (args.effectType === 'healing') result.healing = effectRoll.total;
        }

        if (outcome === 'mastery') {
            // Save to spellbook
            try {
                const stmt = db.prepare(`
                    INSERT INTO synthesized_spells (
                        character_id, name, level, school, effect_type, effect_dice, damage_type,
                        targeting_type, targeting_range, targeting_area_size, targeting_max_targets,
                        saving_throw_ability, saving_throw_effect,
                        components_verbal, components_somatic, components_material,
                        concentration, duration, synthesis_dc, created_at, mastered_at, times_cast
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);
                stmt.run(
                    args.casterId, spellName, args.estimatedLevel, args.school, args.effectType,
                    args.effectDice || null, args.damageType || null,
                    args.targetingType, args.targetingRange, args.areaSize || null, args.maxTargets || null,
                    args.savingThrowAbility || null, args.savingThrowEffect || null,
                    args.verbal ? 1 : 0, args.somatic ? 1 : 0, args.materialValue ? `{"value": ${args.materialValue}}` : null,
                    args.concentration ? 1 : 0, args.duration, dc,
                    new Date().toISOString(), new Date().toISOString(), 1
                );
                result.addedToSpellbook = true;
            } catch { result.addedToSpellbook = false; }
        }
    } else if (outcome === 'backfire') {
        const backfireDamage = rollDice(`${args.estimatedLevel}d6`, rng);
        result.backfireDamage = backfireDamage.total;
    } else if (outcome === 'catastrophic') {
        const surgeRoll = Math.floor(rng() * 20) + 1;
        const wildSurge = WILD_SURGE_TABLE.find(ws => ws.roll === surgeRoll) || WILD_SURGE_TABLE[0];
        result.wildSurge = wildSurge;
    }

    return result;
}

async function handleGetSpellbook(args: z.infer<typeof GetSpellbookSchema>): Promise<object> {
    const { db } = ensureDb();

    let query = 'SELECT * FROM synthesized_spells WHERE character_id = ?';
    const params: any[] = [args.characterId];

    if (args.school) {
        query += ' AND school = ?';
        params.push(args.school);
    }
    query += ' ORDER BY level, name';

    const stmt = db.prepare(query);
    const rows = stmt.all(...params) as any[];

    const byLevel: Record<number, any[]> = {};
    for (const row of rows) {
        if (!byLevel[row.level]) byLevel[row.level] = [];
        byLevel[row.level].push(row);
    }

    return {
        success: true,
        actionType: 'get_spellbook',
        characterId: args.characterId,
        count: rows.length,
        spellsByLevel: byLevel,
        spells: rows
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION ROUTER
// ═══════════════════════════════════════════════════════════════════════════

const definitions: Record<ImprovisationAction, ActionDefinition> = {
    stunt: {
        schema: StuntSchema,
        handler: handleStunt,
        aliases: ['resolve_stunt', 'rule_of_cool', 'improvise'],
        description: 'Resolve an improvised action using Rule of Cool'
    },
    apply_effect: {
        schema: ApplyEffectSchema,
        handler: handleApplyEffect,
        aliases: ['add_effect', 'boon', 'curse'],
        description: 'Apply a custom effect (boon/curse)'
    },
    get_effects: {
        schema: GetEffectsSchema,
        handler: handleGetEffects,
        aliases: ['list_effects', 'effects'],
        description: 'Get all effects on a target'
    },
    remove_effect: {
        schema: RemoveEffectSchema,
        handler: handleRemoveEffect,
        aliases: ['delete_effect', 'dispel'],
        description: 'Remove a custom effect'
    },
    process_triggers: {
        schema: ProcessTriggersSchema,
        handler: handleProcessTriggers,
        aliases: ['fire_triggers', 'triggers'],
        description: 'Process effect triggers for an event'
    },
    advance_durations: {
        schema: AdvanceDurationsSchema,
        handler: handleAdvanceDurations,
        aliases: ['tick_effects', 'advance'],
        description: 'Advance effect durations by rounds'
    },
    synthesize: {
        schema: SynthesizeSchema,
        handler: handleSynthesize,
        aliases: ['arcane_synthesis', 'create_spell'],
        description: 'Attempt to create a spell on the fly'
    },
    get_spellbook: {
        schema: GetSpellbookSchema,
        handler: handleGetSpellbook,
        aliases: ['synthesized_spells', 'spellbook'],
        description: 'Get synthesized spells for a character'
    }
};

const router = createActionRouter({
    actions: ACTIONS,
    definitions,
    threshold: 0.6
});

// ═══════════════════════════════════════════════════════════════════════════
// TOOL DEFINITION & HANDLER
// ═══════════════════════════════════════════════════════════════════════════

export const ImprovisationManageTool = {
    name: 'improvisation_manage',
    description: `Manage improvised actions, custom effects, and arcane synthesis.
Actions: stunt, apply_effect, get_effects, remove_effect, process_triggers, advance_durations, synthesize, get_spellbook
Aliases: rule_of_cool->stunt, boon/curse->apply_effect, dispel->remove_effect, arcane_synthesis->synthesize

STUNT (Rule of Cool):
- DC 5-30 based on difficulty
- Supports advantage/disadvantage
- Critical success doubles damage
- Critical failure can cause self-damage

CUSTOM EFFECTS:
- Categories: boon, curse, neutral, transformative
- Power levels 1-5
- Duration types: rounds, minutes, hours, days, permanent

ARCANE SYNTHESIS:
- DC = 10 + (spell level x 2) + modifiers
- Outcomes: mastery (learned!), success, fizzle, backfire, catastrophic
- Mastery permanently adds spell to spellbook`,
    inputSchema: z.object({
        action: z.string().describe(`Action: ${ACTIONS.join(', ')}`),
        // Stunt params
        encounterId: z.string().optional(),
        actorId: z.string().optional(),
        actorType: z.enum(['character', 'npc']).optional(),
        targetIds: z.array(z.string()).optional(),
        targetTypes: z.array(z.enum(['character', 'npc'])).optional(),
        narrativeIntent: z.string().optional(),
        skill: z.string().optional(),
        dc: z.number().optional(),
        advantage: z.boolean().optional(),
        disadvantage: z.boolean().optional(),
        actionCost: z.string().optional(),
        successDamage: z.string().optional(),
        failureDamage: z.string().optional(),
        damageType: z.string().optional(),
        applyCondition: z.string().optional(),
        savingThrowAbility: z.string().optional(),
        savingThrowDc: z.number().optional(),
        halfDamageOnSave: z.boolean().optional(),
        // Effect params
        targetId: z.string().optional(),
        targetType: z.string().optional(),
        name: z.string().optional(),
        description: z.string().optional(),
        category: z.string().optional(),
        powerLevel: z.number().optional(),
        sourceType: z.string().optional(),
        sourceEntityName: z.string().optional(),
        mechanics: z.array(z.any()).optional(),
        durationType: z.string().optional(),
        durationValue: z.number().optional(),
        triggers: z.array(z.any()).optional(),
        effectId: z.number().optional(),
        effectName: z.string().optional(),
        includeInactive: z.boolean().optional(),
        event: z.string().optional(),
        context: z.record(z.any()).optional(),
        rounds: z.number().optional(),
        // Synthesis params
        casterId: z.string().optional(),
        casterType: z.string().optional(),
        proposedName: z.string().optional(),
        estimatedLevel: z.number().optional(),
        school: z.string().optional(),
        effectType: z.string().optional(),
        effectDice: z.string().optional(),
        condition: z.string().optional(),
        targetingType: z.string().optional(),
        targetingRange: z.number().optional(),
        areaSize: z.number().optional(),
        maxTargets: z.number().optional(),
        savingThrowEffect: z.string().optional(),
        verbal: z.boolean().optional(),
        somatic: z.boolean().optional(),
        materialValue: z.number().optional(),
        concentration: z.boolean().optional(),
        duration: z.string().optional(),
        circumstanceModifiers: z.array(z.string()).optional(),
        characterId: z.string().optional()
    })
};

export async function handleImprovisationManage(args: unknown, _ctx: SessionContext): Promise<McpResponse> {
    const result = await router(args as Record<string, unknown>);
    const parsed = JSON.parse(result.content[0].text);

    let output = '';

    if (parsed.error) {
        output = RichFormatter.header('Error', '');
        output += RichFormatter.alert(parsed.message || 'Unknown error', 'error');
        if (parsed.suggestions) {
            output += '\n**Did you mean:**\n';
            parsed.suggestions.forEach((s: { action: string; similarity: number }) => {
                output += `  - ${s.action} (${s.similarity}% match)\n`;
            });
        }
    } else {
        switch (parsed.actionType) {
            case 'stunt':
                output = RichFormatter.header('Improvised Stunt', '');
                output += RichFormatter.keyValue({
                    'Skill': parsed.skill?.toUpperCase(),
                    'Roll': `${parsed.roll}${parsed.rolls?.length > 1 ? ` (${parsed.rolls.join(', ')})` : ''} + ${parsed.modifier} = ${parsed.total}`,
                    'DC': parsed.dc,
                    'Result': parsed.criticalSuccess ? 'CRITICAL SUCCESS!' : parsed.criticalFailure ? 'CRITICAL FAILURE!' : parsed.success ? 'Success' : 'Failure'
                });
                if (parsed.damage) output += `\nDamage: ${parsed.damage} ${parsed.damageType}\n`;
                if (parsed.selfDamage) output += `\nBackfire damage: ${parsed.selfDamage}\n`;
                break;

            case 'apply_effect':
                output = RichFormatter.header('Effect Applied', '');
                output += RichFormatter.keyValue({
                    'Name': parsed.effect?.name,
                    'Category': parsed.effect?.category,
                    'Power Level': parsed.effect?.power_level
                });
                break;

            case 'get_effects':
                output = RichFormatter.header(`Effects on ${parsed.targetId}`, '');
                output += `Total: ${parsed.count}\n`;
                if (parsed.boons?.length) {
                    output += '\nBoons:\n';
                    parsed.boons.forEach((e: any) => output += `  - ${e.name}\n`);
                }
                if (parsed.curses?.length) {
                    output += '\nCurses:\n';
                    parsed.curses.forEach((e: any) => output += `  - ${e.name}\n`);
                }
                break;

            case 'remove_effect':
                output = RichFormatter.header('Effect Removal', '');
                output += parsed.success ? `Removed: ${parsed.effectName}\n` : `Not found: ${parsed.effectName}\n`;
                break;

            case 'process_triggers':
                output = RichFormatter.header(`Triggers: ${parsed.event}`, '');
                output += `${parsed.triggeredCount} effect(s) triggered\n`;
                if (parsed.effects?.length) {
                    parsed.effects.forEach((e: any) => output += `  - ${e.name}\n`);
                }
                break;

            case 'advance_durations':
                output = RichFormatter.header('Durations Advanced', '');
                output += `Advanced ${parsed.rounds} round(s)\n`;
                if (parsed.expiredEffects?.length) {
                    output += `\nExpired: ${parsed.expiredEffects.join(', ')}\n`;
                }
                break;

            case 'synthesize':
                output = RichFormatter.header('Arcane Synthesis', '');
                output += RichFormatter.keyValue({
                    'Spell': parsed.spellName,
                    'Roll': `${parsed.roll} + ${parsed.modifier} = ${parsed.total}`,
                    'DC': parsed.dc,
                    'Outcome': parsed.outcome.toUpperCase()
                });
                if (parsed.spellMastered) output += '\nSpell mastered and added to spellbook!\n';
                if (parsed.damage) output += `\nDamage: ${parsed.damage}\n`;
                if (parsed.healing) output += `\nHealing: ${parsed.healing}\n`;
                if (parsed.backfireDamage) output += `\nBackfire damage: ${parsed.backfireDamage}\n`;
                if (parsed.wildSurge) output += `\nWILD SURGE: ${parsed.wildSurge.name} - ${parsed.wildSurge.effect}\n`;
                break;

            case 'get_spellbook':
                output = RichFormatter.header('Synthesized Spellbook', '');
                output += `Total spells: ${parsed.count}\n`;
                if (parsed.spellsByLevel) {
                    for (const [level, spells] of Object.entries(parsed.spellsByLevel as Record<string, any[]>)) {
                        output += `\nLevel ${level}:\n`;
                        spells.forEach((s: any) => output += `  - ${s.name} (${s.school})\n`);
                    }
                }
                break;

            default:
                output = RichFormatter.header('Improvisation', '');
                if (parsed.message) output += parsed.message + '\n';
        }
    }

    output += RichFormatter.embedJson(parsed, 'IMPROVISATION_MANAGE');

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}
