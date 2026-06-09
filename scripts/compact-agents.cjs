/* Compact crew agents: collapse stale narrative_feed into one current digest,
   and prune stored past-invoke 'response' journal entries. Safe to re-run.
   Run: node scripts/compact-agents.cjs */
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const db = new Database(path.join(process.env.APPDATA, 'rpg-mcp', 'rpg.db'));
db.pragma('busy_timeout = 4000');

const AGENTS = [
  ['Kessa', '4bcaa1e2-5b6e-4918-ba45-57c2104ada07'],
  ['Corm',  '89160372-8156-4ba7-92b6-36a891e4de7c'],
  ['Riss',  '94a10e74-9cf7-4f88-bdc0-60b021625629'],
  ['Vesh',  '5d08c96d-ba45-48f2-b756-166ff06a4e9c'],
];

// One dense, CURRENT shared-knowledge digest. Replaces the append-forever feed.
const DIGEST = [
  "CURRENT STATE (shared crew knowledge \u2014 kept deliberately short):",
  "Kessa's crew salvaged the Tin Saints (killed the Drowner; sold an unreadable cold 'case' to a hooded buyer).",
  "SUNDAR, the [UNLISTED] new muscle, can SENSE and \u2014 with quiet-worked gear \u2014 HARM the System-silent 'cold-quiets' the rest of you are blind to.",
  "A scouting dive found a VEIN of them below the drowned gallery, with a vast AWAKE thing beneath.",
  "On the HEAVY RETURN it stirred: Sundar cut his own tether and faced the guardian (a 'Warden') alone to save the crew; Kessa marked his blood-debt and pulled everyone out; Sundar hurt the Warden, escaped through a gap it couldn't follow, and surfaced ALIVE with two prime cold cells \u2014 debt doubled and paid, he is crew for good.",
  "He glimpsed the truth: the vein is a sleeping god's SILENCE climbing toward the Rim, and the Convocation's Hero-Summonings are a secret war against it.",
  "NOW: Wick (an under-streets fixer Sundar vouched for) is quiet-working a full crew kit \u2014 weapons and shields, then armor \u2014 under Riss's watch, to arm for a future kill-delve. Downtime; Sundar is recovering (hurt).",
].join(' ');

const delFeed  = db.prepare("DELETE FROM agent_prompt_slices WHERE agent_id=? AND kind='narrative_feed'");
const delResp  = db.prepare("DELETE FROM agent_journal WHERE agent_id=? AND kind='response'");
const insSlice = db.prepare("INSERT INTO agent_prompt_slices (id,agent_id,kind,label,content,order_index,enabled,updated_at) VALUES (?,?,?,?,?,?,?,datetime('now'))");

const tx = db.transaction(() => {
  for (const [name, id] of AGENTS) {
    const feedBefore = db.prepare("SELECT COUNT(*) c FROM agent_prompt_slices WHERE agent_id=? AND kind='narrative_feed'").get(id).c;
    const respBefore = db.prepare("SELECT COUNT(*) c FROM agent_journal WHERE agent_id=? AND kind='response'").get(id).c;
    delFeed.run(id);
    delResp.run(id);
    insSlice.run(crypto.randomUUID(), id, 'narrative_feed', 'compacted-digest', DIGEST, 1, 1);
    const feedAfter = db.prepare("SELECT COUNT(*) c FROM agent_prompt_slices WHERE agent_id=? AND kind='narrative_feed'").get(id).c;
    console.log(name.padEnd(6), '| feed slices', feedBefore, '->', feedAfter, '| pruned past-invoke journal:', respBefore);
  }
});
tx();
db.close();
console.log('Digest length (chars):', DIGEST.length);
