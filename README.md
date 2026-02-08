# mnehmos.rpg.mcp: Agentic Embodied Simulation Kernel

[![npm version](https://img.shields.io/npm/v/mnehmos.rpg.mcp.svg)](https://www.npmjs.com/package/mnehmos.rpg.mcp)
[![License: ISC](https://img.shields.io/badge/license-ISC-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)]()
[![MCP](https://img.shields.io/badge/MCP-Compatible-green.svg)]()
[![Tests](https://img.shields.io/badge/tests-2080%2B%20passing-brightgreen.svg)]()
[![Tools](https://img.shields.io/badge/MCP%20tools-28-blue.svg)]()

**A rules-enforced RPG backend that turns any LLM into a game master who can't cheat.**

---

## What Is This? (Start Here)

**You are the player. The AI is the dungeon master.**

You talk to an AI (Claude, GPT, etc.) in natural language. You say things like "I attack the goblin" or "I search the room for traps." The AI narrates what happens and describes the world.

**The difference from pure AI storytelling:** This engine enforces the rules. When you attack, it actually rolls dice, checks armor class, calculates damage, and updates HP in a real database. The AI can't just decide you hit or miss—the math happens, and both you and the AI see the result.

### What can you actually do?

- **Explore procedurally generated worlds** with 28+ biome types
- **Fight enemies** using D&D 5e-style combat (initiative, AC, damage rolls, death saves)
- **Cast spells** with real slot tracking—if you're out of slots, you can't cast
- **Manage inventory** with equipment slots, weight, and item properties
- **Complete quests** with tracked objectives and rewards
- **Interact with NPCs** who remember your conversations across sessions
- **Everything persists**—close the game, come back tomorrow, your character is exactly where you left them

### Who is this for?

- **Solo RPG players** who want AI-driven adventures with mechanical integrity
- **People frustrated with AI RPGs** that fall apart when you ask "wait, how much HP do I have?"
- **Developers** building AI game integrations who need a reference implementation

### How do I play?

1. Install the MCP server (see Installation below)
2. Connect it to Claude Desktop (or any MCP-compatible client)
3. Tell the AI: "Let's start a new game. Create a character for me."
4. Play naturally—the AI handles narration, the engine handles mechanics

---

## v1.0 Release (January 2026)

### 85% Tool Reduction: 195 → 28 Consolidated Tools

This release consolidates 195 individual tools into **28 action-based tools** using:

- **Action enums** - Each tool handles multiple operations via an `action` parameter
- **Fuzzy matching** - Typo-tolerant action matching with suggestions
- **Guiding errors** - Clear feedback when actions don't match

**Before:** `create_character`, `get_character`, `update_character`, `delete_character`, `list_characters`...
**After:** `character_manage` with actions: `create`, `get`, `update`, `delete`, `list`, `search`

### Key Metrics

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| MCP Tools | 195 | 28 | **85.6% reduction** |
| Tests | 1,242 | 2,080+ | +67% coverage |
| Token overhead | ~50K | ~6-8K | **85% reduction** |

### Meta-Tools for Discovery

Two special tools help LLMs discover and use the consolidated tools:

| Tool | Purpose |
|------|---------|
| `search_tools` | Search tools by keyword, category, or capability |
| `load_tool_schema` | Load full parameter schema before first use |

---

## Architecture Philosophy

This engine implements the **Event-Driven Agentic AI Architecture**:

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                         │
│   EVENT                                                                                 │
│     │                                                                                   │
│     ▼                                                                                   │
│   ┌───────────┐     ┌───────────┐     ┌────────────┐     ┌───────────┐     ┌─────────┐ │
│   │  OBSERVE  │ ──▶ │  ORIENT   │ ──▶ │   DECIDE   │ ──▶ │    ACT    │ ──▶ │VALIDATE │ │
│   │           │     │           │     │            │     │           │     │         │ │
│   │ MCP Read  │     │ LLM Brain │     │Orchestrator│     │ MCP Write │     │ Engine  │ │
│   │  Tools    │     │  Analyze  │     │   Plan     │     │   Tools   │     │  Rules  │ │
│   └───────────┘     └───────────┘     └────────────┘     └───────────┘     └────┬────┘ │
│         ▲                                                                       │      │
│         │                                                                       │      │
│         └───────────────────────────────────────────────────────────────────────┘      │
│                                    WORLD STATE                                         │
│                                  (updates & loops)                                     │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### The Embodiment Model

| Biological System  | RPG-MCP Component     | Role                                                   |
| ------------------ | --------------------- | ------------------------------------------------------ |
| **Brain**          | LLM Agent (external)  | Strategic reasoning, planning, interpretation          |
| **Nervous System** | Engine + Orchestrator | Validates intent, enforces constraints, routes actions |
| **Reflex Arc**     | Constraint Validator  | Blocks impossible actions before execution             |
| **Sensory Organs** | Observation Tools     | `getObservation`, `queryEntities`, `getWorldSnapshot`  |
| **Muscles**        | Action Tools          | `proposeAction`, `moveEntity`, `attack`, `interact`    |
| **Environment**    | World State + Physics | SQLite-persisted, deterministic, forkable reality      |

**Key invariant**: LLMs propose intentions. The engine validates and executes. LLMs never directly mutate world state.

---

## Consolidated Tools Reference (28 Tools)

### Character & Party

| Tool | Actions | Description |
|------|---------|-------------|
| `character_manage` | create, get, update, delete, list, search | Full character CRUD with D&D stat blocks |
| `party_manage` | create, get, update, delete, add_member, remove_member, set_leader, context | Party management and member operations |

### Combat System

| Tool | Actions | Description |
|------|---------|-------------|
| `combat_manage` | create, get, end, load, advance, death_save, lair_action, add_participant, remove_participant | Encounter lifecycle and initiative |
| `combat_action` | attack, cast, move, dash, dodge, disengage, help, ready | Combat actions with full D&D 5e rules |
| `combat_map` | get_terrain, set_terrain, get_positions, calculate_aoe | Tactical grid and terrain management |

### Inventory & Economy

| Tool | Actions | Description |
|------|---------|-------------|
| `item_manage` | create, get, update, delete, list, search | Item template CRUD |
| `inventory_manage` | give, remove, transfer, equip, unequip, use | Inventory operations between characters |
| `corpse_manage` | create, get, list, loot, harvest, advance_decay, cleanup | Death and loot mechanics |
| `theft_manage` | steal, check_stolen, check_recognition, report | Theft with heat tracking |

### World & Spatial

| Tool | Actions | Description |
|------|---------|-------------|
| `world_manage` | generate, get, update, list, delete | Procedural world generation |
| `world_map` | get_overview, get_region, patch, preview | Map queries and modifications |
| `spatial_manage` | look, move, generate_room, get_exits, list_rooms | Dungeon navigation and room networks |

### Quests & NPCs

| Tool | Actions | Description |
|------|---------|-------------|
| `quest_manage` | create, get, list, assign, complete, fail, abandon, add_objective, update_objective | Quest lifecycle management |
| `npc_manage` | get_relationship, update_relationship, record_memory, get_history, interact | NPC memory and social interactions |
| `aura_manage` | create, list, get_affecting, process, remove, expire | Area effects and buffs/debuffs |

### Magic & Rest

| Tool | Actions | Description |
|------|---------|-------------|
| `scroll_manage` | use, create, identify, get_dc, get_details | Scroll mechanics |
| `rest_manage` | long_rest, short_rest | HP and spell slot recovery |
| `concentration_manage` | check_save, break, get_state, check_duration | Spell concentration tracking |

### Utility & Meta

| Tool | Actions | Description |
|------|---------|-------------|
| `secret_manage` | create, get, list, update, delete, reveal, check_conditions | DM secrets with reveal conditions |
| `narrative_manage` | add, search, update, get, delete, get_context | Story notes and session history |
| `improvisation_manage` | resolve_stunt, apply_effect, get_effects, remove_effect, advance_duration, attempt_synthesis | Rule of Cool and custom effects |
| `math_manage` | dice_roll, probability, algebra, physics | Dice and calculations |
| `strategy_manage` | create_nation, get_state, propose_alliance, claim_region | Grand strategy simulation |
| `turn_manage` | init, get_status, submit_actions, mark_ready, poll_results | Async turn management |
| `spawn_manage` | spawn_character, spawn_location, spawn_encounter, spawn_preset_location, spawn_tactical | Entity and encounter spawning |
| `session_manage` | initialize_session, get_context | Session state management |
| `travel_manage` | travel, loot, rest | Party movement and field actions |
| `batch_manage` | create_characters, create_npcs, distribute_items, execute_workflow | Bulk operations |

---

## Installation

### Option 1: npm (Recommended)

```bash
npm install mnehmos.rpg.mcp
```

### Option 2: Standalone Binaries

Download pre-built binaries from [Releases](https://github.com/Mnehmos/rpg-mcp/releases):

```bash
# Windows
.\rpg-mcp-win.exe

# macOS (Intel)
chmod +x rpg-mcp-macos && ./rpg-mcp-macos

# macOS (Apple Silicon)
chmod +x rpg-mcp-macos-arm64 && ./rpg-mcp-macos-arm64

# Linux
chmod +x rpg-mcp-linux && ./rpg-mcp-linux
```

### Option 3: From Source

```bash
git clone https://github.com/Mnehmos/rpg-mcp.git
cd rpg-mcp
npm install
npm run build
npm test  # 2080+ tests should pass
```

### MCP Client Configuration

**Claude Desktop / MCP Clients:**

```json
{
  "mcpServers": {
    "rpg-mcp": {
      "command": "npx",
      "args": ["-y", "mnehmos.rpg.mcp@1.0.1"]
    }
  }
}
```

Security note: pin an explicit package version in `args` to avoid unintentionally running a newly published release.

**Using Binary:**

```json
{
  "mcpServers": {
    "rpg-mcp": {
      "command": "path/to/rpg-mcp-win.exe"
    }
  }
}
```

---

## Core Systems

### Combat & Encounters

- **Initiative tracking** with advantage/disadvantage
- **Spatial combat** with grid positioning and collision
- **Opportunity attacks** with reaction economy
- **Death saving throws** (D&D 5e rules)
- **Damage resistance/vulnerability/immunity**
- **Legendary creatures** with lair actions and legendary resistances
- **Encounter presets** - Pre-balanced encounters by party level

### Magic System

- **15+ SRD spells** (Magic Missile, Fireball, Cure Wounds, etc.)
- **Spell slot tracking** with class-based progression
- **Warlock pact magic** with short rest recovery
- **Concentration tracking**
- **Anti-hallucination validation** - LLMs cannot cast spells they don't know

### Theft & Economy

- **Stolen item tracking** with heat levels (burning → cold)
- **Witness recording** for theft detection
- **Fence NPCs** with buy rates and heat capacity
- **Item recognition** - original owners detect their stolen goods

### NPC Memory

- **Relationship tracking** (familiarity + disposition)
- **Conversation memory** with importance levels
- **Context injection** for LLM prompts
- **Interaction history** across sessions

### Improvisation Engine

- **Rule of Cool stunts** - "I kick the brazier into the zombies"
- **Custom effects** - Divine boons, curses, transformations
- **Arcane synthesis** - Dynamic spell creation with wild surge risk

---

## Project Structure

```
src/
├── schema/           # Zod schemas: entities, actions, world state
├── engine/
│   ├── combat/       # Encounters, initiative, damage, death saves
│   ├── spatial/      # Grid, collision, movement
│   ├── worldgen/     # Procedural generation (28+ biomes)
│   └── strategy/     # Nation simulation
├── data/
│   ├── creature-presets.ts   # 1100+ creature templates
│   ├── encounter-presets.ts  # 50+ balanced encounters
│   └── items/               # PHB weapons, armor, magic items
├── storage/
│   ├── migrations.ts # SQLite schema definitions
│   └── repos/        # Repository pattern for persistence
├── server/
│   ├── consolidated/ # 28 action-based tools
│   ├── consolidated-registry.ts  # Tool registration
│   └── meta-tools.ts # search_tools, load_tool_schema
└── utils/
    ├── fuzzy-enum.ts      # Action matching with typo tolerance
    └── schema-shorthand.ts # Token-efficient parsing

tests/                # 2080+ tests mirroring src/ structure
docs/                 # White paper and LLM spatial guide
```

---

## Design Principles

1. **LLMs propose, never execute**
   The brain suggests; the nervous system validates.

2. **All action is tool-mediated**
   No direct world mutation. Every change flows through MCP tools.

3. **Validation precedes observation**
   Act → Validate → Observe. The reflex arc pattern.

4. **Deterministic outcomes**
   Same inputs → same outputs. Always reproducible.

5. **Schema-driven everything**
   Zod validates all data at boundaries. Type safety end-to-end.

6. **Anti-hallucination by design**
   LLMs cannot cast spells they don't know or claim damage they didn't roll.

7. **Token efficiency**
   28 consolidated tools with action routing reduce context overhead by 85%.

8. **Guiding errors**
   Invalid actions return suggestions, not just failures.

---

## Test Coverage

```bash
npm test
# 2080+ tests passing
# 85+ test files
# Coverage across all 28 consolidated tools
```

---

## Contributing

Contributions welcome! Please:

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Write tests for new functionality
4. Follow existing code style (TypeScript + Zod + tests)
5. Submit a pull request

---

## Roadmap

- [x] Full spellcasting system with validation
- [x] Theft and fence economy
- [x] Corpse and loot mechanics
- [x] NPC memory and relationships
- [x] Improvisation engine
- [x] Tool consolidation (195 → 28)
- [x] Fuzzy action matching
- [x] Preset systems (creatures, encounters, locations)
- [ ] WebSocket real-time subscriptions
- [ ] Dialogue tree system
- [ ] Cover mechanics in combat
- [ ] Quest chains with prerequisites

---

## License

[ISC](LICENSE) — Use freely, attribution appreciated.

---

## Related

- [Model Context Protocol Specification](https://modelcontextprotocol.io)
- [Quest Keeper AI](https://github.com/Mnehmos/QuestKeeperAI-v2) — Desktop AI dungeon master using this engine

---

## Documentation

- **[CLAUDE.md](CLAUDE.md)** - Development instructions
- **[docs/WHITE_PAPER.md](docs/WHITE_PAPER.md)** - Design philosophy and architecture
- **[docs/LLMSpatialGuide.md](docs/LLMSpatialGuide.md)** - LLM spatial navigation guide
- **[docs/ADR-005-unified-ownership-architecture.md](docs/ADR-005-unified-ownership-architecture.md)** - Target ownership architecture
- **[docs/EXECUTION-PRIORITIES-unified-ownership.md](docs/EXECUTION-PRIORITIES-unified-ownership.md)** - Outcome-based execution priorities

---

<p align="center">
<em>"AI-native autonomic organisms capable of maintaining and improving themselves in complex environments"</em>
</p>
