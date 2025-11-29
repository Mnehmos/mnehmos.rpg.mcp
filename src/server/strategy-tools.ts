import { z } from 'zod';
import { SessionContext } from './types.js';
import { getDb } from '../storage/index.js';
import { NationRepository } from '../storage/repos/nation.repo.js';
import { DiplomacyRepository } from '../storage/repos/diplomacy.repo.js';
import { RegionRepository } from '../storage/repos/region.repo.js';
import { NationManager } from '../engine/strategy/nation-manager.js';
import { DiplomacyEngine } from '../engine/strategy/diplomacy-engine.js';
import { ConflictResolver } from '../engine/strategy/conflict-resolver.js';
import { TurnProcessor } from '../engine/strategy/turn-processor.js';
import { FogOfWar } from '../engine/strategy/fog-of-war.js';

// Tool Definitions
export const StrategyTools = {
    CREATE_NATION: {
        name: 'create_nation',
        description: 'Create a new nation in the world.',
        inputSchema: z.object({
            worldId: z.string(),
            name: z.string(),
            leader: z.string(),
            ideology: z.enum(['democracy', 'autocracy', 'theocracy', 'tribal']),
            aggression: z.number().min(0).max(100),
            trust: z.number().min(0).max(100),
            paranoia: z.number().min(0).max(100),
            startingResources: z.object({
                food: z.number(),
                metal: z.number(),
                oil: z.number()
            }).optional()
        })
    },
    GET_STRATEGY_STATE: {
        name: 'get_strategy_state',
        description: 'Get the world state from the perspective of a specific nation (applies Fog of War for Grand Strategy).',
        inputSchema: z.object({
            worldId: z.string(),
            viewerNationId: z.string()
        })
    },
    GET_NATION_STATE: {
        name: 'get_nation_state',
        description: 'Get private state for a specific nation (LLM only).',
        inputSchema: z.object({
            nationId: z.string()
        })
    },
    PROPOSE_ALLIANCE: {
        name: 'propose_alliance',
        description: 'Propose an alliance to another nation.',
        inputSchema: z.object({
            fromNationId: z.string(),
            toNationId: z.string()
        })
    },
    CLAIM_REGION: {
        name: 'claim_region',
        description: 'Assert a territorial claim on a region.',
        inputSchema: z.object({
            nationId: z.string(),
            regionId: z.string(),
            justification: z.string().optional()
        })
    },
    RESOLVE_TURN: {
        name: 'resolve_turn',
        description: 'Process a full turn cycle (economy, conflicts, etc.).',
        inputSchema: z.object({
            worldId: z.string(),
            turnNumber: z.number()
        })
    }
} as const;

// Tool Handlers
export async function handleStrategyTool(name: string, args: any, _ctx?: SessionContext) {
    const db = getDb();
    const nationRepo = new NationRepository(db);
    const diplomacyRepo = new DiplomacyRepository(db);
    const regionRepo = new RegionRepository(db);

    const nationManager = new NationManager(nationRepo);
    const diplomacyEngine = new DiplomacyEngine(diplomacyRepo, nationRepo);
    const conflictResolver = new ConflictResolver();
    const turnProcessor = new TurnProcessor(nationRepo, regionRepo, diplomacyRepo, conflictResolver);
    const fogOfWar = new FogOfWar(diplomacyRepo);

    switch (name) {
        case 'create_nation': {
            const { startingResources, ...params } = args;
            const nation = nationManager.createNation({
                ...params,
                gdp: 1000, // Default starting GDP
                resources: startingResources || { food: 100, metal: 50, oil: 10 },
                privateMemory: {},
                publicIntent: 'Survival'
            });
            return { content: [{ type: 'text', text: JSON.stringify(nation, null, 2) }] };
        }

        case 'get_strategy_state': {
            const { worldId, viewerNationId } = args;
            const allNations = nationRepo.findByWorldId(worldId);
            const allRegions = regionRepo.findByWorldId(worldId);

            const filtered = fogOfWar.filterWorldState(viewerNationId, allNations, allRegions);
            return { content: [{ type: 'text', text: JSON.stringify(filtered, null, 2) }] };
        }

        case 'get_nation_state': {
            const { nationId } = args;
            const nation = nationManager.getNation(nationId);
            if (!nation) throw new Error('Nation not found');
            return { content: [{ type: 'text', text: JSON.stringify(nation, null, 2) }] };
        }

        case 'propose_alliance': {
            const { fromNationId, toNationId } = args;
            const result = diplomacyEngine.proposeAlliance(fromNationId, toNationId);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'claim_region': {
            const { nationId, regionId, justification } = args;
            diplomacyRepo.createClaim({
                id: `claim-${Date.now()}-${Math.random()}`, // Simple ID generation
                nationId,
                regionId,
                claimStrength: 100,
                justification,
                createdAt: new Date().toISOString()
            });
            return { content: [{ type: 'text', text: `Claim registered for ${regionId}` }] };
        }

        case 'resolve_turn': {
            const { worldId, turnNumber } = args;
            turnProcessor.processTurn(worldId, turnNumber);

            // Get events for this turn
            const events = diplomacyRepo.getEventsByWorld(worldId, turnNumber);
            return { content: [{ type: 'text', text: JSON.stringify({ status: 'Turn Resolved', events }, null, 2) }] };
        }

        default:
            throw new Error(`Unknown tool: ${name}`);
    }
}
