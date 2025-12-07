/**
 * EVENT INBOX REPOSITORY
 * 
 * Manages the event queue for "autonomous" NPC actions.
 * Events are pushed by internal systems and polled by the frontend.
 */

import Database from 'better-sqlite3';

export type EventType = 
  | 'npc_action' 
  | 'combat_update' 
  | 'world_change' 
  | 'quest_update'
  | 'time_passage'
  | 'environmental'
  | 'system';

export type SourceType = 'npc' | 'combat' | 'world' | 'system' | 'scheduler';

export interface GameEvent {
  id?: number;
  eventType: EventType;
  payload: Record<string, any>;
  sourceType?: SourceType;
  sourceId?: string;
  priority?: number;
  createdAt?: string;
  consumedAt?: string | null;
  expiresAt?: string | null;
}

interface EventRow {
  id: number;
  event_type: string;
  payload: string;
  source_type: string | null;
  source_id: string | null;
  priority: number;
  created_at: string;
  consumed_at: string | null;
  expires_at: string | null;
}

export class EventInboxRepository {
  constructor(private db: Database.Database) {}

  /**
   * Push an event to the inbox
   */
  push(event: Omit<GameEvent, 'id' | 'createdAt' | 'consumedAt'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO event_inbox (event_type, payload, source_type, source_id, priority, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      event.eventType,
      JSON.stringify(event.payload),
      event.sourceType || null,
      event.sourceId || null,
      event.priority || 0,
      event.expiresAt || null
    );
    
    return result.lastInsertRowid as number;
  }

  /**
   * Poll for unread events, ordered by priority then time
   */
  poll(limit: number = 20): GameEvent[] {
    const now = new Date().toISOString();
    
    // Get unconsumed, non-expired events
    const stmt = this.db.prepare(`
      SELECT * FROM event_inbox
      WHERE consumed_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY priority DESC, created_at ASC
      LIMIT ?
    `);
    
    const rows = stmt.all(now, limit) as EventRow[];
    
    return rows.map(row => this.rowToEvent(row));
  }

  /**
   * Mark events as consumed (read)
   */
  markConsumed(ids: number[]): number {
    if (ids.length === 0) return 0;
    
    const now = new Date().toISOString();
    const placeholders = ids.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      UPDATE event_inbox
      SET consumed_at = ?
      WHERE id IN (${placeholders})
    `);
    
    const result = stmt.run(now, ...ids);
    return result.changes;
  }

  /**
   * Poll and immediately mark as consumed (atomic)
   */
  pollAndConsume(limit: number = 20): GameEvent[] {
    const events = this.poll(limit);
    const ids = events.map(e => e.id!).filter(Boolean);
    if (ids.length > 0) {
      this.markConsumed(ids);
    }
    return events;
  }

  /**
   * Get recent event history (including consumed)
   */
  getHistory(options: {
    limit?: number;
    eventType?: EventType;
    sourceType?: SourceType;
    includeConsumed?: boolean;
  } = {}): GameEvent[] {
    const { limit = 50, eventType, sourceType, includeConsumed = true } = options;
    
    let query = 'SELECT * FROM event_inbox WHERE 1=1';
    const params: any[] = [];
    
    if (!includeConsumed) {
      query += ' AND consumed_at IS NULL';
    }
    if (eventType) {
      query += ' AND event_type = ?';
      params.push(eventType);
    }
    if (sourceType) {
      query += ' AND source_type = ?';
      params.push(sourceType);
    }
    
    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    
    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as EventRow[];
    
    return rows.map(row => this.rowToEvent(row));
  }

  /**
   * Clean up old consumed events
   */
  cleanup(olderThanDays: number = 7): number {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);
    
    const stmt = this.db.prepare(`
      DELETE FROM event_inbox
      WHERE consumed_at IS NOT NULL
        AND created_at < ?
    `);
    
    const result = stmt.run(cutoff.toISOString());
    return result.changes;
  }

  /**
   * Get count of pending (unconsumed) events
   */
  getPendingCount(): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM event_inbox
      WHERE consumed_at IS NULL
    `);
    const row = stmt.get() as { count: number };
    return row.count;
  }

  private rowToEvent(row: EventRow): GameEvent {
    return {
      id: row.id,
      eventType: row.event_type as EventType,
      payload: JSON.parse(row.payload),
      sourceType: row.source_type as SourceType | undefined,
      sourceId: row.source_id || undefined,
      priority: row.priority,
      createdAt: row.created_at,
      consumedAt: row.consumed_at,
      expiresAt: row.expires_at
    };
  }
}
