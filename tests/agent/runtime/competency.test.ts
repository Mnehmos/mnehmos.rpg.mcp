import { readFileSync } from 'fs';
import { resolve } from 'path';
import { resolveCompetency, loadCompetencyLadder } from '../../../src/agent/runtime/competency';

describe('competency mapping', () => {
    it('loads the canonical INT ladder from content config', () => {
        const ladder = loadCompetencyLadder();
        expect(ladder).toHaveLength(20);
        expect(ladder[0].int).toBe(1);
        expect(ladder[19].int).toBe(20);
    });

    it('maps every INT score to the canon model and reasoning effort', () => {
        const expected = [
            [1, 'babbage-002', null],
            [2, 'babbage-002', null],
            [3, 'davinci-002', null],
            [4, 'gpt-4', null],
            [5, 'gpt-oss-20b', null],
            [6, 'gpt-oss-20b', null],
            [7, 'gpt-4o-mini', null],
            [8, 'gpt-oss-120b', null],
            [9, 'gpt-4.1-mini', null],
            [10, 'gpt-4.1', null],
            [11, 'o3', 'medium'],
            [12, 'o3', 'high'],
            [13, 'gpt-5-nano', 'medium'],
            [14, 'gpt-5-mini', 'high'],
            [15, 'gpt-5.4-nano', 'medium'],
            [16, 'gpt-5.4-mini', 'high'],
            [17, 'gpt-5.4', 'medium'],
            [18, 'gpt-5.4', 'high'],
            [19, 'gpt-5.5', 'high'],
            [20, 'gpt-5.5', 'xhigh']
        ] as const;

        for (const [intStat, model, reasoningEffort] of expected) {
            expect(resolveCompetency(intStat)).toMatchObject({
                int: intStat,
                model,
                reasoningEffort,
                source: 'stat_derived'
            });
        }
    });

    it('rejects pro model variants in the ladder file', () => {
        const raw = readFileSync(resolve('config/competency-ladder.json'), 'utf8');
        expect(raw.toLowerCase()).not.toMatch(/-pro\b/);
    });

    it('clamps out-of-range INT to the nearest canonical rung', () => {
        expect(resolveCompetency(0).int).toBe(1);
        expect(resolveCompetency(30).int).toBe(20);
    });

    it('applies partial overrides and records override source', () => {
        expect(resolveCompetency(10, { reasoningEffort: 'high' })).toMatchObject({
            model: 'gpt-4.1',
            reasoningEffort: 'high',
            source: 'override'
        });
        expect(resolveCompetency(10, { model: 'gpt-5.5' })).toMatchObject({
            model: 'gpt-5.5',
            reasoningEffort: null,
            source: 'override'
        });
    });

    it('rejects pro model variants in overrides', () => {
        expect(() => resolveCompetency(20, { model: 'gpt-5.5-pro' })).toThrow(/pro/i);
    });
});
