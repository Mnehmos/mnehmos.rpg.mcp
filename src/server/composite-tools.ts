/**
 * Composite Tools
 *
 * High-level MCP tools that combine multiple operations into single calls.
 * These reduce token overhead by 80-95% for common workflows.
 *
 * TIER 1 Optimizations from tool efficiency analysis.
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';
import { SessionContext } from './types.js';
import { getDb } from '../storage/index.js';
import { CharacterRepository } from '../storage/repos/character.repo.js';
import { ItemRepository } from '../storage/repos/item.repo.js';
import { InventoryRepository } from '../storage/repos/inventory.repo.js';
import { PartyRepository } from '../storage/repos/party.repo.js';
import { POIRepository } from '../storage/repos/poi.repo.js';
import { SpatialRepository } from '../storage/repos/spatial.repo.js';
import { EncounterRepository } from '../storage/repos/encounter.repo.js';
import { POICategory, POIIcon } from '../schema/poi.js';
import { BiomeType } from '../schema/spatial.js';
import { expandCreatureTemplate } from '../data/creature-presets.js';
import {
    getEncounterPreset,
    listEncounterPresets,
    getEncountersForLevel,
    scaleEncounter,
    EncounterPreset
} from '../data/encounter-presets.js';
import {
    getLocationPreset,
    listLocationPresets
} from '../data/location-presets.js';
import { getItemPreset, getArmorPreset } from '../data/items/index.js';
import { getCombatManager } from './state/combat-manager.js';
import { CombatEngine, CombatParticipant } from '../engine/combat/engine.js';
import { getPatternGenerator } from './terrain-patterns.js';
import { restoreAllSpellSlots, restorePactSlots, getSpellcastingConfig } from '../engine/magic/spell-validator.js';
import { CorpseRepository } from '../storage/repos/corpse.repo.js';
import { Character } from '../schema/character.js';
import { Item } from '../schema/inventory.js';
import { parsePosition as parsePos } from '../utils/schema-shorthand.js';

type TerrainPatternName = 'river_valley' | 'canyon' | 'arena' | 'mountain_pass' | 'maze' | 'maze_rooms';

// Re-export parsePosition from schema-shorthand for backwards compatibility
export { parsePosition } from '../utils/schema-shorthand.js';

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Build a complete Character object with defaults
// ═══════════════════════════════════════════════════════════════════════════

function buildCharacter(data: {
    id: string;
    name: string;
    stats: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
    hp: number;
    maxHp: number;
    ac: number;
    level: number;
    characterType: 'pc' | 'npc' | 'enemy' | 'neutral';
    race: string;
    characterClass: string;
    resistances?: string[];
    vulnerabilities?: string[];
    immunities?: string[];
    position?: { x: number; y: number };
    currentRoomId?: string;
    createdAt: string;
    updatedAt: string;
}): Character {
    return {
        id: data.id,
        name: data.name,
        stats: data.stats,
        hp: data.hp,
        maxHp: data.maxHp,
        ac: data.ac,
        level: data.level,
        xp: 0,
        characterType: data.characterType,
        race: data.race,
        characterClass: data.characterClass,
        conditions: [],
        perceptionBonus: 0,
        stealthBonus: 0,
        knownSpells: [],
        preparedSpells: [],
        cantripsKnown: [],
        maxSpellLevel: 0,
        concentratingOn: null,
        activeSpells: [],
        resistances: data.resistances || [],
        vulnerabilities: data.vulnerabilities || [],
        immunities: data.immunities || [],
        skillProficiencies: [],
        saveProficiencies: [],
        expertise: [],
        hasLairActions: false,
        position: data.position,
        currentRoomId: data.currentRoomId,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Build a complete Item object with defaults
// ═══════════════════════════════════════════════════════════════════════════

function buildItem(data: {
    id: string;
    name: string;
    description?: string;
    type: 'weapon' | 'armor' | 'consumable' | 'quest' | 'misc' | 'scroll';
    weight?: number;
    value?: number;
    properties?: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}): Item {
    return {
        id: data.id,
        name: data.name,
        description: data.description,
        type: data.type,
        weight: data.weight ?? 0,
        value: data.value ?? 0,
        properties: data.properties,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Local alias for position parsing
// ═══════════════════════════════════════════════════════════════════════════

// Use parsePos from schema-shorthand utilities (imported above)
const parsePosition = parsePos;

/**
 * Parse a list of positions from shorthand
 */
export function parsePositionList(inputs: (string | { x: number; y: number })[]): string[] {
    return inputs.map(input => {
        if (typeof input === 'string') {
            // Already in "x,y" format
            const parts = input.split(',');
            return `${parts[0]},${parts[1]}`;
        }
        return `${input.x},${input.y}`;
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// DB HELPER
// ═══════════════════════════════════════════════════════════════════════════

function ensureDb() {
    const dbPath = process.env.NODE_ENV === 'test'
        ? ':memory:'
        : process.env.RPG_DATA_DIR
            ? `${process.env.RPG_DATA_DIR}/rpg.db`
            : 'rpg.db';
    const db = getDb(dbPath);
    return {
        db,
        charRepo: new CharacterRepository(db),
        itemRepo: new ItemRepository(db),
        inventoryRepo: new InventoryRepository(db),
        partyRepo: new PartyRepository(db),
        poiRepo: new POIRepository(db),
        spatialRepo: new SpatialRepository(db),
        encounterRepo: new EncounterRepository(db)
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

export const CompositeTools = {
    // ─────────────────────────────────────────────────────────────────────────
    // SETUP_TACTICAL_ENCOUNTER
    // ─────────────────────────────────────────────────────────────────────────
    SETUP_TACTICAL_ENCOUNTER: {
        name: 'setup_tactical_encounter',
        description: `Create a full combat encounter with creatures from presets and terrain patterns.

REPLACES: create_encounter + N×create_character + N×update_terrain (6-12 calls → 1 call)
TOKEN SAVINGS: ~90%

Creature templates: "goblin", "goblin:archer", "skeleton:warrior", "orc:berserker"
Position shorthand: "10,5" instead of {x:10, y:5, z:0}

Example - Goblin Ambush:
{
  "seed": "goblin-ambush",
  "participants": [
    { "template": "goblin:warrior", "position": "5,5" },
    { "template": "goblin:warrior", "position": "7,5" },
    { "template": "goblin:archer", "position": "6,2" },
    { "template": "hobgoblin:captain", "name": "Grishnak", "position": "6,3" }
  ],
  "terrain": {
    "obstacles": ["3,3", "3,4", "8,3", "8,4"],
    "difficultTerrain": ["5,6", "6,6", "7,6"]
  },
  "partyPositions": ["10,10", "11,10", "10,11", "11,11"]
}

Available creature templates: goblin, goblin:warrior, goblin:archer, goblin:boss, goblin:shaman,
skeleton, skeleton:warrior, skeleton:archer, zombie, zombie:brute, orc, orc:warrior, orc:berserker,
hobgoblin, hobgoblin:captain, wolf, dire_wolf, bandit, bandit_captain, ogre, troll, and more.
`,
        inputSchema: z.object({
            seed: z.string().describe('Seed for deterministic combat'),
            participants: z.array(z.object({
                template: z.string().describe('Creature template like "goblin:archer"'),
                name: z.string().optional().describe('Override the default name'),
                position: z.union([
                    z.string().regex(/^\d+,\d+(,\d+)?$/).describe('Position as "x,y" or "x,y,z"'),
                    z.object({ x: z.number(), y: z.number(), z: z.number().optional() })
                ]).describe('Position shorthand or object'),
                isEnemy: z.boolean().optional().default(true)
            })).min(1).describe('Enemy creatures to spawn'),
            terrain: z.object({
                obstacles: z.array(z.string()).optional().describe('Obstacle positions as "x,y" strings'),
                difficultTerrain: z.array(z.string()).optional().describe('Difficult terrain positions'),
                water: z.array(z.string()).optional().describe('Water positions'),
                pattern: z.string().optional().describe('Terrain pattern name (e.g., "river", "canyon")')
            }).optional().describe('Terrain configuration'),
            partyPositions: z.array(z.union([
                z.string().regex(/^\d+,\d+(,\d+)?$/),
                z.object({ x: z.number(), y: z.number(), z: z.number().optional() })
            ])).optional().describe('Starting positions for party members'),
            partyId: z.string().optional().describe('Party ID to auto-add party members'),
            gridSize: z.object({
                width: z.number().int().min(10).max(100).default(20),
                height: z.number().int().min(10).max(100).default(20)
            }).optional().describe('Grid dimensions')
        })
    },

    // ─────────────────────────────────────────────────────────────────────────
    // SPAWN_EQUIPPED_CHARACTER
    // ─────────────────────────────────────────────────────────────────────────
    SPAWN_EQUIPPED_CHARACTER: {
        name: 'spawn_equipped_character',
        description: `Create a character with equipment from presets in a single call.

REPLACES: create_character + N×(create_item + give_item + equip_item) (8-16 calls → 1 call)
TOKEN SAVINGS: ~85%

Equipment can be preset names or full item specs.

Example - Dwarf Fighter:
{
  "name": "Gimli",
  "race": "Dwarf",
  "characterClass": "fighter",
  "level": 5,
  "stats": { "str": 18, "dex": 12, "con": 16, "int": 10, "wis": 12, "cha": 8 },
  "equipment": ["battleaxe", "chain_mail", "shield"],
  "partyId": "fellowship-123"
}

Example - From creature template:
{
  "template": "bandit_captain",
  "name": "Red Raven",
  "equipment": ["rapier", "studded_leather"],
  "characterType": "npc"
}

Available equipment presets: All PHB weapons (longsword, shortbow, greataxe...),
armor (chain_mail, plate, leather...), and gear (rope, torch, healers_kit...).
`,
        inputSchema: z.object({
            // Option 1: From template
            template: z.string().optional().describe('Creature template to use as base stats'),
            // Option 2: Manual stats
            name: z.string().describe('Character name'),
            race: z.string().optional().default('Human'),
            characterClass: z.string().optional().default('fighter'),
            level: z.number().int().min(1).max(20).optional().default(1),
            stats: z.object({
                str: z.number().int().min(1).max(30),
                dex: z.number().int().min(1).max(30),
                con: z.number().int().min(1).max(30),
                int: z.number().int().min(1).max(30),
                wis: z.number().int().min(1).max(30),
                cha: z.number().int().min(1).max(30)
            }).optional(),
            hp: z.number().int().min(1).optional(),
            maxHp: z.number().int().min(1).optional(),
            ac: z.number().int().min(0).optional(),
            // Equipment
            equipment: z.array(z.union([
                z.string().describe('Item preset name like "longsword" or "chain_mail"'),
                z.object({
                    preset: z.string(),
                    slot: z.enum(['mainhand', 'offhand', 'armor', 'head', 'feet', 'accessory']).optional()
                })
            ])).optional().default([]).describe('Equipment presets to create and equip'),
            // Character type (matches CharacterTypeSchema: pc, npc, enemy, neutral)
            characterType: z.enum(['pc', 'npc', 'enemy', 'neutral']).optional().default('pc'),
            // Party assignment
            partyId: z.string().optional().describe('Party to add character to'),
            partyRole: z.enum(['leader', 'member', 'companion', 'hireling']).optional().default('member')
        })
    },

    // ─────────────────────────────────────────────────────────────────────────
    // INITIALIZE_SESSION
    // ─────────────────────────────────────────────────────────────────────────
    INITIALIZE_SESSION: {
        name: 'initialize_session',
        description: `Initialize a new game session with world, party, and starting location.

REPLACES: create_world + create_party + N×create_character + move_party (6-10 calls → 1 call)

Example:
{
  "worldName": "Forgotten Realms",
  "partyName": "The Silver Blades",
  "characters": [
    { "name": "Valeros", "race": "Human", "characterClass": "fighter", "equipment": ["longsword", "chain_mail", "shield"] },
    { "name": "Seoni", "race": "Human", "characterClass": "sorcerer", "equipment": ["quarterstaff"] }
  ],
  "startingLocation": { "name": "Sandpoint", "x": 50, "y": 50 }
}
`,
        inputSchema: z.object({
            worldName: z.string().optional().default('New World'),
            worldSeed: z.string().optional(),
            partyName: z.string(),
            characters: z.array(z.object({
                name: z.string(),
                race: z.string().optional().default('Human'),
                characterClass: z.string().optional().default('fighter'),
                level: z.number().int().min(1).optional().default(1),
                stats: z.object({
                    str: z.number().int(),
                    dex: z.number().int(),
                    con: z.number().int(),
                    int: z.number().int(),
                    wis: z.number().int(),
                    cha: z.number().int()
                }).optional(),
                equipment: z.array(z.string()).optional().default([]),
                isLeader: z.boolean().optional()
            })).min(1),
            startingLocation: z.object({
                name: z.string(),
                x: z.number().int().optional(),
                y: z.number().int().optional()
            }).optional()
        })
    },

    // ─────────────────────────────────────────────────────────────────────────
    // SPAWN_POPULATED_LOCATION
    // ─────────────────────────────────────────────────────────────────────────
    SPAWN_POPULATED_LOCATION: {
        name: 'spawn_populated_location',
        description: `Create a complete location with POI, optional room network, and inhabitants in one call.

REPLACES: create_poi + create_network + N×create_room + N×spawn_character + N×(create_item + place_item)
TOKEN SAVINGS: ~90%

Example - Goblin Cave:
{
  "worldId": "world-123",
  "name": "Shadowfang Cave",
  "category": "dungeon",
  "icon": "cave",
  "position": "50,30",
  "description": "A dark cave system rumored to house goblin raiders",
  "level": 3,
  "tags": ["goblin", "cave", "treasure"],
  "rooms": [
    { "name": "Cave Entrance", "description": "A shadowy opening in the hillside...", "biome": "cavern" },
    { "name": "Guard Chamber", "description": "A small alcove where guards keep watch...", "biome": "cavern", "exits": ["north"] }
  ],
  "inhabitants": [
    { "template": "goblin:warrior", "room": 0, "count": 2 },
    { "template": "goblin:archer", "room": 1 },
    { "template": "hobgoblin:captain", "name": "Skullcrusher", "room": 1 }
  ],
  "loot": [
    { "preset": "longsword", "room": 1 },
    { "preset": "potion_healing", "room": 0, "count": 2 }
  ]
}

Example - Village Inn:
{
  "worldId": "world-123",
  "name": "The Prancing Pony",
  "category": "commercial",
  "icon": "inn",
  "position": "100,75",
  "population": 15,
  "discoveryState": "discovered",
  "rooms": [
    { "name": "Common Room", "description": "A warm tavern with crackling fireplace...", "biome": "urban" },
    { "name": "Kitchen", "description": "The busy kitchen smells of fresh bread...", "biome": "urban", "exits": ["west"] }
  ],
  "inhabitants": [
    { "name": "Barliman Butterbur", "race": "Human", "characterType": "npc", "room": 0 },
    { "template": "bandit", "name": "Suspicious Stranger", "characterType": "neutral", "room": 0 }
  ]
}

Categories: settlement, fortification, dungeon, landmark, religious, commercial, natural, hidden
Icons: city, town, village, castle, fort, tower, dungeon, cave, ruins, temple, shrine, inn, market, mine, farm, camp
Biomes: forest, mountain, urban, dungeon, coastal, cavern, divine, arcane`,
        inputSchema: z.object({
            // POI basics
            worldId: z.string().describe('World ID to create the location in'),
            name: z.string().min(1).max(100).describe('Location name'),
            category: z.enum(['settlement', 'fortification', 'dungeon', 'landmark', 'religious', 'commercial', 'natural', 'hidden'])
                .describe('POI category'),
            icon: z.enum(['city', 'town', 'village', 'castle', 'fort', 'tower', 'dungeon', 'cave', 'ruins', 'temple', 'shrine', 'inn', 'market', 'mine', 'farm', 'camp', 'portal', 'monument', 'tree', 'mountain', 'lake', 'waterfall', 'bridge', 'crossroads', 'unknown'])
                .describe('Map icon'),
            position: z.union([
                z.string().regex(/^\d+,\d+$/).describe('Position as "x,y"'),
                z.object({ x: z.number().int().min(0), y: z.number().int().min(0) })
            ]).describe('World map position'),
            description: z.string().max(500).optional().describe('Brief description for map tooltip'),

            // POI metadata
            population: z.number().int().min(0).optional().default(0).describe('Population for settlements'),
            level: z.number().int().min(1).max(20).optional().describe('Suggested character level for dungeons'),
            tags: z.array(z.string()).optional().default([]).describe('Searchable tags'),
            discoveryState: z.enum(['unknown', 'rumored', 'discovered', 'explored', 'mapped']).optional().default('unknown'),
            discoveryDC: z.number().int().min(0).max(30).optional().describe('DC to discover if hidden'),

            // Room network (optional)
            rooms: z.array(z.object({
                name: z.string().min(1).max(100),
                description: z.string().min(10).max(2000).describe('Room description'),
                biome: z.enum(['forest', 'mountain', 'urban', 'dungeon', 'coastal', 'cavern', 'divine', 'arcane'])
                    .optional().default('dungeon'),
                exits: z.array(z.enum(['north', 'south', 'east', 'west', 'up', 'down'])).optional()
                    .describe('Directions this room connects to (auto-linked sequentially if not specified)')
            })).optional().describe('Rooms to create (first room is entrance)'),

            // Inhabitants
            inhabitants: z.array(z.object({
                // From template OR manual
                template: z.string().optional().describe('Creature template like "goblin:warrior"'),
                name: z.string().optional().describe('Character name (required if no template)'),
                race: z.string().optional().default('Human'),
                characterClass: z.string().optional().default('commoner'),
                level: z.number().int().min(1).optional(),
                characterType: z.enum(['npc', 'enemy', 'neutral']).optional().default('enemy'),
                // Placement
                room: z.number().int().min(0).optional().describe('Room index to place in (0 = entrance)'),
                count: z.number().int().min(1).max(20).optional().default(1).describe('Number to spawn')
            })).optional().default([]).describe('NPCs/creatures to populate the location'),

            // Loot/items
            loot: z.array(z.object({
                preset: z.string().describe('Item preset name'),
                room: z.number().int().min(0).optional().describe('Room index to place in'),
                count: z.number().int().min(1).max(99).optional().default(1)
            })).optional().default([]).describe('Items to place in the location')
        })
    },

    // ─────────────────────────────────────────────────────────────────────────
    // SPAWN_PRESET_ENCOUNTER
    // ─────────────────────────────────────────────────────────────────────────
    SPAWN_PRESET_ENCOUNTER: {
        name: 'spawn_preset_encounter',
        description: `Create a complete combat encounter from a preset with a single call.

REPLACES: setup_tactical_encounter with manual participant/terrain specification
TOKEN SAVINGS: ~95% (one ID vs full encounter specification)

Example - Goblin Ambush:
{ "preset": "goblin_ambush" }

Example - Scaled for large party:
{ "preset": "orc_warband", "partySize": 6, "partyLevel": 5 }

Example - Random encounter:
{ "random": true, "difficulty": "medium", "level": 3 }

Example - Random by tag:
{ "random": true, "tags": ["undead"], "level": 2 }

Available presets:
- Goblinoid: goblin_ambush, goblin_lair, hobgoblin_patrol, bugbear_ambush
- Orc: orc_raiding_party, orc_warband
- Undead: skeleton_patrol, zombie_horde, crypt_guardians
- Beast: wolf_pack, spider_nest, owlbear_territory
- Bandit: bandit_roadblock, bandit_camp
- Urban: tavern_brawl, cult_ritual
- Dungeon: animated_guardians, mimic_trap, troll_bridge, dragon_wyrmling_lair
- Fiend: imp_swarm
- Elemental: elemental_breach

Difficulties: easy, medium, hard, deadly`,
        inputSchema: z.object({
            // Preset selection (one of these required)
            preset: z.string().optional().describe('Encounter preset ID (e.g., "goblin_ambush")'),
            random: z.boolean().optional().describe('If true, select random encounter matching criteria'),

            // Random encounter filters
            difficulty: z.enum(['easy', 'medium', 'hard', 'deadly']).optional()
                .describe('Filter random encounters by difficulty'),
            level: z.number().int().min(1).max(20).optional()
                .describe('Party level for filtering/scaling'),
            tags: z.array(z.string()).optional()
                .describe('Tags to filter random encounters (e.g., ["undead", "dungeon"])'),

            // Scaling options
            partySize: z.number().int().min(1).max(10).optional().default(4)
                .describe('Number of party members (affects encounter scaling)'),
            partyLevel: z.number().int().min(1).max(20).optional()
                .describe('Party level for scaling (defaults to "level" if set)'),

            // Party setup
            partyId: z.string().optional()
                .describe('Party ID to auto-include members in the encounter'),
            partyPositions: z.array(z.string()).optional()
                .describe('Override party starting positions'),

            // Combat seed
            seed: z.string().optional()
                .describe('Seed for deterministic combat (auto-generated if not provided)')
        })
    },

    // ─────────────────────────────────────────────────────────────────────────
    // REST_PARTY
    // ─────────────────────────────────────────────────────────────────────────
    REST_PARTY: {
        name: 'rest_party',
        description: `Rest entire party at once - heals all members and restores spell slots.

REPLACES: N×take_long_rest or N×take_short_rest (4-6 calls → 1 call)
TOKEN SAVINGS: ~80%

Long rest (8 hours):
- Restores ALL party members to max HP
- Restores all spell slots
- Clears concentration and active spells
- Cannot rest while any member is in combat

Short rest (1 hour):
- Rolls hit dice for healing (configurable per member)
- Warlocks regain pact magic slots
- Cannot rest while any member is in combat

Example - Long rest:
{ "partyId": "party-123", "restType": "long" }

Example - Short rest with hit dice:
{ "partyId": "party-123", "restType": "short", "hitDicePerMember": 2 }

Example - Short rest with custom allocation:
{
  "partyId": "party-123",
  "restType": "short",
  "hitDiceAllocation": {
    "char-id-1": 3,
    "char-id-2": 1,
    "char-id-3": 0
  }
}`,
        inputSchema: z.object({
            partyId: z.string().describe('The party ID'),
            restType: z.enum(['long', 'short']).describe('Type of rest to take'),
            hitDicePerMember: z.number().int().min(0).max(20).optional().default(1)
                .describe('Hit dice each member spends on short rest (default: 1)'),
            hitDiceAllocation: z.record(z.string(), z.number().int().min(0).max(20)).optional()
                .describe('Custom hit dice allocation per character ID (overrides hitDicePerMember)')
        })
    },

    // ─────────────────────────────────────────────────────────────────────────
    // LOOT_ENCOUNTER
    // ─────────────────────────────────────────────────────────────────────────
    LOOT_ENCOUNTER: {
        name: 'loot_encounter',
        description: `Loot all corpses from an encounter in a single call.

REPLACES: list_corpses_in_encounter + N×loot_corpse (5-10 calls → 1 call)
TOKEN SAVINGS: ~85%

Automatically:
- Finds all corpses from the encounter
- Transfers all loot to specified character (or distributes to party)
- Optionally includes currency/gold distribution
- Returns comprehensive loot summary

Example - Single looter:
{ "encounterId": "encounter-123", "looterId": "char-456" }

Example - Distribute to party:
{
  "encounterId": "encounter-123",
  "partyId": "party-789",
  "distributeEvenly": true
}

Example - Selective looting:
{
  "encounterId": "encounter-123",
  "looterId": "char-456",
  "includeItems": true,
  "includeCurrency": true,
  "includeHarvestable": false
}`,
        inputSchema: z.object({
            encounterId: z.string().describe('The encounter ID to loot corpses from'),
            looterId: z.string().optional().describe('Character ID to receive all loot'),
            partyId: z.string().optional().describe('Party ID for distributing loot among members'),
            distributeEvenly: z.boolean().optional().default(false)
                .describe('If true with partyId, distribute items round-robin to party members'),
            includeItems: z.boolean().optional().default(true)
                .describe('Include equipment and items'),
            includeCurrency: z.boolean().optional().default(true)
                .describe('Include gold/silver/copper'),
            includeHarvestable: z.boolean().optional().default(false)
                .describe('Auto-harvest resources (may fail without skill check)')
        })
    },

    // ─────────────────────────────────────────────────────────────────────────
    // TRAVEL_TO_LOCATION
    // ─────────────────────────────────────────────────────────────────────────
    TRAVEL_TO_LOCATION: {
        name: 'travel_to_location',
        description: `Move a party to a POI on the world map. Combines move_party + discover_poi + enter_room.

TOKEN SAVINGS: ~70% vs separate calls (3 tools → 1)

WHAT THIS TOOL DOES:
1. Moves party to POI coordinates on world map
2. Auto-discovers the POI if not yet discovered (with perception check if DC set)
3. Optionally enters the POI's entrance room if it has a network

Example - Travel to known location:
{ "partyId": "party-1", "poiId": "poi-tavern-1" }

Example - Travel and auto-enter dungeon:
{ "partyId": "party-1", "poiId": "poi-dungeon-1", "enterLocation": true }

Example - Travel with discovery bypass:
{ "partyId": "party-1", "poiId": "poi-hidden-temple", "autoDiscover": true }`,
        inputSchema: z.object({
            partyId: z.string().describe('Party ID to move'),
            poiId: z.string().uuid().describe('POI ID destination'),
            enterLocation: z.boolean().optional().default(false)
                .describe('If true and POI has a room network, move party leader into entrance room'),
            autoDiscover: z.boolean().optional().default(false)
                .describe('If true, skip perception check for undiscovered POIs'),
            discoveringCharacterId: z.string().uuid().optional()
                .describe('Character making discovery check (defaults to party leader)')
        })
    },

    // ─────────────────────────────────────────────────────────────────────────
    // SPAWN_PRESET_LOCATION
    // ─────────────────────────────────────────────────────────────────────────
    SPAWN_PRESET_LOCATION: {
        name: 'spawn_preset_location',
        description: `Spawn a complete location from a preset. Creates POI, room network, and optionally NPCs.

TOKEN SAVINGS: ~85% vs manual specification

WHAT THIS TOOL DOES:
1. Creates a POI at specified world coordinates
2. Creates a room network with all preset rooms
3. Links the POI to the network
4. Optionally spawns preset NPCs

Example - Spawn a tavern:
{ "preset": "generic_tavern", "worldId": "world-1", "x": 50, "y": 75 }

Example - Spawn dungeon entrance with NPCs:
{ "preset": "dungeon_entrance", "worldId": "world-1", "x": 100, "y": 200, "spawnNpcs": true }

Example - Custom name:
{ "preset": "forest_clearing", "worldId": "world-1", "x": 25, "y": 30, "customName": "Whispering Glade" }

Available presets:
- Taverns: generic_tavern, rough_tavern
- Dungeons: dungeon_entrance, cave_entrance
- Urban: town_square
- Wilderness: forest_clearing, roadside_camp`,
        inputSchema: z.object({
            preset: z.string().describe('Location preset ID (e.g., "generic_tavern")'),
            worldId: z.string().describe('World ID to spawn in'),
            x: z.number().int().min(0).describe('X coordinate on world map'),
            y: z.number().int().min(0).describe('Y coordinate on world map'),
            customName: z.string().optional().describe('Override default location name'),
            spawnNpcs: z.boolean().optional().default(false)
                .describe('If true, spawn preset NPCs in their rooms'),
            discoveryState: z.enum(['unknown', 'rumored', 'discovered', 'explored', 'mapped'])
                .optional().default('discovered')
                .describe('Initial discovery state')
        })
    }
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Handle setup_tactical_encounter
 */
export async function handleSetupTacticalEncounter(args: unknown, ctx: SessionContext) {
    const parsed = CompositeTools.SETUP_TACTICAL_ENCOUNTER.inputSchema.parse(args);
    const { charRepo } = ensureDb();

    const combatManager = getCombatManager();
    const now = new Date().toISOString();

    // Build participants from templates
    const participants: CombatParticipant[] = [];
    const createdCharacterIds: string[] = [];

    for (let i = 0; i < parsed.participants.length; i++) {
        const p = parsed.participants[i];
        const preset = expandCreatureTemplate(p.template, p.name);

        if (!preset) {
            throw new Error(`Unknown creature template: ${p.template}`);
        }

        const pos = parsePosition(p.position);
        const characterId = randomUUID();

        // Create character in database using the helper for proper schema compliance
        const character = buildCharacter({
            id: characterId,
            name: preset.name,
            stats: preset.stats,
            hp: preset.hp,
            maxHp: preset.maxHp,
            ac: preset.ac,
            level: preset.level,
            characterType: preset.characterType,
            race: preset.race || 'Unknown',
            characterClass: preset.characterClass || 'monster',
            resistances: preset.resistances || [],
            vulnerabilities: preset.vulnerabilities || [],
            immunities: preset.immunities || [],
            position: { x: pos.x, y: pos.y },
            createdAt: now,
            updatedAt: now
        });

        charRepo.create(character);
        createdCharacterIds.push(characterId);

        // Build combat participant
        const dexMod = Math.floor((preset.stats.dex - 10) / 2);
        participants.push({
            id: characterId,
            name: preset.name,
            hp: preset.hp,
            maxHp: preset.maxHp,
            ac: preset.ac,
            attackDamage: preset.defaultAttack?.damage,
            attackBonus: preset.defaultAttack?.toHit,
            initiative: 0, // Will be rolled
            initiativeBonus: dexMod,
            isEnemy: p.isEnemy ?? true,
            conditions: [],
            position: pos,
            size: preset.size || 'medium',
            movementSpeed: preset.speed || 30,
            movementRemaining: preset.speed || 30,
            resistances: preset.resistances || [],
            vulnerabilities: preset.vulnerabilities || [],
            immunities: preset.immunities || []
        });
    }

    // Add party members if partyId provided
    if (parsed.partyId && parsed.partyPositions) {
        const { partyRepo } = ensureDb();
        const party = partyRepo.getPartyWithMembers(parsed.partyId);

        if (party && party.members) {
            for (let i = 0; i < party.members.length && i < parsed.partyPositions.length; i++) {
                const member = party.members[i];
                const pos = parsePosition(parsed.partyPositions[i]);
                const char = member.character;
                const dexMod = Math.floor((char.stats.dex - 10) / 2);

                participants.push({
                    id: char.id,
                    name: char.name,
                    hp: char.hp,
                    maxHp: char.maxHp,
                    initiative: 0,
                    initiativeBonus: dexMod,
                    isEnemy: false,
                    conditions: [],
                    position: pos,
                    size: 'medium',
                    movementSpeed: 30,
                    movementRemaining: 30,
                    resistances: (char as any).resistances || [],
                    vulnerabilities: (char as any).vulnerabilities || [],
                    immunities: (char as any).immunities || []
                });
            }
        }
    }

    // Build terrain
    let terrain: { obstacles: string[]; difficultTerrain?: string[]; water?: string[] } = {
        obstacles: parsed.terrain?.obstacles || [],
        difficultTerrain: parsed.terrain?.difficultTerrain,
        water: parsed.terrain?.water
    };

    // Apply pattern if specified (validate against known pattern names)
    if (parsed.terrain?.pattern) {
        const validPatterns: TerrainPatternName[] = ['river_valley', 'canyon', 'arena', 'mountain_pass', 'maze', 'maze_rooms'];
        if (validPatterns.includes(parsed.terrain.pattern as TerrainPatternName)) {
            const patternGen = getPatternGenerator(parsed.terrain.pattern as TerrainPatternName);
            const width = parsed.gridSize?.width || 20;
            const height = parsed.gridSize?.height || 20;
            const patternTerrain = patternGen(0, 0, width, height);
            terrain = {
                obstacles: [...terrain.obstacles, ...patternTerrain.obstacles],
                difficultTerrain: [...(terrain.difficultTerrain || []), ...(patternTerrain.difficultTerrain || [])],
                water: [...(terrain.water || []), ...(patternTerrain.water || [])]
            };
        }
    }

    // Create encounter using CombatEngine and CombatManager
    const encounterId = `encounter-${parsed.seed}-${Date.now()}`;
    // CRITICAL FIX: Use session-namespaced ID so other combat tools can find it
    const namespacedId = `${ctx.sessionId}:${encounterId}`;
    const engine = new CombatEngine(parsed.seed);
    const encounterState = engine.startEncounter(participants);
    // Add terrain to the state (CRIT-003 pattern from combat-tools.ts)
    (encounterState as any).terrain = terrain;
    combatManager.create(namespacedId, engine);

    // Get grid dimensions for database and ASCII map
    const width = parsed.gridSize?.width || 20;
    const height = parsed.gridSize?.height || 20;

    // CRIT-005: Save encounter to database for persistence
    const { encounterRepo } = ensureDb();
    encounterRepo.create({
        id: encounterId,
        tokens: encounterState.participants.map((p: any) => ({
            id: p.id,
            name: p.name,
            initiativeBonus: p.initiativeBonus,
            initiative: p.initiative,
            isEnemy: p.isEnemy,
            hp: p.hp,
            maxHp: p.maxHp,
            conditions: p.conditions,
            abilityScores: p.abilityScores,
            position: p.position,
            movementSpeed: p.movementSpeed ?? 30,
            size: p.size ?? 'medium'
        })),
        round: encounterState.round,
        activeTokenId: encounterState.turnOrder[encounterState.currentTurnIndex],
        status: 'active',
        terrain: terrain,
        props: [],
        gridBounds: { minX: 0, maxX: width, minY: 0, maxY: height },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    });

    // Generate ASCII map
    const asciiMap = generateEncounterMap({ state: encounterState }, width, height);

    // Build state JSON for frontend parsing (same structure as create_encounter)
    const stateJson = {
        encounterId,
        sessionId: ctx.sessionId, // Include sessionId for frontend sync match
        round: encounterState.round,
        currentTurnIndex: encounterState.currentTurnIndex || 0,
        turnOrder: encounterState.turnOrder,
        participants: encounterState.participants.map((p: CombatParticipant) => ({
            id: p.id,
            name: p.name,
            hp: p.hp,
            maxHp: p.maxHp,
            ac: p.ac || 10,
            initiative: p.initiative,
            isEnemy: p.isEnemy,
            conditions: p.conditions || [],
            position: p.position
        })),
        participantCount: participants.length,
        enemyCount: participants.filter(p => p.isEnemy).length,
        friendlyCount: participants.filter(p => !p.isEnemy).length,
        createdCharacterIds,
        terrain: {
            obstacleCount: terrain.obstacles.length,
            difficultTerrainCount: terrain.difficultTerrain?.length || 0,
            waterCount: terrain.water?.length || 0
        },
        asciiMap
    };

    // CRITICAL: Use STATE_JSON markers for frontend parsing (same as create_encounter)
    let output = `⚔️ TACTICAL ENCOUNTER STARTED\n`;
    output += `Encounter ID: ${encounterId}\n`;
    output += `Round: ${encounterState.round}\n`;
    output += `Participants: ${participants.length} (${stateJson.friendlyCount} allies, ${stateJson.enemyCount} enemies)\n`;
    output += `\n${asciiMap}\n`;
    
    // Append JSON for frontend parsing
    output += `\n<!-- STATE_JSON\n${JSON.stringify(stateJson)}\nSTATE_JSON -->`;

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

/**
 * Handle spawn_equipped_character
 */
export async function handleSpawnEquippedCharacter(args: unknown, _ctx: SessionContext) {
    const parsed = CompositeTools.SPAWN_EQUIPPED_CHARACTER.inputSchema.parse(args);
    const { charRepo, itemRepo, inventoryRepo, partyRepo } = ensureDb();

    const now = new Date().toISOString();
    const characterId = randomUUID();

    // Build character from template or manual stats
    let characterData: Character;

    if (parsed.template) {
        const preset = expandCreatureTemplate(parsed.template, parsed.name);
        if (!preset) {
            throw new Error(`Unknown creature template: ${parsed.template}`);
        }
        characterData = buildCharacter({
            id: characterId,
            name: parsed.name || preset.name,
            stats: parsed.stats || preset.stats,
            hp: parsed.hp || preset.hp,
            maxHp: parsed.maxHp || preset.maxHp,
            ac: parsed.ac || preset.ac,
            level: parsed.level || preset.level,
            characterType: parsed.characterType || preset.characterType,
            race: parsed.race || preset.race || 'Unknown',
            characterClass: parsed.characterClass || preset.characterClass || 'monster',
            resistances: preset.resistances || [],
            vulnerabilities: preset.vulnerabilities || [],
            immunities: preset.immunities || [],
            createdAt: now,
            updatedAt: now
        });
    } else {
        // Manual character creation
        const stats = parsed.stats || { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
        const conMod = Math.floor((stats.con - 10) / 2);
        const defaultHp = 10 + conMod + ((parsed.level || 1) - 1) * (5 + conMod);

        characterData = buildCharacter({
            id: characterId,
            name: parsed.name,
            stats,
            hp: parsed.hp || defaultHp,
            maxHp: parsed.maxHp || defaultHp,
            ac: parsed.ac || 10 + Math.floor((stats.dex - 10) / 2),
            level: parsed.level || 1,
            characterType: parsed.characterType || 'pc',
            race: parsed.race || 'Human',
            characterClass: parsed.characterClass || 'fighter',
            createdAt: now,
            updatedAt: now
        });
    }

    // Create character
    charRepo.create(characterData);

    // Create and equip items
    const equippedItems: { itemId: string; name: string; slot?: string }[] = [];
    let calculatedAC = 10 + Math.floor((characterData.stats.dex - 10) / 2);

    for (const equipSpec of parsed.equipment || []) {
        const presetName = typeof equipSpec === 'string' ? equipSpec : equipSpec.preset;
        const requestedSlot = typeof equipSpec === 'object' ? equipSpec.slot : undefined;

        const preset = getItemPreset(presetName);
        if (!preset) {
            console.warn(`Unknown item preset: ${presetName}, skipping`);
            continue;
        }

        // Create item using helper for proper schema compliance
        const itemId = randomUUID();
        // Map preset types to valid item types
        let itemType: 'weapon' | 'armor' | 'consumable' | 'quest' | 'misc' | 'scroll';
        if (preset.type === 'weapon') itemType = 'weapon';
        else if (preset.type === 'armor') itemType = 'armor';
        else if (preset.type === 'gear' || preset.type === 'tool') itemType = 'misc';
        else if (preset.type === 'consumable') itemType = 'consumable';
        else if (preset.type === 'magic') itemType = (preset as any).baseItem ? 'weapon' : 'misc';
        else itemType = 'misc';

        const item = buildItem({
            id: itemId,
            name: preset.name,
            description: (preset as any).description || '',
            type: itemType,
            weight: (preset as any).weight || 0,
            value: (preset as any).value || 0,
            properties: preset as any,
            createdAt: now,
            updatedAt: now
        });
        itemRepo.create(item);

        // Give to character
        inventoryRepo.addItem(characterId, itemId, 1);

        // Determine slot and equip
        let slot = requestedSlot;
        if (!slot) {
            if (preset.type === 'weapon') {
                slot = 'mainhand';
            } else if (preset.type === 'armor') {
                const armorPreset = preset as any;
                slot = armorPreset.category === 'shield' ? 'offhand' : 'armor';
            }
        }

        if (slot) {
            inventoryRepo.equipItem(characterId, itemId, slot);
            equippedItems.push({ itemId, name: preset.name, slot });

            // Update AC for armor
            if (preset.type === 'armor') {
                const armorPreset = getArmorPreset(presetName);
                if (armorPreset) {
                    if (armorPreset.category === 'shield') {
                        calculatedAC += armorPreset.ac;
                    } else {
                        const dexMod = Math.floor((characterData.stats.dex - 10) / 2);
                        const maxDex = armorPreset.maxDexBonus ?? 99;
                        const effectiveDex = Math.min(dexMod, maxDex);
                        calculatedAC = armorPreset.ac + effectiveDex;
                    }
                }
            }
        } else {
            equippedItems.push({ itemId, name: preset.name });
        }
    }

    // Update character AC based on armor
    if (calculatedAC !== characterData.ac) {
        charRepo.update(characterId, { ac: calculatedAC });
        characterData.ac = calculatedAC;
    }

    // Add to party if specified
    let partyInfo: { partyId: string; partyName: string; role: string } | null = null;
    if (parsed.partyId) {
        const party = partyRepo.findById(parsed.partyId);
        if (party) {
            partyRepo.addMember({
                id: randomUUID(),
                partyId: parsed.partyId,
                characterId,
                role: parsed.partyRole || 'member',
                isActive: false,
                sharePercentage: 100,
                joinedAt: now
            });
            partyInfo = {
                partyId: parsed.partyId,
                partyName: party.name,
                role: parsed.partyRole || 'member'
            };
        }
    }

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                character: {
                    id: characterId,
                    name: characterData.name,
                    race: characterData.race,
                    class: characterData.characterClass,
                    level: characterData.level,
                    hp: characterData.hp,
                    maxHp: characterData.maxHp,
                    ac: characterData.ac,
                    stats: characterData.stats,
                    type: characterData.characterType
                },
                equipment: equippedItems,
                party: partyInfo,
                message: `Created ${characterData.name} (${characterData.race} ${characterData.characterClass}) with ${equippedItems.length} items equipped`
            }, null, 2)
        }]
    };
}

/**
 * Handle initialize_session (stub - needs world tools integration)
 */
export async function handleInitializeSession(args: unknown, _ctx: SessionContext) {
    const parsed = CompositeTools.INITIALIZE_SESSION.inputSchema.parse(args);

    // This is a stub - full implementation needs world tools
    // For now, create party and characters

    const { charRepo, partyRepo } = ensureDb();
    const now = new Date().toISOString();

    // Create party
    const partyId = randomUUID();
    partyRepo.create({
        id: partyId,
        name: parsed.partyName,
        status: 'active',
        formation: 'standard',
        currentLocation: parsed.startingLocation?.name,
        positionX: parsed.startingLocation?.x,
        positionY: parsed.startingLocation?.y,
        createdAt: now,
        updatedAt: now,
        lastPlayedAt: now
    });

    // Create characters
    const createdCharacters: { id: string; name: string; race: string; class: string; level: number }[] = [];
    let leaderId: string | null = null;

    for (const charSpec of parsed.characters) {
        const characterId = randomUUID();
        const stats = charSpec.stats || { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
        const conMod = Math.floor((stats.con - 10) / 2);
        const hp = 10 + conMod + ((charSpec.level || 1) - 1) * (5 + conMod);

        const character = buildCharacter({
            id: characterId,
            name: charSpec.name,
            stats,
            hp,
            maxHp: hp,
            ac: 10 + Math.floor((stats.dex - 10) / 2),
            level: charSpec.level || 1,
            characterType: 'pc',
            race: charSpec.race || 'Human',
            characterClass: charSpec.characterClass || 'fighter',
            createdAt: now,
            updatedAt: now
        });
        charRepo.create(character);

        // Add to party
        const role = charSpec.isLeader ? 'leader' : 'member';
        partyRepo.addMember({
            id: randomUUID(),
            partyId,
            characterId,
            role,
            isActive: charSpec.isLeader || false,
            sharePercentage: 100,
            joinedAt: now
        });

        if (charSpec.isLeader) {
            leaderId = characterId;
        }

        createdCharacters.push({
            id: characterId,
            name: charSpec.name,
            race: charSpec.race || 'Human',
            class: charSpec.characterClass || 'fighter',
            level: charSpec.level || 1
        });
    }

    // Set leader if specified
    if (leaderId) {
        partyRepo.setLeader(partyId, leaderId);
    }

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                session: {
                    partyId,
                    partyName: parsed.partyName,
                    location: parsed.startingLocation?.name || 'Unknown',
                    characters: createdCharacters,
                    leaderId
                },
                message: `Session initialized: ${parsed.partyName} with ${createdCharacters.length} characters`
            }, null, 2)
        }]
    };
}

/**
 * Handle spawn_populated_location
 */
export async function handleSpawnPopulatedLocation(args: unknown, _ctx: SessionContext) {
    const parsed = CompositeTools.SPAWN_POPULATED_LOCATION.inputSchema.parse(args);
    const { charRepo, itemRepo, spatialRepo, poiRepo } = ensureDb();

    const now = new Date().toISOString();

    // Parse position
    let posX: number;
    let posY: number;
    if (typeof parsed.position === 'string') {
        const parts = parsed.position.split(',');
        posX = parseInt(parts[0], 10);
        posY = parseInt(parts[1], 10);
    } else {
        posX = parsed.position.x;
        posY = parsed.position.y;
    }

    // Create network and rooms if rooms are specified
    let networkId: string | undefined;
    let entranceRoomId: string | undefined;
    const createdRooms: { id: string; name: string; index: number }[] = [];

    if (parsed.rooms && parsed.rooms.length > 0) {
        // Create the node network
        networkId = randomUUID();
        spatialRepo.createNetwork({
            id: networkId,
            name: `${parsed.name} Network`,
            type: 'cluster',
            worldId: parsed.worldId,
            centerX: posX,
            centerY: posY,
            createdAt: now,
            updatedAt: now
        });

        // Create rooms
        const roomIds: string[] = [];
        for (let i = 0; i < parsed.rooms.length; i++) {
            const roomSpec = parsed.rooms[i];
            const roomId = randomUUID();
            roomIds.push(roomId);

            if (i === 0) {
                entranceRoomId = roomId;
            }

            spatialRepo.create({
                id: roomId,
                name: roomSpec.name,
                baseDescription: roomSpec.description,
                biomeContext: (roomSpec.biome || 'dungeon') as BiomeType,
                atmospherics: [],
                exits: [],
                entityIds: [],
                networkId,
                localX: i % 5, // Simple grid layout
                localY: Math.floor(i / 5),
                visitedCount: 0,
                createdAt: now,
                updatedAt: now
            });

            createdRooms.push({ id: roomId, name: roomSpec.name, index: i });
        }

        // Auto-link rooms sequentially (each room connects to next with north/south)
        for (let i = 0; i < roomIds.length - 1; i++) {
            const currentRoom = parsed.rooms[i];
            // Only auto-link if exits not explicitly specified
            if (!currentRoom.exits || currentRoom.exits.length === 0) {
                // Link current to next (north)
                spatialRepo.addExit(roomIds[i], {
                    direction: 'north',
                    targetNodeId: roomIds[i + 1],
                    type: 'OPEN'
                });
                // Link next to current (south)
                spatialRepo.addExit(roomIds[i + 1], {
                    direction: 'south',
                    targetNodeId: roomIds[i],
                    type: 'OPEN'
                });
            }
        }
    }

    // Create POI
    const poiId = randomUUID();
    poiRepo.create({
        id: poiId,
        worldId: parsed.worldId,
        x: posX,
        y: posY,
        name: parsed.name,
        description: parsed.description,
        category: parsed.category as POICategory,
        icon: parsed.icon as POIIcon,
        networkId,
        entranceRoomId,
        discoveryState: parsed.discoveryState || 'unknown',
        discoveredBy: [],
        discoveryDC: parsed.discoveryDC,
        childPOIIds: [],
        population: parsed.population || 0,
        level: parsed.level,
        tags: parsed.tags || [],
        createdAt: now,
        updatedAt: now
    });

    // Spawn inhabitants
    const createdInhabitants: { id: string; name: string; template?: string; roomId?: string; roomName?: string }[] = [];

    for (const inhab of parsed.inhabitants || []) {
        const count = inhab.count || 1;

        for (let c = 0; c < count; c++) {
            const characterId = randomUUID();
            let characterData: Character;

            if (inhab.template) {
                const preset = expandCreatureTemplate(inhab.template, inhab.name);
                if (!preset) {
                    console.warn(`Unknown creature template: ${inhab.template}, skipping`);
                    continue;
                }

                // For multiple spawns, add number suffix
                const displayName = count > 1 && !inhab.name
                    ? `${preset.name} ${c + 1}`
                    : (inhab.name || preset.name);

                characterData = buildCharacter({
                    id: characterId,
                    name: displayName,
                    stats: preset.stats,
                    hp: preset.hp,
                    maxHp: preset.maxHp,
                    ac: preset.ac,
                    level: inhab.level || preset.level,
                    characterType: inhab.characterType || preset.characterType,
                    race: inhab.race || preset.race || 'Unknown',
                    characterClass: inhab.characterClass || preset.characterClass || 'monster',
                    resistances: preset.resistances || [],
                    vulnerabilities: preset.vulnerabilities || [],
                    immunities: preset.immunities || [],
                    createdAt: now,
                    updatedAt: now
                });
            } else {
                // Manual character
                if (!inhab.name) {
                    console.warn('Inhabitant without template must have a name, skipping');
                    continue;
                }

                const stats = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
                const level = inhab.level || 1;
                const conMod = Math.floor((stats.con - 10) / 2);
                const hp = 8 + conMod + (level - 1) * (5 + conMod);

                characterData = buildCharacter({
                    id: characterId,
                    name: inhab.name,
                    stats,
                    hp,
                    maxHp: hp,
                    ac: 10,
                    level,
                    characterType: inhab.characterType || 'npc',
                    race: inhab.race || 'Human',
                    characterClass: inhab.characterClass || 'commoner',
                    createdAt: now,
                    updatedAt: now
                });
            }

            // Set current room if rooms exist
            const roomIndex = inhab.room ?? 0;
            let roomId: string | undefined;
            let roomName: string | undefined;

            if (createdRooms.length > 0 && roomIndex < createdRooms.length) {
                roomId = createdRooms[roomIndex].id;
                roomName = createdRooms[roomIndex].name;
                characterData.currentRoomId = roomId;
            }

            charRepo.create(characterData);

            // Add entity to room
            if (roomId) {
                spatialRepo.addEntityToRoom(roomId, characterId);
            }

            createdInhabitants.push({
                id: characterId,
                name: characterData.name,
                template: inhab.template,
                roomId,
                roomName
            });
        }
    }

    // Place loot
    const placedLoot: { itemId: string; name: string; count: number; roomId?: string; roomName?: string }[] = [];

    for (const lootSpec of parsed.loot || []) {
        const preset = getItemPreset(lootSpec.preset);
        if (!preset) {
            console.warn(`Unknown item preset: ${lootSpec.preset}, skipping`);
            continue;
        }

        // Create item
        const itemId = randomUUID();
        let itemType: 'weapon' | 'armor' | 'consumable' | 'quest' | 'misc' | 'scroll';
        if (preset.type === 'weapon') itemType = 'weapon';
        else if (preset.type === 'armor') itemType = 'armor';
        else if (preset.type === 'gear' || preset.type === 'tool') itemType = 'misc';
        else if (preset.type === 'consumable') itemType = 'consumable';
        else if (preset.type === 'magic') itemType = (preset as any).baseItem ? 'weapon' : 'misc';
        else itemType = 'misc';

        const item = buildItem({
            id: itemId,
            name: preset.name,
            description: (preset as any).description || '',
            type: itemType,
            weight: (preset as any).weight || 0,
            value: (preset as any).value || 0,
            properties: preset as any,
            createdAt: now,
            updatedAt: now
        });
        itemRepo.create(item);

        // Determine room
        const roomIndex = lootSpec.room ?? 0;
        let roomId: string | undefined;
        let roomName: string | undefined;

        if (createdRooms.length > 0 && roomIndex < createdRooms.length) {
            roomId = createdRooms[roomIndex].id;
            roomName = createdRooms[roomIndex].name;
            // Add item to room's entity list
            spatialRepo.addEntityToRoom(roomId, itemId);
        }

        placedLoot.push({
            itemId,
            name: preset.name,
            count: lootSpec.count || 1,
            roomId,
            roomName
        });
    }

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                poi: {
                    id: poiId,
                    name: parsed.name,
                    category: parsed.category,
                    icon: parsed.icon,
                    position: { x: posX, y: posY },
                    discoveryState: parsed.discoveryState || 'unknown',
                    level: parsed.level,
                    population: parsed.population || 0
                },
                network: networkId ? {
                    id: networkId,
                    roomCount: createdRooms.length,
                    entranceRoomId
                } : null,
                rooms: createdRooms,
                inhabitants: createdInhabitants,
                loot: placedLoot,
                summary: {
                    totalInhabitants: createdInhabitants.length,
                    totalLootItems: placedLoot.reduce((sum, l) => sum + l.count, 0),
                    totalRooms: createdRooms.length
                },
                message: `Created ${parsed.name} with ${createdRooms.length} rooms, ${createdInhabitants.length} inhabitants, and ${placedLoot.length} loot items`
            }, null, 2)
        }]
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Generate ASCII map
// ═══════════════════════════════════════════════════════════════════════════

function generateEncounterMap(encounter: any, width: number, height: number): string {
    const grid: string[][] = [];
    for (let y = 0; y < height; y++) {
        grid[y] = [];
        for (let x = 0; x < width; x++) {
            grid[y][x] = '·';
        }
    }

    // Place terrain
    const terrain = encounter.state.terrain || {};
    for (const obs of terrain.obstacles || []) {
        const [x, y] = obs.split(',').map(Number);
        if (x >= 0 && x < width && y >= 0 && y < height) {
            grid[y][x] = '█';
        }
    }
    for (const dt of terrain.difficultTerrain || []) {
        const [x, y] = dt.split(',').map(Number);
        if (x >= 0 && x < width && y >= 0 && y < height && grid[y][x] === '·') {
            grid[y][x] = '░';
        }
    }
    for (const w of terrain.water || []) {
        const [x, y] = w.split(',').map(Number);
        if (x >= 0 && x < width && y >= 0 && y < height && grid[y][x] === '·') {
            grid[y][x] = '~';
        }
    }

    // Place participants
    let friendlyIdx = 0;
    let enemyIdx = 0;
    for (const p of encounter.state.participants) {
        if (!p.position) continue;
        const { x, y } = p.position;
        if (x >= 0 && x < width && y >= 0 && y < height) {
            if (p.hp <= 0) {
                grid[y][x] = '☠';
            } else if (p.isEnemy) {
                grid[y][x] = String((enemyIdx % 9) + 1);
                enemyIdx++;
            } else {
                grid[y][x] = String.fromCharCode(65 + (friendlyIdx % 26));
                friendlyIdx++;
            }
        }
    }

    // Build output
    let output = '';
    for (let y = 0; y < height; y++) {
        output += grid[y].join('') + '\n';
    }
    return output;
}

// ═══════════════════════════════════════════════════════════════════════════
// SPAWN_PRESET_ENCOUNTER HANDLER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Handle spawn_preset_encounter - create encounter from preset
 */
export async function handleSpawnPresetEncounter(args: unknown, _ctx: SessionContext) {
    const parsed = CompositeTools.SPAWN_PRESET_ENCOUNTER.inputSchema.parse(args);
    const { charRepo, partyRepo } = ensureDb();

    // Determine which preset to use
    let selectedPreset: EncounterPreset | null = null;

    if (parsed.preset) {
        selectedPreset = getEncounterPreset(parsed.preset);
        if (!selectedPreset) {
            const available = listEncounterPresets();
            throw new Error(`Unknown encounter preset: "${parsed.preset}". Available: ${available.slice(0, 10).join(', ')}...`);
        }
    } else if (parsed.random) {
        // Find matching encounters
        let candidates = getEncountersForLevel(parsed.level || 3);

        if (parsed.difficulty) {
            candidates = candidates.filter(e => e.difficulty === parsed.difficulty);
        }

        if (parsed.tags && parsed.tags.length > 0) {
            candidates = candidates.filter(e =>
                parsed.tags!.some(tag =>
                    e.tags.some(t => t.toLowerCase() === tag.toLowerCase())
                )
            );
        }

        if (candidates.length === 0) {
            throw new Error('No encounters match the specified criteria');
        }

        selectedPreset = candidates[Math.floor(Math.random() * candidates.length)];
    } else {
        throw new Error('Must provide either "preset" or "random: true"');
    }

    // Scale encounter if needed
    const partySize = parsed.partySize || 4;
    const partyLevel = parsed.partyLevel || parsed.level || 3;
    const scaledPreset = scaleEncounter(selectedPreset, partyLevel, partySize);

    // Build encounter parameters
    const seed = parsed.seed || `${scaledPreset.id}-${Date.now()}`;
    const now = new Date().toISOString();

    const combatManager = getCombatManager();
    const participants: CombatParticipant[] = [];
    const createdCharacterIds: string[] = [];

    // Create enemy participants from preset
    for (let i = 0; i < scaledPreset.participants.length; i++) {
        const p = scaledPreset.participants[i];
        const count = p.count || 1;

        for (let c = 0; c < count; c++) {
            const preset = expandCreatureTemplate(p.template, p.name);
            if (!preset) {
                console.warn(`Unknown creature template: ${p.template}, skipping`);
                continue;
            }

            const characterId = randomUUID();
            const displayName = count > 1 && !p.name
                ? `${preset.name} ${c + 1}`
                : (p.name || preset.name);

            // Parse position (offset for duplicates)
            const [baseX, baseY] = p.position.split(',').map(Number);
            const pos = { x: baseX + c, y: baseY, z: 0 };

            const character = buildCharacter({
                id: characterId,
                name: displayName,
                stats: preset.stats,
                hp: preset.hp,
                maxHp: preset.maxHp,
                ac: preset.ac,
                level: preset.level,
                characterType: preset.characterType,
                race: preset.race || 'Unknown',
                characterClass: preset.characterClass || 'monster',
                resistances: preset.resistances || [],
                vulnerabilities: preset.vulnerabilities || [],
                immunities: preset.immunities || [],
                position: { x: pos.x, y: pos.y },
                createdAt: now,
                updatedAt: now
            });
            charRepo.create(character);
            createdCharacterIds.push(characterId);

            // Calculate initiative bonus from DEX
            const dexMod = Math.floor((preset.stats.dex - 10) / 2);

            participants.push({
                id: characterId,
                name: displayName,
                initiative: 0,
                initiativeBonus: dexMod,
                hp: preset.hp,
                maxHp: preset.maxHp,
                conditions: [],
                position: pos,
                isEnemy: true,
                movementSpeed: preset.speed || 30,
                movementRemaining: preset.speed || 30,
                size: preset.size || 'medium',
                resistances: preset.resistances || [],
                vulnerabilities: preset.vulnerabilities || [],
                immunities: preset.immunities || []
            });
        }
    }

    // Add party members if partyId specified
    const partyMemberIds: string[] = [];
    if (parsed.partyId) {
        const party = partyRepo.getPartyWithMembers(parsed.partyId);
        if (party && party.members) {
            const positions = parsed.partyPositions || scaledPreset.partyPositions || [];

            for (let i = 0; i < party.members.length; i++) {
                const member = party.members[i];
                const char = member.character;
                partyMemberIds.push(char.id);

                // Parse position
                let pos = { x: 10 + i, y: 12, z: 0 };
                if (positions[i]) {
                    const [px, py] = positions[i].split(',').map(Number);
                    pos = { x: px, y: py, z: 0 };
                }

                const dexMod = Math.floor((char.stats.dex - 10) / 2);

                participants.push({
                    id: char.id,
                    name: char.name,
                    initiative: 0,
                    initiativeBonus: dexMod,
                    hp: char.hp,
                    maxHp: char.maxHp,
                    conditions: [],
                    position: pos,
                    isEnemy: false,
                    movementSpeed: 30,
                    movementRemaining: 30,
                    size: 'medium',
                    resistances: (char as any).resistances || [],
                    vulnerabilities: (char as any).vulnerabilities || [],
                    immunities: (char as any).immunities || []
                });
            }
        }
    }

    // Create terrain from preset
    const terrain: { obstacles: string[]; difficultTerrain?: string[]; water?: string[] } = {
        obstacles: [],
        difficultTerrain: [],
        water: []
    };

    if (scaledPreset.terrain) {
        terrain.obstacles = scaledPreset.terrain.obstacles || [];
        terrain.difficultTerrain = scaledPreset.terrain.difficultTerrain || [];
        terrain.water = scaledPreset.terrain.water || [];
    }

    // Create encounter using CombatEngine
    const encounterId = `encounter-${seed}`;
    const engine = new CombatEngine(seed);
    const encounterState = engine.startEncounter(participants);

    // Add terrain to the state
    (encounterState as any).terrain = terrain;

    // Register with combat manager
    combatManager.create(encounterId, engine);

    // Generate ASCII map
    const mapWidth = 20;
    const mapHeight = 15;
    const asciiMap = generateEncounterMap({ state: encounterState }, mapWidth, mapHeight);

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                encounterId,
                preset: {
                    id: scaledPreset.id,
                    name: scaledPreset.name,
                    difficulty: scaledPreset.difficulty,
                    recommendedLevel: scaledPreset.recommendedLevel,
                    narrativeHook: scaledPreset.narrativeHook
                },
                scaling: {
                    partySize,
                    partyLevel,
                    originalParticipants: selectedPreset.participants.length,
                    scaledParticipants: participants.filter(p => p.isEnemy).length
                },
                encounter: {
                    round: encounterState.round,
                    turnOrder: encounterState.turnOrder.map((id: string, idx: number) => {
                        const p = encounterState.participants.find((pp: CombatParticipant) => pp.id === id);
                        return {
                            order: idx + 1,
                            id,
                            name: p?.name,
                            initiative: p?.initiative,
                            hp: p ? `${p.hp}/${p.maxHp}` : undefined,
                            position: p?.position,
                            isEnemy: p?.isEnemy
                        };
                    }),
                    currentTurn: encounterState.turnOrder[0]
                },
                terrain: {
                    obstacles: terrain.obstacles.length,
                    difficultTerrain: terrain.difficultTerrain?.length || 0,
                    water: terrain.water?.length || 0
                },
                partyMembers: partyMemberIds.length > 0 ? partyMemberIds : undefined,
                createdCharacterIds,
                asciiMap,
                message: `Created "${scaledPreset.name}" encounter with ${participants.length} combatants`
            }, null, 2)
        }]
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// REST_PARTY HANDLER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Roll a die (simulated with random)
 */
function rollDie(sides: number): number {
    return Math.floor(Math.random() * sides) + 1;
}

/**
 * Get hit die size based on class
 */
function getHitDieSize(characterClass: string): number {
    const hitDice: Record<string, number> = {
        barbarian: 12,
        fighter: 10, paladin: 10, ranger: 10,
        bard: 8, cleric: 8, druid: 8, monk: 8, rogue: 8, warlock: 8,
        sorcerer: 6, wizard: 6
    };
    return hitDice[characterClass.toLowerCase()] || 8;
}

/**
 * Handle rest_party - rest entire party at once
 */
export async function handleRestParty(args: unknown, _ctx: SessionContext) {
    const parsed = CompositeTools.REST_PARTY.inputSchema.parse(args);
    const { charRepo, partyRepo } = ensureDb();

    const party = partyRepo.getPartyWithMembers(parsed.partyId);
    if (!party) {
        throw new Error(`Party not found: ${parsed.partyId}`);
    }

    if (!party.members || party.members.length === 0) {
        throw new Error(`Party ${parsed.partyId} has no members`);
    }

    // Check if any member is in combat
    const combatManager = getCombatManager();
    const membersInCombat: string[] = [];
    for (const member of party.members) {
        if (combatManager.isCharacterInCombat(member.characterId)) {
            membersInCombat.push(member.character.name);
        }
    }

    if (membersInCombat.length > 0) {
        throw new Error(`Cannot rest while party members are in combat: ${membersInCombat.join(', ')}`);
    }

    const results: Array<{
        characterId: string;
        name: string;
        previousHp: number;
        newHp: number;
        maxHp: number;
        hpRestored: number;
        spellSlotsRestored?: any;
        hitDiceSpent?: number;
        rolls?: number[];
    }> = [];

    if (parsed.restType === 'long') {
        // Long rest - full HP and spell slot recovery
        for (const member of party.members) {
            const char = charRepo.findById(member.characterId);
            if (!char) continue;

            const previousHp = char.hp;
            const hpRestored = char.maxHp - char.hp;

            // Restore spell slots
            const charClass = char.characterClass || 'fighter';
            const spellConfig = getSpellcastingConfig(charClass as any);

            let spellSlotsRestored: any = undefined;
            let updatedChar: any = { hp: char.maxHp };

            if (spellConfig.canCast && char.level >= spellConfig.startLevel) {
                const restoredChar = restoreAllSpellSlots(char);

                if (spellConfig.pactMagic) {
                    spellSlotsRestored = {
                        type: 'pactMagic',
                        slotsRestored: restoredChar.pactMagicSlots?.max || 0,
                        slotLevel: restoredChar.pactMagicSlots?.slotLevel || 0
                    };
                    updatedChar.pactMagicSlots = restoredChar.pactMagicSlots;
                } else if (restoredChar.spellSlots) {
                    spellSlotsRestored = {
                        type: 'standard',
                        restored: true
                    };
                    updatedChar.spellSlots = restoredChar.spellSlots;
                }

                // Clear concentration and active spells
                updatedChar.concentratingOn = null;
                updatedChar.activeSpells = [];
            }

            charRepo.update(member.characterId, updatedChar);

            results.push({
                characterId: member.characterId,
                name: char.name,
                previousHp,
                newHp: char.maxHp,
                maxHp: char.maxHp,
                hpRestored,
                spellSlotsRestored
            });
        }
    } else {
        // Short rest - hit dice healing, warlock pact slot recovery
        for (const member of party.members) {
            const char = charRepo.findById(member.characterId);
            if (!char) continue;

            // Determine hit dice to spend
            const hitDiceToSpend = parsed.hitDiceAllocation?.[member.characterId]
                ?? parsed.hitDicePerMember
                ?? 1;

            const hitDieSize = getHitDieSize(char.characterClass || 'fighter');
            const conMod = Math.floor((char.stats.con - 10) / 2);

            // Roll hit dice
            let totalHealing = 0;
            const rolls: number[] = [];

            for (let i = 0; i < hitDiceToSpend; i++) {
                const roll = rollDie(hitDieSize);
                rolls.push(roll);
                totalHealing += Math.max(1, roll + conMod);
            }

            const actualHealing = Math.min(totalHealing, char.maxHp - char.hp);
            const newHp = char.hp + actualHealing;

            // Warlock pact slot recovery
            const charClass = char.characterClass || 'fighter';
            const spellConfig = getSpellcastingConfig(charClass as any);

            let pactSlotsRestored: any = undefined;
            let updatedChar: any = { hp: newHp };

            if (spellConfig.pactMagic && spellConfig.canCast && char.level >= spellConfig.startLevel) {
                const restoredChar = restorePactSlots(char);
                pactSlotsRestored = {
                    type: 'pactMagic',
                    slotsRestored: restoredChar.pactMagicSlots?.max || 0,
                    slotLevel: restoredChar.pactMagicSlots?.slotLevel || 0
                };
                updatedChar.pactMagicSlots = restoredChar.pactMagicSlots;
            }

            charRepo.update(member.characterId, updatedChar);

            results.push({
                characterId: member.characterId,
                name: char.name,
                previousHp: char.hp,
                newHp,
                maxHp: char.maxHp,
                hpRestored: actualHealing,
                hitDiceSpent: hitDiceToSpend,
                rolls: rolls.length > 0 ? rolls : undefined,
                spellSlotsRestored: pactSlotsRestored
            });
        }
    }

    const totalHpRestored = results.reduce((sum, r) => sum + r.hpRestored, 0);

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                partyId: parsed.partyId,
                partyName: party.name,
                restType: parsed.restType,
                memberCount: results.length,
                totalHpRestored,
                members: results,
                message: `${party.name} completed a ${parsed.restType} rest. ${totalHpRestored} total HP restored across ${results.length} members.`
            }, null, 2)
        }]
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// LOOT_ENCOUNTER HANDLER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Handle loot_encounter - loot all corpses from an encounter
 */
export async function handleLootEncounter(args: unknown, _ctx: SessionContext) {
    const parsed = CompositeTools.LOOT_ENCOUNTER.inputSchema.parse(args);
    const { partyRepo, inventoryRepo } = ensureDb();

    // Need either looterId or partyId
    if (!parsed.looterId && !parsed.partyId) {
        throw new Error('Must provide either looterId or partyId');
    }

    // Get looter(s)
    let looterIds: string[] = [];

    if (parsed.looterId) {
        looterIds = [parsed.looterId];
    } else if (parsed.partyId) {
        const party = partyRepo.getPartyWithMembers(parsed.partyId);
        if (!party || !party.members || party.members.length === 0) {
            throw new Error(`Party not found or has no members: ${parsed.partyId}`);
        }
        looterIds = party.members.map(m => m.characterId);
    }

    // Get corpse repository
    const dbPath = process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db';
    const db = getDb(dbPath);
    const corpseRepo = new CorpseRepository(db);

    // Find all corpses from encounter
    const corpses = corpseRepo.findByEncounterId(parsed.encounterId);

    if (corpses.length === 0) {
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    encounterId: parsed.encounterId,
                    corpseCount: 0,
                    message: 'No corpses found for this encounter'
                }, null, 2)
            }]
        };
    }

    // Track looted items
    const lootedItems: Array<{
        corpseId: string;
        corpseName: string;
        itemId: string;
        itemName?: string;
        quantity: number;
        receivedBy: string;
    }> = [];

    const currencyCollected = {
        gold: 0,
        silver: 0,
        copper: 0
    };

    const harvestedResources: Array<{
        corpseId: string;
        resourceType: string;
        quantity: number;
        success: boolean;
    }> = [];

    let looterIndex = 0;

    // Loot each corpse
    for (const corpse of corpses) {
        // Skip fully looted corpses
        if (corpse.looted && !parsed.includeHarvestable) continue;

        // Get available loot
        const availableLoot = corpseRepo.getAvailableLoot(corpse.id);

        // Determine who gets this corpse's loot
        const currentLooter = parsed.distributeEvenly
            ? looterIds[looterIndex % looterIds.length]
            : looterIds[0];

        // Loot items if requested
        if (parsed.includeItems && availableLoot.length > 0) {
            const looted = corpseRepo.lootAll(corpse.id, currentLooter);

            for (const item of looted) {
                lootedItems.push({
                    corpseId: corpse.id,
                    corpseName: corpse.characterName,
                    itemId: item.itemId,
                    quantity: item.quantity || 1,
                    receivedBy: currentLooter
                });
            }
        }

        // Collect currency if requested
        if (parsed.includeCurrency && corpse.currency) {
            const currency = corpse.currency as { gold?: number; silver?: number; copper?: number };
            currencyCollected.gold += currency.gold || 0;
            currencyCollected.silver += currency.silver || 0;
            currencyCollected.copper += currency.copper || 0;
        }

        // Harvest resources if requested
        if (parsed.includeHarvestable && corpse.harvestable && corpse.harvestableResources) {
            const harvestables = corpse.harvestableResources as Array<{ resourceType: string; quantity: number; dcRequired?: number; harvested: boolean }>;

            for (const resource of harvestables) {
                // Skip already-harvested resources
                if (resource.harvested) continue;

                // Auto-harvest without skill check (will succeed for non-DC resources)
                const result = corpseRepo.harvestResource(
                    corpse.id,
                    resource.resourceType,
                    currentLooter
                );

                harvestedResources.push({
                    corpseId: corpse.id,
                    resourceType: resource.resourceType,
                    quantity: result.quantity || 0,
                    success: result.success
                });
            }
        }

        // Rotate to next looter if distributing evenly
        if (parsed.distributeEvenly) {
            looterIndex++;
        }
    }

    // Distribute currency evenly to party if requested
    if (parsed.includeCurrency && parsed.partyId && currencyCollected.gold + currencyCollected.silver + currencyCollected.copper > 0) {
        const totalCopper = currencyCollected.gold * 100 + currencyCollected.silver * 10 + currencyCollected.copper;
        const shareCopper = Math.floor(totalCopper / looterIds.length);

        // Convert share back to gold/silver/copper
        const shareGold = Math.floor(shareCopper / 100);
        const shareSilver = Math.floor((shareCopper % 100) / 10);
        const sharecopperRemainder = shareCopper % 10;

        // Add currency to each party member's inventory
        for (const looterId of looterIds) {
            if (shareGold > 0 || shareSilver > 0 || sharecopperRemainder > 0) {
                inventoryRepo.addCurrency(looterId, {
                    gold: shareGold,
                    silver: shareSilver,
                    copper: sharecopperRemainder
                });
            }
        }
    } else if (parsed.includeCurrency && parsed.looterId && currencyCollected.gold + currencyCollected.silver + currencyCollected.copper > 0) {
        // Give all currency to single looter
        inventoryRepo.addCurrency(parsed.looterId, currencyCollected);
    }

    const totalItems = lootedItems.reduce((sum, item) => sum + item.quantity, 0);
    const totalCurrency = currencyCollected.gold * 100 + currencyCollected.silver * 10 + currencyCollected.copper;

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                encounterId: parsed.encounterId,
                corpseCount: corpses.length,
                lootedBy: parsed.partyId ? `party:${parsed.partyId}` : parsed.looterId,
                distributeEvenly: parsed.distributeEvenly,
                items: {
                    count: totalItems,
                    details: lootedItems
                },
                currency: parsed.includeCurrency ? {
                    gold: currencyCollected.gold,
                    silver: currencyCollected.silver,
                    copper: currencyCollected.copper,
                    totalCopperValue: totalCurrency,
                    distributedTo: parsed.partyId ? looterIds : [parsed.looterId]
                } : undefined,
                harvestedResources: parsed.includeHarvestable ? harvestedResources : undefined,
                message: `Looted ${corpses.length} corpses: ${totalItems} items, ${currencyCollected.gold}gp ${currencyCollected.silver}sp ${currencyCollected.copper}cp`
            }, null, 2)
        }]
    };
}

/**
 * Handle travel_to_location
 * Moves a party to a POI, auto-discovers if needed, optionally enters location
 */
export async function handleTravelToLocation(args: unknown, _ctx: SessionContext) {
    const parsed = CompositeTools.TRAVEL_TO_LOCATION.inputSchema.parse(args);
    const db = getDb();
    const partyRepo = new PartyRepository(db);
    const poiRepo = new POIRepository(db);
    const charRepo = new CharacterRepository(db);
    const spatialRepo = new SpatialRepository(db);

    // Get the party
    const party = partyRepo.findById(parsed.partyId);
    if (!party) {
        throw new Error(`Party not found: ${parsed.partyId}`);
    }

    // Get party members for discovery checks
    const partyWithMembers = partyRepo.getPartyWithMembers(parsed.partyId);
    if (!partyWithMembers || partyWithMembers.members.length === 0) {
        throw new Error('Party has no members');
    }

    // Get the POI
    const poi = poiRepo.findById(parsed.poiId);
    if (!poi) {
        throw new Error(`POI not found: ${parsed.poiId}`);
    }

    // Find party leader or use specified character for discovery
    const leader = partyWithMembers.members.find(m => m.role === 'leader') || partyWithMembers.members[0];
    const discovererId = parsed.discoveringCharacterId || leader.characterId;

    // Result tracking
    const result: {
        partyId: string;
        poiId: string;
        poiName: string;
        moved: boolean;
        discovered: boolean;
        discoveryCheck?: { roll: number; dc: number; success: boolean };
        enteredRoom: boolean;
        entranceRoomId?: string;
        position: { x: number; y: number };
        message: string;
    } = {
        partyId: parsed.partyId,
        poiId: parsed.poiId,
        poiName: poi.name,
        moved: false,
        discovered: poi.discoveryState !== 'unknown',
        enteredRoom: false,
        position: { x: poi.x, y: poi.y },
        message: ''
    };

    // Handle discovery if POI is unknown
    if (poi.discoveryState === 'unknown') {
        const discoverer = charRepo.findById(discovererId);
        if (!discoverer) {
            throw new Error(`Discovering character not found: ${discovererId}`);
        }

        if (parsed.autoDiscover || !poi.discoveryDC) {
            // Auto-discover without check
            poiRepo.discoverPOI(parsed.poiId, discovererId);
            result.discovered = true;
        } else {
            // Make perception check
            const perceptionBonus = discoverer.perceptionBonus || 0;
            const roll = Math.floor(Math.random() * 20) + 1;
            const total = roll + perceptionBonus;
            const success = total >= poi.discoveryDC;

            result.discoveryCheck = {
                roll: total,
                dc: poi.discoveryDC,
                success
            };

            if (success) {
                poiRepo.discoverPOI(parsed.poiId, discovererId);
                result.discovered = true;
            } else {
                // Failed discovery - can't proceed to this location
                result.message = `${discoverer.name} rolled ${total} (DC ${poi.discoveryDC}) - failed to find the hidden location`;
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify(result, null, 2)
                    }]
                };
            }
        }
    }

    // Move party to POI coordinates
    partyRepo.updatePartyPosition(
        parsed.partyId,
        poi.x,
        poi.y,
        poi.name,
        poi.id
    );
    result.moved = true;

    // Optionally enter the location's room network
    if (parsed.enterLocation && poi.networkId) {
        // Find entrance room
        let entranceRoomId = poi.entranceRoomId;

        if (!entranceRoomId) {
            // Try to find an entrance room in the network
            const allRooms = spatialRepo.findRoomsByNetwork(poi.networkId);
            const entranceRoom = allRooms.find(room =>
                room.name.toLowerCase().includes('entrance') ||
                room.name.toLowerCase().includes('entry') ||
                room.name.toLowerCase().includes('door') ||
                room.name.toLowerCase().includes('gate')
            ) || allRooms[0];

            if (entranceRoom) {
                entranceRoomId = entranceRoom.id;
            }
        }

        if (entranceRoomId) {
            // Move party leader into the room
            const leaderChar = charRepo.findById(leader.characterId);
            if (leaderChar) {
                charRepo.update(leader.characterId, {
                    ...leaderChar,
                    currentRoomId: entranceRoomId,
                    updatedAt: new Date().toISOString()
                });
                spatialRepo.incrementVisitCount(entranceRoomId);
                result.enteredRoom = true;
                result.entranceRoomId = entranceRoomId;
            }
        }
    }

    // Build success message
    const messages: string[] = [];
    messages.push(`Party "${party.name}" traveled to ${poi.name}`);

    if (result.discoveryCheck) {
        messages.push(`Discovery check: ${result.discoveryCheck.roll} vs DC ${result.discoveryCheck.dc} - SUCCESS`);
    }

    if (result.enteredRoom) {
        messages.push(`Entered location`);
    }

    result.message = messages.join('. ');

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2)
        }]
    };
}

/**
 * Handle spawn_preset_location
 * Creates a complete location from a preset including POI, room network, and NPCs
 */
export async function handleSpawnPresetLocation(args: unknown, _ctx: SessionContext) {
    const parsed = CompositeTools.SPAWN_PRESET_LOCATION.inputSchema.parse(args);
    const db = getDb();
    const poiRepo = new POIRepository(db);
    const spatialRepo = new SpatialRepository(db);
    const charRepo = new CharacterRepository(db);

    // Get the preset
    const preset = getLocationPreset(parsed.preset);
    if (!preset) {
        // List available presets
        const available = listLocationPresets();
        throw new Error(`Unknown location preset: ${parsed.preset}. Available: ${available.map(p => p.id).join(', ')}`);
    }

    const now = new Date().toISOString();
    const locationName = parsed.customName || preset.name;

    // Create the room network
    const networkId = randomUUID();
    spatialRepo.createNetwork({
        id: networkId,
        name: locationName,
        type: preset.networkType,
        worldId: parsed.worldId,
        centerX: parsed.x,
        centerY: parsed.y,
        createdAt: now,
        updatedAt: now
    });

    // Create rooms and track ID mappings
    const roomIdMap: Record<string, string> = {};
    const createdRooms: Array<{ id: string; name: string; presetId: string }> = [];

    for (const presetRoom of preset.rooms) {
        const roomId = randomUUID();
        roomIdMap[presetRoom.id] = roomId;

        spatialRepo.create({
            id: roomId,
            networkId: networkId,
            name: presetRoom.name,
            baseDescription: presetRoom.description,
            biomeContext: presetRoom.biome,
            atmospherics: [],
            localX: presetRoom.localX ?? 0,
            localY: presetRoom.localY ?? 0,
            exits: [], // Will be connected after all rooms created
            entityIds: [],
            createdAt: now,
            updatedAt: now,
            visitedCount: 0
        });

        createdRooms.push({
            id: roomId,
            name: presetRoom.name,
            presetId: presetRoom.id
        });
    }

    // Connect rooms with exits
    for (const presetRoom of preset.rooms) {
        const roomId = roomIdMap[presetRoom.id];
        const exits = presetRoom.exits.map(exit => ({
            direction: exit.direction,
            targetNodeId: roomIdMap[exit.targetRoomId],
            type: exit.exitType || 'OPEN' as const,
            dc: exit.lockDC
        }));

        spatialRepo.update(roomId, { exits });
    }

    // Find entrance room (first room or one named "entrance")
    const entrancePresetRoom = preset.rooms.find(r =>
        r.name.toLowerCase().includes('entrance') ||
        r.name.toLowerCase().includes('entry') ||
        r.id === 'entrance'
    ) || preset.rooms[0];
    const entranceRoomId = roomIdMap[entrancePresetRoom.id];

    // Create POI
    const poiId = randomUUID();
    poiRepo.create({
        id: poiId,
        worldId: parsed.worldId,
        x: parsed.x,
        y: parsed.y,
        name: locationName,
        description: preset.description,
        category: preset.category,
        icon: preset.icon,
        discoveryState: parsed.discoveryState as 'unknown' | 'rumored' | 'discovered' | 'explored' | 'mapped',
        discoveredBy: [],
        childPOIIds: [],
        population: 0,
        networkId: networkId,
        entranceRoomId: entranceRoomId,
        tags: preset.tags,
        createdAt: now,
        updatedAt: now
    });

    // Spawn NPCs if requested
    const createdNpcs: Array<{ id: string; name: string; room: string; role?: string }> = [];

    if (parsed.spawnNpcs && preset.npcs) {
        for (const presetNpc of preset.npcs) {
            const npcTemplate = expandCreatureTemplate(presetNpc.template, presetNpc.name);
            if (!npcTemplate) {
                continue; // Skip unknown templates
            }

            const npcId = randomUUID();
            const roomId = roomIdMap[presetNpc.roomId];

            const npc = buildCharacter({
                id: npcId,
                name: presetNpc.name || npcTemplate.name,
                stats: npcTemplate.stats,
                hp: npcTemplate.hp,
                maxHp: npcTemplate.maxHp,
                ac: npcTemplate.ac,
                level: npcTemplate.level,
                characterType: 'npc',
                race: npcTemplate.race || 'Human',
                characterClass: npcTemplate.characterClass || 'commoner',
                currentRoomId: roomId,
                createdAt: now,
                updatedAt: now
            });
            // Note: behavior field is stored in NPC-specific extended data, not base Character

            charRepo.create(npc);

            // Add to room's entity list
            const room = spatialRepo.findById(roomId);
            if (room) {
                spatialRepo.update(roomId, {
                    entityIds: [...room.entityIds, npcId]
                });
            }

            createdNpcs.push({
                id: npcId,
                name: npc.name,
                room: presetNpc.roomId,
                role: presetNpc.role
            });
        }
    }

    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                preset: preset.id,
                locationName,
                poiId,
                networkId,
                entranceRoomId,
                position: { x: parsed.x, y: parsed.y },
                discoveryState: parsed.discoveryState,
                rooms: {
                    count: createdRooms.length,
                    list: createdRooms
                },
                npcs: parsed.spawnNpcs ? {
                    count: createdNpcs.length,
                    list: createdNpcs
                } : undefined,
                narrativeHook: preset.narrativeHook,
                message: `Spawned "${locationName}" at (${parsed.x}, ${parsed.y}) with ${createdRooms.length} rooms${parsed.spawnNpcs ? ` and ${createdNpcs.length} NPCs` : ''}`
            }, null, 2)
        }]
    };
}
