import Database from 'better-sqlite3';
import { Quest, QuestSchema, QuestLog, QuestLogSchema } from '../../schema/quest.js';

// Extended types for full quest log
export interface QuestWithStatus extends Quest {
    logStatus: 'active' | 'completed' | 'failed';
}

export interface FullQuestLog {
    characterId: string;
    quests: QuestWithStatus[];
    summary: {
        active: number;
        completed: number;
        failed: number;
    };
}

export class QuestRepository {
    constructor(private db: Database.Database) { }

    create(quest: Quest): void {
        const validQuest = QuestSchema.parse(quest);

        const stmt = this.db.prepare(`
            INSERT INTO quests (id, world_id, name, description, status, objectives, rewards, prerequisites, giver, created_at, updated_at)
            VALUES (@id, @worldId, @name, @description, @status, @objectives, @rewards, @prerequisites, @giver, @createdAt, @updatedAt)
        `);

        stmt.run({
            id: validQuest.id,
            worldId: validQuest.worldId,
            name: validQuest.name,
            description: validQuest.description,
            status: validQuest.status,
            objectives: JSON.stringify(validQuest.objectives),
            rewards: JSON.stringify(validQuest.rewards),
            prerequisites: JSON.stringify(validQuest.prerequisites),
            giver: validQuest.giver || null,
            createdAt: validQuest.createdAt,
            updatedAt: validQuest.updatedAt
        });
    }

    findById(id: string): Quest | null {
        const stmt = this.db.prepare('SELECT * FROM quests WHERE id = ?');
        const row = stmt.get(id) as QuestRow | undefined;

        if (!row) return null;
        return this.rowToQuest(row);
    }

    update(id: string, updates: Partial<Quest>): Quest | null {
        const existing = this.findById(id);
        if (!existing) return null;

        const updated = {
            ...existing,
            ...updates,
            updatedAt: new Date().toISOString()
        };

        const validQuest = QuestSchema.parse(updated);

        const stmt = this.db.prepare(`
            UPDATE quests
            SET name = ?, description = ?, status = ?, objectives = ?, rewards = ?, prerequisites = ?, giver = ?, updated_at = ?
            WHERE id = ?
        `);

        stmt.run(
            validQuest.name,
            validQuest.description,
            validQuest.status,
            JSON.stringify(validQuest.objectives),
            JSON.stringify(validQuest.rewards),
            JSON.stringify(validQuest.prerequisites),
            validQuest.giver || null,
            validQuest.updatedAt,
            id
        );

        return validQuest;
    }

    getLog(characterId: string): QuestLog | null {
        const stmt = this.db.prepare('SELECT * FROM quest_logs WHERE character_id = ?');
        const row = stmt.get(characterId) as QuestLogRow | undefined;

        if (!row) return null;
        return this.rowToQuestLog(row);
    }

    /**
     * Get full quest log with complete quest objects (not just IDs)
     * Returns quests organized by status with full details
     */
    getFullQuestLog(characterId: string): FullQuestLog {
        const log = this.getLog(characterId);
        
        if (!log) {
            return {
                characterId,
                quests: [],
                summary: { active: 0, completed: 0, failed: 0 }
            };
        }

        const quests: QuestWithStatus[] = [];

        // Fetch active quests with full data
        for (const questId of log.activeQuests) {
            const quest = this.findById(questId);
            if (quest) {
                quests.push({
                    ...quest,
                    logStatus: 'active'
                });
            }
        }

        // Fetch completed quests with full data
        for (const questId of log.completedQuests) {
            const quest = this.findById(questId);
            if (quest) {
                quests.push({
                    ...quest,
                    logStatus: 'completed'
                });
            }
        }

        // Fetch failed quests with full data
        for (const questId of log.failedQuests) {
            const quest = this.findById(questId);
            if (quest) {
                quests.push({
                    ...quest,
                    logStatus: 'failed'
                });
            }
        }

        return {
            characterId,
            quests,
            summary: {
                active: log.activeQuests.length,
                completed: log.completedQuests.length,
                failed: log.failedQuests.length
            }
        };
    }

    /**
     * Find all quests, optionally filtered by world
     */
    findAll(worldId?: string): Quest[] {
        let stmt;
        if (worldId) {
            stmt = this.db.prepare('SELECT * FROM quests WHERE world_id = ?');
            const rows = stmt.all(worldId) as QuestRow[];
            return rows.map(row => this.rowToQuest(row));
        } else {
            stmt = this.db.prepare('SELECT * FROM quests');
            const rows = stmt.all() as QuestRow[];
            return rows.map(row => this.rowToQuest(row));
        }
    }

    /**
     * Update a specific objective's progress
     */
    updateObjectiveProgress(questId: string, objectiveId: string, progress: number): Quest | null {
        const quest = this.findById(questId);
        if (!quest) return null;

        const objectiveIndex = quest.objectives.findIndex(o => o.id === objectiveId);
        if (objectiveIndex === -1) return null;

        const objective = quest.objectives[objectiveIndex];
        objective.current = Math.min(objective.required, objective.current + progress);
        if (objective.current >= objective.required) {
            objective.completed = true;
        }

        quest.objectives[objectiveIndex] = objective;
        return this.update(quest.id, { objectives: quest.objectives });
    }

    /**
     * Check if all objectives for a quest are completed
     */
    areAllObjectivesComplete(questId: string): boolean {
        const quest = this.findById(questId);
        if (!quest) return false;
        return quest.objectives.every(o => o.completed);
    }

    /**
     * Complete a specific objective (set current = required)
     */
    completeObjective(questId: string, objectiveId: string): Quest | null {
        const quest = this.findById(questId);
        if (!quest) return null;

        const objectiveIndex = quest.objectives.findIndex(o => o.id === objectiveId);
        if (objectiveIndex === -1) return null;

        const objective = quest.objectives[objectiveIndex];
        objective.current = objective.required;
        objective.completed = true;

        quest.objectives[objectiveIndex] = objective;
        return this.update(quest.id, { objectives: quest.objectives });
    }

    updateLog(log: QuestLog): void {
        const validLog = QuestLogSchema.parse(log);

        const stmt = this.db.prepare(`
            INSERT INTO quest_logs (character_id, active_quests, completed_quests, failed_quests)
            VALUES (@characterId, @activeQuests, @completedQuests, @failedQuests)
            ON CONFLICT(character_id) DO UPDATE SET
                active_quests = excluded.active_quests,
                completed_quests = excluded.completed_quests,
                failed_quests = excluded.failed_quests
        `);

        stmt.run({
            characterId: validLog.characterId,
            activeQuests: JSON.stringify(validLog.activeQuests),
            completedQuests: JSON.stringify(validLog.completedQuests),
            failedQuests: JSON.stringify(validLog.failedQuests)
        });
    }

    private rowToQuest(row: QuestRow): Quest {
        return QuestSchema.parse({
            id: row.id,
            worldId: row.world_id,
            name: row.name,
            description: row.description,
            status: row.status,
            objectives: JSON.parse(row.objectives),
            rewards: JSON.parse(row.rewards),
            prerequisites: JSON.parse(row.prerequisites),
            giver: row.giver || undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        });
    }

    private rowToQuestLog(row: QuestLogRow): QuestLog {
        return QuestLogSchema.parse({
            characterId: row.character_id,
            activeQuests: JSON.parse(row.active_quests),
            completedQuests: JSON.parse(row.completed_quests),
            failedQuests: JSON.parse(row.failed_quests)
        });
    }
}

interface QuestRow {
    id: string;
    world_id: string;
    name: string;
    description: string;
    status: string;
    objectives: string;
    rewards: string;
    prerequisites: string;
    giver: string | null;
    created_at: string;
    updated_at: string;
}

interface QuestLogRow {
    character_id: string;
    active_quests: string;
    completed_quests: string;
    failed_quests: string;
}
