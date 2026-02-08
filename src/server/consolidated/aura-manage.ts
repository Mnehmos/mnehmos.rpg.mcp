/**
 * Consolidated Aura Management Tool
 * Replaces 7 separate tools for area-effect aura handling:
 * create_aura, get_active_auras, get_auras_affecting_character,
 * process_aura_effects, remove_aura, remove_character_auras, expire_auras
 */

import { z } from 'zod';
import { createActionRouter, ActionDefinition, McpResponse } from '../../utils/action-router.js';
import { SessionContext } from '../types.js';
import { RichFormatter } from '../utils/formatter.js';
import { getDb } from '../../storage/index.js';
import { AuraRepository } from '../../storage/repos/aura.repo.js';
import { EncounterRepository } from '../../storage/repos/encounter.repo.js';
import { CharacterRepository } from '../../storage/repos/character.repo.js';
import { ConcentrationRepository } from '../../storage/repos/concentration.repo.js';
import {
    createAura,
    endAura,
    endAurasByOwner,
    getActiveAuras,
    checkAuraEffectsForTarget,
    expireOldAuras,
    getAurasAtPosition,
} from '../../engine/magic/aura.js';
import { startConcentration, breakConcentration } from '../../engine/magic/concentration.js';
import { AuraTriggerSchema } from '../../schema/aura.js';
import { Token } from '../../schema/encounter.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const ACTIONS = ['create', 'list', 'get_affecting', 'process', 'remove', 'remove_by_owner', 'expire'] as const;
type AuraManageAction = typeof ACTIONS[number];

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE HELPER
// ═══════════════════════════════════════════════════════════════════════════

function ensureDb() {
    const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
    return {
        auraRepo: new AuraRepository(db),
        encounterRepo: new EncounterRepository(db),
        characterRepo: new CharacterRepository(db),
        concentrationRepo: new ConcentrationRepository(db),
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

const AuraEffectSchema = z.object({
    trigger: AuraTriggerSchema.describe('When the effect triggers (enter, exit, start_of_turn, end_of_turn)'),
    type: z.enum(['damage', 'buff', 'debuff', 'healing', 'condition', 'custom']).describe('Type of effect'),
    dice: z.string().optional().describe('Dice notation for damage/healing (e.g., "3d8")'),
    damageType: z.string().optional().describe('Damage type (e.g., "radiant", "necrotic")'),
    saveType: z.string().optional().describe('Ability for saving throw'),
    saveDC: z.number().int().optional().describe('DC for saving throw'),
    conditions: z.array(z.string()).optional().describe('Conditions to apply'),
    description: z.string().optional().describe('Custom effect description'),
    bonusAmount: z.number().int().optional().describe('Bonus amount for buffs/debuffs'),
    bonusType: z.string().optional().describe('What the bonus applies to'),
});

const CreateSchema = z.object({
    action: z.literal('create'),
    ownerId: z.string().describe('ID of the character creating the aura'),
    spellName: z.string().describe('Name of the spell or ability'),
    spellLevel: z.number().int().min(0).max(9).describe('Spell level (0-9)'),
    radius: z.number().int().min(1).describe('Radius in feet'),
    affectsAllies: z.boolean().default(false),
    affectsEnemies: z.boolean().default(false),
    affectsSelf: z.boolean().default(false),
    effects: z.array(AuraEffectSchema).describe('Array of effects'),
    currentRound: z.number().int().min(1).describe('Current combat round'),
    maxDuration: z.number().int().optional().describe('Max duration in rounds'),
    requiresConcentration: z.boolean().default(false)
});

const ListSchema = z.object({
    action: z.literal('list')
});

const GetAffectingSchema = z.object({
    action: z.literal('get_affecting'),
    encounterId: z.string().describe('Encounter ID'),
    characterId: z.string().describe('Character ID to check')
});

const ProcessSchema = z.object({
    action: z.literal('process'),
    encounterId: z.string().describe('Encounter ID'),
    targetId: z.string().describe('Target character ID'),
    trigger: AuraTriggerSchema.describe('When effects trigger')
});

const RemoveSchema = z.object({
    action: z.literal('remove'),
    auraId: z.string().describe('Aura ID to remove')
});

const RemoveByOwnerSchema = z.object({
    action: z.literal('remove_by_owner'),
    characterId: z.string().describe('Owner character ID')
});

const ExpireSchema = z.object({
    action: z.literal('expire'),
    currentRound: z.number().int().min(1).describe('Current combat round')
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTION HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

async function handleCreate(args: z.infer<typeof CreateSchema>): Promise<object> {
    const { auraRepo, characterRepo, concentrationRepo } = ensureDb();

    // Verify character exists
    const character = characterRepo.findById(args.ownerId);
    if (!character) {
        return { error: true, message: `Character ${args.ownerId} not found` };
    }

    // If aura requires concentration, start concentration
    if (args.requiresConcentration) {
        startConcentration(
            args.ownerId,
            args.spellName,
            args.spellLevel,
            args.currentRound,
            args.maxDuration,
            undefined,
            concentrationRepo,
            characterRepo
        );
    }

    // Create the aura
    const aura = createAura({
        ownerId: args.ownerId,
        spellName: args.spellName,
        spellLevel: args.spellLevel,
        radius: args.radius,
        affectsAllies: args.affectsAllies,
        affectsEnemies: args.affectsEnemies,
        affectsSelf: args.affectsSelf,
        effects: args.effects,
        currentRound: args.currentRound,
        maxDuration: args.maxDuration,
        requiresConcentration: args.requiresConcentration
    }, auraRepo);

    return {
        success: true,
        actionType: 'create',
        auraId: aura.id,
        spellName: aura.spellName,
        owner: character.name,
        radius: aura.radius,
        effectCount: aura.effects.length,
        requiresConcentration: aura.requiresConcentration,
        message: `Created aura "${aura.spellName}" for ${character.name}`
    };
}

async function handleList(): Promise<object> {
    const { auraRepo } = ensureDb();
    const auras = getActiveAuras(auraRepo);

    return {
        success: true,
        actionType: 'list',
        count: auras.length,
        auras: auras.map(a => ({
            id: a.id,
            spellName: a.spellName,
            ownerId: a.ownerId,
            radius: a.radius,
            startedAt: a.startedAt,
            maxDuration: a.maxDuration,
            affectsSelf: a.affectsSelf,
            affectsAllies: a.affectsAllies,
            affectsEnemies: a.affectsEnemies,
            effectCount: a.effects.length
        }))
    };
}

async function handleGetAffecting(args: z.infer<typeof GetAffectingSchema>): Promise<object> {
    const { auraRepo, encounterRepo } = ensureDb();

    const encounter = encounterRepo.findById(args.encounterId);
    if (!encounter) {
        return { error: true, message: `Encounter ${args.encounterId} not found` };
    }

    const tokens: Token[] = typeof encounter.tokens === 'string'
        ? JSON.parse(encounter.tokens)
        : encounter.tokens;

    const target = tokens.find(t => t.id === args.characterId);
    if (!target) {
        return { error: true, message: `Character ${args.characterId} not found in encounter` };
    }

    if (!target.position) {
        return {
            success: true,
            actionType: 'get_affecting',
            characterId: args.characterId,
            characterName: target.name,
            count: 0,
            auras: [],
            message: `Character ${target.name} has no position`
        };
    }

    const affectingAuras = getAurasAtPosition(tokens, target.position, auraRepo);

    return {
        success: true,
        actionType: 'get_affecting',
        characterId: args.characterId,
        characterName: target.name,
        count: affectingAuras.length,
        auras: affectingAuras.map(a => ({
            id: a.id,
            spellName: a.spellName,
            ownerId: a.ownerId,
            radius: a.radius,
            effects: a.effects.map(e => ({ type: e.type, trigger: e.trigger }))
        }))
    };
}

async function handleProcess(args: z.infer<typeof ProcessSchema>): Promise<object> {
    const { auraRepo, encounterRepo } = ensureDb();

    const encounter = encounterRepo.findById(args.encounterId);
    if (!encounter) {
        return { error: true, message: `Encounter ${args.encounterId} not found` };
    }

    const tokens: Token[] = typeof encounter.tokens === 'string'
        ? JSON.parse(encounter.tokens)
        : encounter.tokens;

    const results = checkAuraEffectsForTarget(
        tokens,
        args.targetId,
        args.trigger,
        auraRepo
    );

    return {
        success: true,
        actionType: 'process',
        targetId: args.targetId,
        trigger: args.trigger,
        effectCount: results.length,
        effects: results.map(r => ({
            auraName: r.auraName,
            trigger: r.trigger,
            damageDealt: r.damageDealt,
            damageType: r.damageType,
            healingDone: r.healingDone,
            conditionsApplied: r.conditionsApplied,
            saveRoll: r.saveRoll,
            saveDC: r.saveDC,
            succeeded: r.succeeded
        }))
    };
}

async function handleRemove(args: z.infer<typeof RemoveSchema>): Promise<object> {
    const { auraRepo, concentrationRepo, characterRepo } = ensureDb();

    const aura = auraRepo.findById(args.auraId);
    if (!aura) {
        return { error: true, message: `Aura ${args.auraId} not found` };
    }

    const auraName = aura.spellName;
    const removed = endAura(args.auraId, auraRepo);

    // Break concentration if needed
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
        success: removed,
        actionType: 'remove',
        auraId: args.auraId,
        auraName,
        message: removed ? `Aura "${auraName}" removed` : `Failed to remove aura`
    };
}

async function handleRemoveByOwner(args: z.infer<typeof RemoveByOwnerSchema>): Promise<object> {
    const { auraRepo } = ensureDb();

    const count = endAurasByOwner(args.characterId, auraRepo);

    return {
        success: true,
        actionType: 'remove_by_owner',
        characterId: args.characterId,
        removedCount: count,
        message: count > 0 ? `Removed ${count} aura(s)` : 'No active auras to remove'
    };
}

async function handleExpire(args: z.infer<typeof ExpireSchema>): Promise<object> {
    const { auraRepo } = ensureDb();

    const expiredIds = expireOldAuras(args.currentRound, auraRepo);

    return {
        success: true,
        actionType: 'expire',
        currentRound: args.currentRound,
        expiredCount: expiredIds.length,
        expiredIds,
        message: expiredIds.length > 0
            ? `Expired ${expiredIds.length} aura(s)`
            : 'No auras expired'
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION ROUTER
// ═══════════════════════════════════════════════════════════════════════════

const definitions: Record<AuraManageAction, ActionDefinition> = {
    create: {
        schema: CreateSchema,
        handler: handleCreate,
        aliases: ['new', 'add', 'cast'],
        description: 'Create a new aura effect'
    },
    list: {
        schema: ListSchema,
        handler: handleList,
        aliases: ['all', 'active', 'get_all'],
        description: 'List all active auras'
    },
    get_affecting: {
        schema: GetAffectingSchema,
        handler: handleGetAffecting,
        aliases: ['affecting', 'check'],
        description: 'Get auras affecting a character'
    },
    process: {
        schema: ProcessSchema,
        handler: handleProcess,
        aliases: ['trigger', 'apply'],
        description: 'Process aura effects for a trigger'
    },
    remove: {
        schema: RemoveSchema,
        handler: handleRemove,
        aliases: ['end', 'dismiss', 'delete'],
        description: 'Remove an aura by ID'
    },
    remove_by_owner: {
        schema: RemoveByOwnerSchema,
        handler: handleRemoveByOwner,
        aliases: ['remove_all', 'end_all'],
        description: 'Remove all auras by owner'
    },
    expire: {
        schema: ExpireSchema,
        handler: handleExpire,
        aliases: ['cleanup', 'check_duration'],
        description: 'Expire auras past their duration'
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

export const AuraManageTool = {
    name: 'aura_manage',
    description: `Manage area-effect auras (Spirit Guardians, Aura of Protection, etc.).
Actions: create, list, get_affecting, process, remove, remove_by_owner, expire
Aliases: new→create, active→list, affecting→get_affecting, trigger→process, end→remove

AURA TARGETS:
- affectsSelf: affects the caster
- affectsAllies: affects allied creatures
- affectsEnemies: affects enemy creatures

EFFECT TRIGGERS:
- enter: when creature enters aura
- exit: when creature exits aura
- start_of_turn: at start of creature's turn
- end_of_turn: at end of creature's turn

WORKFLOW:
1. create - Create aura when spell is cast
2. process - Process effects on trigger events
3. expire - Check for duration expiration each round`,
    inputSchema: z.object({
        action: z.string().describe(`Action: ${ACTIONS.join(', ')}`),
        ownerId: z.string().optional(),
        auraId: z.string().optional(),
        characterId: z.string().optional(),
        encounterId: z.string().optional(),
        targetId: z.string().optional(),
        spellName: z.string().optional(),
        spellLevel: z.number().optional(),
        radius: z.number().optional(),
        affectsAllies: z.boolean().optional(),
        affectsEnemies: z.boolean().optional(),
        affectsSelf: z.boolean().optional(),
        effects: z.array(z.any()).optional(),
        currentRound: z.number().optional(),
        maxDuration: z.number().optional(),
        requiresConcentration: z.boolean().optional(),
        trigger: z.string().optional()
    })
};

export async function handleAuraManage(args: unknown, _ctx: SessionContext): Promise<McpResponse> {
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
            case 'create':
                output = RichFormatter.header('Aura Created', '');
                output += RichFormatter.keyValue({
                    'Spell': parsed.spellName,
                    'Owner': parsed.owner,
                    'Radius': `${parsed.radius}ft`,
                    'Effects': parsed.effectCount,
                    'Concentration': parsed.requiresConcentration ? 'Yes' : 'No'
                });
                break;

            case 'list':
                output = RichFormatter.header(`Active Auras (${parsed.count})`, '');
                if (parsed.auras?.length > 0) {
                    parsed.auras.forEach((a: { spellName: string; radius: number; effectCount: number }) => {
                        output += `- **${a.spellName}** (${a.radius}ft) - ${a.effectCount} effects\n`;
                    });
                } else {
                    output += 'No active auras.\n';
                }
                break;

            case 'get_affecting':
                output = RichFormatter.header(`Auras Affecting ${parsed.characterName}`, '');
                if (parsed.count > 0) {
                    parsed.auras.forEach((a: { spellName: string; radius: number }) => {
                        output += `- **${a.spellName}** (${a.radius}ft)\n`;
                    });
                } else {
                    output += 'No auras affecting this character.\n';
                }
                break;

            case 'process':
                output = RichFormatter.header(`Aura Effects (${parsed.trigger})`, '');
                if (parsed.effectCount > 0) {
                    parsed.effects.forEach((e: { auraName: string; damageDealt?: number; damageType?: string; healingDone?: number; conditionsApplied?: string[] }) => {
                        output += `- **${e.auraName}**: `;
                        if (e.damageDealt) output += `${e.damageDealt} ${e.damageType} damage`;
                        if (e.healingDone) output += `${e.healingDone} healing`;
                        if (e.conditionsApplied?.length) output += `Conditions: ${e.conditionsApplied.join(', ')}`;
                        output += '\n';
                    });
                } else {
                    output += 'No effects triggered.\n';
                }
                break;

            case 'remove':
                output = RichFormatter.header('Aura Removed', '');
                output += `Removed: ${parsed.auraName}\n`;
                break;

            case 'remove_by_owner':
                output = RichFormatter.header('Auras Removed', '');
                output += `Removed ${parsed.removedCount} aura(s) from character.\n`;
                break;

            case 'expire':
                output = RichFormatter.header('Aura Expiration Check', '');
                output += `Round: ${parsed.currentRound}\n`;
                output += `Expired: ${parsed.expiredCount} aura(s)\n`;
                break;

            default:
                output = RichFormatter.header('Aura', '');
                if (parsed.message) output += parsed.message + '\n';
        }
    }

    output += RichFormatter.embedJson(parsed, 'AURA_MANAGE');

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}
