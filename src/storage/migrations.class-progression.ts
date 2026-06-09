import type Database from 'better-sqlite3';

/**
 * Per-class progression subsystem (homebrew multiclass; no single general level).
 *
 * A character is the SUM of their class tracks. `characters.xp` is repurposed as a
 * spendable XP pool (fuel); leveling a class spends from it (or a DM may grant a
 * level "by use" without spend). Designed for [UNLISTED] anomalies that can level
 * ANY class, but works for ordinary single-class characters too.
 *
 * Idempotent; safe on every startup. Wire into migrate() in migrations.ts:
 *   import { migrateClassProgression } from './migrations.class-progression.js';
 *   // ...at the end of migrate():
 *   migrateClassProgression(db);
 */
export function migrateClassProgression(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS class_definitions (
      name TEXT PRIMARY KEY,
      hit_die INTEGER NOT NULL DEFAULT 8,
      key_ability TEXT NOT NULL DEFAULT 'str',
      is_homebrew INTEGER NOT NULL DEFAULT 0,
      description TEXT,
      features TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS character_classes (
      character_id TEXT NOT NULL,
      class_name TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      xp_invested INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (character_id, class_name),
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );
  `);

  // Repurpose characters.xp as the spendable pool if the column is missing.
  const cols = (db.prepare('PRAGMA table_info(characters)').all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes('xp')) {
    db.exec("ALTER TABLE characters ADD COLUMN xp INTEGER NOT NULL DEFAULT 0;");
  }
}
