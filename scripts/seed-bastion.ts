/**
 * Bastion (Sebastopyr) Seeder
 * ---------------------------
 * Bridges the canon-archive bootstrap JSON (docs/bastion/rpg-mcp-bootstrap.json)
 * to the rpg-mcp engine's consolidated-tool handlers by invoking them in-process
 * with a fabricated SessionContext.
 *
 * Run:
 *   npx tsx scripts/seed-bastion.ts
 *   (or compile and: node dist/scripts/seed-bastion.js)
 *
 * This script does NOT go through the MCP transport — it imports the handler
 * functions from src/server/consolidated/* directly and calls them as functions.
 * Every write therefore lands in the same SQLite file that the live MCP server
 * uses (governed by RPG_MCP_DB_PATH / --db-path / the platform app-data default).
 *
 * Order of operations (mirrors the tool-map plan):
 *   1. world_manage.create                  (one world)
 *   2. spatial_manage.generate               (44 locations -> slug->uuid map)
 *   3. narrative_manage.batch_add (factions) (50 -> slug->uuid map)
 *   4. character_manage.create   (npcs)      (38 -> slug->uuid map)
 *   5. agent_manage.create        (llm-bindable subset)
 *   6. narrative_manage.batch_add (plot_threads)
 *   7. character_manage.create    (bestiary, characterType='enemy')
 *   8. narrative_manage.batch_add (timeline / pantheon / daily_life / bargain_ledger)
 *   9. narrative_manage.batch_add (rpg_mcp_seeds.narrative_manage_seeds, flattened)
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { handleWorldManage } from '../src/server/consolidated/world-manage.js';
import { handleSpatialManage } from '../src/server/consolidated/spatial-manage.js';
import { handleNarrativeManage } from '../src/server/consolidated/narrative-manage.js';
import { handleCharacterManage } from '../src/server/consolidated/character-manage.js';
import { handleAgentManage } from '../src/server/consolidated/agent-manage.js';
import type { SessionContext } from '../src/server/types.js';
import { getDb } from '../src/storage/index.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════

const SESSION_ID = 'bastion-seeder';
const WORLD_NAME = 'Sebastopyr';
const WORLD_SEED = 'sebastopyr-606-pd';
const WORLD_WIDTH = 400;
const WORLD_HEIGHT = 300;

const AGENT_DEFAULTS = {
    provider: 'openrouter' as const,
    model: 'anthropic/claude-sonnet-4-5',
    temperature: 0.7,
    maxTokens: 2048
};

const AUTO_ON_TURN_CATEGORIES = new Set<string>([
    'central_righteous_villain',
    'demonic_power',
    'heretical_leader_conscripted',
    'order_general_voice_of_paragon',
    'paragon',
    'paragon_of_institution'
]);

const __dirname = dirname(fileURLToPath(import.meta.url));
const BOOTSTRAP_PATH = join(__dirname, '..', 'docs', 'bastion', 'rpg-mcp-bootstrap.json');

// ═══════════════════════════════════════════════════════════════════════════
// LOOKUP TABLES
// ═══════════════════════════════════════════════════════════════════════════

const PEOPLE_TO_RACE: Record<string, string> = {
    'Vespertine human': 'Human',
    'Vesperine': 'Human',
    'Vesperine (Half-Kind)': 'Human',
    'The Vesperine': 'Human',
    'Ferrenkin': 'Dwarf',
    'The Ferrenkin': 'Dwarf',
    'Caer-Druin': 'Elf',
    'The Caer-Druin': 'Elf',
    'Caer-Druin (Hollowed)': 'Elf',
    'Mournwing': 'Aarakocra',
    'The Mournwing': 'Aarakocra',
    'Called (Battle-Mage)': 'Human',
    'Called': 'Human',
    'Demonic principality': 'Outsider',
    'Demon': 'Outsider',
    'Fiend': 'Outsider'
};

const CATEGORY_TO_CLASS: Record<string, string> = {
    'central_righteous_villain': 'Cleric',
    'chief_summoner': 'Cleric',
    'demonic_power': 'Fiend',
    'paragon': 'Paladin',
    'paragon_of_institution': 'Cleric',
    'order_general_voice_of_paragon': 'Fighter',
    'heretical_leader_conscripted': 'Warlock'
};

type TierTemplate = {
    level: number;
    hp: number;
    ac: number;
    stats: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
};

const TIER_TO_STATS: Record<number, TierTemplate> = {
    1: { level: 1, hp: 10, ac: 10, stats: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 } },
    2: { level: 3, hp: 25, ac: 13, stats: { str: 14, dex: 12, con: 13, int: 8, wis: 10, cha: 8 } },
    3: { level: 6, hp: 60, ac: 15, stats: { str: 16, dex: 14, con: 16, int: 10, wis: 12, cha: 10 } },
    4: { level: 12, hp: 120, ac: 17, stats: { str: 18, dex: 14, con: 18, int: 12, wis: 14, cha: 14 } }
};

function tierTemplate(tier: number | undefined): TierTemplate {
    if (typeof tier !== 'number' || tier < 1) return TIER_TO_STATS[1];
    if (tier >= 4) return TIER_TO_STATS[4];
    return TIER_TO_STATS[tier as 1 | 2 | 3];
}

type UrgencyBucket = 'low' | 'medium' | 'high' | 'critical';

function bucketUrgency(raw: unknown): UrgencyBucket {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n)) return 'medium';
    if (n <= 3) return 'low';
    if (n <= 6) return 'medium';
    if (n <= 8) return 'high';
    return 'critical';
}

const URBAN_TYPES = new Set(['district', 'key_location', 'building', 'shrine']);

const BIOME_KEYWORDS: Array<{ biome: 'forest' | 'mountain' | 'coastal' | 'cavern' | 'urban' | 'dungeon' | 'divine' | 'arcane'; tokens: string[] }> = [
    { biome: 'cavern',   tokens: ['cinderbelow', 'audit-below', 'undercroft', 'cave', 'gallery', 'tunnel', 'crypt', 'vault'] },
    { biome: 'coastal',  tokens: ['mire', 'marsh', 'fen', 'estuary', 'river', 'wharf', 'sea', 'shore', 'coast'] },
    { biome: 'mountain', tokens: ['stat', 'crag', 'peak', 'pass', 'ridge', 'cliff', 'spire', 'roost'] },
    { biome: 'forest',   tokens: ['wood', 'forest', 'grove', 'wald', 'wild', 'thicket'] },
    { biome: 'divine',   tokens: ['cathedral', 'sanctuary', 'altar', 'reliquary', 'shrine', 'apse'] },
    { biome: 'arcane',   tokens: ['ward', 'sigil', 'circle', 'binding', 'rite', 'cantor'] }
];

function pickBiome(raw: BootstrapLocation['raw']): 'forest' | 'mountain' | 'urban' | 'dungeon' | 'coastal' | 'cavern' | 'divine' | 'arcane' {
    const type = (raw?.type ?? '').toLowerCase();
    if (URBAN_TYPES.has(type)) return 'urban';

    const haystack = [raw?.atlas, raw?.character, raw?.name, raw?.atmosphere]
        .filter((x): x is string => typeof x === 'string')
        .join(' ')
        .toLowerCase();

    for (const { biome, tokens } of BIOME_KEYWORDS) {
        if (tokens.some(t => haystack.includes(t))) return biome;
    }
    return 'urban';
}

const ATMOSPHERIC_TOKENS: Array<'DARKNESS' | 'FOG' | 'ANTIMAGIC' | 'SILENCE' | 'BRIGHT' | 'MAGICAL'> =
    ['DARKNESS', 'FOG', 'ANTIMAGIC', 'SILENCE', 'BRIGHT', 'MAGICAL'];

function scanAtmospherics(atmosphere: string | undefined): Array<'DARKNESS' | 'FOG' | 'ANTIMAGIC' | 'SILENCE' | 'BRIGHT' | 'MAGICAL'> {
    if (!atmosphere) return [];
    const lower = atmosphere.toLowerCase();
    const hits: Array<'DARKNESS' | 'FOG' | 'ANTIMAGIC' | 'SILENCE' | 'BRIGHT' | 'MAGICAL'> = [];
    if (/(dark|gloom|black|shadow|night|cinder)/.test(lower)) hits.push('DARKNESS');
    if (/(fog|mist|haze|smoke|vapou?r)/.test(lower)) hits.push('FOG');
    if (/(antimagic|null|warded|silenced rite)/.test(lower)) hits.push('ANTIMAGIC');
    if (/(silence|hush|quiet|muted)/.test(lower)) hits.push('SILENCE');
    if (/(bright|sunlit|honey-light|lit|candle)/.test(lower)) hits.push('BRIGHT');
    if (/(arcane|magical|sigil|warding|liturg)/.test(lower)) hits.push('MAGICAL');
    // Dedupe while preserving order
    return Array.from(new Set(hits)).filter((t): t is typeof ATMOSPHERIC_TOKENS[number] =>
        (ATMOSPHERIC_TOKENS as readonly string[]).includes(t)
    );
}

const DISTRICT_RING_ORDER = [
    'apex', 'upper terraces', 'upper-mid', 'mid', 'under', 'cinderbelow'
];

// ═══════════════════════════════════════════════════════════════════════════
// BOOTSTRAP TYPES (loose — bootstrap is heterogenous)
// ═══════════════════════════════════════════════════════════════════════════

interface BootstrapLocation {
    id: string;
    name: string;
    summary?: string;
    kind?: string;
    parent?: string;
    raw?: {
        type?: string;
        name?: string;
        ring?: string;
        character?: string;
        atmosphere?: string;
        atlas?: string;
        key_npcs?: string[];
        key_buildings?: string[];
        throughline_tests?: number[];
        [k: string]: unknown;
    };
}

interface BootstrapFaction {
    id: string;
    name: string;
    summary?: string;
    raw: {
        id: string;
        name: string;
        tier?: string;
        leader?: string;
        seat?: string;
        goal_stated?: string;
        goal_actual?: string;
        now?: string;
        secret?: string;
        allies?: string[];
        rivals?: string[];
        secretly_compromised_by?: string[];
        standing?: unknown;
        debt?: unknown;
        tags?: string[];
        [k: string]: unknown;
    };
}

interface BootstrapNpc {
    id: string;
    name: string;
    summary?: string;
    raw: {
        id: string;
        name: string;
        role?: string;
        faction?: string;
        people?: string;
        category?: string;
        llm_bindable?: boolean;
        agent_overrides?: {
            provider?: 'openai' | 'openrouter';
            model?: string;
            temperature?: number;
            maxTokens?: number;
            budgetTokens?: number;
            timeoutMs?: number;
        };
        stain_apparent?: string;
        stain_actual?: number;
        aspersoir_tick?: number;
        grace_pool?: number;
        knownSpells?: string[];
        [k: string]: unknown;
    };
}

interface BootstrapPlot {
    id: string;
    name: string;
    summary?: string;
    raw: {
        type?: string;
        name?: string;
        short_name?: string;
        status?: 'active' | 'dormant' | 'resolved';
        urgency?: number;
        throughline_tests?: number[];
        summary?: string;
        principals?: string[];
        hooks?: string[];
        resolution_conditions?: string[];
        canonical_moment_if_fired?: string;
        [k: string]: unknown;
    };
}

interface BootstrapBeast {
    id: string;
    name: string;
    summary?: string;
    raw: {
        id: string;
        name: string;
        tier?: number;
        domain?: string;
        signature?: string;
        vulnerability?: string;
        habitat?: string;
        narrative_role?: string;
        encounter_size?: string;
        tone_anchor?: string;
        [k: string]: unknown;
    };
}

interface BootstrapTimelineEvent {
    id: string;
    name: string;
    summary?: string;
    raw: {
        entry_type?: string;
        name?: string;
        event_name?: string;
        year?: string | number;
        description?: string;
        era?: string;
        [k: string]: unknown;
    };
}

interface BootstrapPantheon {
    id: string;
    name: string;
    summary?: string;
    raw: {
        type?: string;
        name?: string;
        archetype?: string;
        domain?: string;
        description?: string;
        [k: string]: unknown;
    };
}

interface BootstrapDaily {
    id: string;
    name: string;
    summary?: string;
    raw: {
        entry_type?: string;
        kind?: string;
        type?: string;
        name?: string;
        [k: string]: unknown;
    };
}

interface BootstrapBargain {
    id: string;
    name: string;
    bargain_type?: string;
    status?: string;
    struck?: string;
    parties?: {
        obligor?: { npc_id?: string; name?: string };
        creditor?: { npc_id_or_faction?: string; name?: string };
    };
    principal?: string;
    price?: string;
    collateral?: string;
    payment_schedule?: Record<string, unknown>;
    markers_held?: string[];
    readings?: Array<Record<string, unknown>>;
    discharge_terms?: string[];
    collection_triggers?: string[];
    throughline_tests?: number[];
    [k: string]: unknown;
}

interface BootstrapNarrativeSeedWrapper {
    narrative_manage_seeds?: Array<{
        action: string;
        items?: Array<{
            type: 'plot_thread' | 'canonical_moment' | 'npc_voice' | 'foreshadowing' | 'session_log';
            title?: string;
            content: string;
            tags?: string[];
            metadata?: Record<string, unknown>;
            visibility?: 'dm_only' | 'player_visible';
            status?: 'active' | 'resolved' | 'dormant' | 'archived';
            entityId?: string;
            entityType?: 'character' | 'npc' | 'location' | 'item';
        }>;
    }>;
}

interface Bootstrap {
    version?: string;
    city: {
        name?: string;
        world?: string;
        continent?: string;
        etymology?: string;
        wall_name?: string;
        raw_gap_fill?: Record<string, unknown>;
        [k: string]: unknown;
    };
    locations: BootstrapLocation[];
    factions: BootstrapFaction[];
    npcs: BootstrapNpc[];
    plot_threads: BootstrapPlot[];
    bestiary: BootstrapBeast[];
    timeline: BootstrapTimelineEvent[];
    pantheon: BootstrapPantheon[];
    daily_life: BootstrapDaily[];
    bargain_ledger?: { bench_rate?: unknown; accounts?: BootstrapBargain[] };
    rpg_mcp_seeds?: { narrative_manage?: BootstrapNarrativeSeedWrapper[] };
    [k: string]: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════
// STATE & SHARED HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const slugToUuid = new Map<string, string>();   // generic slug -> engine UUID

const ctx: SessionContext = { sessionId: SESSION_ID };

interface PhaseCounters { created: number; skipped: number; failed: number }

function newCounters(): PhaseCounters { return { created: 0, skipped: 0, failed: 0 }; }

function log(msg: string): void {
    // Use stderr so we don't pollute stdout if the seeder ever gets wired into a pipeline.
    process.stderr.write(`[seed-bastion] ${msg}\n`);
}

/**
 * Strip the RichFormatter shell off a handler response and pull out the
 * embedded JSON block. Falls back to parsing the raw text as JSON.
 */
function extractJson(payload: unknown): Record<string, unknown> {
    const response = payload as { content?: Array<{ text?: string }> } | undefined;
    const text = response?.content?.[0]?.text ?? '';
    if (!text) return {};

    // Look for an embedded fenced JSON block emitted by RichFormatter.embedJson
    // (which writes "```json\n{ ... }\n```" inside an HTML comment).
    const fence = text.match(/```json\s*([\s\S]*?)```/);
    if (fence) {
        try { return JSON.parse(fence[1]); } catch { /* fall through */ }
    }
    try { return JSON.parse(text); } catch { return { _raw: text }; }
}

async function call<T extends Record<string, unknown>>(
    handler: (args: unknown, ctx: SessionContext) => Promise<unknown>,
    args: T
): Promise<Record<string, unknown>> {
    const result = await handler(args, ctx);
    return extractJson(result);
}

function ensureBaseDescription(parts: Array<string | undefined>): string {
    const joined = parts.filter(Boolean).map(s => (s as string).trim()).join(' — ').trim();
    if (joined.length >= 10) return joined;
    // Pad short descriptions to satisfy the schema's min(10).
    return (joined || 'A place in Sebastopyr.') + ' '.repeat(Math.max(0, 10 - joined.length));
}

function chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1 — WORLD
// ═══════════════════════════════════════════════════════════════════════════

async function seedWorld(boot: Bootstrap): Promise<{ worldId: string; counters: PhaseCounters }> {
    const counters = newCounters();
    log(`Phase 1/9: world_manage.create  (name="${boot.city.name ?? WORLD_NAME}")`);

    try {
        const data = await call(handleWorldManage, {
            action: 'create',
            name: boot.city.name ?? WORLD_NAME,
            seed: WORLD_SEED,
            width: WORLD_WIDTH,
            height: WORLD_HEIGHT
        });

        const worldId = String(data.worldId ?? '');
        if (!worldId) throw new Error('world_manage.create returned no worldId');
        slugToUuid.set('world:sebastopyr', worldId);
        counters.created += 1;
        log(`  ✓ world ${worldId}`);

        // Offload the huge etymology + raw_gap_fill block to a narrative note so
        // we don't lose canon. The world table has no field for prose lore.
        const cityDump = JSON.stringify({
            world: boot.city.world,
            continent: boot.city.continent,
            etymology: boot.city.etymology,
            wall_name: boot.city.wall_name,
            raw_gap_fill: boot.city.raw_gap_fill
        });
        try {
            await call(handleNarrativeManage, {
                action: 'add',
                worldId,
                type: 'canonical_moment',
                content: `Sebastopyr — world lore dump (Aevarn / Therimaur). ${(boot.city.etymology ?? '').slice(0, 240)}…`,
                metadata: { city: cityDump },
                tags: ['world_lore', 'aevarn', 'therimaur'],
                visibility: 'dm_only'
            });
            counters.created += 1;
        } catch (err) {
            counters.failed += 1;
            log(`  ! could not stash city lore: ${String((err as Error).message)}`);
        }

        return { worldId, counters };
    } catch (err) {
        counters.failed += 1;
        log(`  ✗ world create failed: ${String((err as Error).message)}`);
        throw err;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2 — LOCATIONS  (44 entries -> spatial_manage.generate, build slug map)
// ═══════════════════════════════════════════════════════════════════════════

async function seedLocations(boot: Bootstrap, worldId: string): Promise<PhaseCounters> {
    const counters = newCounters();
    log(`Phase 2/9: spatial_manage.generate × ${boot.locations.length}`);

    // Walk the districts in ring order first so each subsequent district links
    // back to the previous one (forming the concentric ring chain). Then walk
    // everything else (key_locations, geography_features) without chaining.
    const districts = boot.locations.filter(l => (l.raw?.type ?? l.kind) === 'district');
    const others    = boot.locations.filter(l => (l.raw?.type ?? l.kind) !== 'district');

    districts.sort((a, b) => {
        const aRank = DISTRICT_RING_ORDER.indexOf((a.raw?.ring ?? '').toLowerCase());
        const bRank = DISTRICT_RING_ORDER.indexOf((b.raw?.ring ?? '').toLowerCase());
        if (aRank === -1 && bRank === -1) return a.id.localeCompare(b.id);
        if (aRank === -1) return 1;
        if (bRank === -1) return -1;
        return aRank - bRank;
    });

    let previousNodeId: string | undefined;

    for (const loc of districts) {
        const ok = await seedOneLocation(loc, worldId, previousNodeId, counters);
        if (ok) previousNodeId = ok;
    }
    for (const loc of others) {
        await seedOneLocation(loc, worldId, undefined, counters);
    }
    return counters;
}

async function seedOneLocation(
    loc: BootstrapLocation,
    worldId: string,
    previousNodeId: string | undefined,
    counters: PhaseCounters
): Promise<string | null> {
    const raw = loc.raw ?? {};
    const baseDescription = ensureBaseDescription([raw.character, raw.atmosphere, loc.summary]);
    const biome = pickBiome(raw);
    const atmospherics = scanAtmospherics(raw.atmosphere);

    try {
        const data = await call(handleSpatialManage, {
            action: 'generate',
            name: loc.name,
            baseDescription,
            biomeContext: biome,
            atmospherics,
            ...(previousNodeId ? { previousNodeId, direction: 'east' } : {})
        });

        const roomId = String(data.roomId ?? '');
        if (!roomId) throw new Error('spatial_manage.generate returned no roomId');
        slugToUuid.set(`location:${loc.id}`, roomId);
        counters.created += 1;

        // Stash the rich location metadata as a canonical_moment note linked
        // to the new room (entityType=location). This is the only place ring,
        // key_npcs, key_buildings, and throughline_tests can ride along.
        try {
            await call(handleNarrativeManage, {
                action: 'add',
                worldId,
                type: 'canonical_moment',
                content: `Location meta: ${loc.name} — ring=${raw.ring ?? 'n/a'}, type=${raw.type ?? loc.kind ?? 'unknown'}.`,
                metadata: {
                    locationId: roomId,
                    ring: raw.ring,
                    type: raw.type ?? loc.kind,
                    key_npcs: raw.key_npcs ?? [],
                    key_buildings: raw.key_buildings ?? [],
                    throughline_tests: raw.throughline_tests ?? []
                },
                tags: ['location_meta', String(raw.type ?? loc.kind ?? 'location')],
                entityId: roomId,
                entityType: 'location'
            });
            counters.created += 1;
        } catch (err) {
            counters.failed += 1;
            log(`  ! location meta-note failed for ${loc.id}: ${String((err as Error).message)}`);
        }

        return roomId;
    } catch (err) {
        counters.failed += 1;
        log(`  ✗ ${loc.id} (${loc.name}): ${String((err as Error).message)}`);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3 — FACTIONS (50 entries -> narrative_manage.batch_add, build slug map)
// ═══════════════════════════════════════════════════════════════════════════

const factionNameToUuid = new Map<string, string>();   // name token -> note uuid

async function seedFactions(boot: Bootstrap, worldId: string): Promise<PhaseCounters> {
    const counters = newCounters();
    log(`Phase 3/9: narrative_manage.batch_add (factions × ${boot.factions.length})`);

    // batch_add takes max 20 per call.
    const batches = chunk(boot.factions, 20);
    for (let bi = 0; bi < batches.length; bi++) {
        const batch = batches[bi];
        const notes = batch.map(f => ({
            type: 'canonical_moment' as const,
            content: buildFactionContent(f),
            metadata: f.raw as Record<string, unknown>,
            tags: factionTags(f),
            visibility: 'dm_only' as const,
            status: 'active' as const
        }));

        try {
            const data = await call(handleNarrativeManage, {
                action: 'batch_add',
                worldId,
                notes
            });
            const created = Array.isArray(data.notes) ? (data.notes as Array<{ noteId: string }>) : [];
            for (let i = 0; i < created.length; i++) {
                const f = batch[i];
                const noteId = created[i].noteId;
                slugToUuid.set(`faction:${f.id}`, noteId);
                // Also index by faction display-name so NPC.raw.faction strings can resolve.
                factionNameToUuid.set(f.name.trim().toLowerCase(), noteId);
                counters.created += 1;
            }
            log(`  ✓ batch ${bi + 1}/${batches.length}: ${created.length} factions`);
        } catch (err) {
            counters.failed += batch.length;
            log(`  ✗ faction batch ${bi + 1}/${batches.length} failed: ${String((err as Error).message)}`);
        }
    }

    return counters;
}

function buildFactionContent(f: BootstrapFaction): string {
    const r = f.raw;
    return [
        `${f.name} (tier:${r.tier ?? 'unknown'}).`,
        r.leader ? `Leader: ${r.leader}.` : '',
        r.seat ? `Seat: ${r.seat}.` : '',
        r.goal_stated ? `Stated goal: ${r.goal_stated}.` : '',
        r.goal_actual ? `Actual goal: ${r.goal_actual}.` : '',
        r.now ? `Now: ${r.now}.` : '',
        r.secret ? `Secret: ${r.secret}` : ''
    ].filter(Boolean).join(' ');
}

function factionTags(f: BootstrapFaction): string[] {
    const out = ['faction'];
    if (f.raw.tier) out.push(`tier:${f.raw.tier}`);
    if (Array.isArray(f.raw.tags)) out.push(...f.raw.tags);
    return out;
}

/**
 * Resolve npc.raw.faction (a free-text label, possibly with '/' separators)
 * down to the first matching faction-note UUID. Tries id-style slug match
 * first, then case-insensitive name match against each "/"-split segment.
 */
function resolveFactionId(factionLabel: string | undefined): string | undefined {
    if (!factionLabel) return undefined;
    const segments = factionLabel.split('/').map(s => s.trim()).filter(Boolean);
    for (const seg of segments) {
        const direct = slugToUuid.get(`faction:${seg}`);
        if (direct) return direct;
        const byName = factionNameToUuid.get(seg.toLowerCase());
        if (byName) return byName;
    }
    return undefined;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4 — NPCs  (character_manage.create characterType='npc')
// ═══════════════════════════════════════════════════════════════════════════

async function seedNpcs(boot: Bootstrap, worldId: string): Promise<PhaseCounters> {
    const counters = newCounters();
    log(`Phase 4/9: character_manage.create × ${boot.npcs.length} (NPCs)`);

    for (const npc of boot.npcs) {
        const raw = npc.raw;
        const race = PEOPLE_TO_RACE[raw.people ?? ''] ?? 'Human';
        const klass = CATEGORY_TO_CLASS[raw.category ?? ''] ?? 'Adventurer';
        const factionId = resolveFactionId(raw.faction);

        const segments = (raw.faction ?? '').split('/').map(s => s.trim()).filter(Boolean);
        const behaviorParts: string[] = [];
        if (raw.role) behaviorParts.push(raw.role);
        if (segments.length > 1) behaviorParts.push(`Faction labels: ${segments.join(' / ')}`);

        try {
            const data = await call(handleCharacterManage, {
                action: 'create',
                name: raw.name,
                characterType: 'npc',
                provisionEquipment: false,
                race,
                class: klass,
                level: 1,
                stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
                ac: 10,
                ...(factionId ? { factionId } : {}),
                ...(behaviorParts.length ? { behavior: behaviorParts.join('. ') } : {}),
                ...(Array.isArray(raw.knownSpells) && raw.knownSpells.length
                    ? { knownSpells: raw.knownSpells }
                    : {})
            });

            const characterId = String(data.id ?? data.characterId ?? '');
            if (!characterId) throw new Error('character_manage.create returned no id');
            slugToUuid.set(`npc:${raw.id}`, characterId);
            counters.created += 1;

            // If the bootstrap carries Stain / Grace / aspersoir_tick figures, park
            // them in an npc_voice note linked to the new character — CreateSchema
            // has no slot for them.
            const hasMystery = raw.stain_apparent !== undefined
                || typeof raw.stain_actual === 'number'
                || typeof raw.aspersoir_tick === 'number'
                || typeof raw.grace_pool === 'number';

            if (hasMystery) {
                try {
                    await call(handleNarrativeManage, {
                        action: 'add',
                        worldId,
                        type: 'npc_voice',
                        content: `Mystic state for ${raw.name}: stain_apparent=${raw.stain_apparent ?? 'unknown'}, stain_actual=${raw.stain_actual ?? 'unknown'}, aspersoir_tick=${raw.aspersoir_tick ?? 'n/a'}, grace_pool=${raw.grace_pool ?? 'n/a'}.`,
                        metadata: {
                            characterId,
                            stain_apparent: raw.stain_apparent,
                            stain_actual: raw.stain_actual,
                            aspersoir_tick: raw.aspersoir_tick,
                            grace_pool: raw.grace_pool
                        },
                        tags: ['npc_state', 'stain'],
                        entityId: characterId,
                        entityType: 'character'
                    });
                    counters.created += 1;
                } catch (err) {
                    counters.failed += 1;
                    log(`  ! mystic-state note failed for ${raw.id}: ${String((err as Error).message)}`);
                }
            }
        } catch (err) {
            counters.failed += 1;
            log(`  ✗ npc ${raw.id} (${raw.name}): ${String((err as Error).message)}`);
        }
    }

    return counters;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 5 — AGENTS (llm-bindable subset)
// ═══════════════════════════════════════════════════════════════════════════

async function seedAgents(boot: Bootstrap): Promise<PhaseCounters> {
    const counters = newCounters();
    const bindable = boot.npcs.filter(n => n.raw.llm_bindable === true);
    log(`Phase 5/9: agent_manage.create × ${bindable.length}`);

    for (const npc of bindable) {
        const characterId = slugToUuid.get(`npc:${npc.raw.id}`);
        if (!characterId) {
            counters.skipped += 1;
            log(`  ⤳ skipped ${npc.raw.id}: no character mapping`);
            continue;
        }

        const overrides = npc.raw.agent_overrides ?? {};
        const autoOnTurn = npc.raw.category
            ? AUTO_ON_TURN_CATEGORIES.has(npc.raw.category)
            : false;

        try {
            await call(handleAgentManage, {
                action: 'create',
                characterId,
                provider: overrides.provider ?? AGENT_DEFAULTS.provider,
                model: overrides.model ?? AGENT_DEFAULTS.model,
                autoOnTurn,
                temperature: overrides.temperature ?? AGENT_DEFAULTS.temperature,
                maxTokens: overrides.maxTokens ?? AGENT_DEFAULTS.maxTokens,
                ...(overrides.budgetTokens !== undefined ? { budgetTokens: overrides.budgetTokens } : {}),
                ...(overrides.timeoutMs !== undefined ? { timeoutMs: overrides.timeoutMs } : {})
            });
            counters.created += 1;
        } catch (err) {
            counters.failed += 1;
            log(`  ✗ agent for ${npc.raw.id}: ${String((err as Error).message)}`);
        }
    }

    return counters;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 6 — PLOT THREADS
// ═══════════════════════════════════════════════════════════════════════════

async function seedPlotThreads(boot: Bootstrap, worldId: string): Promise<PhaseCounters> {
    const counters = newCounters();
    log(`Phase 6/9: narrative_manage.batch_add (plot_threads × ${boot.plot_threads.length})`);

    const batches = chunk(boot.plot_threads, 20);
    for (let bi = 0; bi < batches.length; bi++) {
        const batch = batches[bi];
        const notes = batch.map(p => {
            const r = p.raw;
            const tags = ['plot_thread', `urgency:${r.urgency ?? 'unknown'}`];
            if (Array.isArray(r.throughline_tests)) {
                for (const n of r.throughline_tests) tags.push(`throughline_${n}`);
            }
            return {
                type: 'plot_thread' as const,
                content: r.summary || r.short_name || p.name,
                metadata: {
                    urgency: bucketUrgency(r.urgency),
                    hooks: r.hooks ?? [],
                    resolution_conditions: r.resolution_conditions ?? [],
                    principals: r.principals ?? [],
                    throughline_tests: r.throughline_tests ?? [],
                    canonical_moment_if_fired: r.canonical_moment_if_fired ?? null
                } as Record<string, unknown>,
                tags,
                status: (r.status ?? 'active') as 'active' | 'dormant' | 'resolved'
            };
        });

        try {
            const data = await call(handleNarrativeManage, {
                action: 'batch_add',
                worldId,
                notes
            });
            const created = Array.isArray(data.notes) ? (data.notes as unknown[]) : [];
            counters.created += created.length;
            log(`  ✓ batch ${bi + 1}/${batches.length}: ${created.length} plot threads`);
        } catch (err) {
            counters.failed += batch.length;
            log(`  ✗ plot batch ${bi + 1}/${batches.length} failed: ${String((err as Error).message)}`);
        }
    }

    return counters;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 7 — BESTIARY (character_manage.create characterType='enemy')
// ═══════════════════════════════════════════════════════════════════════════

async function seedBestiary(boot: Bootstrap, worldId: string): Promise<PhaseCounters> {
    const counters = newCounters();
    log(`Phase 7/9: character_manage.create × ${boot.bestiary.length} (enemies)`);

    for (const beast of boot.bestiary) {
        const r = beast.raw;
        const tpl = tierTemplate(r.tier);
        const behavior = [
            r.signature ? `Signature: ${r.signature}.` : '',
            r.vulnerability ? `Vulnerability: ${r.vulnerability}.` : '',
            r.habitat ? `Habitat: ${r.habitat}.` : '',
            r.tone_anchor ? `Tone: ${r.tone_anchor}.` : ''
        ].filter(Boolean).join(' ');

        try {
            const data = await call(handleCharacterManage, {
                action: 'create',
                name: r.name,
                characterType: 'enemy',
                provisionEquipment: false,
                race: 'Monstrosity',
                class: `${r.domain ?? 'Unknown'}-tier${r.tier ?? '?'}`,
                level: tpl.level,
                stats: tpl.stats,
                hp: tpl.hp,
                maxHp: tpl.hp,
                ac: tpl.ac,
                ...(behavior ? { behavior } : {})
            });

            const characterId = String(data.id ?? data.characterId ?? '');
            if (!characterId) throw new Error('character_manage.create returned no id');
            slugToUuid.set(`bestiary:${r.id}`, characterId);
            counters.created += 1;

            // Stash encounter_size / narrative_role on a meta note.
            try {
                await call(handleNarrativeManage, {
                    action: 'add',
                    worldId,
                    type: 'canonical_moment',
                    content: `Bestiary meta: ${r.name} (tier ${r.tier ?? '?'}). Encounter size: ${r.encounter_size ?? 'n/a'}. Narrative role: ${r.narrative_role ?? 'n/a'}.`,
                    metadata: {
                        characterId,
                        encounter_size: r.encounter_size,
                        narrative_role: r.narrative_role,
                        tier: r.tier,
                        domain: r.domain
                    },
                    tags: ['bestiary_meta', `tier:${r.tier ?? 'unknown'}`],
                    entityId: characterId,
                    entityType: 'character'
                });
                counters.created += 1;
            } catch (err) {
                counters.failed += 1;
                log(`  ! bestiary meta-note failed for ${r.id}: ${String((err as Error).message)}`);
            }
        } catch (err) {
            counters.failed += 1;
            log(`  ✗ bestiary ${r.id} (${r.name}): ${String((err as Error).message)}`);
        }
    }

    return counters;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 8 — TIMELINE / PANTHEON / DAILY LIFE
// ═══════════════════════════════════════════════════════════════════════════

async function seedTimeline(boot: Bootstrap, worldId: string): Promise<PhaseCounters> {
    const counters = newCounters();
    log(`Phase 8a/9: narrative_manage.batch_add (timeline × ${boot.timeline.length})`);

    const batches = chunk(boot.timeline, 20);
    for (let bi = 0; bi < batches.length; bi++) {
        const batch = batches[bi];
        const notes = batch.map(e => {
            const r = e.raw;
            const eventName = r.event_name ?? r.name ?? e.name;
            const tags = ['timeline', `era:${r.era ?? 'unknown'}`];
            if (r.year !== undefined) tags.push(`pd:${r.year}`);
            return {
                type: 'canonical_moment' as const,
                content: `${eventName} (${r.year ?? 'n/a'}): ${r.description ?? e.summary ?? ''}`.trim(),
                metadata: r as Record<string, unknown>,
                tags
            };
        });

        try {
            const data = await call(handleNarrativeManage, {
                action: 'batch_add',
                worldId,
                notes
            });
            const created = Array.isArray(data.notes) ? (data.notes as unknown[]) : [];
            counters.created += created.length;
            log(`  ✓ timeline batch ${bi + 1}/${batches.length}: ${created.length}`);
        } catch (err) {
            counters.failed += batch.length;
            log(`  ✗ timeline batch ${bi + 1}/${batches.length}: ${String((err as Error).message)}`);
        }
    }

    return counters;
}

async function seedPantheon(boot: Bootstrap, worldId: string): Promise<PhaseCounters> {
    const counters = newCounters();
    log(`Phase 8b/9: narrative_manage.batch_add (pantheon × ${boot.pantheon.length})`);

    const batches = chunk(boot.pantheon, 20);
    for (let bi = 0; bi < batches.length; bi++) {
        const batch = batches[bi];
        const notes = batch.map(p => {
            const r = p.raw;
            const tags = ['pantheon', `archetype:${r.archetype ?? 'unknown'}`];
            return {
                type: 'canonical_moment' as const,
                content: `${r.name ?? p.name} (${r.archetype ?? 'unknown'}): ${r.domain ?? ''}. ${r.description ?? p.summary ?? ''}`.trim(),
                metadata: r as Record<string, unknown>,
                tags
            };
        });

        try {
            const data = await call(handleNarrativeManage, {
                action: 'batch_add',
                worldId,
                notes
            });
            const created = Array.isArray(data.notes) ? (data.notes as unknown[]) : [];
            counters.created += created.length;
            log(`  ✓ pantheon batch ${bi + 1}/${batches.length}: ${created.length}`);
        } catch (err) {
            counters.failed += batch.length;
            log(`  ✗ pantheon batch ${bi + 1}/${batches.length}: ${String((err as Error).message)}`);
        }
    }
    return counters;
}

async function seedDailyLife(boot: Bootstrap, worldId: string): Promise<PhaseCounters> {
    const counters = newCounters();
    log(`Phase 8c/9: narrative_manage.batch_add (daily_life × ${boot.daily_life.length})`);

    const batches = chunk(boot.daily_life, 20);
    for (let bi = 0; bi < batches.length; bi++) {
        const batch = batches[bi];
        const notes = batch.map(d => {
            const r = d.raw;
            const subkind = r.kind ?? r.type ?? r.entry_type ?? 'misc';
            return {
                type: 'canonical_moment' as const,
                content: JSON.stringify(r).slice(0, 4000),
                metadata: r as Record<string, unknown>,
                tags: ['daily_life', `subkind:${subkind}`]
            };
        });

        try {
            const data = await call(handleNarrativeManage, {
                action: 'batch_add',
                worldId,
                notes
            });
            const created = Array.isArray(data.notes) ? (data.notes as unknown[]) : [];
            counters.created += created.length;
            log(`  ✓ daily_life batch ${bi + 1}/${batches.length}: ${created.length}`);
        } catch (err) {
            counters.failed += batch.length;
            log(`  ✗ daily_life batch ${bi + 1}/${batches.length}: ${String((err as Error).message)}`);
        }
    }
    return counters;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 9 — BARGAIN LEDGER  +  NESTED narrative_manage_seeds
// ═══════════════════════════════════════════════════════════════════════════

async function seedBargainLedger(boot: Bootstrap, worldId: string): Promise<PhaseCounters> {
    const counters = newCounters();
    const accounts = boot.bargain_ledger?.accounts ?? [];
    if (accounts.length === 0) {
        log('Phase 9a/9: bargain_ledger has no accounts; skipping');
        return counters;
    }
    log(`Phase 9a/9: narrative_manage.batch_add (bargain_ledger × ${accounts.length})`);

    const batches = chunk(accounts, 20);
    for (let bi = 0; bi < batches.length; bi++) {
        const batch = batches[bi];
        const notes = batch.map(b => {
            const obligor = b.parties?.obligor ?? {};
            const creditor = b.parties?.creditor ?? {};
            const readings = Array.isArray(b.readings) ? b.readings : [];
            const hasScheduled = readings.some(r => {
                const result = (r as { result?: string }).result;
                return typeof result === 'string' && result.toUpperCase().includes('SCHEDULED');
            });
            const urgency: UrgencyBucket = (b.status === 'open' && hasScheduled) ? 'critical' : 'high';

            const content = [
                `${b.name}.`,
                `Type: ${b.bargain_type ?? 'unknown'}.`,
                `Status: ${b.status ?? 'unknown'}.`,
                b.struck ? `Struck: ${b.struck}.` : '',
                `Parties: ${obligor.name ?? '?'} -> ${creditor.name ?? '?'}.`,
                b.principal ? `Principal: ${b.principal}.` : '',
                b.price ? `Price: ${b.price}` : ''
            ].filter(Boolean).join(' ');

            const entityId = obligor.npc_id ? slugToUuid.get(`npc:${obligor.npc_id}`) : undefined;

            return {
                type: 'plot_thread' as const,
                content,
                metadata: {
                    urgency,
                    hooks: b.collection_triggers ?? [],
                    resolution_conditions: b.discharge_terms ?? [],
                    parties: b.parties,
                    payment_schedule: b.payment_schedule,
                    markers_held: b.markers_held,
                    readings: b.readings,
                    throughline_tests: b.throughline_tests ?? [],
                    bargain_type: b.bargain_type
                } as Record<string, unknown>,
                tags: ['bargain', 'ledger', `type:${b.bargain_type ?? 'unknown'}`, `status:${b.status ?? 'unknown'}`],
                ...(entityId ? { entityId, entityType: 'character' as const } : {})
            };
        });

        try {
            const data = await call(handleNarrativeManage, {
                action: 'batch_add',
                worldId,
                notes
            });
            const created = Array.isArray(data.notes) ? (data.notes as unknown[]) : [];
            counters.created += created.length;
            log(`  ✓ bargain batch ${bi + 1}/${batches.length}: ${created.length}`);
        } catch (err) {
            counters.failed += batch.length;
            log(`  ✗ bargain batch ${bi + 1}/${batches.length}: ${String((err as Error).message)}`);
        }
    }
    return counters;
}

async function seedNestedNarrativeSeeds(boot: Bootstrap, worldId: string): Promise<PhaseCounters> {
    const counters = newCounters();
    const wrappers = boot.rpg_mcp_seeds?.narrative_manage ?? [];
    if (wrappers.length === 0) {
        log('Phase 9b/9: rpg_mcp_seeds.narrative_manage empty; skipping');
        return counters;
    }

    // Flatten: every outer entry has narrative_manage_seeds[]; each of those has
    // items[]; items[].title -> metadata.title + content prefix; rename items->notes;
    // inject worldId at the call envelope.
    const flat: Array<{
        type: 'plot_thread' | 'canonical_moment' | 'npc_voice' | 'foreshadowing' | 'session_log';
        content: string;
        tags?: string[];
        metadata?: Record<string, unknown>;
        visibility?: 'dm_only' | 'player_visible';
        status?: 'active' | 'resolved' | 'dormant' | 'archived';
        entityId?: string;
        entityType?: 'character' | 'npc' | 'location' | 'item';
    }> = [];

    for (const wrapper of wrappers) {
        for (const seedCall of (wrapper.narrative_manage_seeds ?? [])) {
            for (const item of (seedCall.items ?? [])) {
                const title = item.title;
                const content = title ? `${title} -- ${item.content}` : item.content;
                const metadata: Record<string, unknown> = { ...(item.metadata ?? {}) };
                if (title) metadata.title = title;
                flat.push({
                    type: item.type,
                    content,
                    tags: item.tags ?? [],
                    metadata,
                    visibility: item.visibility ?? 'dm_only',
                    status: item.status ?? 'active',
                    ...(item.entityId ? { entityId: item.entityId } : {}),
                    ...(item.entityType ? { entityType: item.entityType } : {})
                });
            }
        }
    }

    log(`Phase 9b/9: narrative_manage.batch_add (rpg_mcp_seeds × ${flat.length})`);

    const batches = chunk(flat, 20);
    for (let bi = 0; bi < batches.length; bi++) {
        try {
            const data = await call(handleNarrativeManage, {
                action: 'batch_add',
                worldId,
                notes: batches[bi]
            });
            const created = Array.isArray(data.notes) ? (data.notes as unknown[]) : [];
            counters.created += created.length;
            log(`  ✓ seed batch ${bi + 1}/${batches.length}: ${created.length}`);
        } catch (err) {
            counters.failed += batches[bi].length;
            log(`  ✗ seed batch ${bi + 1}/${batches.length}: ${String((err as Error).message)}`);
        }
    }

    return counters;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
    log(`Loading bootstrap from ${BOOTSTRAP_PATH}`);
    const boot = JSON.parse(readFileSync(BOOTSTRAP_PATH, 'utf-8')) as Bootstrap;
    log(`Loaded: ${boot.locations.length} locations, ${boot.factions.length} factions, ${boot.npcs.length} npcs, ${boot.plot_threads.length} plots, ${boot.bestiary.length} beasts`);

    // Touch the DB once up front so the migrations run before any handler call.
    getDb();

    const totals = newCounters();

    const merge = (c: PhaseCounters) => {
        totals.created += c.created;
        totals.skipped += c.skipped;
        totals.failed += c.failed;
    };

    try {
        const { worldId, counters: c1 } = await seedWorld(boot);
        merge(c1);

        merge(await seedLocations(boot, worldId));
        merge(await seedFactions(boot, worldId));
        merge(await seedNpcs(boot, worldId));
        merge(await seedAgents(boot));
        merge(await seedPlotThreads(boot, worldId));
        merge(await seedBestiary(boot, worldId));
        merge(await seedTimeline(boot, worldId));
        merge(await seedPantheon(boot, worldId));
        merge(await seedDailyLife(boot, worldId));
        merge(await seedBargainLedger(boot, worldId));
        merge(await seedNestedNarrativeSeeds(boot, worldId));
    } catch (err) {
        log(`FATAL: ${String((err as Error).message)}`);
        totals.failed += 1;
    }

    log('');
    log('=== SEED SUMMARY ===');
    log(`  created: ${totals.created}`);
    log(`  skipped: ${totals.skipped}`);
    log(`  failed:  ${totals.failed}`);
    log(`  slug map entries: ${slugToUuid.size}`);
}

main().catch((err: unknown) => {
    process.stderr.write(`[seed-bastion] FATAL: ${(err as Error).stack ?? String(err)}\n`);
    process.exit(1);
});
