/**
 * Pure-function tests for the Hierarchy-of-Controls ranker.
 *
 * Canonical mining-safety scenarios + wrong-level-call regression
 * (engine refuses to recommend elimination when prerequisites are
 * not in committed state).
 */

import { rankControls, CommittedState } from '../../../src/engine/perception/hierarchy-of-controls.js';
import { Hazard } from '../../../src/schema/perception.js';

function makeHazard(overrides: Partial<Hazard> = {}): Hazard {
    return {
        id: 'h1',
        name: 'Ore Cart',
        kind: 'creature',
        severity: 'severe',
        sourceEvidence: {
            tool: 'npc_manage',
            rowId: 'r1',
            committedAt: new Date().toISOString(),
        },
        ...overrides,
    };
}

describe('hierarchy-of-controls / rankControls', () => {
    it('returns empty array when no hazards', () => {
        const state: CommittedState = {
            roomExitsCommitted: true,
            roomEntitiesCommitted: true,
            encounterGridCommitted: false,
            sceneDescribed: true,
            targetKind: 'room',
        };
        expect(rankControls([], state)).toEqual([]);
    });

    it('promotes elimination when exits are committed', () => {
        const hazard = makeHazard();
        const state: CommittedState = {
            roomExitsCommitted: true,
            roomEntitiesCommitted: false,
            encounterGridCommitted: false,
            sceneDescribed: true,
            targetKind: 'room',
        };
        const controls = rankControls([hazard], state);
        expect(controls[0].level).toBe('elimination');
        expect(controls[0].confidence).toBe('high');
    });

    it('refuses elimination when room exits NOT committed; drops with partial confidence', () => {
        const hazard = makeHazard();
        const state: CommittedState = {
            roomExitsCommitted: false,        // <-- the missing prerequisite
            roomEntitiesCommitted: false,
            encounterGridCommitted: false,
            sceneDescribed: true,
            targetKind: 'room',
        };
        const controls = rankControls([hazard], state);
        expect(controls[0].level).not.toBe('elimination');
        // The top-ranked control should carry a partial confidence + missing-data hint
        const partialOrLowerHints = controls.find(c => c.missingDataForHigherLevel);
        expect(partialOrLowerHints).toBeTruthy();
        expect(partialOrLowerHints?.missingDataForHigherLevel).toContain('room_exits_not_committed');
    });

    it('ranks the highest-severity hazard first in the merged list', () => {
        const lethal = makeHazard({ id: 'h_lethal', severity: 'lethal', name: 'Dragon' });
        const mild = makeHazard({ id: 'h_mild', severity: 'mild', name: 'Rat' });
        const state: CommittedState = {
            roomExitsCommitted: true,
            roomEntitiesCommitted: true,
            encounterGridCommitted: false,
            sceneDescribed: true,
            targetKind: 'room',
        };
        const controls = rankControls([mild, lethal], state);
        // Top control should be derived from the lethal hazard
        expect(controls[0].countermeasureSummary).toContain('Dragon');
    });

    it('always provides PPE as the floor of the ranking', () => {
        const hazard = makeHazard();
        const state: CommittedState = {
            roomExitsCommitted: false,
            roomEntitiesCommitted: false,
            encounterGridCommitted: false,
            sceneDescribed: false,
            targetKind: 'room',
        };
        const controls = rankControls([hazard], state);
        const ppe = controls.find(c => c.level === 'ppe');
        expect(ppe).toBeTruthy();
    });
});
