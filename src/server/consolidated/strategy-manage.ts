/**
 * Consolidated Strategy Management Tool
 * Replaces 6 separate tools: create_nation, get_strategy_state, get_nation_state, propose_alliance, claim_region, resolve_turn
 */

import { z } from 'zod';
import { createActionRouter, ActionDefinition, McpResponse } from '../../utils/action-router.js';
import { SessionContext } from '../types.js';
import { RichFormatter } from '../utils/formatter.js';
import { getDb } from '../../storage/index.js';
import { NationRepository } from '../../storage/repos/nation.repo.js';
import { DiplomacyRepository } from '../../storage/repos/diplomacy.repo.js';
import { RegionRepository } from '../../storage/repos/region.repo.js';
import { NationManager } from '../../engine/strategy/nation-manager.js';
import { DiplomacyEngine } from '../../engine/strategy/diplomacy-engine.js';
import { ConflictResolver } from '../../engine/strategy/conflict-resolver.js';
import { TurnProcessor } from '../../engine/strategy/turn-processor.js';
import { FogOfWar } from '../../engine/strategy/fog-of-war.js';
import { randomUUID } from 'crypto';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const ACTIONS = [
    'create_nation', 'get_state', 'propose_alliance', 'claim_region', 'resolve_turn', 'list_nations'
] as const;
type StrategyAction = typeof ACTIONS[number];

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function getRepos() {
    const dbPath = process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db';
    const db = getDb(dbPath);
    return {
        nationRepo: new NationRepository(db),
        diplomacyRepo: new DiplomacyRepository(db),
        regionRepo: new RegionRepository(db),
        db
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

const CreateNationSchema = z.object({
    action: z.literal('create_nation'),
    worldId: z.string().describe('ID of the world to create nation in'),
    name: z.string().describe('Name of the nation'),
    leader: z.string().describe('Name of the nation leader'),
    ideology: z.enum(['democracy', 'autocracy', 'theocracy', 'tribal']).describe('Political ideology'),
    aggression: z.number().min(0).max(100).default(50).describe('Aggression trait (0-100)'),
    trust: z.number().min(0).max(100).default(50).describe('Trust trait (0-100)'),
    paranoia: z.number().min(0).max(100).default(50).describe('Paranoia trait (0-100)'),
    startingResources: z.object({
        food: z.number().default(100),
        metal: z.number().default(50),
        oil: z.number().default(10)
    }).optional()
});

const GetStateSchema = z.object({
    action: z.literal('get_state'),
    worldId: z.string().optional().describe('World ID for strategy view'),
    nationId: z.string().describe('Nation ID to get state for'),
    viewType: z.enum(['public', 'private', 'fog_of_war']).default('fog_of_war')
        .describe('public=basic info, private=full nation state, fog_of_war=world view with visibility')
});

const ProposeAllianceSchema = z.object({
    action: z.literal('propose_alliance'),
    fromNationId: z.string().describe('Nation proposing alliance'),
    toNationId: z.string().describe('Target nation for alliance')
});

const ClaimRegionSchema = z.object({
    action: z.literal('claim_region'),
    nationId: z.string().describe('Nation making the claim'),
    regionId: z.string().describe('Region being claimed'),
    justification: z.string().optional().describe('Reason for the claim')
});

const ResolveTurnSchema = z.object({
    action: z.literal('resolve_turn'),
    worldId: z.string().describe('World to process turn for'),
    turnNumber: z.number().describe('Turn number to resolve')
});

const ListNationsSchema = z.object({
    action: z.literal('list_nations'),
    worldId: z.string().describe('World ID to list nations from')
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTION HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

async function handleCreateNation(args: z.infer<typeof CreateNationSchema>): Promise<object> {
    const { nationRepo } = getRepos();
    const nationManager = new NationManager(nationRepo);

    const { startingResources, action: _action, ...params } = args;

    const nation = nationManager.createNation({
        ...params,
        gdp: 1000,
        resources: startingResources || { food: 100, metal: 50, oil: 10 },
        privateMemory: {},
        publicIntent: 'Survival'
    });

    return {
        success: true,
        actionType: 'create_nation',
        nationId: nation.id,
        name: nation.name,
        leader: nation.leader,
        ideology: nation.ideology,
        traits: {
            aggression: nation.aggression,
            trust: nation.trust,
            paranoia: nation.paranoia
        },
        resources: nation.resources
    };
}

async function handleGetState(args: z.infer<typeof GetStateSchema>): Promise<object> {
    const { nationRepo, diplomacyRepo, regionRepo } = getRepos();
    const nationManager = new NationManager(nationRepo);
    const fogOfWar = new FogOfWar(diplomacyRepo);

    const nation = nationManager.getNation(args.nationId);
    if (!nation) {
        return {
            error: true,
            actionType: 'get_state',
            message: 'Nation not found'
        };
    }

    switch (args.viewType) {
        case 'private':
            // Full nation state (for the nation's own AI)
            return {
                success: true,
                actionType: 'get_state',
                viewType: 'private',
                nation: nation
            };

        case 'public':
            // Basic public info only
            return {
                success: true,
                actionType: 'get_state',
                viewType: 'public',
                nation: {
                    id: nation.id,
                    name: nation.name,
                    leader: nation.leader,
                    ideology: nation.ideology,
                    publicIntent: nation.publicIntent
                }
            };

        case 'fog_of_war':
        default:
            // World state filtered by what this nation can see
            if (!args.worldId) {
                return {
                    error: true,
                    actionType: 'get_state',
                    message: 'worldId required for fog_of_war view'
                };
            }
            const allNations = nationRepo.findByWorldId(args.worldId);
            const allRegions = regionRepo.findByWorldId(args.worldId);
            const filtered = fogOfWar.filterWorldState(args.nationId, allNations, allRegions);

            return {
                success: true,
                actionType: 'get_state',
                viewType: 'fog_of_war',
                viewingNation: nation.name,
                worldState: filtered
            };
    }
}

async function handleProposeAlliance(args: z.infer<typeof ProposeAllianceSchema>): Promise<object> {
    const { nationRepo, diplomacyRepo } = getRepos();
    const diplomacyEngine = new DiplomacyEngine(diplomacyRepo, nationRepo);

    const fromNation = nationRepo.findById(args.fromNationId);
    const toNation = nationRepo.findById(args.toNationId);

    if (!fromNation || !toNation) {
        return {
            error: true,
            actionType: 'propose_alliance',
            message: 'One or both nations not found'
        };
    }

    const result = diplomacyEngine.proposeAlliance(args.fromNationId, args.toNationId);

    return {
        success: true,
        actionType: 'propose_alliance',
        fromNation: fromNation.name,
        toNation: toNation.name,
        result: result
    };
}

async function handleClaimRegion(args: z.infer<typeof ClaimRegionSchema>): Promise<object> {
    const { nationRepo, diplomacyRepo, regionRepo } = getRepos();

    const nation = nationRepo.findById(args.nationId);
    const region = regionRepo.findById(args.regionId);

    if (!nation) {
        return {
            error: true,
            actionType: 'claim_region',
            message: 'Nation not found'
        };
    }

    if (!region) {
        return {
            error: true,
            actionType: 'claim_region',
            message: 'Region not found'
        };
    }

    diplomacyRepo.createClaim({
        id: randomUUID(),
        nationId: args.nationId,
        regionId: args.regionId,
        claimStrength: 100,
        justification: args.justification,
        createdAt: new Date().toISOString()
    });

    return {
        success: true,
        actionType: 'claim_region',
        nation: nation.name,
        region: region.name,
        justification: args.justification || 'No justification provided'
    };
}

async function handleResolveTurn(args: z.infer<typeof ResolveTurnSchema>): Promise<object> {
    const { nationRepo, diplomacyRepo, regionRepo } = getRepos();
    const conflictResolver = new ConflictResolver();
    const turnProcessor = new TurnProcessor(nationRepo, regionRepo, diplomacyRepo, conflictResolver);

    turnProcessor.processTurn(args.worldId, args.turnNumber);

    const events = diplomacyRepo.getEventsByWorld(args.worldId, args.turnNumber);

    return {
        success: true,
        actionType: 'resolve_turn',
        worldId: args.worldId,
        turnNumber: args.turnNumber,
        status: 'Turn Resolved',
        eventsCount: events.length,
        events: events.slice(0, 10) // Limit to 10 events in response
    };
}

async function handleListNations(args: z.infer<typeof ListNationsSchema>): Promise<object> {
    const { nationRepo } = getRepos();

    const nations = nationRepo.findByWorldId(args.worldId);

    return {
        success: true,
        actionType: 'list_nations',
        worldId: args.worldId,
        count: nations.length,
        nations: nations.map(n => ({
            id: n.id,
            name: n.name,
            leader: n.leader,
            ideology: n.ideology,
            publicIntent: n.publicIntent
        }))
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION ROUTER
// ═══════════════════════════════════════════════════════════════════════════

const definitions: Record<StrategyAction, ActionDefinition> = {
    create_nation: {
        schema: CreateNationSchema,
        handler: async (args) => handleCreateNation(args as z.infer<typeof CreateNationSchema>),
        aliases: ['new_nation', 'add_nation', 'spawn_nation'],
        description: 'Create a new nation in the world'
    },
    get_state: {
        schema: GetStateSchema,
        handler: async (args) => handleGetState(args as z.infer<typeof GetStateSchema>),
        aliases: ['nation_state', 'get_nation', 'view_state', 'strategy_state'],
        description: 'Get nation or world state (public, private, or fog of war)'
    },
    propose_alliance: {
        schema: ProposeAllianceSchema,
        handler: async (args) => handleProposeAlliance(args as z.infer<typeof ProposeAllianceSchema>),
        aliases: ['alliance', 'ally', 'offer_alliance'],
        description: 'Propose an alliance to another nation'
    },
    claim_region: {
        schema: ClaimRegionSchema,
        handler: async (args) => handleClaimRegion(args as z.infer<typeof ClaimRegionSchema>),
        aliases: ['claim', 'claim_territory', 'territorial_claim'],
        description: 'Assert a territorial claim on a region'
    },
    resolve_turn: {
        schema: ResolveTurnSchema,
        handler: async (args) => handleResolveTurn(args as z.infer<typeof ResolveTurnSchema>),
        aliases: ['process_turn', 'end_turn', 'turn_resolution'],
        description: 'Process a full turn cycle (economy, conflicts, etc.)'
    },
    list_nations: {
        schema: ListNationsSchema,
        handler: async (args) => handleListNations(args as z.infer<typeof ListNationsSchema>),
        aliases: ['nations', 'all_nations', 'get_nations'],
        description: 'List all nations in a world'
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

export const StrategyManageTool = {
    name: 'strategy_manage',
    description: `Grand strategy nation management for multi-agent games.

🏰 NATION SETUP:
1. create_nation - Define nation with ideology, traits, resources
2. get_state - Query nation state (public/private/fog_of_war view)
3. list_nations - See all nations in world

🎭 NATION TRAITS:
- ideology: democracy | autocracy | theocracy | tribal
- aggression: 0-100 (affects AI behavior)
- trust: 0-100 (alliance reliability)
- paranoia: 0-100 (defensive posture)

💰 STARTING RESOURCES:
- food: Population growth
- metal: Military production
- oil: Advanced units/vehicles

🤝 DIPLOMACY:
- propose_alliance: Offer pact to another nation
- claim_region: Assert territorial expansion

⚔️ TURN RESOLUTION:
Use turn_manage for turn lifecycle. resolve_turn processes:
- Resource production
- Territory conflicts
- Alliance effects

Actions: create_nation, get_state, propose_alliance, claim_region, resolve_turn, list_nations`,
    inputSchema: z.object({
        action: z.string().describe(`Action: ${ACTIONS.join(', ')}`),
        // Create nation params
        worldId: z.string().optional(),
        name: z.string().optional(),
        leader: z.string().optional(),
        ideology: z.enum(['democracy', 'autocracy', 'theocracy', 'tribal']).optional(),
        aggression: z.number().optional(),
        trust: z.number().optional(),
        paranoia: z.number().optional(),
        startingResources: z.object({
            food: z.number(),
            metal: z.number(),
            oil: z.number()
        }).optional(),
        // Get state params
        nationId: z.string().optional(),
        viewType: z.enum(['public', 'private', 'fog_of_war']).optional(),
        // Alliance params
        fromNationId: z.string().optional(),
        toNationId: z.string().optional(),
        // Claim params
        regionId: z.string().optional(),
        justification: z.string().optional(),
        // Turn params
        turnNumber: z.number().optional()
    })
};

export async function handleStrategyManage(args: unknown, _ctx: SessionContext): Promise<McpResponse> {
    const result = await router(args as Record<string, unknown>);
    const parsed = JSON.parse(result.content[0].text);

    let output = '';

    if (parsed.error) {
        output = RichFormatter.header('Strategy Error', '');
        output += RichFormatter.alert(parsed.message || 'Unknown error', 'error');
        if (parsed.suggestions) {
            output += '\n**Did you mean:**\n';
            parsed.suggestions.forEach((s: { action: string; similarity: number }) => {
                output += `  - ${s.action} (${s.similarity}% match)\n`;
            });
        }
    } else {
        switch (parsed.actionType) {
            case 'create_nation':
                output = RichFormatter.header('Nation Created', '');
                output += RichFormatter.keyValue({
                    'Nation ID': parsed.nationId,
                    'Name': parsed.name,
                    'Leader': parsed.leader,
                    'Ideology': parsed.ideology,
                    'Aggression': parsed.traits?.aggression,
                    'Trust': parsed.traits?.trust,
                    'Paranoia': parsed.traits?.paranoia
                });
                if (parsed.resources) {
                    output += '\n**Starting Resources:**\n';
                    output += `  Food: ${parsed.resources.food}, Metal: ${parsed.resources.metal}, Oil: ${parsed.resources.oil}\n`;
                }
                break;

            case 'get_state':
                output = RichFormatter.header(`Nation State (${parsed.viewType})`, '');
                if (parsed.viewType === 'public') {
                    output += RichFormatter.keyValue({
                        'ID': parsed.nation?.id,
                        'Name': parsed.nation?.name,
                        'Leader': parsed.nation?.leader,
                        'Ideology': parsed.nation?.ideology,
                        'Public Intent': parsed.nation?.publicIntent
                    });
                } else if (parsed.viewType === 'private') {
                    output += `Full nation state included in JSON\n`;
                } else {
                    output += `Viewing as: ${parsed.viewingNation}\n`;
                    output += `World state with fog of war applied\n`;
                }
                break;

            case 'propose_alliance':
                output = RichFormatter.header('Alliance Proposal', '');
                output += RichFormatter.keyValue({
                    'From': parsed.fromNation,
                    'To': parsed.toNation,
                    'Result': JSON.stringify(parsed.result)
                });
                break;

            case 'claim_region':
                output = RichFormatter.header('Territorial Claim', '');
                output += RichFormatter.keyValue({
                    'Nation': parsed.nation,
                    'Region': parsed.region,
                    'Justification': parsed.justification
                });
                break;

            case 'resolve_turn':
                output = RichFormatter.header('Turn Resolved', '');
                output += RichFormatter.keyValue({
                    'World': parsed.worldId,
                    'Turn': parsed.turnNumber,
                    'Status': parsed.status,
                    'Events': parsed.eventsCount
                });
                break;

            case 'list_nations':
                output = RichFormatter.header('Nations List', '');
                output += `World: ${parsed.worldId}\n`;
                output += `Count: ${parsed.count}\n\n`;
                if (parsed.nations?.length > 0) {
                    parsed.nations.forEach((n: { name: string; ideology: string; leader: string }) => {
                        output += `• ${n.name} (${n.ideology}) - ${n.leader}\n`;
                    });
                } else {
                    output += 'No nations in this world.\n';
                }
                break;

            default:
                output = RichFormatter.header('Strategy', '');
                output += JSON.stringify(parsed, null, 2) + '\n';
        }
    }

    output += RichFormatter.embedJson(parsed, 'STRATEGY_MANAGE');

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}
