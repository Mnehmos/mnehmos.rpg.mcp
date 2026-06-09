/* Live migration + backfill for the per-class progression subsystem.
   Safe to re-run (idempotent). Run: node scripts/migrate-class-progression.cjs */
const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(process.env.APPDATA, 'rpg-mcp', 'rpg.db'));
db.pragma('busy_timeout = 4000');

// 1) Schema --------------------------------------------------------------
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

// Ensure the XP pool column exists on characters
const cols = db.prepare('PRAGMA table_info(characters)').all().map(c => c.name);
if (!cols.includes('xp')) db.exec('ALTER TABLE characters ADD COLUMN xp INTEGER NOT NULL DEFAULT 0;');

// 2) Seed class definitions ---------------------------------------------
const upsertDef = db.prepare(`INSERT INTO class_definitions (name,hit_die,key_ability,is_homebrew,description,features)
 VALUES (@name,@hit_die,@key_ability,@is_homebrew,@description,@features)
 ON CONFLICT(name) DO UPDATE SET hit_die=excluded.hit_die, key_ability=excluded.key_ability, is_homebrew=excluded.is_homebrew, description=excluded.description, features=excluded.features`);

upsertDef.run({ name:'Brawler', hit_die:8, key_ability:'str', is_homebrew:1,
  description:'Unarmed and grapple martial. Trades blows, clinches, refuses to fall.',
  features: JSON.stringify([
    { level:1, name:'Brawlers Fists', description:'Unarmed strikes 1d6+STR; proficient with unarmed and improvised weapons.' },
    { level:1, name:'Deadweight', description:'Clinch and control with mass: advantage on grapples, grind damage in a clinch.' },
    { level:2, name:'Hard to Put Down', description:'Once per long rest, a killing blow leaves you at 1 HP instead.' }
  ]) });

upsertDef.run({ name:'Deepsense', hit_die:6, key_ability:'wis', is_homebrew:1,
  description:'Stonewise discipline attuned to what the System cannot see: rock, dark, depth, and the System-silent.',
  features: JSON.stringify([
    { level:1, name:'Stonewise', description:'Advantage on weak points, hollows, loads, unstable ground, hidden passages, depth, and blind underdark navigation.' },
    { level:1, name:'Deep Listening', description:'2 per short rest: sense life, water, hollows, structural stress, and the System-silent in a radius. Cost: Deep-strain on hard pushes.' },
    { level:2, name:'Tremorsense and failure-point read (roadmap)', description:'Planned.' },
    { level:3, name:'Break, collapse, or open stone at will (roadmap)', description:'Planned.' }
  ]) });

// 3) Backfill Sundar from his display string ----------------------------
const SUNDAR = '597c9ac1-142e-4fe4-bb6d-719f121eabdd';
const upsertCls = db.prepare(`INSERT INTO character_classes (character_id,class_name,level,xp_invested)
 VALUES (?,?,?,?)
 ON CONFLICT(character_id,class_name) DO UPDATE SET level=excluded.level, xp_invested=excluded.xp_invested, updated_at=datetime('now')`);
upsertCls.run(SUNDAR, 'Brawler', 2, 600);   // grandfathered: earned by training (by-use), not XP
upsertCls.run(SUNDAR, 'Deepsense', 1, 300); // bought with 300 XP
db.prepare('UPDATE characters SET xp=? WHERE id=?').run(200, SUNDAR); // 200 banked in the pool

// 4) Verify --------------------------------------------------------------
console.log('class_definitions:', JSON.stringify(db.prepare('SELECT name,hit_die,key_ability,is_homebrew FROM class_definitions').all()));
console.log('Sundar tracks   :', JSON.stringify(db.prepare('SELECT class_name,level,xp_invested FROM character_classes WHERE character_id=?').all(SUNDAR)));
console.log('Sundar XP pool  :', db.prepare('SELECT xp FROM characters WHERE id=?').get(SUNDAR).xp);
db.close();
