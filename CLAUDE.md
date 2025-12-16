# RPG-MCP - Claude Code Instructions

## This Repository

The backend game engine for Quest Keeper AI. **135 MCP tools** for complete RPG mechanics.
**Philosophy:** "LLM describes, engine validates" - Database is source of truth.
**Status:** Alpha (90% complete) - 746 tests passing, 85 test files, MCP Protocol fully integrated

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
├── api/          # MCP tool definitions (registry.ts is the hub)
├── engine/
│   ├── combat/   # Encounters, initiative, damage
│   ├── spatial/  # Grid, collision, movement
│   ├── worldgen/ # Procedural generation
│   └── strategy/ # Nation simulation
├── storage/      # SQLite schemas & CRUD
└── schema/       # Zod validation

tests/            # Mirror of src/ structure
docs/             # White paper & LLM spatial guide
reference/        # Third-party references (Azgaar licensing)
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

## Deploy to Frontend

After building binaries:

```powershell
copy dist-bundle\rpg-mcp-win.exe "C:\Users\mnehm\Desktop\Quest Keeper AI attempt 2\src-tauri\binaries\rpg-mcp-server-x86_64-pc-windows-msvc.exe"
```
