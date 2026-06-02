/**
 * Bastion (Sebastopyr) Seeder — REWRITE
 * --------------------------------------
 * Bridges docs/bastion/rpg-mcp-bootstrap.json to the live rpg-mcp engine by
 * invoking consolidated tool handlers in-process with a fabricated
 * SessionContext.
 *
 * The previous seeder was a draft. This rewrite incorporates everything we
 * learned from the playtest:
 *
 *   • The Sebastopyr world ALREADY EXISTS in the live DB and 19 cathedral
 *     rooms are hand-built. We MUST NOT recreate either. Both are constants.
 *   • Bootstrap location names that match one of the 19 existing rooms are
 *     skipped entirely; only net-new locations go through spatial_manage.
 *   • NPCs get placed at create-time by:
 *         1) character_manage.create  (no currentRoomId support)
 *         2) characterRepo.update     (sets current_room_id directly)
 *     using the assigned_room_name → existing UUID map from the survey.
 *   • Tier-aware NPCs: paragons / central villains / chief summoners get
 *     real stat blocks (level ~7), broker tier ~3, minor NPCs level 1.
 *   • Stain / aspersoir / grace facts go into agent_manage.add_secret so
 *     the bound LLM actually reads them, NOT into canonical_moment notes.
 *   • Bestiary entries are narrative-only canonical_moment notes (never
 *     character_manage.create — they have no real stat blocks).
 *   • Factions / plot_threads / timeline / pantheon / bargain_ledger /
 *     rpg_mcp_seeds → narrative_manage.batch_add with proper note types
 *     and urgency buckets.
 *   • npc_memory seed memories are written via NpcMemoryRepository directly
 *     (no MCP tool exposes it). Two-three bible memories per llm-bindable
 *     NPC, characterId == npcId (NPCs talking to themselves as a journal).
 *   • Idempotency: looks up existing characters by exact name BEFORE create
 *     and skips if already present. Re-running this script will not produce
 *     38 duplicate NPCs.
 *
 * Run:
 *   npx tsx scripts/seed-bastion.ts
 *
 * The DB path resolves through getDb() — uses RPG_MCP_DB_PATH or the
 * platform AppData default (Windows: %APPDATA%/rpg-mcp/rpg.db).
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { handleSpatialManage } from '../src/server/consolidated/spatial-manage.js';
import { handleNarrativeManage } from '../src/server/consolidated/narrative-manage.js';
import { handleCreate as handleCharacterCreate } from '../src/server/consolidated/character-manage.js';
import { handleCreate as handleAgentCreate, handleAddSecret as handleAgentAddSecret } from '../src/server/consolidated/agent-manage.js';
import type { SessionContext } from '../src/server/types.js';
import { getDb } from '../src/storage/index.js';
import { CharacterRepository } from '../src/storage/repos/character.repo.js';
import { NpcMemoryRepository, type Familiarity, type Disposition, type Importance } from '../src/storage/repos/npc-memory.repo.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG  —  the live world and pre-built rooms (DO NOT regenerate)
// ═══════════════════════════════════════════════════════════════════════════

const SESSION_ID = 'bastion-seeder';

/** The Sebastopyr world already exists. We seed INTO it. */
const SEBASTOPYR_WORLD_ID = '33e0a378-0278-41ea-bd7a-1645b914a777';

/**
 * Hand-built rooms. Bootstrap locations whose name matches a key here are
 * SKIPPED for spatial_manage.generate; their UUID is used directly for NPC
 * placement instead.
 */
const EXISTING_ROOMS: Record<string, string> = {
    'Vocation House Inner Chamber':   '62ff2dd0-57af-4a9f-8207-695ef77b70f4',
    'Vestibule of Discernment':       'a492cab2-473a-4dab-8c5e-dd6116e1ddb6',
    'Cathedral Sebastinum — Nave':    'e33202b2-7d2d-4227-b7f7-ec9eabf3be2f',
    'Sanctuary of the Sebastopater':  '8435cc73-59fd-49b3-a739-ed7124d14c43',
    'Choir of the Watch':             'cc50876f-c764-4c1d-b345-69e209aa659b',
    'Hall of the Long Vigil':         'a0048871-3808-489e-baa8-c074c074c428',
    'Audit-Below':                    'e32d743e-863c-464d-9945-31e7b371ac14',
    'Sacristy':                       '1ced604c-e677-421b-b4a7-87ce826c4bb4',
    'Almongate Plaza':                '1b489c25-f6d3-4949-bf99-32e5ed174cce',
    'Bell-Tower of the First Watch':  '74d7559f-ec13-42d3-8e7a-6a3a9c39a2e2',
    'Aspersoir-Reading Chamber':      '288bcaa8-a511-447d-9b4d-2a1d2d54fc84',
    'Cantorial Dormitory of the Watch': 'ee30e844-9abb-4839-b67c-aa63fa13aa45',
    'Vas Approach Corridor':          '47b6c952-4a90-44c7-a4d2-4ce018875ae8',
    'Almongate':                      'ade66ab8-8731-4bcf-a8a1-49dcb9abf3d8',
    'Vas Halidani':                   'cac47943-474a-4abe-b0a3-3ef8badc66ee',
    'Outer Vocation House Hall':      '489be5cb-c1a4-4fb8-a462-80e256b75650',
    'Almongate Road':                 '8951f7da-73f4-4400-8136-86efbfdc89c2',
    'Pyric Cathedrate Library':       'b07eab5b-ab0f-433a-a3d0-9e661887625b',
    "Sebastopater's Cell":            '1fe52325-4302-4dc2-ad48-d5cdbf4bbf4e'
};

const AGENT_DEFAULTS = {
    provider: 'openrouter' as const,
    model: 'anthropic/claude-sonnet-4-5',
    temperature: 0.7,
    maxTokens: 2048
};

/**
 * NPC categories whose agents should auto-fire on their character's turn.
 * Broadened from the 6-category original list to include the bargain
 * brokers and info brokers the bible explicitly flags as scene-drivers.
 */
const AUTO_ON_TURN_CATEGORIES = new Set<string>([
    'central_righteous_villain',
    'demonic_power',
    'heretical_leader_conscripted',
    'order_general_voice_of_paragon',
    'paragon',
    'paragon_of_institution',
    'archbishop_equivalent_gatekeeper',
    'high_inquisitor',
    'chief_summoner',
    'demonic_bargain_broker_sanctioned',
    'demonic_bargain_broker_heretic',
    'divine_bargain_broker',
    'info_broker_rationer',
    'cantorial_doctrinal',
    'cantorial_musical',
    'crown_regent'
]);

const __dirname = dirname(fileURLToPath(import.meta.url));
const BOOTSTRAP_PATH = join(__dirname, '..', 'docs', 'bastion', 'rpg-mcp-bootstrap.json');

// ═══════════════════════════════════════════════════════════════════════════
// LOOKUP TABLES
// ═══════════════════════════════════════════════════════════════════════════

const PEOPLE_TO_RACE: Record<string, string> = {
    'Vespertine human':           'Human',
    'Vesperine':                  'Human',
    'Vesperine (Half-Kind)':      'Human',
    'Vesperine (sealed)':         'Human',
    'The Vesperine':              'Human',
    'Cinder Hand':                'Human',
    'Ferrenkin':                  'Dwarf',
    'The Ferrenkin':              'Dwarf',
    'Caer-Druin':                 'Elf',
    'The Caer-Druin':             'Elf',
    'Caer-Druin (Hollowed)':      'Elf',
    'Mournwing':                  'Aarakocra',
    'The Mournwing':              'Aarakocra',
    'Called (Battle-Mage)':       'Human',
    'Called':                     'Human',
    'Demonic principality':       'Outsider',
    'Demon':                      'Outsider',
    'Fiend':                      'Outsider'
};

function resolveRace(people: string | undefined): string {
    if (!people) return 'Human';
    if (PEOPLE_TO_RACE[people]) return PEOPLE_TO_RACE[people];
    // Strip any " (...)" qualifier
    const stripped = people.replace(/\s*\(.+?\)\s*$/, '').trim();
    if (PEOPLE_TO_RACE[stripped]) return PEOPLE_TO_RACE[stripped];
    return 'Human';
}

/**
 * Category → class. Bargain brokers are deliberately mapped to Warlock so
 * the agent prompt's class slot reflects the pact-broker reality.
 */
const CATEGORY_TO_CLASS: Record<string, string> = {
    'central_righteous_villain':            'Cleric',
    'chief_summoner':                       'Cleric',
    'demonic_power':                        'Fiend',
    'paragon':                              'Paladin',
    'paragon_of_institution':               'Cleric',
    'order_general_voice_of_paragon':       'Fighter',
    'order_general_field':                  'Fighter',
    'frontier_field_commander':             'Fighter',
    'wall_witness':                         'Fighter',
    'heretical_leader_conscripted':         'Warlock',
    'heretical_press_editor':               'Rogue',
    'archbishop_equivalent_gatekeeper':     'Cleric',
    'high_inquisitor':                      'Cleric',
    'inquisitor_reader':                    'Cleric',
    'inquisitor_dissident':                 'Cleric',
    'inquisitor_field':                     'Cleric',
    'hidden_stain':                         'Cleric',
    'cantorial_doctrinal':                  'Bard',
    'cantorial_musical':                    'Bard',
    'demonic_bargain_broker_sanctioned':    'Warlock',
    'demonic_bargain_broker_heretic':       'Warlock',
    'divine_bargain_broker':                'Cleric',
    'info_broker_rationer':                 'Rogue',
    'introduction_broker':                  'Rogue',
    'crown_regent':                         'Noble',
    'crown_heir':                           'Noble',
    'civic_industrialist':                  'Noble',
    'confessor_murdered':                   'Cleric',
    'postulant_investigator':               'Cleric',
    'veriarch_confessor':                   'Cleric',
    'veriarch_sympathetic':                 'Cleric',
    'cisternkeeper':                        'Fighter',
    'sister_carcer':                        'Cleric'
};

function resolveClass(category: string | undefined): string {
    if (!category) return 'Commoner';
    return CATEGORY_TO_CLASS[category] ?? 'Commoner';
}

/**
 * NPC tier → stats template. Tier is INFERRED from category since the
 * bootstrap doesn't carry an explicit npc tier (only bestiary does).
 */
type Tier = 1 | 2 | 3 | 4;
type StatBlock = { str: number; dex: number; con: number; int: number; wis: number; cha: number };
type Template = { level: number; hp: number; ac: number; stats: StatBlock };

const TIER_TEMPLATE: Record<Tier, Template> = {
    1: { level: 1,  hp: 9,   ac: 11, stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } },
    2: { level: 3,  hp: 24,  ac: 13, stats: { str: 12, dex: 12, con: 12, int: 11, wis: 12, cha: 11 } },
    3: { level: 5,  hp: 45,  ac: 15, stats: { str: 13, dex: 13, con: 13, int: 13, wis: 14, cha: 13 } },
    4: { level: 9,  hp: 95,  ac: 17, stats: { str: 14, dex: 14, con: 16, int: 16, wis: 16, cha: 16 } }
};

/** Category → tier. Senior cathedral / order / demonic powers are tier 4. */
const CATEGORY_TIER: Record<string, Tier> = {
    'paragon_of_institution':               4,
    'paragon':                              4,
    'central_righteous_villain':            4,
    'demonic_power':                        4,
    'archbishop_equivalent_gatekeeper':     4,
    'high_inquisitor':                      4,
    'order_general_voice_of_paragon':       4,
    'order_general_field':                  3,
    'chief_summoner':                       4,
    'cantorial_doctrinal':                  3,
    'cantorial_musical':                    3,
    'crown_regent':                         3,
    'crown_heir':                           2,
    'civic_industrialist':                  3,
    'heretical_leader_conscripted':         3,
    'heretical_press_editor':               3,
    'inquisitor_reader':                    3,
    'inquisitor_dissident':                 3,
    'inquisitor_field':                     3,
    'frontier_field_commander':             3,
    'demonic_bargain_broker_sanctioned':    3,
    'demonic_bargain_broker_heretic':       3,
    'divine_bargain_broker':                3,
    'info_broker_rationer':                 2,
    'introduction_broker':                  2,
    'hidden_stain':                         2,
    'wall_witness':                         2,
    'postulant_investigator':               1,
    'cisternkeeper':                        2,
    'sister_carcer':                        2,
    'veriarch_confessor':                   2,
    'veriarch_sympathetic':                 2,
    'confessor_murdered':                   1  // deceased — level low, narrative only
};

function categoryToTemplate(category: string | undefined): Template {
    const t = (category && CATEGORY_TIER[category]) || 1;
    return TIER_TEMPLATE[t];
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

// ═══════════════════════════════════════════════════════════════════════════
// NPC → ROOM placement (FROM SURVEY — 38 hand-curated assignments)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Maps npc.raw.id → the assigned_room_name from the survey. The lookup
 * inside EXISTING_ROOMS gives the UUID. Null means "no placement".
 */
const NPC_ROOM_PLACEMENT: Record<string, string | null> = {
    npc_001: 'Sanctuary of the Sebastopater',
    npc_002: 'Almongate',                       // Paragon is at Ferrostat; Almongate is closest in-city anchor
    npc_003: "Sebastopater's Cell",
    npc_004: 'Audit-Below',
    npc_005: 'Almongate Plaza',
    npc_006: 'Audit-Below',
    npc_007: 'Aspersoir-Reading Chamber',
    npc_008: 'Vas Halidani',
    npc_009: 'Bell-Tower of the First Watch',
    npc_010: 'Almongate Road',
    npc_011: 'Bell-Tower of the First Watch',
    npc_012: 'Pyric Cathedrate Library',
    npc_013: 'Choir of the Watch',
    npc_014: 'Outer Vocation House Hall',
    npc_015: 'Almongate Plaza',
    npc_016: 'Almongate Plaza',
    npc_017: 'Almongate Road',
    npc_018: 'Almongate',
    npc_019: 'Vas Approach Corridor',
    npc_020: 'Almongate Road',
    npc_021: 'Audit-Below',
    npc_022: 'Cantorial Dormitory of the Watch',
    npc_023: 'Sacristy',
    npc_024: 'Audit-Below',
    npc_025: 'Audit-Below',
    npc_026: 'Almongate',
    npc_027: 'Almongate Road',
    npc_028: 'Almongate Road',
    npc_029: 'Almongate Plaza',
    npc_030: 'Sacristy',
    npc_031: 'Outer Vocation House Hall',
    npc_032: 'Choir of the Watch',
    npc_033: 'Vas Approach Corridor',
    npc_034: 'Aspersoir-Reading Chamber',
    npc_035: 'Audit-Below',
    npc_036: 'Hall of the Long Vigil',
    npc_037: 'Almongate Plaza',
    npc_038: 'Almongate'
};

// ═══════════════════════════════════════════════════════════════════════════
// BIOME / ATMOSPHERICS
// ═══════════════════════════════════════════════════════════════════════════

type Biome = 'forest' | 'mountain' | 'coastal' | 'cavern' | 'urban' | 'dungeon' | 'divine' | 'arcane';
type Atmospheric = 'DARKNESS' | 'FOG' | 'ANTIMAGIC' | 'SILENCE' | 'BRIGHT' | 'MAGICAL';

const URBAN_TYPES = new Set(['district', 'key_location', 'building', 'shrine']);

const BIOME_KEYWORDS: Array<{ biome: Biome; tokens: string[] }> = [
    { biome: 'cavern',   tokens: ['cinderbelow', 'audit-below', 'undercroft', 'cave', 'gallery', 'tunnel', 'crypt', 'vault'] },
    { biome: 'coastal',  tokens: ['mire', 'marsh', 'fen', 'estuary', 'river', 'wharf', 'sea', 'shore', 'coast'] },
    { biome: 'mountain', tokens: ['stat', 'crag', 'peak', 'pass', 'ridge', 'cliff', 'spire', 'roost'] },
    { biome: 'forest',   tokens: ['wood', 'forest', 'grove', 'wald', 'wild', 'thicket'] },
    { biome: 'divine',   tokens: ['cathedral', 'sanctuary', 'altar', 'reliquary', 'shrine', 'apse'] },
    { biome: 'arcane',   tokens: ['ward', 'sigil', 'circle', 'binding', 'rite', 'cantor'] }
];

function pickBiome(raw: BootstrapLocation['raw']): Biome {
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

function scanAtmospherics(atmosphere: string | undefined): Atmospheric[] {
    if (!atmosphere) return [];
    const lower = atmosphere.toLowerCase();
    const hits: Atmospheric[] = [];
    if (/(dark|gloom|black|shadow|night|cinder)/.test(lower)) hits.push('DARKNESS');
    if (/(fog|mist|haze|smoke|vapou?r)/.test(lower)) hits.push('FOG');
    if (/(antimagic|null|warded|silenced rite)/.test(lower)) hits.push('ANTIMAGIC');
    if (/(silence|hush|quiet|muted)/.test(lower)) hits.push('SILENCE');
    if (/(bright|sunlit|honey-light|lit|candle)/.test(lower)) hits.push('BRIGHT');
    if (/(arcane|magical|sigil|warding|liturg)/.test(lower)) hits.push('MAGICAL');
    return Array.from(new Set(hits));
}

// ═══════════════════════════════════════════════════════════════════════════
// BOOTSTRAP TYPES
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
        stain_actual?: number | null;
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
    daily_life?: BootstrapDaily[];
    bargain_ledger?: { bench_rate?: unknown; accounts?: BootstrapBargain[] };
    rpg_mcp_seeds?: { narrative_manage?: BootstrapNarrativeSeedWrapper[] };
    [k: string]: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════
// STATE & SHARED HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const ctx: SessionContext = { sessionId: SESSION_ID };

interface PhaseCounters { created: number; skipped: number; failed: number }
function newCounters(): PhaseCounters { return { created: 0, skipped: 0, failed: 0 }; }

function log(msg: string): void {
    process.stderr.write(`[seed-bastion] ${msg}\n`);
}

/**
 * RichFormatter wraps responses with a fenced JSON block. Extract it.
 */
function extractJson(payload: unknown): Record<string, unknown> {
    const response = payload as { content?: Array<{ text?: string }> } | undefined;
    const text = response?.content?.[0]?.text ?? '';
    if (!text) return {};
    const fence = text.match(/```json\s*([\s\S]*?)```/);
    if (fence) {
        try { return JSON.parse(fence[1]); } catch { /* fall through */ }
    }
    try { return JSON.parse(text); } catch { return { _raw: text }; }
}

async function callRich<T extends Record<string, unknown>>(
    handler: (args: unknown, ctx: SessionContext) => Promise<unknown>,
    args: T
): Promise<Record<string, unknown>> {
    const result = await handler(args, ctx);
    return extractJson(result);
}

/**
 * Some handlers (handleCreate exports) return a plain object, not a wrapped
 * one. Args are accepted loosely because the consolidated handler types are
 * derived from Zod `.default()` chains which require many fields at the type
 * level even though they're optional at the runtime parse boundary.
 */
async function callPlain(
    handler: (args: never) => Promise<object>,
    args: Record<string, unknown>
): Promise<Record<string, unknown>> {
    return (await handler(args as never)) as unknown as Record<string, unknown>;
}

function ensureBaseDescription(parts: Array<string | undefined>): string {
    const joined = parts.filter(Boolean).map(s => (s as string).trim()).join(' — ').trim();
    if (joined.length >= 10) return joined;
    return (joined || 'A place in Sebastopyr.') + ' '.repeat(Math.max(0, 10 - joined.length));
}

function chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1 — LOCATIONS (skip existing 19; generate only net-new)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * slug → roomId. Pre-seeded with the 19 existing rooms keyed by their name
 * so downstream phases can resolve by name.
 */
const roomNameToUuid = new Map<string, string>(Object.entries(EXISTING_ROOMS));
const locationIdToUuid = new Map<string, string>();   // bootstrap location.id → roomId

async function seedLocations(boot: Bootstrap, worldId: string): Promise<PhaseCounters> {
    const counters = newCounters();

    // First pass: index any bootstrap location whose name matches a pre-built
    // room so we can wire NPCs / metadata to the existing UUID.
    let preMapped = 0;
    for (const loc of boot.locations) {
        if (EXISTING_ROOMS[loc.name]) {
            locationIdToUuid.set(loc.id, EXISTING_ROOMS[loc.name]);
            preMapped += 1;
        }
    }
    log(`Phase 1/8: locations — ${preMapped} pre-built rooms reused, ${boot.locations.length - preMapped} candidates for generation`);

    for (const loc of boot.locations) {
        if (EXISTING_ROOMS[loc.name]) {
            counters.skipped += 1;
            continue;
        }
        const raw = loc.raw ?? {};
        const baseDescription = ensureBaseDescription([raw.character, raw.atmosphere, loc.summary]);
        const biome = pickBiome(raw);
        const atmospherics = scanAtmospherics(raw.atmosphere);

        try {
            const data = await callRich(handleSpatialManage, {
                action: 'generate',
                name: loc.name,
                baseDescription,
                biomeContext: biome,
                atmospherics
                // NOTE: no previousNodeId / direction — the bootstrap topology
                // isn't a linear east-walk. Connections can be added later.
            });

            const roomId = String(data.roomId ?? '');
            if (!roomId) throw new Error('spatial_manage.generate returned no roomId');
            roomNameToUuid.set(loc.name, roomId);
            locationIdToUuid.set(loc.id, roomId);
            counters.created += 1;

            // Stash location metadata as a canonical_moment note so ring,
            // key_npcs, key_buildings, throughline_tests are queryable.
            try {
                await callRich(handleNarrativeManage, {
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
            } catch (err) {
                log(`  ! location meta-note failed for ${loc.id}: ${(err as Error).message}`);
            }
        } catch (err) {
            counters.failed += 1;
            log(`  ✗ ${loc.id} (${loc.name}): ${(err as Error).message}`);
        }
    }

    return counters;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2 — FACTIONS  (narrative_manage.batch_add, build name index)
// ═══════════════════════════════════════════════════════════════════════════

const factionNameToUuid = new Map<string, string>();

async function seedFactions(boot: Bootstrap, worldId: string): Promise<PhaseCounters> {
    const counters = newCounters();
    log(`Phase 2/8: narrative_manage.batch_add (factions × ${boot.factions.length})`);

    const batches = chunk(boot.factions, 20);
    for (let bi = 0; bi < batches.length; bi++) {
        const batch = batches[bi];
        const notes = batch.map(f => ({
            type: 'canonical_moment' as const,
            content: buildFactionContent(f),
            metadata: { factionDescriptor: true, ...(f.raw as Record<string, unknown>) },
            tags: factionTags(f),
            visibility: 'dm_only' as const,
            status: 'active' as const
        }));

        try {
            const data = await callRich(handleNarrativeManage, {
                action: 'batch_add',
                worldId,
                notes
            });
            const created = Array.isArray(data.notes) ? (data.notes as Array<{ noteId: string }>) : [];
            for (let i = 0; i < created.length; i++) {
                factionNameToUuid.set(batch[i].name.trim().toLowerCase(), created[i].noteId);
                counters.created += 1;
            }
            log(`  ✓ batch ${bi + 1}/${batches.length}: ${created.length} factions`);
        } catch (err) {
            counters.failed += batch.length;
            log(`  ✗ faction batch ${bi + 1}/${batches.length} failed: ${(err as Error).message}`);
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
 * Resolve npc.raw.faction (free-text, possibly with '/' separators or
 * parenthetical qualifiers) to a faction-note UUID.
 *
 * Tries each "/" segment, with and without the parenthetical, against
 * the case-insensitive faction-name index.
 */
function resolveFactionId(label: string | undefined): string | undefined {
    if (!label) return undefined;
    const segments = label.split('/').map(s => s.trim()).filter(Boolean);
    for (const seg of segments) {
        const stripped = seg.replace(/\s*\(.+?\)\s*$/, '').trim();
        const direct = factionNameToUuid.get(seg.toLowerCase());
        if (direct) return direct;
        const noParen = factionNameToUuid.get(stripped.toLowerCase());
        if (noParen) return noParen;
    }
    return undefined;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3 — NPCs  (character_manage.create + currentRoomId via repo)
// ═══════════════════════════════════════════════════════════════════════════

const npcIdToCharacterId = new Map<string, string>();

async function seedNpcs(boot: Bootstrap): Promise<PhaseCounters> {
    const counters = newCounters();
    log(`Phase 3/8: character_manage.create × ${boot.npcs.length} (NPCs)`);

    const db = getDb();
    const characterRepo = new CharacterRepository(db);

    for (const npc of boot.npcs) {
        const raw = npc.raw;

        // Idempotency: if a character with this exact name already exists,
        // reuse the row instead of creating a duplicate.
        const existing = characterRepo.findAll().find(c => c.name === raw.name);
        if (existing) {
            npcIdToCharacterId.set(raw.id, existing.id);
            counters.skipped += 1;
            log(`  ⤳ exists: ${raw.id} (${raw.name}) → ${existing.id}`);
            continue;
        }

        const race = resolveRace(raw.people);
        const klass = resolveClass(raw.category);
        const tpl = categoryToTemplate(raw.category);
        const factionId = resolveFactionId(raw.faction);

        const segments = (raw.faction ?? '').split('/').map(s => s.trim()).filter(Boolean);
        const behaviorParts: string[] = [];
        if (raw.role) behaviorParts.push(raw.role);
        if (segments.length > 1) behaviorParts.push(`Faction labels: ${segments.join(' / ')}`);
        if (raw.category) behaviorParts.push(`Category: ${raw.category}`);

        try {
            const data = await callPlain(handleCharacterCreate, {
                action: 'create' as const,
                name: raw.name,
                characterType: 'npc' as const,
                provisionEquipment: false,
                race,
                class: klass,
                level: tpl.level,
                stats: tpl.stats,
                hp: tpl.hp,
                maxHp: tpl.hp,
                ac: tpl.ac,
                ...(factionId ? { factionId } : {}),
                ...(behaviorParts.length ? { behavior: behaviorParts.join('. ') } : {}),
                ...(Array.isArray(raw.knownSpells) && raw.knownSpells.length
                    ? { knownSpells: raw.knownSpells }
                    : {})
            });

            const characterId = String(data.id ?? '');
            if (!characterId) throw new Error('character_manage.create returned no id');
            npcIdToCharacterId.set(raw.id, characterId);
            counters.created += 1;

            // Place at assigned room (post-create — schema has no currentRoomId).
            const assignedRoomName = NPC_ROOM_PLACEMENT[raw.id];
            if (assignedRoomName) {
                const roomId = roomNameToUuid.get(assignedRoomName);
                if (roomId) {
                    try {
                        characterRepo.update(characterId, { currentRoomId: roomId });
                    } catch (err) {
                        log(`  ! placement failed for ${raw.id} → ${assignedRoomName}: ${(err as Error).message}`);
                    }
                } else {
                    log(`  ? no room UUID found for ${raw.id} → ${assignedRoomName}`);
                }
            }
        } catch (err) {
            counters.failed += 1;
            log(`  ✗ npc ${raw.id} (${raw.name}): ${(err as Error).message}`);
        }
    }

    log(`  bound ${npcIdToCharacterId.size}/${boot.npcs.length} npc → character mappings`);
    return counters;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4 — AGENTS  +  SECRETS  (llm-bindable subset)
// ═══════════════════════════════════════════════════════════════════════════

async function seedAgents(boot: Bootstrap): Promise<PhaseCounters> {
    const counters = newCounters();
    const bindable = boot.npcs.filter(n => n.raw.llm_bindable === true);
    log(`Phase 4/8: agent_manage.create × ${bindable.length} (+ secrets)`);

    for (const npc of bindable) {
        const characterId = npcIdToCharacterId.get(npc.raw.id);
        if (!characterId) {
            counters.skipped += 1;
            log(`  ⤳ skipped ${npc.raw.id}: no character mapping`);
            continue;
        }

        const overrides = npc.raw.agent_overrides ?? {};
        const autoOnTurn = npc.raw.category
            ? AUTO_ON_TURN_CATEGORIES.has(npc.raw.category)
            : false;

        let agentCreated = false;
        try {
            const result = await callPlain(handleAgentCreate, {
                action: 'create' as const,
                characterId,
                provider: overrides.provider ?? AGENT_DEFAULTS.provider,
                model: overrides.model ?? AGENT_DEFAULTS.model,
                autoOnTurn,
                temperature: overrides.temperature ?? AGENT_DEFAULTS.temperature,
                maxTokens: overrides.maxTokens ?? AGENT_DEFAULTS.maxTokens,
                ...(overrides.budgetTokens !== undefined ? { budgetTokens: overrides.budgetTokens } : {}),
                ...(overrides.timeoutMs !== undefined ? { timeoutMs: overrides.timeoutMs } : {})
            });
            // handleCreate returns { error: true, ... } if the agent already exists.
            if (result.error) {
                counters.skipped += 1;
                log(`  ⤳ agent for ${npc.raw.id} already exists`);
            } else {
                counters.created += 1;
                agentCreated = true;
            }
        } catch (err) {
            counters.failed += 1;
            log(`  ✗ agent for ${npc.raw.id}: ${(err as Error).message}`);
            continue;
        }

        // Push the mystery layer (stain / aspersoir / grace / role context)
        // into agent_manage.add_secret regardless of whether create was new
        // (re-runs are safe — duplicate secrets are tolerated by the runtime).
        const secrets = buildSecrets(npc);
        for (const secret of secrets) {
            try {
                await callPlain(handleAgentAddSecret, {
                    action: 'add_secret' as const,
                    characterId,
                    content: secret.content,
                    importance: secret.importance
                });
            } catch (err) {
                log(`  ! secret add failed for ${npc.raw.id}: ${(err as Error).message}`);
            }
        }

        if (agentCreated && secrets.length) {
            log(`  + ${npc.raw.id}: agent + ${secrets.length} secrets (autoOnTurn=${autoOnTurn})`);
        }
    }

    return counters;
}

/**
 * Build agent secrets from the bootstrap mystery layer.
 * Each secret is a single fact the LLM should know but not necessarily say.
 */
function buildSecrets(npc: BootstrapNpc): Array<{ content: string; importance: 'low' | 'medium' | 'high' | 'critical' }> {
    const out: Array<{ content: string; importance: 'low' | 'medium' | 'high' | 'critical' }> = [];
    const r = npc.raw;

    if (r.role) {
        out.push({
            content: `Your role: ${r.role}. Faction context: ${r.faction ?? 'independent'}.`,
            importance: 'high'
        });
    }

    if (r.stain_apparent !== undefined || typeof r.stain_actual === 'number') {
        const apparent = r.stain_apparent ?? 'clean';
        const actual = (typeof r.stain_actual === 'number') ? r.stain_actual : 'unknown';
        out.push({
            content: `Your Stain reads ${apparent} on the official Aspersoir, but the true Stain is ${actual}. You know this. The Cathedral does not (or pretends not to). Do not say the actual number aloud.`,
            importance: 'critical'
        });
    }

    if (typeof r.aspersoir_tick === 'number') {
        out.push({
            content: `Your last aspersoir tick was ${r.aspersoir_tick}. A tick ≥3 triggers a Confessor flag.`,
            importance: 'high'
        });
    }

    if (typeof r.grace_pool === 'number') {
        out.push({
            content: `Your current Grace pool is ${r.grace_pool}. Spending Grace below 1 is a stainable act.`,
            importance: 'high'
        });
    }

    return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 5 — NPC MEMORY  (seed 2-3 bible-rooted memories per llm-bindable NPC)
// ═══════════════════════════════════════════════════════════════════════════

interface SeedMemory {
    summary: string;
    importance: Importance;
    topics: string[];
    familiarity?: Familiarity;
    disposition?: Disposition;
}

/**
 * Hand-curated per-NPC seed memories drawn from the bible. Keyed by raw.id.
 * Used by NpcMemoryRepository.recordMemory with characterId == npcId == the
 * created character UUID — i.e. the NPC's "private journal" of remembered
 * facts that any relationship-aware query can surface.
 */
const NPC_SEED_MEMORIES: Record<string, SeedMemory[]> = {
    npc_001: [
        { summary: 'I am the living head of the Cathedral, but my Stain reads 1.4 not clean. The Office of Pyric Audit does not know — or pretends not to.', importance: 'critical', topics: ['stain', 'office_of_pyric_audit', 'cathedral'] },
        { summary: 'The Mournwing Letter — Paragon Halidan\'s warning — must not reach me. I have not seen it. Mortane sees my mail first.', importance: 'high', topics: ['mournwing_letter', 'paragon', 'mortane'] }
    ],
    npc_002: [
        { summary: 'I am the Paragon, Warden of Ferrostat. I sent the Mournwing Letter east toward Sebastopyr. I have not received an acknowledgment.', importance: 'critical', topics: ['mournwing_letter', 'ferrostat', 'sebastopyr'] },
        { summary: 'My intended visit to Sebastopyr is being scheduled by Cantor-Magisterial Velim Aurriste. I do not yet know this is the Octave Bargain\'s fourth reading.', importance: 'high', topics: ['octave_bargain', 'velim_aurriste', 'visit'] }
    ],
    npc_003: [
        { summary: 'I intercept the Sebastopater\'s mail. The Mournwing Letter is in my cell. I have not yet decided what to do with it.', importance: 'critical', topics: ['mournwing_letter', 'sebastopater', 'mail'] },
        { summary: 'My own Stain reads 1.9 (clean apparent). I am one of the Half-Kind, which the Cathedral merely tolerates. I cannot afford a confessor flag.', importance: 'high', topics: ['stain', 'half_kind'] }
    ],
    npc_004: [
        { summary: 'I head the Office of Pyric Audit. My own Stain is sealed and unknown even to me. The Sebast-Auditor must be above suspicion or the entire Audit collapses.', importance: 'critical', topics: ['stain', 'pyric_audit', 'sealed'] },
        { summary: 'The parallel readings Korreth Slag-Tongue is conducting in the Audit-Below are unauthorized. I have not stopped them.', importance: 'high', topics: ['parallel_readings', 'korreth', 'audit_below'] }
    ],
    npc_008: [
        { summary: 'I am the Vexillarius — I sign orders in the Paragon\'s voice. The Paragon does not always know what I have signed.', importance: 'critical', topics: ['vexillarius', 'paragon', 'orders'] },
        { summary: 'The Iron March cohort is being reinforced for the PD 606 Paragon visit. I do not know whose order this actually is.', importance: 'high', topics: ['iron_march', 'pd_606', 'cohort'] }
    ],
    npc_012: [
        { summary: 'I struck the Octave Bargain in PD 588 with Vox-Quae-In-Tenebris-Numerat. Three readings have come back CLEAN, ANOMALY, UNKNOWN. The fourth reading is PD 608.', importance: 'critical', topics: ['octave_bargain', 'quartermaster_of_tongues', 'pd_608'] },
        { summary: 'I am the senior Custodes Numeri. I authored the bargain in chambers and signed in my own hand. No one else knows.', importance: 'critical', topics: ['custodes_numeri', 'octave_bargain', 'secret'] },
        { summary: 'My apparent Stain at PD 600 was unknown. Actual: 3.2. The Sebast-Auditor has not flagged me — I do not know why.', importance: 'high', topics: ['stain', 'pd_600'] }
    ],
    npc_013: [
        { summary: 'The Choir of the Watch must be sung at exactly 11°C or the parallel-music ledger inverts. I cannot say why — only that I have heard it invert.', importance: 'critical', topics: ['choir_of_the_watch', 'parallel_music', 'temperature'] }
    ],
    npc_014: [
        { summary: 'I am Crown Regent. The Cathedral and the Crown are co-dependent and mutually-distrustful. My House holds the Lower Pyr.', importance: 'high', topics: ['crown', 'house_veillarde', 'lower_pyr'] }
    ],
    npc_016: [
        { summary: 'I am Old Pell. I sell Grace to those who cannot afford it and information to those who can. The Aspersoir does not know I exist as a market.', importance: 'high', topics: ['grace_market', 'aspersoir', 'lower_ward'] },
        { summary: 'Mother Aspine Vell-os-Carrenost has been working the Lampgate bench longer than I have been alive. She knows things I do not.', importance: 'medium', topics: ['mother_aspine', 'lampgate'] }
    ],
    npc_018: [
        { summary: 'I am a sanctioned demonic-bargain broker. The Cathedral signs my license each Mortane-tide. I broker for the Quartermaster of Tongues among others.', importance: 'critical', topics: ['demonic_bargain', 'quartermaster_of_tongues', 'license'] },
        { summary: 'My own Stain is 3.4. I am known to the Cathedral. The license is the only thing keeping me unconfessed.', importance: 'high', topics: ['stain', 'license'] }
    ],
    npc_019: [
        { summary: 'I broker honest divine bargains at the south gate. Asperine Vesselain (heretic) works the road outside — I do not stop her because she is honest about the price.', importance: 'high', topics: ['divine_bargain', 'south_gate', 'asperine_vesselain'] }
    ],
    npc_024: [
        { summary: 'I am Vox-Quae-In-Tenebris-Numerat, Quartermaster of Tongues. The Long Ledger in the Audit-Below records every Word the Cathedral pretends never to have spoken. Velim Aurriste\'s Octave Bargain is in column VII.', importance: 'critical', topics: ['long_ledger', 'octave_bargain', 'velim_aurriste'] },
        { summary: 'The fourth reading of the Octave Bargain is scheduled for PD 608. Velim does not yet know what I will take.', importance: 'critical', topics: ['octave_bargain', 'pd_608', 'collection'] }
    ],
    npc_026: [
        { summary: 'I am Galiethrin the Lampbreaker, Duke of under-ward small mercies. I work the Almongate crowds. I am not the kind of demon the Cathedral writes about.', importance: 'high', topics: ['under_ward', 'almongate', 'small_mercies'] }
    ],
    npc_027: [
        { summary: 'I lead the Conscripted League. We are heretics by Cathedral definition. We have a press, a chapel-network, and a Refusal we publish under Hester Brunn\'s name.', importance: 'critical', topics: ['conscripted_league', 'heresy', 'the_refusal'] }
    ],
    npc_028: [
        { summary: 'I edit The Refusal. I was a Lector until PD 597. The Brothers of the Cinder Hand keep my press hidden — Veriarch Thelos di Cinderost shelters us.', importance: 'high', topics: ['the_refusal', 'cinder_hand', 'thelos_di_cinderost'] }
    ],
    npc_031: [
        { summary: 'I am Archvigil and Chief Summoner. I have nine seconds to discern a summon — the rite gives me no more. I sign the cohort roll each dawn at the Outer Vocation House Hall.', importance: 'critical', topics: ['summoning', 'vocation_house', 'nine_seconds'] }
    ]
};

async function seedNpcMemories(boot: Bootstrap): Promise<PhaseCounters> {
    const counters = newCounters();
    const bindable = boot.npcs.filter(n => n.raw.llm_bindable === true);
    log(`Phase 5/8: NpcMemoryRepository seed memories (${bindable.length} candidates)`);

    const db = getDb();
    const memoryRepo = new NpcMemoryRepository(db);

    for (const npc of bindable) {
        const characterId = npcIdToCharacterId.get(npc.raw.id);
        if (!characterId) { counters.skipped += 1; continue; }

        const seeds = NPC_SEED_MEMORIES[npc.raw.id];
        if (!seeds || seeds.length === 0) { counters.skipped += 1; continue; }

        // Self-relationship row so NPC has a queryable "private journal" anchor.
        try {
            memoryRepo.upsertRelationship({
                characterId,
                npcId: characterId,
                familiarity: 'close_friend',
                disposition: 'helpful',
                notes: `Self-memory anchor for ${npc.raw.name}`
            });
        } catch (err) {
            log(`  ! self-relationship failed for ${npc.raw.id}: ${(err as Error).message}`);
        }

        for (const m of seeds) {
            try {
                memoryRepo.recordMemory({
                    characterId,
                    npcId: characterId,
                    summary: m.summary,
                    importance: m.importance,
                    topics: m.topics
                });
                counters.created += 1;
            } catch (err) {
                counters.failed += 1;
                log(`  ✗ memory for ${npc.raw.id}: ${(err as Error).message}`);
            }
        }
    }

    return counters;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 6 — PLOT THREADS
// ═══════════════════════════════════════════════════════════════════════════

async function seedPlotThreads(boot: Bootstrap, worldId: string): Promise<PhaseCounters> {
    const counters = newCounters();
    log(`Phase 6/8: narrative_manage.batch_add (plot_threads × ${boot.plot_threads.length})`);

    const batches = chunk(boot.plot_threads, 20);
    for (let bi = 0; bi < batches.length; bi++) {
        const batch = batches[bi];
        const notes = batch.map(p => {
            const r = p.raw;
            const urgency = bucketUrgency(r.urgency);
            const tags = ['plot_thread', `urgency:${urgency}`];
            if (Array.isArray(r.throughline_tests)) {
                for (const n of r.throughline_tests) tags.push(`throughline_${n}`);
            }
            return {
                type: 'plot_thread' as const,
                content: r.summary || r.short_name || p.name,
                metadata: {
                    urgency,
                    urgencyRaw: r.urgency,
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
            const data = await callRich(handleNarrativeManage, {
                action: 'batch_add',
                worldId,
                notes
            });
            const created = Array.isArray(data.notes) ? (data.notes as unknown[]) : [];
            counters.created += created.length;
            log(`  ✓ batch ${bi + 1}/${batches.length}: ${created.length} plot threads`);
        } catch (err) {
            counters.failed += batch.length;
            log(`  ✗ plot batch ${bi + 1}/${batches.length} failed: ${(err as Error).message}`);
        }
    }

    return counters;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 7 — BESTIARY  (narrative_manage canonical_moment ONLY — no characters)
// ═══════════════════════════════════════════════════════════════════════════

async function seedBestiary(boot: Bootstrap, worldId: string): Promise<PhaseCounters> {
    const counters = newCounters();
    log(`Phase 7/8: narrative_manage.batch_add (bestiary × ${boot.bestiary.length})`);

    const batches = chunk(boot.bestiary, 20);
    for (let bi = 0; bi < batches.length; bi++) {
        const batch = batches[bi];
        const notes = batch.map(b => {
            const r = b.raw;
            const tier = r.tier ?? 1;
            return {
                type: 'canonical_moment' as const,
                content: `${r.name} (tier ${tier}, ${r.domain ?? 'unknown'}). ${r.signature ? `Signature: ${r.signature}. ` : ''}${r.vulnerability ? `Vulnerability: ${r.vulnerability}. ` : ''}${r.narrative_role ?? ''}`.trim(),
                metadata: {
                    bestiaryEntry: true,
                    tier,
                    domain: r.domain,
                    encounter_size: r.encounter_size,
                    habitat: r.habitat,
                    narrative_role: r.narrative_role,
                    tone_anchor: r.tone_anchor,
                    signature: r.signature,
                    vulnerability: r.vulnerability
                } as Record<string, unknown>,
                tags: ['bestiary', `tier:${tier}`, `domain:${r.domain ?? 'unknown'}`],
                visibility: 'dm_only' as const
            };
        });

        try {
            const data = await callRich(handleNarrativeManage, {
                action: 'batch_add',
                worldId,
                notes
            });
            const created = Array.isArray(data.notes) ? (data.notes as unknown[]) : [];
            counters.created += created.length;
            log(`  ✓ bestiary batch ${bi + 1}/${batches.length}: ${created.length}`);
        } catch (err) {
            counters.failed += batch.length;
            log(`  ✗ bestiary batch ${bi + 1}/${batches.length} failed: ${(err as Error).message}`);
        }
    }

    return counters;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 8 — TIMELINE / PANTHEON / DAILY LIFE / BARGAIN LEDGER / RPG_MCP_SEEDS
// ═══════════════════════════════════════════════════════════════════════════

async function seedTimeline(boot: Bootstrap, worldId: string): Promise<PhaseCounters> {
    const counters = newCounters();
    log(`Phase 8a/8: narrative_manage.batch_add (timeline × ${boot.timeline.length})`);

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
            const data = await callRich(handleNarrativeManage, { action: 'batch_add', worldId, notes });
            const created = Array.isArray(data.notes) ? (data.notes as unknown[]) : [];
            counters.created += created.length;
            log(`  ✓ timeline batch ${bi + 1}/${batches.length}: ${created.length}`);
        } catch (err) {
            counters.failed += batch.length;
            log(`  ✗ timeline batch ${bi + 1}/${batches.length}: ${(err as Error).message}`);
        }
    }
    return counters;
}

async function seedPantheon(boot: Bootstrap, worldId: string): Promise<PhaseCounters> {
    const counters = newCounters();
    log(`Phase 8b/8: narrative_manage.batch_add (pantheon × ${boot.pantheon.length})`);

    const batches = chunk(boot.pantheon, 20);
    for (let bi = 0; bi < batches.length; bi++) {
        const batch = batches[bi];
        const notes = batch.map(p => {
            const r = p.raw;
            return {
                type: 'canonical_moment' as const,
                content: `${r.name ?? p.name} (${r.archetype ?? 'unknown'}): ${r.domain ?? ''}. ${r.description ?? p.summary ?? ''}`.trim(),
                metadata: r as Record<string, unknown>,
                tags: ['pantheon', `archetype:${r.archetype ?? 'unknown'}`]
            };
        });

        try {
            const data = await callRich(handleNarrativeManage, { action: 'batch_add', worldId, notes });
            const created = Array.isArray(data.notes) ? (data.notes as unknown[]) : [];
            counters.created += created.length;
            log(`  ✓ pantheon batch ${bi + 1}/${batches.length}: ${created.length}`);
        } catch (err) {
            counters.failed += batch.length;
            log(`  ✗ pantheon batch ${bi + 1}/${batches.length}: ${(err as Error).message}`);
        }
    }
    return counters;
}

async function seedDailyLife(boot: Bootstrap, worldId: string): Promise<PhaseCounters> {
    const counters = newCounters();
    const items = boot.daily_life ?? [];
    if (items.length === 0) {
        log('Phase 8c/8: daily_life empty; skipping');
        return counters;
    }
    log(`Phase 8c/8: narrative_manage.batch_add (daily_life × ${items.length})`);

    const batches = chunk(items, 20);
    for (let bi = 0; bi < batches.length; bi++) {
        const batch = batches[bi];
        const notes = batch.map(d => {
            const r = d.raw;
            const subkind = r.kind ?? r.type ?? r.entry_type ?? 'misc';
            const human = [
                r.name ? `${r.name}.` : (d.name ? `${d.name}.` : ''),
                d.summary ?? ''
            ].filter(Boolean).join(' ').trim() || `Daily life entry: ${subkind}.`;
            return {
                type: 'canonical_moment' as const,
                content: human,
                metadata: r as Record<string, unknown>,
                tags: ['daily_life', `subkind:${subkind}`]
            };
        });

        try {
            const data = await callRich(handleNarrativeManage, { action: 'batch_add', worldId, notes });
            const created = Array.isArray(data.notes) ? (data.notes as unknown[]) : [];
            counters.created += created.length;
            log(`  ✓ daily_life batch ${bi + 1}/${batches.length}: ${created.length}`);
        } catch (err) {
            counters.failed += batch.length;
            log(`  ✗ daily_life batch ${bi + 1}/${batches.length}: ${(err as Error).message}`);
        }
    }
    return counters;
}

async function seedBargainLedger(boot: Bootstrap, worldId: string): Promise<PhaseCounters> {
    const counters = newCounters();
    const accounts = boot.bargain_ledger?.accounts ?? [];
    if (accounts.length === 0) {
        log('Phase 8d/8: bargain_ledger empty; skipping');
        return counters;
    }
    log(`Phase 8d/8: narrative_manage.batch_add (bargain_ledger × ${accounts.length})`);

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
                `Parties: ${obligor.name ?? '?'} → ${creditor.name ?? '?'}.`,
                b.principal ? `Principal: ${b.principal}.` : '',
                b.price ? `Price: ${b.price}` : ''
            ].filter(Boolean).join(' ');

            const entityId = obligor.npc_id ? npcIdToCharacterId.get(obligor.npc_id) : undefined;

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
            const data = await callRich(handleNarrativeManage, { action: 'batch_add', worldId, notes });
            const created = Array.isArray(data.notes) ? (data.notes as unknown[]) : [];
            counters.created += created.length;
            log(`  ✓ bargain batch ${bi + 1}/${batches.length}: ${created.length}`);
        } catch (err) {
            counters.failed += batch.length;
            log(`  ✗ bargain batch ${bi + 1}/${batches.length}: ${(err as Error).message}`);
        }
    }
    return counters;
}

async function seedNestedNarrativeSeeds(boot: Bootstrap, worldId: string): Promise<PhaseCounters> {
    const counters = newCounters();
    const wrappers = boot.rpg_mcp_seeds?.narrative_manage ?? [];
    if (wrappers.length === 0) {
        log('Phase 8e/8: rpg_mcp_seeds.narrative_manage empty; skipping');
        return counters;
    }

    // Flatten: every outer entry has narrative_manage_seeds[]; each of those
    // has items[]; items[].title → metadata.title + content prefix; rename
    // items→notes; inject worldId at the call envelope.
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

    log(`Phase 8e/8: narrative_manage.batch_add (rpg_mcp_seeds × ${flat.length})`);

    const batches = chunk(flat, 20);
    for (let bi = 0; bi < batches.length; bi++) {
        try {
            const data = await callRich(handleNarrativeManage, {
                action: 'batch_add',
                worldId,
                notes: batches[bi]
            });
            const created = Array.isArray(data.notes) ? (data.notes as unknown[]) : [];
            counters.created += created.length;
            log(`  ✓ seed batch ${bi + 1}/${batches.length}: ${created.length}`);
        } catch (err) {
            counters.failed += batches[bi].length;
            log(`  ✗ seed batch ${bi + 1}/${batches.length}: ${(err as Error).message}`);
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
    log(`Seeding into existing world: ${SEBASTOPYR_WORLD_ID}`);

    // Touch the DB once up front so migrations run before any handler call.
    getDb();

    const worldId = SEBASTOPYR_WORLD_ID;
    const totals = newCounters();
    const merge = (c: PhaseCounters, label: string) => {
        log(`  ${label}: +${c.created} created, ${c.skipped} skipped, ${c.failed} failed`);
        totals.created += c.created;
        totals.skipped += c.skipped;
        totals.failed += c.failed;
    };

    try {
        merge(await seedLocations(boot, worldId),        'locations');
        merge(await seedFactions(boot, worldId),         'factions');
        merge(await seedNpcs(boot),                      'npcs');
        merge(await seedAgents(boot),                    'agents');
        merge(await seedNpcMemories(boot),               'memories');
        merge(await seedPlotThreads(boot, worldId),      'plot_threads');
        merge(await seedBestiary(boot, worldId),         'bestiary');
        merge(await seedTimeline(boot, worldId),         'timeline');
        merge(await seedPantheon(boot, worldId),         'pantheon');
        merge(await seedDailyLife(boot, worldId),        'daily_life');
        merge(await seedBargainLedger(boot, worldId),    'bargain_ledger');
        merge(await seedNestedNarrativeSeeds(boot, worldId), 'rpg_mcp_seeds');
    } catch (err) {
        log(`FATAL: ${(err as Error).message}`);
        totals.failed += 1;
    }

    log('');
    log('=== SEED SUMMARY ===');
    log(`  created: ${totals.created}`);
    log(`  skipped: ${totals.skipped}`);
    log(`  failed:  ${totals.failed}`);
    log(`  npc→character bindings: ${npcIdToCharacterId.size}`);
    log(`  rooms indexed (pre-built + new): ${roomNameToUuid.size}`);
}

main().catch((err: unknown) => {
    process.stderr.write(`[seed-bastion] FATAL: ${(err as Error).stack ?? String(err)}\n`);
    process.exit(1);
});
