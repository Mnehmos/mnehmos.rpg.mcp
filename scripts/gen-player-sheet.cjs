#!/usr/bin/env node
/*
 * RPG-MCP — Player Sheet Generator
 * Reads the live SQLite DB (better-sqlite3) and emits a self-contained, player-facing
 * character + inventory + chronicle sheet as a single .html file. No network, no deps
 * beyond better-sqlite3 (already in this repo).
 *
 * Usage:
 *   node scripts/gen-player-sheet.cjs [--character <id>] [--world <id>] [--out <path>] [--db <path>]
 * Defaults: Sundar / world "The Descent" / ./player-sheet.html / %APPDATA%/rpg-mcp/rpg.db
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const os = require('os');

function arg(flag, def) { const i = process.argv.indexOf(flag); return (i !== -1 && process.argv[i + 1]) ? process.argv[i + 1] : def; }
function defaultDbPath() {
  if (process.env.RPG_MCP_DB_PATH) return process.env.RPG_MCP_DB_PATH;
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'rpg-mcp', 'rpg.db');
}
const DB_PATH = arg('--db', defaultDbPath());
const CHARACTER_ID = arg('--character', '597c9ac1-142e-4fe4-bb6d-719f121eabdd');
const WORLD_ID = arg('--world', '0137ca3c-13d9-4a9e-ada1-e1ec6795ab57');
const OUT = arg('--out', path.join(process.cwd(), 'player-sheet.html'));

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

const J = (v, d) => { try { return v == null ? d : JSON.parse(v); } catch { return d; } };
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;').replace(/\x22/g, '&quot;');
const modN = (v) => Math.floor((Number(v) - 10) / 2);
const mod = (v) => { const m = modN(v); return (m >= 0 ? '+' : '') + m; };
const sign = (n) => (n >= 0 ? '+' : '') + n;

const c = db.prepare('SELECT * FROM characters WHERE id = ?').get(CHARACTER_ID);
if (!c) { console.error('Character not found: ' + CHARACTER_ID); process.exit(1); }
const stats = J(c.stats, {});
const currency = J(c.currency, { gold: 0, silver: 0, copper: 0 });
const origin = J(c.origin, {});

const effects = db.prepare('SELECT * FROM custom_effects WHERE target_id = ? AND is_active = 1 ORDER BY id').all(CHARACTER_ID);

let inv = [];
try {
  inv = db.prepare('SELECT ii.quantity, ii.equipped, ii.slot, it.name, it.description, it.type, it.weight, it.value, it.properties FROM inventory_items ii JOIN items it ON it.id = ii.item_id WHERE ii.character_id = ?').all(CHARACTER_ID);
} catch (e) { inv = []; }

const world = db.prepare('SELECT * FROM worlds WHERE id = ?').get(WORLD_ID) || { name: 'Unknown Realm' };

let notes = [];
try {
  notes = db.prepare("SELECT * FROM narrative_notes WHERE world_id = ? AND visibility = 'player_visible' ORDER BY datetime(created_at) ASC").all(WORLD_ID);
} catch (e) { notes = []; }

// ---- per-class progression subsystem (character_classes + class_definitions) ----
let tracks = [];
try { tracks = db.prepare('SELECT * FROM character_classes WHERE character_id = ? ORDER BY created_at').all(CHARACTER_ID); } catch (e) { tracks = []; }
let classDefs = {};
try { for (const d of db.prepare('SELECT * FROM class_definitions').all()) classDefs[d.name] = d; } catch (e) { classDefs = {}; }

// ---- derive ----
const titleMatch = String(c.background || '').match(/Title:\s*['\u2018]([^'\u2019]+)['\u2019]/);
const title = titleMatch ? titleMatch[1] : '';
const lvlNums = (String(c.character_class || '').match(/\d+/g) || []).map(Number);
const effLvl = tracks.length ? tracks.reduce((s, t) => s + t.level, 0) : (lvlNums.length ? Math.max(...lvlNums) : (c.level || 1));
const prof = 2 + Math.floor((Math.max(1, effLvl) - 1) / 4);
const strMod = modN(stats.str);
const classHtml = esc(c.character_class || 'Classless').replace('[UNLISTED]', '<span class="unlisted">[UNLISTED]</span>');
const hpPct = Math.max(0, Math.min(100, Math.round((c.hp / (c.max_hp || c.hp || 1)) * 100)));
const totalWt = inv.reduce((s, it) => s + (Number(it.weight) || 0) * (Number(it.quantity) || 1), 0);

const STAT_ORDER = [['str', 'STR'], ['dex', 'DEX'], ['con', 'CON'], ['int', 'INT'], ['wis', 'WIS'], ['cha', 'CHA']];
const statBoxes = STAT_ORDER.map(([k, lbl]) => `<div class="stat"><div class="stat-lbl">${lbl}</div><div class="stat-mod">${mod(stats[k])}</div><div class="stat-val">${esc(stats[k])}</div></div>`).join('');

// ---- per-item stat line (damage / to-hit / AC / contents) ----
function itemStats(it) {
  const p = J(it.properties, {});
  const bits = [];
  if (it.type === 'weapon' && p.damageDice) {
    const hit = strMod + prof + (Number(p.attackBonus) || 0);
    const dmgMod = strMod === 0 ? '' : (strMod > 0 ? '+' + strMod : String(strMod));
    bits.push(`<b>${sign(hit)} to hit</b>`);
    bits.push(`<b>${esc(p.damageDice)}${dmgMod}</b>${p.damageType ? ' ' + esc(p.damageType) : ''}`);
  } else if (it.type === 'armor' && p.baseAC != null) {
    bits.push(`<b>AC ${esc(p.baseAC)}</b>`);
    if (p.maxDexBonus != null) bits.push(`max DEX ${sign(Number(p.maxDexBonus))}`);
  }
  if (p.contents) bits.push(esc(p.contents));
  if (p.effect) bits.push(esc(p.effect));
  if (p.uses) bits.push('uses: ' + esc(p.uses));
  if (p.scarcity) bits.push(esc(p.scarcity));
  if (it.type === 'weapon' && p.signature) bits.push('<span class="sig">signature</span>');
  return bits.length ? bits.join(' &middot; ') : '<span class="muted">&mdash;</span>';
}

const invHtml = inv.length ? `<table class="inv"><thead><tr><th>Item</th><th>Type</th><th>Stats / Damage / AC</th><th>Qty</th><th>Equipped</th><th>Wt</th><th>Val</th></tr></thead><tbody>${inv.map(it => `<tr><td><strong>${esc(it.name)}</strong><div class="muted">${esc(it.description)}</div></td><td><span class="ty ${esc(it.type)}">${esc(it.type)}</span></td><td class="statcell">${itemStats(it)}</td><td>${esc(it.quantity)}</td><td>${it.equipped ? `<span class="eq">${esc(it.slot || 'worn')}</span>` : '<span class="muted">&mdash;</span>'}</td><td>${esc(it.weight)}</td><td>${esc(it.value)}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="5" class="muted">Total carried</td><td>${totalWt}</td><td></td></tr></tfoot></table>` : `<p class="empty">The structured inventory subsystem holds no items for this character yet. Gear &amp; coin are currently recorded in the chronicle below &mdash; run <code>item_manage</code>/<code>inventory_manage</code> to migrate them into the ledger.</p>`;

const TYPE_LABEL = { canonical_moment: 'Canonical', plot_thread: 'Thread', session_log: 'Session', foreshadowing: 'Omen', npc_voice: 'Voice' };
const threads = notes.filter(n => n.type === 'plot_thread');
const chronicle = notes.filter(n => n.type !== 'plot_thread');
function noteCard(n) {
  const tags = J(n.tags, []);
  const date = (n.created_at || '').slice(0, 10);
  return `<div class="card note">
    <div class="note-head"><span class="badge type">${esc(TYPE_LABEL[n.type] || n.type)}</span><span class="note-date">${esc(date)}</span></div>
    <p class="note-body">${esc(n.content)}</p>
    ${tags.length ? `<div class="tags">${tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
  </div>`;
}
const threadsHtml = threads.length ? threads.map(noteCard).join('') : '<p class="empty">No open threads.</p>';
const chronicleHtml = chronicle.length ? chronicle.map(noteCard).join('') : '<p class="empty">No chronicle entries.</p>';

const catColor = { boon: 'boon', curse: 'curse', neutral: 'neutral', transformative: 'trans' };
const featureCards = effects.length ? effects.map(e => {
  const mech = J(e.mechanics, []);
  const pips = Array.from({ length: 5 }, (_, i) => `<span class="pip ${i < (e.power_level || 0) ? 'on' : ''}"></span>`).join('');
  const mlist = mech.map(m => `<li><code>${esc(m.type)}</code>${m.value != null && m.value !== '' ? ' &rarr; ' + esc(m.value) : ''}${m.condition ? ' <em>(' + esc(m.condition) + ')</em>' : ''}</li>`).join('');
  return `<div class="card feature">
    <div class="feature-head"><span class="fname">${esc(e.name)}</span><span class="badge ${catColor[e.category] || 'neutral'}">${esc(e.category)}</span></div>
    <div class="pips" title="power level ${e.power_level}">${pips}</div>
    <p class="fdesc">${esc(e.description)}</p>
    ${mlist ? `<ul class="mech">${mlist}</ul>` : ''}
  </div>`;
}).join('') : '<p class="empty">No active effects recorded.</p>';

const tracksHtml = tracks.length ? tracks.map(t => {
  const def = classDefs[t.class_name] || {};
  const feats = J(def.features, []);
  const featList = feats.map(f => `<li class="${f.level <= t.level ? 'on' : 'off'}"><span class="flv">L${f.level}</span> <b>${esc(f.name)}</b> &mdash; ${esc(f.description)}</li>`).join('');
  return `<div class="card track"><div class="track-head"><span class="tname">${esc(t.class_name)} <span class="tlvl">${t.level}</span></span><span class="badge">d${esc(def.hit_die || '?')} &middot; ${esc(String(def.key_ability || '').toUpperCase())}</span></div><div class="muted">XP invested: ${esc(t.xp_invested)}${def.is_homebrew ? ' &middot; homebrew' : ''}</div>${featList ? `<ul class="feats">${featList}</ul>` : ''}</div>`;
}).join('') : '<p class="empty">No class tracks recorded yet.</p>';
const anomalyNote = String(c.character_class || '').includes('[UNLISTED]') ? `<p class="muted">Anomaly: <span class="unlisted">[UNLISTED]</span> &mdash; no general level. Effective level ${effLvl} is the <b>sum</b> of class tracks; everything learned, nothing granted.</p>` : '';

const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(c.name)} &mdash; Player Sheet</title>
<style>
:root{--bg:#0c0e13;--panel:#14171f;--panel2:#191d27;--line:#2a2f3c;--ink:#cdd1da;--mut:#7c8294;--sys:#6cc1d6;--amber:#d9a441;--red:#c8503f;--boon:#5fae7e;--good:#5fae7e}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(1200px 700px at 50% -10%,#161a24 0%,var(--bg) 60%);color:var(--ink);font:16px/1.6 Georgia,'Iowan Old Style',serif;padding:32px 16px}
.sheet{max-width:1080px;margin:0 auto}
code,.mono{font-family:ui-monospace,'Cascadia Code',Consolas,monospace}
h1{font-size:2.6rem;margin:.1em 0;letter-spacing:.5px}
h2{font:600 .8rem/1 ui-monospace,monospace;letter-spacing:.22em;text-transform:uppercase;color:var(--sys);margin:0 0 14px;padding-bottom:8px;border-bottom:1px solid var(--line)}
.hero{position:relative;border:1px solid var(--line);border-radius:14px;background:linear-gradient(180deg,var(--panel2),var(--panel));padding:28px 30px;overflow:hidden}
.hero:before{content:'';position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent 0 3px,rgba(108,193,214,.03) 3px 4px);pointer-events:none}
.eyebrow{font:600 .72rem/1 ui-monospace,monospace;letter-spacing:.28em;text-transform:uppercase;color:var(--mut)}
.title{font:600 .9rem/1 ui-monospace,monospace;letter-spacing:.3em;text-transform:uppercase;color:var(--amber);margin-top:6px}
.classline{font-family:ui-monospace,monospace;margin-top:12px;font-size:1.05rem}
.unlisted{color:var(--amber);text-shadow:0 0 12px rgba(217,164,65,.35)}
.subline{color:var(--mut);margin-top:6px;font-size:.92rem}
.muted{color:var(--mut);font-size:.84rem;margin-top:3px;line-height:1.45}
.vitals{display:flex;gap:14px;flex-wrap:wrap;margin:18px 0}
.vital{flex:1;min-width:120px;border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:14px 16px}
.vital .k{font:600 .68rem/1 ui-monospace,monospace;letter-spacing:.2em;text-transform:uppercase;color:var(--mut)}
.vital .v{font-size:1.7rem;margin-top:6px;font-family:ui-monospace,monospace}
.hpbar{height:8px;border-radius:6px;background:#2a1d1d;margin-top:10px;overflow:hidden}
.hpbar > i{display:block;height:100%;width:${hpPct}%;background:linear-gradient(90deg,#c8503f,#e08a3c)}
.stats{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin:18px 0}
.stat{border:1px solid var(--line);border-radius:12px;background:var(--panel);text-align:center;padding:14px 6px}
.stat-lbl{font:600 .7rem/1 ui-monospace,monospace;letter-spacing:.15em;color:var(--mut)}
.stat-mod{font-size:1.9rem;font-family:ui-monospace,monospace;margin:6px 0 2px}
.stat-val{font-size:.8rem;color:var(--mut);font-family:ui-monospace,monospace}
.cols{display:grid;grid-template-columns:1.15fr .85fr;gap:22px;margin-top:22px}
section.block{margin-bottom:26px}
.card{border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:16px 18px;margin-bottom:14px}
.feature-head{display:flex;justify-content:space-between;align-items:center;gap:10px}
.fname{font-weight:600;font-size:1.1rem}
.fdesc{margin:10px 0 8px;color:#bcc1cd}
.badge{font:600 .62rem/1 ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;padding:4px 8px;border-radius:20px;border:1px solid var(--line);color:var(--mut)}
.badge.boon{color:var(--boon);border-color:#2f5a45}.badge.curse{color:var(--red);border-color:#5a2f2f}.badge.type{color:var(--sys);border-color:#27505c}
.pips{display:flex;gap:5px;margin:4px 0 2px}
.pip{width:9px;height:9px;border-radius:50%;border:1px solid var(--line)}.pip.on{background:var(--amber);border-color:var(--amber);box-shadow:0 0 6px rgba(217,164,65,.5)}
ul.mech{margin:8px 0 0;padding-left:18px;color:var(--mut);font-size:.92rem}
ul.mech code{color:var(--sys)}
.track-head{display:flex;justify-content:space-between;align-items:center;gap:10px}
.tname{font-weight:600;font-size:1.12rem}.tlvl{display:inline-block;min-width:1.5em;text-align:center;color:var(--amber);font-family:ui-monospace,monospace;text-shadow:0 0 10px rgba(217,164,65,.4)}
ul.feats{margin:10px 0 0;padding-left:16px;font-size:.92rem;list-style:none}
ul.feats li{margin:5px 0;color:#bcc1cd}ul.feats li.off{opacity:.4}
.flv{font:600 .6rem/1 ui-monospace,monospace;color:var(--sys);border:1px solid #27505c;border-radius:5px;padding:2px 5px;margin-right:5px}
.inv{width:100%;border-collapse:collapse;font-size:.92rem}
.inv th{text-align:left;font:600 .66rem/1 ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--mut);border-bottom:1px solid var(--line);padding:8px 8px}
.inv td{border-bottom:1px solid #212531;padding:10px 8px;vertical-align:top}
.inv tfoot td{border-bottom:none;font-family:ui-monospace,monospace;color:var(--mut);padding-top:10px}
.statcell{font-family:ui-monospace,monospace;font-size:.86rem;color:#aeb6c6}
.statcell b{color:var(--ink)}
.ty{font:600 .6rem/1 ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;padding:3px 7px;border-radius:6px;border:1px solid var(--line);color:var(--mut)}
.ty.weapon{color:#e0a06a;border-color:#5a4330}.ty.armor{color:var(--sys);border-color:#27505c}.ty.consumable{color:var(--boon);border-color:#2f5a45}
.eq{font:600 .6rem/1 ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--good);border:1px solid #2f5a45;border-radius:20px;padding:3px 9px;white-space:nowrap}
.sig{color:var(--amber)}
.coin{display:flex;gap:12px}
.coin div{flex:1;text-align:center;border:1px solid var(--line);border-radius:10px;padding:12px;font-family:ui-monospace,monospace}
.coin .g{color:var(--amber)}.coin .s{color:#cfd3dd}.coin .c{color:#c08457}
.note-head{display:flex;justify-content:space-between;align-items:center}
.note-date{font:.7rem ui-monospace,monospace;color:var(--mut)}
.note-body{margin:10px 0 8px;font-size:.95rem;color:#c2c7d2}
.tags{display:flex;flex-wrap:wrap;gap:6px}
.tag{font:.66rem ui-monospace,monospace;color:var(--mut);background:#1d2230;border:1px solid var(--line);padding:2px 8px;border-radius:20px}
.empty{color:var(--mut);font-style:italic;border:1px dashed var(--line);border-radius:10px;padding:16px}
.prose{color:#bcc1cd}.prose b{color:var(--ink)}
footer{margin-top:30px;padding-top:16px;border-top:1px solid var(--line);color:var(--mut);font:.74rem ui-monospace,monospace}
@media(max-width:820px){.cols{grid-template-columns:1fr}.stats{grid-template-columns:repeat(3,1fr)}.inv{font-size:.82rem}}
@media print{body{background:#fff;color:#111;padding:0}.hero,.card,.vital,.stat{border-color:#bbb;background:#fff}h2,.eyebrow,.note-date,.badge.type{color:#444}.hero:before{display:none}}
</style></head>
<body><div class="sheet">

<header class="hero">
  <div class="eyebrow">${esc(world.name)} &middot; The System</div>
  <h1>${esc(c.name)}</h1>
  ${title ? `<div class="title">&laquo; ${esc(title)} &raquo;</div>` : ''}
  <div class="classline">${classHtml}</div>
  <div class="subline">${esc(c.race)} &middot; ${esc(c.alignment)} &middot; ${esc(c.character_type)}${origin.universe ? ' &middot; from ' + esc(origin.universe) : ''}</div>
</header>

<div class="vitals">
  <div class="vital"><div class="k">Hit Points</div><div class="v">${esc(c.hp)} / ${esc(c.max_hp)}</div><div class="hpbar"><i></i></div></div>
  <div class="vital"><div class="k">Armor Class</div><div class="v">${esc(c.ac)}</div></div>
  <div class="vital"><div class="k">Proficiency</div><div class="v">+${prof}</div></div>
  <div class="vital"><div class="k">XP</div><div class="v">${esc(c.xp)}</div></div>
</div>

<div class="stats">${statBoxes}</div>

<div class="cols">
  <main>
    <section class="block"><h2>Class Tracks &mdash; XP Pool ${esc(c.xp)}</h2>${anomalyNote}${tracksHtml}</section>
    <section class="block"><h2>Active Abilities &amp; Effects</h2>${featureCards}</section>
    <section class="block"><h2>Inventory &amp; Equipment</h2>${invHtml}</section>
    <section class="block"><h2>Coin &mdash; The Ledger</h2><div class="coin"><div><div class="g">${esc(currency.gold || 0)}</div>gold</div><div><div class="s">${esc(currency.silver || 0)}</div>silver</div><div><div class="c">${esc(currency.copper || 0)}</div>copper</div></div></section>
  </main>
  <aside>
    <section class="block"><h2>Origin</h2><div class="card"><p class="prose">${esc(c.background)}</p></div></section>
    <section class="block"><h2>Open Threads</h2>${threadsHtml}</section>
    <section class="block"><h2>Chronicle</h2>${chronicleHtml}</section>
  </aside>
</div>

<footer>Rendered from rpg.db &middot; character ${esc(CHARACTER_ID)} &middot; world ${esc(world.name)} &middot; generated ${new Date().toISOString()}<br>Source of truth: ${esc(DB_PATH)} &middot; ${effects.length} features &middot; ${inv.length} items &middot; ${notes.length} player-visible notes</footer>

</div></body></html>`;

fs.writeFileSync(OUT, html, 'utf8');
db.close();
console.log('Wrote ' + OUT + '  (' + Buffer.byteLength(html) + ' bytes)');
console.log('  character: ' + c.name + '  | features: ' + effects.length + ' | items: ' + inv.length + ' | notes: ' + notes.length);
