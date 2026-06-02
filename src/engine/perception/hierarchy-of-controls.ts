/**
 * Hierarchy-of-Controls ranker.
 *
 * Mining-safety canonical ordering of countermeasures, applied to the
 * scanned hazard list. Higher tiers are preferred; if a higher-tier
 * control's prerequisites are not in committed state, the rank DROPS
 * to the next tier and the lens reports confidence='partial' with
 * missing_data_for_higher_level populated.
 *
 * The engine refuses to recommend elimination when elimination's
 * prerequisites are not queryable — that is what makes the Operator
 * trustworthy even when he is wrong.
 *
 *   1. Elimination    — remove the hazard. Requires committed "removable" state
 *                       (a door for the monster, a kill-switch for the belt).
 *   2. Substitution   — swap a smaller hazard for the larger.
 *   3. Engineering    — place a barrier (committed wall, cover, ventilation).
 *   4. Administrative — change the timing or assignment (rest, reroute).
 *   5. PPE            — armor up; always available, the floor of the ranking.
 */

import {
    ApplicableControl,
    Hazard,
    HierarchyOfControlsLevel,
} from '../../schema/perception.js';

export interface CommittedState {
    /** Room exits known? Affects elimination/engineering. */
    roomExitsCommitted: boolean;
    /** Room entities known? Affects substitution. */
    roomEntitiesCommitted: boolean;
    /** Combat grid bounds known? Affects engineering. */
    encounterGridCommitted: boolean;
    /** Any narrative description? Affects administrative tier. */
    sceneDescribed: boolean;
    /** Target kind (room | encounter | scene) for tier eligibility. */
    targetKind: 'room' | 'encounter' | 'scene';
}

const LEVEL_PRIORITY: HierarchyOfControlsLevel[] = [
    'elimination',
    'substitution',
    'engineering',
    'administrative',
    'ppe',
];

interface TierEvaluation {
    level: HierarchyOfControlsLevel;
    summary: string;
    requires: string[];
    confidence: 'high' | 'partial' | 'low';
    missingDataForHigherLevel?: string;
}

/**
 * Evaluate whether the elimination tier is queryable for a hazard.
 */
function evalElimination(hazard: Hazard, state: CommittedState): TierEvaluation | null {
    if (hazard.kind === 'creature') {
        if (state.targetKind === 'room') {
            if (!state.roomExitsCommitted) {
                return null; // Drop — exits unknown.
            }
            return {
                level: 'elimination',
                summary: `Isolate ${hazard.name} by closing the committed exit, then withdraw.`,
                requires: ['known_exit', 'movement'],
                confidence: 'high',
            };
        }
        if (state.targetKind === 'encounter') {
            if (!state.encounterGridCommitted) return null;
            return {
                level: 'elimination',
                summary: `Engage ${hazard.name} to reduce it to 0 HP — combat geometry is known.`,
                requires: ['grid_bounds', 'initiative'],
                confidence: 'high',
            };
        }
        return null;
    }

    if (hazard.kind === 'environmental') {
        // Stopping environmental hazards at source — e.g. dispel antimagic.
        if (hazard.name.includes('Antimagic') || hazard.name.includes('Magical')) {
            return {
                level: 'elimination',
                summary: `Identify and dispel the source of ${hazard.name}.`,
                requires: ['identify_source_row'],
                confidence: 'partial',
                missingDataForHigherLevel:
                    'source_row_for_environmental_hazard_not_committed; commit via narrative_manage.add canonical_moment with placed_by metadata',
            };
        }
        return null;
    }

    return null;
}

function evalSubstitution(hazard: Hazard, state: CommittedState): TierEvaluation | null {
    if (hazard.kind === 'creature' && state.roomEntitiesCommitted) {
        return {
            level: 'substitution',
            summary: `Lure ${hazard.name} into engaging a lesser adversary instead of the party.`,
            requires: ['committed_lesser_entity'],
            confidence: 'partial',
        };
    }
    return null;
}

function evalEngineering(hazard: Hazard, state: CommittedState): TierEvaluation | null {
    if (state.targetKind === 'encounter' && state.encounterGridCommitted) {
        return {
            level: 'engineering',
            summary: `Interpose cover or terrain between the party and ${hazard.name}.`,
            requires: ['grid_bounds', 'cover_terrain'],
            confidence: 'high',
        };
    }
    if (state.targetKind === 'room' && state.roomExitsCommitted) {
        return {
            level: 'engineering',
            summary: `Use a committed door or wall to break line-of-sight to ${hazard.name}.`,
            requires: ['known_exit'],
            confidence: 'partial',
        };
    }
    return null;
}

function evalAdministrative(hazard: Hazard, state: CommittedState): TierEvaluation | null {
    return {
        level: 'administrative',
        summary: `Withdraw, rest, and re-approach ${hazard.name} when the party is ready.`,
        requires: [],
        confidence: state.sceneDescribed ? 'high' : 'partial',
        missingDataForHigherLevel: !state.roomExitsCommitted
            ? 'room_exits_not_committed; assess again after spatial_manage.get_exits commits this room\'s adjacencies'
            : undefined,
    };
}

function evalPPE(hazard: Hazard): TierEvaluation {
    return {
        level: 'ppe',
        summary: `Equip armor, resistance items, and prepare protective spells against ${hazard.name}.`,
        requires: ['inventory_access'],
        confidence: 'high',
    };
}

/**
 * Rank applicable controls for a single hazard, dropping tiers whose
 * prerequisites are not in committed state.
 */
function rankForHazard(hazard: Hazard, state: CommittedState): ApplicableControl[] {
    const evaluators = [
        () => evalElimination(hazard, state),
        () => evalSubstitution(hazard, state),
        () => evalEngineering(hazard, state),
        () => evalAdministrative(hazard, state),
        () => evalPPE(hazard),
    ];

    // First pass: collect what was accepted vs skipped at each tier
    type Step = { skippedLevel?: HierarchyOfControlsLevel; ev?: TierEvaluation };
    const steps: Step[] = evaluators.map((evalFn, i) => {
        const ev = evalFn();
        return ev ? { ev } : { skippedLevel: LEVEL_PRIORITY[i] };
    });

    const firstAcceptedIdx = steps.findIndex(s => !!s.ev);

    // The only skip that downgrades confidence is one ABOVE the first accepted
    // tier — that's the case where a higher control was queryable in principle
    // but its prerequisites were not committed. Lower-tier skips are routine.
    let highestMissing: string | undefined;
    if (firstAcceptedIdx > 0) {
        const skippedLevel = steps[0].skippedLevel;
        if (skippedLevel === 'elimination' && state.targetKind === 'room' && !state.roomExitsCommitted) {
            highestMissing = 'room_exits_not_committed; assess again after spatial_manage.get_exits commits this room\'s adjacencies';
        } else if (skippedLevel === 'elimination' && state.targetKind === 'encounter' && !state.encounterGridCommitted) {
            highestMissing = 'encounter_grid_not_committed; assess again after combat_map.set_grid_bounds';
        } else if (skippedLevel === 'elimination') {
            highestMissing = 'elimination_prerequisites_not_committed; commit hazard source row metadata';
        }
    }

    const accepted: TierEvaluation[] = steps
        .map(s => s.ev)
        .filter((ev): ev is TierEvaluation => !!ev);

    // Promote missing-data note onto the highest accepted control.
    if (highestMissing && accepted.length > 0 && !accepted[0].missingDataForHigherLevel) {
        accepted[0].missingDataForHigherLevel = highestMissing;
        if (accepted[0].confidence === 'high') {
            accepted[0].confidence = 'partial';
        }
    }

    return accepted.map((ev, idx) => ({
        rank: idx + 1,
        level: ev.level,
        countermeasureSummary: ev.summary,
        requires: ev.requires,
        blockedBy: [],
        confidence: ev.confidence,
        missingDataForHigherLevel: ev.missingDataForHigherLevel,
    }));
}

/**
 * Rank controls across all hazards. The aggregate is the per-hazard
 * ranking with the highest-priority control surfaced first; rank 1 is
 * the top recommendation overall.
 */
export function rankControls(
    hazards: Hazard[],
    state: CommittedState,
): ApplicableControl[] {
    if (hazards.length === 0) return [];

    // Take the highest-severity hazard and rank against it; that's the
    // top-of-list control. Subsequent ranks come from remaining hazards.
    const severityOrder: Record<Hazard['severity'], number> = {
        lethal: 4, severe: 3, moderate: 2, mild: 1,
    };
    const sorted = [...hazards].sort(
        (a, b) => severityOrder[b.severity] - severityOrder[a.severity],
    );

    const merged: ApplicableControl[] = [];
    const seen = new Set<HierarchyOfControlsLevel>();
    for (const h of sorted) {
        const ranked = rankForHazard(h, state);
        for (const r of ranked) {
            if (!seen.has(r.level)) {
                merged.push({ ...r, rank: merged.length + 1 });
                seen.add(r.level);
            }
        }
    }
    return merged;
}
