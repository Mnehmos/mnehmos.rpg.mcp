# RPG-MCP: Agentic Embodied Simulation Kernel

[![License: ISC](https://img.shields.io/badge/license-ISC-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)]()
[![MCP](https://img.shields.io/badge/MCP-Compatible-green.svg)]()
[![Tests](https://img.shields.io/badge/tests-746%20passing-brightgreen.svg)]()
[![Tools](https://img.shields.io/badge/MCP%20tools-135-blue.svg)]()

**A deterministic, schema-driven, multi-world simulation engine for embodied AI agents.**

RPG-MCP is not a game—it's a **world kernel**. It provides the physics, constraints, persistence, and deterministic execution layer that allows LLM agents to inhabit a simulated reality with real bodies, real limits, and real consequences.

---

## What's New (December 6, 2025)

- **135 MCP Tools** - Complete RPG mechanics coverage (up from 122)
- **746 Passing Tests** - Comprehensive test coverage (up from 659)
- **Full Spellcasting System** - 15+ SRD spells, class progression, slot tracking
- **Theft & Fence System** - Heat decay, witness tracking, black market economy
- **Corpse & Loot System** - Decay states, harvestable resources, loot tables
- **NPC Memory System** - Relationship tracking, conversation history, context injection
- **Improvisation Engine** - Rule of Cool stunts, custom effects, arcane synthesis
- **Legendary Creatures** - Lair actions, legendary resistances, boss mechanics
- **Death Saving Throws** - Full D&D 5e rules with stabilization
- **Spatial Navigation** - Room networks, terrain-aware POI placement
- **Expanded Party System** - World positioning, region queries
- **Currency System** - Gold/silver/copper with auto-conversion

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

## Features

### Core Systems

**Multi-tenant & Multi-world**

- Isolated projects (`projectId`) and parallel worlds (`worldId`)
- Fork worlds for branching timelines or "what-if" simulations

**Embodied Entities**

- Position, velocity, orientation in 3D space
- Stats, inventories, status effects, controller links
- Sensory radius, line-of-sight, perception limits

**Intent-Based Actions**

- Agents submit intentions: `MOVE_TO`, `ATTACK`, `CAST_SPELL`, `INTERACT`
- Engine validates against physics, rules, and constraints
- Invalid actions rejected with structured feedback

**Deterministic Physics**

- Collision detection, projectile trajectories, movement costs
- Reproducible world steps—same inputs always yield same outputs
- Full audit trail: snapshots, event logs, action history

### Combat & Encounters

- **Initiative tracking** with advantage/disadvantage
- **Spatial combat** with grid positioning and collision
- **Opportunity attacks** with reaction economy
- **Death saving throws** (D&D 5e rules)
- **Damage resistance/vulnerability/immunity**
- **Legendary creatures** with lair actions and legendary resistances

### Magic System

- **15+ SRD spells** (Magic Missile, Fireball, Cure Wounds, etc.)
- **Spell slot tracking** with class-based progression
- **Warlock pact magic** with short rest recovery
- **Concentration tracking**
- **Anti-hallucination validation** - LLMs cannot cast spells they don't know
- **Rest mechanics** restore spell slots and HP

### Theft & Economy

- **Stolen item tracking** with heat levels (burning → cold)
- **Witness recording** for theft detection
- **Fence NPCs** with buy rates and heat capacity
- **Item recognition** - original owners detect their stolen goods
- **Heat decay** over time

### Corpse & Loot

- **Corpse creation** on creature death
- **Loot tables** with guaranteed and random drops
- **Harvestable resources** (pelts, fangs, etc.)
- **Decay system** (fresh → decaying → skeletal → gone)

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
├── schema/           # Zod schemas: entities, actions, world state, constraints
├── engine/
│   ├── combat/       # Encounters, initiative, damage, death saves
│   ├── spatial/      # Grid, collision, movement, opportunity attacks
│   ├── worldgen/     # Procedural generation (28+ biomes)
│   ├── magic/        # Spell database, validation, resolution
│   └── strategy/     # Nation simulation (grand strategy mode)
├── storage/
│   ├── migrations.ts # SQLite schema definitions
│   └── repos/        # Repository pattern for persistence
├── server/           # MCP tool handlers
│   ├── combat-tools.ts
│   ├── corpse-tools.ts
│   ├── improvisation-tools.ts
│   ├── inventory-tools.ts
│   ├── npc-memory-tools.ts
│   ├── theft-tools.ts
│   └── ... (14 tool modules)
└── api/              # MCP server entry point

tests/                # 746 tests mirroring src/ structure
docs/                 # White paper and LLM spatial guide
```

---

## Installation

### Option 1: Standalone Binaries (Recommended)

Download the pre-built binary for your platform from the [Releases](https://github.com/Mnehmos/rpg-mcp/releases) page:

**Windows:**

```bash
# Download rpg-mcp-win.exe
# No Node.js installation required!
.\rpg-mcp-win.exe
```

**macOS:**

```bash
# Download rpg-mcp-macos
chmod +x rpg-mcp-macos
./rpg-mcp-macos
```

**Linux:**

```bash
# Download rpg-mcp-linux
chmod +x rpg-mcp-linux
./rpg-mcp-linux
```

The binaries are self-contained and include all dependencies. No Node.js installation needed.

### Option 2: From Source

```bash
git clone https://github.com/Mnehmos/rpg-mcp.git
cd rpg-mcp
npm install
npm run build
npm test  # 746 tests should pass
```

To build binaries yourself:

```bash
npm run build:binaries
# Output: dist-bundle/rpg-mcp-win.exe, rpg-mcp-macos, rpg-mcp-linux
```

### MCP Client Configuration

To use with an MCP-compatible client (Claude Desktop, etc.), add to your client's configuration:

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

**Using Source:**

```json
{
  "mcpServers": {
    "rpg-mcp": {
      "command": "node",
      "args": ["tsx", "path/to/rpg-mcp/src/server/index.js"]
    }
  }
}
```

---

## MCP Tools Reference (135 Tools)

### World Management (12 tools)

| Tool                       | Description                             |
| -------------------------- | --------------------------------------- |
| `create_world`             | Create a new world                      |
| `get_world`                | Retrieve world by ID                    |
| `list_worlds`              | List all worlds                         |
| `delete_world`             | Delete world (cascades)                 |
| `generate_world`           | Procedural generation with Perlin noise |
| `get_world_state`          | Full world state dump                   |
| `get_world_map_overview`   | Summary stats & biome distribution      |
| `get_world_tiles`          | Full tile grid                          |
| `get_region_map`           | Single region details                   |
| `apply_map_patch`          | DSL for map modifications               |
| `preview_map_patch`        | Dry-run of patch                        |
| `update_world_environment` | Time, weather, season                   |

### POI Location Tools (2 tools)

| Tool                      | Description                                    |
| ------------------------- | ---------------------------------------------- |
| `find_valid_poi_location` | Terrain-aware placement for points of interest |
| `suggest_poi_locations`   | Suggest multiple valid POI locations           |

### Character Management (5 tools)

| Tool               | Description                 |
| ------------------ | --------------------------- |
| `create_character` | Full D&D stat block support |
| `get_character`    | Retrieve by ID              |
| `update_character` | Update any field            |
| `list_characters`  | List all characters         |
| `delete_character` | Remove from DB              |

### Inventory & Items (15 tools)

| Tool                     | Description                                      |
| ------------------------ | ------------------------------------------------ |
| `create_item_template`   | Define item types                                |
| `get_item`               | Get template by ID                               |
| `list_items`             | All templates                                    |
| `search_items`           | Query by name/type/value                         |
| `update_item`            | Modify template                                  |
| `delete_item`            | Remove template                                  |
| `give_item`              | Add to character inventory                       |
| `remove_item`            | Take from inventory                              |
| `transfer_item`          | Move between characters                          |
| `use_item`               | Consume items                                    |
| `equip_item`             | Assign to equipment slot                         |
| `unequip_item`           | Return to inventory                              |
| `get_inventory`          | Basic inventory list                             |
| `get_inventory_detailed` | Full item info, sorted                           |
| `transfer_currency`      | Transfer gold/silver/copper with auto-conversion |

### Combat & Encounters (7 tools)

| Tool                    | Description                         |
| ----------------------- | ----------------------------------- |
| `create_encounter`      | Initialize combat with participants |
| `get_encounter_state`   | Current combat status               |
| `load_encounter`        | Resume saved encounter              |
| `end_encounter`         | End combat, sync HP                 |
| `execute_combat_action` | Attack/heal/move/cast spell         |
| `advance_turn`          | Move to next in initiative          |
| `roll_death_save`       | D&D 5e death saving throws          |
| `execute_lair_action`   | Legendary creature lair actions     |

### Spellcasting (integrated with combat)

| Action       | Description                            |
| ------------ | -------------------------------------- |
| `cast_spell` | Cast known spell with slot consumption |

### Rest System (2 tools)

| Tool              | Description                          |
| ----------------- | ------------------------------------ |
| `take_long_rest`  | Restore all HP and spell slots       |
| `take_short_rest` | Hit dice healing, Warlock pact slots |

### Theft & Fence System (10 tools)

| Tool                              | Description                     |
| --------------------------------- | ------------------------------- |
| `steal_item`                      | Record theft with heat tracking |
| `check_item_stolen`               | Check if item is stolen         |
| `check_stolen_items_on_character` | List all stolen items held      |
| `check_item_recognition`          | NPC recognition check           |
| `sell_to_fence`                   | Sell stolen goods               |
| `register_fence`                  | Register NPC as fence           |
| `report_theft`                    | Report to guards (adds bounty)  |
| `advance_heat_decay`              | Process heat decay              |
| `get_fence`                       | Get fence details               |
| `list_fences`                     | List all fences                 |

### Corpse & Loot System (14 tools)

| Tool                        | Description                       |
| --------------------------- | --------------------------------- |
| `create_corpse`             | Create corpse from dead character |
| `get_corpse`                | Get corpse by ID                  |
| `get_corpse_by_character`   | Get by original character         |
| `get_corpse_inventory`      | Items on corpse                   |
| `list_corpses_in_encounter` | Corpses in combat                 |
| `list_corpses_nearby`       | Corpses near position             |
| `loot_corpse`               | Loot single item                  |
| `harvest_corpse`            | Harvest resources                 |
| `generate_loot`             | Generate from loot table          |
| `create_loot_table`         | Custom loot tables                |
| `get_loot_table`            | Get table by ID                   |
| `list_loot_tables`          | List all tables                   |
| `advance_corpse_decay`      | Process decay                     |
| `cleanup_corpses`           | Remove decayed corpses            |

### NPC Memory System (7 tools)

| Tool                         | Description                          |
| ---------------------------- | ------------------------------------ |
| `get_npc_relationship`       | Get relationship status              |
| `update_npc_relationship`    | Create/update relationship           |
| `record_conversation_memory` | Store conversation summary           |
| `get_conversation_history`   | Get memories with NPC                |
| `get_recent_interactions`    | Recent memories across NPCs          |
| `get_npc_context`            | Full context for LLM injection       |
| `interact_socially`          | PHASE-2: Spatial-aware conversations |

### Improvisation System (8 tools)

| Tool                       | Description                        |
| -------------------------- | ---------------------------------- |
| `resolve_improvised_stunt` | Rule of Cool resolution            |
| `apply_custom_effect`      | Apply boons/curses/transformations |
| `get_custom_effects`       | Get active effects                 |
| `remove_custom_effect`     | Remove effect                      |
| `process_effect_triggers`  | Fire effect triggers               |
| `advance_effect_durations` | Tick effect durations              |
| `attempt_arcane_synthesis` | Dynamic spell creation             |
| `get_synthesized_spells`   | Get mastered spells                |

### Quest System (8 tools)

| Tool                 | Description                  |
| -------------------- | ---------------------------- |
| `create_quest`       | Define quest with objectives |
| `get_quest`          | Single quest details         |
| `list_quests`        | All quests                   |
| `assign_quest`       | Give quest to character      |
| `update_objective`   | Increment progress           |
| `complete_objective` | Mark objective done          |
| `complete_quest`     | Complete entire quest        |
| `get_quest_log`      | Full quest objects           |

### Secrets System (9 tools)

| Tool                      | Description                        |
| ------------------------- | ---------------------------------- |
| `create_secret`           | Hidden info with reveal conditions |
| `get_secret`              | DM-only view                       |
| `list_secrets`            | All secrets for world              |
| `update_secret`           | Modify properties                  |
| `delete_secret`           | Remove secret                      |
| `reveal_secret`           | Show to player                     |
| `check_reveal_conditions` | Test if conditions met             |
| `get_secrets_for_context` | Format for LLM injection           |
| `check_for_leaks`         | Scan text for accidental reveals   |

### Party System (17 tools)

| Tool                        | Description                    |
| --------------------------- | ------------------------------ |
| `create_party`              | Create adventuring party       |
| `get_party`                 | Get party details              |
| `list_parties`              | All parties                    |
| `update_party`              | Modify party properties        |
| `delete_party`              | Remove party                   |
| `add_party_member`          | Add character to party         |
| `remove_party_member`       | Remove from party              |
| `update_party_member`       | Modify party member role       |
| `set_party_leader`          | Change leadership              |
| `set_active_character`      | Set active PC                  |
| `get_party_members`         | Get members with details       |
| `get_party_context`         | Party summary for LLM          |
| `get_unassigned_characters` | Characters not in a party      |
| `move_party`                | Move entire party on world map |
| `get_party_position`        | Party location                 |
| `get_parties_in_region`     | Parties in specific region     |

### Spatial Navigation (4 tools)

| Tool                     | Description                      |
| ------------------------ | -------------------------------- |
| `look_at_surroundings`   | Observe current location details |
| `generate_room_node`     | Create room in dungeon network   |
| `get_room_exits`         | List exits from current room     |
| `move_character_to_room` | Move character between rooms     |

### Math & Dice (5 tools)

| Tool                    | Description                                |
| ----------------------- | ------------------------------------------ |
| `dice_roll`             | Full D&D notation (2d6+3, 4d6dl1, adv/dis) |
| `probability_calculate` | Calculate odds                             |
| `algebra_solve`         | Solve equations                            |
| `algebra_simplify`      | Simplify expressions                       |
| `physics_projectile`    | Trajectory calculations                    |

### Grand Strategy (11 tools)

| Tool                  | Description                  |
| --------------------- | ---------------------------- |
| `create_nation`       | Create nation with resources |
| `get_nation_state`    | Private nation state         |
| `get_strategy_state`  | World with fog of war        |
| `propose_alliance`    | Diplomatic action            |
| `claim_region`        | Territorial claims           |
| `init_turn_state`     | Initialize turn management   |
| `get_turn_status`     | Check nation readiness       |
| `submit_turn_actions` | Batch action submission      |
| `mark_ready`          | Signal turn complete         |
| `resolve_turn`        | Process all actions          |
| `poll_turn_results`   | Get resolution results       |

---

## Use Cases

**Tabletop RPG Backend**
Run D&D, Pathfinder, or custom systems with AI dungeon masters and NPCs that have real bodies and spatial reasoning.

**Multi-Agent Simulation**
Test agent coordination, emergent behavior, or adversarial scenarios in a controlled, reproducible environment.

**Embodied AI Research**
Study how LLMs behave when constrained by physics, resources, and perception limits—not just text.

**Game Development**
Use as a headless game server with deterministic state, replay capability, and clean API boundaries.

**Training Data Generation**
Fork worlds, run thousands of parallel scenarios, collect structured action/outcome pairs.

---

## Design Principles

1. **LLMs propose, never execute**
   The brain suggests; the nervous system validates.

2. **All action is tool-mediated**
   No direct world mutation. Every change flows through MCP tools.

3. **Validation precedes observation**
   Act → Validate → Observe. The reflex arc pattern.

4. **Events trigger tasks**
   JIT execution. No polling, no stale state.

5. **Deterministic outcomes**
   Same inputs → same outputs. Always reproducible.

6. **Schema-driven everything**
   Zod validates all data at boundaries. Type safety end-to-end.

7. **Anti-hallucination by design**
   LLMs cannot cast spells they don't know or claim damage they didn't roll.

---

## Test Coverage

```bash
npm test
# 746 tests passing
# 85 test files
# Coverage across all major systems
```

Key test areas:

- Combat encounters and HP persistence
- Spellcasting validation (anti-hallucination)
- Inventory integrity and exploit prevention
- Theft/fence mechanics with heat decay
- Corpse/loot system with decay states
- NPC memory and relationship tracking
- Improvisation system (stunts, effects, synthesis)

---

## Contributing

Contributions welcome! Please:

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Write tests for new functionality
4. Follow existing code style (TypeScript + Zod + tests)
5. Submit a pull request

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

---

## Roadmap

- [x] Full spellcasting system with validation
- [x] Theft and fence economy
- [x] Corpse and loot mechanics
- [x] NPC memory and relationships
- [x] Improvisation engine
- [ ] WebSocket real-time subscriptions
- [ ] Dialogue tree system
- [ ] Cover mechanics in combat
- [ ] Quest chains with prerequisites
- [ ] Visual debugger / world inspector UI

---

## License

[ISC](LICENSE) — Use freely, attribution appreciated.

---

## Related

- [Model Context Protocol Specification](https://modelcontextprotocol.io)
- [Quest Keeper](https://github.com/Mnehmos/quest-keeper) — Browser-based AI dungeon master using this engine

---

## Documentation

- **[CLAUDE.md](CLAUDE.md)** - Development instructions
- **[docs/WHITE_PAPER.md](docs/WHITE_PAPER.md)** - Design philosophy and architecture
- **[docs/LLMSpatialGuide.md](docs/LLMSpatialGuide.md)** - LLM spatial navigation guide

---

<p align="center">
<em>"AI-native autonomic organisms capable of maintaining and improving themselves in complex environments"</em>
</p>
