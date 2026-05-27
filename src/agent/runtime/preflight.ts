/**
 * Preflight gates — decide whether to invoke the LLM at all.
 *
 * These checks run BEFORE prompt composition (and before any token spend).
 * Each gate either passes or returns a synthetic "skip" result that the
 * runtime returns directly without calling the provider.
 */

import { Agent } from '../../schema/agent.js';
import { Character, NPC } from '../../schema/character.js';
import { AgentCallStatus } from '../../schema/agent.js';

/** Conditions that should prevent the agent from acting. */
const INCAPACITATING_CONDITIONS = new Set([
    'unconscious', 'paralyzed', 'stunned', 'petrified', 'asleep',
    'incapacitated', 'dying', 'dead'
]);

export interface PreflightSkip {
    skipped: true;
    status: AgentCallStatus;
    reason: string;
}

export interface PreflightPass {
    skipped: false;
}

export type PreflightResult = PreflightSkip | PreflightPass;

/**
 * Run all preflight gates in order. Returns either `{ skipped: false }` (proceed)
 * or `{ skipped: true, status, reason }` (return synthetic result, no LLM call).
 *
 * Order matters: cheapest checks first.
 */
export function preflight(input: {
    agent: Agent;
    character: Character | NPC | null;
}): PreflightResult {
    const { agent, character } = input;

    // 1. Paused agent — explicit DM hold.
    if (agent.status === 'paused') {
        return { skipped: true, status: 'paused', reason: 'agent_paused' };
    }
    if (agent.status === 'retired') {
        return { skipped: true, status: 'paused', reason: 'agent_retired' };
    }

    // 2. Circuit breaker open — too many recent failures.
    if (agent.circuitState === 'open') {
        return { skipped: true, status: 'circuit_open', reason: 'circuit_open_after_failures' };
    }

    // 3. Budget exhausted — DM must top up.
    if (agent.budgetTokens !== null && agent.tokensUsed >= agent.budgetTokens) {
        return {
            skipped: true,
            status: 'budget_exhausted',
            reason: `budget_exhausted (used ${agent.tokensUsed} of ${agent.budgetTokens})`
        };
    }

    // 4. Character is incapacitated — no point burning tokens.
    if (!character) {
        return { skipped: true, status: 'incapable', reason: 'character_not_found' };
    }
    if (character.hp <= 0) {
        return { skipped: true, status: 'incapable', reason: 'incapacitated:hp_zero' };
    }
    if (character.conditions) {
        for (const cond of character.conditions) {
            if (INCAPACITATING_CONDITIONS.has(cond.name.toLowerCase())) {
                return { skipped: true, status: 'incapable', reason: `incapacitated:${cond.name.toLowerCase()}` };
            }
        }
    }

    return { skipped: false };
}
