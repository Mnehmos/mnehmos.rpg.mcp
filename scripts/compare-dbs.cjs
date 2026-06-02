// Compare the root/decoy DBs against the live APPDATA db before any deletion.
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');

function probe(label, p) {
  if (!fs.existsSync(p)) { console.log(label, '-> MISSING', p); return; }
  const size = fs.statSync(p).size;
  const mtime = fs.statSync(p).mtime.toISOString();
  let counts = {};
  try {
    const db = new Database(p, { readonly: true });
    for (const t of ['worlds', 'narrative_notes', 'characters']) {
      try { counts[t] = db.prepare('SELECT COUNT(*) c FROM ' + t).get().c; }
      catch (e) { counts[t] = 'no-table'; }
    }
    db.close();
  } catch (e) { counts = { error: e.message }; }
  console.log(label, '->', 'size:' + size, 'mtime:' + mtime, JSON.stringify(counts), '\n   ', p);
}

const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
probe('LIVE (appdata)', path.join(appData, 'rpg-mcp', 'rpg.db'));
probe('root rpg.db   ', path.join('F:', 'Github', 'mnehmos.rpg.mcp', 'rpg.db'));
probe('root first.db ', path.join('F:', 'Github', 'mnehmos.rpg.mcp', 'first.db'));
probe('.tmp-rpg-data ', path.join('F:', 'Github', 'mnehmos.rpg.mcp', '.tmp-rpg-data', 'rpg.db'));
console.log('DONE');
