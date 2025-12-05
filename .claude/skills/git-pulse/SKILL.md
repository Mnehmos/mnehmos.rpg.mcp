---
name: git-pulse
description: Version control discipline for Quest Keeper AI development. Enforces the "commit early, commit often" pattern. Use when working on code changes, managing branches, resolving merge conflicts, or maintaining development workflow. Triggers on mentions of git, commit, version control, merge, branch, or saving work.
---

# Git Pulse Protocol

## Core Rule
> Your work is volatile until captured. Manage entropy via Version Control.

**After successful test pass, IMMEDIATE LOCAL COMMIT.**
Do NOT ask permission. Just save the state.

## The Commit Loop
```
1. PRE-FLIGHT   Check git status
2. EXECUTE      Perform the edit/fix
3. VERIFY       Run test/build
4. CAPTURE      IF successful → IMMEDIATE COMMIT
```

## Quick Commands
```powershell
git status
git add . && git commit -m "type(scope): message"
```

## Commit Types
| Type | When to Use |
|------|-------------|
| `fix` | Bug fixes |
| `feat` | New features |
| `test` | Test additions/changes |
| `refactor` | Code cleanup |
| `docs` | Documentation only |

## Commit Format
```
type(scope): concise description

Examples:
fix(combat): resolve HP sync on encounter end
feat(quest): add prerequisite chain support
```