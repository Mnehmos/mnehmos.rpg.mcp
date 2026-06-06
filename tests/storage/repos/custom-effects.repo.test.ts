/**
 * Regression tests for CustomEffectsRepository.
 *
 * Pins the "poisoned row" bug: a stored effect row whose mechanics fail
 * CustomEffectSchema.parse (e.g. a legacy/invalid mechanic type written before input
 * validation tightened) used to make its (target, name) un-reusable forever — every
 * later apply() re-parsed the bad row and re-threw the stored error verbatim, regardless
 * of the new payload. apply() must now self-heal (drop the corrupt row) and write clean.
 */

import { getDb, closeDb } from '../../../src/storage/index.js';
import { CustomEffectsRepository } from '../../../src/storage/repos/custom-effects.repo.js';
import type { ApplyCustomEffectArgs } from '../../../src/schema/improvisation.js';

process.env.NODE_ENV = 'test';

const TARGET = 'char_test';

function validArgs(name: string, mechType = 'attack_bonus'): ApplyCustomEffectArgs {
    return {
        target_id: TARGET,
        target_type: 'character',
        name,
        description: 'top-level flavor text',
        source: { type: 'divine' },
        category: 'boon',
        power_level: 2,
        mechanics: [{ type: mechType as any, value: 2, condition: 'melee' }],
        duration: { type: 'until_removed' },
        triggers: [{ event: 'always_active' }],
        removal_conditions: [{ type: 'duration_expires' }],
        stackable: false,
        max_stacks: 1
    };
}

/** Write a row directly with an INVALID mechanic type, bypassing apply()'s validation. */
function insertPoisonedRow(db: any, name: string) {
    db.prepare(`
        INSERT INTO custom_effects (
            target_id, target_type, name, description,
            source_type, source_entity_id, source_entity_name,
            category, power_level, mechanics,
            duration_type, duration_value, rounds_remaining,
            triggers, removal_conditions,
            stackable, max_stacks, current_stacks,
            is_active, created_at, expires_at
        ) VALUES (
            @targetId, @targetType, @name, @description,
            @sourceType, NULL, NULL,
            @category, @powerLevel, @mechanics,
            'until_removed', NULL, NULL,
            '[]', '[]',
            0, 1, 1,
            1, @now, NULL
        )
    `).run({
        targetId: TARGET,
        targetType: 'character',
        name,
        description: 'poisoned',
        sourceType: 'unknown',
        category: 'boon',
        powerLevel: 1,
        // "modifier" is NOT a member of MechanicTypeSchema — this is the poison.
        mechanics: JSON.stringify([{ type: 'modifier', value: 1 }]),
        now: new Date().toISOString()
    });
}

describe('CustomEffectsRepository — poisoned row recovery', () => {
    let repo: CustomEffectsRepository;
    let db: any;

    beforeEach(() => {
        closeDb();
        db = getDb(':memory:');
        repo = new CustomEffectsRepository(db);
    });

    it('self-heals: a valid apply() over a corrupt same-name row succeeds instead of re-throwing', () => {
        insertPoisonedRow(db, "Brawler's Fists");

        // Before the fix this threw `received "modifier" at mechanics.0.type` — the stored
        // poison, parsed fresh, masquerading as a validation error against the new payload.
        const effect = repo.apply(validArgs("Brawler's Fists"));

        expect(effect.name).toBe("Brawler's Fists");
        expect(effect.is_active).toBe(true);
        expect(effect.mechanics[0].type).toBe('attack_bonus'); // the clean replacement
    });

    it('leaves exactly one active row for the name after self-heal (poison replaced, not duplicated)', () => {
        insertPoisonedRow(db, "Brawler's Fists");
        repo.apply(validArgs("Brawler's Fists"));

        const rows = db.prepare(
            'SELECT COUNT(*) AS n FROM custom_effects WHERE target_id = ? AND name = ? AND is_active = 1'
        ).get(TARGET, "Brawler's Fists") as { n: number };
        expect(rows.n).toBe(1);
    });

    it('a fresh name is unaffected (control)', () => {
        const effect = repo.apply(validArgs('Hard to Put Down'));
        expect(effect.name).toBe('Hard to Put Down');
        expect(effect.is_active).toBe(true);
    });

    it('refreshes (does not duplicate) when a valid same-name effect already exists', () => {
        const first = repo.apply(validArgs('Forge Blessing'));
        const second = repo.apply(validArgs('Forge Blessing'));
        expect(second.id).toBe(first.id); // non-stackable refresh path, still intact
    });
});
