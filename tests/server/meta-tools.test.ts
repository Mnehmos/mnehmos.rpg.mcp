import { handleLoadToolSchema } from '../../src/server/meta-tools';
import { buildConsolidatedRegistry } from '../../src/server/consolidated-registry';

describe('meta-tools schema surfaces', () => {
    it('should expose action-specific schemas for consolidated tools', async () => {
        const result = await handleLoadToolSchema({ toolName: 'character_manage' });

        expect('error' in result).toBe(false);
        if ('error' in result) throw new Error(result.error);

        expect(result.inputSchema.action.type).toBe('string');
        expect(result.actionSchemas?.create.required).toEqual(
            expect.arrayContaining(['action', 'name'])
        );
        expect(result.actionSchemas?.create.required).not.toContain('hp');
        expect(result.actionSchemas?.level_up.required).toEqual(
            expect.arrayContaining(['action', 'characterId'])
        );
        expect(result.actionSchemas?.level_up.required).not.toContain('hpIncrease');
    });

    it('should include aliases and descriptions in action schemas', async () => {
        const result = await handleLoadToolSchema({ toolName: 'rest_manage' });

        expect('error' in result).toBe(false);
        if ('error' in result) throw new Error(result.error);

        expect(result.actionSchemas?.long.aliases).toEqual(
            expect.arrayContaining(['long_rest', 'full'])
        );
        expect(result.actionSchemas?.short.description).toContain('short rest');
    });

    it('should publish action-specific schema documentation for every consolidated tool', () => {
        const registry = buildConsolidatedRegistry();
        const missing = Object.entries(registry)
            .filter(([, entry]) => !entry.actionSchemas)
            .map(([name]) => name);

        expect(missing).toEqual([]);
    });

    it('should expose action requirements for manually routed tools', async () => {
        const spawn = await handleLoadToolSchema({ toolName: 'spawn_manage' });
        const batch = await handleLoadToolSchema({ toolName: 'batch_manage' });
        const travel = await handleLoadToolSchema({ toolName: 'travel_manage' });

        expect('error' in spawn).toBe(false);
        expect('error' in batch).toBe(false);
        expect('error' in travel).toBe(false);
        if ('error' in spawn || 'error' in batch || 'error' in travel) {
            throw new Error('Expected schema responses');
        }

        expect(spawn.actionSchemas?.spawn_character.required).toEqual(
            expect.arrayContaining(['action', 'template'])
        );
        expect(batch.actionSchemas?.execute_sequence.required).toEqual(
            expect.arrayContaining(['action', 'steps'])
        );
        expect(travel.actionSchemas?.travel.required).toEqual(
            expect.arrayContaining(['action', 'partyId', 'poiId'])
        );
    });
});
