// One-shot: checkpoint the live rpg.db to clear a stranded WAL. No data loss.
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');

const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const dbPath = path.join(appData, 'rpg-mcp', 'rpg.db');

console.log('Target DB:', dbPath);
const exists = fs.existsSync(dbPath);
console.log('Exists:', exists);
if (!exists) { console.log('No live DB found - nothing to do.'); process.exit(0); }

const walBefore = fs.existsSync(dbPath + '-wal') ? fs.statSync(dbPath + '-wal').size : 0;
console.log('WAL size before (bytes):', walBefore);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
const integ = db.pragma('integrity_check');
console.log('Integrity:', JSON.stringify(integ));

const res = db.pragma('wal_checkpoint(TRUNCATE)');
console.log('Checkpoint result:', JSON.stringify(res));

try {
  const worlds = db.prepare('SELECT COUNT(*) c FROM worlds').get().c;
  const notes = db.prepare('SELECT COUNT(*) c FROM narrative_notes').get().c;
  const chars = db.prepare('SELECT COUNT(*) c FROM characters').get().c;
  console.log('Row counts -> worlds:' + worlds + ' narrative_notes:' + notes + ' characters:' + chars);
} catch (e) {
  console.log('Row-count probe skipped:', e.message);
}

db.close();

const walAfter = fs.existsSync(dbPath + '-wal') ? fs.statSync(dbPath + '-wal').size : 0;
const shmAfter = fs.existsSync(dbPath + '-shm');
console.log('WAL size after (bytes):', walAfter, '| -shm present:', shmAfter);
console.log('DONE');
