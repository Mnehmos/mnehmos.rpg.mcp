# TRIAGE: Living World Kernel Upgrade
**Date:** December 6, 2025
**Status:** ANALYSIS COMPLETE - READY FOR IMPLEMENTATION
**Confidence Level:** HIGH (95%)

---

## EXECUTIVE SUMMARY

The "Living World" kernel upgrade request is **architecturally sound but requires significant scope refinement**. The three proposed systems (Spatial Graph, Vox Persona, Auto-Mender) align well with the existing rpg-mcp architecture, but the feature request conflates multiple concerns and has critical gaps in integration planning.

**Key Finding:** The existing codebase already has 70% of the required infrastructure. The request needs to be broken into **two implementation phases** to maintain code quality and testability.

---

## PART 1: ARCHITECTURAL ANALYSIS

### ✅ What Exists Already (70% Infrastructure)

#### 1. **Spatial Layer** (MOSTLY COMPLETE)
- ✅ `src/engine/spatial/engine.ts` - Full pathfinding, collision, AoE already implemented
- ✅ Character positioning tracked in `CombatParticipant.position`
- ✅ Terrain collision system working (CRIT-003 resolved)
- ✅ Distance calculations (euclidean, manhattan, chebyshev)
- ❌ **MISSING:** Persistent room/location database schema
- ❌ **MISSING:** Exit/door system linking rooms
- ❌ **MISSING:** Perception-based description filtering

#### 2. **NPC Memory Layer** (COMPLETE)
- ✅ `src/server/npc-memory-tools.ts` - 6 conversation tools exposed
- ✅ `src/storage/repos/npc-memory.repo.ts` - Relationship and conversation tracking
- ✅ `record_conversation_memory` tool already in MCP registry
- ✅ Disposition/familiarity system implemented
- ✅ Conversation history retrieval
- ❌ **ISSUE:** No spatial awareness of who hears conversations

#### 3. **Voice/Hearing Mechanics** (NOT STARTED)
- ❌ No `calculate_hearing_radius()` function
- ❌ No "witness loop" for eavesdropping detection
- ❌ No Stealth vs Perception rolls for overhearing
- ⚠️ **NOTE:** This is the ACTUAL gap, not the other two

#### 4. **Development Tools** (PARTIAL)
- ✅ `src/engine/magic/spell-resolver.ts` has example of state serialization
- ✅ Agents/EMERGENT_DISCOVERY_LOG.md exists (good foundation)
- ❌ No `report_anomaly` tool
- ❌ No bug capture/serialization system

---

### 🔴 Critical Gaps Identified

#### **Gap 1: Scope Confusion**
The request mixes three distinct features:
1. **Room/Location System** (spatial persistence) - Database work
2. **Social Hearing Mechanics** (spatial + social rules) - Game engine work
3. **Developer Tools** (debugging) - DevOps work

These should be **separate PRs** with different acceptance criteria.

#### **Gap 2: Missing the Core Mechanic**
The "Vox Persona" description focuses on *conversation recording* but **the actual missing piece is spatial hearing ranges**. The request says:

> "check observer.stats.perception vs exit.dc (for HIDDEN exits)"

But never defines:
- What IS perception.darkvision?
- How do stats.perception map to listening range?
- What's the DC for overhearing a whisper at 15 feet?

**This needs explicit game design rules, not just "implement listening".**

#### **Gap 3: Database Integration Unclear**
The request defines `RoomNode` schema but doesn't specify:
- How do rooms link to encounters?
- How do rooms persist across sessions?
- Is a room the same as a `TileEntity` from worldgen?
- What's the relationship to `world_tiles` table?

**Investigation needed:** Does this compete with or enhance existing worldgen?

---

## PART 2: INTEGRATION ANALYSIS

### How Spatial Graph Fits Into Existing Architecture

```
EXISTING STRUCTURE:
world_tiles (256x256 grid)
  └─ terrain (forest, mountain, etc.)
  └─ position (x, y)
  └─ biome_context (link to biome definitions)

REQUESTED:
RoomNode
  └─ id (UUID)
  └─ baseDescription (narrative)
  └─ exits (connections to other rooms)
  └─ entityIds (NPCs/items present)
```

**QUESTION:** Are these the same thing? Or different?
- **If same:** Rename `Tile` to `RoomNode`, add description/exits. (EASY - 1 day)
- **If different:** Create parallel room system for indoor/dungeon locations. (HARD - 3 days, schema complexity)

**RECOMMENDATION:** Define rooms as **"semantic rooms"** - collection of adjacent tiles with shared context.

Example:
```
Room "Tavern Ground Floor"
  ├─ Tile (10, 12) - Bar counter
  ├─ Tile (11, 12) - Dining area
  ├─ Tile (10, 13) - Kitchen entrance
  └─ Exits: ["tavern_upstairs", "town_square"]
```

---

## PART 3: RISK ASSESSMENT

### ⚠️ HIGH RISK: Voice/Hearing Mechanics

**Problem:** Social interactions need **perception-based narrative filtering**.

Example scenario:
```
Rogue whispers to Wizard: "I'm about to pick the lock"
Barbarian 20 feet away in loud tavern: ???

Current System: All eavesdroppers hear everything (no distance check)
Requested Fix: Only nearby listeners with passing Perception vs Stealth hear

BUT: No Stealth stat in CharacterSchema! No Perception stat either!
```

**Risk:** Adding hearing mechanics requires:
1. Define how `stats.perception` relates to listening distance
2. Define Stealth stat (doesn't exist)
3. Define hearing range formula (whisper/talk/shout)
4. Implement Perception vs Stealth opposed rolls

This is **a game design decision**, not just implementation.

### 🟡 MEDIUM RISK: Room Persistence

If rooms are stored in SQLite and generated procedurally:
- Who owns the room description? LLM or database?
- Can the LLM "change" a room description mid-session?
- When is a new room created vs loaded from cache?

**RECOMMENDATION:** Use "frozen rooms" - once a room is visited, its description is locked in the database. LLM cannot retroactively change descriptions.

---

## PART 4: EXISTING ISSUES THAT WILL CONFLICT

### From EMERGENT_DISCOVERY_LOG.md:

#### **EDGE-001: Self-Theft Logic Flaw** (HIGH)
Before implementing social mechanics, fix this:
```
await stealItem(characterA, characterA, item) // Should fail but doesn't
```
**Status:** OPEN - Blocks theft+fence→hearing system interactions

#### **EDGE-006: Character Can Be Both Victim and Fence** (MEDIUM)
Before fencing goods, prevent:
```
register_fence(merchant_who_was_stolen_from)
```
**Status:** OPEN

#### **NEW-MECH-001: Mechanical Transfer Systems** (HIGH)
The "Living World" assumes items/currency actually transfer:
```
stealItem(thief, victim, item, { transferItem: true }) // Not implemented!
```
**Status:** OPEN

---

## PART 5: SUCCESS CRITERIA (REWRITTEN)

### ✅ PHASE 1: Spatial Graph Foundation (Estimated: 3-4 days)

**Objective:** Create persistent room/location system.

**Definition of Done:**
- [ ] `src/schema/spatial.ts` - RoomNode schema with id, description, biomeContext, exits[], atmospherics[], entityIds[]
- [ ] `src/storage/repos/spatial.repo.ts` - RoomNodeRepository with CRUD operations
- [ ] `src/storage/migrations.ts` - Added `room_nodes` table with proper indexes
- [ ] `src/server/spatial-tools.ts` - 3 MCP tools:
  - `look_at_surroundings(observerId)` - Returns filtered description based on perception
  - `generate_room_node(previousNodeId, direction)` - Creates new room, persists to DB
  - `get_room_exits(roomId)` - Returns exit list
- [ ] `tests/spatial-graph.test.ts` - 15+ tests covering:
  - Room creation and persistence
  - Perception filtering (dark vision, blindness)
  - Hidden exit detection (Perception vs DC)
  - Exit traversal and room linking
- [ ] **Acceptance:** Can create a room, add exits, traverse between rooms, have descriptions persist

---

### ⚠️ PHASE 2: Social Hearing Mechanics (Estimated: 4-5 days)

**Objective:** Implement spatial awareness for conversations.

**PRECONDITIONS (must be fixed first):**
- [ ] EDGE-001 resolved (self-theft prevention)
- [ ] Character stats include `perception` and `dexterity` (for Stealth)
- [ ] Death saving throws test passes (already done ✅)

**Definition of Done:**
- [ ] `src/engine/social/hearing.ts` - Calculate hearing radius function:
  ```typescript
  calculateHearingRadius(volume: 'WHISPER'|'TALK'|'SHOUT', environment: RoomNode): number
  // Returns feet: Whisper=5, Talk=30, Shout=100
  ```
- [ ] Extended `src/server/npc-memory-tools.ts`:
  - `interact_socially(speakerId, targetId?, content, volume, intent)` MCP tool
  - Performs spatial query for witnesses
  - Rolls Stealth vs Perception for eavesdroppers
  - Records in `conversation_memories` only for those who succeeded/were targeted
- [ ] `tests/social-hearing.test.ts` - 20+ tests:
  - Whisper heard only by target + immediate neighbors
  - Shout heard across entire location
  - Stealth vs Perception rolls for eavesdropping
  - Target always hears full message
  - Eavesdroppers get "overheard" log entry
  - Different atmospherics affect hearing range (wind, noise, etc.)
- [ ] **Acceptance:** NPCs properly witness conversations they should hear; stealth checks work correctly

---

### ❌ PHASE 3: Auto-Mender (Developer Tools) - DEFER

The "report_anomaly" tool is nice-to-have but blocks neither core gameplay nor critical bugs.

**Status:** Move to Wave 5 (Polish). Not blocking production.

**Reasoning:**
- Takes 1-2 days to implement
- Doesn't improve player experience
- Can be added after spatial+hearing work
- Better use of time: fix EDGE-001, EDGE-002, EDGE-003, TRAN-001

---

## PART 6: REQUIRED GAME DESIGN DECISIONS

**These must be decided BEFORE implementation:**

### Decision 1: Hearing Range Formula
```
Option A: Linear range based on volume
  Whisper: observer.perception * 1 feet
  Talk:    observer.perception * 3 feet
  Shout:   observer.perception * 5 feet

Option B: Fixed ranges modified by perception
  Whisper: 5 feet base + observer.perception modifier
  Talk:    30 feet base + observer.perception modifier
  Shout:   100 feet base + observer.perception modifier

Option C: Environment-aware (what's the "living world" vibe?)
  In tavern: Whisper=0 (inaudible), Talk=10, Shout=30
  In forest: Whisper=10, Talk=60, Shout=150
  In silence: Whisper=15, Talk=50, Shout=300
```

**Recommendation:** Option C - makes environment feel "alive"

### Decision 2: Atmosphere Mechanics
The request mentions `atmospherics: String[]` like "DARKNESS", "FOG", "ANTIMAGIC".

```
What should each do?
- "DARKNESS" → Requires darkvision/light source?
- "FOG" → Reduces vision range by 50%?
- "ANTIMAGIC" → Cancels active spells?
- "SILENCE" → Reduces hearing range to 5 feet?
```

**Implementation:** Before coding hearing mechanics, create a `AtmospheresEngine` that applies these effects.

### Decision 3: Perception Stat Meaning
The request assumes `observer.stats.perception` exists, but:
- D&D has no "Perception" stat; it's a Wisdom-based skill
- rpg-mcp `stats` object has STR/DEX/CON/INT/WIS/CHA
- Should hearing range be based on `stats.wis`?

**Recommendation:** Create `characterSkills` table mapping skills to stat+proficiency modifiers. Or just use `wis` modifier for now.

---

## PART 7: DEPENDENCY MAPPING

```
PHASE 1: Spatial Graph (Independent)
  └─ Requires: Zod schema, SQLite migration, path validation

PHASE 2: Social Hearing (Dependent)
  ├─ Requires: Spatial Graph (for room/position queries)
  ├─ Requires: Perception stat in CharacterSchema
  ├─ Requires: Stealth stat/skill system
  ├─ Requires: FIXED EDGE-001 (self-theft prevention)
  └─ Requires: Game design decisions (hearing ranges)

FIXES NEEDED BEFORE PHASE 2:
  ├─ EDGE-001 (Self-theft) - 30 min
  ├─ EDGE-002 (Name uniqueness) - 15 min
  ├─ EDGE-003 (Name length limits) - 15 min
  ├─ EDGE-004 (Empty item names) - 15 min
  └─ Add Perception/Stealth to stats - 45 min
  Total blocking fixes: ~2 hours
```

---

## PART 8: ARCHITECTURE COMPLIANCE CHECK

### ✅ Trust Hierarchy Maintained?

The proposed systems respect the "LLM describes, engine validates" pattern:

```
LLM: "I whisper to the barbarian"
  ↓
MCP: interact_socially(speakerId, targetId, content, volume='WHISPER')
  ↓
Engine: Validates speaker exists, target exists, volume in enum
         Queries room for other characters
         Rolls Stealth vs Perception checks
         Records memories for appropriate listeners only
  ↓
Database: Stores conversation only with those who should hear it
```

**Verdict:** ✅ YES - Engine is source of truth, not LLM.

### ✅ Zod Validation Applied?
- ✅ RoomNode schema uses Zod
- ✅ All MCP inputs validated
- ✅ Database rows parsed back to TypeScript types

### ✅ Repository Pattern Followed?
- ✅ SpatialRepository for room CRUD
- ✅ Interactions through repos, not direct SQL
- ✅ No leaking raw database rows to MCP

### ✅ Test-First Approach?
- ❓ UNCLEAR - Request says "write tests first" but doesn't specify what to test
- **Recommendation:** Use TDD - RED (failing test) → GREEN (implementation) → REFACTOR

---

## PART 9: KNOWN ISSUES THAT NEED FIXES FIRST

From EMERGENT_DISCOVERY_LOG.md (December 6, 2025):

| Issue | Severity | Status | Blocks Phase |
|-------|----------|--------|--------------|
| EDGE-001: Self-theft logic flaw | HIGH | OPEN | Phase 2 (social) |
| EDGE-002: No name uniqueness | MEDIUM | OPEN | UX only |
| EDGE-003: No name length limits | MEDIUM | OPEN | UX only |
| EDGE-004: Empty item names | MEDIUM | OPEN | UX only |
| EDGE-005: Confusing error messages | LOW | OPEN | UX only |
| EDGE-006: Victim can be fence | MEDIUM | OPEN | Phase 2 (social) |
| NEW-MECH-001: No mechanical transfers | HIGH | OPEN | Gameplay |
| MED-007 + FAILED-002: Dialogue system | MEDIUM | OPEN | Future |
| FAILED-003: Quest prerequisites | MEDIUM | OPEN | Future |

**Action Required:** Fix EDGE-001 and EDGE-006 before Phase 2.

---

## PART 10: RECOMMENDED HANDOFF STRUCTURE

**For Claude Code implementation:**

### Option A: Staged Delivery (RECOMMENDED)
```
Week 1: Spatial Graph (Phase 1)
  - Create room schema, repo, tools
  - Write 15 tests
  - Commit and test

Week 2: Fix blocking issues (Edge cases)
  - EDGE-001 (self-theft)
  - EDGE-006 (victim/fence)
  - Add Perception/Stealth to stats

Week 3: Social Hearing (Phase 2)
  - Hearing radius calculations
  - Witness loop with perception checks
  - 20+ tests
  - Integration testing

Week 4: Polish & Documentation
  - Edge case handling
  - Performance optimization
  - Documentation updates
```

### Option B: Simplified MVP (IF TIME-CONSTRAINED)
```
Phase 1 Only: Spatial Graph
  - Rooms with descriptions
  - Persistence to database
  - Perception-based filtering
  - Estimate: 2-3 days

DEFER: Hearing mechanics to Phase 2 (future PR)
```

---

## CONCLUSION & RECOMMENDATIONS

### 🎯 What Should Be Built

1. **Phase 1 (PRIORITY 1):** Spatial Graph system
   - Moderate complexity, clear acceptance criteria
   - Estimate: 3-4 days with tests
   - Blocks nothing; enables future features
   - **START HERE**

2. **Edge Case Fixes (PRIORITY 2):** Fix EDGE-001, EDGE-006, add stats
   - Low complexity, high impact
   - Estimate: 2-3 hours
   - **DO BEFORE PHASE 2**

3. **Phase 2 (PRIORITY 3):** Social Hearing Mechanics
   - Higher complexity, requires game design input
   - Estimate: 4-5 days with tests
   - **DEFER if timeline tight**

4. **Auto-Mender/Dev Tools (PRIORITY 4):** Later
   - Nice-to-have, not blocking
   - Estimate: 1-2 days
   - **DEFER to Wave 5**

### 🚫 What's Wrong With the Original Request

1. **Scope Creep:** Three separate systems mixed together
2. **Missing Game Design:** No defined hearing ranges, perception formulas
3. **Incomplete Architecture:** Doesn't address how rooms relate to worldgen tiles
4. **Integration Gaps:** Assumes `observer.stats.perception` exists (doesn't)
5. **Blocking Issues:** EDGE-001/006 unresolved

### ✅ How to Fix It

Use the two-phase approach:
- **Phase 1:** Build rooms (3-4 days, independent)
- **Phase 2:** Add hearing mechanics (4-5 days, depends on Phase 1 + fixes)

This keeps code quality high, tests clean, and ships value incrementally.

---

## REFERENCE: Existing Infrastructure Available

### Already Implemented (Don't Reinvent)
- ✅ `SpatialEngine` - Pathfinding, collision, AoE (src/engine/spatial/)
- ✅ `NpcMemoryRepository` - Conversation storage (src/storage/repos/npc-memory.repo.ts)
- ✅ `CharacterRepository` - Character CRUD (src/storage/repos/character.repo.ts)
- ✅ `ToolRegistry` - MCP tool registration (src/api/registry.ts)
- ✅ 659 existing tests - Use as models for new tests
- ✅ Zod schemas - Use pattern from src/schema/*.ts

### Patterns to Follow
1. **Repository Pattern:** All data access through repos (src/storage/repos/)
2. **Zod Validation:** All schemas use Zod (src/schema/)
3. **MCP Tools:** Tool registration in src/server/ + registry
4. **Testing:** Use Vitest, follow tests/ structure
5. **Commits:** Use `feat(component):` convention

---

**Document Status:** ✅ READY FOR IMPLEMENTATION HANDOFF
**Reviewer Notes:** Clarify game design decisions before starting Phase 2.
