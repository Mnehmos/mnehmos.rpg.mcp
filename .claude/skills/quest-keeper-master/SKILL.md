---
name: quest-keeper-master
description: Master orchestration skill for Quest Keeper AI development. Use when working on ANY part of Quest Keeper AI - coordinates between frontend (Tauri/React), backend (rpg-mcp), and documentation. Triggers on any mention of Quest Keeper, rpg-mcp, game development for this project, or when referencing the Agents/ folder.
---

# Quest Keeper Master Orchestration

## ⚠️ FIRST REQUIREMENT
Before ANY work, review the Agents/ folder in the target repository:
- Backend: `C:\Users\mnehm\AppData\Roaming\Roo-Code\MCP\rpg-mcp\Agents\`
- Frontend: `C:\Users\mnehm\Desktop\Quest Keeper AI attempt 2\Agents\`

Read `README.md` first, then `EMERGENT_DISCOVERY_LOG.md` for current issues.

## Repository Trinity
```
THE HANDS (Tools):   C:\Users\mnehm\AppData\Roaming\Roo-Code\MCP\Yolo-Mode-MCP
THE PHYSICS (Engine): C:\Users\mnehm\AppData\Roaming\Roo-Code\MCP\rpg-mcp
THE FLIGHT (Game):    C:\Users\mnehm\Desktop\Quest Keeper AI attempt 2
THE LIBRARY (Docs):   C:\Users\mnehm\Documents\Quest Keeper pdfs
```

## Core Philosophy: Mechanical Honesty
```
LLM describes → MCP validates → DB stores (source of truth)
```
The AI cannot hallucinate game state because it can only READ from and WRITE through validated MCP tools.

## Quick Commands
```powershell
# Backend
cd "C:\Users\mnehm\AppData\Roaming\Roo-Code\MCP\rpg-mcp"
npm test              # Run tests
npm run build:binaries # Create Windows exe

# Deploy to frontend
copy dist-bundle\rpg-mcp-win.exe "C:\Users\mnehm\Desktop\Quest Keeper AI attempt 2\src-tauri\binaries\rpg-mcp-server-x86_64-pc-windows-msvc.exe"

# Frontend
cd "C:\Users\mnehm\Desktop\Quest Keeper AI attempt 2"
npm run tauri dev     # Development mode
```

## Git Pulse (MANDATORY)
After successful test pass, immediate local commit:
```bash
git add . && git commit -m "type(scope): message"
```
Types: `fix`, `feat`, `test`, `refactor`, `docs`
Do NOT ask permission. Just save the state.

## TDD Loop
1. Find issue in `Agents/EMERGENT_DISCOVERY_LOG.md`
2. Write failing test (RED)
3. Implement fix (GREEN)
4. Commit
5. Update issue status to RESOLVED

## Current Priority Issues
Check `Agents/EMERGENT_DISCOVERY_LOG.md` for:
- [CRIT-001] HP Desynchronization After Combat
- [CRIT-002] Spell Slots Never Recover
- [CRIT-003] Spatial Collision Not Enforced
- [HIGH-001] Quest System Returns UUIDs Not Objects

## When to Use Other Skills
- Backend MCP work → See `rpg-mcp-backend` skill
- Frontend React/Tauri work → See `quest-keeper-frontend` skill
- Running playtest sessions → See `tdd-playtest` skill
- Git workflow questions → See `git-pulse` skill
