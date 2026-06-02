import { AuditRepository } from '../storage/audit.repo.js';
import { getDb } from '../storage/index.js';

const REDACTED = '[REDACTED]';
const MAX_STRING_LENGTH = 2000;
const MAX_ARRAY_LENGTH = 50;
const MAX_DEPTH = 5;
const SENSITIVE_KEY_PATTERN = /(password|passwd|secret|token|api[_-]?key|authorization|authToken|bearer|privateMemory|secretDescription)/i;

function sanitizeForAudit(value: unknown, depth: number = 0): unknown {
    if (depth > MAX_DEPTH) return '[Max depth exceeded]';

    if (typeof value === 'string') {
        return value.length > MAX_STRING_LENGTH
            ? `${value.slice(0, MAX_STRING_LENGTH)}...[truncated ${value.length - MAX_STRING_LENGTH} chars]`
            : value;
    }

    if (value === null || typeof value !== 'object') {
        return value;
    }

    if (Array.isArray(value)) {
        const items = value.slice(0, MAX_ARRAY_LENGTH).map(item => sanitizeForAudit(item, depth + 1));
        if (value.length > MAX_ARRAY_LENGTH) {
            items.push(`[truncated ${value.length - MAX_ARRAY_LENGTH} items]`);
        }
        return items;
    }

    const sanitized: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        sanitized[key] = SENSITIVE_KEY_PATTERN.test(key)
            ? REDACTED
            : sanitizeForAudit(child, depth + 1);
    }
    return sanitized;
}

function detectSoftError(result: unknown): string | undefined {
    const content = (result as { content?: Array<{ text?: string }> })?.content;
    const text = content?.[0]?.text;
    if (!text) return undefined;

    try {
        const parsed = JSON.parse(text);
        if (parsed?.error === true || typeof parsed?.error === 'string') {
            return parsed.message || parsed.error;
        }
    } catch {
        // Rich text responses can embed JSON later; leave them as successful
        // unless the handler threw an exception.
    }

    return undefined;
}

export class AuditLogger {
    private repo: AuditRepository;

    constructor() {
        const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
        this.repo = new AuditRepository(db);
    }

    wrapHandler(toolName: string, handler: (args: any) => Promise<any>) {
        return async (args: any) => {
            const startTime = Date.now();
            let result: any;
            let error: any;

            try {
                result = await handler(args);
                return result;
            } catch (e: any) {
                error = e;
                throw e;
            } finally {
                try {
                    const softError = error ? undefined : detectSoftError(result);
                    this.repo.create({
                        action: toolName,
                        actorId: null,
                        targetId: null,
                        details: {
                            args: sanitizeForAudit(args),
                            result: sanitizeForAudit(result),
                            success: !error && !softError,
                            error: error ? error.message : softError,
                            duration: Date.now() - startTime
                        },
                        timestamp: new Date().toISOString()
                    });
                } catch (logError) {
                    console.error('Failed to write audit log:', logError);
                }
            }
        };
    }
}
