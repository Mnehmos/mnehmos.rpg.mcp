/**
 * Consolidated Scroll Management Tool
 *
 * Replaces 6 individual scroll tools with a single action-based tool:
 * - use_spell_scroll -> action: 'use'
 * - create_spell_scroll -> action: 'create'
 * - identify_scroll -> action: 'identify'
 * - get_scroll_use_dc -> action: 'get_dc'
 * - get_scroll_details -> action: 'get'
 * - check_scroll_usability -> action: 'check'
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';
import { SessionContext } from '../types.js';
import { getDb } from '../../storage/index.js';
import { CharacterRepository } from '../../storage/repos/character.repo.js';
import { ItemRepository } from '../../storage/repos/item.repo.js';
import { InventoryRepository } from '../../storage/repos/inventory.repo.js';
import {
    useSpellScroll,
    createSpellScroll,
    getScrollDetails,
    checkScrollUsability,
    rollArcanaCheck,
} from '../../engine/magic/scroll.js';
import { createActionRouter, ActionDefinition, McpResponse } from '../../utils/action-router.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS & ENUMS
// ═══════════════════════════════════════════════════════════════════════════

const ACTIONS = ['use', 'create', 'identify', 'get_dc', 'get', 'check'] as const;
type ScrollAction = typeof ACTIONS[number];

const SpellcastingClassEnum = z.enum([
    'bard', 'cleric', 'druid', 'paladin', 'ranger',
    'sorcerer', 'warlock', 'wizard', 'artificer'
]);

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE HELPER
// ═══════════════════════════════════════════════════════════════════════════

function ensureDb() {
    const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
    return {
        characterRepo: new CharacterRepository(db),
        itemRepo: new ItemRepository(db),
        inventoryRepo: new InventoryRepository(db),
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

const UseSchema = z.object({
    action: z.literal('use'),
    characterId: z.string().describe('Character using the scroll'),
    scrollItemId: z.string().describe('Item ID of the scroll'),
    targetId: z.string().optional().describe('Target character ID'),
    targetPoint: z.object({
        x: z.number(),
        y: z.number()
    }).optional().describe('Target point for area spells')
});

const CreateSchema = z.object({
    action: z.literal('create'),
    spellName: z.string().min(1).describe('Name of the spell on the scroll'),
    spellLevel: z.number().int().min(0).max(9).describe('Spell level (0-9)'),
    scrollDC: z.number().int().min(10).optional().describe('Spell save DC (default: 13 + spell level)'),
    scrollAttackBonus: z.number().int().optional().describe('Spell attack bonus (default: 5 + spell level)'),
    spellClass: SpellcastingClassEnum.optional().describe('Class list the spell is on'),
    value: z.number().int().min(0).optional().describe('Gold value'),
    description: z.string().optional().describe('Custom description')
});

const IdentifySchema = z.object({
    action: z.literal('identify'),
    characterId: z.string().describe('Character attempting identification'),
    scrollItemId: z.string().describe('Item ID of the scroll'),
    useIdentifySpell: z.boolean().default(false).describe('Use Identify spell (auto-success)')
});

const GetDCSchema = z.object({
    action: z.literal('get_dc'),
    characterId: z.string().describe('Character who would use the scroll'),
    scrollItemId: z.string().describe('Item ID of the scroll')
});

const GetSchema = z.object({
    action: z.literal('get'),
    scrollItemId: z.string().describe('Item ID of the scroll')
});

const CheckSchema = z.object({
    action: z.literal('check'),
    characterId: z.string().describe('Character to check'),
    scrollItemId: z.string().describe('Item ID of the scroll')
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTION HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

async function handleUse(args: z.infer<typeof UseSchema>): Promise<object> {
    const { characterRepo, itemRepo, inventoryRepo } = ensureDb();

    const character = characterRepo.findById(args.characterId);
    if (!character) {
        return { error: true, message: `Character ${args.characterId} not found` };
    }

    const scroll = itemRepo.findById(args.scrollItemId);
    if (!scroll) {
        return { error: true, message: `Scroll item ${args.scrollItemId} not found` };
    }

    const result = useSpellScroll(character, scroll, inventoryRepo);

    return {
        success: result.success,
        consumed: result.consumed,
        requiresCheck: result.requiresCheck,
        checkRoll: result.checkRoll,
        checkTotal: result.checkTotal,
        checkDC: result.checkDC,
        checkPassed: result.checkPassed,
        reason: result.reason,
        message: result.message,
        spellName: scroll.properties?.spellName
    };
}

async function handleCreate(args: z.infer<typeof CreateSchema>): Promise<object> {
    const { itemRepo } = ensureDb();

    const scrollData = createSpellScroll(
        args.spellName,
        args.spellLevel,
        args.spellClass,
        args.scrollDC,
        args.scrollAttackBonus,
        args.value,
        args.description
    );

    const now = new Date().toISOString();
    const scroll = {
        ...scrollData,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
    };

    itemRepo.create(scroll);

    return {
        success: true,
        scrollId: scroll.id,
        name: scroll.name,
        spellName: args.spellName,
        spellLevel: args.spellLevel,
        spellClass: args.spellClass || 'universal',
        scrollDC: scroll.properties?.scrollDC,
        scrollAttackBonus: scroll.properties?.scrollAttackBonus,
        value: scroll.value,
        rarity: scroll.rarity,
        message: `Created scroll of ${args.spellName} (Level ${args.spellLevel})`
    };
}

async function handleIdentify(args: z.infer<typeof IdentifySchema>): Promise<object> {
    const { characterRepo, itemRepo } = ensureDb();

    const character = characterRepo.findById(args.characterId);
    if (!character) {
        return { error: true, message: `Character ${args.characterId} not found` };
    }

    const scroll = itemRepo.findById(args.scrollItemId);
    if (!scroll) {
        return { error: true, message: `Scroll item ${args.scrollItemId} not found` };
    }

    if (scroll.type !== 'scroll') {
        return { error: true, message: `Item "${scroll.name}" is not a scroll` };
    }

    const scrollDetails = getScrollDetails(scroll);
    if (!scrollDetails.valid) {
        return { error: true, message: scrollDetails.error || 'Invalid scroll' };
    }

    // If using Identify spell, automatic success
    if (args.useIdentifySpell) {
        return {
            success: true,
            method: 'identify_spell',
            spellName: scrollDetails.spellName,
            spellLevel: scrollDetails.spellLevel,
            spellClass: scrollDetails.spellClass || 'universal',
            rarity: scrollDetails.rarity,
            scrollDC: scrollDetails.scrollDC,
            scrollAttackBonus: scrollDetails.scrollAttackBonus,
            message: `Identify spell reveals: ${scrollDetails.spellName} (Level ${scrollDetails.spellLevel})`
        };
    }

    // Otherwise, roll Arcana check
    const checkDC = 10 + scrollDetails.spellLevel!;
    const arcanaCheck = rollArcanaCheck(character);
    const success = arcanaCheck.total >= checkDC;

    if (success) {
        return {
            success: true,
            method: 'arcana_check',
            roll: arcanaCheck.roll,
            modifier: arcanaCheck.modifier,
            total: arcanaCheck.total,
            dc: checkDC,
            spellName: scrollDetails.spellName,
            spellLevel: scrollDetails.spellLevel,
            spellClass: scrollDetails.spellClass || 'universal',
            rarity: scrollDetails.rarity,
            scrollDC: scrollDetails.scrollDC,
            scrollAttackBonus: scrollDetails.scrollAttackBonus,
            message: `Arcana check succeeded (${arcanaCheck.total} vs DC ${checkDC}): ${scrollDetails.spellName}`
        };
    }

    return {
        success: false,
        method: 'arcana_check',
        roll: arcanaCheck.roll,
        modifier: arcanaCheck.modifier,
        total: arcanaCheck.total,
        dc: checkDC,
        message: `Arcana check failed (${arcanaCheck.total} vs DC ${checkDC}). The magical writing remains indecipherable.`
    };
}

async function handleGetDC(args: z.infer<typeof GetDCSchema>): Promise<object> {
    const { characterRepo, itemRepo } = ensureDb();

    const character = characterRepo.findById(args.characterId);
    if (!character) {
        return { error: true, message: `Character ${args.characterId} not found` };
    }

    const scroll = itemRepo.findById(args.scrollItemId);
    if (!scroll) {
        return { error: true, message: `Scroll item ${args.scrollItemId} not found` };
    }

    const usability = checkScrollUsability(character, scroll);

    return {
        scrollName: scroll.name,
        canUse: usability.canUse,
        requiresCheck: usability.requiresCheck,
        checkDC: usability.checkDC,
        reason: usability.message,
        message: usability.requiresCheck
            ? `Arcana check DC ${usability.checkDC} required to use ${scroll.name}`
            : usability.canUse
                ? `${scroll.name} can be used without a check`
                : usability.message
    };
}

async function handleGet(args: z.infer<typeof GetSchema>): Promise<object> {
    const { itemRepo } = ensureDb();

    const scroll = itemRepo.findById(args.scrollItemId);
    if (!scroll) {
        return { error: true, message: `Scroll item ${args.scrollItemId} not found` };
    }

    const details = getScrollDetails(scroll);
    if (!details.valid) {
        return { error: true, message: details.error || 'Invalid scroll' };
    }

    return {
        id: scroll.id,
        name: scroll.name,
        description: scroll.description,
        spellName: details.spellName,
        spellLevel: details.spellLevel,
        spellClass: details.spellClass || 'universal',
        rarity: details.rarity,
        scrollDC: details.scrollDC,
        scrollAttackBonus: details.scrollAttackBonus,
        value: scroll.value,
        weight: scroll.weight,
        message: `${scroll.name}: ${details.spellName} (Level ${details.spellLevel})`
    };
}

async function handleCheck(args: z.infer<typeof CheckSchema>): Promise<object> {
    const { characterRepo, itemRepo } = ensureDb();

    const character = characterRepo.findById(args.characterId);
    if (!character) {
        return { error: true, message: `Character ${args.characterId} not found` };
    }

    const scroll = itemRepo.findById(args.scrollItemId);
    if (!scroll) {
        return { error: true, message: `Scroll item ${args.scrollItemId} not found` };
    }

    const usability = checkScrollUsability(character, scroll);

    return {
        characterName: character.name,
        scrollName: scroll.name,
        canUse: usability.canUse,
        requiresCheck: usability.requiresCheck,
        checkDC: usability.checkDC,
        reason: usability.message,
        message: !usability.canUse
            ? `${character.name} cannot use ${scroll.name}: ${usability.message}`
            : !usability.requiresCheck
                ? `${character.name} can use ${scroll.name} without a check (spell on class list)`
                : `${character.name} needs Arcana DC ${usability.checkDC} to use ${scroll.name}`
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION ROUTER
// ═══════════════════════════════════════════════════════════════════════════

const definitions: Record<ScrollAction, ActionDefinition> = {
    use: {
        schema: UseSchema,
        handler: handleUse,
        aliases: ['cast', 'activate'],
        description: 'Use a spell scroll (consumes scroll)'
    },
    create: {
        schema: CreateSchema,
        handler: handleCreate,
        aliases: ['new', 'make', 'craft'],
        description: 'Create a spell scroll item (DM tool)'
    },
    identify: {
        schema: IdentifySchema,
        handler: handleIdentify,
        aliases: ['id', 'read'],
        description: 'Identify scroll via Arcana or Identify spell'
    },
    get_dc: {
        schema: GetDCSchema,
        handler: handleGetDC,
        aliases: ['dc'],
        description: 'Get DC required to use a scroll'
    },
    get: {
        schema: GetSchema,
        handler: handleGet,
        aliases: ['details', 'info'],
        description: 'Get scroll details'
    },
    check: {
        schema: CheckSchema,
        handler: handleCheck,
        aliases: ['usability', 'can_use'],
        description: 'Check if character can use scroll'
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

export const ScrollManageTool = {
    name: 'scroll_manage',
    description: `Manage spell scrolls - creation, identification, and usage.
Actions: use (cast from scroll), create (make scroll), identify (Arcana/Identify), get_dc, get (details), check (usability)
Aliases: cast->use, craft/make->create, id/read->identify, dc->get_dc, details->get, can_use->check`,
    inputSchema: z.object({
        action: z.string().describe('Action: use, create, identify, get_dc, get, check'),
        characterId: z.string().optional().describe('Character ID (for use, identify, get_dc, check)'),
        scrollItemId: z.string().optional().describe('Scroll item ID'),
        spellName: z.string().optional().describe('Spell name (for create)'),
        spellLevel: z.number().optional().describe('Spell level 0-9 (for create)'),
        scrollDC: z.number().optional(),
        scrollAttackBonus: z.number().optional(),
        spellClass: SpellcastingClassEnum.optional(),
        value: z.number().optional(),
        description: z.string().optional(),
        useIdentifySpell: z.boolean().optional(),
        targetId: z.string().optional(),
        targetPoint: z.object({ x: z.number(), y: z.number() }).optional()
    })
};

export async function handleScrollManage(args: unknown, _ctx: SessionContext): Promise<McpResponse> {
    return router(args as Record<string, unknown>);
}
