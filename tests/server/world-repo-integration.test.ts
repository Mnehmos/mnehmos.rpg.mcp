import { handleGenerateWorld, clearWorld } from '../../src/server/tools';
import { handleListWorlds, handleDeleteWorld, closeTestDb } from '../../src/server/crud-tools';


// Helper to extract embedded JSON from formatted responses
function extractEmbeddedJson(responseText: string, tag: string = "DATA"): any {
    const regex = new RegExp(`<!--\\s*${tag}_JSON\\s*\n([\\s\\S]*?)\n${tag}_JSON\\s*-->`);
    const match = responseText.match(regex);
    if (match) {
        return JSON.parse(match[1]);
    }
    throw new Error(`Could not extract ${tag}_JSON from response`);
}
describe('World Repository Integration', () => {
    afterEach(() => {
        closeTestDb();
    });

    it('should persist generated world and allow list/delete', async () => {
        clearWorld();

        // Generate a world
        const genResult = await handleGenerateWorld({
            seed: 'integration-test',
            width: 30,
            height: 30
        }, { sessionId: 'test-session' });

        // The generate_world tool returns a simple message with worldId, not embedded JSON
        const responseText = genResult.content[0].text;
        expect(responseText).toContain('worldId');
        expect(responseText).toContain('World generated successfully');
        const worldIdMatch = responseText.match(/"worldId":\s*"([^"]+)"/);
        expect(worldIdMatch).toBeTruthy();
        const worldId = worldIdMatch![1];

        // Verify it appears in list_worlds
        const listResult = await handleListWorlds({}, { sessionId: 'test-session' });
        const listData = extractEmbeddedJson(listResult.content[0].text, "WORLDS");

        const foundWorld = listData.worlds.find((w: any) => w.id === worldId);
        expect(foundWorld).toBeDefined();
        expect(foundWorld.seed).toBe('integration-test');
        expect(foundWorld.width).toBe(30);
        expect(foundWorld.height).toBe(30);

        // Verify we can delete it
        const deleteResult = await handleDeleteWorld({ id: worldId }, { sessionId: 'test-session' });
        // Delete returns a success message, not embedded JSON
        expect(deleteResult.content[0].text).toContain('deleted');

        // Verify it's gone from list
        const listAfterDelete = await handleListWorlds({}, { sessionId: 'test-session' });
        const listAfterData = extractEmbeddedJson(listAfterDelete.content[0].text, "WORLDS");
        expect(listAfterData.worlds.find((w: any) => w.id === worldId)).toBeUndefined();
    });
});
