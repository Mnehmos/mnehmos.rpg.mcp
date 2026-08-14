import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { schemaShape } from '../../src/server/schema-shape.js';
import { buildConsolidatedRegistry } from '../../src/server/consolidated-registry.js';

describe('schemaShape', () => {
    it('merges object fields from a Zod intersection', () => {
        const schema = z.object({ action: z.string() }).and(z.object({ sessionId: z.string().optional() }));
        expect(Object.keys(schemaShape(schema)).sort()).toEqual(['action', 'sessionId']);
    });

    it('keeps consolidated MCP input schemas free of unresolved local references', () => {
        const findRefs = (value: unknown, path = '$'): string[] => {
            if (!value || typeof value !== 'object') return [];
            const record = value as Record<string, unknown>;
            const refs = typeof record.$ref === 'string' ? [`${path}: ${record.$ref}`] : [];
            return refs.concat(
                Object.entries(record).flatMap(([key, child]) => findRefs(child, `${path}.${key}`))
            );
        };

        const refs = Object.entries(buildConsolidatedRegistry()).flatMap(([name, entry]) =>
            findRefs(zodToJsonSchema(z.object(schemaShape(entry.schema)), {
                strictUnions: true,
                pipeStrategy: 'input'
            }), name)
        );

        expect(refs).toEqual([]);
    });
});
