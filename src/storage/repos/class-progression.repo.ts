import type Database from 'better-sqlite3';

export interface ClassFeature { level: number; name: string; description: string; }

export interface ClassDefinition {
  name: string;
  hitDie: number;
  keyAbility: string;
  isHomebrew: boolean;
  description: string | null;
  features: ClassFeature[];
}

export interface ClassTrack {
  characterId: string;
  className: string;
  level: number;
  xpInvested: number;
}

/**
 * XP cost to gain your NEXT level. Scales with current EFFECTIVE level (the sum of all
 * class-track levels), so each level costs progressively more than the last.
 * Cost to go from effective level E to E+1 = XP_PER_EFFECTIVE_LEVEL * E.
 *   E=1 -> 300, 2 -> 600, 3 -> 900, 4 -> 1200, 5 -> 1500, 6 -> 1800 ...
 * You pay this, then apply the gained level to ANY class track of your choice.
 * (DM-granted 'by-use' levels bypass XP; levels gained before this curve are grandfathered.)
 */
export const XP_PER_EFFECTIVE_LEVEL = 300;
export function levelUpCost(currentEffectiveLevel: number): number {
  return XP_PER_EFFECTIVE_LEVEL * Math.max(1, currentEffectiveLevel);
}

/**
 * Data layer for the per-class progression subsystem.
 * A character has zero or more class tracks; there is no single general level.
 */
export class ClassProgressionRepo {
  constructor(private db: Database.Database) {}

  // ---- class definitions ----
  listDefinitions(): ClassDefinition[] {
    const rows = this.db.prepare('SELECT * FROM class_definitions ORDER BY name').all() as Record<string, unknown>[];
    return rows.map(rowToDef);
  }

  getDefinition(name: string): ClassDefinition | null {
    const row = this.db.prepare('SELECT * FROM class_definitions WHERE name = ?').get(name) as Record<string, unknown> | undefined;
    return row ? rowToDef(row) : null;
  }

  upsertDefinition(def: ClassDefinition): void {
    this.db.prepare(
      `INSERT INTO class_definitions (name, hit_die, key_ability, is_homebrew, description, features)
       VALUES (@name, @hitDie, @keyAbility, @isHomebrew, @description, @features)
       ON CONFLICT(name) DO UPDATE SET
         hit_die = excluded.hit_die,
         key_ability = excluded.key_ability,
         is_homebrew = excluded.is_homebrew,
         description = excluded.description,
         features = excluded.features`
    ).run({
      name: def.name,
      hitDie: def.hitDie,
      keyAbility: def.keyAbility,
      isHomebrew: def.isHomebrew ? 1 : 0,
      description: def.description ?? null,
      features: JSON.stringify(def.features ?? []),
    });
  }

  // ---- character tracks ----
  getTracks(characterId: string): ClassTrack[] {
    const rows = this.db
      .prepare('SELECT * FROM character_classes WHERE character_id = ? ORDER BY created_at')
      .all(characterId) as Record<string, unknown>[];
    return rows.map((r) => ({
      characterId: r.character_id as string,
      className: r.class_name as string,
      level: r.level as number,
      xpInvested: r.xp_invested as number,
    }));
  }

  setTrack(characterId: string, className: string, level: number, xpInvested: number): void {
    this.db.prepare(
      `INSERT INTO character_classes (character_id, class_name, level, xp_invested)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(character_id, class_name) DO UPDATE SET
         level = excluded.level,
         xp_invested = excluded.xp_invested,
         updated_at = datetime('now')`
    ).run(characterId, className, level, xpInvested);
  }

  /** Effective level = sum of class levels. Drives proficiency. There is no general level. */
  effectiveLevel(characterId: string): number {
    return this.getTracks(characterId).reduce((sum, t) => sum + t.level, 0);
  }

  proficiencyBonus(characterId: string): number {
    return 2 + Math.floor((Math.max(1, this.effectiveLevel(characterId)) - 1) / 4);
  }

  /** XP needed to buy this character's next level (scales with effective level). */
  costToLevelUp(characterId: string): number {
    return levelUpCost(this.effectiveLevel(characterId));
  }

  /** Human-readable build string, e.g. "[UNLISTED] \u00b7 Brawler 2 \u00b7 Deepsense 1". */
  buildString(characterId: string, prefix = '[UNLISTED]'): string {
    const parts = this.getTracks(characterId).map((t) => `${t.className} ${t.level}`);
    return [prefix, ...parts].join(' \u00b7 ');
  }
}

function rowToDef(row: Record<string, unknown>): ClassDefinition {
  let features: ClassFeature[] = [];
  try {
    features = JSON.parse((row.features as string) || '[]');
  } catch {
    features = [];
  }
  return {
    name: row.name as string,
    hitDie: row.hit_die as number,
    keyAbility: row.key_ability as string,
    isHomebrew: !!row.is_homebrew,
    description: (row.description as string) ?? null,
    features,
  };
}
