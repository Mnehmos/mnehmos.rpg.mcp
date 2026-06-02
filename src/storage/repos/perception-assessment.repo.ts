/**
 * Perception-Assessment Repository (INSERT-only ledger).
 *
 * Phase-1 wiring of the §10.2 shadow ledger. Every assessment attempt
 * — commit, reject_inert, no_op_spoken, or unknown — writes exactly
 * one row here. No update, no delete. The ledger shape is the rule
 * (per A5): looking is auditable as a real event even when the
 * looking returned nothing.
 *
 * prev_seq points at the previous assessment by the same observer
 * (their personal log of having-looked); event_hash is a content
 * digest so the chain can be replayed and verified.
 */

import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import {
    PerceptionAssessment,
    PerceptionAssessmentSchema,
} from '../../schema/perception.js';

interface AssessmentRow {
    id: string;
    seq: number;
    prev_seq: number | null;
    event_hash: string;
    intent_id: string;
    observer_id: string;
    target_ref_kind: 'room' | 'encounter' | 'scene';
    target_ref_id: string;
    hazards: string;
    applicable_controls: string;
    blind_spots: string;
    disposition: 'commit' | 'reject_inert' | 'no_op_spoken' | 'unknown';
    reject_reason: string | null;
    cost_paid: number;
    capacity_remaining_after: number;
    created_at: string;
}

export type CreateAssessmentInput = Omit<
    PerceptionAssessment,
    'id' | 'seq' | 'prevSeq' | 'eventHash' | 'createdAt'
> & {
    id?: string;
    createdAt?: string;
};

export class PerceptionAssessmentRepository {
    constructor(private db: Database.Database) {}

    /**
     * Insert an assessment row, computing prev_seq from the observer's
     * own history and hashing the payload into event_hash. INSERT-only;
     * the ledger never updates.
     */
    create(input: CreateAssessmentInput): PerceptionAssessment {
        const observerId = input.observerId;

        const prevRow = this.db.prepare(`
            SELECT seq FROM perception_assessments
            WHERE observer_id = ?
            ORDER BY seq DESC LIMIT 1
        `).get(observerId) as { seq: number } | undefined;

        const prevSeq = prevRow ? prevRow.seq : null;
        const seq = (prevSeq ?? 0) + 1;
        const id = input.id ?? `pa_${observerId}_${seq}_${Date.now()}`;
        const createdAt = input.createdAt ?? new Date().toISOString();

        const hashInput = JSON.stringify({
            observerId,
            intentId: input.intentId,
            targetRefKind: input.targetRefKind,
            targetRefId: input.targetRefId,
            disposition: input.disposition,
            hazards: input.hazards,
            applicableControls: input.applicableControls,
            blindSpots: input.blindSpots,
            costPaid: input.costPaid,
            capacityRemainingAfter: input.capacityRemainingAfter,
            prevSeq,
        });
        const eventHash = createHash('sha256').update(hashInput).digest('hex');

        const assessment = PerceptionAssessmentSchema.parse({
            id,
            seq,
            prevSeq,
            eventHash,
            intentId: input.intentId,
            observerId,
            targetRefKind: input.targetRefKind,
            targetRefId: input.targetRefId,
            hazards: input.hazards,
            applicableControls: input.applicableControls,
            blindSpots: input.blindSpots,
            disposition: input.disposition,
            rejectReason: input.rejectReason,
            costPaid: input.costPaid,
            capacityRemainingAfter: input.capacityRemainingAfter,
            createdAt,
        });

        this.db.prepare(`
            INSERT INTO perception_assessments (
                id, seq, prev_seq, event_hash, intent_id, observer_id,
                target_ref_kind, target_ref_id,
                hazards, applicable_controls, blind_spots,
                disposition, reject_reason,
                cost_paid, capacity_remaining_after, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            assessment.id,
            assessment.seq,
            assessment.prevSeq,
            assessment.eventHash,
            assessment.intentId,
            assessment.observerId,
            assessment.targetRefKind,
            assessment.targetRefId,
            JSON.stringify(assessment.hazards),
            JSON.stringify(assessment.applicableControls),
            JSON.stringify(assessment.blindSpots),
            assessment.disposition,
            assessment.rejectReason ? JSON.stringify(assessment.rejectReason) : null,
            assessment.costPaid,
            assessment.capacityRemainingAfter,
            assessment.createdAt,
        );

        return assessment;
    }

    findById(id: string): PerceptionAssessment | null {
        const row = this.db.prepare(
            'SELECT * FROM perception_assessments WHERE id = ?'
        ).get(id) as AssessmentRow | undefined;
        if (!row) return null;
        return this.rowToAssessment(row);
    }

    listByObserver(observerId: string): PerceptionAssessment[] {
        const rows = this.db.prepare(
            'SELECT * FROM perception_assessments WHERE observer_id = ? ORDER BY seq ASC'
        ).all(observerId) as AssessmentRow[];
        return rows.map(r => this.rowToAssessment(r));
    }

    listByTargetRef(kind: 'room' | 'encounter' | 'scene', refId: string): PerceptionAssessment[] {
        const rows = this.db.prepare(
            'SELECT * FROM perception_assessments WHERE target_ref_kind = ? AND target_ref_id = ? ORDER BY seq ASC'
        ).all(kind, refId) as AssessmentRow[];
        return rows.map(r => this.rowToAssessment(r));
    }

    /**
     * Convenience: has this observer ever cached a list_hazards call against
     * this scene? (cheap-decomposition disposition test).
     */
    hasObserverProbedTarget(observerId: string, kind: string, refId: string): boolean {
        const row = this.db.prepare(`
            SELECT COUNT(*) as n FROM perception_assessments
            WHERE observer_id = ? AND target_ref_kind = ? AND target_ref_id = ?
        `).get(observerId, kind, refId) as { n: number };
        return row.n > 0;
    }

    private rowToAssessment(row: AssessmentRow): PerceptionAssessment {
        return PerceptionAssessmentSchema.parse({
            id: row.id,
            seq: row.seq,
            prevSeq: row.prev_seq,
            eventHash: row.event_hash,
            intentId: row.intent_id,
            observerId: row.observer_id,
            targetRefKind: row.target_ref_kind,
            targetRefId: row.target_ref_id,
            hazards: JSON.parse(row.hazards),
            applicableControls: JSON.parse(row.applicable_controls),
            blindSpots: JSON.parse(row.blind_spots),
            disposition: row.disposition,
            rejectReason: row.reject_reason ? JSON.parse(row.reject_reason) : null,
            costPaid: row.cost_paid,
            capacityRemainingAfter: row.capacity_remaining_after,
            createdAt: row.created_at,
        });
    }
}
