# RPG-MCP - Claude Code Instructions

## This Repository
The backend game engine for Quest Keeper AI. 80+ MCP tools for RPG mechanics.
**Philosophy:** "LLM describes, engine validates" - Database is source of truth.

## ⚠️ FIRST: Read Agents/README.md
Before ANY work, review the Agents/ folder for context and known issues.

## Key Commands
```bash
npm test                          # Run all tests (Vitest)
npm test -- tests/specific.test.ts   # Single test file
npm test -- --watch               # Watch mode
npm run build                     # Compile TypeScript
npm run build:binaries            # Create Windows executable
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
Agents/           # Development docs & playtest logs
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
1. Find issue in Agents/EMERGENT_DISCOVERY_LOG.md
2. Write failing test (RED)
3. Implement fix (GREEN)
4. Refactor if needed
5. Commit
6. Update issue status to RESOLVED

## Deploy to Frontend
After building binaries:
```powershell
copy dist-bundle\rpg-mcp-win.exe "C:\Users\mnehm\Desktop\Quest Keeper AI attempt 2\src-tauri\binaries\rpg-mcp-server-x86_64-pc-windows-msvc.exe"
```
