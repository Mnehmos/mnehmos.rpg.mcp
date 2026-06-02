/**
 * perception_manage — the Operator's constraint-perception lens.
 *
 * Five actions:
 *   assess         — debit attention, scan committed state, rank controls.
 *   list_hazards   — cheap decomposition (cached first-call per scene).
 *   read_hazard    — deep-read origin and removal options for one hazard.
 *   recover        — refill attentional_capacity (rest hook).
 *   get_capacity   — read-side query, free.
 *
 * Every commit writes a perception_assessments row + an event_logs row
 * sharing the same intent_id (Phase-1 shadow ledger per §10.2).
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';
import { createActionRouter, ActionDefinition, McpResponse } from '../../utils/action-router.js';
import { SessionContext } from '../types.js';
import { getDb } from '../../storage/index.js';
import { CharacterRepository } from '../../storage/repos/character.repo.js';
import { ConcentrationRepository } from '../../storage/repos/concentration.repo.js';
import { PerceptionAssessmentRepository } from '../../storage/repos/perception-assessment.repo.js';
import {
    TargetRefSchema,
    TargetRef,
    Hazard,
    BlindSpot,
    ApplicableControl,
    RejectReason,
    Disposition,
} from '../../schema/perception.js';
import { scanHazards, targetExists, ScanDeps } from '../../engine/perception/hazard-detector.js';
import { detectBlindSpots } from '../../engine/perception/blind-spot-detector.js';
import { rankControls, CommittedState } from '../../engine/perception/hierarchy-of-controls.js';
import { debit, refill, read as readCap, ATTENTIONAL_CAPACITY_KEY } from '../../engine/perception/attentional-capacity.js';

// ─────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────

const ACTIONS = ['assess', 'list_hazards', 'read_hazard', 'recover', 'get_capacity'] as const;
type PerceptionAction = typeof ACTIONS[number];

export const CONSTRAINT_PERCEPTION_SUBSYSTEM_ID = 'constraint-perception';

// ─────────────────────────────────────────────────────────────────
// DB HELPER
// ─────────────────────────────────────────────────────────────────

function ensureDb() {
    const dbPath = process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db';
    const db = getDb(dbPath);
    return {
        db,
        characterRepo: new CharacterRepository(db),
        concentrationRepo: new ConcentrationRepository(db),
        assessmentRepo: new PerceptionAssessmentRepository(db),
    };
}

// ─────────────────────────────────────────────────────────────────
// BINDING CHECK
// ─────────────────────────────────────────────────────────────────

function isObserverBound(db: ReturnType<typeof getDb>, observerId: string): boolean {
    const row = db.prepare(`
        SELECT 1 FROM subsystem_bindings
        WHERE character_id = ? AND subsystem_id = ?
    `).get(observerId, CONSTRAINT_PERCEPTION_SUBSYSTEM_ID);
    return !!row;
}

// ─────────────────────────────────────────────────────────────────
// EVENT-LOG WRITER (Phase-1 shadow ledger)
// ─────────────────────────────────────────────────────────────────

function logPerceptionEvent(
    db: ReturnType<typeof getDb>,
    payload: Record<string, unknown>,
    intentId: string,
): void {
    db.prepare(`
        INSERT INTO event_logs (type, payload, timestamp)
        VALUES (?, ?, ?)
    `).run('perception_assessment', JSON.stringify({ ...payload, intentId }), new Date().toISOString());
}

// ─────────────────────────────────────────────────────────────────
// COMMITTED-STATE BUILDER
// ─────────────────────────────────────────────────────────────────

function buildCommittedState(db: ReturnType<typeof getDb>, target: TargetRef): CommittedState {
    const base: CommittedState = {
        roomExitsCommitted: false,
        roomEntitiesCommitted: false,
        encounterGridCommitted: false,
        sceneDescribed: false,
        targetKind: target.kind,
    };

    if (target.kind === 'room') {
        const room = db.prepare(
            'SELECT exits, entity_ids, base_description FROM room_nodes WHERE id = ?'
        ).get(target.roomId) as { exits: string; entity_ids: string; base_description: string } | undefined;
        if (room) {
            try { base.roomExitsCommitted = (JSON.parse(room.exits) as unknown[]).length > 0; } catch { /* nope */ }
            try { base.roomEntitiesCommitted = (JSON.parse(room.entity_ids) as unknown[]).length > 0; } catch { /* nope */ }
            base.sceneDescribed = !!(room.base_description && room.base_description.trim().length >= 10);
        }
    } else if (target.kind === 'encounter') {
        const enc = db.prepare(
            'SELECT tokens, grid_bounds FROM encounters WHERE id = ?'
        ).get(target.encounterId) as { tokens: string; grid_bounds: string | null } | undefined;
        if (enc) {
            try { base.roomEntitiesCommitted = (JSON.parse(enc.tokens) as unknown[]).length > 0; } catch { /* nope */ }
            base.encounterGridCommitted = !!enc.grid_bounds;
            base.sceneDescribed = !!enc.grid_bounds;
        }
    } else {
        const note = db.prepare(
            'SELECT entity_id, content FROM narrative_notes WHERE id = ?'
        ).get(target.sceneNarrativeNoteId) as { entity_id: string | null; content: string } | undefined;
        if (note) {
            base.roomEntitiesCommitted = !!note.entity_id;
            base.sceneDescribed = !!(note.content && note.content.trim().length > 0);
        }
    }

    return base;
}

// ─────────────────────────────────────────────────────────────────
// ACTION SCHEMAS
// ─────────────────────────────────────────────────────────────────

const AssessSchema = z.object({
    action: z.literal('assess'),
    observerId: z.string(),
    targetRef: TargetRefSchema,
    lens: z.enum(['full', 'elimination_only', 'top_n']).default('full'),
    topN: z.number().int().min(1).max(5).optional().default(3),
    // Test hook — simulate the wind-up being interrupted.
    _interrupt: z.boolean().optional(),
});

const ListHazardsSchema = z.object({
    action: z.literal('list_hazards'),
    observerId: z.string(),
    targetRef: TargetRefSchema,
});

const ReadHazardSchema = z.object({
    action: z.literal('read_hazard'),
    observerId: z.string(),
    hazardId: z.string(),
});

const RecoverSchema = z.object({
    action: z.literal('recover'),
    observerId: z.string(),
    via: z.enum(['long_rest', 'scene_break', 'grant']).default('long_rest'),
});

const GetCapacitySchema = z.object({
    action: z.literal('get_capacity'),
    observerId: z.string(),
});

// ─────────────────────────────────────────────────────────────────
// HANDLERS
// ─────────────────────────────────────────────────────────────────

function targetRefToLedger(t: TargetRef): { kind: 'room' | 'encounter' | 'scene'; id: string } {
    switch (t.kind) {
        case 'room':      return { kind: 'room', id: t.roomId };
        case 'encounter': return { kind: 'encounter', id: t.encounterId };
        case 'scene':     return { kind: 'scene', id: t.sceneNarrativeNoteId };
    }
}

async function handleAssess(args: z.infer<typeof AssessSchema>): Promise<object> {
    const { db, characterRepo, concentrationRepo, assessmentRepo } = ensureDb();
    const intentId = randomUUID();
    const { observerId, targetRef } = args;

    // 1. Observer existence
    const observer = characterRepo.findById(observerId);
    if (!observer) {
        return {
            disposition: 'reject_inert' as Disposition,
            rejectReason: {
                rule: 'observer_not_found',
                explain: `Observer ${observerId} does not exist in characters table.`,
            },
            costPaid: 0,
            capacityRemaining: 0,
            intentId,
        };
    }

    // 2. Subsystem-binding gate
    if (!isObserverBound(db, observerId)) {
        return {
            disposition: 'reject_inert' as Disposition,
            rejectReason: {
                rule: 'subsystem_not_bound',
                explain:
                    'Character is not bound to the constraint-perception subsystem. ' +
                    'Only the Operator (and future characters explicitly bound at spawn) ' +
                    'may assess hazards through the hierarchy-of-controls lens.',
            },
            costPaid: 0,
            capacityRemaining: 0,
            intentId,
        };
    }

    // 3. Invalid target check — no debit, no row
    if (!targetExists(targetRef, { db } as ScanDeps)) {
        return {
            disposition: 'reject_inert' as Disposition,
            rejectReason: {
                rule: 'target_ref_unknown',
                explain:
                    'target_ref points to a row that does not exist in committed state ' +
                    '(roomId not in rooms table / encounterId not in encounters / ' +
                    'sceneNarrativeNoteId not in narrative_notes).',
            },
            costPaid: 0,
            capacityRemaining: readCap(observerId, characterRepo)?.current ?? 0,
            intentId,
        };
    }

    // 4. Concentration guard — looking shares attention with a held effect
    if (concentrationRepo.isConcentrating(observerId)) {
        const state = concentrationRepo.findByCharacterId(observerId);
        return {
            disposition: 'reject_inert' as Disposition,
            rejectReason: {
                rule: 'concentrating_cannot_assess',
                explain:
                    `Observer is concentrating on ${state?.activeSpell ?? 'a spell'}. ` +
                    'Drop concentration first or wait for the spell to end. ' +
                    'Pre-task hazard analysis requires attention the spell is already holding.',
            },
            costPaid: 0,
            capacityRemaining: readCap(observerId, characterRepo)?.current ?? 0,
            intentId,
        };
    }

    // 5. Capacity check
    const capBefore = readCap(observerId, characterRepo);
    if (!capBefore || capBefore.current < 1) {
        return {
            disposition: 'reject_inert' as Disposition,
            rejectReason: {
                rule: 'attentional_capacity_exhausted',
                explain:
                    `Observer has ${capBefore?.current ?? 0}/${capBefore?.max ?? 3} attentional_capacity. ` +
                    'Take a long rest to refill, or have another bound observer assess instead.',
            },
            costPaid: 0,
            capacityRemaining: capBefore?.current ?? 0,
            intentId,
        };
    }

    // 6. Debit capacity (the cost of looking is real)
    const after = debit(observerId, characterRepo, 1);

    // 7. Interrupt test hook — simulates wind-up disruption
    if (args._interrupt) {
        const ledgerTarget = targetRefToLedger(targetRef);
        assessmentRepo.create({
            observerId,
            intentId,
            targetRefKind: ledgerTarget.kind,
            targetRefId: ledgerTarget.id,
            hazards: [],
            applicableControls: [],
            blindSpots: [],
            disposition: 'no_op_spoken',
            rejectReason: {
                rule: 'interrupted_during_windup',
                explain: 'Observer was disrupted during the 1-action wind-up.',
            },
            costPaid: 1,
            capacityRemainingAfter: after.after,
        });
        logPerceptionEvent(db, { observerId, disposition: 'no_op_spoken', costPaid: 1 }, intentId);
        return {
            disposition: 'no_op_spoken' as Disposition,
            reason: 'interrupted_during_windup',
            explain:
                'Observer took damage / was forced to move / was hit with a condition during ' +
                'the 1-action wind-up. The JSA was begun but not completed.',
            costPaid: 1,
            capacityRemaining: after.after,
            intentId,
        };
    }

    // 8. Scan committed state
    const deps: ScanDeps = { db };
    const hazards = scanHazards(targetRef, deps);
    const committedState = buildCommittedState(db, targetRef);
    const blindSpots = detectBlindSpots(targetRef, hazards, deps);
    const applicableControls = rankControls(hazards, committedState);

    // 9. Decide disposition: unknown if expected categories are empty + hazards empty
    let disposition: Disposition = 'commit';
    if (hazards.length === 0 && blindSpots.length > 0) {
        disposition = 'unknown';
    }

    // 10. Optionally trim to topN
    let finalControls = applicableControls;
    if (args.lens === 'top_n') {
        finalControls = applicableControls.slice(0, args.topN);
    } else if (args.lens === 'elimination_only') {
        finalControls = applicableControls.filter(c => c.level === 'elimination');
    }

    // 11. Ledger write — atomic with the event log
    const ledgerTarget = targetRefToLedger(targetRef);
    const tx = db.transaction(() => {
        const assessment = assessmentRepo.create({
            observerId,
            intentId,
            targetRefKind: ledgerTarget.kind,
            targetRefId: ledgerTarget.id,
            hazards,
            applicableControls: finalControls,
            blindSpots,
            disposition,
            rejectReason: null,
            costPaid: 1,
            capacityRemainingAfter: after.after,
        });
        logPerceptionEvent(db, {
            observerId,
            assessmentId: assessment.id,
            disposition,
            hazardCount: hazards.length,
            blindSpotCount: blindSpots.length,
        }, intentId);
        return assessment;
    });
    const assessment = tx();

    return {
        assessmentId: assessment.id,
        hazards,
        applicableControls: finalControls,
        blindSpots,
        disposition,
        costPaid: 1,
        capacityRemaining: after.after,
        intentId,
    };
}

async function handleListHazards(args: z.infer<typeof ListHazardsSchema>): Promise<object> {
    const { db, characterRepo, concentrationRepo, assessmentRepo } = ensureDb();
    const intentId = randomUUID();
    const { observerId, targetRef } = args;

    const observer = characterRepo.findById(observerId);
    if (!observer) {
        return {
            disposition: 'reject_inert' as Disposition,
            rejectReason: { rule: 'observer_not_found', explain: 'Observer not found.' },
            capacityRemaining: 0,
            intentId,
        };
    }

    if (!isObserverBound(db, observerId)) {
        return {
            disposition: 'reject_inert' as Disposition,
            rejectReason: {
                rule: 'subsystem_not_bound',
                explain: 'Observer is not bound to constraint-perception.',
            },
            capacityRemaining: 0,
            intentId,
        };
    }

    if (!targetExists(targetRef, { db } as ScanDeps)) {
        return {
            disposition: 'reject_inert' as Disposition,
            rejectReason: { rule: 'target_ref_unknown', explain: 'Target does not exist.' },
            capacityRemaining: readCap(observerId, characterRepo)?.current ?? 0,
            intentId,
        };
    }

    if (concentrationRepo.isConcentrating(observerId)) {
        return {
            disposition: 'reject_inert' as Disposition,
            rejectReason: {
                rule: 'concentrating_cannot_assess',
                explain: 'Observer is concentrating; cannot list hazards.',
            },
            capacityRemaining: readCap(observerId, characterRepo)?.current ?? 0,
            intentId,
        };
    }

    // Cache: first list_hazards per scene per observer is free.
    const ledgerTarget = targetRefToLedger(targetRef);
    const cached = assessmentRepo.hasObserverProbedTarget(observerId, ledgerTarget.kind, ledgerTarget.id);

    let costPaid = 0;
    let remaining = readCap(observerId, characterRepo)?.current ?? 0;
    if (cached) {
        // Debit 1
        const cap = readCap(observerId, characterRepo);
        if (!cap || cap.current < 1) {
            return {
                disposition: 'reject_inert' as Disposition,
                rejectReason: {
                    rule: 'attentional_capacity_exhausted',
                    explain: 'Cached re-query still costs 1; observer has 0 capacity.',
                },
                capacityRemaining: 0,
                intentId,
            };
        }
        const after = debit(observerId, characterRepo, 1);
        costPaid = 1;
        remaining = after.after;
    }

    const hazards = scanHazards(targetRef, { db } as ScanDeps);

    const assessment = assessmentRepo.create({
        observerId,
        intentId,
        targetRefKind: ledgerTarget.kind,
        targetRefId: ledgerTarget.id,
        hazards,
        applicableControls: [],
        blindSpots: [],
        disposition: 'commit',
        rejectReason: null,
        costPaid,
        capacityRemainingAfter: remaining,
    });
    logPerceptionEvent(db, {
        observerId,
        assessmentId: assessment.id,
        disposition: 'commit',
        cached,
    }, intentId);

    return {
        hazards,
        capacityRemaining: remaining,
        disposition: 'commit' as Disposition,
        cached,
        costPaid,
        intentId,
    };
}

async function handleReadHazard(args: z.infer<typeof ReadHazardSchema>): Promise<object> {
    const { db, characterRepo, concentrationRepo } = ensureDb();
    const intentId = randomUUID();
    const { observerId, hazardId } = args;

    const observer = characterRepo.findById(observerId);
    if (!observer) {
        return {
            disposition: 'reject_inert' as Disposition,
            rejectReason: { rule: 'observer_not_found', explain: 'Observer not found.' },
            costPaid: 0,
            capacityRemaining: 0,
            intentId,
        };
    }

    if (!isObserverBound(db, observerId)) {
        return {
            disposition: 'reject_inert' as Disposition,
            rejectReason: { rule: 'subsystem_not_bound', explain: 'Observer not bound.' },
            costPaid: 0,
            capacityRemaining: 0,
            intentId,
        };
    }

    if (concentrationRepo.isConcentrating(observerId)) {
        return {
            disposition: 'reject_inert' as Disposition,
            rejectReason: { rule: 'concentrating_cannot_assess', explain: 'Observer is concentrating.' },
            costPaid: 0,
            capacityRemaining: readCap(observerId, characterRepo)?.current ?? 0,
            intentId,
        };
    }

    const capBefore = readCap(observerId, characterRepo);
    if (!capBefore || capBefore.current < 1) {
        return {
            disposition: 'reject_inert' as Disposition,
            rejectReason: {
                rule: 'attentional_capacity_exhausted',
                explain: 'Deep reads cost 1 attentional_capacity.',
            },
            costPaid: 0,
            capacityRemaining: capBefore?.current ?? 0,
            intentId,
        };
    }

    const after = debit(observerId, characterRepo, 1);

    // Parse the hazardId prefix to know what kind of source row to look at
    let hazard: Hazard | null = null;
    let origin: object | 'unknown_no_committed_origin' = 'unknown_no_committed_origin';

    if (hazardId.startsWith('creature_')) {
        const charId = hazardId.slice('creature_'.length);
        const c = db.prepare(
            'SELECT id, name, character_type, created_at FROM characters WHERE id = ?'
        ).get(charId) as { id: string; name: string; character_type: string | null; created_at: string } | undefined;
        if (c) {
            hazard = {
                id: hazardId,
                name: c.name,
                kind: 'creature',
                severity: 'severe',
                sourceEvidence: {
                    tool: 'npc_manage',
                    rowId: c.id,
                    committedAt: c.created_at,
                },
            };
            // No placedBy / placedAt metadata committed for legacy NPCs.
            origin = 'unknown_no_committed_origin';
        }
    } else if (hazardId.startsWith('room_')) {
        // Atmospheric hazard
        const parts = hazardId.split('_');
        if (parts.length >= 4) {
            const roomId = parts[1];
            const atmos = parts[3];
            const r = db.prepare(
                'SELECT id, updated_at FROM room_nodes WHERE id = ?'
            ).get(roomId) as { id: string; updated_at: string } | undefined;
            if (r) {
                hazard = {
                    id: hazardId,
                    name: atmos,
                    kind: 'environmental',
                    severity: 'moderate',
                    sourceEvidence: { tool: 'spatial_manage', rowId: r.id, committedAt: r.updated_at },
                };
                origin = { placedAt: r.updated_at, conditionsRequired: [] };
            }
        }
    }

    if (!hazard) {
        return {
            disposition: 'unknown' as Disposition,
            reason: 'hazard_not_resolvable_from_id',
            costPaid: 1,
            capacityRemaining: after.after,
            intentId,
        };
    }

    return {
        hazard,
        origin,
        removalAgents: [],
        substitutionOptions: [],
        disposition: 'commit' as Disposition,
        costPaid: 1,
        capacityRemaining: after.after,
        intentId,
    };
}

async function handleRecover(args: z.infer<typeof RecoverSchema>): Promise<object> {
    const { db, characterRepo, assessmentRepo } = ensureDb();
    const intentId = randomUUID();
    const { observerId, via } = args;

    const observer = characterRepo.findById(observerId);
    if (!observer) {
        return {
            disposition: 'reject_inert' as Disposition,
            rejectReason: { rule: 'observer_not_found', explain: 'Observer not found.' },
            intentId,
        };
    }

    // Ensure pool exists if observer is bound; otherwise initialise on first recover.
    const result = refill(observerId, characterRepo);

    const disposition: Disposition = result.mutated ? 'commit' : 'no_op_spoken';

    // Audit row — write even on no-op so rest-manage can trace the call.
    assessmentRepo.create({
        observerId,
        intentId,
        targetRefKind: 'room',
        targetRefId: `recovery_${via}`,
        hazards: [],
        applicableControls: [],
        blindSpots: [],
        disposition,
        rejectReason: null,
        costPaid: 0,
        capacityRemainingAfter: result.after,
    });
    logPerceptionEvent(db, {
        observerId,
        disposition,
        recoveryVia: via,
        before: result.before,
        after: result.after,
    }, intentId);

    return {
        before: result.before,
        after: result.after,
        max: result.max,
        via,
        disposition,
        intentId,
    };
}

async function handleGetCapacity(args: z.infer<typeof GetCapacitySchema>): Promise<object> {
    const { db, characterRepo } = ensureDb();
    const { observerId } = args;

    const observer = characterRepo.findById(observerId);
    if (!observer) {
        return {
            disposition: 'reject_inert' as Disposition,
            rejectReason: { rule: 'observer_not_found', explain: 'Observer not found.' },
        };
    }

    const cap = readCap(observerId, characterRepo);
    const bound = isObserverBound(db, observerId);

    return {
        current: cap?.current ?? 0,
        max: cap?.max ?? 3,
        lastRefilledAt: cap?.lastRefilledAt ?? null,
        observerBoundToSubsystem: bound,
        disposition: 'commit' as Disposition,
    };
}

// ─────────────────────────────────────────────────────────────────
// ROUTER
// ─────────────────────────────────────────────────────────────────

const definitions: Record<PerceptionAction, ActionDefinition> = {
    assess: {
        schema: AssessSchema,
        handler: async (args) => handleAssess(args as z.infer<typeof AssessSchema>),
        aliases: ['look', 'scan', 'examine'],
        description: 'Debit 1 attentional_capacity and scan the target through the Hierarchy of Controls lens',
    },
    list_hazards: {
        schema: ListHazardsSchema,
        handler: async (args) => handleListHazards(args as z.infer<typeof ListHazardsSchema>),
        aliases: ['enumerate', 'list'],
        description: 'Cheap decomposition — list hazards without ranking controls',
    },
    read_hazard: {
        schema: ReadHazardSchema,
        handler: async (args) => handleReadHazard(args as z.infer<typeof ReadHazardSchema>),
        aliases: ['inspect', 'read'],
        description: 'Deep-read one hazard\'s origin and removal options',
    },
    recover: {
        schema: RecoverSchema,
        handler: async (args) => handleRecover(args as z.infer<typeof RecoverSchema>),
        aliases: ['refill', 'rest_hook'],
        description: 'Refill attentional_capacity to max',
    },
    get_capacity: {
        schema: GetCapacitySchema,
        handler: async (args) => handleGetCapacity(args as z.infer<typeof GetCapacitySchema>),
        aliases: ['budget', 'attention'],
        description: 'Read current attentional_capacity without mutation',
    },
};

const router = createActionRouter({ actions: ACTIONS, definitions, threshold: 0.6 });

// ─────────────────────────────────────────────────────────────────
// TOOL EXPORT
// ─────────────────────────────────────────────────────────────────

export const PerceptionManageTool = {
    name: 'perception_manage',
    description: `Operator's constraint-perception lens (Hierarchy of Controls).

The Operator's queryable sight. Every assessment debits 1 attentional_capacity
and returns ranked countermeasures + blind-spots + a disposition stating WHY the
engine answered the way it did. The cost of looking is real even when the
looking returns nothing.

DISPOSITIONS:
- commit:       scanned committed state, here is the ranked answer.
- reject_inert: refused; no cost paid (rule explains why).
- no_op_spoken: attempted but produced nothing usable; cost IS paid.
- unknown:      scanned, but the expected rows are not committed (blind_spots populated).

HIERARCHY (highest first):
1. elimination  - remove the hazard
2. substitution - swap for a smaller hazard
3. engineering  - interpose a barrier
4. administrative - reroute timing or shift
5. ppe          - armor / resistance / protective spells

Actions: assess, list_hazards, read_hazard, recover, get_capacity`,
    actionSchemas: router.actionSchemas,
    inputSchema: z.object({
        action: z.string().describe(`Action: ${ACTIONS.join(', ')}`),
        observerId: z.string().optional(),
        targetRef: z.any().optional(),
        hazardId: z.string().optional(),
        lens: z.enum(['full', 'elimination_only', 'top_n']).optional(),
        topN: z.number().optional(),
        via: z.enum(['long_rest', 'scene_break', 'grant']).optional(),
    }),
};

export async function handlePerceptionManage(args: unknown, _ctx: SessionContext): Promise<McpResponse> {
    return router(args as Record<string, unknown>);
}
