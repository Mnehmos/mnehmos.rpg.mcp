import { handleCreateItemTemplate, handleGiveItem, handleRemoveItem, handleEquipItem, handleUnequipItem, handleGetInventory } from '../../src/server/inventory-tools';
import { handleCreateCharacter } from '../../src/server/crud-tools';
import { closeTestDb } from '../../src/server/crud-tools';


// Helper to extract embedded JSON from formatted responses
function extractEmbeddedJson(responseText: string, tag: string = "DATA"): any {
    const regex = new RegExp(`<!--\\s*${tag}_JSON\\s*\n([\\s\\S]*?)\n${tag}_JSON\\s*-->`);
    const match = responseText.match(regex);
    if (match) {
        return JSON.parse(match[1]);
    }
    throw new Error(`Could not extract ${tag}_JSON from response`);
}
describe('Inventory System', () => {
    const mockCtx = { sessionId: 'test-session' };

    afterEach(() => {
        closeTestDb();
    });

    beforeEach(async () => {
        closeTestDb();
        // Force DB init
        const { getDb } = await import('../../src/storage');
        const db = getDb(':memory:');
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        console.log('Tables in test:', tables.map((t: any) => t.name));
    });

    // Helper to create a test character
    async function createTestCharacter(): Promise<string> {
        const charResult = await handleCreateCharacter({
            name: 'Inventory Tester',
            hp: 10,
            maxHp: 10,
            ac: 10,
            level: 1,
            stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }
        }, mockCtx);
        return extractEmbeddedJson(charResult.content[0].text, "CHARACTER").id;
    }

    // Helper to create a test item
    async function createTestItem(name: string, type: string, props?: object): Promise<string> {
        const result = await handleCreateItemTemplate({
            name,
            type,
            weight: 5,
            value: 10,
            properties: props
        }, mockCtx);
        return extractEmbeddedJson(result.content[0].text, "ITEM").id;
    }

    it('should create item templates', async () => {
        const result = await handleCreateItemTemplate({
            name: 'Iron Sword',
            type: 'weapon',
            weight: 5,
            value: 10,
            properties: { damage: '1d8' }
        }, mockCtx);

        const item = extractEmbeddedJson(result.content[0].text, "ITEM");
        expect(item.name).toBe('Iron Sword');
        expect(item.id).toBeDefined();

        // Create a shield too
        const shieldResult = await handleCreateItemTemplate({
            name: 'Wooden Shield',
            type: 'armor',
            weight: 3,
            value: 5
        }, mockCtx);
        const shield = extractEmbeddedJson(shieldResult.content[0].text, "ITEM");
        expect(shield.name).toBe('Wooden Shield');
        expect(shield.id).toBeDefined();
    });

    it('should give items to character', async () => {
        // Create character and item fresh for this test
        const characterId = await createTestCharacter();
        const swordId = await createTestItem('Iron Sword', 'weapon', { damage: '1d8' });

        // Give sword
        await handleGiveItem({
            characterId,
            itemId: swordId,
            quantity: 1
        }, mockCtx);

        // Verify inventory
        const invResult = await handleGetInventory({ characterId }, mockCtx);
        const inventory = extractEmbeddedJson(invResult.content[0].text, "INVENTORY");

        expect(inventory.items).toHaveLength(1);
        expect(inventory.items[0].itemId).toBe(swordId);
        expect(inventory.items[0].quantity).toBe(1);
    });

    it('should equip and unequip items', async () => {
        // Create character and item fresh for this test
        const characterId = await createTestCharacter();
        const swordId = await createTestItem('Iron Sword', 'weapon', { damage: '1d8' });

        // Give sword first
        await handleGiveItem({
            characterId,
            itemId: swordId,
            quantity: 1
        }, mockCtx);

        // Equip sword
        await handleEquipItem({
            characterId,
            itemId: swordId,
            slot: 'mainhand'
        }, mockCtx);

        let invResult = await handleGetInventory({ characterId }, mockCtx);
        let inventory = extractEmbeddedJson(invResult.content[0].text, "INVENTORY");
        expect(inventory.items[0].equipped).toBe(true);
        expect(inventory.items[0].slot).toBe('mainhand');

        // Unequip sword
        await handleUnequipItem({
            characterId,
            itemId: swordId
        }, mockCtx);

        invResult = await handleGetInventory({ characterId }, mockCtx);
        inventory = extractEmbeddedJson(invResult.content[0].text, "INVENTORY");
        expect(inventory.items[0].equipped).toBe(false);
        expect(inventory.items[0].slot).toBeUndefined();
    });

    it('should remove items', async () => {
        // Create character and item fresh for this test
        const characterId = await createTestCharacter();
        const swordId = await createTestItem('Iron Sword', 'weapon', { damage: '1d8' });

        // Give sword first
        await handleGiveItem({
            characterId,
            itemId: swordId,
            quantity: 1
        }, mockCtx);

        // Now remove it
        await handleRemoveItem({
            characterId,
            itemId: swordId,
            quantity: 1
        }, mockCtx);

        const invResult = await handleGetInventory({ characterId }, mockCtx);
        const inventory = extractEmbeddedJson(invResult.content[0].text, "INVENTORY");
        expect(inventory.items).toHaveLength(0);
    });

    it('should handle stacking items', async () => {
        // Create character fresh for this test
        const characterId = await createTestCharacter();

        // Create potions
        const potionResult = await handleCreateItemTemplate({
            name: 'Health Potion',
            type: 'consumable',
            weight: 0.5,
            value: 5
        }, mockCtx);
        const potionId = extractEmbeddedJson(potionResult.content[0].text, "ITEM").id;

        // Give 5 potions
        await handleGiveItem({ characterId, itemId: potionId, quantity: 5 }, mockCtx);

        // Give 3 more
        await handleGiveItem({ characterId, itemId: potionId, quantity: 3 }, mockCtx);

        const invResult = await handleGetInventory({ characterId }, mockCtx);
        const inventory = extractEmbeddedJson(invResult.content[0].text, "INVENTORY");

        expect(inventory.items[0].quantity).toBe(8);
    });

    // EDGE-004: Empty item names validation
    it('EDGE-004: should reject empty item names', async () => {
        await expect(handleCreateItemTemplate({
            name: '',  // Empty name - should be rejected
            type: 'misc',
            weight: 1,
            value: 10
        }, mockCtx)).rejects.toThrow();
    });

    it('EDGE-004: should reject whitespace-only item names', async () => {
        await expect(handleCreateItemTemplate({
            name: '   ',  // Whitespace only - should be rejected
            type: 'misc',
            weight: 1,
            value: 10
        }, mockCtx)).rejects.toThrow();
    });
});
