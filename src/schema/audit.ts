import { z } from 'zod';

export const AuditLogSchema = z.object({
    id: z.number().int().optional(), // Auto-increment
    action: z.string(),
    actorId: z.string().optional().nullable(),
    targetId: z.string().optional().nullable(),
    details: z.record(z.string(), z.unknown()).optional(), // JSON
    timestamp: z.string().datetime()
});

export type AuditLog = z.infer<typeof AuditLogSchema>;
