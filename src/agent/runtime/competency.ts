import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { z } from 'zod';

export const ReasoningEffortSchema = z.enum(['low', 'medium', 'high', 'xhigh']);
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

export const CompetencySourceSchema = z.enum(['stat_derived', 'override']);
export type CompetencySource = z.infer<typeof CompetencySourceSchema>;

export const CompetencyOverrideSchema = z.object({
    model: z.string().min(1).optional(),
    reasoningEffort: ReasoningEffortSchema.nullable().optional()
});
export type CompetencyOverride = z.infer<typeof CompetencyOverrideSchema>;

const CompetencyLadderEntrySchema = z.object({
    int: z.number().int().min(1).max(20),
    tier: z.string().min(1),
    model: z.string().min(1),
    reasoningEffort: ReasoningEffortSchema.nullable()
});
export type CompetencyLadderEntry = z.infer<typeof CompetencyLadderEntrySchema>;

export interface ResolvedCompetency extends CompetencyLadderEntry {
    source: CompetencySource;
}

const LADDER_PATH = fileURLToPath(new URL('../../../config/competency-ladder.json', import.meta.url));

function assertNoProModel(model: string): void {
    if (/-pro\b/i.test(model)) {
        throw new Error(`Competency model "${model}" violates the no-pro-model rule`);
    }
}

function validateLadder(ladder: CompetencyLadderEntry[]): CompetencyLadderEntry[] {
    if (ladder.length !== 20) {
        throw new Error(`Competency ladder must contain 20 rows, found ${ladder.length}`);
    }

    for (let index = 0; index < ladder.length; index++) {
        const expectedInt = index + 1;
        const entry = ladder[index];
        if (entry.int !== expectedInt) {
            throw new Error(`Competency ladder row ${index} must map INT ${expectedInt}`);
        }
        assertNoProModel(entry.model);
    }

    return ladder;
}

export function loadCompetencyLadder(path = LADDER_PATH): CompetencyLadderEntry[] {
    const raw = readFileSync(path, 'utf8');
    const parsed = z.array(CompetencyLadderEntrySchema).parse(JSON.parse(raw));
    return validateLadder(parsed);
}

function clampInt(intStat: number): number {
    if (!Number.isFinite(intStat)) return 1;
    return Math.min(20, Math.max(1, Math.trunc(intStat)));
}

export function resolveCompetency(
    intStat: number,
    override?: CompetencyOverride | null
): ResolvedCompetency {
    const int = clampInt(intStat);
    const entry = loadCompetencyLadder()[int - 1];
    const hasOverride = override !== null && override !== undefined
        && (override.model !== undefined || override.reasoningEffort !== undefined);

    const model = override?.model ?? entry.model;
    assertNoProModel(model);

    return {
        ...entry,
        int,
        model,
        reasoningEffort: override?.reasoningEffort !== undefined
            ? override.reasoningEffort
            : entry.reasoningEffort,
        source: hasOverride ? 'override' : 'stat_derived'
    };
}
