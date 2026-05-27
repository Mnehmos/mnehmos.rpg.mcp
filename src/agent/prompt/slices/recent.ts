/**
 * Recent memory slice — long-term npc_memories for this character.
 *
 * Pulls from NpcMemoryRepository.getRecentInteractions which returns the most
 * recent N conversation memories across all NPCs this character has interacted
 * with. Filtered to a sensible importance floor by default.
 */

import { NpcMemoryRepository, Importance } from '../../../storage/repos/npc-memory.repo.js';

const HEADER = '--- YOUR RECENT MEMORIES ---';

const IMPORTANCE_RANK: Record<Importance, number> = {
    low: 0,
    medium: 1,
    high: 2,
    critical: 3
};

export interface RecentMemoryOptions {
    limit?: number;
    minImportance?: Importance;
}

export function buildRecentSlice(
    characterId: string,
    repo: NpcMemoryRepository,
    options: RecentMemoryOptions = {}
): string | null {
    const limit = options.limit ?? 8;
    const minImportance = options.minImportance ?? 'low';
    const floor = IMPORTANCE_RANK[minImportance];

    const memories = repo.getRecentInteractions(characterId, limit);
    if (memories.length === 0) return null;

    const filtered = memories.filter(m => IMPORTANCE_RANK[m.importance] >= floor);
    if (filtered.length === 0) return null;

    // Newest first
    const lines = filtered.map(m => {
        const tag = m.importance === 'critical' ? '[!] ' :
            m.importance === 'high' ? '[*] ' : '';
        return `- ${tag}${m.summary}`;
    });

    return `${HEADER}\n${lines.join('\n')}`;
}
