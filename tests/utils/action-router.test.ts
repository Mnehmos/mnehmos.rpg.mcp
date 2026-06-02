import { z } from 'zod';
import {
    createActionRouter,
    formatMcpSuccess,
    formatMcpError,
    formatValidationError,
    buildActionDescription
} from '../../src/utils/action-router.js';
import { isGuidingError } from '../../src/utils/fuzzy-enum.js';

describe('action-router utilities', () => {
    describe('createActionRouter', () => {
        const ACTIONS = ['create', 'get', 'delete'] as const;
        type TestAction = typeof ACTIONS[number];

        const definitions = {
            create: {
                schema: z.object({
                    action: z.string(),
                    name: z.string()
                }),
                handler: async (args: { name: string }) => ({
                    message: `Created: ${args.name}`,
                    id: 'test-id'
                }),
                aliases: ['new', 'add']
            },
            get: {
                schema: z.object({
                    action: z.string(),
                    id: z.string()
                }),
                handler: async (args: { id: string }) => ({
                    id: args.id,
                    name: 'Test Entity'
                })
            },
            delete: {
                schema: z.object({
                    action: z.string(),
                    id: z.string()
                }),
                handler: async (args: { id: string }) => ({
                    deleted: true,
                    id: args.id
                }),
                aliases: ['remove']
            }
        };

        const router = createActionRouter({
            actions: ACTIONS,
            definitions
        });

        describe('exact action matching', () => {
            it('should route to correct handler for exact action', async () => {
                const result = await router({ action: 'create', name: 'TestEntity' });
                const parsed = JSON.parse(result.content[0].text);

                expect(parsed.message).toBe('Created: TestEntity');
                expect(parsed.id).toBe('test-id');
            });

            it('should handle case-insensitive action', async () => {
                const result = await router({ action: 'CREATE', name: 'TestEntity' });
                const parsed = JSON.parse(result.content[0].text);

                expect(parsed.message).toBe('Created: TestEntity');
            });
        });

        describe('alias matching', () => {
            it('should route alias to canonical action', async () => {
                const result = await router({ action: 'new', name: 'AliasTest' });
                const parsed = JSON.parse(result.content[0].text);

                expect(parsed.message).toBe('Created: AliasTest');
                expect(parsed._fuzzyMatch).toBeDefined();
                expect(parsed._fuzzyMatch.similarity).toBe(95);
            });

            it('should route all aliases correctly', async () => {
                const createResult = await router({ action: 'add', name: 'Test' });
                expect(JSON.parse(createResult.content[0].text).message).toContain('Created');

                const deleteResult = await router({ action: 'remove', id: 'test-id' });
                expect(JSON.parse(deleteResult.content[0].text).deleted).toBe(true);
            });
        });

        describe('fuzzy matching', () => {
            it('should match typos', async () => {
                const result = await router({ action: 'creat', name: 'FuzzyTest' });
                const parsed = JSON.parse(result.content[0].text);

                expect(parsed.message).toContain('Created');
                expect(parsed._fuzzyMatch).toBeDefined();
                expect(parsed._fuzzyMatch.similarity).toBeGreaterThan(60);
            });
        });

        describe('error handling', () => {
            it('should return guiding error for unknown action', async () => {
                const result = await router({ action: 'xyz', name: 'Test' });
                const parsed = JSON.parse(result.content[0].text);

                expect(parsed.error).toBe('invalid_action');
                expect(parsed.suggestions).toBeDefined();
                expect(parsed.message).toContain('Did you mean');
            });

            it('should return error for missing action parameter', async () => {
                const result = await router({ name: 'Test' });
                const parsed = JSON.parse(result.content[0].text);

                expect(parsed.error).toBe(true);
                expect(parsed.message).toContain('action');
            });

            it('should return validation error for missing required parameters', async () => {
                const result = await router({ action: 'create' }); // missing 'name'
                const parsed = JSON.parse(result.content[0].text);

                expect(parsed.error).toBe('validation_error');
                expect(parsed.issues).toBeDefined();
            });
        });

        describe('handler execution', () => {
            it('should pass correct args to handler', async () => {
                const result = await router({ action: 'get', id: 'specific-id' });
                const parsed = JSON.parse(result.content[0].text);

                expect(parsed.id).toBe('specific-id');
                expect(parsed.name).toBe('Test Entity');
            });
        });

        describe('schema documentation', () => {
            it('should expose action-specific schemas without handlers', () => {
                expect(router.actionSchemas.create.schema).toBe(definitions.create.schema);
                expect(router.actionSchemas.create.aliases).toEqual(['new', 'add']);
                expect(router.actionSchemas.get.schema).toBe(definitions.get.schema);
                expect(router.actionSchemas.create).not.toHaveProperty('handler');
            });
        });
    });

    describe('formatMcpSuccess', () => {
        it('should format object result', () => {
            const result = formatMcpSuccess({ foo: 'bar', count: 42 });

            expect(result.content).toHaveLength(1);
            expect(result.content[0].type).toBe('text');

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.foo).toBe('bar');
            expect(parsed.count).toBe(42);
        });

        it('should pass through MCP response format', () => {
            const mcpResponse = {
                content: [{ type: 'text' as const, text: '{"already":"formatted"}' }]
            };

            const result = formatMcpSuccess(mcpResponse);
            expect(result).toBe(mcpResponse);
        });

        it('should add fuzzy match info when not exact', () => {
            const result = formatMcpSuccess(
                { data: 'test' },
                { matched: 'create', exact: false, similarity: 0.85 }
            );

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed._fuzzyMatch).toBeDefined();
            expect(parsed._fuzzyMatch.similarity).toBe(85);
        });

        it('should not add fuzzy match info for exact matches', () => {
            const result = formatMcpSuccess(
                { data: 'test' },
                { matched: 'create', exact: true, similarity: 1.0 }
            );

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed._fuzzyMatch).toBeUndefined();
        });
    });

    describe('formatMcpError', () => {
        it('should format error with message and details', () => {
            const result = formatMcpError('Something went wrong', { code: 'ERR_001' });

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.error).toBe(true);
            expect(parsed.message).toBe('Something went wrong');
            expect(parsed.code).toBe('ERR_001');
        });
    });

    describe('formatValidationError', () => {
        it('should format Zod validation errors', () => {
            const schema = z.object({
                name: z.string(),
                age: z.number()
            });

            const parseResult = schema.safeParse({ name: 123, age: 'invalid' });
            if (parseResult.success) throw new Error('Expected validation to fail');

            const result = formatValidationError('create', parseResult.error);
            const parsed = JSON.parse(result.content[0].text);

            expect(parsed.error).toBe('validation_error');
            expect(parsed.action).toBe('create');
            expect(parsed.issues).toHaveLength(2);
            expect(parsed.hint).toBeDefined();
        });
    });

    describe('buildActionDescription', () => {
        it('should list all actions', () => {
            const actions = ['create', 'get', 'update', 'delete'] as const;
            const definitions = {
                create: { schema: z.object({}), handler: async () => {} },
                get: { schema: z.object({}), handler: async () => {} },
                update: { schema: z.object({}), handler: async () => {} },
                delete: { schema: z.object({}), handler: async () => {} }
            };

            const description = buildActionDescription(actions, definitions);

            expect(description).toContain('create');
            expect(description).toContain('get');
            expect(description).toContain('update');
            expect(description).toContain('delete');
        });

        it('should include aliases', () => {
            const actions = ['create', 'get'] as const;
            const definitions = {
                create: {
                    schema: z.object({}),
                    handler: async () => {},
                    aliases: ['new', 'add']
                },
                get: {
                    schema: z.object({}),
                    handler: async () => {},
                    aliases: ['fetch']
                }
            };

            const description = buildActionDescription(actions, definitions);

            expect(description).toContain('new/add');
            expect(description).toContain('create');
            expect(description).toContain('fetch');
            expect(description).toContain('get');
        });
    });
});
