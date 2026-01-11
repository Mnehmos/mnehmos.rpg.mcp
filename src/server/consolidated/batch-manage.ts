/**
 * Consolidated batch_manage tool
 * Replaces: batch_create_characters, batch_create_npcs, batch_distribute_items, execute_workflow, list_templates, get_template
 * 6 tools → 1 tool with 6 actions
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';
import { matchAction, isGuidingError } from '../../utils/fuzzy-enum.js';
import { RichFormatter } from '../utils/formatter.js';
import { getDb } from '../../storage/index.js';
import { CharacterRepository } from '../../storage/repos/character.repo.js';
import { SessionContext } from '../types.js';

export interface McpResponse {
    content: Array<{ type: 'text'; text: string }>;
}

const ACTIONS = [
    'create_characters', 'create_npcs', 'distribute_items',
    'execute_workflow', 'list_templates', 'get_template'
] as const;

type BatchAction = typeof ACTIONS[number];

// Alias map for fuzzy action matching
const ALIASES: Record<string, BatchAction> = {
    'characters': 'create_characters',
    'batch_characters': 'create_characters',
    'create_party': 'create_characters',
    'spawn_characters': 'create_characters',
    'npcs': 'create_npcs',
    'batch_npcs': 'create_npcs',
    'populate': 'create_npcs',
    'spawn_npcs': 'create_npcs',
    'distribute': 'distribute_items',
    'give_items': 'distribute_items',
    'equip_all': 'distribute_items',
    'batch_items': 'distribute_items',
    'workflow': 'execute_workflow',
    'execute': 'execute_workflow',
    'run_workflow': 'execute_workflow',
    'run': 'execute_workflow',
    'templates': 'list_templates',
    'list_workflows': 'list_templates',
    'available': 'list_templates',
    'template': 'get_template',
    'get_workflow': 'get_template',
    'show_template': 'get_template'
};

function ensureDb() {
    const dbPath = process.env.NODE_ENV === 'test'
        ? ':memory:'
        : process.env.RPG_DATA_DIR
            ? `${process.env.RPG_DATA_DIR}/rpg.db`
            : 'rpg.db';
    const db = getDb(dbPath);
    return {
        db,
        charRepo: new CharacterRepository(db)
    };
}

// Workflow templates
const WORKFLOW_TEMPLATES: Record<string, {
    name: string;
    description: string;
    steps: Array<{ tool: string; args: Record<string, any> }>;
    requiredParams: string[];
}> = {
    'start_campaign': {
        name: 'Start Campaign',
        description: 'Create a new world, party, and starting location',
        steps: [
            { tool: 'world_manage', args: { action: 'generate', name: '{{worldName}}', seed: '{{seed}}' } },
            { tool: 'party_manage', args: { action: 'create', name: '{{partyName}}' } },
            { tool: 'spawn_manage', args: { action: 'spawn_preset_location', preset: 'generic_tavern' } }
        ],
        requiredParams: ['worldName', 'partyName']
    },
    'setup_encounter': {
        name: 'Setup Encounter',
        description: 'Create an encounter with enemies and position party',
        steps: [
            { tool: 'spawn_manage', args: { action: 'spawn_encounter', preset: '{{encounterPreset}}', partyId: '{{partyId}}' } }
        ],
        requiredParams: ['encounterPreset', 'partyId']
    },
    'end_session': {
        name: 'End Session',
        description: 'Save state and rest party',
        steps: [
            { tool: 'travel_manage', args: { action: 'rest', partyId: '{{partyId}}', restType: 'long' } },
            { tool: 'session_manage', args: { action: 'get_context', partyId: '{{partyId}}' } }
        ],
        requiredParams: ['partyId']
    }
};

// Character schema for batch creation
const BatchCharacterSchema = z.object({
    name: z.string().min(1),
    class: z.string().optional().default('Adventurer'),
    race: z.string().optional().default('Human'),
    level: z.number().int().min(1).optional().default(1),
    hp: z.number().int().min(1).optional(),
    maxHp: z.number().int().min(1).optional(),
    ac: z.number().int().min(0).optional().default(10),
    stats: z.object({
        str: z.number().int().min(0).default(10),
        dex: z.number().int().min(0).default(10),
        con: z.number().int().min(0).default(10),
        int: z.number().int().min(0).default(10),
        wis: z.number().int().min(0).default(10),
        cha: z.number().int().min(0).default(10)
    }).optional(),
    characterType: z.enum(['pc', 'npc', 'enemy', 'ally']).optional().default('pc'),
    background: z.string().optional()
});

// NPC schema for batch creation
const BatchNpcSchema = z.object({
    name: z.string().min(1),
    role: z.string().describe('NPC profession or role'),
    race: z.string().optional().default('Human'),
    behavior: z.string().optional().describe('NPC personality'),
    factionId: z.string().optional()
});

// Input schema
const BatchManageInputSchema = z.object({
    action: z.string().describe('Action: create_characters, create_npcs, distribute_items, execute_workflow, list_templates, get_template'),

    // create_characters fields
    characters: z.array(BatchCharacterSchema).max(20).optional()
        .describe('Array of characters to create (1-20)'),

    // create_npcs fields
    locationName: z.string().optional().describe('Location for NPCs'),
    npcs: z.array(BatchNpcSchema).max(50).optional()
        .describe('Array of NPCs to create (1-50)'),

    // distribute_items fields
    distributions: z.array(z.object({
        characterId: z.string().describe('Character ID'),
        items: z.array(z.string()).min(1).describe('Items to give')
    })).max(20).optional().describe('Item distributions (1-20)'),

    // workflow fields
    templateId: z.string().optional().describe('Workflow template ID'),
    params: z.record(z.string(), z.any()).optional().describe('Template parameters')
});

type BatchManageInput = z.infer<typeof BatchManageInputSchema>;

// Action handlers
async function handleCreateCharacters(input: BatchManageInput, _ctx: SessionContext): Promise<McpResponse> {
    if (!input.characters || input.characters.length === 0) {
        return {
            content: [{
                type: 'text',
                text: RichFormatter.error('create_characters requires characters array') +
                    RichFormatter.embedJson({ error: true, message: 'characters required' }, 'BATCH_MANAGE')
            }]
        };
    }

    const { charRepo } = ensureDb();
    const now = new Date().toISOString();

    const createdCharacters: any[] = [];
    const errors: string[] = [];

    for (const charData of input.characters) {
        try {
            const stats = charData.stats ?? { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
            const conModifier = Math.floor((stats.con - 10) / 2);
            const baseHp = Math.max(1, 8 + conModifier);
            const hp = charData.hp ?? baseHp;
            const maxHp = charData.maxHp ?? hp;

            const character = {
                id: randomUUID(),
                name: charData.name,
                race: charData.race,
                characterClass: charData.class || 'Adventurer',
                characterType: charData.characterType,
                level: charData.level,
                stats,
                hp,
                maxHp,
                ac: charData.ac,
                background: charData.background,
                createdAt: now,
                updatedAt: now
            };

            charRepo.create(character as any);
            createdCharacters.push({
                id: character.id,
                name: charData.name,
                class: charData.class,
                race: charData.race,
                characterType: charData.characterType
            });
        } catch (err: any) {
            errors.push(`Failed to create ${charData.name}: ${err.message}`);
        }
    }

    let output = RichFormatter.header('Characters Created', '👥');
    const rows = createdCharacters.map(c => [c.name, c.class, c.race, c.characterType]);
    output += RichFormatter.table(['Name', 'Class', 'Race', 'Type'], rows);
    output += `\n*${createdCharacters.length} character(s) created*\n`;

    if (errors.length > 0) {
        output += RichFormatter.section('Errors');
        output += RichFormatter.list(errors);
    }

    const result = {
        success: errors.length === 0,
        actionType: 'create_characters',
        created: createdCharacters,
        createdCount: createdCharacters.length,
        errors: errors.length > 0 ? errors : undefined
    };

    output += RichFormatter.embedJson(result, 'BATCH_MANAGE');

    return { content: [{ type: 'text', text: output }] };
}

async function handleCreateNpcs(input: BatchManageInput, _ctx: SessionContext): Promise<McpResponse> {
    if (!input.npcs || input.npcs.length === 0) {
        return {
            content: [{
                type: 'text',
                text: RichFormatter.error('create_npcs requires npcs array') +
                    RichFormatter.embedJson({ error: true, message: 'npcs required' }, 'BATCH_MANAGE')
            }]
        };
    }

    const { charRepo } = ensureDb();
    const now = new Date().toISOString();

    const createdNpcs: any[] = [];
    const errors: string[] = [];

    for (const npcData of input.npcs) {
        try {
            const npc = {
                id: randomUUID(),
                name: npcData.name,
                race: npcData.race,
                characterClass: npcData.role,
                characterType: 'npc' as const,
                behavior: npcData.behavior,
                factionId: npcData.factionId,
                hp: 10,
                maxHp: 10,
                ac: 10,
                level: 1,
                stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
                createdAt: now,
                updatedAt: now,
                metadata: input.locationName ? JSON.stringify({ location: input.locationName }) : undefined
            };

            charRepo.create(npc as any);
            createdNpcs.push({
                id: npc.id,
                name: npcData.name,
                role: npcData.role,
                race: npcData.race,
                location: input.locationName
            });
        } catch (err: any) {
            errors.push(`Failed to create NPC ${npcData.name}: ${err.message}`);
        }
    }

    let output = RichFormatter.header('NPCs Created', '🧑');
    if (input.locationName) {
        output += RichFormatter.keyValue({ 'Location': input.locationName });
    }
    const rows = createdNpcs.map(n => [n.name, n.role, n.race]);
    output += RichFormatter.table(['Name', 'Role', 'Race'], rows);
    output += `\n*${createdNpcs.length} NPC(s) created*\n`;

    if (errors.length > 0) {
        output += RichFormatter.section('Errors');
        output += RichFormatter.list(errors);
    }

    const result = {
        success: errors.length === 0,
        actionType: 'create_npcs',
        locationName: input.locationName,
        created: createdNpcs,
        createdCount: createdNpcs.length,
        errors: errors.length > 0 ? errors : undefined
    };

    output += RichFormatter.embedJson(result, 'BATCH_MANAGE');

    return { content: [{ type: 'text', text: output }] };
}

async function handleDistributeItems(input: BatchManageInput, _ctx: SessionContext): Promise<McpResponse> {
    if (!input.distributions || input.distributions.length === 0) {
        return {
            content: [{
                type: 'text',
                text: RichFormatter.error('distribute_items requires distributions array') +
                    RichFormatter.embedJson({ error: true, message: 'distributions required' }, 'BATCH_MANAGE')
            }]
        };
    }

    const { db } = ensureDb();

    const distributions: any[] = [];
    const errors: string[] = [];

    for (const dist of input.distributions) {
        try {
            const charStmt = db.prepare('SELECT * FROM characters WHERE id = ?');
            const character = charStmt.get(dist.characterId) as any;

            if (!character) {
                errors.push(`Character not found: ${dist.characterId}`);
                continue;
            }

            // Parse existing inventory
            let inventory: string[] = [];
            if (character.inventory) {
                try {
                    inventory = JSON.parse(character.inventory);
                } catch {
                    inventory = [];
                }
            }

            // Add new items
            inventory.push(...dist.items);

            // Update character inventory
            const updateStmt = db.prepare('UPDATE characters SET inventory = ?, updated_at = ? WHERE id = ?');
            updateStmt.run(JSON.stringify(inventory), new Date().toISOString(), dist.characterId);

            distributions.push({
                characterId: dist.characterId,
                characterName: character.name,
                itemsGiven: dist.items,
                newInventorySize: inventory.length
            });
        } catch (err: any) {
            errors.push(`Failed to distribute to ${dist.characterId}: ${err.message}`);
        }
    }

    const totalItems = distributions.reduce((sum, d) => sum + d.itemsGiven.length, 0);

    let output = RichFormatter.header('Items Distributed', '🎁');
    output += RichFormatter.keyValue({ 'Total Items': totalItems, 'Recipients': distributions.length });

    for (const dist of distributions) {
        output += `\n**${dist.characterName}**: ${dist.itemsGiven.join(', ')}\n`;
    }

    if (errors.length > 0) {
        output += RichFormatter.section('Errors');
        output += RichFormatter.list(errors);
    }

    const result = {
        success: errors.length === 0,
        actionType: 'distribute_items',
        distributions,
        totalItemsDistributed: totalItems,
        errors: errors.length > 0 ? errors : undefined
    };

    output += RichFormatter.embedJson(result, 'BATCH_MANAGE');

    return { content: [{ type: 'text', text: output }] };
}

async function handleExecuteWorkflow(input: BatchManageInput, _ctx: SessionContext): Promise<McpResponse> {
    if (!input.templateId) {
        return {
            content: [{
                type: 'text',
                text: RichFormatter.error('execute_workflow requires templateId') +
                    RichFormatter.embedJson({ error: true, message: 'templateId required' }, 'BATCH_MANAGE')
            }]
        };
    }

    const template = WORKFLOW_TEMPLATES[input.templateId];
    if (!template) {
        return {
            content: [{
                type: 'text',
                text: RichFormatter.error(`Unknown workflow template: ${input.templateId}`) +
                    RichFormatter.embedJson({
                        error: true,
                        message: `Unknown template: ${input.templateId}`,
                        availableTemplates: Object.keys(WORKFLOW_TEMPLATES)
                    }, 'BATCH_MANAGE')
            }]
        };
    }

    // Check required params
    const params = input.params || {};
    const missingParams = template.requiredParams.filter(p => !params[p]);
    if (missingParams.length > 0) {
        return {
            content: [{
                type: 'text',
                text: RichFormatter.error(`Missing required parameters: ${missingParams.join(', ')}`) +
                    RichFormatter.embedJson({
                        error: true,
                        message: 'Missing parameters',
                        missingParams,
                        requiredParams: template.requiredParams
                    }, 'BATCH_MANAGE')
            }]
        };
    }

    // Substitute parameters in steps
    const resolvedSteps = template.steps.map(step => {
        const resolvedArgs: Record<string, any> = {};
        for (const [key, value] of Object.entries(step.args)) {
            if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
                const paramName = value.slice(2, -2);
                resolvedArgs[key] = params[paramName];
            } else {
                resolvedArgs[key] = value;
            }
        }
        return { tool: step.tool, args: resolvedArgs };
    });

    let output = RichFormatter.header(`Workflow: ${template.name}`, '⚙️');
    output += `*${template.description}*\n\n`;

    output += RichFormatter.section('Steps to Execute');
    for (let i = 0; i < resolvedSteps.length; i++) {
        const step = resolvedSteps[i];
        output += `${i + 1}. \`${step.tool}\` with action: ${step.args.action || 'default'}\n`;
    }

    output += '\n*Note: Workflow prepared but not auto-executed. Call each tool step manually for safety.*\n';

    const result = {
        success: true,
        actionType: 'execute_workflow',
        templateId: input.templateId,
        templateName: template.name,
        steps: resolvedSteps,
        message: 'Workflow prepared. Execute steps manually.'
    };

    output += RichFormatter.embedJson(result, 'BATCH_MANAGE');

    return { content: [{ type: 'text', text: output }] };
}

async function handleListTemplates(_input: BatchManageInput, _ctx: SessionContext): Promise<McpResponse> {
    const templates = Object.entries(WORKFLOW_TEMPLATES).map(([id, t]) => ({
        id,
        name: t.name,
        description: t.description,
        requiredParams: t.requiredParams,
        stepCount: t.steps.length
    }));

    let output = RichFormatter.header('Workflow Templates', '📋');

    for (const t of templates) {
        output += `\n**${t.name}** (\`${t.id}\`)\n`;
        output += `${t.description}\n`;
        output += `Steps: ${t.stepCount} | Params: ${t.requiredParams.join(', ') || 'none'}\n`;
    }

    const result = {
        success: true,
        actionType: 'list_templates',
        templates,
        count: templates.length
    };

    output += RichFormatter.embedJson(result, 'BATCH_MANAGE');

    return { content: [{ type: 'text', text: output }] };
}

async function handleGetTemplate(input: BatchManageInput, _ctx: SessionContext): Promise<McpResponse> {
    if (!input.templateId) {
        return {
            content: [{
                type: 'text',
                text: RichFormatter.error('get_template requires templateId') +
                    RichFormatter.embedJson({ error: true, message: 'templateId required' }, 'BATCH_MANAGE')
            }]
        };
    }

    const template = WORKFLOW_TEMPLATES[input.templateId];
    if (!template) {
        return {
            content: [{
                type: 'text',
                text: RichFormatter.error(`Unknown template: ${input.templateId}`) +
                    RichFormatter.embedJson({
                        error: true,
                        message: `Unknown template: ${input.templateId}`,
                        availableTemplates: Object.keys(WORKFLOW_TEMPLATES)
                    }, 'BATCH_MANAGE')
            }]
        };
    }

    let output = RichFormatter.header(template.name, '📄');
    output += `*${template.description}*\n\n`;

    output += RichFormatter.section('Required Parameters');
    if (template.requiredParams.length > 0) {
        output += RichFormatter.list(template.requiredParams);
    } else {
        output += '*None*\n';
    }

    output += RichFormatter.section('Steps');
    for (let i = 0; i < template.steps.length; i++) {
        const step = template.steps[i];
        output += `${i + 1}. **${step.tool}**\n`;
        output += `   Args: ${JSON.stringify(step.args)}\n`;
    }

    const result = {
        success: true,
        actionType: 'get_template',
        templateId: input.templateId,
        template: {
            name: template.name,
            description: template.description,
            requiredParams: template.requiredParams,
            steps: template.steps
        }
    };

    output += RichFormatter.embedJson(result, 'BATCH_MANAGE');

    return { content: [{ type: 'text', text: output }] };
}

// Main handler
export async function handleBatchManage(args: unknown, _ctx: SessionContext): Promise<McpResponse> {
    const input = BatchManageInputSchema.parse(args);
    const matchResult = matchAction(input.action, ACTIONS, ALIASES, 0.6);

    if (isGuidingError(matchResult)) {
        let output = RichFormatter.error(`Unknown action: "${input.action}"`);
        output += `\nAvailable actions: ${ACTIONS.join(', ')}`;
        if (matchResult.suggestions.length > 0) {
            output += `\nDid you mean: ${matchResult.suggestions.map(s => `"${s.value}" (${Math.round(s.similarity * 100)}%)`).join(', ')}?`;
        }
        output += RichFormatter.embedJson(matchResult, 'BATCH_MANAGE');
        return { content: [{ type: 'text', text: output }] };
    }

    switch (matchResult.matched) {
        case 'create_characters':
            return handleCreateCharacters(input, _ctx);
        case 'create_npcs':
            return handleCreateNpcs(input, _ctx);
        case 'distribute_items':
            return handleDistributeItems(input, _ctx);
        case 'execute_workflow':
            return handleExecuteWorkflow(input, _ctx);
        case 'list_templates':
            return handleListTemplates(input, _ctx);
        case 'get_template':
            return handleGetTemplate(input, _ctx);
        default:
            return {
                content: [{
                    type: 'text',
                    text: RichFormatter.error(`Unhandled action: ${matchResult.matched}`) +
                        RichFormatter.embedJson({ error: true, message: `Unhandled: ${matchResult.matched}` }, 'BATCH_MANAGE')
                }]
            };
    }
}

// Tool definition for registration
export const BatchManageTool = {
    name: 'batch_manage',
    description: `Consolidated batch operations (6→1).

Actions:
• create_characters - Create multiple characters at once (up to 20)
• create_npcs - Create NPCs for a location (up to 50)
• distribute_items - Give items to multiple characters
• execute_workflow - Run a predefined workflow template
• list_templates - List available workflow templates
• get_template - Get details of a workflow template

Examples:
- Create party: { action: "create_characters", characters: [{ name: "Valeros", class: "Fighter" }, ...] }
- Populate village: { action: "create_npcs", locationName: "Thornwood", npcs: [{ name: "Marta", role: "Innkeeper" }, ...] }
- Distribute loot: { action: "distribute_items", distributions: [{ characterId: "...", items: ["Sword", "Shield"] }, ...] }
- List workflows: { action: "list_templates" }`,
    inputSchema: BatchManageInputSchema
};
