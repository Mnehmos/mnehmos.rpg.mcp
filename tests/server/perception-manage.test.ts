/**
 * Tool-level tests for perception_manage — covering all 5 actions,
 * all 4 dispositions (commit, reject_inert, no_op_spoken, unknown),
 * and the full failure surface from the design.
 */

import {
    handlePerceptionManage,
    PerceptionManageTool,
    CONSTRAINT_PERCEPTION_SUBSYSTEM_ID,
} from '../../src/server/consolidated/perception-manage.js';
import { getDb, closeDb } from '../../src/storage/index.js';
import { CharacterRepository } from '../../src/storage/repos/character.repo.js';
import { ConcentrationRepository } from '../../src/storage/repos/concentration.repo.js';
import { SpatialRepository } from '../../src/storage/repos/spatial.repo.js';
import { PerceptionAssessmentRepository } from '../../src/storage/repos/perception-assessment.repo.js';
import { ensurePool, maxByLevel } from '../../src/engine/perception/attentional-capacity.js';
import { randomUUID } from 'crypto';

const ctx = { sessionId: 'test' };

function makeCharacter(repo: CharacterRepository, name: string, level = 1): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    repo.create({
        id, name, characterType: 'pc', level,
        hp: 30, maxHp: 30, ac: 12,
        stats: { str: 10, dex: 10, con: 12, int: 14, wis: 14, cha: 10 },
        createdAt: now, updatedAt: now,
    });
    return id;
}

function bindToSubsystem(db: ReturnType<typeof getDb>, characterId: string) {
    db.prepare(`
        INSERT OR IGNORE INTO subsystem_bindings (character_id, subsystem_id, bound_at)
        VALUES (?, ?, ?)
    `).run(characterId, CONSTRAINT_PERCEPTION_SUBSYSTEM_ID, new Date().toISOString());
}

function makeWorld(db: ReturnType<typeof getDb>): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
        INSERT INTO worlds (id, name, seed, width, height, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, 'Pyr', 'seed', 100, 100, now, now);
    return id;
}

function makeRoom(
    spatial: SpatialRepository,
    options: { atmospherics?: string[]; exits?: any[]; entityIds?: string[]; description?: string } = {},
): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    spatial.create({
        id,
        name: 'Test Room',
        baseDescription: options.description ?? 'A stone chamber, ten paces square, with a low ceiling and a smell of old wax.',
        biomeContext: 'dungeon',
        atmospherics: (options.atmospherics ?? []) as any,
        exits: (options.exits ?? []) as any,
        entityIds: options.entityIds ?? [],
        createdAt: now,
        updatedAt: now,
        visitedCount: 0,
    });
    return id;
}

describe('perception_manage consolidated tool', () => {
    let db: ReturnType<typeof getDb>;
    let charRepo: CharacterRepository;
    let concRepo: ConcentrationRepository;
    let spatialRepo: SpatialRepository;
    let assessmentRepo: PerceptionAssessmentRepository;

    beforeEach(() => {
        closeDb();
        db = getDb(':memory:');
        charRepo = new CharacterRepository(db);
        concRepo = new ConcentrationRepository(db);
        spatialRepo = new SpatialRepository(db);
        assessmentRepo = new PerceptionAssessmentRepository(db);
    });

    describe('tool definition', () => {
        it('should have correct name and description', () => {
            expect(PerceptionManageTool.name).toBe('perception_manage');
            expect(PerceptionManageTool.description).toContain('Hierarchy of Controls');
        });

        it('should list all 5 actions', () => {
            expect(PerceptionManageTool.description).toContain('assess');
            expect(PerceptionManageTool.description).toContain('list_hazards');
            expect(PerceptionManageTool.description).toContain('read_hazard');
            expect(PerceptionManageTool.description).toContain('recover');
            expect(PerceptionManageTool.description).toContain('get_capacity');
        });
    });

    describe('assess — commit disposition with ranked controls', () => {
        it('should return ranked controls + capacity decremented + ledger row', async () => {
            const operatorId = makeCharacter(charRepo, 'The Operator');
            bindToSubsystem(db, operatorId);
            ensurePool(operatorId, charRepo);

            // Create a monster that's part of the room
            const monsterId = makeCharacter(charRepo, 'Ore Cart Goblin');
            charRepo.update(monsterId, { characterType: 'npc' as any });

            const roomId = makeRoom(spatialRepo, {
                atmospherics: ['DARKNESS'],
                exits: [{ direction: 'north', targetNodeId: randomUUID(), type: 'OPEN' }],
                entityIds: [monsterId],
            });

            const result = await handlePerceptionManage({
                action: 'assess',
                observerId: operatorId,
                targetRef: { kind: 'room', roomId },
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.disposition).toBe('commit');
            expect(parsed.hazards.length).toBeGreaterThanOrEqual(2);
            expect(parsed.applicableControls.length).toBeGreaterThan(0);
            expect(parsed.applicableControls[0].rank).toBe(1);
            expect(parsed.costPaid).toBe(1);
            expect(parsed.capacityRemaining).toBe(2);
            expect(parsed.intentId).toBeTruthy();
            expect(parsed.assessmentId).toBeTruthy();

            // Ledger row written
            const ledger = assessmentRepo.findById(parsed.assessmentId);
            expect(ledger).not.toBeNull();
            expect(ledger?.disposition).toBe('commit');

            // event_logs row written with same intent_id
            const eventRow = db.prepare(`
                SELECT payload FROM event_logs WHERE type = 'perception_assessment'
            `).get() as { payload: string } | undefined;
            expect(eventRow).toBeDefined();
            expect(JSON.parse(eventRow!.payload).intentId).toBe(parsed.intentId);
        });
    });

    describe('assess — unknown disposition when expected categories empty', () => {
        it('should return blind_spots, NO invented hazards, cost still paid', async () => {
            const operatorId = makeCharacter(charRepo, 'The Operator');
            bindToSubsystem(db, operatorId);
            ensurePool(operatorId, charRepo);

            // Room with NO atmospherics, NO exits, NO props/entities
            const roomId = makeRoom(spatialRepo, {});

            const result = await handlePerceptionManage({
                action: 'assess',
                observerId: operatorId,
                targetRef: { kind: 'room', roomId },
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.disposition).toBe('unknown');
            expect(parsed.hazards).toEqual([]);
            expect(parsed.blindSpots.length).toBeGreaterThan(0);
            const missing = parsed.blindSpots.map((b: any) => b.whatKindOfDataIsMissing);
            expect(missing).toContain('room_exits');
            expect(parsed.costPaid).toBe(1);
            expect(parsed.capacityRemaining).toBe(2);
        });
    });

    describe('assess — reject_inert when capacity exhausted', () => {
        it('should refuse, no debit, no ledger row', async () => {
            const operatorId = makeCharacter(charRepo, 'The Operator');
            bindToSubsystem(db, operatorId);
            // Manually set capacity to 0
            charRepo.update(operatorId, {
                resourcePools: { attentional_capacity: { current: 0, max: 3 } },
            });

            const roomId = makeRoom(spatialRepo);

            const result = await handlePerceptionManage({
                action: 'assess',
                observerId: operatorId,
                targetRef: { kind: 'room', roomId },
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.disposition).toBe('reject_inert');
            expect(parsed.rejectReason.rule).toBe('attentional_capacity_exhausted');
            expect(parsed.costPaid).toBe(0);
            expect(parsed.capacityRemaining).toBe(0);

            // No ledger row written
            const rows = assessmentRepo.listByObserver(operatorId);
            expect(rows.length).toBe(0);
        });
    });

    describe('assess — reject_inert when observer not bound', () => {
        it('should refuse, mention subsystem_not_bound', async () => {
            const firefighterId = makeCharacter(charRepo, 'Firefighter');
            // NOT bound
            const roomId = makeRoom(spatialRepo);

            const result = await handlePerceptionManage({
                action: 'assess',
                observerId: firefighterId,
                targetRef: { kind: 'room', roomId },
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.disposition).toBe('reject_inert');
            expect(parsed.rejectReason.rule).toBe('subsystem_not_bound');
            expect(parsed.costPaid).toBe(0);
        });
    });

    describe('assess — reject_inert when concentrating', () => {
        it('should refuse and name the held spell', async () => {
            const operatorId = makeCharacter(charRepo, 'The Operator');
            bindToSubsystem(db, operatorId);
            ensurePool(operatorId, charRepo);

            // Set up concentration on Bless
            concRepo.create({
                characterId: operatorId,
                activeSpell: 'Bless',
                spellLevel: 1,
                startedAt: 1,
            });

            const roomId = makeRoom(spatialRepo);

            const result = await handlePerceptionManage({
                action: 'assess',
                observerId: operatorId,
                targetRef: { kind: 'room', roomId },
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.disposition).toBe('reject_inert');
            expect(parsed.rejectReason.rule).toBe('concentrating_cannot_assess');
            expect(parsed.rejectReason.explain).toContain('Bless');
            expect(parsed.costPaid).toBe(0);

            // Concentration still held
            expect(concRepo.isConcentrating(operatorId)).toBe(true);
        });
    });

    describe('assess — no_op_spoken on interrupted wind-up (cost paid)', () => {
        it('should still debit capacity even though looking failed', async () => {
            const operatorId = makeCharacter(charRepo, 'The Operator');
            bindToSubsystem(db, operatorId);
            ensurePool(operatorId, charRepo);

            const roomId = makeRoom(spatialRepo);

            const result = await handlePerceptionManage({
                action: 'assess',
                observerId: operatorId,
                targetRef: { kind: 'room', roomId },
                _interrupt: true,
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.disposition).toBe('no_op_spoken');
            expect(parsed.reason).toBe('interrupted_during_windup');
            expect(parsed.costPaid).toBe(1);
            expect(parsed.capacityRemaining).toBe(2);

            // Ledger row written with no_op_spoken
            const rows = assessmentRepo.listByObserver(operatorId);
            expect(rows.length).toBe(1);
            expect(rows[0].disposition).toBe('no_op_spoken');
        });
    });

    describe('assess — reject_inert when target_ref invalid', () => {
        it('should refuse without debit when room does not exist', async () => {
            const operatorId = makeCharacter(charRepo, 'The Operator');
            bindToSubsystem(db, operatorId);
            ensurePool(operatorId, charRepo);

            const result = await handlePerceptionManage({
                action: 'assess',
                observerId: operatorId,
                targetRef: { kind: 'room', roomId: randomUUID() },
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.disposition).toBe('reject_inert');
            expect(parsed.rejectReason.rule).toBe('target_ref_unknown');
            expect(parsed.costPaid).toBe(0);
            expect(parsed.capacityRemaining).toBe(3);
        });
    });

    describe('list_hazards — caches first call per scene per observer', () => {
        it('first call is free; second call costs 1', async () => {
            const operatorId = makeCharacter(charRepo, 'The Operator');
            bindToSubsystem(db, operatorId);
            ensurePool(operatorId, charRepo);

            const roomId = makeRoom(spatialRepo, {
                atmospherics: ['DARKNESS'],
                exits: [{ direction: 'north', targetNodeId: randomUUID(), type: 'OPEN' }],
            });

            const r1 = await handlePerceptionManage({
                action: 'list_hazards',
                observerId: operatorId,
                targetRef: { kind: 'room', roomId },
            }, ctx);
            const p1 = JSON.parse(r1.content[0].text);
            expect(p1.cached).toBe(false);
            expect(p1.costPaid).toBe(0);
            expect(p1.capacityRemaining).toBe(3);

            const r2 = await handlePerceptionManage({
                action: 'list_hazards',
                observerId: operatorId,
                targetRef: { kind: 'room', roomId },
            }, ctx);
            const p2 = JSON.parse(r2.content[0].text);
            expect(p2.cached).toBe(true);
            expect(p2.costPaid).toBe(1);
            expect(p2.capacityRemaining).toBe(2);
        });
    });

    describe('recover — long_rest refills to max', () => {
        it('drained operator refills to 3 at L1', async () => {
            const operatorId = makeCharacter(charRepo, 'The Operator');
            bindToSubsystem(db, operatorId);
            charRepo.update(operatorId, {
                resourcePools: { attentional_capacity: { current: 0, max: 3 } },
            });

            const result = await handlePerceptionManage({
                action: 'recover',
                observerId: operatorId,
                via: 'long_rest',
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.disposition).toBe('commit');
            expect(parsed.before).toBe(0);
            expect(parsed.after).toBe(3);
            expect(parsed.max).toBe(3);

            const observer = charRepo.findById(operatorId);
            expect(observer?.resourcePools?.attentional_capacity?.current).toBe(3);
        });

        it('idempotent — full → no_op_spoken', async () => {
            const operatorId = makeCharacter(charRepo, 'The Operator');
            bindToSubsystem(db, operatorId);
            ensurePool(operatorId, charRepo); // already 3/3

            const result = await handlePerceptionManage({
                action: 'recover',
                observerId: operatorId,
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.disposition).toBe('no_op_spoken');
            expect(parsed.before).toBe(3);
            expect(parsed.after).toBe(3);

            // Still writes an audit row so rest-manage can trace
            const rows = assessmentRepo.listByObserver(operatorId);
            expect(rows.length).toBe(1);
        });
    });

    describe('get_capacity — max scales at level breakpoints', () => {
        it('returns max=3 at L1, max=4 at L5, max=5 at L9, max=6 at L13', async () => {
            const checks = [
                { level: 1, expected: 3 },
                { level: 4, expected: 3 },
                { level: 5, expected: 4 },
                { level: 8, expected: 4 },
                { level: 9, expected: 5 },
                { level: 12, expected: 5 },
                { level: 13, expected: 6 },
                { level: 20, expected: 6 },
            ];
            for (const { level, expected } of checks) {
                expect(maxByLevel(level)).toBe(expected);
            }
        });

        it('observerBoundToSubsystem reflects binding state', async () => {
            const boundId = makeCharacter(charRepo, 'Bound');
            const unboundId = makeCharacter(charRepo, 'Unbound');
            bindToSubsystem(db, boundId);

            const r1 = await handlePerceptionManage({
                action: 'get_capacity',
                observerId: boundId,
            }, ctx);
            const p1 = JSON.parse(r1.content[0].text);
            expect(p1.observerBoundToSubsystem).toBe(true);

            const r2 = await handlePerceptionManage({
                action: 'get_capacity',
                observerId: unboundId,
            }, ctx);
            const p2 = JSON.parse(r2.content[0].text);
            expect(p2.observerBoundToSubsystem).toBe(false);
        });
    });

    describe('read_hazard — unknown origin when source metadata missing', () => {
        it('returns disposition=unknown for hazard whose source row has no placedBy', async () => {
            const operatorId = makeCharacter(charRepo, 'The Operator');
            bindToSubsystem(db, operatorId);
            ensurePool(operatorId, charRepo);

            const monsterId = makeCharacter(charRepo, 'Wraith');
            charRepo.update(monsterId, { characterType: 'npc' as any });

            const result = await handlePerceptionManage({
                action: 'read_hazard',
                observerId: operatorId,
                hazardId: `creature_${monsterId}`,
            }, ctx);

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.hazard).toBeTruthy();
            expect(parsed.origin).toBe('unknown_no_committed_origin');
            expect(parsed.costPaid).toBe(1);
            expect(parsed.capacityRemaining).toBe(2);
        });
    });
});
