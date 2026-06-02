/**
 * Constraint-Perception subsystem schemas.
 *
 * Layer-1 SubsystemDef artifact for the Operator's lens — the
 * Hierarchy-of-Controls model wired into the engine as a queryable
 * primitive. The Operator does not get to know everything; the cost
 * of looking is real, and the looking can fail in disciplined ways.
 *
 * Four dispositions encode the entire failure surface:
 *   commit       — wrote rows, mutated state, honest answer.
 *   reject_inert — refused before mutation; no cost paid.
 *   no_op_spoken — attempted, but the looking returned nothing usable
 *                  OR was interrupted. Cost IS paid (non-refundable).
 *   unknown      — the engine cannot answer because the underlying
 *                  rows are not committed. Mute, never invent.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────
// Hierarchy of Controls (mining safety canonical ranking)
// ─────────────────────────────────────────────────────────────────

export const HierarchyOfControlsLevelSchema = z.enum([
    'elimination',
    'substitution',
    'engineering',
    'administrative',
    'ppe',
]);
export type HierarchyOfControlsLevel = z.infer<typeof HierarchyOfControlsLevelSchema>;

// ─────────────────────────────────────────────────────────────────
// Disposition — the four colours of an engine answer
// ─────────────────────────────────────────────────────────────────

export const DispositionSchema = z.enum([
    'commit',
    'reject_inert',
    'no_op_spoken',
    'unknown',
]);
export type Disposition = z.infer<typeof DispositionSchema>;

// ─────────────────────────────────────────────────────────────────
// Source evidence — every hazard must trace to a committed row
// ─────────────────────────────────────────────────────────────────

export const SourceEvidenceSchema = z.object({
    tool: z.string().describe('Tool name that committed the source row'),
    rowId: z.string().describe('Row identifier in the source table'),
    committedAt: z.string().describe('ISO timestamp of when the row was committed'),
});
export type SourceEvidence = z.infer<typeof SourceEvidenceSchema>;

// ─────────────────────────────────────────────────────────────────
// Hazard — something in the room/encounter/scene that could hurt
// ─────────────────────────────────────────────────────────────────

export const HazardKindSchema = z.enum([
    'mechanical',
    'environmental',
    'creature',
    'social',
]);
export type HazardKind = z.infer<typeof HazardKindSchema>;

export const HazardSeveritySchema = z.enum([
    'mild',
    'moderate',
    'severe',
    'lethal',
]);
export type HazardSeverity = z.infer<typeof HazardSeveritySchema>;

export const HazardSchema = z.object({
    id: z.string(),
    name: z.string(),
    kind: HazardKindSchema,
    sourceEvidence: SourceEvidenceSchema,
    severity: HazardSeveritySchema,
});
export type Hazard = z.infer<typeof HazardSchema>;

// ─────────────────────────────────────────────────────────────────
// Applicable control — the ranked countermeasure
// ─────────────────────────────────────────────────────────────────

export const ConfidenceSchema = z.enum(['high', 'partial', 'low']);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const ApplicableControlSchema = z.object({
    rank: z.number().int().min(1),
    level: HierarchyOfControlsLevelSchema,
    countermeasureSummary: z.string(),
    requires: z.array(z.string()).default([]),
    blockedBy: z.array(z.string()).default([]),
    confidence: ConfidenceSchema,
    missingDataForHigherLevel: z.string().optional(),
});
export type ApplicableControl = z.infer<typeof ApplicableControlSchema>;

// ─────────────────────────────────────────────────────────────────
// Blind spot — the §3.5 fog-as-information thesis encoded
// ─────────────────────────────────────────────────────────────────

export const BlindSpotSchema = z.object({
    whatKindOfDataIsMissing: z.string(),
    whyItMatters: z.string(),
    suggestedQuery: z.string(),
});
export type BlindSpot = z.infer<typeof BlindSpotSchema>;

// ─────────────────────────────────────────────────────────────────
// Attentional capacity — the resource the Operator spends to look
// ─────────────────────────────────────────────────────────────────

export const AttentionalCapacitySchema = z.object({
    current: z.number().int().min(0),
    max: z.number().int().min(0),
    lastRefilledAt: z.string().optional(),
});
export type AttentionalCapacity = z.infer<typeof AttentionalCapacitySchema>;

// ─────────────────────────────────────────────────────────────────
// Perception assessment — the ledger row
// ─────────────────────────────────────────────────────────────────

export const RejectReasonSchema = z.object({
    rule: z.string(),
    explain: z.string(),
});
export type RejectReason = z.infer<typeof RejectReasonSchema>;

export const TargetRefSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('room'), roomId: z.string() }),
    z.object({ kind: z.literal('encounter'), encounterId: z.string() }),
    z.object({ kind: z.literal('scene'), sceneNarrativeNoteId: z.string() }),
]);
export type TargetRef = z.infer<typeof TargetRefSchema>;

export const PerceptionAssessmentSchema = z.object({
    id: z.string(),
    seq: z.number().int().min(0),
    prevSeq: z.number().int().min(0).nullable(),
    eventHash: z.string(),
    intentId: z.string(),
    observerId: z.string(),
    targetRefKind: z.enum(['room', 'encounter', 'scene']),
    targetRefId: z.string(),
    hazards: z.array(HazardSchema),
    applicableControls: z.array(ApplicableControlSchema),
    blindSpots: z.array(BlindSpotSchema),
    disposition: DispositionSchema,
    rejectReason: RejectReasonSchema.nullable(),
    costPaid: z.number().int().min(0),
    capacityRemainingAfter: z.number().int().min(0),
    createdAt: z.string(),
});
export type PerceptionAssessment = z.infer<typeof PerceptionAssessmentSchema>;
