/**
 * Location Presets - Pre-configured room networks for common locations
 *
 * These reduce token overhead by ~80% compared to manual specification.
 * An LLM can spawn a full location with just: { preset: "generic_tavern" }
 *
 * Usage:
 *   getLocationPreset('generic_tavern') -> full location config
 *   listLocationPresets() -> all available presets
 *   getLocationsForCategory('tavern') -> filtered list
 *
 * @module data/location-presets
 */

import { POICategory, POIIcon } from '../schema/poi.js';

/**
 * A room within a location preset
 */
export interface PresetRoom {
    id: string;             // Unique ID within preset (e.g., "main_hall")
    name: string;           // Display name
    description: string;    // Base description
    biome: 'urban' | 'forest' | 'dungeon' | 'cavern' | 'divine' | 'mountain' | 'coastal' | 'arcane';
    localX?: number;        // Local coordinate for mapping
    localY?: number;
    exits: PresetExit[];    // Connections to other rooms
}

/**
 * An exit/connection between rooms
 */
export interface PresetExit {
    direction: 'north' | 'south' | 'east' | 'west' | 'up' | 'down';
    targetRoomId: string;   // ID of connected room in preset
    exitType?: 'OPEN' | 'LOCKED' | 'HIDDEN';
    lockDC?: number;        // DC to unlock if locked
}

/**
 * NPC template for location
 */
export interface PresetNPC {
    template: string;       // Creature template (e.g., "commoner", "guard")
    name?: string;          // Optional specific name
    roomId: string;         // Which room they're in
    role?: string;          // Narrative role (e.g., "bartender", "patron")
    behavior?: string;      // AI behavior hint
}

/**
 * Item placement in location
 */
export interface PresetItem {
    itemId: string;         // Item ID or template
    roomId: string;         // Which room it's in
    description?: string;   // How it appears
}

/**
 * Complete location preset
 */
export interface LocationPreset {
    id: string;
    name: string;
    description: string;
    category: POICategory;
    icon: POIIcon;
    networkType: 'cluster' | 'linear';
    rooms: PresetRoom[];
    npcs?: PresetNPC[];
    items?: PresetItem[];
    suggestedLevel?: { min: number; max: number };
    tags: string[];
    narrativeHook?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// TAVERN / INN PRESETS
// ═══════════════════════════════════════════════════════════════════════════

export const LOCATION_PRESETS: Record<string, LocationPreset> = {
    generic_tavern: {
        id: 'generic_tavern',
        name: 'The Weary Traveler',
        description: 'A modest tavern serving locals and travelers alike. Warm hearth, cold ale, and hot rumors.',
        category: 'commercial',
        icon: 'inn',
        networkType: 'cluster',
        rooms: [
            {
                id: 'common_room',
                name: 'Common Room',
                description: 'A warm common room with a crackling fireplace, several wooden tables, and a long bar. The smell of roasted meat and spilled ale permeates the air.',
                biome: 'urban',
                localX: 1, localY: 1,
                exits: [
                    { direction: 'north', targetRoomId: 'kitchen' },
                    { direction: 'east', targetRoomId: 'private_room' },
                    { direction: 'up', targetRoomId: 'rooms_hallway' },
                    { direction: 'south', targetRoomId: 'entrance' }
                ]
            },
            {
                id: 'entrance',
                name: 'Tavern Entrance',
                description: 'The main entrance to the tavern. A worn wooden door leads outside, and a notice board is nailed to the wall.',
                biome: 'urban',
                localX: 1, localY: 0,
                exits: [
                    { direction: 'north', targetRoomId: 'common_room' }
                ]
            },
            {
                id: 'kitchen',
                name: 'Kitchen',
                description: 'A busy kitchen with a large hearth, hanging pots, and shelves of ingredients. Steam rises from bubbling stews.',
                biome: 'urban',
                localX: 1, localY: 2,
                exits: [
                    { direction: 'south', targetRoomId: 'common_room' },
                    { direction: 'east', targetRoomId: 'storage' }
                ]
            },
            {
                id: 'storage',
                name: 'Storage Room',
                description: 'A dusty storage room filled with barrels, crates, and sacks. The air is cool and dry.',
                biome: 'urban',
                localX: 2, localY: 2,
                exits: [
                    { direction: 'west', targetRoomId: 'kitchen' }
                ]
            },
            {
                id: 'private_room',
                name: 'Private Dining Room',
                description: 'A small private room with a single table and comfortable chairs. Curtains can be drawn for privacy.',
                biome: 'urban',
                localX: 2, localY: 1,
                exits: [
                    { direction: 'west', targetRoomId: 'common_room' }
                ]
            },
            {
                id: 'rooms_hallway',
                name: 'Upstairs Hallway',
                description: 'A narrow hallway with several doors leading to guest rooms. The floorboards creak underfoot.',
                biome: 'urban',
                localX: 1, localY: 1,
                exits: [
                    { direction: 'down', targetRoomId: 'common_room' },
                    { direction: 'east', targetRoomId: 'guest_room_1' },
                    { direction: 'west', targetRoomId: 'guest_room_2' }
                ]
            },
            {
                id: 'guest_room_1',
                name: 'Guest Room',
                description: 'A simple but clean guest room with a bed, small table, and washbasin.',
                biome: 'urban',
                localX: 2, localY: 1,
                exits: [
                    { direction: 'west', targetRoomId: 'rooms_hallway' }
                ]
            },
            {
                id: 'guest_room_2',
                name: 'Guest Room',
                description: 'A cozy guest room with two beds, suitable for traveling companions.',
                biome: 'urban',
                localX: 0, localY: 1,
                exits: [
                    { direction: 'east', targetRoomId: 'rooms_hallway' }
                ]
            }
        ],
        npcs: [
            { template: 'commoner', name: 'Barnaby', roomId: 'common_room', role: 'bartender', behavior: 'friendly' },
            { template: 'commoner', roomId: 'common_room', role: 'patron' },
            { template: 'commoner', roomId: 'common_room', role: 'patron' },
            { template: 'commoner', roomId: 'kitchen', role: 'cook', behavior: 'busy' }
        ],
        tags: ['tavern', 'inn', 'urban', 'social', 'rest', 'rumors'],
        narrativeHook: 'The tavern is bustling tonight. A bard plays in the corner, and you catch snippets of conversation about strange happenings in the nearby forest.'
    },

    rough_tavern: {
        id: 'rough_tavern',
        name: 'The Broken Bottle',
        description: 'A seedy tavern in the rough part of town. Shadowy corners hide questionable dealings.',
        category: 'commercial',
        icon: 'inn',
        networkType: 'cluster',
        rooms: [
            {
                id: 'common_room',
                name: 'Common Room',
                description: 'A dim, smoky room with sticky tables and suspicious stains. The clientele watches newcomers with wary eyes.',
                biome: 'urban',
                localX: 1, localY: 1,
                exits: [
                    { direction: 'north', targetRoomId: 'back_room', exitType: 'LOCKED', lockDC: 15 },
                    { direction: 'south', targetRoomId: 'entrance' }
                ]
            },
            {
                id: 'entrance',
                name: 'Tavern Entrance',
                description: 'A heavy door reinforced with iron bands. A half-orc bouncer eyes you up.',
                biome: 'urban',
                localX: 1, localY: 0,
                exits: [
                    { direction: 'north', targetRoomId: 'common_room' }
                ]
            },
            {
                id: 'back_room',
                name: 'Back Room',
                description: 'A private room for special clients. A card game is in progress, and gold changes hands.',
                biome: 'urban',
                localX: 1, localY: 2,
                exits: [
                    { direction: 'south', targetRoomId: 'common_room' },
                    { direction: 'down', targetRoomId: 'cellar', exitType: 'HIDDEN' }
                ]
            },
            {
                id: 'cellar',
                name: 'Secret Cellar',
                description: 'A hidden cellar accessed through a trapdoor. Crates of contraband line the walls.',
                biome: 'urban',
                localX: 1, localY: 2,
                exits: [
                    { direction: 'up', targetRoomId: 'back_room' }
                ]
            }
        ],
        npcs: [
            { template: 'thug', name: 'Grok', roomId: 'entrance', role: 'bouncer', behavior: 'intimidating' },
            { template: 'spy', name: 'Whisper', roomId: 'common_room', role: 'information broker', behavior: 'cautious' },
            { template: 'bandit_captain', roomId: 'back_room', role: 'crime boss', behavior: 'calculating' }
        ],
        tags: ['tavern', 'urban', 'criminal', 'thieves_guild', 'underground'],
        narrativeHook: 'The bartender slides a drink toward you without being asked. "First one\'s free," she says. "Information costs extra."'
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // DUNGEON ENTRANCE PRESETS
    // ═══════════════════════════════════════════════════════════════════════════

    dungeon_entrance: {
        id: 'dungeon_entrance',
        name: 'Ancient Ruins Entrance',
        description: 'Crumbling stone stairs descend into darkness. The air grows cold and stale.',
        category: 'dungeon',
        icon: 'ruins',
        networkType: 'linear',
        rooms: [
            {
                id: 'entrance',
                name: 'Ruined Entrance',
                description: 'Weathered stone pillars frame a dark passage leading underground. Vines and moss cover the ancient stonework.',
                biome: 'dungeon',
                localX: 0, localY: 0,
                exits: [
                    { direction: 'down', targetRoomId: 'antechamber' }
                ]
            },
            {
                id: 'antechamber',
                name: 'Antechamber',
                description: 'A small chamber at the bottom of the stairs. Faded murals depict scenes of a forgotten civilization. Torch sconces line the walls.',
                biome: 'dungeon',
                localX: 0, localY: 1,
                exits: [
                    { direction: 'up', targetRoomId: 'entrance' },
                    { direction: 'north', targetRoomId: 'first_corridor' }
                ]
            },
            {
                id: 'first_corridor',
                name: 'Stone Corridor',
                description: 'A long stone corridor stretches into darkness. The walls are lined with empty alcoves.',
                biome: 'dungeon',
                localX: 0, localY: 2,
                exits: [
                    { direction: 'south', targetRoomId: 'antechamber' },
                    { direction: 'east', targetRoomId: 'guard_room' },
                    { direction: 'north', targetRoomId: 'trapped_hall', exitType: 'HIDDEN' }
                ]
            },
            {
                id: 'guard_room',
                name: 'Guard Room',
                description: 'An old guard station with rusted weapon racks and overturned furniture. Something moved in the shadows.',
                biome: 'dungeon',
                localX: 1, localY: 2,
                exits: [
                    { direction: 'west', targetRoomId: 'first_corridor' }
                ]
            },
            {
                id: 'trapped_hall',
                name: 'Trapped Hallway',
                description: 'This corridor has pressure plates visible in the dusty floor. Holes in the walls suggest dart traps.',
                biome: 'dungeon',
                localX: 0, localY: 3,
                exits: [
                    { direction: 'south', targetRoomId: 'first_corridor' },
                    { direction: 'north', targetRoomId: 'treasure_room', exitType: 'LOCKED', lockDC: 18 }
                ]
            },
            {
                id: 'treasure_room',
                name: 'Treasure Chamber',
                description: 'A sealed chamber containing ancient treasures... and possibly their guardian.',
                biome: 'dungeon',
                localX: 0, localY: 4,
                exits: [
                    { direction: 'south', targetRoomId: 'trapped_hall' }
                ]
            }
        ],
        suggestedLevel: { min: 1, max: 5 },
        tags: ['dungeon', 'ruins', 'underground', 'traps', 'treasure'],
        narrativeHook: 'The stairs descend into darkness. Your torchlight reveals ancient carvings - warnings in a language long forgotten.'
    },

    cave_entrance: {
        id: 'cave_entrance',
        name: 'Dark Cave Entrance',
        description: 'A natural cave opening leading into the mountainside. Strange sounds echo from within.',
        category: 'natural',
        icon: 'cave',
        networkType: 'cluster',
        rooms: [
            {
                id: 'entrance',
                name: 'Cave Mouth',
                description: 'A large natural cave opening. Daylight illuminates the first few feet before giving way to darkness. Animal tracks mark the dusty floor.',
                biome: 'cavern',
                localX: 0, localY: 0,
                exits: [
                    { direction: 'north', targetRoomId: 'entry_cavern' }
                ]
            },
            {
                id: 'entry_cavern',
                name: 'Entry Cavern',
                description: 'A spacious natural cavern with stalactites hanging from the ceiling. Multiple passages branch off into the darkness.',
                biome: 'cavern',
                localX: 0, localY: 1,
                exits: [
                    { direction: 'south', targetRoomId: 'entrance' },
                    { direction: 'east', targetRoomId: 'narrow_passage' },
                    { direction: 'west', targetRoomId: 'water_chamber' },
                    { direction: 'north', targetRoomId: 'beast_lair' }
                ]
            },
            {
                id: 'narrow_passage',
                name: 'Narrow Passage',
                description: 'A tight squeeze between rock walls. Medium or larger creatures must squeeze through.',
                biome: 'cavern',
                localX: 1, localY: 1,
                exits: [
                    { direction: 'west', targetRoomId: 'entry_cavern' },
                    { direction: 'east', targetRoomId: 'crystal_grotto' }
                ]
            },
            {
                id: 'crystal_grotto',
                name: 'Crystal Grotto',
                description: 'A beautiful cavern where natural crystals grow from the walls. They glow faintly with magical energy.',
                biome: 'cavern',
                localX: 2, localY: 1,
                exits: [
                    { direction: 'west', targetRoomId: 'narrow_passage' }
                ]
            },
            {
                id: 'water_chamber',
                name: 'Underground Pool',
                description: 'A cavern with a deep pool of crystal-clear water. The ceiling is low, and dripping water echoes loudly.',
                biome: 'cavern',
                localX: -1, localY: 1,
                exits: [
                    { direction: 'east', targetRoomId: 'entry_cavern' }
                ]
            },
            {
                id: 'beast_lair',
                name: 'Beast Lair',
                description: 'A large chamber littered with bones and refuse. Something lives here... something big.',
                biome: 'cavern',
                localX: 0, localY: 2,
                exits: [
                    { direction: 'south', targetRoomId: 'entry_cavern' }
                ]
            }
        ],
        suggestedLevel: { min: 1, max: 4 },
        tags: ['cave', 'natural', 'underground', 'beast', 'wilderness'],
        narrativeHook: 'The cave mouth looms before you. A low growl echoes from somewhere deep within.'
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // URBAN / SOCIAL PRESETS
    // ═══════════════════════════════════════════════════════════════════════════

    town_square: {
        id: 'town_square',
        name: 'Market Square',
        description: 'The bustling heart of the town where merchants hawk their wares and townsfolk gather.',
        category: 'settlement',
        icon: 'market',
        networkType: 'cluster',
        rooms: [
            {
                id: 'square_center',
                name: 'Town Square',
                description: 'A large open square with a central fountain. Market stalls ring the perimeter, and townsfolk bustle about their business.',
                biome: 'urban',
                localX: 1, localY: 1,
                exits: [
                    { direction: 'north', targetRoomId: 'general_store' },
                    { direction: 'south', targetRoomId: 'town_hall' },
                    { direction: 'east', targetRoomId: 'blacksmith' },
                    { direction: 'west', targetRoomId: 'temple' }
                ]
            },
            {
                id: 'general_store',
                name: 'General Store',
                description: 'A well-stocked shop selling everything from rations to rope. The shopkeeper greets customers warmly.',
                biome: 'urban',
                localX: 1, localY: 2,
                exits: [
                    { direction: 'south', targetRoomId: 'square_center' }
                ]
            },
            {
                id: 'blacksmith',
                name: 'Blacksmith',
                description: 'Heat radiates from the forge where a muscular smith hammers glowing metal. Weapons and armor line the walls.',
                biome: 'urban',
                localX: 2, localY: 1,
                exits: [
                    { direction: 'west', targetRoomId: 'square_center' }
                ]
            },
            {
                id: 'temple',
                name: 'Town Temple',
                description: 'A modest temple offering blessings and healing. Incense burns before the altar.',
                biome: 'divine',
                localX: 0, localY: 1,
                exits: [
                    { direction: 'east', targetRoomId: 'square_center' }
                ]
            },
            {
                id: 'town_hall',
                name: 'Town Hall',
                description: 'The seat of local government. A notice board outside lists bounties and proclamations.',
                biome: 'urban',
                localX: 1, localY: 0,
                exits: [
                    { direction: 'north', targetRoomId: 'square_center' }
                ]
            }
        ],
        npcs: [
            { template: 'commoner', name: 'Marcus', roomId: 'general_store', role: 'shopkeeper', behavior: 'friendly' },
            { template: 'commoner', name: 'Greta', roomId: 'blacksmith', role: 'blacksmith', behavior: 'gruff' },
            { template: 'priest', name: 'Father Aldric', roomId: 'temple', role: 'priest', behavior: 'pious' },
            { template: 'noble', name: 'Mayor Thorne', roomId: 'town_hall', role: 'mayor', behavior: 'politician' },
            { template: 'guard', roomId: 'square_center', role: 'town guard' },
            { template: 'guard', roomId: 'square_center', role: 'town guard' }
        ],
        tags: ['town', 'urban', 'market', 'social', 'shopping', 'quests'],
        narrativeHook: 'The market is alive with activity. A town crier announces news, while children play near the fountain.'
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // WILDERNESS PRESETS
    // ═══════════════════════════════════════════════════════════════════════════

    forest_clearing: {
        id: 'forest_clearing',
        name: 'Forest Clearing',
        description: 'A peaceful clearing in the deep forest, touched by dappled sunlight.',
        category: 'natural',
        icon: 'tree',
        networkType: 'cluster',
        rooms: [
            {
                id: 'clearing_center',
                name: 'Sunlit Clearing',
                description: 'A circular clearing where sunlight filters through the canopy. Wildflowers carpet the ground, and birdsong fills the air.',
                biome: 'forest',
                localX: 1, localY: 1,
                exits: [
                    { direction: 'north', targetRoomId: 'ancient_tree' },
                    { direction: 'south', targetRoomId: 'forest_path' },
                    { direction: 'east', targetRoomId: 'berry_bushes' },
                    { direction: 'west', targetRoomId: 'stream' }
                ]
            },
            {
                id: 'forest_path',
                name: 'Forest Path',
                description: 'A winding dirt path leading through the trees. It continues both directions into the forest.',
                biome: 'forest',
                localX: 1, localY: 0,
                exits: [
                    { direction: 'north', targetRoomId: 'clearing_center' }
                ]
            },
            {
                id: 'ancient_tree',
                name: 'Ancient Oak',
                description: 'A massive ancient oak tree dominates this area. Its gnarled trunk is easily 30 feet across. Offerings are piled at its roots.',
                biome: 'forest',
                localX: 1, localY: 2,
                exits: [
                    { direction: 'south', targetRoomId: 'clearing_center' },
                    { direction: 'up', targetRoomId: 'tree_hollow', exitType: 'HIDDEN' }
                ]
            },
            {
                id: 'tree_hollow',
                name: 'Tree Hollow',
                description: 'A hidden hollow within the ancient tree. Fey creatures may have once lived here.',
                biome: 'forest',
                localX: 1, localY: 2,
                exits: [
                    { direction: 'down', targetRoomId: 'ancient_tree' }
                ]
            },
            {
                id: 'berry_bushes',
                name: 'Berry Thicket',
                description: 'Dense bushes laden with ripe berries. Animal tracks suggest this is a popular feeding spot.',
                biome: 'forest',
                localX: 2, localY: 1,
                exits: [
                    { direction: 'west', targetRoomId: 'clearing_center' }
                ]
            },
            {
                id: 'stream',
                name: 'Forest Stream',
                description: 'A clear stream babbles over smooth stones. The water is cold and refreshing.',
                biome: 'forest',
                localX: 0, localY: 1,
                exits: [
                    { direction: 'east', targetRoomId: 'clearing_center' }
                ]
            }
        ],
        tags: ['forest', 'wilderness', 'nature', 'fey', 'peaceful', 'rest'],
        narrativeHook: 'The clearing feels untouched by time. As sunlight shifts through the leaves, you could swear you hear distant music...'
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // CAMP / REST PRESETS
    // ═══════════════════════════════════════════════════════════════════════════

    roadside_camp: {
        id: 'roadside_camp',
        name: 'Roadside Camp',
        description: 'A small campsite set up beside the road, suitable for a night of rest.',
        category: 'landmark',
        icon: 'camp',
        networkType: 'cluster',
        rooms: [
            {
                id: 'campfire',
                name: 'Campfire',
                description: 'A crackling campfire provides warmth and light. Bedrolls are arranged around it.',
                biome: 'forest',
                localX: 1, localY: 1,
                exits: [
                    { direction: 'south', targetRoomId: 'road' },
                    { direction: 'north', targetRoomId: 'treeline' }
                ]
            },
            {
                id: 'road',
                name: 'Road',
                description: 'The main road continues east and west. The camp is just off to the side.',
                biome: 'forest',
                localX: 1, localY: 0,
                exits: [
                    { direction: 'north', targetRoomId: 'campfire' }
                ]
            },
            {
                id: 'treeline',
                name: 'Treeline',
                description: 'The edge of the forest provides cover from prying eyes on the road.',
                biome: 'forest',
                localX: 1, localY: 2,
                exits: [
                    { direction: 'south', targetRoomId: 'campfire' }
                ]
            }
        ],
        tags: ['camp', 'rest', 'road', 'travel', 'wilderness'],
        narrativeHook: 'The fire crackles as night settles in. Who will take first watch?'
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get a location preset by ID
 */
export function getLocationPreset(presetId: string): LocationPreset | undefined {
    return LOCATION_PRESETS[presetId];
}

/**
 * List all available location presets
 */
export function listLocationPresets(): Array<{ id: string; name: string; category: string; tags: string[] }> {
    return Object.values(LOCATION_PRESETS).map(preset => ({
        id: preset.id,
        name: preset.name,
        category: preset.category,
        tags: preset.tags
    }));
}

/**
 * Get locations filtered by category
 */
export function getLocationsForCategory(category: POICategory): LocationPreset[] {
    return Object.values(LOCATION_PRESETS).filter(preset => preset.category === category);
}

/**
 * Get locations filtered by tag
 */
export function getLocationsWithTag(tag: string): LocationPreset[] {
    return Object.values(LOCATION_PRESETS).filter(preset =>
        preset.tags.includes(tag.toLowerCase())
    );
}

/**
 * Get a random location matching criteria
 */
export function getRandomLocation(options?: {
    category?: POICategory;
    tags?: string[];
    level?: number;
}): LocationPreset | undefined {
    let candidates = Object.values(LOCATION_PRESETS);

    if (options?.category) {
        candidates = candidates.filter(p => p.category === options.category);
    }

    if (options?.tags && options.tags.length > 0) {
        candidates = candidates.filter(p =>
            options.tags!.some(tag => p.tags.includes(tag.toLowerCase()))
        );
    }

    if (options?.level) {
        candidates = candidates.filter(p => {
            if (!p.suggestedLevel) return true;
            return options.level! >= p.suggestedLevel.min && options.level! <= p.suggestedLevel.max;
        });
    }

    if (candidates.length === 0) return undefined;
    return candidates[Math.floor(Math.random() * candidates.length)];
}
