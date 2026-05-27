import { handleNarrativeManage, NarrativeManageTool } from '../../../src/server/consolidated/narrative-manage.js';
import { getDb, closeDb } from '../../../src/storage/index.js';
import { WorldRepository } from '../../../src/storage/repos/world.repo.js';
import { randomUUID } from 'crypto';

describe('narrative_manage consolidated tool', () => {
    let worldId: string;
    let db: ReturnType<typeof getDb>;

    beforeEach(() => {
        closeDb();
        db = getDb(':memory:');
        const worldRepo = new WorldRepository(db);

        // Create a test world
        worldId = randomUUID();
        const now = new Date().toISOString();
        worldRepo.create({
            id: worldId,
            name: 'Test World',
            seed: '12345',
            width: 100,
            height: 100,
            tileData: '{}',
            createdAt: now,
            updatedAt: now
        });
    });

    const ctx = { worldId: '', partyId: '', encounterContext: null };

    describe('tool definition', () => {
        it('should have correct name and description', () => {
            expect(NarrativeManageTool.name).toBe('narrative_manage');
            expect(NarrativeManageTool.description).toContain('narrative');
        });

        it('should list all actions in description', () => {
            expect(NarrativeManageTool.description).toContain('add');
            expect(NarrativeManageTool.description).toContain('batch_add');
            expect(NarrativeManageTool.description).toContain('search');
            expect(NarrativeManageTool.description).toContain('update');
            expect(NarrativeManageTool.description).toContain('get');
            expect(NarrativeManageTool.description).toContain('delete');
            expect(NarrativeManageTool.description).toContain('get_context');
        });
    });

    describe('action: batch_add', () => {
        it('should create multiple notes in one call', async () => {
            const result = await handleNarrativeManage({
                action: 'batch_add',
                worldId,
                notes: [
                    { type: 'plot_thread', content: 'The dragon awakens' },
                    { type: 'foreshadowing', content: 'A hooded figure watches from the shadows' },
                    { type: 'session_log', content: 'Session 3 complete' }
                ]
            }, ctx) as any;
            // narrative_manage returns raw JSON in content[0].text (no RichFormatter wrap)
            const data = result.content ? JSON.parse(result.content[0].text) : result;
            expect(data?.createdCount ?? (result as any).createdCount).toBe(3);
        });

        it('should return WORLD_NOT_FOUND for unknown world', async () => {
            const result = await handleNarrativeManage({
                action: 'batch_add',
                worldId: 'nonexistent-world',
                notes: [{ type: 'session_log', content: 'test' }]
            }, ctx) as any;
            const text = result.content?.[0]?.text ?? JSON.stringify(result);
            expect(text).toContain('WORLD_NOT_FOUND');
        });

        it('should accept alias "bulk_add"', async () => {
            const result = await handleNarrativeManage({
                action: 'bulk_add',
                worldId,
                notes: [{ type: 'canonical_moment', content: 'Hero slays the ogre' }]
            }, ctx) as any;
            const text = result.content?.[0]?.text ?? JSON.stringify(result);
            expect(text).not.toContain('"error":true');
        });
    });

    describe('action: add', () => {
        it('should create a plot thread note', async () => {
            const result = await handleNarrativeManage({
                action: 'add',
                worldId,
                type: 'plot_thread',
                content: 'The dragon threatens the kingdom',
                metadata: { urgency: 'high', hooks: ['Find dragon', 'Recruit allies'] }
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.success).toBe(true);
            expect(parsed.noteId).toBeDefined();
            expect(parsed.type).toBe('plot_thread');
            expect(parsed.message).toContain('Created plot_thread note');
        });

        it('should create a canonical moment note', async () => {
            const result = await handleNarrativeManage({
                action: 'add',
                worldId,
                type: 'canonical_moment',
                content: '"I will never surrender!" - King Roland at the Battle of Helm',
                metadata: { speaker: 'King Roland', location: 'Helm Keep' }
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.success).toBe(true);
            expect(parsed.type).toBe('canonical_moment');
        });

        it('should create an NPC voice note', async () => {
            const result = await handleNarrativeManage({
                action: 'add',
                worldId,
                type: 'npc_voice',
                content: 'The innkeeper speaks with a thick accent',
                metadata: { speech_pattern: 'Drops consonants', vocabulary: ['aye', 'nay'] }
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.success).toBe(true);
            expect(parsed.type).toBe('npc_voice');
        });

        it('should accept alias "create"', async () => {
            const result = await handleNarrativeManage({
                action: 'create',
                worldId,
                type: 'session_log',
                content: 'Party entered the dungeon'
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.success).toBe(true);
            expect(parsed._fuzzyMatch).toBeDefined();
        });

        it('should accept tags and visibility', async () => {
            const result = await handleNarrativeManage({
                action: 'add',
                worldId,
                type: 'foreshadowing',
                content: 'Strange lights in the mountains',
                tags: ['mystery', 'main-quest'],
                visibility: 'player_visible',
                metadata: { target: 'Dragon awakening' }
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.success).toBe(true);
        });
    });

    describe('action: get', () => {
        let noteId: string;

        beforeEach(async () => {
            const result = await handleNarrativeManage({
                action: 'add',
                worldId,
                type: 'plot_thread',
                content: 'The missing prince',
                tags: ['royalty', 'mystery']
            }, ctx);
            noteId = JSON.parse(result.content[0].text).noteId;
        });

        it('should retrieve a note by ID', async () => {
            const result = await handleNarrativeManage({
                action: 'get',
                noteId
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.content).toBe('The missing prince');
            expect(parsed.type).toBe('plot_thread');
            expect(parsed.tags).toContain('royalty');
        });

        it('should return error for non-existent note', async () => {
            const result = await handleNarrativeManage({
                action: 'get',
                noteId: randomUUID()
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.error).toBe(true);
            expect(parsed.message).toContain('not found');
        });

        it('should accept alias "fetch"', async () => {
            const result = await handleNarrativeManage({
                action: 'fetch',
                noteId
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.content).toBe('The missing prince');
            expect(parsed._fuzzyMatch).toBeDefined();
        });
    });

    describe('action: search', () => {
        beforeEach(async () => {
            // Create multiple notes
            await handleNarrativeManage({
                action: 'add',
                worldId,
                type: 'plot_thread',
                content: 'Dragon attacks village',
                tags: ['dragon', 'combat'],
                status: 'active'
            }, ctx);

            await handleNarrativeManage({
                action: 'add',
                worldId,
                type: 'plot_thread',
                content: 'Rescue the princess',
                tags: ['royalty', 'rescue'],
                status: 'resolved'
            }, ctx);

            await handleNarrativeManage({
                action: 'add',
                worldId,
                type: 'npc_voice',
                content: 'The blacksmith grunts more than speaks',
                tags: ['village']
            }, ctx);
        });

        it('should list all notes for world', async () => {
            const result = await handleNarrativeManage({
                action: 'search',
                worldId
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.count).toBe(3);
            expect(parsed.notes).toHaveLength(3);
        });

        it('should filter by type', async () => {
            const result = await handleNarrativeManage({
                action: 'search',
                worldId,
                type: 'plot_thread'
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.count).toBe(2);
            expect(parsed.notes.every((n: { type: string }) => n.type === 'plot_thread')).toBe(true);
        });

        it('should filter by status', async () => {
            const result = await handleNarrativeManage({
                action: 'search',
                worldId,
                status: 'active'
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.count).toBe(2); // npc_voice defaults to active
        });

        it('should text search in content', async () => {
            const result = await handleNarrativeManage({
                action: 'search',
                worldId,
                query: 'dragon'
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.count).toBe(1);
            expect(parsed.notes[0].content).toContain('Dragon');
        });

        it('should filter by tags', async () => {
            const result = await handleNarrativeManage({
                action: 'search',
                worldId,
                tags: ['royalty']
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.count).toBe(1);
            expect(parsed.notes[0].content).toContain('princess');
        });

        it('should accept alias "find"', async () => {
            const result = await handleNarrativeManage({
                action: 'find',
                worldId
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.count).toBe(3);
            expect(parsed._fuzzyMatch).toBeDefined();
        });
    });

    describe('action: update', () => {
        let noteId: string;

        beforeEach(async () => {
            const result = await handleNarrativeManage({
                action: 'add',
                worldId,
                type: 'plot_thread',
                content: 'Find the artifact',
                status: 'active'
            }, ctx);
            noteId = JSON.parse(result.content[0].text).noteId;
        });

        it('should update content', async () => {
            const result = await handleNarrativeManage({
                action: 'update',
                noteId,
                content: 'Find the legendary artifact'
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.success).toBe(true);

            // Verify update
            const getResult = await handleNarrativeManage({ action: 'get', noteId }, ctx);
            const note = JSON.parse(getResult.content[0].text);
            expect(note.content).toBe('Find the legendary artifact');
        });

        it('should update status to resolved', async () => {
            const result = await handleNarrativeManage({
                action: 'update',
                noteId,
                status: 'resolved'
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.success).toBe(true);

            const getResult = await handleNarrativeManage({ action: 'get', noteId }, ctx);
            expect(JSON.parse(getResult.content[0].text).status).toBe('resolved');
        });

        it('should merge metadata', async () => {
            await handleNarrativeManage({
                action: 'update',
                noteId,
                metadata: { urgency: 'high' }
            }, ctx);

            await handleNarrativeManage({
                action: 'update',
                noteId,
                metadata: { hooks: ['Clue in library'] }
            }, ctx);

            const getResult = await handleNarrativeManage({ action: 'get', noteId }, ctx);
            const note = JSON.parse(getResult.content[0].text);
            expect(note.metadata.urgency).toBe('high');
            expect(note.metadata.hooks).toContain('Clue in library');
        });

        it('should accept alias "edit"', async () => {
            const result = await handleNarrativeManage({
                action: 'edit',
                noteId,
                status: 'dormant'
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.success).toBe(true);
            expect(parsed._fuzzyMatch).toBeDefined();
        });

        it('should return error for non-existent note', async () => {
            const result = await handleNarrativeManage({
                action: 'update',
                noteId: randomUUID(),
                status: 'resolved'
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.error).toBe(true);
        });
    });

    describe('action: delete', () => {
        let noteId: string;

        beforeEach(async () => {
            const result = await handleNarrativeManage({
                action: 'add',
                worldId,
                type: 'session_log',
                content: 'Session 5 summary'
            }, ctx);
            noteId = JSON.parse(result.content[0].text).noteId;
        });

        it('should delete a note', async () => {
            const result = await handleNarrativeManage({
                action: 'delete',
                noteId
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.deleted).toBe(true);

            // Verify deleted
            const getResult = await handleNarrativeManage({ action: 'get', noteId }, ctx);
            expect(JSON.parse(getResult.content[0].text).error).toBe(true);
        });

        it('should return not found for non-existent note', async () => {
            const result = await handleNarrativeManage({
                action: 'delete',
                noteId: randomUUID()
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.deleted).toBe(false);
        });

        it('should accept alias "remove"', async () => {
            const result = await handleNarrativeManage({
                action: 'remove',
                noteId
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.deleted).toBe(true);
            expect(parsed._fuzzyMatch).toBeDefined();
        });
    });

    describe('action: get_context', () => {
        beforeEach(async () => {
            // Create notes of various types
            await handleNarrativeManage({
                action: 'add',
                worldId,
                type: 'plot_thread',
                content: 'The orc invasion approaches',
                metadata: { urgency: 'high' },
                tags: ['war']
            }, ctx);

            await handleNarrativeManage({
                action: 'add',
                worldId,
                type: 'foreshadowing',
                content: 'Dark clouds gather over the mountains',
                metadata: { target: 'Orc invasion' }
            }, ctx);

            await handleNarrativeManage({
                action: 'add',
                worldId,
                type: 'canonical_moment',
                content: '"We stand together or fall apart" - General Marcus'
            }, ctx);

            await handleNarrativeManage({
                action: 'add',
                worldId,
                type: 'npc_voice',
                content: 'The scout speaks in short, clipped sentences'
            }, ctx);
        });

        it('should return formatted context', async () => {
            const result = await handleNarrativeManage({
                action: 'get_context',
                worldId
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.sectionCount).toBeGreaterThan(0);
            expect(parsed.noteCount).toBe(4);
            expect(parsed.context).toContain('FORESHADOWING');
            expect(parsed.context).toContain('PLOT THREADS');
        });

        it('should filter by types', async () => {
            const result = await handleNarrativeManage({
                action: 'get_context',
                worldId,
                includeTypes: ['plot_thread', 'foreshadowing']
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.context).not.toContain('NPC VOICE');
            expect(parsed.context).not.toContain('CANONICAL');
        });

        it('should return empty message for world with no notes', async () => {
            const emptyWorldId = randomUUID();
            const worldRepo = new WorldRepository(db);
            const now = new Date().toISOString();
            worldRepo.create({
                id: emptyWorldId,
                name: 'Empty World',
                seed: '99999',
                width: 100,
                height: 100,
                tileData: '{}',
                createdAt: now,
                updatedAt: now
            });

            const result = await handleNarrativeManage({
                action: 'get_context',
                worldId: emptyWorldId
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.message).toContain('No narrative notes');
        });

        it('should accept alias "context"', async () => {
            const result = await handleNarrativeManage({
                action: 'context',
                worldId
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.sectionCount).toBeGreaterThan(0);
            expect(parsed._fuzzyMatch).toBeDefined();
        });
    });

    describe('fuzzy matching', () => {
        it('should match typo "serch" to "search"', async () => {
            const result = await handleNarrativeManage({
                action: 'serch',
                worldId
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.count).toBeDefined();
            expect(parsed._fuzzyMatch).toBeDefined();
        });

        it('should match typo "updat" to "update"', async () => {
            const addResult = await handleNarrativeManage({
                action: 'add',
                worldId,
                type: 'session_log',
                content: 'Test note'
            }, ctx);
            const noteId = JSON.parse(addResult.content[0].text).noteId;

            const result = await handleNarrativeManage({
                action: 'updat',
                noteId,
                status: 'resolved'
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.success).toBe(true);
        });
    });

    describe('error handling', () => {
        it('should return guiding error for invalid action', async () => {
            const result = await handleNarrativeManage({
                action: 'xyz',
                worldId
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.error).toBe('invalid_action');
            expect(parsed.suggestions).toBeDefined();
            expect(parsed.message).toContain('Did you mean');
        });

        it('should return error for missing action', async () => {
            const result = await handleNarrativeManage({
                worldId
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.error).toBe(true);
            expect(parsed.message).toContain('action');
        });

        it('should return validation error for missing required params on add', async () => {
            const result = await handleNarrativeManage({
                action: 'add',
                worldId
                // Missing: type, content
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.error).toBe('validation_error');
            expect(parsed.issues).toBeDefined();
        });

        it('should return validation error for missing noteId on get', async () => {
            const result = await handleNarrativeManage({
                action: 'get'
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.error).toBe('validation_error');
        });
    });
});
