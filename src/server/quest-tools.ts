import { z } from 'zod';
import { randomUUID } from 'crypto';
import { QuestRepository } from '../storage/repos/quest.repo.js';
import { CharacterRepository } from '../storage/repos/character.repo.js';
import { InventoryRepository } from '../storage/repos/inventory.repo.js';
import { ItemRepository } from '../storage/repos/item.repo.js';
import { QuestSchema } from '../schema/quest.js';
import { getDb } from '../storage/index.js';
import { SessionContext } from './types.js';

function ensureDb() {
    const dbPath = process.env.NODE_ENV === 'test' 
        ? ':memory:' 
        : process.env.RPG_DATA_DIR 
            ? `${process.env.RPG_DATA_DIR}/rpg.db`
            : 'rpg.db';
    const db = getDb(dbPath);
    const questRepo = new QuestRepository(db);
    const characterRepo = new CharacterRepository(db);
    const inventoryRepo = new InventoryRepository(db);
    const itemRepo = new ItemRepository(db);
    return { questRepo, characterRepo, inventoryRepo, itemRepo };
}

export const QuestTools = {
    CREATE_QUEST: {
        name: 'create_quest',
        description: 'Define a new quest in the world.',
        inputSchema: QuestSchema.omit({ id: true, createdAt: true, updatedAt: true })
    },
    GET_QUEST: {
        name: 'get_quest',
        description: 'Get a single quest by ID with full details.',
        inputSchema: z.object({
            questId: z.string()
        })
    },
    LIST_QUESTS: {
        name: 'list_quests',
        description: 'List all quests, optionally filtered by world.',
        inputSchema: z.object({
            worldId: z.string().optional()
        })
    },
    ASSIGN_QUEST: {
        name: 'assign_quest',
        description: 'Assign a quest to a character.',
        inputSchema: z.object({
            characterId: z.string(),
            questId: z.string()
        })
    },
    UPDATE_OBJECTIVE: {
        name: 'update_objective',
        description: 'Update progress on a quest objective.',
        inputSchema: z.object({
            characterId: z.string(),
            questId: z.string(),
            objectiveId: z.string(),
            progress: z.number().int().min(1).default(1)
        })
    },
    COMPLETE_OBJECTIVE: {
        name: 'complete_objective',
        description: 'Mark an objective as fully completed.',
        inputSchema: z.object({
            questId: z.string(),
            objectiveId: z.string()
        })
    },
    COMPLETE_QUEST: {
        name: 'complete_quest',
        description: 'Mark a quest as completed and grant rewards.',
        inputSchema: z.object({
            characterId: z.string(),
            questId: z.string()
        })
    },
    GET_QUEST_LOG: {
        name: 'get_quest_log',
        description: 'Get the quest log for a character.',
        inputSchema: z.object({
            characterId: z.string()
        })
    }
} as const;

export async function handleCreateQuest(args: unknown, _ctx: SessionContext) {
    const { questRepo } = ensureDb();
    const parsed = QuestTools.CREATE_QUEST.inputSchema.parse(args);

    const now = new Date().toISOString();
    
    // Ensure all objectives have IDs
    const objectives = parsed.objectives.map(obj => ({
        ...obj,
        id: obj.id || randomUUID(),
        current: obj.current ?? 0,
        completed: obj.completed ?? false
    }));

    const quest = {
        ...parsed,
        objectives,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now
    };

    questRepo.create(quest);

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify(quest, null, 2)
        }]
    };
}

export async function handleGetQuest(args: unknown, _ctx: SessionContext) {
    const { questRepo } = ensureDb();
    const parsed = QuestTools.GET_QUEST.inputSchema.parse(args);

    const quest = questRepo.findById(parsed.questId);
    if (!quest) {
        throw new Error(`Quest ${parsed.questId} not found`);
    }

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify(quest, null, 2)
        }]
    };
}

export async function handleListQuests(args: unknown, _ctx: SessionContext) {
    const { questRepo } = ensureDb();
    const parsed = QuestTools.LIST_QUESTS.inputSchema.parse(args);

    const quests = questRepo.findAll(parsed.worldId);

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({ quests, count: quests.length }, null, 2)
        }]
    };
}

export async function handleAssignQuest(args: unknown, _ctx: SessionContext) {
    const { questRepo, characterRepo } = ensureDb();
    const parsed = QuestTools.ASSIGN_QUEST.inputSchema.parse(args);

    const character = characterRepo.findById(parsed.characterId);
    if (!character) throw new Error(`Character ${parsed.characterId} not found`);

    const quest = questRepo.findById(parsed.questId);
    if (!quest) throw new Error(`Quest ${parsed.questId} not found`);

    let log = questRepo.getLog(parsed.characterId);
    if (!log) {
        log = {
            characterId: parsed.characterId,
            activeQuests: [],
            completedQuests: [],
            failedQuests: []
        };
    }

    if (log.activeQuests.includes(parsed.questId)) {
        throw new Error(`Quest ${parsed.questId} is already active for character ${parsed.characterId}`);
    }
    if (log.completedQuests.includes(parsed.questId)) {
        throw new Error(`Quest ${parsed.questId} is already completed by character ${parsed.characterId}`);
    }

    // Check prerequisites
    for (const prereqId of quest.prerequisites) {
        if (!log.completedQuests.includes(prereqId)) {
            const prereqQuest = questRepo.findById(prereqId);
            const prereqName = prereqQuest?.name || prereqId;
            throw new Error(`Prerequisite quest "${prereqName}" not completed`);
        }
    }

    log.activeQuests.push(parsed.questId);
    questRepo.updateLog(log);

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                message: `Assigned quest "${quest.name}" to ${character.name}`,
                quest: quest
            }, null, 2)
        }]
    };
}

export async function handleUpdateObjective(args: unknown, _ctx: SessionContext) {
    const { questRepo, characterRepo } = ensureDb();
    const parsed = QuestTools.UPDATE_OBJECTIVE.inputSchema.parse(args);

    // Verify character exists and has this quest
    const character = characterRepo.findById(parsed.characterId);
    if (!character) throw new Error(`Character ${parsed.characterId} not found`);

    const log = questRepo.getLog(parsed.characterId);
    if (!log || !log.activeQuests.includes(parsed.questId)) {
        throw new Error(`Quest ${parsed.questId} is not active for character ${parsed.characterId}`);
    }

    const quest = questRepo.findById(parsed.questId);
    if (!quest) throw new Error(`Quest ${parsed.questId} not found`);

    const objectiveIndex = quest.objectives.findIndex(o => o.id === parsed.objectiveId);
    if (objectiveIndex === -1) throw new Error(`Objective ${parsed.objectiveId} not found in quest`);

    // Update progress
    const updatedQuest = questRepo.updateObjectiveProgress(
        parsed.questId, 
        parsed.objectiveId, 
        parsed.progress
    );

    if (!updatedQuest) {
        throw new Error('Failed to update objective progress');
    }

    const objective = updatedQuest.objectives[objectiveIndex];
    
    // Check if all objectives are now complete
    const allComplete = questRepo.areAllObjectivesComplete(parsed.questId);

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                message: `Updated objective: ${objective.description}`,
                objective: {
                    id: objective.id,
                    description: objective.description,
                    progress: `${objective.current}/${objective.required}`,
                    completed: objective.completed
                },
                questComplete: allComplete,
                quest: updatedQuest
            }, null, 2)
        }]
    };
}

export async function handleCompleteObjective(args: unknown, _ctx: SessionContext) {
    const { questRepo } = ensureDb();
    const parsed = QuestTools.COMPLETE_OBJECTIVE.inputSchema.parse(args);

    const quest = questRepo.findById(parsed.questId);
    if (!quest) throw new Error(`Quest ${parsed.questId} not found`);

    const objectiveIndex = quest.objectives.findIndex(o => o.id === parsed.objectiveId);
    if (objectiveIndex === -1) throw new Error(`Objective ${parsed.objectiveId} not found`);

    const updatedQuest = questRepo.completeObjective(parsed.questId, parsed.objectiveId);
    if (!updatedQuest) {
        throw new Error('Failed to complete objective');
    }

    const objective = updatedQuest.objectives[objectiveIndex];
    const allComplete = questRepo.areAllObjectivesComplete(parsed.questId);

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                message: `Completed objective: ${objective.description}`,
                objective: {
                    id: objective.id,
                    description: objective.description,
                    completed: true
                },
                questComplete: allComplete,
                quest: updatedQuest
            }, null, 2)
        }]
    };
}

export async function handleCompleteQuest(args: unknown, _ctx: SessionContext) {
    const { questRepo, characterRepo, inventoryRepo, itemRepo } = ensureDb();
    const parsed = QuestTools.COMPLETE_QUEST.inputSchema.parse(args);

    const character = characterRepo.findById(parsed.characterId);
    if (!character) throw new Error(`Character ${parsed.characterId} not found`);

    const quest = questRepo.findById(parsed.questId);
    if (!quest) throw new Error(`Quest ${parsed.questId} not found`);

    let log = questRepo.getLog(parsed.characterId);
    if (!log || !log.activeQuests.includes(parsed.questId)) {
        throw new Error(`Quest "${quest.name}" is not active for character ${character.name}`);
    }

    // Verify all objectives are completed
    const allCompleted = quest.objectives.every(o => o.completed);
    if (!allCompleted) {
        const incomplete = quest.objectives.filter(o => !o.completed);
        throw new Error(`Not all objectives completed. Remaining: ${incomplete.map(o => o.description).join(', ')}`);
    }

    // Grant rewards
    const rewardsGranted: { xp?: number; gold?: number; items: string[] } = {
        items: []
    };

    // Grant XP (update character - need to check if character schema supports xp)
    if (quest.rewards.experience > 0) {
        rewardsGranted.xp = quest.rewards.experience;
        // Note: Character XP tracking would need to be added to character schema
        // For now, we just report it
    }

    // Grant gold
    if (quest.rewards.gold > 0) {
        rewardsGranted.gold = quest.rewards.gold;
        // Note: Gold tracking would need to be added to character or inventory system
        // For now, we just report it
    }

    // Grant items
    for (const itemId of quest.rewards.items) {
        try {
            inventoryRepo.addItem(parsed.characterId, itemId, 1);
            const item = itemRepo.findById(itemId);
            rewardsGranted.items.push(item?.name || itemId);
        } catch (err) {
            // Item may not exist, still complete the quest
            rewardsGranted.items.push(`${itemId} (item not found)`);
        }
    }

    // Update quest log
    log.activeQuests = log.activeQuests.filter(id => id !== parsed.questId);
    log.completedQuests.push(parsed.questId);
    questRepo.updateLog(log);

    // Update quest status
    questRepo.update(parsed.questId, { status: 'completed' });

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                message: `Completed quest: "${quest.name}"!`,
                character: character.name,
                rewards: {
                    xp: rewardsGranted.xp || 0,
                    gold: rewardsGranted.gold || 0,
                    items: rewardsGranted.items
                },
                quest: {
                    id: quest.id,
                    name: quest.name,
                    status: 'completed'
                }
            }, null, 2)
        }]
    };
}

export async function handleGetQuestLog(args: unknown, _ctx: SessionContext) {
    const { questRepo, characterRepo } = ensureDb();
    const parsed = QuestTools.GET_QUEST_LOG.inputSchema.parse(args);

    // Verify character exists
    const character = characterRepo.findById(parsed.characterId);
    if (!character) {
        throw new Error(`Character ${parsed.characterId} not found`);
    }

    // Get full quest log with complete quest data
    const fullLog = questRepo.getFullQuestLog(parsed.characterId);

    // Transform to frontend-friendly format
    const quests = fullLog.quests.map(quest => ({
        id: quest.id,
        title: quest.name,
        name: quest.name,
        description: quest.description,
        status: quest.logStatus,
        questGiver: quest.giver,
        objectives: quest.objectives.map(obj => ({
            id: obj.id,
            description: obj.description,
            type: obj.type,
            target: obj.target,
            current: obj.current,
            required: obj.required,
            completed: obj.completed,
            progress: `${obj.current}/${obj.required}`
        })),
        rewards: {
            experience: quest.rewards.experience,
            gold: quest.rewards.gold,
            items: quest.rewards.items
        },
        prerequisites: quest.prerequisites
    }));

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                characterId: parsed.characterId,
                characterName: character.name,
                quests,
                summary: fullLog.summary
            }, null, 2)
        }]
    };
}
