import { handleSceneManage, SceneManageTool } from '../../../src/server/consolidated/scene-manage.js';
import { getDb, closeDb } from '../../../src/storage/index.js';
import { WorldRepository } from '../../../src/storage/repos/world.repo.js';
import { CharacterRepository } from '../../../src/storage/repos/character.repo.js';
import { SceneRepository } from '../../../src/storage/repos/scene.repo.js';
import { buildSceneSlice } from '../../../src/agent/prompt/slices/scene.js';
import { randomUUID } from 'crypto';

describe('scene_manage consolidated tool', () => {
    let worldId: string;
    let coleId: string;
    let renataId: string;
    let bohdanId: string;
    let db: ReturnType<typeof getDb>;

    beforeEach(() => {
        closeDb();
        db = getDb(':memory:');
        const worldRepo = new WorldRepository(db);
        const charRepo = new CharacterRepository(db);

        worldId = randomUUID();
        const now = new Date().toISOString();
        worldRepo.create({
            id: worldId,
            name: 'Sebastopyr',
            seed: 'pd-606',
            width: 100,
            height: 100,
            tileData: '{}',
            createdAt: now,
            updatedAt: now
        });

        const mkChar = (name: string, cls: string) => {
            const id = randomUUID();
            charRepo.create({
                id,
                name,
                race: 'Human',
                characterClass: cls,
                level: 1,
                characterType: 'pc',
                hp: 9,
                maxHp: 9,
                ac: 11,
                stats: { str: 10, dex: 10, con: 10, int: 14, wis: 14, cha: 10 },
                createdAt: now,
                updatedAt: now
            });
            return id;
        };

        coleId = mkChar('Cole Maddox', 'Paladin');
        renataId = mkChar('Renata Salk', 'Field Surgeon');
        bohdanId = mkChar('Bohdan Cerny', 'Mason');
    });

    const ctx = { worldId: '', partyId: '', encounterContext: null };

    describe('tool definition', () => {
        it('exposes the canonical name', () => {
            expect(SceneManageTool.name).toBe('scene_manage');
        });

        it('lists all actions in the description', () => {
            expect(SceneManageTool.description).toContain('set');
            expect(SceneManageTool.description).toContain('list');
            expect(SceneManageTool.description).toContain('current');
        });
    });

    describe('action: set', () => {
        it('commits a scene and returns the persisted record', async () => {
            const result = await handleSceneManage({
                action: 'set',
                worldId,
                title: 'What the Hour Can Honestly Hold',
                whenLabel: 'PD 606 · Day 1 · 00:15',
                placeLabel: 'Vocation House Inner Chamber, Sebastopyr',
                narration: 'The address has closed. Mnehmos stands at the foot of the seven steps.',
                engineState: {
                    vas_halidani: '6412/15468',
                    brass_nail_line: 'nominal',
                    language_bridge_expires: 'PD 606 · Day 3 · 18:00'
                },
                participants: [coleId, renataId, bohdanId]
            }, ctx) as any;
            const payload = JSON.parse(result.content[0].text);
            expect(payload.success).toBe(true);
            expect(payload.scene.title).toBe('What the Hour Can Honestly Hold');
            expect(payload.scene.participants).toEqual([coleId, renataId, bohdanId]);
            expect(payload.scene.engineState.vas_halidani).toBe('6412/15468');
        });

        it('rejects unknown world', async () => {
            const result = await handleSceneManage({
                action: 'set',
                worldId: 'nope',
                narration: 'x',
                participants: [coleId]
            }, ctx) as any;
            const payload = JSON.parse(result.content[0].text);
            expect(payload.error).toBe(true);
            expect(payload.code).toBe('WORLD_NOT_FOUND');
        });

        it('rejects unknown participants', async () => {
            const result = await handleSceneManage({
                action: 'set',
                worldId,
                narration: 'x',
                participants: [coleId, 'ghost-id']
            }, ctx) as any;
            const payload = JSON.parse(result.content[0].text);
            expect(payload.error).toBe(true);
            expect(payload.code).toBe('PARTICIPANT_NOT_FOUND');
        });
    });

    describe('action: current — auto-injection lookup', () => {
        it('returns the latest scene for a participant', async () => {
            const setRes = await handleSceneManage({
                action: 'set',
                worldId,
                narration: 'first frame',
                participants: [coleId, renataId]
            }, ctx) as any;
            const sceneId = JSON.parse(setRes.content[0].text).sceneId;

            const curRes = await handleSceneManage({
                action: 'current',
                worldId,
                characterId: coleId
            }, ctx) as any;
            const payload = JSON.parse(curRes.content[0].text);
            expect(payload.scene.id).toBe(sceneId);
        });

        it('returns null for a character never in any scene', async () => {
            const result = await handleSceneManage({
                action: 'current',
                worldId,
                characterId: bohdanId
            }, ctx) as any;
            const payload = JSON.parse(result.content[0].text);
            expect(payload.scene).toBeNull();
        });

        it('finds the most recent when multiple scenes exist', async () => {
            await handleSceneManage({
                action: 'set',
                worldId,
                narration: 'scene 1',
                participants: [coleId]
            }, ctx);

            await new Promise(r => setTimeout(r, 5));
            const sndRes = await handleSceneManage({
                action: 'set',
                worldId,
                narration: 'scene 2',
                participants: [coleId, renataId]
            }, ctx) as any;
            const sndId = JSON.parse(sndRes.content[0].text).sceneId;

            const curRes = await handleSceneManage({
                action: 'current',
                worldId,
                characterId: coleId
            }, ctx) as any;
            const payload = JSON.parse(curRes.content[0].text);
            expect(payload.scene.id).toBe(sndId);
            expect(payload.scene.narration).toBe('scene 2');
        });

        it('the LIKE match is verified against the parsed array (no prefix false positives)', () => {
            const repo = new SceneRepository(db);
            const longId = 'aaaa1234-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
            const shortId = 'aaaa1234';
            const now = new Date().toISOString();
            repo.create({
                id: randomUUID(),
                worldId,
                narration: 'should not match shortId',
                participants: [longId],
                createdAt: now
            } as any);

            const found = repo.findLatestForParticipant(shortId, worldId);
            expect(found).toBeNull();
        });
    });

    describe('buildSceneSlice — what the agent sees', () => {
        it('renders title, when, place, narration, engine state, and party roster', async () => {
            await handleSceneManage({
                action: 'set',
                worldId,
                title: 'The Naming',
                whenLabel: 'PD 606 · Day 1 · 00:15',
                placeLabel: 'Vocation House Inner Chamber',
                narration: 'The address has closed.',
                engineState: { vas: '6412/15468', brass: 'nominal' },
                participants: [coleId, renataId, bohdanId]
            }, ctx);

            const sceneRepo = new SceneRepository(db);
            const charRepo = new CharacterRepository(db);
            const slice = buildSceneSlice(coleId, sceneRepo, charRepo);
            expect(slice).not.toBeNull();
            expect(slice).toContain('CURRENT SCENE');
            expect(slice).toContain('The Naming');
            expect(slice).toContain('PD 606 · Day 1 · 00:15');
            expect(slice).toContain('The address has closed.');
            expect(slice).toContain('vas: 6412/15468');
            expect(slice).toContain('Cole Maddox');
            expect(slice).toContain('Renata Salk');
            expect(slice).toContain('Bohdan Cerny');
            expect(slice).toContain('You submit your CHARACTER\'S INTENT');
        });

        it('returns null when the character has no scenes', () => {
            const sceneRepo = new SceneRepository(db);
            const charRepo = new CharacterRepository(db);
            const slice = buildSceneSlice(coleId, sceneRepo, charRepo);
            expect(slice).toBeNull();
        });
    });

    describe('action: list', () => {
        it('returns recent scenes newest-first', async () => {
            await handleSceneManage({
                action: 'set',
                worldId,
                narration: 'first',
                participants: [coleId]
            }, ctx);
            await new Promise(r => setTimeout(r, 5));
            await handleSceneManage({
                action: 'set',
                worldId,
                narration: 'second',
                participants: [coleId]
            }, ctx);

            const result = await handleSceneManage({
                action: 'list',
                worldId,
                limit: 5
            }, ctx) as any;
            const payload = JSON.parse(result.content[0].text);
            expect(payload.count).toBe(2);
            expect(payload.scenes[0].narration).toBe('second');
            expect(payload.scenes[1].narration).toBe('first');
        });
    });
});
