/**
 * Reading tool responses.
 *
 * Tools report results in several shapes: the whole text is JSON (action
 * router output, including errors), or rich text carrying one or more
 * RichFormatter.embedJson blocks (`<!-- TAG_JSON ... TAG_JSON -->`). Most
 * consolidated tools reformat router errors into rich text and in doing so drop
 * `isError`, so "did this call fail?" has to be answered from the payload too.
 */

export interface ToolResponseLike {
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
}

const EMBEDDED_JSON = /<!--\s*([A-Z0-9_]+)_JSON\s*\n([\s\S]*?)\n\s*\1_JSON\s*-->/g;

/**
 * The structured result of a tool response. Falls back to `{ raw: text }`.
 *
 * The previous batch_manage parser looked for a `<!--JSON:...-->` marker that
 * nothing emits, so every step fell through to `{ raw }`.
 */
export function parseToolResponse(response: ToolResponseLike | undefined): Record<string, unknown> {
    const text = response?.content?.[0]?.text ?? '';

    try {
        const whole = JSON.parse(text);
        if (whole !== null && typeof whole === 'object' && !Array.isArray(whole)) {
            return whole as Record<string, unknown>;
        }
    } catch {
        // Rich text; fall through to embedded blocks.
    }

    let found: Record<string, unknown> | null = null;
    for (const match of text.matchAll(EMBEDDED_JSON)) {
        try {
            const parsed = JSON.parse(match[2]);
            if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
                // Later blocks win on conflicting keys.
                found = { ...(found ?? {}), ...(parsed as Record<string, unknown>) };
            }
        } catch {
            // A malformed block doesn't invalidate the others.
        }
    }

    return found ?? { raw: text };
}

/**
 * Why a response counts as a failed call, or undefined if it succeeded.
 *
 * Failure means `isError`, or a top-level `error` that is `true` or an error
 * code string. `success: false` alone is deliberately *not* a failure here:
 * some tools use it for an outcome (a failed skill check) rather than a fault.
 */
export function responseFailure(
    response: ToolResponseLike | undefined,
    parsed: Record<string, unknown> = parseToolResponse(response)
): string | undefined {
    const message = typeof parsed.message === 'string' ? parsed.message : undefined;
    if (response?.isError) return message ?? 'Tool reported an error';
    if (parsed.error === true) return message ?? 'Tool reported an error';
    if (typeof parsed.error === 'string') return message ?? parsed.error;
    return undefined;
}

/**
 * Set `isError: true` on a response that reports an error in its payload, so
 * the MCP-standard flag is present no matter how the tool formatted it.
 */
export function withErrorFlag<T>(response: T): T {
    if (response === null || typeof response !== 'object') return response;
    const r = response as unknown as ToolResponseLike;
    if (r.isError || !Array.isArray(r.content)) return response;
    return responseFailure(r) ? { ...(response as object), isError: true } as T : response;
}
