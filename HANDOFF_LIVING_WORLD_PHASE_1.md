# HANDOFF: Living World - Phase 1 (Spatial Graph System)
**Created:** December 6, 2025
**Target:** Claude Code
**Complexity:** MEDIUM
**Estimated Time:** 3-4 days with testing
**Blocking Issues:** 0 (this is independent)

---

## CONTEXT

You are implementing the **Spatial Graph System** for Quest Keeper AI - the first phase of the "Living World Kernel Upgrade". This creates a persistent room/location system that enables spatial awareness for future gameplay mechanics.

**Before starting, MUST read:**
1. `Agents/README.md` - Development philosophy
2. `Agents/PROJECT_CONTEXT.md` - Architecture overview
3. `TRIAGE_LIVING_WORLD_KERNEL.md` - Full analysis (YOU ARE HERE)

---

## PHASE 1: SPATIAL GRAPH SYSTEM

### OBJECTIVE
Create a persistent room/location database system where:
- Rooms exist in the SQLite database with unique IDs
- Rooms have narrative descriptions locked when first visited
- Rooms link to each other via "exits" (doors, passages, stairs)
- Rooms track entities present (NPCs, items, hazards)
- Characters can "look around" and see filtered descriptions based on perception

### PLAYER EXPERIENCE (The "Why")

**Before this feature:**
```
Player: "What does the tavern look like?"
LLM: "You enter a crowded tavern with a bartender at the counter..."
Player: "I come back tomorrow. What's here?"
LLM: "You enter a tavern with a shopkeeper at the counter..."
(Different description! Breaks immersion)
```

**After this feature:**
```
Player: "What does the tavern look like?"
Look_at_surroundings(playerId) →
  Database returns exact same description from last visit
  ✅ World feels persistent and consistent
```

---

## PHASE 1 DELIVERABLES

### 1. SCHEMA: RoomNode (src/schema/spatial.ts)

**Create NEW file:** `src/schema/spatial.ts`

```typescript
// The RoomNode represents a persistent location in the world
export const RoomNodeSchema = z.object({
  id: z.string().uuid(),

  // Narrative identity
  name: z.string()
    .min(1, 'Room name cannot be empty')
    .max(100, 'Room name too long'),
  baseDescription: z.string()
    .min(10, 'Description must be detailed')
    .max(2000, 'Description too long'),

  // World context
  biomeContext: z.enum(['forest', 'mountain', 'urban', 'dungeon', 'coastal', 'cavern', 'divine', 'arcane'])
    .describe('Linked to src/engine/worldgen biome definitions'),

  // Atmospheric effects
  atmospherics: z.array(z.enum(['DARKNESS', 'FOG', 'ANTIMAGIC', 'SILENCE', 'BRIGHT', 'MAGICAL']))
    .default([])
    .describe('Environmental effects that modify perception and abilities'),

  // Connections
  exits: z.array(z.object({
    direction: z.enum(['north', 'south', 'east', 'west', 'up', 'down', 'northeast', 'northwest', 'southeast', 'southwest']),
    targetNodeId: z.string().uuid(),
    type: z.enum(['OPEN', 'LOCKED', 'HIDDEN']),
    dc: z.number().int().min(5).max(30).optional()
      .describe('DC for Perception to detect HIDDEN exits'),
    description: z.string().optional()
      .describe('"A heavy oak door leads north"'),
  }))
    .default([]),

  // Entities present
  entityIds: z.array(z.string().uuid())
    .default([])
    .describe('Foreign keys to characters/NPCs/items in this room'),

  // Metadata
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  visitedCount: z.number().int().min(0).default(0),
  lastVisitedAt: z.string().datetime().optional(),
});

export type RoomNode = z.infer<typeof RoomNodeSchema>;
```

**Validation Rules:**
- `id` MUST be UUID
- `name` and `baseDescription` MUST NOT be empty/whitespace
- `exits` array can be empty (dead ends allowed)
- `targetNodeId` MUST reference an existing room (FK constraint)
- `entityIds` MUST reference existing characters/items (FK constraint)

---

### 2. REPOSITORY: SpatialRepository (src/storage/repos/spatial.repo.ts)

**Create NEW file:** `src/storage/repos/spatial.repo.ts`

```typescript
import Database from 'better-sqlite3';
import { RoomNode, RoomNodeSchema } from '../../schema/spatial.js';

export class SpatialRepository {
  constructor(private db: Database.Database) {}

  // ✅ REQUIRED METHODS

  create(room: RoomNode): void {
    // INSERT INTO room_nodes (...) VALUES (...)
    // Parse with RoomNodeSchema to validate
    const validated = RoomNodeSchema.parse(room);
    // ... insert logic
  }

  findById(id: string): RoomNode | null {
    // SELECT * FROM room_nodes WHERE id = ?
    // Parse result with RoomNodeSchema
    // Return null if not found
  }

  update(id: string, updates: Partial<RoomNode>): void {
    // UPDATE room_nodes SET ... WHERE id = ?
    // Merge with existing, re-validate full object
  }

  delete(id: string): boolean {
    // DELETE FROM room_nodes WHERE id = ?
    // Return true if deleted, false if didn't exist
  }

  findAll(): RoomNode[] {
    // SELECT * FROM room_nodes ORDER BY name
  }

  findByBiome(biome: string): RoomNode[] {
    // SELECT * FROM room_nodes WHERE biome_context = ?
  }

  // ✅ ADDITIONAL USEFUL METHODS

  addEntityToRoom(roomId: string, entityId: string): void {
    // Add entityId to room's entityIds array
    // Append to JSON array in DB
  }

  removeEntityFromRoom(roomId: string, entityId: string): void {
    // Remove entityId from room's entityIds array
  }

  getEntitiesInRoom(roomId: string): string[] {
    // Return entityIds array for room
  }

  addExit(roomId: string, exit: Exit): void {
    // Add exit to room's exits array
  }

  findConnectedRooms(roomId: string): RoomNode[] {
    // Return all rooms linked via exits from this room
  }

  incrementVisitCount(roomId: string): void {
    // Increment visitedCount and update lastVisitedAt
  }
}
```

**Key Points:**
- All public methods MUST use SpatialRepository for data access
- No raw SQL strings in MCP tools - route through this repo
- All data validated with Zod before writing to DB
- Use `JSON_EXTRACT` / `JSON_ARRAY` for array operations on exits/entityIds

---

### 3. DATABASE: Migration (src/storage/migrations.ts)

**Add to existing migrations.ts file:**

```typescript
// Migration: Create room_nodes table
const createRoomNodesTable = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_nodes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL CHECK(length(trim(name)) > 0),
      base_description TEXT NOT NULL CHECK(length(trim(base_description)) >= 10),
      biome_context TEXT NOT NULL CHECK(biome_context IN (
        'forest', 'mountain', 'urban', 'dungeon', 'coastal', 'cavern', 'divine', 'arcane'
      )),
      atmospherics TEXT NOT NULL DEFAULT '[]', -- JSON array
      exits TEXT NOT NULL DEFAULT '[]', -- JSON array of {direction, targetNodeId, type, dc?}
      entity_ids TEXT NOT NULL DEFAULT '[]', -- JSON array of UUID strings
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      visited_count INTEGER NOT NULL DEFAULT 0,
      last_visited_at TEXT,

      -- Foreign key constraints
      FOREIGN KEY (entity_ids) REFERENCES characters(id) ON DELETE SET NULL
    );

    -- Index for fast biome queries
    CREATE INDEX IF NOT EXISTS idx_room_nodes_biome ON room_nodes(biome_context);

    -- Index for recent access (for session awareness)
    CREATE INDEX IF NOT EXISTS idx_room_nodes_visited ON room_nodes(last_visited_at DESC);
  `);
};
```

**Schema Rationale:**
- `room_nodes` table stores the RoomNode objects
- `atmospherics` and `exits` stored as JSON for flexibility
- `entity_ids` stored as JSON array of UUIDs
- CHECK constraints enforce minimum requirements
- Indexes on biome_context and last_visited_at for common queries

---

### 4. MCP TOOLS: Spatial Tools (src/server/spatial-tools.ts)

**Create NEW file:** `src/server/spatial-tools.ts`

This file exports three MCP tool handler functions:

#### Tool 4A: `look_at_surroundings`

```typescript
/**
 * MCP Tool: look_at_surroundings
 *
 * Input: observerId (UUID)
 * Output: { description: string, exits: [...], entities: [...] }
 *
 * Logic:
 * 1. Get observer from database (need perception stat)
 * 2. Get observer's current room
 * 3. Check observer's senses (darkvision, blindness, conditions)
 * 4. Check atmospherics in room (DARKNESS requires darkvision)
 * 5. Filter exits based on Perception vs DC
 * 6. Return room description + visible exits + entities present
 */
export async function handleLookAtSurroundings(input: LookAtSurroundingsInput) {
  const observer = characterRepo.findById(input.observerId);
  if (!observer) throw new Error('Observer not found');

  // Get observer's current room (how? Need to add room_id to characters table)
  const currentRoom = spatialRepo.findById(observer.currentRoomId);
  if (!currentRoom) throw new Error('Observer not in a room');

  // Check for darkness
  const isInDarkness = currentRoom.atmospherics.includes('DARKNESS');
  const hasLight = observer.conditions?.includes('HAS_LIGHT') ||
                   observer.senses?.darkvision;

  if (isInDarkness && !hasLight) {
    return {
      success: true,
      description: "It's pitch black. You can't see anything.",
      exits: [],
      entities: []
    };
  }

  // Filter visible exits
  const visibleExits = currentRoom.exits.filter(exit => {
    if (exit.type === 'OPEN') return true;

    if (exit.type === 'HIDDEN') {
      // Perception check: observer.stats.wis vs exit.dc
      const perceptionRoll = rollD20() + Math.floor((observer.stats.wis - 10) / 2);
      return perceptionRoll >= (exit.dc || 15);
    }

    return false; // LOCKED exits not visible
  });

  // Return filtered description
  return {
    success: true,
    description: currentRoom.baseDescription,
    exits: visibleExits.map(e => ({
      direction: e.direction,
      description: e.description || `A ${e.type.toLowerCase()} passage leads ${e.direction}`
    })),
    entities: currentRoom.entityIds,
    atmospherics: currentRoom.atmospherics
  };
}

export const LOOK_AT_SURROUNDINGS_SCHEMA = z.object({
  observer_id: z.string().uuid()
});

type LookAtSurroundingsInput = z.infer<typeof LOOK_AT_SURROUNDINGS_SCHEMA>;
```

#### Tool 4B: `generate_room_node`

```typescript
/**
 * MCP Tool: generate_room_node
 *
 * Input: { previousNodeId?, direction?, biomeContext }
 * Output: { roomId, name, description }
 *
 * Logic:
 * 1. Determine biome (from previous room or parameter)
 * 2. Generate room description using existing worldgen logic
 * 3. Create RoomNode in database
 * 4. If previousNodeId provided, link back with exit
 * 5. Return room details
 */
export async function handleGenerateRoomNode(input: GenerateRoomNodeInput) {
  const biome = input.biomeContext;

  // Use worldgen to get a themed description
  const description = generateBiomeDescription(biome);

  const newRoom: RoomNode = {
    id: crypto.randomUUID(),
    name: generateRoomName(biome),
    baseDescription: description,
    biomeContext: biome,
    atmospherics: determineAtmosphericEffects(biome),
    exits: [],
    entityIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  // Save to database
  spatialRepo.create(newRoom);

  // Link from previous room if specified
  if (input.previousNodeId) {
    const prevRoom = spatialRepo.findById(input.previousNodeId);
    prevRoom.exits.push({
      direction: input.direction || 'south',
      targetNodeId: newRoom.id,
      type: 'OPEN'
    });
    spatialRepo.update(input.previousNodeId, prevRoom);
  }

  return {
    success: true,
    roomId: newRoom.id,
    name: newRoom.name,
    description: newRoom.baseDescription
  };
}

export const GENERATE_ROOM_NODE_SCHEMA = z.object({
  previous_node_id: z.string().uuid().optional(),
  direction: z.enum(['north', 'south', 'east', 'west', 'up', 'down']).optional(),
  biome_context: z.enum(['forest', 'mountain', 'urban', 'dungeon', 'coastal', 'cavern', 'divine', 'arcane'])
});

type GenerateRoomNodeInput = z.infer<typeof GENERATE_ROOM_NODE_SCHEMA>;
```

#### Tool 4C: `get_room_exits`

```typescript
/**
 * MCP Tool: get_room_exits
 *
 * Input: { roomId }
 * Output: { exits: [{direction, targetNodeId, type, dc?, description?}] }
 *
 * Simple query tool - returns exit list for a room
 */
export async function handleGetRoomExits(input: GetRoomExitsInput) {
  const room = spatialRepo.findById(input.room_id);
  if (!room) throw new Error('Room not found');

  return {
    success: true,
    exits: room.exits.map(e => ({
      direction: e.direction,
      targetNodeId: e.targetNodeId,
      type: e.type,
      dc: e.dc,
      description: e.description
    }))
  };
}

export const GET_ROOM_EXITS_SCHEMA = z.object({
  room_id: z.string().uuid()
});

type GetRoomExitsInput = z.infer<typeof GET_ROOM_EXITS_SCHEMA>;
```

**Registration in src/server/index.ts:**
```typescript
registry.registerTool(
  'look_at_surroundings',
  'Get a filtered description of the room the character is in (accounts for darkness, blindness, etc.)',
  LOOK_AT_SURROUNDINGS_SCHEMA,
  handleLookAtSurroundings
);

registry.registerTool(
  'generate_room_node',
  'Create a new room and persist to the database',
  GENERATE_ROOM_NODE_SCHEMA,
  handleGenerateRoomNode
);

registry.registerTool(
  'get_room_exits',
  'Get the list of exits (doors, passages) from a room',
  GET_ROOM_EXITS_SCHEMA,
  handleGetRoomExits
);
```

---

### 5. TESTS: Test Suite (tests/spatial-graph.test.ts)

**Create NEW file:** `tests/spatial-graph.test.ts`

**Must include at least 15 tests covering:**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { SpatialRepository } from '../src/storage/repos/spatial.repo';
import { RoomNode } from '../src/schema/spatial';
import {
  handleLookAtSurroundings,
  handleGenerateRoomNode,
  handleGetRoomExits
} from '../src/server/spatial-tools';

describe('Spatial Graph System', () => {
  let spatialRepo: SpatialRepository;

  beforeEach(() => {
    // Create test database
    spatialRepo = new SpatialRepository(createTestDb());
  });

  describe('RoomNode Schema Validation', () => {
    it('creates room with valid data', () => {
      const room = createTestRoom();
      expect(() => spatialRepo.create(room)).not.toThrow();
    });

    it('rejects room with empty name', () => {
      const room = createTestRoom({ name: '' });
      expect(() => spatialRepo.create(room)).toThrow('name cannot be empty');
    });

    it('rejects room with description < 10 chars', () => {
      const room = createTestRoom({ baseDescription: 'short' });
      expect(() => spatialRepo.create(room)).toThrow('Description must be detailed');
    });

    it('rejects invalid biome', () => {
      const room = createTestRoom({ biomeContext: 'invalid_biome' as any });
      expect(() => spatialRepo.create(room)).toThrow();
    });
  });

  describe('Room Persistence', () => {
    it('room persists after creation', () => {
      const room = createTestRoom();
      spatialRepo.create(room);

      const retrieved = spatialRepo.findById(room.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe(room.name);
    });

    it('updates room description', () => {
      const room = createTestRoom();
      spatialRepo.create(room);

      const updated = { ...room, baseDescription: 'A completely different place.' };
      spatialRepo.update(room.id, updated);

      const retrieved = spatialRepo.findById(room.id);
      expect(retrieved!.baseDescription).toBe('A completely different place.');
    });

    it('deletes room', () => {
      const room = createTestRoom();
      spatialRepo.create(room);

      const deleted = spatialRepo.delete(room.id);
      expect(deleted).toBe(true);

      const retrieved = spatialRepo.findById(room.id);
      expect(retrieved).toBeNull();
    });
  });

  describe('Exits and Navigation', () => {
    it('room can have multiple exits', () => {
      const room = createTestRoom({
        exits: [
          { direction: 'north', targetNodeId: 'room-2', type: 'OPEN' },
          { direction: 'east', targetNodeId: 'room-3', type: 'LOCKED' },
          { direction: 'down', targetNodeId: 'room-4', type: 'HIDDEN', dc: 15 }
        ]
      });

      spatialRepo.create(room);
      const retrieved = spatialRepo.findById(room.id);

      expect(retrieved!.exits).toHaveLength(3);
      expect(retrieved!.exits[2].dc).toBe(15);
    });

    it('get_room_exits returns all exits', async () => {
      const room = createTestRoom();
      spatialRepo.create(room);

      const result = await handleGetRoomExits({ room_id: room.id });
      expect(result.exits).toEqual(room.exits);
    });

    it('findConnectedRooms returns linked rooms', () => {
      const room1 = createTestRoom({ id: 'room-1' });
      const room2 = createTestRoom({ id: 'room-2' });

      room1.exits = [{ direction: 'north', targetNodeId: 'room-2', type: 'OPEN' }];

      spatialRepo.create(room1);
      spatialRepo.create(room2);

      const connected = spatialRepo.findConnectedRooms('room-1');
      expect(connected).toHaveLength(1);
      expect(connected[0].id).toBe('room-2');
    });
  });

  describe('Perception and Visibility', () => {
    it('DARKNESS requires darkvision or light source', async () => {
      const room = createTestRoom({ atmospherics: ['DARKNESS'] });
      spatialRepo.create(room);

      const observer = createTestCharacter({ currentRoomId: room.id });
      characterRepo.create(observer);

      const result = await handleLookAtSurroundings({ observer_id: observer.id });
      expect(result.description).toContain("can't see");
    });

    it('HIDDEN exits require Perception check', async () => {
      const room = createTestRoom({
        exits: [
          { direction: 'north', targetNodeId: 'room-2', type: 'HIDDEN', dc: 15 }
        ]
      });
      spatialRepo.create(room);

      const lowWisdomChar = createTestCharacter({ stats: { wis: 8 } });
      characterRepo.create(lowWisdomChar);

      // Low Wisdom should have hard time finding hidden exit
      let timesFound = 0;
      for (let i = 0; i < 100; i++) {
        const result = await handleLookAtSurroundings({ observer_id: lowWisdomChar.id });
        if (result.exits.some(e => e.direction === 'north')) timesFound++;
      }

      expect(timesFound).toBeLessThan(30); // Should rarely find it
    });

    it('LOCKED exits are not visible', async () => {
      const room = createTestRoom({
        exits: [
          { direction: 'north', targetNodeId: 'room-2', type: 'LOCKED' }
        ]
      });
      spatialRepo.create(room);

      const observer = createTestCharacter({ currentRoomId: room.id });
      characterRepo.create(observer);

      const result = await handleLookAtSurroundings({ observer_id: observer.id });
      expect(result.exits).toHaveLength(0); // Locked doors don't show
    });
  });

  describe('Room Generation', () => {
    it('generate_room_node creates room in database', async () => {
      const result = await handleGenerateRoomNode({
        biome_context: 'forest'
      });

      expect(result.success).toBe(true);
      expect(result.roomId).toBeDefined();

      const retrieved = spatialRepo.findById(result.roomId);
      expect(retrieved).toBeDefined();
    });

    it('generate_room_node links to previous room', async () => {
      const room1 = createTestRoom({ id: 'start' });
      spatialRepo.create(room1);

      const result = await handleGenerateRoomNode({
        previous_node_id: 'start',
        direction: 'north',
        biome_context: 'forest'
      });

      const updated = spatialRepo.findById('start');
      expect(updated!.exits).toContainEqual(
        expect.objectContaining({ targetNodeId: result.roomId })
      );
    });

    it('atmospheric effects vary by biome', async () => {
      const forest = await handleGenerateRoomNode({ biome_context: 'forest' });
      const cavern = await handleGenerateRoomNode({ biome_context: 'cavern' });

      const forestRoom = spatialRepo.findById(forest.roomId);
      const cavernRoom = spatialRepo.findById(cavern.roomId);

      // Cavern might have darkness, forest shouldn't (usually)
      // This tests biome-specific atmosphere generation
      expect(forestRoom!.atmospherics).toBeDefined();
      expect(cavernRoom!.atmospherics).toBeDefined();
    });
  });

  describe('Entity Management', () => {
    it('room can track entities', () => {
      const room = createTestRoom({
        entityIds: ['npc-1', 'item-1']
      });
      spatialRepo.create(room);

      const retrieved = spatialRepo.findById(room.id);
      expect(retrieved!.entityIds).toContain('npc-1');
      expect(retrieved!.entityIds).toContain('item-1');
    });

    it('addEntityToRoom adds entity', () => {
      const room = createTestRoom({ entityIds: [] });
      spatialRepo.create(room);

      spatialRepo.addEntityToRoom(room.id, 'npc-2');

      const retrieved = spatialRepo.findById(room.id);
      expect(retrieved!.entityIds).toContain('npc-2');
    });

    it('removeEntityFromRoom removes entity', () => {
      const room = createTestRoom({ entityIds: ['npc-1', 'npc-2'] });
      spatialRepo.create(room);

      spatialRepo.removeEntityFromRoom(room.id, 'npc-1');

      const retrieved = spatialRepo.findById(room.id);
      expect(retrieved!.entityIds).not.toContain('npc-1');
      expect(retrieved!.entityIds).toContain('npc-2');
    });
  });

  describe('Integration', () => {
    it('full room traversal workflow', async () => {
      // Create starting room
      const tavern = await handleGenerateRoomNode({
        biome_context: 'urban'
      });

      // Create connected room
      const alley = await handleGenerateRoomNode({
        previous_node_id: tavern.roomId,
        direction: 'south',
        biome_context: 'urban'
      });

      // Create character in first room
      const player = createTestCharacter({ currentRoomId: tavern.roomId });
      characterRepo.create(player);

      // Look around tavern
      const tavernView = await handleLookAtSurroundings({ observer_id: player.id });
      expect(tavernView.success).toBe(true);
      expect(tavernView.exits).toContainEqual(
        expect.objectContaining({ direction: 'south' })
      );
    });
  });
});

// ===== HELPERS =====
function createTestRoom(overrides?: Partial<RoomNode>): RoomNode {
  return {
    id: crypto.randomUUID(),
    name: 'Test Room',
    baseDescription: 'A generic test room with wooden floors.',
    biomeContext: 'urban',
    atmospherics: [],
    exits: [],
    entityIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    visitedCount: 0,
    ...overrides
  };
}

function createTestCharacter(overrides?: Partial<Character>): Character {
  return {
    id: crypto.randomUUID(),
    name: 'Test Character',
    stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    hp: 50,
    maxHp: 50,
    ac: 10,
    level: 1,
    currentRoomId: crypto.randomUUID(), // NEW FIELD
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}
```

---

## PHASE 1 IMPLEMENTATION CHECKLIST

- [ ] **Schema** - Create `src/schema/spatial.ts` with RoomNodeSchema
- [ ] **Repository** - Create `src/storage/repos/spatial.repo.ts` with CRUD operations
- [ ] **Migration** - Add `room_nodes` table to `src/storage/migrations.ts`
- [ ] **Character Table** - Add `current_room_id` column to characters table
- [ ] **Tools** - Create `src/server/spatial-tools.ts` with 3 handlers
- [ ] **Registration** - Register tools in `src/server/index.ts`
- [ ] **Tests** - Create `tests/spatial-graph.test.ts` with 15+ tests
- [ ] **All tests passing** - Run `npm test -- tests/spatial-graph.test.ts`
- [ ] **Build succeeds** - Run `npm run build`
- [ ] **Commit** - `git add . && git commit -m "feat(spatial): Implement persistent room/location system"`

---

## IMPLEMENTATION NOTES

### ⚠️ Critical Decisions Made For You

1. **Rooms ≠ Tiles**
   - A room is a *semantic location* (tavern, forest clearing, dungeon chamber)
   - A tile is a *physical grid square* (from worldgen)
   - This keeps them separate concerns

2. **Perception Uses WIS Modifier**
   - `stats.wis` is D&D standard for Perception
   - Modifier = `Math.floor((wis - 10) / 2)`
   - No need for separate "Perception" stat

3. **Description Is Immutable**
   - Once a room is created, `baseDescription` is locked
   - LLM cannot change room descriptions after fact
   - Prevents "retconning" the world

4. **Exits Are Discrete**
   - 8 cardinal directions + up/down
   - Each exit explicitly links to another room
   - Prevents "you can go anywhere" problem

### 🚫 What NOT To Do

- ❌ Don't create a "room registry" or cache - use the database
- ❌ Don't let LLM pass arbitrary room descriptions - generate them
- ❌ Don't support "dynamic exits" - exits are predetermined
- ❌ Don't implement hearing/social mechanics yet - that's Phase 2
- ❌ Don't add procedural exit generation - keep it explicit
- ❌ Don't worry about room cleanup/deletion yet

### ✅ What To Focus On

- ✅ Make schema validation bulletproof (Zod catches errors early)
- ✅ Use repository pattern for all data access
- ✅ Write tests FIRST, then implementation
- ✅ Ensure exits properly link to other rooms
- ✅ Handle edge cases (darkness, hidden exits, locked doors)
- ✅ Test with 100 iterations for randomness (Perception checks)

---

## DATABASE SCHEMA QUICK REFERENCE

**room_nodes table:**
```sql
id (PK)              -- UUID
name                 -- String, required, non-empty
base_description     -- String, required, min 10 chars
biome_context        -- Enum from 8 biome types
atmospherics         -- JSON array of effects
exits                -- JSON array of exit objects
entity_ids           -- JSON array of UUID strings
created_at           -- ISO timestamp
updated_at           -- ISO timestamp
visited_count        -- Int >= 0
last_visited_at      -- ISO timestamp (nullable)
```

**characters table additions:**
```sql
current_room_id      -- UUID, FK to room_nodes.id (NEW COLUMN)
```

---

## EXPECTED OUTCOMES

### After Successful Implementation:

1. **Persistent Rooms:** A tavern visited in session 1 has identical description in session 2
2. **Exit Navigation:** Characters can traverse between rooms explicitly
3. **Perception Filtering:** Darkness requires light/darkvision to see exits
4. **Room Generation:** New rooms can be created procedurally and persisted
5. **Entity Tracking:** Rooms know which NPCs/items are present

### Not Included (Phase 2):

- ❌ Hearing mechanics for conversations
- ❌ Stealth/Eavesdropping rolls
- ❌ Multiple characters in same room interactions
- ❌ Dynamic room description changes

---

## SUCCESS CRITERIA (Acceptance Test)

All of the following must pass:

```typescript
// 1. Can create and retrieve room
const room = await generateRoomNode({ biome_context: 'forest' });
const retrieved = await getRoomExits({ room_id: room.roomId });
expect(retrieved.success).toBe(true);

// 2. Darkness blocks vision without darkvision
const darkRoom = createTestRoom({ atmospherics: ['DARKNESS'] });
const blinded = createTestCharacter({ conditions: [] });
const view = await lookAtSurroundings({ observer_id: blinded.id });
expect(view.description).toContain("can't see");

// 3. Hidden exits require Perception check
const hiddenExit = { type: 'HIDDEN', dc: 15 };
// After 100 attempts with low Wisdom, should find < 30% of time

// 4. Rooms persist between sessions
const room1 = await generateRoomNode({ biome_context: 'urban' });
// ... close database, reopen
const room2 = await getRoomById({ room_id: room1.roomId });
expect(room1.roomId).toBe(room2.roomId);

// 5. All tests pass
npm test -- tests/spatial-graph.test.ts // 15+ tests, all green
```

---

## FINAL CHECKLIST BEFORE HANDOFF

- [x] Scope is clear (Phase 1 only = rooms, not hearing)
- [x] Schema defined (RoomNode with all fields)
- [x] Repository pattern specified (CRUD + helpers)
- [x] Database migration documented (room_nodes table)
- [x] MCP tools defined (3 tools with full specs)
- [x] Test suite outlined (15+ tests covering all scenarios)
- [x] Edge cases identified (darkness, hidden exits, locked doors)
- [x] No blocking issues (this is independent)
- [x] Build/test commands provided
- [x] Commit message format specified
- [x] Success criteria defined

---

**You are ready to implement. Ask if any requirements are unclear. Start with the schema, then repository, then tools, then tests. Use TDD (write test first, then implementation).**

Good luck! This is solid, achievable work that will unlock future gameplay systems.
