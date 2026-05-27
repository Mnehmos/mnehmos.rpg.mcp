/**
 * Secrets slice — agent-private knowledge.
 *
 * Reads from agent_secrets table (NOT from narrative_notes / npc_voice — those are
 * DM-reference notes; agent_secrets is what the LLM itself is told it knows).
 */

import { AgentRepository } from '../../../storage/repos/agent.repo.js';

const HEADER = '--- YOUR PRIVATE KNOWLEDGE ---';

const IMPORTANCE_ORDER = ['critical', 'high', 'medium', 'low'] as const;

export function buildSecretsSlice(agentId: string, repo: AgentRepository): string | null {
    const secrets = repo.listSecrets(agentId);
    if (secrets.length === 0) return null;

    // Sort: critical → low, then by insertion order
    const sorted = [...secrets].sort((a, b) => {
        const ai = a.importance ? IMPORTANCE_ORDER.indexOf(a.importance) : IMPORTANCE_ORDER.length;
        const bi = b.importance ? IMPORTANCE_ORDER.indexOf(b.importance) : IMPORTANCE_ORDER.length;
        if (ai !== bi) return ai - bi;
        return a.createdAt.localeCompare(b.createdAt);
    });

    const body = sorted.map(s => {
        const tag = s.importance ? `[${s.importance.toUpperCase()}] ` : '';
        return `- ${tag}${s.content}`;
    }).join('\n');

    return `${HEADER}\n${body}`;
}
