import { ConsolidatedTools } from '../../src/server/consolidated/index.js';
import { buildConsolidatedRegistry } from '../../src/server/consolidated-registry.js';

describe('consolidated tool contracts', () => {
    it('keeps metadata, schemas, action docs, and handlers in one contract per tool', () => {
        expect(ConsolidatedTools).toHaveLength(31);
        expect(new Set(ConsolidatedTools.map(contract => contract.name)).size).toBe(31);

        for (const contract of ConsolidatedTools) {
            expect(contract.metadata.name).toBe(contract.name);
            expect(contract.metadata.description).toBe(contract.description);
            expect(contract.schema).toBe(contract.inputSchema);
            expect(contract.actionSchemas).toBeDefined();
            expect(typeof contract.handler).toBe('function');
        }
    });

    it('builds the runtime registry as a projection of those contracts', () => {
        const registry = buildConsolidatedRegistry();

        for (const contract of ConsolidatedTools) {
            const entry = registry[contract.name];
            expect(entry).toBeDefined();
            expect(entry.metadata).toBe(contract.metadata);
            expect(entry.schema).toBe(contract.schema);
            expect(entry.actionSchemas).toBe(contract.actionSchemas);
            expect(entry.handler).toBe(contract.handler);
        }
    });
});
