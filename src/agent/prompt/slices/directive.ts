/**
 * Directive slice — DM-authored behavioral instructions for this campaign.
 * Reads from agent_prompt_slices kind='directive'.
 */

import { AgentRepository } from '../../../storage/repos/agent.repo.js';

const HEADER = '--- YOUR DIRECTIVES ---';

export function buildDirectiveSlice(agentId: string, repo: AgentRepository): string | null {
    const slices = repo.listSlices(agentId, { enabled: true, kind: 'directive' });
    if (slices.length === 0) return null;

    const body = slices.map(s => s.content.trim()).filter(Boolean).join('\n\n');
    if (!body) return null;

    return `${HEADER}\n${body}`;
}
