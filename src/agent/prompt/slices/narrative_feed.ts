/**
 * Narrative feed slice — DM-curated rolling buffer of observations.
 *
 * Each `agent_manage narrate` / `broadcast` call appends a row with a
 * timestamp label. At compose time we take the most recent N entries
 * (trim by count or token budget, whichever hits first).
 */

import { AgentRepository } from '../../../storage/repos/agent.repo.js';

const HEADER = '--- RECENT OBSERVATIONS (TOLD TO YOU) ---';

const DEFAULT_MAX_ENTRIES = 12;
const DEFAULT_MAX_CHARS = 4500; // ~1500 tokens at 3 chars/token rough

export interface NarrativeFeedOptions {
    maxEntries?: number;
    maxChars?: number;
}

export function buildNarrativeFeedSlice(
    agentId: string,
    repo: AgentRepository,
    options: NarrativeFeedOptions = {}
): string | null {
    const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;

    // listSlices is ordered by order_index ASC; we want newest-first for trimming
    // then re-order chronologically (oldest → newest) for the prompt.
    const all = repo.listSlices(agentId, { enabled: true, kind: 'narrative_feed' });
    if (all.length === 0) return null;

    // Sort newest-first by label (timestamp) or order_index as fallback
    const sortedNewestFirst = [...all].sort((a, b) => {
        const aLabel = a.label ?? '';
        const bLabel = b.label ?? '';
        if (aLabel && bLabel) return bLabel.localeCompare(aLabel);
        return b.orderIndex - a.orderIndex;
    });

    // Trim by entry count
    const candidates = sortedNewestFirst.slice(0, maxEntries);

    // Trim further by char budget (newest entries win on ties)
    const kept: typeof candidates = [];
    let chars = 0;
    for (const slice of candidates) {
        const lineLen = slice.content.length + 4; // bullet + newline margin
        if (chars + lineLen > maxChars && kept.length > 0) break;
        kept.push(slice);
        chars += lineLen;
    }

    if (kept.length === 0) return null;

    // Re-order chronologically (oldest first reads more naturally to the LLM)
    kept.reverse();
    const body = kept.map(s => `- ${s.content}`).join('\n');
    return `${HEADER}\n${body}`;
}
