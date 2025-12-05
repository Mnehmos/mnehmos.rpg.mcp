---
name: tdd-playtest
description: Test-Driven Development combined with emergent playtesting for Quest Keeper AI. Use when running playtest sessions, writing tests, debugging game feel issues, or following the RED-GREEN-REFACTOR cycle. Triggers on mentions of testing, playtest, TDD, bug discovery, game feel, or "as a player".
---

# TDD + Playtesting Loop

## The Philosophy
> **We are the player.** Not a tester, not a developer. A player who wants to have fun.

Tests define what fun looks like. We build until the tests pass.

## The Loop
```
1. PLAY        Experience the game as a player
       ↓
2. DISCOVER    Find friction, confusion, missing features
       ↓
3. DEFINE      What SHOULD happen? (Player perspective)
       ↓
4. RED         Write test that fails (feature doesn't exist)
       ↓
5. GREEN       Write minimal code to pass test
       ↓
6. REFACTOR    Clean up without breaking test
       ↓
7. PLAY AGAIN  Does it feel right now?
```

## Discovery Entry Format
Add to `Agents/EMERGENT_DISCOVERY_LOG.md`:
```markdown
### [CATEGORY-###] Title
**Severity:** CRITICAL | HIGH | MEDIUM | LOW
**Status:** OPEN | IN_PROGRESS | RESOLVED

**Player Experience:**
What did the player try? What happened? What should have happened?
```

## Severity Guide
- **CRITICAL**: Game unplayable
- **HIGH**: Game playable but broken
- **MEDIUM**: Immersion/balance issues
- **LOW**: Polish/enhancement

## Running Tests
```powershell
cd C:\Users\mnehm\AppData\Roaming\Roo-Code\MCP\rpg-mcp
npm test
```