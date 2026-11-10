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
        expect(result.actionSchemas?.options.required).toEqual(['action']);
        expect(result.inputSchema.action.description).toContain('options');

        const items = await handleLoadToolSchema({ toolName: 'item_manage' });
        expect('error' in items).toBe(false);
        if ('error' in items) throw new Error(items.error);
        expect(items.actionSchemas?.catalog_search.required).toEqual(['action']);
        expect(items.actionSchemas?.catalog_get.required).toEqual(['action', 'sourceKey']);
        expect(items.actionSchemas?.materialize.required).toEqual(['action', 'sourceKey']);
        expect(items.inputSchema.action.description).toContain('materialize');
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

/**
 * load_tool_schema's summary is read by the web service, so its format is a
 * contract. The summarizer walks zod's own definitions, which changed shape
 * completely between zod 3 and zod 4; these pin the output for each kind of
 * schema the tools actually use. The expected values are what zod 3 produced.
 */
describe('load_tool_schema summary format', () => {
    const load = async (toolName: string) => {
        const result = await handleLoadToolSchema({ toolName });
        if ('error' in result) throw new Error(result.error);
        return result;
    };

    it('summarizes literals, unions, arrays, objects and described optionals', async () => {
        const combat = await load('combat_action');
        const attack = combat.actionSchemas!.attack;

        expect(attack.required).toEqual(['action', 'encounterId', 'actorId', 'targetId']);
        expect(attack.inputSchema.properties.action).toEqual({ type: 'literal', value: 'attack' });
        expect(attack.inputSchema.properties.damage).toEqual({
            type: 'union',
            options: [{ type: 'number' }, { type: 'string' }],
            optional: true,
        });
        // A description set before .optional() still shows on the field.
        expect(attack.inputSchema.properties.range).toEqual({
            type: 'number',
            description: expect.stringContaining('Reach or range'),
            optional: true,
        });
        expect(combat.actionSchemas!.cast_spell.inputSchema.properties.targetIds).toEqual({
            type: 'array',
            itemType: { type: 'string' },
            optional: true,
        });
        expect(combat.actionSchemas!.move.inputSchema.properties.targetPosition).toEqual({
            type: 'object',
            properties: { x: { type: 'number' }, y: { type: 'number' } },
        });
    });

    it('summarizes records, enums and defaults', async () => {
        const add = (await load('narrative_manage')).actionSchemas!.add.inputSchema.properties;

        expect(add.metadata).toEqual({
            type: 'record',
            valueType: { type: 'any' },
            description: 'Type-specific structured data',
            optional: true,
            default: {},
        });
        expect(add.visibility).toEqual({
            type: 'enum',
            values: ['dm_only', 'player_visible'],
            optional: true,
            default: 'dm_only',
        });
    });

    it('never leaks zod 4 internal type names', async () => {
        const registry = buildConsolidatedRegistry();
        const kinds = new Set<string>();
        const collect = (node: unknown): void => {
            if (!node || typeof node !== 'object') return;
            const type = (node as { type?: unknown }).type;
            if (typeof type === 'string' && ('optional' in node || 'properties' in node || 'itemType' in node
                || 'values' in node || 'options' in node || 'valueType' in node || Object.keys(node).length <= 2)) {
                kinds.add(type);
            }
            for (const child of Object.values(node)) collect(child);
        };
        for (const toolName of Object.keys(registry)) collect((await load(toolName)).actionSchemas);

        for (const internal of ['pipe', 'transform', 'default', 'prefault', 'optional', 'nullable', 'int', 'custom']) {
            expect(kinds.has(internal), `summary exposes zod internal kind "${internal}"`).toBe(false);
        }
    });
});
