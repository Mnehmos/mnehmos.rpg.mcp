/**
 * Persona slice — the DM-authored identity / voice of the character.
 * Reads from agent_prompt_slices kind='persona'.
 */

import { AgentRepository } from '../../../storage/repos/agent.repo.js';

const HEADER = '--- YOU ---';

export function buildPersonaSlice(agentId: string, repo: AgentRepository): string | null {
    const slices = repo.listSlices(agentId, { enabled: true, kind: 'persona' });
    if (slices.length === 0) return null;

    const body = slices.map(s => s.content.trim()).filter(Boolean).join('\n\n');
    if (!body) return null;

    return `${HEADER}\n${body}`;
}
