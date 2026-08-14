import { handleGenerateWorld, clearWorld } from '../../src/server/tools';
import { useInMemoryDatabase } from '../helpers/test-db.js';

describe('Server Tools', () => {
    useInMemoryDatabase();

    it('should generate a world', async () => {
        clearWorld();
        const result = await handleGenerateWorld({
            seed: 'test-seed',
            width: 20,
            height: 20
        }, { sessionId: 'test-session' });

        expect(result.content).toBeDefined();
        expect(result.content[0].type).toBe('text');
        const content = JSON.parse(result.content[0].text);
        expect(content.message).toBe('World generated successfully');
        console.log('Tool test passed!');
    });
});
