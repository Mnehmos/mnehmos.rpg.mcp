/**
 * Consolidated World Management Tool
 * Replaces 7 separate tools for world lifecycle management:
 * create_world, get_world, list_worlds, delete_world, update_world_environment,
 * generate_world, get_world_state
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';
import { createActionRouter, ActionDefinition, McpResponse } from '../../utils/action-router.js';
import { SessionContext } from '../types.js';
import { RichFormatter } from '../utils/formatter.js';
import { getDb } from '../../storage/index.js';
import { WorldRepository } from '../../storage/repos/world.repo.js';
import { World } from '../../schema/world.js';
import { generateWorld as generateWorldProc } from '../../engine/worldgen/index.js';
import { getWorldManager } from '../state/world-manager.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const ACTIONS = ['create', 'get', 'list', 'delete', 'update', 'generate', 'get_state'] as const;
type WorldManageAction = typeof ACTIONS[number];

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE HELPER
// ═══════════════════════════════════════════════════════════════════════════

function getWorldRepo(): WorldRepository {
    const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
    return new WorldRepository(db);
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

const CreateSchema = z.object({
    action: z.literal('create'),
    name: z.string().min(1).describe('World name'),
    seed: z.string().describe('Seed for generation'),
    width: z.number().int().min(10).max(1000).describe('World width'),
    height: z.number().int().min(10).max(1000).describe('World height'),
    landRatio: z.number().min(0.1).max(0.9).optional().describe('Land to water ratio')
});

const GetSchema = z.object({
    action: z.literal('get'),
    id: z.string().describe('World ID')
});

const ListSchema = z.object({
    action: z.literal('list')
});

const DeleteSchema = z.object({
    action: z.literal('delete'),
    id: z.string().describe('World ID to delete')
});

const UpdateSchema = z.object({
    action: z.literal('update'),
    id: z.string().describe('World ID'),
    environment: z.object({
        dayNightCycle: z.enum(['day', 'night', 'dawn', 'dusk']).optional(),
        weather: z.string().optional(),
        season: z.enum(['spring', 'summer', 'autumn', 'winter']).optional(),
        temperature: z.string().optional(),
        lighting: z.string().optional()
    }).passthrough().describe('Environment properties to update')
});

const GenerateSchema = z.object({
    action: z.literal('generate'),
    seed: z.string().describe('Seed for random number generation'),
    width: z.number().int().min(10).max(1000).describe('Width of the world grid'),
    height: z.number().int().min(10).max(1000).describe('Height of the world grid'),
    landRatio: z.number().min(0.1).max(0.9).optional().describe('Land to water ratio'),
    temperatureOffset: z.number().min(-30).max(30).optional().describe('Temperature offset'),
    moistureOffset: z.number().min(-30).max(30).optional().describe('Moisture offset')
});

const GetStateSchema = z.object({
    action: z.literal('get_state'),
    worldId: z.string().describe('World ID')
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTION HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

async function handleCreate(args: z.infer<typeof CreateSchema>): Promise<object> {
    const worldRepo = getWorldRepo();
    const now = new Date().toISOString();

    const world: World = {
        id: randomUUID(),
        name: args.name,
        seed: args.seed,
        width: args.width,
        height: args.height,
        createdAt: now,
        updatedAt: now
    };

    worldRepo.create(world);

    return {
        success: true,
        actionType: 'create',
        worldId: world.id,
        name: world.name,
        seed: world.seed,
        dimensions: { width: world.width, height: world.height },
        message: `Created world "${world.name}" (${world.width}x${world.height})`
    };
}

async function handleGet(args: z.infer<typeof GetSchema>): Promise<object> {
    const worldRepo = getWorldRepo();
    const world = worldRepo.findById(args.id);

    if (!world) {
        return { error: true, message: `World not found: ${args.id}` };
    }

    return {
        success: true,
        actionType: 'get',
        world: {
            id: world.id,
            name: world.name,
            seed: world.seed,
            width: world.width,
            height: world.height,
            environment: world.environment,
            createdAt: world.createdAt,
            updatedAt: world.updatedAt
        }
    };
}

async function handleList(): Promise<object> {
    const worldRepo = getWorldRepo();
    const worlds = worldRepo.findAll();

    return {
        success: true,
        actionType: 'list',
        count: worlds.length,
        worlds: worlds.map(w => ({
            id: w.id,
            name: w.name,
            seed: w.seed,
            dimensions: { width: w.width, height: w.height },
            createdAt: w.createdAt
        }))
    };
}

async function handleDelete(args: z.infer<typeof DeleteSchema>): Promise<object> {
    const worldRepo = getWorldRepo();
    worldRepo.delete(args.id);

    // Also remove from in-memory state
    const worldManager = getWorldManager();
    worldManager.delete(args.id);

    return {
        success: true,
        actionType: 'delete',
        deletedId: args.id,
        message: `Deleted world ${args.id}`
    };
}

async function handleUpdate(args: z.infer<typeof UpdateSchema>): Promise<object> {
    const worldRepo = getWorldRepo();
    const updated = worldRepo.updateEnvironment(args.id, args.environment);

    if (!updated) {
        return { error: true, message: `World not found: ${args.id}` };
    }

    return {
        success: true,
        actionType: 'update',
        worldId: args.id,
        environment: args.environment,
        message: `Updated environment for world ${args.id}`
    };
}

async function handleGenerate(args: z.infer<typeof GenerateSchema>): Promise<object> {
    const worldRepo = getWorldRepo();
    const worldManager = getWorldManager();

    // Generate the procedural world
    const generatedWorld = generateWorldProc({
        seed: args.seed,
        width: args.width,
        height: args.height,
        landRatio: args.landRatio,
        temperatureOffset: args.temperatureOffset,
        moistureOffset: args.moistureOffset
    });

    // Create DB record
    const now = new Date().toISOString();
    const world: World = {
        id: `world-${args.seed}-${Date.now()}`,
        name: `World (${args.seed})`,
        seed: args.seed,
        width: args.width,
        height: args.height,
        createdAt: now,
        updatedAt: now
    };

    worldRepo.create(world);

    // Store in memory for fast access
    worldManager.create(world.id, generatedWorld);

    // Calculate biome stats from 2D biomes array
    const biomeStats: Record<string, number> = {};
    for (let y = 0; y < generatedWorld.biomes.length; y++) {
        for (let x = 0; x < generatedWorld.biomes[y].length; x++) {
            const biome = generatedWorld.biomes[y][x];
            biomeStats[biome] = (biomeStats[biome] || 0) + 1;
        }
    }

    const tileCount = args.width * args.height;

    return {
        success: true,
        actionType: 'generate',
        worldId: world.id,
        seed: args.seed,
        dimensions: { width: args.width, height: args.height },
        tileCount: tileCount,
        regionCount: generatedWorld.regions.length,
        biomeDistribution: biomeStats,
        message: `Generated ${args.width}x${args.height} world with ${generatedWorld.regions.length} regions`
    };
}

async function handleGetState(args: z.infer<typeof GetStateSchema>): Promise<object> {
    const worldManager = getWorldManager();
    const worldRepo = getWorldRepo();

    const dbWorld = worldRepo.findById(args.worldId);
    const memWorld = worldManager.get(args.worldId);

    if (!dbWorld && !memWorld) {
        return { error: true, message: `World not found: ${args.worldId}` };
    }

    // Calculate tile count from biomes 2D array if in memory
    let tileCount = 0;
    if (memWorld?.biomes) {
        tileCount = memWorld.width * memWorld.height;
    }

    return {
        success: true,
        actionType: 'get_state',
        worldId: args.worldId,
        name: dbWorld?.name,
        inMemory: !!memWorld,
        inDatabase: !!dbWorld,
        tileCount: tileCount,
        regionCount: memWorld?.regions?.length || 0,
        environment: dbWorld?.environment
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION ROUTER
// ═══════════════════════════════════════════════════════════════════════════

const definitions: Record<WorldManageAction, ActionDefinition> = {
    create: {
        schema: CreateSchema,
        handler: handleCreate,
        aliases: ['new', 'add'],
        description: 'Create a new world in the database'
    },
    get: {
        schema: GetSchema,
        handler: handleGet,
        aliases: ['fetch', 'retrieve'],
        description: 'Get world details by ID'
    },
    list: {
        schema: ListSchema,
        handler: handleList,
        aliases: ['all', 'show'],
        description: 'List all worlds'
    },
    delete: {
        schema: DeleteSchema,
        handler: handleDelete,
        aliases: ['remove', 'destroy'],
        description: 'Delete a world'
    },
    update: {
        schema: UpdateSchema,
        handler: handleUpdate,
        aliases: ['set', 'modify', 'environment'],
        description: 'Update world environment (time, weather, season)'
    },
    generate: {
        schema: GenerateSchema,
        handler: handleGenerate,
        aliases: ['gen', 'procedural', 'worldgen'],
        description: 'Generate a procedural world with terrain and biomes'
    },
    get_state: {
        schema: GetStateSchema,
        handler: handleGetState,
        aliases: ['state', 'status'],
        description: 'Get current world state (in-memory and database)'
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

export const WorldManageTool = {
    name: 'world_manage',
    description: `Manage RPG worlds - creation, retrieval, and procedural generation.
Actions: create, get, list, delete, update (environment), generate (procedural), get_state
Aliases: new→create, fetch→get, all→list, remove→delete, set→update, gen→generate, state→get_state

🌍 WORLD WORKFLOW:
1. generate - Create procedural world with terrain/biomes
2. get_state - Check world status
3. update - Set time/weather/season
4. For map operations, use world_map tool instead`,
    inputSchema: z.object({
        action: z.string().describe(`Action: ${ACTIONS.join(', ')}`),
        id: z.string().optional().describe('World ID'),
        worldId: z.string().optional().describe('World ID (for get_state)'),
        name: z.string().optional().describe('World name (for create)'),
        seed: z.string().optional().describe('Seed for generation'),
        width: z.number().optional().describe('World width'),
        height: z.number().optional().describe('World height'),
        landRatio: z.number().optional(),
        temperatureOffset: z.number().optional(),
        moistureOffset: z.number().optional(),
        environment: z.any().optional().describe('Environment properties (for update)')
    })
};

export async function handleWorldManage(args: unknown, _ctx: SessionContext): Promise<McpResponse> {
    const result = await router(args as Record<string, unknown>);
    const parsed = JSON.parse(result.content[0].text);

    let output = '';

    if (parsed.error) {
        output = RichFormatter.header('Error', '❌');
        output += RichFormatter.alert(parsed.message || 'Unknown error', 'error');
        if (parsed.suggestions) {
            output += '\n**Did you mean:**\n';
            parsed.suggestions.forEach((s: { action: string; similarity: number }) => {
                output += `  • ${s.action} (${s.similarity}% match)\n`;
            });
        }
    } else {
        switch (parsed.actionType) {
            case 'create':
                output = RichFormatter.header('World Created', '🌍');
                output += RichFormatter.keyValue({
                    'ID': `\`${parsed.worldId}\``,
                    'Name': parsed.name,
                    'Dimensions': `${parsed.dimensions?.width}x${parsed.dimensions?.height}`
                });
                break;
            case 'get':
                output = RichFormatter.header('World Details', '🌍');
                if (parsed.world) {
                    output += RichFormatter.keyValue({
                        'ID': `\`${parsed.world.id}\``,
                        'Name': parsed.world.name,
                        'Seed': parsed.world.seed,
                        'Dimensions': `${parsed.world.width}x${parsed.world.height}`
                    });
                }
                break;
            case 'list':
                output = RichFormatter.header(`Worlds (${parsed.count})`, '🌍');
                if (parsed.worlds?.length > 0) {
                    parsed.worlds.forEach((w: { name: string; id: string }) => {
                        output += `• **${w.name}** (\`${w.id}\`)\n`;
                    });
                } else {
                    output += 'No worlds found.\n';
                }
                break;
            case 'delete':
                output = RichFormatter.header('World Deleted', '🗑️');
                output += RichFormatter.keyValue({ 'Deleted ID': `\`${parsed.deletedId}\`` });
                break;
            case 'update':
                output = RichFormatter.header('Environment Updated', '🌤️');
                output += RichFormatter.keyValue({ 'World ID': `\`${parsed.worldId}\`` });
                break;
            case 'generate':
                output = RichFormatter.header('World Generated', '🌍');
                output += RichFormatter.keyValue({
                    'ID': `\`${parsed.worldId}\``,
                    'Seed': parsed.seed,
                    'Dimensions': `${parsed.dimensions?.width}x${parsed.dimensions?.height}`,
                    'Tiles': parsed.tileCount,
                    'Regions': parsed.regionCount
                });
                break;
            case 'get_state':
                output = RichFormatter.header('World State', '📊');
                output += RichFormatter.keyValue({
                    'ID': `\`${parsed.worldId}\``,
                    'In Memory': parsed.inMemory ? '✅' : '❌',
                    'In Database': parsed.inDatabase ? '✅' : '❌',
                    'Tiles': parsed.tileCount,
                    'Regions': parsed.regionCount
                });
                break;
            default:
                output = RichFormatter.header('World', '🌍');
                if (parsed.message) output += parsed.message + '\n';
        }
    }

    output += RichFormatter.embedJson(parsed, 'WORLD_MANAGE');

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}
