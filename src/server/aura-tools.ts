import { z } from 'zod';
import { SessionContext } from './types.js';
import { getDb } from '../storage/index.js';
import { AuraRepository } from '../storage/repos/aura.repo.js';
import { EncounterRepository } from '../storage/repos/encounter.repo.js';
import { CharacterRepository } from '../storage/repos/character.repo.js';
import { ConcentrationRepository } from '../storage/repos/concentration.repo.js';
import {
    createAura,
    endAura,
    endAurasByOwner,
    getActiveAuras,
    checkAuraEffectsForTarget,
    expireOldAuras,
} from '../engine/magic/aura.js';
import { startConcentration, breakConcentration } from '../engine/magic/concentration.js';
import { CreateAuraRequestSchema, AuraTriggerSchema, AuraState, AuraEffectResult } from '../schema/aura.js';

/**
 * Aura Management Tools
 * Handles creation, querying, and processing of area-effect auras
 */

export const AuraTools = {
    CREATE_AURA: {
        name: 'create_aura',
        description: 'Create a new aura effect centered on a character (e.g., Spirit Guardians, Aura of Protection). Auras move with their owner and affect targets within radius. Optionally requires concentration.',
        inputSchema: z.object({
            ownerId: z.string().describe('The ID of the character creating the aura'),
            spellName: z.string().describe('Name of the spell or ability creating the aura'),
            spellLevel: z.number().int().min(0).max(9).describe('Spell level (0-9)'),
            radius: z.number().int().min(1).describe('Radius in feet (e.g., 15 for Spirit Guardians)'),
            affectsAllies: z.boolean().default(false).describe('Whether the aura affects allied creatures'),
            affectsEnemies: z.boolean().default(false).describe('Whether the aura affects enemy creatures'),
            affectsSelf: z.boolean().default(false).describe('Whether the aura affects the caster'),
            effects: z.array(z.object({
                trigger: AuraTriggerSchema.describe('When the effect triggers (enter, exit, start_of_turn, end_of_turn)'),
                type: z.enum(['damage', 'buff', 'debuff', 'healing', 'condition', 'custom']).describe('Type of effect'),
                dice: z.string().optional().describe('Dice notation for damage/healing (e.g., "3d8")'),
                damageType: z.string().optional().describe('Damage type (e.g., "radiant", "necrotic")'),
                saveType: z.string().optional().describe('Ability for saving throw (e.g., "wisdom", "dexterity")'),
                saveDC: z.number().int().optional().describe('DC for saving throw'),
                conditions: z.array(z.string()).optional().describe('Conditions to apply (e.g., ["frightened"])'),
                description: z.string().optional().describe('Custom effect description'),
                bonusAmount: z.number().int().optional().describe('Bonus amount for buffs/debuffs'),
                bonusType: z.string().optional().describe('What the bonus applies to (e.g., "ac", "saves")'),
            })).describe('Array of effects the aura applies'),
            currentRound: z.number().int().min(1).describe('Current combat round number'),
            maxDuration: z.number().int().optional().describe('Maximum duration in rounds (omit for indefinite)'),
            requiresConcentration: z.boolean().default(false).describe('Whether the aura requires concentration'),
        }),
    },
    GET_ACTIVE_AURAS: {
        name: 'get_active_auras',
        description: 'List all currently active auras and their properties.',
        inputSchema: z.object({}),
    },
    GET_AURAS_AFFECTING_CHARACTER: {
        name: 'get_auras_affecting_character',
        description: 'Check which auras are currently affecting a specific character based on their position.',
        inputSchema: z.object({
            encounterId: z.string().describe('The encounter ID to check within'),
            characterId: z.string().describe('The character ID to check for affecting auras'),
        }),
    },
    PROCESS_AURA_EFFECTS: {
        name: 'process_aura_effects',
        description: 'Process aura effects for a target at a specific trigger (e.g., start of turn, entering an aura). Returns all effects that were triggered.',
        inputSchema: z.object({
            encounterId: z.string().describe('The encounter ID'),
            targetId: z.string().describe('The target character/creature ID'),
            trigger: AuraTriggerSchema.describe('When the effects trigger (enter, exit, start_of_turn, end_of_turn)'),
        }),
    },
    REMOVE_AURA: {
        name: 'remove_aura',
        description: 'Manually end an aura by ID (e.g., when concentration breaks or spell is dismissed).',
        inputSchema: z.object({
            auraId: z.string().describe('The ID of the aura to remove'),
        }),
    },
    REMOVE_CHARACTER_AURAS: {
        name: 'remove_character_auras',
        description: 'Remove all auras owned by a specific character (e.g., when they die or lose concentration).',
        inputSchema: z.object({
            characterId: z.string().describe('The ID of the character whose auras to remove'),
        }),
    },
    EXPIRE_AURAS: {
        name: 'expire_auras',
        description: 'Check for and remove any auras that have exceeded their duration.',
        inputSchema: z.object({
            currentRound: z.number().int().min(1).describe('Current combat round number'),
        }),
    },
} as const;

function ensureDb() {
    const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
    return {
        auraRepo: new AuraRepository(db),
        encounterRepo: new EncounterRepository(db),
        characterRepo: new CharacterRepository(db),
        concentrationRepo: new ConcentrationRepository(db),
    };
}

/**
 * Handle aura creation
 */
export async function handleCreateAura(args: unknown, _ctx: SessionContext) {
    const { auraRepo, characterRepo, concentrationRepo } = ensureDb();
    const parsed = CreateAuraRequestSchema.parse(args);

    // Verify character exists
    const character = characterRepo.findById(parsed.ownerId);
    if (!character) {
        throw new Error(`Character ${parsed.ownerId} not found`);
    }

    // If aura requires concentration, start concentration
    if (parsed.requiresConcentration) {
        startConcentration(
            parsed.ownerId,
            parsed.spellName,
            parsed.spellLevel,
            parsed.currentRound,
            parsed.maxDuration,
            undefined, // Auras don't track specific target IDs
            concentrationRepo,
            characterRepo
        );
    }

    // Create the aura
    const aura = createAura(parsed, auraRepo);

    return {
        content: [
            {
                type: 'text' as const,
                text: formatAuraCreated(aura, character.name),
            },
        ],
    };
}

/**
 * Handle get active auras
 */
export async function handleGetActiveAuras(args: unknown, _ctx: SessionContext) {
    const { auraRepo } = ensureDb();
    const auras = getActiveAuras(auraRepo);

    if (auras.length === 0) {
        return {
            content: [
                {
                    type: 'text' as const,
                    text: 'No active auras.',
                },
            ],
        };
    }

    return {
        content: [
            {
                type: 'text' as const,
                text: formatAuraList(auras),
            },
        ],
    };
}

/**
 * Handle get auras affecting character
 */
export async function handleGetAurasAffectingCharacter(args: unknown, _ctx: SessionContext) {
    const { auraRepo, encounterRepo } = ensureDb();
    const parsed = AuraTools.GET_AURAS_AFFECTING_CHARACTER.inputSchema.parse(args);

    const encounter = encounterRepo.findById(parsed.encounterId);
    if (!encounter) {
        throw new Error(`Encounter ${parsed.encounterId} not found`);
    }

    const target = encounter.tokens.find(t => t.id === parsed.characterId);
    if (!target) {
        throw new Error(`Character ${parsed.characterId} not found in encounter`);
    }

    if (!target.position) {
        return {
            content: [
                {
                    type: 'text' as const,
                    text: `Character ${parsed.characterId} has no position in the encounter.`,
                },
            ],
        };
    }

    // Get auras at the target's position
    const { getAurasAtPosition } = await import('../engine/magic/aura.js');
    const affectingAuras = getAurasAtPosition(encounter.tokens, target.position, auraRepo);

    if (affectingAuras.length === 0) {
        return {
            content: [
                {
                    type: 'text' as const,
                    text: `No auras are affecting ${target.name || parsed.characterId}.`,
                },
            ],
        };
    }

    return {
        content: [
            {
                type: 'text' as const,
                text: formatAffectingAuras(target.name || parsed.characterId, affectingAuras, encounter.tokens),
            },
        ],
    };
}

/**
 * Handle process aura effects
 */
export async function handleProcessAuraEffects(args: unknown, _ctx: SessionContext) {
    const { auraRepo, encounterRepo } = ensureDb();
    const parsed = AuraTools.PROCESS_AURA_EFFECTS.inputSchema.parse(args);

    const encounter = encounterRepo.findById(parsed.encounterId);
    if (!encounter) {
        throw new Error(`Encounter ${parsed.encounterId} not found`);
    }

    const results = checkAuraEffectsForTarget(
        encounter.tokens,
        parsed.targetId,
        parsed.trigger,
        auraRepo
    );

    if (results.length === 0) {
        return {
            content: [
                {
                    type: 'text' as const,
                    text: `No aura effects triggered for ${parsed.targetId} on ${parsed.trigger}.`,
                },
            ],
        };
    }

    return {
        content: [
            {
                type: 'text' as const,
                text: formatAuraEffectResults(results, encounter.tokens),
            },
        ],
    };
}

/**
 * Handle remove aura
 */
export async function handleRemoveAura(args: unknown, _ctx: SessionContext) {
    const { auraRepo, concentrationRepo, characterRepo } = ensureDb();
    const parsed = AuraTools.REMOVE_AURA.inputSchema.parse(args);

    const aura = auraRepo.findById(parsed.auraId);
    if (!aura) {
        return {
            content: [
                {
                    type: 'text' as const,
                    text: `Aura ${parsed.auraId} not found (may have already expired).`,
                },
            ],
        };
    }

    const auraName = aura.spellName;
    const removed = endAura(parsed.auraId, auraRepo);

    // If aura required concentration, break it
    if (aura.requiresConcentration) {
        const concentration = concentrationRepo.findByCharacterId(aura.ownerId);
        if (concentration && concentration.activeSpell === aura.spellName) {
            breakConcentration(
                { characterId: aura.ownerId, reason: 'voluntary' },
                concentrationRepo,
                characterRepo
            );
        }
    }

    return {
        content: [
            {
                type: 'text' as const,
                text: removed
                    ? `Aura "${auraName}" has been removed.`
                    : `Failed to remove aura ${parsed.auraId}.`,
            },
        ],
    };
}

/**
 * Handle remove character auras
 */
export async function handleRemoveCharacterAuras(args: unknown, _ctx: SessionContext) {
    const { auraRepo } = ensureDb();
    const parsed = AuraTools.REMOVE_CHARACTER_AURAS.inputSchema.parse(args);

    const count = endAurasByOwner(parsed.characterId, auraRepo);

    return {
        content: [
            {
                type: 'text' as const,
                text: count > 0
                    ? `Removed ${count} aura(s) from character ${parsed.characterId}.`
                    : `Character ${parsed.characterId} had no active auras.`,
            },
        ],
    };
}

/**
 * Handle expire auras
 */
export async function handleExpireAuras(args: unknown, _ctx: SessionContext) {
    const { auraRepo } = ensureDb();
    const parsed = AuraTools.EXPIRE_AURAS.inputSchema.parse(args);

    const expiredIds = expireOldAuras(parsed.currentRound, auraRepo);

    return {
        content: [
            {
                type: 'text' as const,
                text: expiredIds.length > 0
                    ? `Expired ${expiredIds.length} aura(s): ${expiredIds.join(', ')}`
                    : 'No auras expired this round.',
            },
        ],
    };
}

// ============================================================
// FORMATTING HELPERS
// ============================================================

function formatAuraCreated(aura: AuraState, ownerName: string): string {
    const concentrationText = aura.requiresConcentration ? ' (Requires Concentration)' : '';
    const durationText = aura.maxDuration
        ? ` for ${aura.maxDuration} rounds`
        : ' (indefinite duration)';

    const targetTypes = [];
    if (aura.affectsSelf) targetTypes.push('self');
    if (aura.affectsAllies) targetTypes.push('allies');
    if (aura.affectsEnemies) targetTypes.push('enemies');

    return `✨ Aura Created: ${aura.spellName}${concentrationText}

Owner: ${ownerName}
Radius: ${aura.radius} feet
Affects: ${targetTypes.join(', ')}
Duration: Started round ${aura.startedAt}${durationText}
Effects: ${aura.effects.length} effect(s)

${aura.effects.map((e, i) =>
    `  ${i + 1}. ${e.type} on ${e.trigger}${e.dice ? ` (${e.dice}${e.damageType ? ' ' + e.damageType : ''})` : ''}`
).join('\n')}`;
}

function formatAuraList(auras: AuraState[]): string {
    return `Active Auras (${auras.length}):

${auras.map((aura, i) =>
    `${i + 1}. ${aura.spellName} (ID: ${aura.id})
   Owner: ${aura.ownerId}
   Radius: ${aura.radius}ft | Started: Round ${aura.startedAt}${aura.maxDuration ? ` | Duration: ${aura.maxDuration} rounds` : ''}
   Targets: ${[aura.affectsSelf && 'self', aura.affectsAllies && 'allies', aura.affectsEnemies && 'enemies'].filter(Boolean).join(', ')}
   Effects: ${aura.effects.length}`
).join('\n\n')}`;
}

function formatAffectingAuras(targetName: string, auras: AuraState[], tokens: any[]): string {
    return `Auras Affecting ${targetName}:

${auras.map((aura, i) => {
    const owner = tokens.find(t => t.id === aura.ownerId);
    return `${i + 1}. ${aura.spellName} (Owner: ${owner?.name || aura.ownerId})
   Radius: ${aura.radius}ft
   Effects: ${aura.effects.map(e => `${e.type} on ${e.trigger}`).join(', ')}`;
}).join('\n\n')}`;
}

function formatAuraEffectResults(results: AuraEffectResult[], tokens: any[]): string {
    if (results.length === 0) {
        return 'No aura effects were triggered.';
    }

    const target = tokens.find(t => t.id === results[0].targetId);
    const targetName = target?.name || results[0].targetId;

    return `Aura Effects on ${targetName}:

${results.map((result, i) => {
    let text = `${i + 1}. ${result.auraName} (${result.trigger})`;

    if (result.saveRoll !== undefined && result.saveDC !== undefined) {
        text += `\n   Save: ${result.saveRoll} + mod = ${result.saveTotal} vs DC ${result.saveDC} - ${result.succeeded ? 'SUCCESS' : 'FAILURE'}`;
    }

    if (result.damageDealt !== undefined) {
        text += `\n   Damage: ${result.damageDealt} ${result.damageType || ''}`;
    }

    if (result.healingDone !== undefined) {
        text += `\n   Healing: ${result.healingDone}`;
    }

    if (result.conditionsApplied && result.conditionsApplied.length > 0) {
        text += `\n   Conditions: ${result.conditionsApplied.join(', ')}`;
    }

    if (result.description) {
        text += `\n   ${result.description}`;
    }

    return text;
}).join('\n\n')}`;
}
