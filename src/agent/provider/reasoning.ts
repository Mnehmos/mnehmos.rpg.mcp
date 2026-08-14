import type { ReasoningEffort } from './types.js';

/**
 * Reasoning models consume completion budget for hidden reasoning as well as
 * visible text. Provider model identifiers may be namespaced (for example
 * `openai/gpt-5.6-luna` when routed through OpenRouter), so normalize the
 * optional namespace before checking the family.
 */
export function isReasoningModel(model: string): boolean {
    const normalized = model.toLowerCase().replace(/^[^/]+\//, '');
    return normalized.startsWith('o1')
        || normalized.startsWith('o3')
        || normalized.startsWith('o4')
        || normalized.startsWith('gpt-5');
}

/**
 * `max_completion_tokens` caps hidden reasoning and visible output together.
 * A chat-sized ceiling can therefore produce an empty response before the
 * model has any room left to speak. The floor is only a minimum request; the
 * provider still bills the actual completion usage.
 */
export const REASONING_COMPLETION_FLOOR: Record<ReasoningEffort, number> = {
    low: 4096,
    medium: 8192,
    high: 16384,
    xhigh: 32768
};

export function reasoningCompletionFloor(effort?: ReasoningEffort | null): number {
    return effort ? REASONING_COMPLETION_FLOOR[effort] : REASONING_COMPLETION_FLOOR.medium;
}
