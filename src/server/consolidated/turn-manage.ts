/**
 * Consolidated Turn Management Tool
 * Replaces 5 separate tools: init_turn_state, get_turn_status, submit_turn_actions, mark_ready, poll_turn_results
 */

import { z } from 'zod';
import { createActionRouter, ActionDefinition, McpResponse } from '../../utils/action-router.js';
import { SessionContext } from '../types.js';
import { RichFormatter } from '../utils/formatter.js';
import { getDb } from '../../storage/index.js';
import { TurnStateRepository } from '../../storage/repos/turn-state.repo.js';
import { NationRepository } from '../../storage/repos/nation.repo.js';
import { DiplomacyRepository } from '../../storage/repos/diplomacy.repo.js';
import { RegionRepository } from '../../storage/repos/region.repo.js';
import { TurnProcessor } from '../../engine/strategy/turn-processor.js';
import { ConflictResolver } from '../../engine/strategy/conflict-resolver.js';
import { TurnActionSchema } from '../../schema/turn-state.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const ACTIONS = [
    'init', 'get_status', 'submit_actions', 'mark_ready', 'poll_results'
] as const;
type TurnAction = typeof ACTIONS[number];

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function getRepos() {
    const dbPath = process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db';
    const db = getDb(dbPath);
    return {
        turnStateRepo: new TurnStateRepository(db),
        nationRepo: new NationRepository(db),
        diplomacyRepo: new DiplomacyRepository(db),
        regionRepo: new RegionRepository(db),
        db
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

const InitSchema = z.object({
    action: z.literal('init'),
    worldId: z.string().describe('World ID to initialize turn management for')
});

const GetStatusSchema = z.object({
    action: z.literal('get_status'),
    worldId: z.string().describe('World ID to get turn status for')
});

const SubmitActionsSchema = z.object({
    action: z.literal('submit_actions'),
    worldId: z.string().describe('World ID'),
    nationId: z.string().describe('Nation submitting actions'),
    actions: z.array(TurnActionSchema).describe('Array of actions to submit')
});

const MarkReadySchema = z.object({
    action: z.literal('mark_ready'),
    worldId: z.string().describe('World ID'),
    nationId: z.string().describe('Nation marking ready')
});

const PollResultsSchema = z.object({
    action: z.literal('poll_results'),
    worldId: z.string().describe('World ID'),
    turnNumber: z.number().describe('Turn number to poll results for')
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTION HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

async function handleInit(args: z.infer<typeof InitSchema>): Promise<object> {
    const { turnStateRepo } = getRepos();

    const existing = turnStateRepo.findByWorldId(args.worldId);
    if (existing) {
        return {
            success: true,
            actionType: 'init',
            worldId: args.worldId,
            alreadyInitialized: true,
            currentTurn: existing.currentTurn,
            phase: existing.turnPhase,
            message: 'Turn state already initialized'
        };
    }

    const now = new Date().toISOString();
    turnStateRepo.create({
        worldId: args.worldId,
        currentTurn: 1,
        turnPhase: 'planning',
        phaseStartedAt: now,
        nationsReady: [],
        createdAt: now,
        updatedAt: now
    });

    return {
        success: true,
        actionType: 'init',
        worldId: args.worldId,
        currentTurn: 1,
        phase: 'planning',
        message: 'Turn state initialized'
    };
}

async function handleGetStatus(args: z.infer<typeof GetStatusSchema>): Promise<object> {
    const { turnStateRepo, nationRepo } = getRepos();

    const turnState = turnStateRepo.findByWorldId(args.worldId);
    if (!turnState) {
        return {
            error: true,
            actionType: 'get_status',
            message: 'Turn state not initialized. Call init first.'
        };
    }

    const allNations = nationRepo.findByWorldId(args.worldId);
    const waitingFor = allNations
        .filter(n => !turnState.nationsReady.includes(n.id))
        .map(n => ({ id: n.id, name: n.name }));

    return {
        success: true,
        actionType: 'get_status',
        worldId: args.worldId,
        currentTurn: turnState.currentTurn,
        phase: turnState.turnPhase,
        phaseStartedAt: turnState.phaseStartedAt,
        nationsReady: turnState.nationsReady.length,
        totalNations: allNations.length,
        waitingFor: waitingFor,
        canSubmitActions: turnState.turnPhase === 'planning',
        allReady: waitingFor.length === 0 && allNations.length > 0
    };
}

async function handleSubmitActions(args: z.infer<typeof SubmitActionsSchema>): Promise<object> {
    const { turnStateRepo, diplomacyRepo, nationRepo } = getRepos();

    const turnState = turnStateRepo.findByWorldId(args.worldId);
    if (!turnState) {
        return {
            error: true,
            actionType: 'submit_actions',
            message: 'Turn state not initialized'
        };
    }

    if (turnState.turnPhase !== 'planning') {
        return {
            error: true,
            actionType: 'submit_actions',
            message: `Cannot submit actions in ${turnState.turnPhase} phase. Only allowed during planning.`
        };
    }

    const nation = nationRepo.findById(args.nationId);
    if (!nation) {
        return {
            error: true,
            actionType: 'submit_actions',
            message: 'Nation not found'
        };
    }

    const processedActions: string[] = [];

    // Execute actions immediately
    for (const action of args.actions) {
        switch (action.type) {
            case 'claim_region':
                if (action.regionId) {
                    diplomacyRepo.createClaim({
                        id: `claim-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                        nationId: args.nationId,
                        regionId: action.regionId,
                        claimStrength: 100,
                        justification: action.justification,
                        createdAt: new Date().toISOString()
                    });
                    processedActions.push(`Claimed region ${action.regionId}`);
                }
                break;

            case 'propose_alliance':
                if (action.toNationId) {
                    const relation = diplomacyRepo.getRelation(args.nationId, action.toNationId);
                    if (!relation || relation.opinion >= 50) {
                        diplomacyRepo.upsertRelation({
                            fromNationId: args.nationId,
                            toNationId: action.toNationId,
                            opinion: relation?.opinion || 50,
                            isAllied: true,
                            truceUntil: undefined,
                            updatedAt: new Date().toISOString()
                        });
                        processedActions.push(`Alliance proposed to ${action.toNationId}`);
                    }
                }
                break;

            case 'break_alliance':
                if (action.toNationId) {
                    const relation = diplomacyRepo.getRelation(args.nationId, action.toNationId);
                    if (relation?.isAllied) {
                        diplomacyRepo.upsertRelation({
                            ...relation,
                            isAllied: false,
                            updatedAt: new Date().toISOString()
                        });
                        processedActions.push(`Alliance broken with ${action.toNationId}`);
                    }
                }
                break;

            case 'declare_intent':
                if (action.intent) {
                    processedActions.push(`Intent declared: ${action.intent}`);
                }
                break;

            case 'send_message':
                if (action.message && action.toNationId) {
                    processedActions.push(`Message sent to ${action.toNationId}`);
                }
                break;

            case 'adjust_relations':
                if (action.toNationId && action.opinionDelta !== undefined) {
                    const relation = diplomacyRepo.getRelation(args.nationId, action.toNationId);
                    diplomacyRepo.upsertRelation({
                        fromNationId: args.nationId,
                        toNationId: action.toNationId,
                        opinion: (relation?.opinion || 50) + action.opinionDelta,
                        isAllied: relation?.isAllied || false,
                        truceUntil: relation?.truceUntil,
                        updatedAt: new Date().toISOString()
                    });
                    processedActions.push(`Relations adjusted with ${action.toNationId}: ${action.opinionDelta > 0 ? '+' : ''}${action.opinionDelta}`);
                }
                break;
        }
    }

    return {
        success: true,
        actionType: 'submit_actions',
        worldId: args.worldId,
        nationId: args.nationId,
        nationName: nation.name,
        turn: turnState.currentTurn,
        actionsSubmitted: args.actions.length,
        processedActions: processedActions
    };
}

async function handleMarkReady(args: z.infer<typeof MarkReadySchema>): Promise<object> {
    const { turnStateRepo, nationRepo, diplomacyRepo, regionRepo } = getRepos();

    const turnState = turnStateRepo.findByWorldId(args.worldId);
    if (!turnState) {
        return {
            error: true,
            actionType: 'mark_ready',
            message: 'Turn state not initialized'
        };
    }

    if (turnState.turnPhase !== 'planning') {
        return {
            error: true,
            actionType: 'mark_ready',
            message: `Cannot mark ready in ${turnState.turnPhase} phase`
        };
    }

    const nation = nationRepo.findById(args.nationId);
    if (!nation) {
        return {
            error: true,
            actionType: 'mark_ready',
            message: 'Nation not found'
        };
    }

    turnStateRepo.addReadyNation(args.worldId, args.nationId);
    const updated = turnStateRepo.findByWorldId(args.worldId)!;
    const allNations = nationRepo.findByWorldId(args.worldId);

    // Check if all ready -> trigger resolution
    if (updated.nationsReady.length === allNations.length && allNations.length > 0) {
        // Start resolution
        turnStateRepo.updatePhase(args.worldId, 'resolution');

        // Process turn
        const conflictResolver = new ConflictResolver();
        const turnProcessor = new TurnProcessor(nationRepo, regionRepo, diplomacyRepo, conflictResolver);
        turnProcessor.processTurn(args.worldId, updated.currentTurn);

        // Move to finished then back to planning for next turn
        turnStateRepo.updatePhase(args.worldId, 'finished');
        turnStateRepo.incrementTurn(args.worldId);
        turnStateRepo.clearReadyNations(args.worldId);
        turnStateRepo.updatePhase(args.worldId, 'planning');

        return {
            success: true,
            actionType: 'mark_ready',
            worldId: args.worldId,
            nationId: args.nationId,
            nationName: nation.name,
            allReady: true,
            turnResolved: updated.currentTurn,
            nextTurn: updated.currentTurn + 1,
            message: 'All nations ready! Turn resolved automatically.'
        };
    }

    const waitingFor = allNations
        .filter(n => !updated.nationsReady.includes(n.id))
        .map(n => ({ id: n.id, name: n.name }));

    return {
        success: true,
        actionType: 'mark_ready',
        worldId: args.worldId,
        nationId: args.nationId,
        nationName: nation.name,
        allReady: false,
        nationsReady: updated.nationsReady.length,
        totalNations: allNations.length,
        waitingFor: waitingFor
    };
}

async function handlePollResults(args: z.infer<typeof PollResultsSchema>): Promise<object> {
    const { turnStateRepo, diplomacyRepo } = getRepos();

    const turnState = turnStateRepo.findByWorldId(args.worldId);
    if (!turnState) {
        return {
            error: true,
            actionType: 'poll_results',
            message: 'Turn state not found'
        };
    }

    if (turnState.currentTurn > args.turnNumber) {
        // Turn has resolved
        const events = diplomacyRepo.getEventsByWorld(args.worldId, args.turnNumber);
        return {
            success: true,
            actionType: 'poll_results',
            worldId: args.worldId,
            turnNumber: args.turnNumber,
            resolved: true,
            eventsCount: events.length,
            events: events.slice(0, 10),
            nextTurn: turnState.currentTurn,
            currentPhase: turnState.turnPhase
        };
    } else if (turnState.turnPhase === 'resolution') {
        return {
            success: true,
            actionType: 'poll_results',
            worldId: args.worldId,
            turnNumber: args.turnNumber,
            resolved: false,
            phase: 'resolution',
            message: 'Turn is being resolved...'
        };
    } else {
        return {
            success: true,
            actionType: 'poll_results',
            worldId: args.worldId,
            turnNumber: args.turnNumber,
            resolved: false,
            phase: turnState.turnPhase,
            currentTurn: turnState.currentTurn,
            message: args.turnNumber === turnState.currentTurn
                ? 'Turn not yet resolved. Waiting for all nations to mark ready.'
                : `Turn ${args.turnNumber} is in the future (current: ${turnState.currentTurn})`
        };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION ROUTER
// ═══════════════════════════════════════════════════════════════════════════

const definitions: Record<TurnAction, ActionDefinition> = {
    init: {
        schema: InitSchema,
        handler: async (args) => handleInit(args as z.infer<typeof InitSchema>),
        aliases: ['initialize', 'init_turn', 'start_turns', 'setup'],
        description: 'Initialize turn management for a world'
    },
    get_status: {
        schema: GetStatusSchema,
        handler: async (args) => handleGetStatus(args as z.infer<typeof GetStatusSchema>),
        aliases: ['status', 'turn_status', 'check_turn', 'get_turn'],
        description: 'Get current turn status and which nations are ready'
    },
    submit_actions: {
        schema: SubmitActionsSchema,
        handler: async (args) => handleSubmitActions(args as z.infer<typeof SubmitActionsSchema>),
        aliases: ['submit', 'actions', 'queue_actions', 'turn_actions'],
        description: 'Submit actions for this turn'
    },
    mark_ready: {
        schema: MarkReadySchema,
        handler: async (args) => handleMarkReady(args as z.infer<typeof MarkReadySchema>),
        aliases: ['ready', 'done', 'end_planning', 'finish_planning'],
        description: 'Signal that nation is done planning for this turn'
    },
    poll_results: {
        schema: PollResultsSchema,
        handler: async (args) => handlePollResults(args as z.infer<typeof PollResultsSchema>),
        aliases: ['results', 'poll', 'check_results', 'get_results'],
        description: 'Check if turn has resolved and get results'
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

export const TurnManageTool = {
    name: 'turn_manage',
    description: `Turn-based strategy game management.
Actions: init, get_status, submit_actions, mark_ready, poll_results
Aliases: initialize->init, status->get_status, submit->submit_actions, ready->mark_ready, results->poll_results

INIT: Initialize turn state for a world (once per world)
GET_STATUS: Check current turn, phase, and which nations are ready
SUBMIT_ACTIONS: Submit batched actions (claims, alliances, messages)
MARK_READY: Signal done planning - auto-resolves if all nations ready
POLL_RESULTS: Check if turn resolved and get events`,
    inputSchema: z.object({
        action: z.string().describe(`Action: ${ACTIONS.join(', ')}`),
        worldId: z.string().describe('World ID'),
        nationId: z.string().optional().describe('Nation ID (for submit_actions, mark_ready)'),
        actions: z.array(TurnActionSchema).optional().describe('Actions to submit'),
        turnNumber: z.number().optional().describe('Turn number (for poll_results)')
    })
};

export async function handleTurnManage(args: unknown, _ctx: SessionContext): Promise<McpResponse> {
    const result = await router(args);
    const parsed = JSON.parse(result.content[0].text);

    let output = '';

    if (parsed.error) {
        output = RichFormatter.header('Turn Management Error', '');
        output += RichFormatter.alert(parsed.message || 'Unknown error', 'error');
        if (parsed.suggestions) {
            output += '\n**Did you mean:**\n';
            parsed.suggestions.forEach((s: { action: string; similarity: number }) => {
                output += `  - ${s.action} (${s.similarity}% match)\n`;
            });
        }
    } else {
        switch (parsed.actionType) {
            case 'init':
                output = RichFormatter.header('Turn State', '');
                output += RichFormatter.keyValue({
                    'World': parsed.worldId,
                    'Current Turn': parsed.currentTurn,
                    'Phase': parsed.phase,
                    'Status': parsed.alreadyInitialized ? 'Already initialized' : 'Newly initialized'
                });
                break;

            case 'get_status':
                output = RichFormatter.header('Turn Status', '');
                output += RichFormatter.keyValue({
                    'World': parsed.worldId,
                    'Turn': parsed.currentTurn,
                    'Phase': parsed.phase,
                    'Nations Ready': `${parsed.nationsReady}/${parsed.totalNations}`,
                    'Can Submit': parsed.canSubmitActions ? 'Yes' : 'No'
                });
                if (parsed.waitingFor?.length > 0) {
                    output += '\n**Waiting for:**\n';
                    parsed.waitingFor.forEach((n: { name: string }) => {
                        output += `  • ${n.name}\n`;
                    });
                }
                break;

            case 'submit_actions':
                output = RichFormatter.header('Actions Submitted', '');
                output += RichFormatter.keyValue({
                    'Nation': parsed.nationName,
                    'Turn': parsed.turn,
                    'Actions': parsed.actionsSubmitted
                });
                if (parsed.processedActions?.length > 0) {
                    output += '\n**Processed:**\n';
                    parsed.processedActions.forEach((a: string) => {
                        output += `  ✓ ${a}\n`;
                    });
                }
                break;

            case 'mark_ready':
                output = RichFormatter.header('Nation Ready', '');
                if (parsed.allReady) {
                    output += RichFormatter.alert('All nations ready! Turn resolved.', 'success');
                    output += RichFormatter.keyValue({
                        'Turn Resolved': parsed.turnResolved,
                        'Next Turn': parsed.nextTurn
                    });
                } else {
                    output += RichFormatter.keyValue({
                        'Nation': parsed.nationName,
                        'Ready': `${parsed.nationsReady}/${parsed.totalNations}`
                    });
                    if (parsed.waitingFor?.length > 0) {
                        output += '\n**Still waiting for:**\n';
                        parsed.waitingFor.forEach((n: { name: string }) => {
                            output += `  • ${n.name}\n`;
                        });
                    }
                }
                break;

            case 'poll_results':
                output = RichFormatter.header('Turn Results', '');
                if (parsed.resolved) {
                    output += RichFormatter.alert(`Turn ${parsed.turnNumber} resolved!`, 'success');
                    output += RichFormatter.keyValue({
                        'Events': parsed.eventsCount,
                        'Next Turn': parsed.nextTurn,
                        'Current Phase': parsed.currentPhase
                    });
                } else {
                    output += RichFormatter.keyValue({
                        'Turn': parsed.turnNumber,
                        'Resolved': 'No',
                        'Phase': parsed.phase || parsed.currentPhase,
                        'Message': parsed.message
                    });
                }
                break;

            default:
                output = RichFormatter.header('Turn Management', '');
                output += JSON.stringify(parsed, null, 2) + '\n';
        }
    }

    output += RichFormatter.embedJson(parsed, 'TURN_MANAGE');

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}
