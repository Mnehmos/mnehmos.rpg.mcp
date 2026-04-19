/**
 * Consolidated Character Management Tool
 *
 * Replaces 8 individual tools with a single action-based tool:
 * - create_character -> action: 'create'
 * - get_character -> action: 'get'
 * - update_character -> action: 'update'
 * - list_characters -> action: 'list'
 * - delete_character -> action: 'delete'
 * - add_xp -> action: 'add_xp'
 * - get_level_progression -> action: 'get_progression'
 * - level_up -> action: 'level_up'
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';
import { SessionContext } from '../types.js';
import { getDb } from '../../storage/index.js';
import { CharacterRepository } from '../../storage/repos/character.repo.js';
import { provisionStartingEquipment } from '../../services/starting-equipment.service.js';
import { getSpellSlots, isSpellcaster } from '../../data/class-starting-data.js';
import { createActionRouter, ActionDefinition, McpResponse } from '../../utils/action-router.js';
import { RichFormatter } from '../utils/formatter.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const ACTIONS = ['create', 'get', 'update', 'list', 'delete', 'add_xp', 'get_progression', 'level_up'] as const;
type CharacterAction = typeof ACTIONS[number];

const CharacterTypeSchema = z.enum(['pc', 'npc', 'enemy', 'neutral']);

const XP_TABLE: Record<number, number> = {
    1: 0, 2: 300, 3: 900, 4: 2700, 5: 6500, 6: 14000, 7: 23000, 8: 34000,
    9: 48000, 10: 64000, 11: 85000, 12: 100000, 13: 120000, 14: 140000,
    15: 165000, 16: 195000, 17: 225000, 18: 265000, 19: 305000, 20: 355000
};

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE HELPER
// ═══════════════════════════════════════════════════════════════════════════

function ensureDb() {
    const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
    return {
        db,
        characterRepo: new CharacterRepository(db)
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

const StatsSchema = z.object({
    str: z.number().int().min(0).default(10),
    dex: z.number().int().min(0).default(10),
    con: z.number().int().min(0).default(10),
    int: z.number().int().min(0).default(10),
    wis: z.number().int().min(0).default(10),
    cha: z.number().int().min(0).default(10),
});

const CreateSchema = z.object({
    action: z.literal('create'),
    name: z.string().min(1).describe('Character name (required)'),
    class: z.string().optional().default('Adventurer'),
    race: z.string().optional().default('Human'),
    background: z.string().optional().default('Folk Hero'),
    alignment: z.string().optional(),
    stats: StatsSchema.optional().default({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }),
    hp: z.number().int().min(1).optional(),
    maxHp: z.number().int().min(1).optional(),
    ac: z.number().int().min(0).optional().default(10),
    level: z.number().int().min(1).optional().default(1),
    characterType: CharacterTypeSchema.optional().default('pc'),
    factionId: z.string().optional(),
    behavior: z.string().optional(),
    knownSpells: z.array(z.string()).optional().default([]),
    preparedSpells: z.array(z.string()).optional().default([]),
    resistances: z.array(z.string()).optional().default([]),
    vulnerabilities: z.array(z.string()).optional().default([]),
    immunities: z.array(z.string()).optional().default([]),
    provisionEquipment: z.boolean().optional().default(true),
    customEquipment: z.array(z.string()).optional(),
    startingGold: z.number().int().min(0).optional()
});

const GetSchema = z.object({
    action: z.literal('get'),
    characterId: z.string().describe('Character ID to retrieve')
});

const ConditionSchema = z.object({
    name: z.string(),
    duration: z.number().int().optional(),
    source: z.string().optional()
});

const UpdateSchema = z.object({
    action: z.literal('update'),
    characterId: z.string().describe('Character ID to update'),
    name: z.string().min(1).optional(),
    race: z.string().optional(),
    class: z.string().optional(),
    hp: z.number().int().min(0).optional(),
    maxHp: z.number().int().min(1).optional(),
    ac: z.number().int().min(0).optional(),
    level: z.number().int().min(1).optional(),
    characterType: CharacterTypeSchema.optional(),
    stats: StatsSchema.partial().optional(),
    knownSpells: z.array(z.string()).optional(),
    preparedSpells: z.array(z.string()).optional(),
    conditions: z.array(ConditionSchema).optional(),
    addConditions: z.array(ConditionSchema).optional(),
    removeConditions: z.array(z.string()).optional()
});

const ListSchema = z.object({
    action: z.literal('list'),
    characterType: CharacterTypeSchema.optional()
});

const DeleteSchema = z.object({
    action: z.literal('delete'),
    characterId: z.string().describe('Character ID to delete')
});

const AddXpSchema = z.object({
    action: z.literal('add_xp'),
    characterId: z.string().describe('Character ID'),
    amount: z.number().int().min(1).describe('Amount of XP to add')
});

const GetProgressionSchema = z.object({
    action: z.literal('get_progression'),
    level: z.number().int().min(1).max(20).describe('Level to check progression for')
});

const LevelUpSchema = z.object({
    action: z.literal('level_up'),
    characterId: z.string().describe('Character ID'),
    hpIncrease: z.number().int().min(0).optional(),
    targetLevel: z.number().int().min(2).max(20).optional()
});

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert spell slots from the zero-indexed array returned by getSpellSlots
 * (slots[0] = level-1 slot count, slots[1] = level-2, …) into the object
 * shape persisted on the character row.
 *
 * NOTE: This fix is duplicated in PR #54 (issue #44). It must land here too,
 * or every wizard/cleric this PR persists will be off by one slot level.
 */
function convertSpellSlotsToObject(slots: number[] | null) {
    if (!slots || slots.length === 0) return undefined;

    return {
        level1: { current: slots[0] || 0, max: slots[0] || 0 },
        level2: { current: slots[1] || 0, max: slots[1] || 0 },
        level3: { current: slots[2] || 0, max: slots[2] || 0 },
        level4: { current: slots[3] || 0, max: slots[3] || 0 },
        level5: { current: slots[4] || 0, max: slots[4] || 0 },
        level6: { current: slots[5] || 0, max: slots[5] || 0 },
        level7: { current: slots[6] || 0, max: slots[6] || 0 },
        level8: { current: slots[7] || 0, max: slots[7] || 0 },
        level9: { current: slots[8] || 0, max: slots[8] || 0 }
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

async function handleCreate(args: z.infer<typeof CreateSchema>): Promise<object> {
    const { db, characterRepo } = ensureDb();
    const now = new Date().toISOString();
    const className = args.class || 'Adventurer';

    // Calculate HP from constitution if not provided
    const conModifier = Math.floor(((args.stats?.con ?? 10) - 10) / 2);
    const baseHp = Math.max(1, 8 + conModifier);
    const hp = args.hp ?? baseHp;
    const maxHp = args.maxHp ?? hp;
    const characterId = randomUUID();

    // Build the base character record from args. The character row MUST be
    // inserted before provisioning runs, otherwise inventory_items.character_id
    // FK fails when the provisioner tries to grant starting equipment.
    const character: Record<string, unknown> = {
        id: characterId,
        name: args.name,
        race: args.race,
        background: args.background,
        alignment: args.alignment,
        characterClass: className,
        stats: args.stats || { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
        hp,
        maxHp,
        ac: args.ac ?? 10,
        level: args.level ?? 1,
        characterType: args.characterType ?? 'pc',
        factionId: args.factionId,
        behavior: args.behavior,
        knownSpells: args.knownSpells || [],
        cantripsKnown: [],
        preparedSpells: args.preparedSpells || [],
        resistances: args.resistances || [],
        vulnerabilities: args.vulnerabilities || [],
        immunities: args.immunities || [],
        spellSlots: undefined,
        pactMagicSlots: undefined,
        xp: 0,
        createdAt: now,
        updatedAt: now
    };

    characterRepo.create(character as any);

    // Now safe to provision: character row exists, so FK on inventory_items.character_id resolves.
    let provisioningResult = null;
    const shouldProvision = args.provisionEquipment !== false &&
        (args.characterType === 'pc' || args.characterType === undefined);

    if (shouldProvision) {
        provisioningResult = provisionStartingEquipment(
            db,
            characterId,
            className,
            args.level ?? 1,
            {
                customEquipment: args.customEquipment,
                customSpells: args.knownSpells?.length ? args.knownSpells : undefined,
                startingGold: args.startingGold
            }
        );

        // Roll spell-related fields from provisioning into the in-memory record
        // and persist via update so the character row stays consistent.
        character.knownSpells = provisioningResult.spellsGranted.length
            ? [...new Set([...(args.knownSpells || []), ...provisioningResult.spellsGranted])]
            : args.knownSpells || [];
        character.cantripsKnown = provisioningResult.cantripsGranted || [];
        character.spellSlots = convertSpellSlotsToObject(provisioningResult.spellSlots ?? null);
        character.pactMagicSlots = provisioningResult.pactMagicSlots || undefined;

        characterRepo.update(characterId, {
            knownSpells: character.knownSpells as string[],
            cantripsKnown: character.cantripsKnown as string[],
            spellSlots: character.spellSlots,
            pactMagicSlots: character.pactMagicSlots
        } as any);
    }

    const response: Record<string, unknown> = { ...character, success: true };
    if (provisioningResult) {
        response._provisioning = {
            equipmentGranted: provisioningResult.itemsGranted,
            spellsGranted: provisioningResult.spellsGranted,
            cantripsGranted: provisioningResult.cantripsGranted,
            startingGold: provisioningResult.startingGold,
            errors: provisioningResult.errors.length > 0 ? provisioningResult.errors : undefined
        };
    }

    return {
        ...response,
        message: `Created character: ${character.name}`
    };
}

async function handleGet(args: z.infer<typeof GetSchema>): Promise<object> {
    const { characterRepo } = ensureDb();
    const character = characterRepo.findById(args.characterId);

    if (!character) {
        throw new Error(`Character ${args.characterId} not found`);
    }

    return { ...character };
}

async function handleUpdate(args: z.infer<typeof UpdateSchema>): Promise<object> {
    const { characterRepo } = ensureDb();
    const updateData: Record<string, unknown> = {};

    // Map fields
    if (args.name !== undefined) updateData.name = args.name;
    if (args.race !== undefined) updateData.race = args.race;
    if (args.class !== undefined) updateData.characterClass = args.class;
    if (args.hp !== undefined) updateData.hp = args.hp;
    if (args.maxHp !== undefined) updateData.maxHp = args.maxHp;
    if (args.ac !== undefined) updateData.ac = args.ac;
    if (args.level !== undefined) updateData.level = args.level;
    if (args.characterType !== undefined) updateData.characterType = args.characterType;
    if (args.stats !== undefined) updateData.stats = args.stats;
    if (args.knownSpells !== undefined) updateData.knownSpells = args.knownSpells;
    if (args.preparedSpells !== undefined) updateData.preparedSpells = args.preparedSpells;

    // Handle conditions
    if (args.conditions !== undefined) {
        updateData.conditions = args.conditions;
    } else if (args.addConditions !== undefined || args.removeConditions !== undefined) {
        const existing = characterRepo.findById(args.characterId);
        if (!existing) {
            throw new Error(`Character ${args.characterId} not found`);
        }

        let currentConditions: Array<{ name: string; duration?: number; source?: string }> =
            (existing as any).conditions || [];

        if (args.removeConditions?.length) {
            const toRemove = new Set(args.removeConditions.map(n => n.toLowerCase()));
            currentConditions = currentConditions.filter(c => !toRemove.has(c.name.toLowerCase()));
        }

        if (args.addConditions?.length) {
            for (const newCond of args.addConditions) {
                const existingIdx = currentConditions.findIndex(
                    c => c.name.toLowerCase() === newCond.name.toLowerCase()
                );
                if (existingIdx >= 0) {
                    currentConditions[existingIdx] = { ...currentConditions[existingIdx], ...newCond };
                } else {
                    currentConditions.push(newCond);
                }
            }
        }

        updateData.conditions = currentConditions;
    }

    const updated = characterRepo.update(args.characterId, updateData);
    if (!updated) {
        throw new Error(`Failed to update character: ${args.characterId}`);
    }

    return {
        ...updated,
        success: true,
        message: 'Character updated successfully'
    };
}

async function handleList(args: z.infer<typeof ListSchema>): Promise<object> {
    const { characterRepo } = ensureDb();
    const characters = characterRepo.findAll({
        characterType: args.characterType
    });

    return {
        characters,
        count: characters.length,
        filter: args.characterType || 'all'
    };
}

async function handleDelete(args: z.infer<typeof DeleteSchema>): Promise<object> {
    const { db } = ensureDb();
    const stmt = db.prepare('DELETE FROM characters WHERE id = ?');
    stmt.run(args.characterId);

    return {
        success: true,
        characterId: args.characterId,
        message: 'Character deleted'
    };
}

async function handleAddXp(args: z.infer<typeof AddXpSchema>): Promise<object> {
    const { characterRepo } = ensureDb();
    const char = characterRepo.findById(args.characterId);

    if (!char) {
        throw new Error(`Character ${args.characterId} not found`);
    }

    const currentXp = (char as any).xp || 0;
    const newXp = currentXp + args.amount;
    const currentLevel = char.level;
    const nextLevelXp = XP_TABLE[currentLevel + 1];
    const canLevelUp = nextLevelXp !== undefined && newXp >= nextLevelXp;

    characterRepo.update(char.id, { xp: newXp });

    return {
        characterId: char.id,
        name: char.name,
        oldXp: currentXp,
        newXp,
        level: currentLevel,
        canLevelUp,
        nextLevelXp: nextLevelXp || null,
        message: canLevelUp
            ? `Added ${args.amount} XP. Total: ${newXp}. LEVEL UP AVAILABLE for Level ${currentLevel + 1}!`
            : `Added ${args.amount} XP. Total: ${newXp}.`
    };
}

async function handleGetProgression(args: z.infer<typeof GetProgressionSchema>): Promise<object> {
    const level = args.level;

    if (level >= 20) {
        return {
            level: 20,
            maxLevel: true,
            xpForCurrentLevel: XP_TABLE[20]
        };
    }

    const currentXpBase = XP_TABLE[level];
    const nextLevelXp = XP_TABLE[level + 1];

    return {
        level,
        xpRequiredForLevel: currentXpBase,
        xpForNextLevel: nextLevelXp,
        xpToNext: nextLevelXp - currentXpBase
    };
}

async function handleLevelUp(args: z.infer<typeof LevelUpSchema>): Promise<object> {
    const { characterRepo } = ensureDb();
    const char = characterRepo.findById(args.characterId);

    if (!char) {
        throw new Error(`Character ${args.characterId} not found`);
    }

    const currentLevel = char.level;
    const targetLevel = args.targetLevel || (currentLevel + 1);

    if (targetLevel <= currentLevel) {
        throw new Error(`Target level ${targetLevel} must be greater than current level ${currentLevel}`);
    }

    const updates: Record<string, unknown> = { level: targetLevel };

    if (args.hpIncrease) {
        updates.maxHp = (char.maxHp || 0) + args.hpIncrease;
        updates.hp = (char.hp || 0) + args.hpIncrease;
    }

    // Recompute spell slots for the new level. Without this, level_up would
    // not grant the new caster slots a player earned with the level. Mirrors
    // the create-time path through convertSpellSlotsToObject.
    const className = char.characterClass;
    if (className && isSpellcaster(className)) {
        const slots = getSpellSlots(className, targetLevel);
        const next = convertSpellSlotsToObject(slots);
        if (next) updates.spellSlots = next;
    }

    characterRepo.update(char.id, updates);

    return {
        characterId: char.id,
        name: char.name,
        oldLevel: currentLevel,
        newLevel: targetLevel,
        hpIncrease: args.hpIncrease || 0,
        newMaxHp: updates.maxHp || char.maxHp,
        spellSlots: updates.spellSlots,
        message: `Leveled up to ${targetLevel}!`
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION ROUTER
// ═══════════════════════════════════════════════════════════════════════════

const definitions: Record<CharacterAction, ActionDefinition> = {
    create: {
        schema: CreateSchema,
        handler: handleCreate,
        aliases: ['new', 'add', 'spawn'],
        description: 'Create a new character'
    },
    get: {
        schema: GetSchema,
        handler: handleGet,
        aliases: ['fetch', 'find', 'retrieve'],
        description: 'Get character by ID'
    },
    update: {
        schema: UpdateSchema,
        handler: handleUpdate,
        aliases: ['modify', 'edit', 'set'],
        description: 'Update character properties'
    },
    list: {
        schema: ListSchema,
        handler: handleList,
        aliases: ['all', 'query', 'search'],
        description: 'List all characters'
    },
    delete: {
        schema: DeleteSchema,
        handler: handleDelete,
        aliases: ['remove', 'destroy'],
        description: 'Delete a character'
    },
    add_xp: {
        schema: AddXpSchema,
        handler: handleAddXp,
        aliases: ['xp', 'award_xp', 'grant_xp'],
        description: 'Add XP to a character'
    },
    get_progression: {
        schema: GetProgressionSchema,
        handler: handleGetProgression,
        aliases: ['progression', 'xp_table', 'level_info'],
        description: 'Get XP requirements for a level'
    },
    level_up: {
        schema: LevelUpSchema,
        handler: handleLevelUp,
        aliases: ['levelup', 'advance'],
        description: 'Level up a character'
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

export const CharacterManageTool = {
    name: 'character_manage',
    description: `Manage characters and progression.

👤 CHARACTER LIFECYCLE:
1. create - Define character with class/race/stats (auto-provisions equipment)
2. get/update - View or modify properties
3. add_xp/level_up - Advance character progression

⚔️ FOR COMBAT:
- Characters need HP, AC, stats for combat participation
- Use combat_manage to add characters to encounters

📦 EQUIPMENT NOTE:
- provisionEquipment: true (default) auto-grants starting equipment
- For custom items, create with item_manage first, then use inventory_manage

Actions: create, get, update, list, delete, add_xp, get_progression, level_up
Aliases: new/add/spawn->create, fetch/find->get, modify/edit->update`,
    inputSchema: z.object({
        action: z.string().describe('Action: create, get, update, list, delete, add_xp, get_progression, level_up'),
        // Create fields
        name: z.string().optional(),
        class: z.string().optional(),
        race: z.string().optional(),
        background: z.string().optional(),
        alignment: z.string().optional(),
        stats: StatsSchema.optional(),
        hp: z.number().int().optional(),
        maxHp: z.number().int().optional(),
        ac: z.number().int().optional(),
        level: z.number().int().optional(),
        characterType: CharacterTypeSchema.optional(),
        factionId: z.string().optional(),
        behavior: z.string().optional(),
        knownSpells: z.array(z.string()).optional(),
        preparedSpells: z.array(z.string()).optional(),
        resistances: z.array(z.string()).optional(),
        vulnerabilities: z.array(z.string()).optional(),
        immunities: z.array(z.string()).optional(),
        provisionEquipment: z.boolean().optional(),
        customEquipment: z.array(z.string()).optional(),
        startingGold: z.number().int().optional(),
        // Get/Update/Delete fields
        characterId: z.string().optional(),
        // Update condition fields
        conditions: z.array(ConditionSchema).optional(),
        addConditions: z.array(ConditionSchema).optional(),
        removeConditions: z.array(z.string()).optional(),
        // Add XP field
        amount: z.number().int().optional(),
        // Level up fields
        hpIncrease: z.number().int().optional(),
        targetLevel: z.number().int().optional()
    })
};

export async function handleCharacterManage(args: unknown, _ctx: SessionContext): Promise<McpResponse> {
    const response = await router(args as Record<string, unknown>);

    // Parse the JSON response to add ASCII formatting
    try {
        const jsonText = response.content[0]?.text;
        if (!jsonText) return response;

        const data = JSON.parse(jsonText);
        const action = (args as Record<string, unknown>).action as string;

        let output = '';

        // Check for any error type (boolean true or string error codes)
        const hasError = data.error === true || typeof data.error === 'string';

        if (hasError) {
            output = RichFormatter.header('Character Error', '❌');
            output += RichFormatter.alert(data.message || 'Unknown error', 'error');
            if (data.issues) {
                output += RichFormatter.section('Validation Issues');
                output += RichFormatter.list(data.issues.map((i: { path: string; message: string }) => `${i.path}: ${i.message}`));
            }
            if (data.suggestions) {
                output += RichFormatter.section('Suggestions');
                output += RichFormatter.list(data.suggestions.map((s: string | { value: string; similarity: number }) =>
                    typeof s === 'string' ? s : `${s.value} (${Math.round(s.similarity * 100)}%)`
                ));
            }
        } else if (action === 'create' || action === 'new' || action === 'add' || action === 'spawn') {
            output = RichFormatter.header(`Character Created: ${data.name}`, '👤');
            output += RichFormatter.keyValue({
                'ID': data.id,
                'Name': data.name,
                'Race': data.race || 'Unknown',
                'Class': data.characterClass || 'Adventurer',
                'Level': data.level || 1,
                'Type': data.characterType || 'pc'
            });
            output += RichFormatter.section('Stats');
            if (data.stats) {
                const stats = data.stats;
                output += `STR: ${stats.str} | DEX: ${stats.dex} | CON: ${stats.con}\n`;
                output += `INT: ${stats.int} | WIS: ${stats.wis} | CHA: ${stats.cha}\n`;
            }
            output += RichFormatter.section('Combat');
            output += RichFormatter.keyValue({
                'HP': `${data.hp}/${data.maxHp}`,
                'AC': data.ac || 10
            });
            if (data._provisioning) {
                output += RichFormatter.section('Starting Equipment');
                if (data._provisioning.equipmentGranted?.length) {
                    output += RichFormatter.list(data._provisioning.equipmentGranted);
                }
                if (data._provisioning.spellsGranted?.length) {
                    output += `Spells: ${data._provisioning.spellsGranted.join(', ')}\n`;
                }
            }
        } else if (action === 'get' || action === 'fetch' || action === 'find') {
            output = RichFormatter.header(`${data.name}`, '👤');
            output += RichFormatter.keyValue({
                'ID': data.id,
                'Race': data.race || 'Unknown',
                'Class': data.characterClass || 'Adventurer',
                'Level': data.level || 1,
                'XP': data.xp || 0,
                'Type': data.characterType || 'pc'
            });
            output += RichFormatter.section('Stats');
            if (data.stats) {
                const stats = data.stats;
                output += `STR: ${stats.str} | DEX: ${stats.dex} | CON: ${stats.con}\n`;
                output += `INT: ${stats.int} | WIS: ${stats.wis} | CHA: ${stats.cha}\n`;
            }
            output += RichFormatter.section('Combat');
            output += RichFormatter.keyValue({
                'HP': `${data.hp}/${data.maxHp}`,
                'AC': data.ac || 10
            });
            if (data.conditions?.length) {
                output += RichFormatter.section('Conditions');
                output += RichFormatter.list(data.conditions.map((c: string | { name: string }) => typeof c === 'string' ? c : c.name));
            }
        } else if (action === 'list' || action === 'all' || action === 'query') {
            output = RichFormatter.header(`Characters (${data.count})`, '👥');
            if (data.filter && data.filter !== 'all') {
                output += `*Filtered by: ${data.filter}*\n\n`;
            }
            if (data.characters?.length) {
                const rows = data.characters.map((c: { name: string; characterClass?: string; level?: number; hp: number; maxHp: number; characterType?: string }) => [
                    c.name,
                    c.characterClass || 'Adventurer',
                    `Lv${c.level || 1}`,
                    `${c.hp}/${c.maxHp}`,
                    c.characterType || 'pc'
                ]);
                output += RichFormatter.table(['Name', 'Class', 'Level', 'HP', 'Type'], rows);
            } else {
                output += '*No characters found*\n';
            }
        } else if (action === 'update' || action === 'modify' || action === 'edit') {
            output = RichFormatter.header(`Character Updated: ${data.name}`, '✏️');
            output += data.message + '\n';
        } else if (action === 'delete' || action === 'remove') {
            output = RichFormatter.header('Character Deleted', '🗑️');
            output += `ID: ${data.characterId}\n`;
        } else if (action === 'add_xp' || action === 'xp') {
            output = RichFormatter.header(`XP Added: ${data.name}`, '⭐');
            output += RichFormatter.keyValue({
                'Previous XP': data.oldXp,
                'Added': data.newXp - data.oldXp,
                'Total XP': data.newXp,
                'Current Level': data.level
            });
            if (data.canLevelUp) {
                output += RichFormatter.alert('LEVEL UP AVAILABLE!', 'success');
            } else if (data.nextLevelXp) {
                output += `*${data.nextLevelXp - data.newXp} XP until Level ${data.level + 1}*\n`;
            }
        } else if (action === 'get_progression' || action === 'progression') {
            output = RichFormatter.header(`Level ${data.level} Progression`, '📊');
            if (data.maxLevel) {
                output += '*Maximum level reached!*\n';
            } else {
                output += RichFormatter.keyValue({
                    'XP for this level': data.xpRequiredForLevel,
                    'XP for next level': data.xpForNextLevel,
                    'XP needed': data.xpToNext
                });
            }
        } else if (action === 'level_up' || action === 'levelup') {
            output = RichFormatter.header(`${data.name} Leveled Up!`, '🎉');
            output += RichFormatter.keyValue({
                'Previous Level': data.oldLevel,
                'New Level': data.newLevel,
                'HP Increase': data.hpIncrease || 0,
                'New Max HP': data.newMaxHp
            });
        } else {
            // Fallback for unknown actions
            output = RichFormatter.header('Character Operation', '👤');
            output += JSON.stringify(data, null, 2) + '\n';
        }

        // Embed JSON for programmatic access
        output += RichFormatter.embedJson(data, 'CHARACTER_MANAGE');

        return { content: [{ type: 'text', text: output }] };
    } catch {
        // If JSON parsing fails, return original response
        return response;
    }
}
