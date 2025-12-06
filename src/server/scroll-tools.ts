import { z } from 'zod';
import { randomUUID } from 'crypto';
import { SessionContext } from './types.js';
import { getDb } from '../storage/index.js';
import { CharacterRepository } from '../storage/repos/character.repo.js';
import { ItemRepository } from '../storage/repos/item.repo.js';
import { InventoryRepository } from '../storage/repos/inventory.repo.js';
import {
    useSpellScroll,
    createSpellScroll,
    getScrollDetails,
    checkScrollUsability,
    rollArcanaCheck,
} from '../engine/magic/scroll.js';
import { CreateScrollRequestSchema } from '../schema/scroll.js';

/**
 * Spell Scroll MCP Tools
 * Provides tools for creating, identifying, and using spell scrolls
 */

export const ScrollTools = {
    USE_SPELL_SCROLL: {
        name: 'use_spell_scroll',
        description: 'Use a spell scroll from inventory. Scroll is consumed after use (even if the Arcana check fails). If the spell is on your class list and you can cast that level, no check is required.',
        inputSchema: z.object({
            characterId: z.string().describe('Character using the scroll'),
            scrollItemId: z.string().describe('Item ID of the scroll in inventory'),
            targetId: z.string().optional().describe('Optional target character ID'),
            targetPoint: z.object({
                x: z.number(),
                y: z.number()
            }).optional().describe('Optional target point for area spells'),
        }),
    },
    CREATE_SPELL_SCROLL: {
        name: 'create_spell_scroll',
        description: 'Create a new spell scroll item template (DM tool). The scroll can then be given to characters via give_item.',
        inputSchema: CreateScrollRequestSchema,
    },
    IDENTIFY_SCROLL: {
        name: 'identify_scroll',
        description: 'Identify a spell scroll using Arcana check (DC 10 + spell level) or the Identify spell (automatic success).',
        inputSchema: z.object({
            characterId: z.string().describe('Character attempting to identify the scroll'),
            scrollItemId: z.string().describe('Item ID of the scroll'),
            useIdentifySpell: z.boolean().default(false).describe('Whether using the Identify spell (auto-success)'),
        }),
    },
    GET_SCROLL_USE_DC: {
        name: 'get_scroll_use_dc',
        description: 'Calculate the DC required to use a spell scroll. Returns DC and whether a check is required based on character class/level.',
        inputSchema: z.object({
            characterId: z.string().describe('Character who would use the scroll'),
            scrollItemId: z.string().describe('Item ID of the scroll'),
        }),
    },
    GET_SCROLL_DETAILS: {
        name: 'get_scroll_details',
        description: 'Get detailed information about a spell scroll item.',
        inputSchema: z.object({
            scrollItemId: z.string().describe('Item ID of the scroll'),
        }),
    },
    CHECK_SCROLL_USABILITY: {
        name: 'check_scroll_usability',
        description: 'Check if a character can use a specific scroll without consuming it. Returns whether a check is required and the DC.',
        inputSchema: z.object({
            characterId: z.string().describe('Character to check'),
            scrollItemId: z.string().describe('Item ID of the scroll'),
        }),
    },
} as const;

function ensureDb() {
    const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
    return {
        characterRepo: new CharacterRepository(db),
        itemRepo: new ItemRepository(db),
        inventoryRepo: new InventoryRepository(db),
    };
}

/**
 * Handle using a spell scroll
 */
export async function handleUseSpellScroll(args: unknown, _ctx: SessionContext) {
    const { characterRepo, itemRepo, inventoryRepo } = ensureDb();
    const parsed = ScrollTools.USE_SPELL_SCROLL.inputSchema.parse(args);

    const character = characterRepo.findById(parsed.characterId);
    if (!character) {
        throw new Error(`Character ${parsed.characterId} not found`);
    }

    const scroll = itemRepo.findById(parsed.scrollItemId);
    if (!scroll) {
        throw new Error(`Scroll item ${parsed.scrollItemId} not found`);
    }

    const result = useSpellScroll(character, scroll, itemRepo, inventoryRepo);

    return {
        content: [
            {
                type: 'text' as const,
                text: formatScrollUseResult(result),
            },
        ],
    };
}

/**
 * Handle creating a spell scroll
 */
export async function handleCreateSpellScroll(args: unknown, _ctx: SessionContext) {
    const { itemRepo } = ensureDb();
    const parsed = CreateScrollRequestSchema.parse(args);

    const scrollData = createSpellScroll(
        parsed.spellName,
        parsed.spellLevel,
        parsed.spellClass,
        parsed.scrollDC,
        parsed.scrollAttackBonus,
        parsed.value,
        parsed.description
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
        content: [
            {
                type: 'text' as const,
                text: formatScrollCreation(scroll),
            },
        ],
    };
}

/**
 * Handle identifying a scroll
 */
export async function handleIdentifyScroll(args: unknown, _ctx: SessionContext) {
    const { characterRepo, itemRepo } = ensureDb();
    const parsed = ScrollTools.IDENTIFY_SCROLL.inputSchema.parse(args);

    const character = characterRepo.findById(parsed.characterId);
    if (!character) {
        throw new Error(`Character ${parsed.characterId} not found`);
    }

    const scroll = itemRepo.findById(parsed.scrollItemId);
    if (!scroll) {
        throw new Error(`Scroll item ${parsed.scrollItemId} not found`);
    }

    if (scroll.type !== 'scroll') {
        throw new Error(`Item "${scroll.name}" is not a scroll`);
    }

    const scrollDetails = getScrollDetails(scroll);
    if (!scrollDetails.valid) {
        throw new Error(scrollDetails.error || 'Invalid scroll');
    }

    // If using Identify spell, automatic success
    if (parsed.useIdentifySpell) {
        return {
            content: [
                {
                    type: 'text' as const,
                    text: formatScrollIdentification(scrollDetails, true, null),
                },
            ],
        };
    }

    // Otherwise, roll Arcana check
    const checkDC = 10 + scrollDetails.spellLevel!;
    const arcanaCheck = rollArcanaCheck(character);
    const success = arcanaCheck.total >= checkDC;

    return {
        content: [
            {
                type: 'text' as const,
                text: formatScrollIdentification(
                    scrollDetails,
                    success,
                    {
                        roll: arcanaCheck.roll,
                        total: arcanaCheck.total,
                        dc: checkDC,
                        modifier: arcanaCheck.modifier,
                    }
                ),
            },
        ],
    };
}

/**
 * Handle getting scroll use DC
 */
export async function handleGetScrollUseDC(args: unknown, _ctx: SessionContext) {
    const { characterRepo, itemRepo } = ensureDb();
    const parsed = ScrollTools.GET_SCROLL_USE_DC.inputSchema.parse(args);

    const character = characterRepo.findById(parsed.characterId);
    if (!character) {
        throw new Error(`Character ${parsed.characterId} not found`);
    }

    const scroll = itemRepo.findById(parsed.scrollItemId);
    if (!scroll) {
        throw new Error(`Scroll item ${parsed.scrollItemId} not found`);
    }

    const usability = checkScrollUsability(character, scroll);

    return {
        content: [
            {
                type: 'text' as const,
                text: formatScrollUseDC(usability, scroll.name),
            },
        ],
    };
}

/**
 * Handle getting scroll details
 */
export async function handleGetScrollDetails(args: unknown, _ctx: SessionContext) {
    const { itemRepo } = ensureDb();
    const parsed = ScrollTools.GET_SCROLL_DETAILS.inputSchema.parse(args);

    const scroll = itemRepo.findById(parsed.scrollItemId);
    if (!scroll) {
        throw new Error(`Scroll item ${parsed.scrollItemId} not found`);
    }

    const details = getScrollDetails(scroll);
    if (!details.valid) {
        throw new Error(details.error || 'Invalid scroll');
    }

    return {
        content: [
            {
                type: 'text' as const,
                text: formatScrollDetails(scroll, details),
            },
        ],
    };
}

/**
 * Handle checking scroll usability
 */
export async function handleCheckScrollUsability(args: unknown, _ctx: SessionContext) {
    const { characterRepo, itemRepo } = ensureDb();
    const parsed = ScrollTools.CHECK_SCROLL_USABILITY.inputSchema.parse(args);

    const character = characterRepo.findById(parsed.characterId);
    if (!character) {
        throw new Error(`Character ${parsed.characterId} not found`);
    }

    const scroll = itemRepo.findById(parsed.scrollItemId);
    if (!scroll) {
        throw new Error(`Scroll item ${parsed.scrollItemId} not found`);
    }

    const usability = checkScrollUsability(character, scroll);

    return {
        content: [
            {
                type: 'text' as const,
                text: formatScrollUsability(usability, character.name, scroll.name),
            },
        ],
    };
}

// ============================================================
// FORMATTING HELPERS
// ============================================================

function formatScrollUseResult(result: any): string {
    if (!result.success && result.reason === 'not_in_inventory') {
        return `L ${result.message}`;
    }

    if (!result.success && result.reason === 'invalid_scroll') {
        return `L ${result.message}`;
    }

    if (!result.requiresCheck) {
        return ` ${result.message}

<� Auto-success: Spell is on your class list and you can cast spells of this level.
=� The scroll crumbles to dust after use.`;
    }

    if (result.success && result.checkPassed) {
        return ` ${result.message}

<� Arcana Check: ${result.checkRoll} + modifier = ${result.checkTotal}
<� DC: ${result.checkDC}
( Check passed! The spell activates.
=� The scroll crumbles to dust after use.`;
    }

    if (!result.success && !result.checkPassed) {
        return `L ${result.message}

<� Arcana Check: ${result.checkRoll} + modifier = ${result.checkTotal}
<� DC: ${result.checkDC}
=� Check failed! The spell fizzles and the scroll is wasted.
=� The scroll crumbles to dust.`;
    }

    return result.message;
}

function formatScrollCreation(scroll: any): string {
    const props = scroll.properties;
    return `=� Spell Scroll Created

**${scroll.name}**
Spell: ${props.spellName} (Level ${props.spellLevel})
${props.spellClass ? `Class: ${props.spellClass}` : 'Class: Universal'}

Spell Save DC: ${props.scrollDC}
Spell Attack Bonus: +${props.scrollAttackBonus}
Value: ${scroll.value} gp
Weight: ${scroll.weight} lbs

Item ID: ${scroll.id}

Use \`give_item\` to add this scroll to a character's inventory.`;
}

function formatScrollIdentification(details: any, success: boolean, check: any): string {
    if (success && !check) {
        return `( Identify Spell - Automatic Success

=� **Scroll Identified**
Spell: ${details.spellName}
Level: ${details.spellLevel}
${details.spellClass ? `Class: ${details.spellClass}` : ''}
Rarity: ${details.rarity}
Spell Save DC: ${details.scrollDC}
Spell Attack Bonus: +${details.scrollAttackBonus}`;
    }

    if (success && check) {
        return ` Scroll Identified

<� Arcana Check: ${check.roll} + ${check.modifier} (INT) = ${check.total}
<� DC: ${check.dc}

=� **Scroll Details**
Spell: ${details.spellName}
Level: ${details.spellLevel}
${details.spellClass ? `Class: ${details.spellClass}` : ''}
Rarity: ${details.rarity}
Spell Save DC: ${details.scrollDC}
Spell Attack Bonus: +${details.scrollAttackBonus}`;
    }

    return `L Identification Failed

<� Arcana Check: ${check.roll} + ${check.modifier} (INT) = ${check.total}
<� DC: ${check.dc}

The magical writing remains indecipherable. You'll need to try again or use the Identify spell.`;
}

function formatScrollUseDC(usability: any, scrollName: string): string {
    if (!usability.canUse) {
        return `L Cannot use ${scrollName}

Reason: ${usability.message}`;
    }

    if (!usability.requiresCheck) {
        return ` ${scrollName} - Auto-success

No Arcana check required.
${usability.message}`;
    }

    return `=� ${scrollName}

� Arcana Check Required
DC: ${usability.checkDC}
Reason: ${usability.message}

Note: The scroll will be consumed even if the check fails.`;
}

function formatScrollDetails(scroll: any, details: any): string {
    return `=� **${scroll.name}**

${scroll.description || ''}

**Spell Information**
Name: ${details.spellName}
Level: ${details.spellLevel}
${details.spellClass ? `Class: ${details.spellClass}` : 'Class: Universal'}
Rarity: ${details.rarity}

**Scroll Properties**
Spell Save DC: ${details.scrollDC}
Spell Attack Bonus: +${details.scrollAttackBonus}
Value: ${scroll.value} gp
Weight: ${scroll.weight} lbs

**Usage**
Use \`use_spell_scroll\` to cast the spell from this scroll.
Use \`get_scroll_use_dc\` to check if you need an Arcana check.`;
}

function formatScrollUsability(usability: any, characterName: string, scrollName: string): string {
    if (!usability.canUse) {
        return `L ${characterName} cannot use ${scrollName}

${usability.message}`;
    }

    if (!usability.requiresCheck) {
        return ` ${characterName} can use ${scrollName}

( Auto-success: ${usability.message}

No Arcana check required. The scroll can be used immediately.`;
    }

    return `� ${characterName} can attempt to use ${scrollName}

=� Requires Arcana Check
DC: ${usability.checkDC}
Reason: ${usability.message}

Note: The scroll will be consumed even if the Arcana check fails.`;
}
