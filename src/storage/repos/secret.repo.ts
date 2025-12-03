import Database from 'better-sqlite3';
import { Secret, SecretSchema, GameEvent, RevealCondition } from '../../schema/secret.js';

export interface SecretFilter {
    worldId?: string;
    type?: string;
    category?: string;
    revealed?: boolean;
    sensitivity?: string;
    linkedEntityId?: string;
    linkedEntityType?: string;
}

export interface LeakCheck {
    secretId: string;
    secretName: string;
    pattern: string;
    matched: boolean;
    context?: string;
}

export class SecretRepository {
    constructor(private db: Database.Database) {}

    /**
     * Create a new secret
     */
    create(secret: Secret): Secret {
        const validSecret = SecretSchema.parse(secret);

        const stmt = this.db.prepare(`
            INSERT INTO secrets (
                id, world_id, type, category, name, 
                public_description, secret_description,
                linked_entity_id, linked_entity_type,
                revealed, revealed_at, revealed_by,
                reveal_conditions, sensitivity, leak_patterns,
                notes, created_at, updated_at
            ) VALUES (
                @id, @worldId, @type, @category, @name,
                @publicDescription, @secretDescription,
                @linkedEntityId, @linkedEntityType,
                @revealed, @revealedAt, @revealedBy,
                @revealConditions, @sensitivity, @leakPatterns,
                @notes, @createdAt, @updatedAt
            )
        `);

        stmt.run({
            id: validSecret.id,
            worldId: validSecret.worldId,
            type: validSecret.type,
            category: validSecret.category,
            name: validSecret.name,
            publicDescription: validSecret.publicDescription,
            secretDescription: validSecret.secretDescription,
            linkedEntityId: validSecret.linkedEntityId || null,
            linkedEntityType: validSecret.linkedEntityType || null,
            revealed: validSecret.revealed ? 1 : 0,
            revealedAt: validSecret.revealedAt || null,
            revealedBy: validSecret.revealedBy || null,
            revealConditions: JSON.stringify(validSecret.revealConditions),
            sensitivity: validSecret.sensitivity,
            leakPatterns: JSON.stringify(validSecret.leakPatterns),
            notes: validSecret.notes || null,
            createdAt: validSecret.createdAt,
            updatedAt: validSecret.updatedAt
        });

        return validSecret;
    }

    /**
     * Find a secret by ID
     */
    findById(id: string): Secret | null {
        const stmt = this.db.prepare('SELECT * FROM secrets WHERE id = ?');
        const row = stmt.get(id) as SecretRow | undefined;
        
        if (!row) return null;
        return this.rowToSecret(row);
    }

    /**
     * Find all secrets matching filter criteria
     */
    find(filter: SecretFilter = {}): Secret[] {
        let query = 'SELECT * FROM secrets WHERE 1=1';
        const params: Record<string, unknown> = {};

        if (filter.worldId) {
            query += ' AND world_id = @worldId';
            params.worldId = filter.worldId;
        }
        if (filter.type) {
            query += ' AND type = @type';
            params.type = filter.type;
        }
        if (filter.category) {
            query += ' AND category = @category';
            params.category = filter.category;
        }
        if (filter.revealed !== undefined) {
            query += ' AND revealed = @revealed';
            params.revealed = filter.revealed ? 1 : 0;
        }
        if (filter.sensitivity) {
            query += ' AND sensitivity = @sensitivity';
            params.sensitivity = filter.sensitivity;
        }
        if (filter.linkedEntityId) {
            query += ' AND linked_entity_id = @linkedEntityId';
            params.linkedEntityId = filter.linkedEntityId;
        }
        if (filter.linkedEntityType) {
            query += ' AND linked_entity_type = @linkedEntityType';
            params.linkedEntityType = filter.linkedEntityType;
        }

        const stmt = this.db.prepare(query);
        const rows = stmt.all(params) as SecretRow[];
        return rows.map(row => this.rowToSecret(row));
    }

    /**
     * Get all unrevealed secrets for a world (for LLM context injection)
     */
    getActiveSecrets(worldId: string): Secret[] {
        return this.find({ worldId, revealed: false });
    }

    /**
     * Update a secret
     */
    update(id: string, updates: Partial<Secret>): Secret | null {
        const existing = this.findById(id);
        if (!existing) return null;

        const updated = {
            ...existing,
            ...updates,
            updatedAt: new Date().toISOString()
        };

        const validSecret = SecretSchema.parse(updated);

        const stmt = this.db.prepare(`
            UPDATE secrets SET
                type = @type,
                category = @category,
                name = @name,
                public_description = @publicDescription,
                secret_description = @secretDescription,
                linked_entity_id = @linkedEntityId,
                linked_entity_type = @linkedEntityType,
                revealed = @revealed,
                revealed_at = @revealedAt,
                revealed_by = @revealedBy,
                reveal_conditions = @revealConditions,
                sensitivity = @sensitivity,
                leak_patterns = @leakPatterns,
                notes = @notes,
                updated_at = @updatedAt
            WHERE id = @id
        `);

        stmt.run({
            id: validSecret.id,
            type: validSecret.type,
            category: validSecret.category,
            name: validSecret.name,
            publicDescription: validSecret.publicDescription,
            secretDescription: validSecret.secretDescription,
            linkedEntityId: validSecret.linkedEntityId || null,
            linkedEntityType: validSecret.linkedEntityType || null,
            revealed: validSecret.revealed ? 1 : 0,
            revealedAt: validSecret.revealedAt || null,
            revealedBy: validSecret.revealedBy || null,
            revealConditions: JSON.stringify(validSecret.revealConditions),
            sensitivity: validSecret.sensitivity,
            leakPatterns: JSON.stringify(validSecret.leakPatterns),
            notes: validSecret.notes || null,
            updatedAt: validSecret.updatedAt
        });

        return validSecret;
    }

    /**
     * Reveal a secret
     */
    reveal(id: string, triggeredBy: string): Secret | null {
        return this.update(id, {
            revealed: true,
            revealedAt: new Date().toISOString(),
            revealedBy: triggeredBy
        });
    }

    /**
     * Delete a secret
     */
    delete(id: string): boolean {
        const stmt = this.db.prepare('DELETE FROM secrets WHERE id = ?');
        const result = stmt.run(id);
        return result.changes > 0;
    }

    /**
     * Check if any secrets should be revealed based on a game event
     */
    checkRevealConditions(worldId: string, event: GameEvent): Secret[] {
        const secrets = this.getActiveSecrets(worldId);
        const toReveal: Secret[] = [];

        for (const secret of secrets) {
            for (const condition of secret.revealConditions) {
                if (this.conditionMet(event, condition)) {
                    toReveal.push(secret);
                    break;
                }
            }
        }

        return toReveal;
    }

    /**
     * Check if a specific condition is met by an event
     * Note: 'manual' type conditions are never auto-triggered
     */
    private conditionMet(event: GameEvent, condition: RevealCondition): boolean {
        // Manual reveals are handled separately, not by events
        if (condition.type === 'manual') return false;
        
        // Event type must match condition type
        if (event.type !== condition.type) return false;

        switch (event.type) {
            case 'skill_check':
                return event.skill?.toLowerCase() === condition.skill?.toLowerCase() &&
                       (event.result || 0) >= (condition.dc || 0);

            case 'quest_complete':
                return event.questId === condition.questId;

            case 'location_enter':
                return event.locationId === condition.locationId;

            case 'item_interact':
                return event.itemId === condition.itemId;

            case 'combat_end':
                return true; // Just needs the event type to match

            case 'dialogue':
                return event.text?.toLowerCase().includes(
                    condition.dialogueTrigger?.toLowerCase() || ''
                ) || false;

            case 'time_passed':
                return (event.hoursPassed || 0) >= (condition.hoursRequired || 0);

            default:
                return false;
        }
    }

    /**
     * Check text for potential secret leaks
     */
    checkForLeaks(text: string, worldId: string): LeakCheck[] {
        const secrets = this.getActiveSecrets(worldId);
        const leaks: LeakCheck[] = [];

        for (const secret of secrets) {
            for (const pattern of secret.leakPatterns) {
                const regex = new RegExp(`\\b${this.escapeRegex(pattern)}\\b`, 'gi');
                const match = regex.test(text);

                if (match) {
                    // Get context around the match
                    const matchResult = text.match(regex);
                    const index = matchResult ? text.indexOf(matchResult[0]) : 0;
                    const start = Math.max(0, index - 30);
                    const end = Math.min(text.length, index + pattern.length + 30);
                    const context = text.slice(start, end);

                    leaks.push({
                        secretId: secret.id,
                        secretName: secret.name,
                        pattern,
                        matched: true,
                        context
                    });
                }
            }
        }

        return leaks;
    }

    /**
     * Format secrets for LLM context injection
     */
    formatForLLM(worldId: string): string {
        const secrets = this.getActiveSecrets(worldId);
        
        if (secrets.length === 0) {
            return '';
        }

        // Group by type
        const grouped = new Map<string, Secret[]>();
        for (const secret of secrets) {
            const existing = grouped.get(secret.type) || [];
            existing.push(secret);
            grouped.set(secret.type, existing);
        }

        let output = `
## SECRET INFORMATION (DO NOT REVEAL TO PLAYER)
⚠️ The following information is SECRET. You know this to inform your narration,
but you must NEVER directly reveal it to the player unless the reveal conditions are met.

`;

        for (const [type, typeSecrets] of grouped) {
            output += `### ${type.toUpperCase()} SECRETS\n\n`;

            for (const secret of typeSecrets) {
                output += `**[SECRET-${secret.id.slice(0, 8)}] ${secret.name}**\n`;
                output += `- Sensitivity: ${secret.sensitivity.toUpperCase()}\n`;
                output += `- Public Knowledge: ${secret.publicDescription}\n`;
                output += `- Hidden Truth: ${secret.secretDescription}\n`;
                
                if (secret.leakPatterns.length > 0) {
                    output += `- ⚠️ AVOID these words: ${secret.leakPatterns.join(', ')}\n`;
                }
                
                if (secret.revealConditions.length > 0) {
                    output += `- Reveal when: ${this.formatConditions(secret.revealConditions)}\n`;
                }
                
                output += '\n';
            }
        }

        output += `
### SECRET HANDLING RULES:
1. NEVER state secrets directly, even if the player asks
2. NEVER confirm or deny guesses about secrets  
3. You may hint through environmental details and NPC behavior
4. If reveal conditions are met, describe the revelation dramatically
5. Use secrets to make NPCs behave consistently with their hidden motivations
`;

        return output;
    }

    private formatConditions(conditions: RevealCondition[]): string {
        return conditions.map(c => {
            switch (c.type) {
                case 'skill_check': return `DC ${c.dc} ${c.skill} check`;
                case 'quest_complete': return `Complete quest`;
                case 'location_enter': return `Enter specific location`;
                case 'item_interact': return `Interact with item`;
                case 'dialogue': return `Say "${c.dialogueTrigger}"`;
                case 'combat_end': return `Combat ends`;
                case 'time_passed': return `${c.hoursRequired} hours pass`;
                case 'manual': return `DM reveals`;
                default: return c.type;
            }
        }).join(' OR ');
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private rowToSecret(row: SecretRow): Secret {
        return SecretSchema.parse({
            id: row.id,
            worldId: row.world_id,
            type: row.type,
            category: row.category,
            name: row.name,
            publicDescription: row.public_description,
            secretDescription: row.secret_description,
            linkedEntityId: row.linked_entity_id || undefined,
            linkedEntityType: row.linked_entity_type || undefined,
            revealed: row.revealed === 1,
            revealedAt: row.revealed_at || undefined,
            revealedBy: row.revealed_by || undefined,
            revealConditions: JSON.parse(row.reveal_conditions),
            sensitivity: row.sensitivity,
            leakPatterns: JSON.parse(row.leak_patterns),
            notes: row.notes || undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        });
    }
}

interface SecretRow {
    id: string;
    world_id: string;
    type: string;
    category: string;
    name: string;
    public_description: string;
    secret_description: string;
    linked_entity_id: string | null;
    linked_entity_type: string | null;
    revealed: number;
    revealed_at: string | null;
    revealed_by: string | null;
    reveal_conditions: string;
    sensitivity: string;
    leak_patterns: string;
    notes: string | null;
    created_at: string;
    updated_at: string;
}
