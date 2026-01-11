/**
 * Consolidated spawn_manage tool
 * Replaces: spawn_equipped_character, spawn_populated_location, spawn_preset_encounter, spawn_preset_location, setup_tactical_encounter
 * 5 tools → 1 tool with 5 actions
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';
import { matchAction, isGuidingError } from '../../utils/fuzzy-enum.js';

export interface McpResponse {
    content: Array<{ type: 'text'; text: string }>;
}
import { RichFormatter } from '../utils/formatter.js';
import { getDb } from '../../storage/index.js';
import { CharacterRepository } from '../../storage/repos/character.repo.js';
import { PartyRepository } from '../../storage/repos/party.repo.js';
import { EncounterRepository } from '../../storage/repos/encounter.repo.js';
import { SessionContext } from '../types.js';
import { CombatEngine, CombatParticipant } from '../../engine/combat/engine.js';
import { getCombatManager } from '../state/combat-manager.js';
// generateEncounterMap removed - using local simple renderer
import { expandCreatureTemplate } from '../../data/creature-presets.js';
import { getPatternGenerator } from '../terrain-patterns.js';

// Pattern type inline definition
type TerrainPatternName = 'river_valley' | 'canyon' | 'arena' | 'mountain_pass' | 'maze' | 'maze_rooms';

// Simple ASCII map generator for spawned encounters
function generateEncounterMap(encounterData: { state: any }, width: number, height: number): string {
    const state = encounterData.state;
    const grid: string[][] = [];
    
    // Initialize empty grid
    for (let y = 0; y < height; y++) {
        grid[y] = [];
        for (let x = 0; x < width; x++) {
            grid[y][x] = '.';
        }
    }
    
    // Place tokens
    if (state.tokens) {
        for (const token of state.tokens) {
            if (token.position && token.position.x >= 0 && token.position.x < width && 
                token.position.y >= 0 && token.position.y < height) {
                const symbol = token.type === 'pc' ? '@' : token.type === 'enemy' ? 'E' : 'N';
                grid[token.position.y][token.position.x] = symbol;
            }
        }
    }
    
    // Build ASCII output
    const lines: string[] = [];
    lines.push('┌' + '─'.repeat(width) + '┐');
    for (const row of grid) {
        lines.push('│' + row.join('') + '│');
    }
    lines.push('└' + '─'.repeat(width) + '┘');
    
    return lines.join('\n');
}
import { parsePosition } from '../../utils/schema-shorthand.js';
import { ENCOUNTER_PRESETS, getEncountersByTag, getEncountersForLevel, scaleEncounter } from '../../data/encounter-presets.js';
import { Character } from '../../schema/character.js';

// Helper function to build a complete Character object
function buildCharacter(data: {
    id: string;
    name: string;
    stats: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
    hp: number;
    maxHp: number;
    ac: number;
    level: number;
    characterType: 'pc' | 'npc' | 'enemy' | 'ally';
    race: string;
    characterClass: string;
    resistances?: string[];
    vulnerabilities?: string[];
    immunities?: string[];
    position?: { x: number; y: number };
    inventory?: string[];
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
        characterType: data.characterType as any,
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
        createdAt: data.createdAt,
        updatedAt: data.updatedAt
    };
}

const ACTIONS = [
    'spawn_character', 'spawn_location', 'spawn_encounter',
    'spawn_preset_location', 'spawn_tactical'
] as const;

type SpawnAction = typeof ACTIONS[number];

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
        partyRepo: new PartyRepository(db),
        encounterRepo: new EncounterRepository(db)
    };
}

// Alias map for fuzzy action matching
const ALIASES: Record<string, SpawnAction> = {
    'character': 'spawn_character',
    'create_character': 'spawn_character',
    'spawn_equipped': 'spawn_character',
    'equipped_character': 'spawn_character',
    'location': 'spawn_location',
    'populated_location': 'spawn_location',
    'spawn_populated': 'spawn_location',
    'encounter': 'spawn_encounter',
    'preset_encounter': 'spawn_encounter',
    'random_encounter': 'spawn_encounter',
    'preset_location': 'spawn_preset_location',
    'preset': 'spawn_preset_location',
    'location_preset': 'spawn_preset_location',
    'tactical': 'spawn_tactical',
    'tactical_encounter': 'spawn_tactical',
    'setup_tactical': 'spawn_tactical',
    'combat_setup': 'spawn_tactical'
};

// Input schema combining all spawn actions
const SpawnManageInputSchema = z.object({
    action: z.string().describe('Action: spawn_character, spawn_location, spawn_encounter, spawn_preset_location, spawn_tactical'),

    // Common fields
    name: z.string().optional().describe('Name for spawned entity'),
    worldId: z.string().optional().describe('World ID for location spawning'),

    // spawn_character fields
    template: z.string().optional().describe('Creature template (e.g., "goblin", "orc_warrior")'),
    equipment: z.array(z.string()).optional().describe('Equipment to give the character'),
    position: z.string().optional().describe('Position as "x,y" string'),
    characterType: z.enum(['pc', 'npc', 'enemy', 'ally']).optional().default('enemy'),

    // spawn_location fields (populated)
    locationType: z.string().optional().describe('Location type (tavern, shop, temple, etc.)'),
    npcs: z.array(z.object({
        name: z.string(),
        role: z.string(),
        race: z.string().optional().default('Human'),
        behavior: z.string().optional()
    })).optional().describe('NPCs to spawn in location'),
    rooms: z.array(z.object({
        name: z.string(),
        description: z.string().optional(),
        exits: z.array(z.string()).optional()
    })).optional().describe('Rooms in the location'),

    // spawn_encounter fields
    preset: z.string().optional().describe('Encounter preset ID'),
    random: z.boolean().optional().describe('Select random encounter'),
    difficulty: z.enum(['easy', 'medium', 'hard', 'deadly']).optional(),
    level: z.number().int().min(1).max(20).optional(),
    tags: z.array(z.string()).optional().describe('Tags to filter random encounters'),
    partySize: z.number().int().min(1).max(10).optional().default(4),
    partyLevel: z.number().int().min(1).max(20).optional(),
    partyId: z.string().optional().describe('Party ID for encounter setup'),
    partyPositions: z.array(z.string()).optional().describe('Party starting positions'),
    seed: z.string().optional().describe('Random seed for determinism'),

    // spawn_preset_location fields
    x: z.number().int().min(0).optional().describe('X coordinate'),
    y: z.number().int().min(0).optional().describe('Y coordinate'),
    customName: z.string().optional().describe('Override default name'),
    spawnNpcs: z.boolean().optional().default(false),
    discoveryState: z.enum(['unknown', 'rumored', 'discovered', 'explored', 'mapped']).optional().default('discovered'),

    // spawn_tactical fields
    participants: z.array(z.object({
        template: z.string().describe('Creature template'),
        name: z.string().optional(),
        position: z.string().describe('Position as "x,y"'),
        isEnemy: z.boolean().optional().default(true)
    })).optional().describe('Combat participants'),
    terrain: z.object({
        obstacles: z.array(z.string()).optional(),
        difficultTerrain: z.array(z.string()).optional(),
        water: z.array(z.string()).optional(),
        pattern: z.string().optional()
    }).optional().describe('Terrain configuration'),
    gridSize: z.object({
        width: z.number().int().min(5).max(100).default(20),
        height: z.number().int().min(5).max(100).default(20)
    }).optional().describe('Combat grid dimensions')
});

type SpawnManageInput = z.infer<typeof SpawnManageInputSchema>;

// Action handlers
async function handleSpawnCharacter(input: SpawnManageInput, _ctx: SessionContext): Promise<McpResponse> {
    const { charRepo } = ensureDb();
    const now = new Date().toISOString();

    if (!input.template) {
        return {
            content: [{
                type: 'text',
                text: RichFormatter.error('spawn_character requires template parameter') +
                    RichFormatter.embedJson({ error: true, message: 'template required' }, 'SPAWN_MANAGE')
            }]
        };
    }

    const preset = expandCreatureTemplate(input.template, input.name);
    if (!preset) {
        return {
            content: [{
                type: 'text',
                text: RichFormatter.error(`Unknown creature template: ${input.template}`) +
                    RichFormatter.embedJson({ error: true, message: `Unknown template: ${input.template}` }, 'SPAWN_MANAGE')
            }]
        };
    }

    const pos = input.position ? parsePosition(input.position) : { x: 0, y: 0 };
    const characterId = randomUUID();

    const character = buildCharacter({
        id: characterId,
        name: preset.name,
        stats: preset.stats,
        hp: preset.hp,
        maxHp: preset.maxHp,
        ac: preset.ac,
        level: preset.level,
        characterType: input.characterType || preset.characterType || 'enemy',
        race: preset.race || 'Unknown',
        characterClass: preset.characterClass || 'monster',
        resistances: preset.resistances || [],
        vulnerabilities: preset.vulnerabilities || [],
        immunities: preset.immunities || [],
        position: pos,
        inventory: input.equipment || [],
        createdAt: now,
        updatedAt: now
    });

    charRepo.create(character);

    let output = RichFormatter.header('Character Spawned', '👤');
    output += RichFormatter.keyValue({
        'ID': characterId,
        'Name': preset.name,
        'Template': input.template,
        'HP': `${preset.hp}/${preset.maxHp}`,
        'AC': preset.ac,
        'Position': `(${pos.x}, ${pos.y})`
    });

    if (input.equipment && input.equipment.length > 0) {
        output += RichFormatter.section('Equipment');
        output += RichFormatter.list(input.equipment);
    }

    const result = {
        success: true,
        actionType: 'spawn_character',
        characterId,
        name: preset.name,
        template: input.template,
        hp: preset.hp,
        maxHp: preset.maxHp,
        ac: preset.ac,
        position: pos,
        equipment: input.equipment || []
    };

    output += RichFormatter.embedJson(result, 'SPAWN_MANAGE');

    return { content: [{ type: 'text', text: output }] };
}

async function handleSpawnLocation(input: SpawnManageInput, _ctx: SessionContext): Promise<McpResponse> {
    const { charRepo, db } = ensureDb();
    const now = new Date().toISOString();

    const locationId = randomUUID();
    const locationName = input.name || `${input.locationType || 'Location'}-${locationId.slice(0, 8)}`;

    // Create NPCs if provided
    const createdNpcs: Array<{ id: string; name: string; role: string }> = [];
    if (input.npcs && input.npcs.length > 0) {
        for (const npcData of input.npcs) {
            const npcId = randomUUID();
            const npc = {
                id: npcId,
                name: npcData.name,
                race: npcData.race || 'Human',
                characterClass: npcData.role,
                characterType: 'npc' as const,
                behavior: npcData.behavior,
                hp: 10,
                maxHp: 10,
                ac: 10,
                level: 1,
                stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
                createdAt: now,
                updatedAt: now,
                metadata: JSON.stringify({ location: locationName, locationId })
            };
            charRepo.create(npc as any);
            createdNpcs.push({ id: npcId, name: npcData.name, role: npcData.role });
        }
    }

    // Create rooms if provided
    const createdRooms: Array<{ id: string; name: string }> = [];
    if (input.rooms && input.rooms.length > 0) {
        for (const roomData of input.rooms) {
            const roomId = randomUUID();
            // Store room in database (simplified - real impl would use room repo)
            db.prepare(`
                INSERT OR REPLACE INTO rooms (id, networkId, name, description, exits, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
                roomId,
                locationId,
                roomData.name,
                roomData.description || '',
                JSON.stringify(roomData.exits || []),
                now,
                now
            );
            createdRooms.push({ id: roomId, name: roomData.name });
        }
    }

    let output = RichFormatter.header('Location Spawned', '🏠');
    output += RichFormatter.keyValue({
        'ID': locationId,
        'Name': locationName,
        'Type': input.locationType || 'generic',
        'NPCs': createdNpcs.length,
        'Rooms': createdRooms.length
    });

    if (createdNpcs.length > 0) {
        output += RichFormatter.section('NPCs');
        const npcRows = createdNpcs.map(n => [n.name, n.role]);
        output += RichFormatter.table(['Name', 'Role'], npcRows);
    }

    if (createdRooms.length > 0) {
        output += RichFormatter.section('Rooms');
        output += RichFormatter.list(createdRooms.map(r => r.name));
    }

    const result = {
        success: true,
        actionType: 'spawn_location',
        locationId,
        name: locationName,
        type: input.locationType,
        npcs: createdNpcs,
        rooms: createdRooms
    };

    output += RichFormatter.embedJson(result, 'SPAWN_MANAGE');

    return { content: [{ type: 'text', text: output }] };
}

async function handleSpawnEncounter(input: SpawnManageInput, ctx: SessionContext): Promise<McpResponse> {
    const { charRepo, encounterRepo, partyRepo } = ensureDb();
    const combatManager = getCombatManager();
    const now = new Date().toISOString();

    // Get encounter preset
    let encounterData: any;
    if (input.preset) {
        encounterData = ENCOUNTER_PRESETS[input.preset];
        if (!encounterData) {
            return {
                content: [{
                    type: 'text',
                    text: RichFormatter.error(`Unknown encounter preset: ${input.preset}`) +
                        RichFormatter.embedJson({ error: true, message: `Unknown preset: ${input.preset}` }, 'SPAWN_MANAGE')
                }]
            };
        }
    } else if (input.random) {
        let candidates: any[] = [];
        if (input.tags && input.tags.length > 0) {
            // Get encounters matching any of the tags
            for (const tag of input.tags) {
                candidates = [...candidates, ...getEncountersByTag(tag)];
            }
            // Filter by difficulty if specified
            if (input.difficulty && candidates.length > 0) {
                const filtered = candidates.filter(e => e.difficulty === input.difficulty);
                if (filtered.length > 0) candidates = filtered;
            }
        } else if (input.level) {
            candidates = getEncountersForLevel(input.level);
            // Filter by difficulty if specified
            if (input.difficulty && candidates.length > 0) {
                const filtered = candidates.filter((e: any) => e.difficulty === input.difficulty);
                if (filtered.length > 0) candidates = filtered;
            }
        } else {
            // Pick from all presets
            candidates = Object.values(ENCOUNTER_PRESETS);
        }

        if (candidates.length > 0) {
            encounterData = candidates[Math.floor(Math.random() * candidates.length)];
        }
    }

    if (!encounterData) {
        return {
            content: [{
                type: 'text',
                text: RichFormatter.error('No matching encounter found') +
                    RichFormatter.embedJson({ error: true, message: 'No matching encounter' }, 'SPAWN_MANAGE')
            }]
        };
    }

    // Scale if needed
    if (input.partySize && input.partyLevel) {
        encounterData = scaleEncounter(encounterData, input.partyLevel, input.partySize);
    }

    // Create participants
    const participants: CombatParticipant[] = [];
    const createdCharacterIds: string[] = [];

    for (const participant of encounterData.participants || []) {
        for (let i = 0; i < (participant.count || 1); i++) {
            const preset = expandCreatureTemplate(participant.template, participant.name);
            if (!preset) continue;

            const characterId = randomUUID();
            const pos = participant.position
                ? parsePosition(participant.position)
                : { x: Math.floor(Math.random() * 10), y: Math.floor(Math.random() * 10) };

            const character = buildCharacter({
                id: characterId,
                name: (participant.count || 1) > 1 ? `${preset.name} ${i + 1}` : preset.name,
                stats: preset.stats,
                hp: preset.hp,
                maxHp: preset.maxHp,
                ac: preset.ac,
                level: preset.level,
                characterType: 'enemy',
                race: preset.race || 'Unknown',
                characterClass: preset.characterClass || 'monster',
                position: pos,
                createdAt: now,
                updatedAt: now
            });

            charRepo.create(character);
            createdCharacterIds.push(characterId);

            const dexMod = Math.floor((preset.stats.dex - 10) / 2);
            participants.push({
                id: characterId,
                name: character.name,
                hp: preset.hp,
                maxHp: preset.maxHp,
                ac: preset.ac,
                attackDamage: preset.defaultAttack?.damage,
                attackBonus: preset.defaultAttack?.toHit,
                initiative: 0,
                initiativeBonus: dexMod,
                isEnemy: true,
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
    }

    // Add party members if provided
    if (input.partyId) {
        const party = partyRepo.getPartyWithMembers(input.partyId);
        if (party && party.members) {
            const positions = input.partyPositions || [];
            for (let i = 0; i < party.members.length; i++) {
                const member = party.members[i];
                const char = member.character;
                const pos = positions[i] ? parsePosition(positions[i]) : { x: 15 + i, y: 10 };
                const dexMod = Math.floor((char.stats.dex - 10) / 2);

                participants.push({
                    id: char.id,
                    name: char.name,
                    hp: char.hp,
                    maxHp: char.maxHp,
                    ac: char.ac || 10,
                    initiative: 0,
                    initiativeBonus: dexMod,
                    isEnemy: false,
                    conditions: [],
                    position: pos,
                    size: 'medium',
                    movementSpeed: 30,
                    movementRemaining: 30,
                    resistances: [],
                    vulnerabilities: [],
                    immunities: []
                });
            }
        }
    }

    // Create encounter
    const encounterId = `encounter-${input.seed || randomUUID()}-${Date.now()}`;
    const namespacedId = `${ctx.sessionId}:${encounterId}`;
    const engine = new CombatEngine(input.seed || randomUUID());
    const encounterState = engine.startEncounter(participants);
    combatManager.create(namespacedId, engine);

    // Save to database
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
            position: p.position,
            movementSpeed: p.movementSpeed ?? 30,
            size: p.size ?? 'medium'
        })),
        round: encounterState.round,
        activeTokenId: encounterState.turnOrder[encounterState.currentTurnIndex],
        status: 'active',
        terrain: encounterData.terrain || { obstacles: [] },
        props: [],
        gridBounds: { minX: 0, maxX: 20, minY: 0, maxY: 20 },
        createdAt: now,
        updatedAt: now
    });

    const asciiMap = generateEncounterMap({ state: encounterState }, 20, 20);

    let output = RichFormatter.header('Encounter Spawned', '⚔️');
    output += RichFormatter.keyValue({
        'ID': encounterId,
        'Preset': input.preset || 'random',
        'Difficulty': encounterData.difficulty || 'medium',
        'Enemies': participants.filter(p => p.isEnemy).length,
        'Allies': participants.filter(p => !p.isEnemy).length,
        'Round': encounterState.round
    });

    output += RichFormatter.section('Battle Map');
    output += '```\n' + asciiMap + '\n```\n';

    output += RichFormatter.section('Turn Order');
    const turnRows = encounterState.participants.map((p: any, i: number) => [
        i === encounterState.currentTurnIndex ? '►' : '',
        p.name,
        p.initiative.toString(),
        `${p.hp}/${p.maxHp}`,
        p.isEnemy ? 'Enemy' : 'Ally'
    ]);
    output += RichFormatter.table(['', 'Name', 'Init', 'HP', 'Side'], turnRows);

    const result = {
        success: true,
        actionType: 'spawn_encounter',
        encounterId,
        preset: input.preset,
        difficulty: encounterData.difficulty,
        round: encounterState.round,
        participants: encounterState.participants.map((p: any) => ({
            id: p.id,
            name: p.name,
            hp: p.hp,
            maxHp: p.maxHp,
            initiative: p.initiative,
            isEnemy: p.isEnemy,
            position: p.position
        })),
        turnOrder: encounterState.turnOrder,
        currentTurnIndex: encounterState.currentTurnIndex
    };

    output += RichFormatter.embedJson(result, 'SPAWN_MANAGE');

    return { content: [{ type: 'text', text: output }] };
}

async function handleSpawnPresetLocation(input: SpawnManageInput, _ctx: SessionContext): Promise<McpResponse> {
    if (!input.worldId || input.x === undefined || input.y === undefined) {
        return {
            content: [{
                type: 'text',
                text: RichFormatter.error('spawn_preset_location requires worldId, x, y') +
                    RichFormatter.embedJson({ error: true, message: 'worldId, x, y required' }, 'SPAWN_MANAGE')
            }]
        };
    }

    if (!input.preset) {
        return {
            content: [{
                type: 'text',
                text: RichFormatter.error('spawn_preset_location requires preset') +
                    RichFormatter.embedJson({ error: true, message: 'preset required' }, 'SPAWN_MANAGE')
            }]
        };
    }

    const { db, charRepo } = ensureDb();
    const now = new Date().toISOString();

    // Location presets (simplified - real impl would use data files)
    const locationPresets: Record<string, any> = {
        'generic_tavern': {
            name: 'The Rusty Tankard',
            type: 'tavern',
            rooms: [
                { name: 'Common Room', description: 'A busy tavern common room' },
                { name: 'Kitchen', description: 'A warm kitchen' },
                { name: 'Upstairs Rooms', description: 'Guest rooms' }
            ],
            npcs: [
                { name: 'Barkeep', role: 'Innkeeper', race: 'Human' },
                { name: 'Serving Wench', role: 'Server', race: 'Human' }
            ]
        },
        'dungeon_entrance': {
            name: 'Dark Cave Entrance',
            type: 'dungeon',
            rooms: [
                { name: 'Cave Mouth', description: 'A dark cave entrance' },
                { name: 'Entry Chamber', description: 'First chamber of the dungeon' }
            ],
            npcs: []
        },
        'forest_clearing': {
            name: 'Forest Clearing',
            type: 'wilderness',
            rooms: [
                { name: 'Clearing', description: 'A peaceful forest clearing' }
            ],
            npcs: []
        }
    };

    const presetData = locationPresets[input.preset];
    if (!presetData) {
        return {
            content: [{
                type: 'text',
                text: RichFormatter.error(`Unknown location preset: ${input.preset}`) +
                    RichFormatter.embedJson({ error: true, message: `Unknown preset: ${input.preset}` }, 'SPAWN_MANAGE')
            }]
        };
    }

    const locationId = randomUUID();
    const locationName = input.customName || presetData.name;

    // Create POI
    const poiId = randomUUID();
    db.prepare(`
        INSERT OR REPLACE INTO pois (id, worldId, name, type, x, y, discoveryState, networkId, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        poiId,
        input.worldId,
        locationName,
        presetData.type,
        input.x,
        input.y,
        input.discoveryState || 'discovered',
        locationId,
        now,
        now
    );

    // Create rooms
    const createdRooms: Array<{ id: string; name: string }> = [];
    for (const roomData of presetData.rooms) {
        const roomId = randomUUID();
        db.prepare(`
            INSERT OR REPLACE INTO rooms (id, networkId, name, description, exits, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(roomId, locationId, roomData.name, roomData.description, '[]', now, now);
        createdRooms.push({ id: roomId, name: roomData.name });
    }

    // Create NPCs if requested
    const createdNpcs: Array<{ id: string; name: string; role: string }> = [];
    if (input.spawnNpcs && presetData.npcs.length > 0) {
        for (const npcData of presetData.npcs) {
            const npcId = randomUUID();
            charRepo.create({
                id: npcId,
                name: npcData.name,
                race: npcData.race,
                characterClass: npcData.role,
                characterType: 'npc',
                hp: 10,
                maxHp: 10,
                ac: 10,
                level: 1,
                stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
                createdAt: now,
                updatedAt: now
            } as any);
            createdNpcs.push({ id: npcId, name: npcData.name, role: npcData.role });
        }
    }

    let output = RichFormatter.header('Preset Location Spawned', '🏰');
    output += RichFormatter.keyValue({
        'POI ID': poiId,
        'Network ID': locationId,
        'Name': locationName,
        'Preset': input.preset,
        'Position': `(${input.x}, ${input.y})`,
        'Discovery': input.discoveryState || 'discovered',
        'Rooms': createdRooms.length,
        'NPCs': createdNpcs.length
    });

    const result = {
        success: true,
        actionType: 'spawn_preset_location',
        poiId,
        networkId: locationId,
        name: locationName,
        preset: input.preset,
        position: { x: input.x, y: input.y },
        rooms: createdRooms,
        npcs: createdNpcs
    };

    output += RichFormatter.embedJson(result, 'SPAWN_MANAGE');

    return { content: [{ type: 'text', text: output }] };
}

async function handleSpawnTactical(input: SpawnManageInput, ctx: SessionContext): Promise<McpResponse> {
    if (!input.participants || input.participants.length === 0) {
        return {
            content: [{
                type: 'text',
                text: RichFormatter.error('spawn_tactical requires participants array') +
                    RichFormatter.embedJson({ error: true, message: 'participants required' }, 'SPAWN_MANAGE')
            }]
        };
    }

    const { charRepo, encounterRepo } = ensureDb();
    const combatManager = getCombatManager();
    const now = new Date().toISOString();

    const participants: CombatParticipant[] = [];
    const createdCharacterIds: string[] = [];

    for (const p of input.participants) {
        const preset = expandCreatureTemplate(p.template, p.name);
        if (!preset) {
            return {
                content: [{
                    type: 'text',
                    text: RichFormatter.error(`Unknown template: ${p.template}`) +
                        RichFormatter.embedJson({ error: true, message: `Unknown template: ${p.template}` }, 'SPAWN_MANAGE')
                }]
            };
        }

        const pos = parsePosition(p.position);
        const characterId = randomUUID();

        const character = buildCharacter({
            id: characterId,
            name: preset.name,
            stats: preset.stats,
            hp: preset.hp,
            maxHp: preset.maxHp,
            ac: preset.ac,
            level: preset.level,
            characterType: p.isEnemy ? 'enemy' : 'ally',
            race: preset.race || 'Unknown',
            characterClass: preset.characterClass || 'monster',
            position: pos,
            createdAt: now,
            updatedAt: now
        });

        charRepo.create(character);
        createdCharacterIds.push(characterId);

        const dexMod = Math.floor((preset.stats.dex - 10) / 2);
        participants.push({
            id: characterId,
            name: preset.name,
            hp: preset.hp,
            maxHp: preset.maxHp,
            ac: preset.ac,
            attackDamage: preset.defaultAttack?.damage,
            attackBonus: preset.defaultAttack?.toHit,
            initiative: 0,
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

    // Build terrain
    const width = input.gridSize?.width || 20;
    const height = input.gridSize?.height || 20;
    let terrain: { obstacles: string[]; difficultTerrain?: string[]; water?: string[] } = {
        obstacles: input.terrain?.obstacles || [],
        difficultTerrain: input.terrain?.difficultTerrain,
        water: input.terrain?.water
    };

    if (input.terrain?.pattern) {
        const validPatterns: TerrainPatternName[] = ['river_valley', 'canyon', 'arena', 'mountain_pass', 'maze', 'maze_rooms'];
        if (validPatterns.includes(input.terrain.pattern as TerrainPatternName)) {
            const patternGen = getPatternGenerator(input.terrain.pattern as TerrainPatternName);
            const patternTerrain = patternGen(0, 0, width, height);
            terrain = {
                obstacles: [...terrain.obstacles, ...patternTerrain.obstacles],
                difficultTerrain: [...(terrain.difficultTerrain || []), ...(patternTerrain.difficultTerrain || [])],
                water: [...(terrain.water || []), ...(patternTerrain.water || [])]
            };
        }
    }

    // Create encounter
    const encounterId = `encounter-${input.seed || randomUUID()}-${Date.now()}`;
    const namespacedId = `${ctx.sessionId}:${encounterId}`;
    const engine = new CombatEngine(input.seed || randomUUID());
    const encounterState = engine.startEncounter(participants);
    (encounterState as any).terrain = terrain;
    combatManager.create(namespacedId, engine);

    // Save to database
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
            position: p.position,
            movementSpeed: p.movementSpeed ?? 30,
            size: p.size ?? 'medium'
        })),
        round: encounterState.round,
        activeTokenId: encounterState.turnOrder[encounterState.currentTurnIndex],
        status: 'active',
        terrain,
        props: [],
        gridBounds: { minX: 0, maxX: width, minY: 0, maxY: height },
        createdAt: now,
        updatedAt: now
    });

    const asciiMap = generateEncounterMap({ state: encounterState }, width, height);

    let output = RichFormatter.header('Tactical Encounter Created', '🎯');
    output += RichFormatter.keyValue({
        'ID': encounterId,
        'Grid': `${width}x${height}`,
        'Participants': participants.length,
        'Round': encounterState.round
    });

    output += RichFormatter.section('Battle Map');
    output += '```\n' + asciiMap + '\n```\n';

    const result = {
        success: true,
        actionType: 'spawn_tactical',
        encounterId,
        gridSize: { width, height },
        round: encounterState.round,
        participants: encounterState.participants.map((p: any) => ({
            id: p.id,
            name: p.name,
            hp: p.hp,
            maxHp: p.maxHp,
            initiative: p.initiative,
            isEnemy: p.isEnemy,
            position: p.position
        })),
        turnOrder: encounterState.turnOrder,
        terrain
    };

    output += RichFormatter.embedJson(result, 'SPAWN_MANAGE');

    return { content: [{ type: 'text', text: output }] };
}

// Main handler
export async function handleSpawnManage(args: unknown, ctx: SessionContext): Promise<McpResponse> {
    const input = SpawnManageInputSchema.parse(args);
    const matchResult = matchAction(input.action, ACTIONS, ALIASES, 0.6);

    if (isGuidingError(matchResult)) {
        let output = RichFormatter.error(`Unknown action: "${input.action}"`);
        output += `\nAvailable actions: ${ACTIONS.join(', ')}`;
        if (matchResult.suggestions.length > 0) {
            output += `\nDid you mean: ${matchResult.suggestions.map(s => `"${s.value}" (${Math.round(s.similarity * 100)}%)`).join(', ')}?`;
        }
        output += RichFormatter.embedJson(matchResult, 'SPAWN_MANAGE');
        return { content: [{ type: 'text', text: output }] };
    }

    switch (matchResult.matched) {
        case 'spawn_character':
            return handleSpawnCharacter(input, ctx);
        case 'spawn_location':
            return handleSpawnLocation(input, ctx);
        case 'spawn_encounter':
            return handleSpawnEncounter(input, ctx);
        case 'spawn_preset_location':
            return handleSpawnPresetLocation(input, ctx);
        case 'spawn_tactical':
            return handleSpawnTactical(input, ctx);
        default:
            return {
                content: [{
                    type: 'text',
                    text: RichFormatter.error(`Unhandled action: ${matchResult.matched}`) +
                        RichFormatter.embedJson({ error: true, message: `Unhandled: ${matchResult.matched}` }, 'SPAWN_MANAGE')
                }]
            };
    }
}

// Tool definition for registration
export const SpawnManageTool = {
    name: 'spawn_manage',
    description: `Consolidated spawn management (5→1).

Actions:
• spawn_character - Create character from template with equipment
• spawn_location - Create populated location with NPCs and rooms
• spawn_encounter - Create combat encounter from preset or random
• spawn_preset_location - Spawn complete location from preset at coordinates
• spawn_tactical - Setup tactical combat with positioned participants

Examples:
- Spawn goblin: { action: "spawn_character", template: "goblin", position: "5,5" }
- Spawn tavern: { action: "spawn_preset_location", preset: "generic_tavern", worldId: "...", x: 50, y: 75 }
- Random encounter: { action: "spawn_encounter", random: true, difficulty: "medium", tags: ["undead"] }
- Tactical setup: { action: "spawn_tactical", participants: [...], terrain: { pattern: "arena" } }`,
    inputSchema: SpawnManageInputSchema
};
