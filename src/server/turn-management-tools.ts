import { z } from 'zod';
import { getDb } from '../storage/index.js';
import { TurnStateRepository } from '../storage/repos/turn-state.repo.js';
import { NationRepository } from '../storage/repos/nation.repo.js';
import { DiplomacyRepository } from '../storage/repos/diplomacy.repo.js';
import { RegionRepository } from '../storage/repos/region.repo.js';
import { TurnProcessor } from '../engine/strategy/turn-processor.js';
import { ConflictResolver } from '../engine/strategy/conflict-resolver.js';
import { TurnActionSchema } from '../schema/turn-state.js';

// Tool Definitions
export const TurnManagementTools = {
    INIT_TURN_STATE: {
        name: 'init_turn_state',
        description: 'Initialize turn management for a world (call once per world)',
        inputSchema: z.object({
            worldId: z.string()
        })
    },
    GET_TURN_STATUS: {
        name: 'get_turn_status',
        description: 'Check current turn state and which nations are ready',
        inputSchema: z.object({
            worldId: z.string()
        })
    },
    SUBMIT_TURN_ACTIONS: {
        name: 'submit_turn_actions',
        description: 'Submit actions for this turn (batched)',
        inputSchema: z.object({
            worldId: z.string(),
            nationId: z.string(),
            actions: z.array(TurnActionSchema)
        })
    },
    MARK_READY: {
        name: 'mark_ready',
        description: 'Signal that your nation is done planning for this turn',
        inputSchema: z.object({
            worldId: z.string(),
            nationId: z.string()
        })
    },
    POLL_TURN_RESULTS: {
        name: 'poll_turn_results',
        description: 'Check if turn has resolved and get results',
        inputSchema: z.object({
            worldId: z.string(),
            turnNumber: z.number()
        })
    }
} as const;

// Handler
export async function handleTurnManagementTool(name: string, args: any) {
    const db = getDb();
    const turnStateRepo = new TurnStateRepository(db);
    const nationRepo = new NationRepository(db);
    const diplomacyRepo = new DiplomacyRepository(db);
    const regionRepo = new RegionRepository(db);

    switch (name) {
        case 'init_turn_state': {
            const { worldId } = args;
            const existing = turnStateRepo.findByWorldId(worldId);
            if (existing) {
                return { content: [{ type: 'text', text: 'Turn state already initialized' }] };
            }
            const now = new Date().toISOString();
            turnStateRepo.create({
                worldId,
                currentTurn: 1,
                turnPhase: 'planning',
                phaseStartedAt: now,
                nationsReady: [],
                createdAt: now,
                updatedAt: now
            });
            return { content: [{ type: 'text', text: 'Turn state initialized' }] };
        }

        case 'get_turn_status': {
            const { worldId } = args;
            const turnState = turnStateRepo.findByWorldId(worldId);
            if (!turnState) {
                return { content: [{ type: 'text', text: 'Turn state not initialized' }] };
            }
            const allNations = nationRepo.findByWorldId(worldId);
            const waitingFor = allNations
                .filter(n => !turnState.nationsReady.includes(n.id))
                .map(n => n.name);

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        currentTurn: turnState.currentTurn,
                        phase: turnState.turnPhase,
                        nationsReady: turnState.nationsReady.length,
                        totalNations: allNations.length,
                        waitingFor,
                        canSubmitActions: turnState.turnPhase === 'planning'
                    }, null, 2)
                }]
            };
        }

        case 'submit_turn_actions': {
            const { worldId, nationId, actions } = args;
            const turnState = turnStateRepo.findByWorldId(worldId);
            if (!turnState || turnState.turnPhase !== 'planning') {
                return { content: [{ type: 'text', text: 'Cannot submit actions (not in planning phase)' }] };
            }

            // Execute actions immediately (for simplicity)
            // In production, you might queue these
            for (const action of actions) {
                switch (action.type) {
                    case 'claim_region':
                        diplomacyRepo.createClaim({
                            id: `claim-${Date.now()}-${Math.random()}`,
                            nationId,
                            regionId: action.regionId!,
                            claimStrength: 100,
                            justification: action.justification,
                            createdAt: new Date().toISOString()
                        });
                        break;
                    case 'propose_alliance':
                        // Use existing diplomacy logic
                        const relation = diplomacyRepo.getRelation(nationId, action.toNationId!);
                        if (!relation || relation.opinion >= 50) {
                            diplomacyRepo.upsertRelation({
                                fromNationId: nationId,
                                toNationId: action.toNationId!,
                                opinion: relation?.opinion || 50,
                                isAllied: true,
                                truceUntil: undefined,
                                updatedAt: new Date().toISOString()
                            });
                        }
                        break;
                    // Add other action types as needed
                }
            }

            return {
                content: [{
                    type: 'text',
                    text: `${actions.length} actions submitted for turn ${turnState.currentTurn}`
                }]
            };
        }

        case 'mark_ready': {
            const { worldId, nationId } = args;
            const turnState = turnStateRepo.findByWorldId(worldId);
            if (!turnState || turnState.turnPhase !== 'planning') {
                return { content: [{ type: 'text', text: 'Cannot mark ready (not in planning phase)' }] };
            }

            turnStateRepo.addReadyNation(worldId, nationId);
            const updated = turnStateRepo.findByWorldId(worldId)!;
            const allNations = nationRepo.findByWorldId(worldId);

            // Check if all ready -> trigger resolution
            if (updated.nationsReady.length === allNations.length && allNations.length > 0) {
                // Start resolution
                turnStateRepo.updatePhase(worldId, 'resolution');

                // Process turn
                const conflictResolver = new ConflictResolver();
                const turnProcessor = new TurnProcessor(nationRepo, regionRepo, diplomacyRepo, conflictResolver);
                turnProcessor.processTurn(worldId, updated.currentTurn);

                // Move to finished
                turnStateRepo.updatePhase(worldId, 'finished');
                turnStateRepo.incrementTurn(worldId);
                turnStateRepo.clearReadyNations(worldId);
                turnStateRepo.updatePhase(worldId, 'planning');

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            message: 'All nations ready! Turn resolved.',
                            turnResolved: updated.currentTurn,
                            nextTurn: updated.currentTurn + 1
                        }, null, 2)
                    }]
                };
            }

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        ready: true,
                        allReady: false,
                        waitingFor: allNations.filter(n => !updated.nationsReady.includes(n.id)).map(n => n.name)
                    }, null, 2)
                }]
            };
        }

        case 'poll_turn_results': {
            const { worldId, turnNumber } = args;
            const turnState = turnStateRepo.findByWorldId(worldId);
            if (!turnState) {
                return { content: [{ type: 'text', text: 'Turn state not found' }] };
            }

            if (turnState.currentTurn > turnNumber) {
                // Turn has resolved
                const events = diplomacyRepo.getEventsByWorld(worldId, turnNumber);
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            resolved: true,
                            events,
                            nextTurn: turnState.currentTurn,
                            phase: turnState.turnPhase
                        }, null, 2)
                    }]
                };
            } else if (turnState.turnPhase === 'resolution') {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            resolved: false,
                            phase: 'resolution',
                            message: 'Turn is being resolved...'
                        }, null, 2)
                    }]
                };
            } else {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            resolved: false,
                            phase: turnState.turnPhase,
                            message: 'Turn not yet resolved'
                        }, null, 2)
                    }]
                };
            }
        }

        default:
            throw new Error(`Unknown turn management tool: ${name}`);
    }
}
