/* Brawler 2 -> 3 (XP-bought: 300 from pool) + define Lv3 feature. */
const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(process.env.APPDATA, 'rpg-mcp', 'rpg.db'));
db.pragma('busy_timeout = 4000');
const SUNDAR = '597c9ac1-142e-4fe4-bb6d-719f121eabdd';

db.prepare("UPDATE character_classes SET level=3, xp_invested=900, updated_at=datetime('now') WHERE character_id=? AND class_name='Brawler'").run(SUNDAR);
db.prepare('UPDATE characters SET xp=? WHERE id=?').run(200, SUNDAR); // 500 - 300 spent

const features = [
  { level:1, name:"Brawler's Fists", description:'Unarmed strikes 1d6+STR; proficient with unarmed and improvised weapons.' },
  { level:1, name:'Deadweight', description:'Clinch and control with mass: advantage on grapples, grind damage in a clinch.' },
  { level:2, name:'Hard to Put Down', description:'Once per long rest, a killing blow leaves you at 1 HP instead.' },
  { level:3, name:'The Anvil', description:'While you hold your ground (take no movement on your turn): advantage to resist being grappled, shoved, moved, or knocked prone, and you cannot be moved by anything not far larger than you; and the first creature to strike you in melee each round eats an immediate unarmed counterstrike (Brawlers Fists, 1d6+STR). The wall hits back.' }
];
db.prepare("UPDATE class_definitions SET features=? WHERE name='Brawler'").run(JSON.stringify(features));

const cls = db.prepare("SELECT class_name,level,xp_invested FROM character_classes WHERE character_id=? ORDER BY created_at").all(SUNDAR);
const eff = cls.reduce((s,t)=>s+t.level,0);
console.log('Sundar tracks :', JSON.stringify(cls));
console.log('Effective lvl :', eff, '| Proficiency: +' + (2 + Math.floor((Math.max(1,eff)-1)/4)));
console.log('XP pool       :', db.prepare('SELECT xp FROM characters WHERE id=?').get(SUNDAR).xp);
db.close();
