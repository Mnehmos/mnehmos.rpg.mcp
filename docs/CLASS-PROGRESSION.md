# Per-Class Progression (homebrew multiclass)

Replaces the engine's single-general-level assumption for `[UNLISTED]` anomalies
(and works for ordinary characters too). A character is the **sum of their class
tracks**; there is no general level.

## Data model

**`class_definitions`** — one row per class (standard or homebrew):
`name` (PK), `hit_die`, `key_ability`, `is_homebrew`, `description`, `features` (JSON
array of `{ level, name, description }`), `created_at`.

**`character_classes`** — per-character tracks:
`(character_id, class_name)` PK, `level`, `xp_invested`, timestamps, FK to `characters`.

**`characters.xp`** — repurposed as the **spendable XP pool** (fuel). Not a
general-level counter.

## Rules

- **XP is fuel.** Earned by play, banked in the pool. Leveling a class **spends**
  `CLASS_LEVEL_XP_COST` (default **300**, flat, tunable) from the pool.
- **By-use leveling.** A DM may grant a class level without spend (e.g. a training
  montage). Record it by raising `level` and setting `xp_invested` to the notional cost.
- **Derived stats:** effective level = sum of track levels → proficiency =
  `2 + floor((effLevel-1)/4)`. HP = sum of per-class hit-die rolls + CON/level.
- **Anomaly:** `[UNLISTED]` means no single class and no general level; the build
  string (`[UNLISTED] · Brawler 2 · Deepsense 1`) is *derived* from the tracks.
- Features are gained per class-level from the definition's `features` JSON. Earned
  levels pay normally (HP/prof/features); nothing is granted unearned.

## Code

- `src/storage/migrations.class-progression.ts` — `migrateClassProgression(db)` creates
  the tables + ensures the XP pool column. **Wire into `migrate()`** in `migrations.ts`:
  ```ts
  import { migrateClassProgression } from './migrations.class-progression.js';
  // at the end of migrate():
  migrateClassProgression(db);
  ```
- `src/storage/repos/class-progression.repo.ts` — `ClassProgressionRepo`
  (definitions CRUD, tracks, effectiveLevel, proficiencyBonus, buildString).
- `scripts/migrate-class-progression.cjs` — runnable live migration + seed (Brawler,
  Deepsense) + backfill (used to migrate Sundar). Idempotent.

## Tool surface to add (in `character-manage.ts`)

Add to `ACTIONS`, `definitions`, `inputSchema`, with handlers using `ClassProgressionRepo`:

- `class_list { characterId }` → tracks + derived effective level / proficiency.
- `class_grant { characterId, className }` → start a track at level 1 (def must exist).
- `class_level_up { characterId, className, spendXp?=true, hpRoll? }` → +1 level; if
  `spendXp`, deduct `classLevelCost` from `characters.xp`; roll/add hit-die HP; surface
  the new feature(s).
- `class_def_upsert { name, hitDie, keyAbility, isHomebrew, description, features[] }` →
  define/edit a class (how homebrew like Deepsense is registered).
- Deprecate the generic `level_up`/`XP_TABLE` general-level path for `[UNLISTED]` PCs
  (keep for legacy single-class NPCs, or route through tracks).

## Status

- [x] Tables live in `rpg.db`; Brawler + Deepsense seeded; Sundar backfilled
      (Brawler 2 / Deepsense 1 / 200 XP pooled).
- [x] Migration module + repo written.
- [ ] Wire `migrateClassProgression` into `migrate()` (one import + one call).
- [ ] Add the `class_*` tool actions above.
- [ ] `npm run build` + restart the MCP server to load the rebuilt `dist/`.
