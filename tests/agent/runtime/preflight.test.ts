import { preflight } from '../../../src/agent/runtime/preflight';
import { Agent } from '../../../src/schema/agent';
import { Character } from '../../../src/schema/character';
import { FIXED_TIMESTAMP } from '../../fixtures.js';

function makeAgent(overrides: Partial<Agent> = {}): Agent {
    return {
        id: 'agent-1',
        characterId: 'char-1',
        provider: 'openai',
        model: 'gpt-4o-mini',
        status: 'active',
        autoOnTurn: false,
        autoOnLegendary: false,
        temperature: 0.7,
        maxTokens: 800,
        budgetTokens: null,
        tokensUsed: 0,
        timeoutMs: 25000,
        consecutiveFailures: 0,
        circuitState: 'closed',
        createdAt: FIXED_TIMESTAMP,
        updatedAt: FIXED_TIMESTAMP,
        ...overrides
    };
}

function makeChar(overrides: Partial<Character> = {}): Character {
    return {
        id: 'char-1',
        name: 'Kara',
        stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
        hp: 20,
        maxHp: 20,
        ac: 15,
        level: 1,
        characterType: 'pc',
        createdAt: FIXED_TIMESTAMP,
        updatedAt: FIXED_TIMESTAMP,
        ...overrides
    } as Character;
}

describe('preflight', () => {
    it('passes for a healthy active agent + character', () => {
        const result = preflight({ agent: makeAgent(), character: makeChar() });
        expect(result.skipped).toBe(false);
    });

    it('skips when agent is paused', () => {
        const result = preflight({ agent: makeAgent({ status: 'paused' }), character: makeChar() });
        expect(result.skipped).toBe(true);
        if (result.skipped) {
            expect(result.status).toBe('paused');
            expect(result.reason).toBe('agent_paused');
        }
    });

    it('skips when agent is retired', () => {
        const result = preflight({ agent: makeAgent({ status: 'retired' }), character: makeChar() });
        expect(result.skipped).toBe(true);
        if (result.skipped) expect(result.reason).toBe('agent_retired');
    });

    it('skips when circuit is open', () => {
        const result = preflight({ agent: makeAgent({ circuitState: 'open' }), character: makeChar() });
        expect(result.skipped).toBe(true);
        if (result.skipped) expect(result.status).toBe('circuit_open');
    });

    it('passes when circuit is half_open (probe attempt)', () => {
        const result = preflight({ agent: makeAgent({ circuitState: 'half_open' }), character: makeChar() });
        expect(result.skipped).toBe(false);
    });

    it('skips when budget is exhausted', () => {
        const result = preflight({
            agent: makeAgent({ budgetTokens: 1000, tokensUsed: 1000 }),
            character: makeChar()
        });
        expect(result.skipped).toBe(true);
        if (result.skipped) {
            expect(result.status).toBe('budget_exhausted');
            expect(result.reason).toContain('1000');
        }
    });

    it('skips when budget is exceeded (off-by-one safety)', () => {
        const result = preflight({
            agent: makeAgent({ budgetTokens: 1000, tokensUsed: 1500 }),
            character: makeChar()
        });
        expect(result.skipped).toBe(true);
    });

    it('passes when budget is null (unlimited)', () => {
        const result = preflight({
            agent: makeAgent({ budgetTokens: null, tokensUsed: 9999 }),
            character: makeChar()
        });
        expect(result.skipped).toBe(false);
    });

    it('skips when character not found', () => {
        const result = preflight({ agent: makeAgent(), character: null });
        expect(result.skipped).toBe(true);
        if (result.skipped) expect(result.reason).toBe('character_not_found');
    });

    it('skips when character HP is 0', () => {
        const result = preflight({ agent: makeAgent(), character: makeChar({ hp: 0 }) });
        expect(result.skipped).toBe(true);
        if (result.skipped) {
            expect(result.status).toBe('incapable');
            expect(result.reason).toBe('incapacitated:hp_zero');
        }
    });

    it.each(['unconscious', 'paralyzed', 'stunned', 'petrified', 'asleep', 'incapacitated', 'dying', 'dead'])(
        'skips when character has condition: %s',
        (cond) => {
            const result = preflight({
                agent: makeAgent(),
                character: makeChar({ conditions: [{ name: cond }] })
            });
            expect(result.skipped).toBe(true);
            if (result.skipped) {
                expect(result.status).toBe('incapable');
                expect(result.reason).toContain(cond);
            }
        }
    );

    it('passes through harmless conditions (poisoned, prone, frightened)', () => {
        const result = preflight({
            agent: makeAgent(),
            character: makeChar({ conditions: [{ name: 'Poisoned' }, { name: 'Prone' }] })
        });
        expect(result.skipped).toBe(false);
    });

    it('preflight ordering: paused beats circuit_open beats budget beats incapable', () => {
        // All bad — should report 'paused' (first check)
        const result = preflight({
            agent: makeAgent({
                status: 'paused',
                circuitState: 'open',
                budgetTokens: 100,
                tokensUsed: 200
            }),
            character: makeChar({ hp: 0 })
        });
        expect(result.skipped).toBe(true);
        if (result.skipped) expect(result.status).toBe('paused');
    });
});
