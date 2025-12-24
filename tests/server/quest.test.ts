import { handleCreateQuest, handleAssignQuest, handleUpdateObjective, handleCompleteQuest, handleGetQuestLog } from '../../src/server/quest-tools';
import { handleCreateWorld } from '../../src/server/crud-tools';
import { handleCreateCharacter } from '../../src/server/crud-tools';
import { handleCreateItemTemplate, handleGetInventory } from '../../src/server/inventory-tools';
import { closeDb, getDb } from '../../src/storage';
import { Quest } from '../../src/schema/quest';


// Helper to extract embedded JSON from formatted responses
function extractEmbeddedJson(responseText: string, tag: string = "DATA"): any {
    const regex = new RegExp(`<!--\\s*${tag}_JSON\\s*\n([\\s\\S]*?)\n${tag}_JSON\\s*-->`);
    const match = responseText.match(regex);
    if (match) {
        return JSON.parse(match[1]);
    }
    throw new Error(`Could not extract ${tag}_JSON from response`);
}
describe('Quest System', () => {
    let worldId: string;
    let characterId: string;
    let itemId: string;

    beforeEach(async () => {
        // Reset DB
        closeDb();
        getDb(':memory:');

        // Create World
        const worldResult = await handleCreateWorld({
            name: 'Test World',
            seed: 'test-seed',
            width: 10,
            height: 10
        }, { sessionId: 'test' });
        const worldData = extractEmbeddedJson(worldResult.content[0].text, "WORLD");
        worldId = worldData.id;

        // Create Character
        const charResult = await handleCreateCharacter({
            name: 'Hero',
            stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
            hp: 10,
            maxHp: 10,
            ac: 10,
            level: 1
        }, { sessionId: 'test' });
        const charData = extractEmbeddedJson(charResult.content[0].text, "CHARACTER");
        characterId = charData.id;

        // Create Item Template (for reward)
        const itemResult = await handleCreateItemTemplate({
            name: 'Reward Sword',
            type: 'weapon',
            weight: 1,
            value: 10
        }, { sessionId: 'test' });
        const itemData = extractEmbeddedJson(itemResult.content[0].text, "ITEM");
        itemId = itemData.id;
    });

    afterEach(() => {
        closeDb();
    });

    it('should create, assign, update, and complete a quest', async () => {
        // 1. Create Quest
        const questResult = await handleCreateQuest({
            worldId,
            name: 'Kill Rats',
            description: 'Kill 5 rats in the basement.',
            status: 'available',
            objectives: [{
                id: 'obj-1',
                description: 'Kill rats',
                type: 'kill',
                target: 'rat',
                required: 5,
                current: 0
            }],
            rewards: {
                experience: 100,
                gold: 50,
                items: [itemId]
            }
        }, { sessionId: 'test' });
        const quest = extractEmbeddedJson(questResult.content[0].text, "QUEST") as Quest;
        expect(quest.name).toBe('Kill Rats');

        // 2. Assign Quest
        await handleAssignQuest({
            characterId,
            questId: quest.id
        }, { sessionId: 'test' });

        // Verify Log - now returns full quest objects in 'quests' array
        let logResult = await handleGetQuestLog({ characterId }, { sessionId: 'test' });
        let log = extractEmbeddedJson(logResult.content[0].text, "QUESTLOG");
        // Check if quest is in the quests array (full objects now)
        expect(log.quests.some((q: any) => q.id === quest.id)).toBe(true);

        // 3. Update Objective
        await handleUpdateObjective({
            characterId,
            questId: quest.id,
            objectiveId: 'obj-1',
            progress: 3
        }, { sessionId: 'test' });

        // Update again to complete
        await handleUpdateObjective({
            characterId,
            questId: quest.id,
            objectiveId: 'obj-1',
            progress: 2
        }, { sessionId: 'test' });

        // 4. Complete Quest
        await handleCompleteQuest({
            characterId,
            questId: quest.id
        }, { sessionId: 'test' });

        // Verify Log - quest should now have 'completed' status
        logResult = await handleGetQuestLog({ characterId }, { sessionId: 'test' });
        log = extractEmbeddedJson(logResult.content[0].text, "QUESTLOG");
        // Check quest is no longer active (status should be 'completed')
        const completedQuest = log.quests.find((q: any) => q.id === quest.id);
        expect(completedQuest).toBeDefined();
        expect(completedQuest.status).toBe('completed');

        // Verify Reward (Item)
        const invResult = await handleGetInventory({ characterId }, { sessionId: 'test' });
        const inv = extractEmbeddedJson(invResult.content[0].text, "INVENTORY");
        expect(inv.items).toHaveLength(1);
        expect(inv.items[0].itemId).toBe(itemId);
    });
});
