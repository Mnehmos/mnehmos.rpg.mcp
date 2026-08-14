/* Deepsense 1 -> 2 (by-use awakening) + define real Lv2 features. */
const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(process.env.APPDATA, 'rpg-mcp', 'rpg.db'));
db.pragma('busy_timeout = 4000');
const SUNDAR = '597c9ac1-142e-4fe4-bb6d-719f121eabdd';

db.prepare("UPDATE character_classes SET level=2, xp_invested=600, updated_at=datetime('now') WHERE character_id=? AND class_name='Deepsense'").run(SUNDAR);

const features = [
  { level:1, name:'Stonewise', description:'Advantage on weak points, hollows, loads, unstable ground, hidden passages, depth, and blind underdark navigation.' },
  { level:1, name:'Deep Listening', description:'2 per short rest: sense life, water, hollows, structural stress, and the System-silent in a radius. Cost: Deep-strain on hard pushes.' },
  { level:2, name:'Tremorsense and Failure-Point Read', description:'Through contact with stone, deliberately read structural failure points - where it breaks, how, and under what load. Stonewise made precise and on-demand.' },
  { level:2, name:'Deep Scan (ritual)', description:'A ritual (~1 minute, held still, bare contact with stone or still water, cannot be rushed in combat) that sweeps deep and wide: hollows/water/loads and exact failure points; living things and their number; and the System-silent cold-quiets at range - how many, how deep, what bearing, and whether they are dormant, stirring, or drawing near. Cost: CON save (DC scales with depth/effort) or take Deep-strain. Risk: the deep listens back - a hard scan can make the cold-quiets aware of the listener.' },
  { level:3, name:'Break, collapse, or open stone at will (roadmap)', description:'Planned.' }
];
db.prepare("UPDATE class_definitions SET features=? WHERE name='Deepsense'").run(JSON.stringify(features));

const cls = db.prepare("SELECT class_name,level,xp_invested FROM character_classes WHERE character_id=? ORDER BY created_at").all(SUNDAR);
const eff = cls.reduce((s,t)=>s+t.level,0);
console.log('Sundar tracks :', JSON.stringify(cls));
console.log('Effective lvl :', eff, '| Proficiency: +' + (2 + Math.floor((Math.max(1,eff)-1)/4)));
console.log('XP pool       :', db.prepare('SELECT xp FROM characters WHERE id=?').get(SUNDAR).xp);
db.close();
