# RPG-MCP - Claude Code Instructions

## This Repository

The reference backend game engine. **35 MCP tools** (31 consolidated action-routed + 4 meta/event) for complete RPG mechanics, including LLM-driven NPCs via `agent_manage` and the Operator's constraint-perception lens via `perception_manage`.
**Philosophy:** "LLM describes, engine validates" - Database is source of truth.
**Status:** Alpha - 2216 tests passing (7 skipped), 141 test files, MCP Protocol fully integrated

## Who consumes this engine

`rpg-mcp-live` (repo `Mnehmos/rpg-mcp-live`, local checkout `F:\Github\rpg mcp live`) is the hosted web product and the **only** active consumer. It calls this engine **over HTTP** — see its `src/reference-engine-client.ts` and `REFERENCE_ENGINE_URL`. It is not a submodule and does not vendor this code, so the two repos are deployed separately and share no build step. Changing a tool's contract here is a breaking change for that service.

The Tauri desktop app (`mnehmos.quest-keeper.game`, "Lantern") still declares this engine as an `externalBin` sidecar, but it is **deprecated and unused** — do not treat its build or deploy steps as live.

## Bastion subsystems

Layer-1 SubsystemDefs live in `data/subsystems/`. The first installed is the Operator's `constraint-perception` (Hierarchy of Controls as engine primitive) — the first ceremony, the first DLC, the first page of Biography #1, the first build, all the same act.

## Key Commands

```bash
npm test                          # Run all tests (Vitest)
npm test -- tests/specific.test.ts   # Single test file
npm test -- --watch               # Watch mode
npm run build                     # Compile TypeScript
npm run build:binaries            # Create standalone executables
```

## Key Directories

```
src/
├── server/
│   ├── consolidated/  # 31 action-routed tool handlers (index.ts = registry)
│   ├── handlers/      # Extracted handler implementations (combat, spatial)
│   ├── index.ts       # MCP server entry + transport setup
│   └── meta-tools.ts  # search_tools, load_tool_schema
├── engine/
│   ├── combat/   # Encounters, initiative, damage
│   ├── magic/    # Spells, concentration, scrolls, auras
│   ├── spatial/  # Grid, collision, movement
│   ├── worldgen/ # Procedural generation
│   └── strategy/ # Nation simulation
├── agent/        # LLM-driven NPC runtime
│   ├── provider/ # OpenAI + OpenRouter via native fetch
│   ├── prompt/   # Modular slices + composer
│   ├── runtime/  # invoke + preflight + circuit + auto-on-turn hook
│   └── audit/    # Replay
├── storage/      # SQLite repos & migrations
├── schema/       # Zod validation (29 schemas, incl. schema/agent.ts)
├── utils/        # Action router, fuzzy matching
└── math/         # Dice, algebra, physics

tests/            # Mirror of src/ structure (141 files)
docs/             # White paper, ADRs, LLM spatial guide
```

## Git Commit Convention

```
fix(component): description   # Bug fixes
feat(component): description  # New features
test(component): description  # Test additions
refactor(component): description  # Code cleanup
```

## The Git Pulse Rule

**After successful test pass, immediately commit:**

```bash
git add . && git commit -m "type(scope): message"
```

Do NOT ask permission for local commits. Just save the state.

## TDD Loop

1. Write failing test (RED)
2. Implement fix (GREEN)
3. Refactor if needed
4. Commit
5. Repeat

## Shell note

`bash` in this environment fails on startup (`fnm env` is not evaluated in the shell profile). Use **PowerShell** for git and npm work; the Bash tool errors out before running the command.

## Deploy

This engine deploys as its own service and is reached over HTTP by `rpg-mcp-live`. There is no copy-a-binary-into-the-frontend step anymore.

`npm run build:binaries` still produces standalone executables in `dist-bundle/` for local and MCP-client use. The old instruction to copy `rpg-mcp-win.exe` into the Quest Keeper Tauri app's `src-tauri/binaries/` is **obsolete** — that desktop app is deprecated and its target directory no longer exists.
