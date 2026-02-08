/**
 * Consolidated Quest Management Tool
 * Replaces 8 separate tools for quest operations:
 * create_quest, get_quest, list_quests, assign_quest, update_objective,
 * complete_objective, complete_quest, get_quest_log
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';
import { createActionRouter, ActionDefinition, McpResponse } from '../../utils/action-router.js';
import { SessionContext } from '../types.js';
import { RichFormatter } from '../utils/formatter.js';
import { getDb } from '../../storage/index.js';
import { QuestRepository } from '../../storage/repos/quest.repo.js';
import { CharacterRepository } from '../../storage/repos/character.repo.js';
import { InventoryRepository } from '../../storage/repos/inventory.repo.js';
import { ItemRepository } from '../../storage/repos/item.repo.js';
// Quest types from schema: kill, collect, deliver, explore, interact, custom

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const ACTIONS = ['create', 'get', 'list', 'assign', 'update_objective', 'complete_objective', 'complete', 'get_log'] as const;
type QuestManageAction = typeof ACTIONS[number];

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE HELPER
// ═══════════════════════════════════════════════════════════════════════════

function ensureDb() {
    const dbPath = process.env.NODE_ENV === 'test'
        ? ':memory:'
        : process.env.RPG_DATA_DIR
            ? `${process.env.RPG_DATA_DIR}/rpg.db`
            : 'rpg.db';
    const db = getDb(dbPath);
    return {
        questRepo: new QuestRepository(db),
        characterRepo: new CharacterRepository(db),
        inventoryRepo: new InventoryRepository(db),
        itemRepo: new ItemRepository(db)
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

const CreateSchema = z.object({
    action: z.literal('create'),
    name: z.string().min(1).describe('Quest name'),
    description: z.string().describe('Quest description'),
    worldId: z.string().describe('World ID'),
    giver: z.string().optional().describe('Quest giver name'),
    objectives: z.array(z.object({
        id: z.string().optional(),
        description: z.string(),
        type: z.enum(['kill', 'collect', 'deliver', 'explore', 'interact', 'custom']),
        target: z.string().default(''),
        required: z.number().int().min(1).default(1),
        current: z.number().int().default(0),
        completed: z.boolean().default(false)
    })).min(1).describe('Quest objectives'),
    rewards: z.object({
        experience: z.number().int().min(0).default(0),
        gold: z.number().int().min(0).default(0),
        items: z.array(z.string()).default([])
    }).default({ experience: 0, gold: 0, items: [] }),
    prerequisites: z.array(z.string()).default([]).describe('Required completed quest IDs'),
    status: z.enum(['available', 'active', 'completed', 'failed']).default('available')
});

const GetSchema = z.object({
    action: z.literal('get'),
    questId: z.string().describe('Quest ID')
});

const ListSchema = z.object({
    action: z.literal('list'),
    worldId: z.string().optional().describe('Filter by world ID')
});

const AssignSchema = z.object({
    action: z.literal('assign'),
    characterId: z.string().describe('Character ID'),
    questId: z.string().describe('Quest ID to assign')
});

const UpdateObjectiveSchema = z.object({
    action: z.literal('update_objective'),
    characterId: z.string().describe('Character ID'),
    questId: z.string().describe('Quest ID'),
    objectiveId: z.string().describe('Objective ID'),
    progress: z.number().int().min(1).default(1).describe('Progress increment')
});

const CompleteObjectiveSchema = z.object({
    action: z.literal('complete_objective'),
    questId: z.string().describe('Quest ID'),
    objectiveId: z.string().describe('Objective ID to complete')
});

const CompleteSchema = z.object({
    action: z.literal('complete'),
    characterId: z.string().describe('Character ID'),
    questId: z.string().describe('Quest ID to complete')
});

const GetLogSchema = z.object({
    action: z.literal('get_log'),
    characterId: z.string().describe('Character ID')
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTION HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

async function handleCreate(args: z.infer<typeof CreateSchema>): Promise<object> {
    const { questRepo } = ensureDb();
    const now = new Date().toISOString();

    // Ensure all objectives have IDs and required fields
    const objectives = args.objectives.map(obj => ({
        ...obj,
        id: obj.id || randomUUID(),
        target: obj.target || '',
        current: obj.current ?? 0,
        completed: obj.completed ?? false
    }));

    const quest = {
        id: randomUUID(),
        name: args.name,
        description: args.description,
        worldId: args.worldId,
        giver: args.giver,
        objectives,
        rewards: args.rewards,
        prerequisites: args.prerequisites,
        status: args.status,
        createdAt: now,
        updatedAt: now
    };

    questRepo.create(quest);

    return {
        success: true,
        actionType: 'create',
        questId: quest.id,
        name: quest.name,
        objectiveCount: objectives.length,
        message: `Created quest "${quest.name}" with ${objectives.length} objectives`
    };
}

async function handleGet(args: z.infer<typeof GetSchema>): Promise<object> {
    const { questRepo } = ensureDb();
    const quest = questRepo.findById(args.questId);

    if (!quest) {
        return { error: true, message: `Quest ${args.questId} not found` };
    }

    return {
        success: true,
        actionType: 'get',
        quest: {
            id: quest.id,
            name: quest.name,
            description: quest.description,
            worldId: quest.worldId,
            giver: quest.giver,
            status: quest.status,
            objectives: quest.objectives,
            rewards: quest.rewards,
            prerequisites: quest.prerequisites
        }
    };
}

async function handleList(args: z.infer<typeof ListSchema>): Promise<object> {
    const { questRepo } = ensureDb();
    const quests = questRepo.findAll(args.worldId);

    return {
        success: true,
        actionType: 'list',
        count: quests.length,
        quests: quests.map((q: { id: string; name: string; status?: string; objectives?: unknown[]; worldId: string }) => ({
            id: q.id,
            name: q.name,
            status: q.status || 'available',
            objectiveCount: q.objectives?.length || 0,
            worldId: q.worldId
        }))
    };
}

async function handleAssign(args: z.infer<typeof AssignSchema>): Promise<object> {
    const { questRepo, characterRepo } = ensureDb();

    const character = characterRepo.findById(args.characterId);
    if (!character) {
        return { error: true, message: `Character ${args.characterId} not found` };
    }

    const quest = questRepo.findById(args.questId);
    if (!quest) {
        return { error: true, message: `Quest ${args.questId} not found` };
    }

    let log = questRepo.getLog(args.characterId);
    if (!log) {
        log = {
            characterId: args.characterId,
            activeQuests: [],
            completedQuests: [],
            failedQuests: []
        };
    }

    if (log.activeQuests.includes(args.questId)) {
        return { error: true, message: `Quest already active for this character` };
    }
    if (log.completedQuests.includes(args.questId)) {
        return { error: true, message: `Quest already completed by this character` };
    }

    // Check prerequisites
    for (const prereqId of quest.prerequisites) {
        if (!log.completedQuests.includes(prereqId)) {
            const prereqQuest = questRepo.findById(prereqId);
            const prereqName = prereqQuest?.name || prereqId;
            return { error: true, message: `Prerequisite quest "${prereqName}" not completed` };
        }
    }

    log.activeQuests.push(args.questId);
    questRepo.updateLog(log);

    return {
        success: true,
        actionType: 'assign',
        questId: args.questId,
        questName: quest.name,
        characterId: args.characterId,
        characterName: character.name,
        message: `${character.name} has accepted "${quest.name}"`
    };
}

async function handleUpdateObjective(args: z.infer<typeof UpdateObjectiveSchema>): Promise<object> {
    const { questRepo, characterRepo } = ensureDb();

    const character = characterRepo.findById(args.characterId);
    if (!character) {
        return { error: true, message: `Character ${args.characterId} not found` };
    }

    const log = questRepo.getLog(args.characterId);
    if (!log || !log.activeQuests.includes(args.questId)) {
        return { error: true, message: `Quest is not active for this character` };
    }

    const quest = questRepo.findById(args.questId);
    if (!quest) {
        return { error: true, message: `Quest ${args.questId} not found` };
    }

    const objectiveIndex = quest.objectives.findIndex(o => o.id === args.objectiveId);
    if (objectiveIndex === -1) {
        return { error: true, message: `Objective ${args.objectiveId} not found in quest` };
    }

    const updatedQuest = questRepo.updateObjectiveProgress(
        args.questId,
        args.objectiveId,
        args.progress
    );

    if (!updatedQuest) {
        return { error: true, message: 'Failed to update objective progress' };
    }

    const objective = updatedQuest.objectives[objectiveIndex];
    const allComplete = questRepo.areAllObjectivesComplete(args.questId);

    return {
        success: true,
        actionType: 'update_objective',
        questId: args.questId,
        questName: updatedQuest.name,
        objective: {
            id: objective.id,
            description: objective.description,
            current: objective.current,
            required: objective.required,
            completed: objective.completed
        },
        questComplete: allComplete,
        message: allComplete
            ? `All objectives complete! Ready to turn in.`
            : `Progress: ${objective.current}/${objective.required}`
    };
}

async function handleCompleteObjective(args: z.infer<typeof CompleteObjectiveSchema>): Promise<object> {
    const { questRepo } = ensureDb();

    const quest = questRepo.findById(args.questId);
    if (!quest) {
        return { error: true, message: `Quest ${args.questId} not found` };
    }

    const objectiveIndex = quest.objectives.findIndex(o => o.id === args.objectiveId);
    if (objectiveIndex === -1) {
        return { error: true, message: `Objective ${args.objectiveId} not found` };
    }

    const updatedQuest = questRepo.completeObjective(args.questId, args.objectiveId);
    if (!updatedQuest) {
        return { error: true, message: 'Failed to complete objective' };
    }

    const objective = updatedQuest.objectives[objectiveIndex];
    const allComplete = questRepo.areAllObjectivesComplete(args.questId);

    return {
        success: true,
        actionType: 'complete_objective',
        questId: args.questId,
        questName: updatedQuest.name,
        objective: {
            id: objective.id,
            description: objective.description,
            completed: true
        },
        questComplete: allComplete,
        message: allComplete
            ? `Objective complete! All objectives done - ready to turn in.`
            : `Objective "${objective.description}" completed`
    };
}

async function handleComplete(args: z.infer<typeof CompleteSchema>): Promise<object> {
    const { questRepo, characterRepo, inventoryRepo, itemRepo } = ensureDb();

    const character = characterRepo.findById(args.characterId);
    if (!character) {
        return { error: true, message: `Character ${args.characterId} not found` };
    }

    const quest = questRepo.findById(args.questId);
    if (!quest) {
        return { error: true, message: `Quest ${args.questId} not found` };
    }

    let log = questRepo.getLog(args.characterId);
    if (!log || !log.activeQuests.includes(args.questId)) {
        return { error: true, message: `Quest is not active for this character` };
    }

    // Verify all objectives are completed
    const allCompleted = quest.objectives.every(o => o.completed);
    if (!allCompleted) {
        const incomplete = quest.objectives.filter(o => !o.completed);
        return {
            error: true,
            message: `Not all objectives completed. Remaining: ${incomplete.map(o => o.description).join(', ')}`
        };
    }

    // Grant rewards
    const rewardsGranted: { xp: number; gold: number; items: string[] } = {
        xp: quest.rewards.experience || 0,
        gold: quest.rewards.gold || 0,
        items: []
    };

    // Grant items
    for (const itemId of quest.rewards.items) {
        try {
            inventoryRepo.addItem(args.characterId, itemId, 1);
            const item = itemRepo.findById(itemId);
            rewardsGranted.items.push(item?.name || itemId);
        } catch {
            rewardsGranted.items.push(`${itemId} (not found)`);
        }
    }

    // Update quest log
    log.activeQuests = log.activeQuests.filter(id => id !== args.questId);
    log.completedQuests.push(args.questId);
    questRepo.updateLog(log);

    // Update quest status
    questRepo.update(args.questId, { status: 'completed' });

    return {
        success: true,
        actionType: 'complete',
        questId: args.questId,
        questName: quest.name,
        characterId: args.characterId,
        characterName: character.name,
        rewards: rewardsGranted,
        message: `${character.name} completed "${quest.name}"! Rewards: ${rewardsGranted.xp} XP, ${rewardsGranted.gold} gold`
    };
}

async function handleGetLog(args: z.infer<typeof GetLogSchema>): Promise<object> {
    const { questRepo, characterRepo } = ensureDb();

    const character = characterRepo.findById(args.characterId);
    if (!character) {
        return { error: true, message: `Character ${args.characterId} not found` };
    }

    const fullLog = questRepo.getFullQuestLog(args.characterId);

    const quests = fullLog.quests.map(quest => ({
        id: quest.id,
        name: quest.name,
        description: quest.description,
        status: quest.logStatus,
        giver: quest.giver,
        objectives: quest.objectives.map(obj => ({
            id: obj.id,
            description: obj.description,
            type: obj.type,
            current: obj.current,
            required: obj.required,
            completed: obj.completed
        })),
        rewards: quest.rewards
    }));

    return {
        success: true,
        actionType: 'get_log',
        characterId: args.characterId,
        characterName: character.name,
        summary: fullLog.summary,
        quests
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION ROUTER
// ═══════════════════════════════════════════════════════════════════════════

const definitions: Record<QuestManageAction, ActionDefinition> = {
    create: {
        schema: CreateSchema,
        handler: handleCreate,
        aliases: ['new', 'add'],
        description: 'Create a new quest'
    },
    get: {
        schema: GetSchema,
        handler: handleGet,
        aliases: ['fetch', 'find'],
        description: 'Get quest details by ID'
    },
    list: {
        schema: ListSchema,
        handler: handleList,
        aliases: ['all', 'show'],
        description: 'List all quests'
    },
    assign: {
        schema: AssignSchema,
        handler: handleAssign,
        aliases: ['accept', 'start'],
        description: 'Assign a quest to a character'
    },
    update_objective: {
        schema: UpdateObjectiveSchema,
        handler: handleUpdateObjective,
        aliases: ['progress', 'advance'],
        description: 'Update objective progress'
    },
    complete_objective: {
        schema: CompleteObjectiveSchema,
        handler: handleCompleteObjective,
        aliases: ['finish_objective', 'done_objective'],
        description: 'Mark an objective as complete'
    },
    complete: {
        schema: CompleteSchema,
        handler: handleComplete,
        aliases: ['finish', 'turn_in'],
        description: 'Complete quest and grant rewards'
    },
    get_log: {
        schema: GetLogSchema,
        handler: handleGetLog,
        aliases: ['log', 'journal'],
        description: 'Get character quest log'
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

export const QuestManageTool = {
    name: 'quest_manage',
    description: `Manage RPG quests - creation, assignment, progress, and completion.
Actions: create, get, list, assign, update_objective, complete_objective, complete, get_log
Aliases: new→create, accept→assign, progress→update_objective, finish→complete, log→get_log

📜 QUEST WORKFLOW:
1. create - Define a quest with objectives and rewards
2. assign - Character accepts the quest
3. update_objective - Track progress on objectives
4. complete_objective - Mark objectives done
5. complete - Turn in quest for rewards
6. get_log - View character's quest journal`,
    inputSchema: z.object({
        action: z.string().describe(`Action: ${ACTIONS.join(', ')}`),
        questId: z.string().optional().describe('Quest ID'),
        characterId: z.string().optional().describe('Character ID'),
        objectiveId: z.string().optional().describe('Objective ID'),
        name: z.string().optional().describe('Quest name (for create)'),
        description: z.string().optional().describe('Quest description'),
        worldId: z.string().optional().describe('World ID'),
        giver: z.string().optional().describe('Quest giver name'),
        objectives: z.array(z.any()).optional().describe('Quest objectives'),
        rewards: z.any().optional().describe('Quest rewards'),
        prerequisites: z.array(z.string()).optional(),
        status: z.string().optional(),
        progress: z.number().optional().describe('Progress increment')
    })
};

export async function handleQuestManage(args: unknown, _ctx: SessionContext): Promise<McpResponse> {
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
                output = RichFormatter.header('Quest Created', '📜');
                output += RichFormatter.keyValue({
                    'ID': `\`${parsed.questId}\``,
                    'Name': parsed.name,
                    'Objectives': parsed.objectiveCount
                });
                break;
            case 'get':
                output = RichFormatter.header('Quest Details', '📜');
                if (parsed.quest) {
                    output += RichFormatter.keyValue({
                        'Name': parsed.quest.name,
                        'Status': parsed.quest.status,
                        'Giver': parsed.quest.giver || 'Unknown',
                        'Objectives': parsed.quest.objectives?.length || 0
                    });
                    if (parsed.quest.objectives?.length > 0) {
                        output += '\n**Objectives:**\n';
                        parsed.quest.objectives.forEach((obj: { completed: boolean; description: string; current: number; required: number }) => {
                            const check = obj.completed ? '☑️' : '☐';
                            output += `  ${check} ${obj.description} (${obj.current}/${obj.required})\n`;
                        });
                    }
                }
                break;
            case 'list':
                output = RichFormatter.header(`Quests (${parsed.count})`, '📜');
                if (parsed.quests?.length > 0) {
                    parsed.quests.forEach((q: { name: string; status: string; objectiveCount: number }) => {
                        output += `• **${q.name}** (${q.status}) - ${q.objectiveCount} objectives\n`;
                    });
                } else {
                    output += 'No quests found.\n';
                }
                break;
            case 'assign':
                output = RichFormatter.header('Quest Assigned', '✅');
                output += RichFormatter.keyValue({
                    'Quest': parsed.questName,
                    'Character': parsed.characterName
                });
                output += RichFormatter.success(parsed.message);
                break;
            case 'update_objective':
                output = RichFormatter.header('Objective Progress', '📊');
                output += RichFormatter.keyValue({
                    'Quest': parsed.questName,
                    'Objective': parsed.objective?.description,
                    'Progress': `${parsed.objective?.current}/${parsed.objective?.required}`,
                    'Complete': parsed.objective?.completed ? '✅' : '❌'
                });
                if (parsed.questComplete) {
                    output += RichFormatter.success('🎉 All objectives complete!');
                }
                break;
            case 'complete_objective':
                output = RichFormatter.header('Objective Completed', '☑️');
                output += RichFormatter.keyValue({
                    'Quest': parsed.questName,
                    'Objective': parsed.objective?.description
                });
                if (parsed.questComplete) {
                    output += RichFormatter.success('🎉 All objectives complete! Ready to turn in.');
                }
                break;
            case 'complete':
                output = RichFormatter.header('Quest Completed!', '🎉');
                output += RichFormatter.keyValue({
                    'Quest': parsed.questName,
                    'Character': parsed.characterName
                });
                output += '\n**Rewards:**\n';
                output += RichFormatter.keyValue({
                    'XP': parsed.rewards?.xp || 0,
                    'Gold': parsed.rewards?.gold || 0
                });
                if (parsed.rewards?.items?.length > 0) {
                    output += '**Items:** ' + parsed.rewards.items.join(', ') + '\n';
                }
                break;
            case 'get_log':
                output = RichFormatter.header(`${parsed.characterName}'s Quest Log`, '📖');
                output += RichFormatter.keyValue({
                    'Active': parsed.summary?.active || 0,
                    'Completed': parsed.summary?.completed || 0,
                    'Failed': parsed.summary?.failed || 0
                });
                if (parsed.quests?.length > 0) {
                    output += '\n';
                    parsed.quests.forEach((q: { name: string; status: string }) => {
                        const icon = q.status === 'completed' ? '✅' : q.status === 'failed' ? '❌' : '📜';
                        output += `${icon} **${q.name}** (${q.status})\n`;
                    });
                }
                break;
            default:
                output = RichFormatter.header('Quest', '📜');
                if (parsed.message) output += parsed.message + '\n';
        }
    }

    output += RichFormatter.embedJson(parsed, 'QUEST_MANAGE');

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}
