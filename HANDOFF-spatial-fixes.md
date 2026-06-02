# /handoff — spatial_manage tool surface fixes

**Repo:** `f:/Github/mnehmos.rpg.mcp` · **Branch:** `main` · **Test:** `npm test` · Push authorized.

## Mission

Close 5 findings in `spatial_manage`. All surgical. Trace MCP pass + manual review already confirmed root causes with file:line. No architecture changes — align the tool surface with the schema/repo and fix dishonest responses.

## Findings

### 1. HIGH — `update` action suggested but does not exist
- `src/engine/perception/blind-spot-detector.ts:69` cites `spatial_manage action:"update"`.
- Confirmed: `src/server/consolidated/spatial-manage.ts:138` exposes only `look | generate | get_exits | move | list`.
- **Fix (pick one):**
  - (a) **Recommended.** Add `update` action: `{roomId, name?, baseDescription?, atmospherics?, biomeContext?}` partial update. The blind-spot suggestion becomes callable.
  - (b) Rewrite the blind-spot suggestion to point at an action that exists.

### 2. HIGH — networks and local coords exist but not exposed
- Schema: `src/schema/spatial.ts:97` defines `networkId, localX, localY, NodeNetwork`.
- Repo: `src/storage/repos/spatial.repo.ts:212` has methods.
- Tool: `src/server/consolidated/spatial-manage.ts:196` `SpatialManageTool.inputSchema` omits them.
- **Fix:** Extend `GenerateSchema` + `MoveSchema` to accept optional `networkId, localX, localY`. Add actions `network_create | network_list | network_get` for `NodeNetwork`.

### 3. MEDIUM — `get_exits` / `look` drop travel metadata
- Schema: `src/schema/spatial.ts:37` defines `travelTime, terrain, difficulty` on exits.
- Handler: `src/server/handlers/spatial-handlers.ts:400` returns only `direction/type/DC/description`.
- **Fix:** Include `travelTime, terrain, difficulty` in response. Update tests.

### 4. MEDIUM — `generate` falsely reports `linkedToPrevious: true`
- `src/server/handlers/spatial-handlers.ts:334` and `:358` check only whether `previousNodeId` was supplied — NOT whether `addExit` ran.
- **Fix:** Capture the result of `addExit`; set `linkedToPrevious` only if the exit was actually created. Regression test: invalid `previousNodeId` UUID → `linkedToPrevious: false` (or error envelope) — never `true`.

### 5. LOW — README out of date
- `README.md:153` lists `generate_room` and `list_rooms`.
- Actual actions are `generate` and `list` (`spatial-manage.ts:144`). Not aliases.
- **Fix:** Update README to `generate` / `list`. Don't add aliases (namespace bloat).

## Discipline

- **TDD.** RED tests first, then minimal GREEN, then refactor.
- Test files: `tests/server/consolidated/spatial-manage-*.test.ts`, `tests/server/handlers/spatial-handlers-*.test.ts`.
- **DO NOT** add `import { describe, it, expect } from 'vitest'` — silently breaks test collection on Windows + vitest 1.6.1 + `globals: true`. Use vitest globals.
- Stage planned files only (no `git add -A`).
- Full suite `npm test` must be GREEN after each phase. Current baseline ~2270/0/7.

## Commits

Conventional format, push to `origin/main` after each. Either one commit per finding or one bundled commit titled:

```
fix(spatial): close 5 tool-surface findings — update action, network exposure, travel metadata, linkedToPrevious honesty, README sync
```

## Don'ts

- No `*-pro` OpenAI models if you invoke any (project axiom).
- No refactoring beyond the 5 findings.
- No new dependencies.
- Don't touch `src/schema/spatial.ts` or the repo beyond what each fix strictly requires.

## Verify

```bash
npm test                                # green, 0 failing
git log --oneline -5                    # your commits visible
git status                              # clean working tree
```

Done.
