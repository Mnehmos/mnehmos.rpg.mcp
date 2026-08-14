# Cloud Migration Plan — Railway, OAuth, Multi-User, Web VTT

**Status:** Proposed
**Date:** 2026-07-25
**Supersedes:** nothing. **Extends:** [ADR-005](ADR-005-unified-ownership-architecture.md), [EXECUTION-PRIORITIES-unified-ownership.md](EXECUTION-PRIORITIES-unified-ownership.md)

---

## 0. Premise

ADR-005 already ratified the architecture this migration needs: contract-first tools, MCP
as *one adapter* rather than the core, explicit request-scoped context, and a
handler → domain facade → repository boundary. It was written for maintainability.
It turns out to be the exact prerequisite for multi-tenancy.

This plan does not propose a new architecture. It schedules ADR-005's implementation,
adds the three things ADR-005 did not cover (identity, Postgres, HTTP transport), and
sequences a web VTT on top.

### Locked decisions

| Fork | Decision |
|---|---|
| Browser ↔ engine | REST + WebSocket gateway over the engine-as-library; MCP retained as a second adapter over the same core |
| Storage | Postgres |
| Frontend | Full VTT — grid, tokens, fog of war |
| LLM cost | Free tier on a platform key + BYOK to lift the cap |

### Baseline (verified 2026-07-25)

- 63,256 LOC across 204 source files; 146 test files; **2,316 passing / 7 skipped / 0 failing**
- 34 MCP tools (30 consolidated action-routed + 4 meta/event)
- 30 repositories, **294 repository methods**, **347 `prepare()` call sites**, only **35 SQLite-specific SQL constructs**
- **109 `getDb()` call sites** reached through **19 near-duplicate local `ensureDb()` helpers**
- Node pinned to 20.18.1 by native `better-sqlite3` ABI

---

## 1. Tenancy model

The current schema has no owner anywhere. `SessionContext.userId` exists at
[types.ts:5](../src/server/types.ts#L5) and is never populated — `withSession` only sets
`sessionId`, defaulting to the literal string `'default'`.

**Decision: the tenancy boundary is a `campaign`, not a user.** Scoping every table by
`user_id` would scatter the check across 30 repositories and make shared play impossible
later. A campaign owns a world and everything under it; a user owns campaigns. One FK to
check, and multiplayer is an additive change rather than a rewrite.

```
users ──< identities            (one account, N linked OAuth providers)
      └─< campaigns ──< campaign_members
                    └─< worlds, characters, parties, quests, items,
                        secrets, narrative_notes, nations
                          └─ everything else inherits via existing FKs
```

### New tables

```sql
users (
  id, email, display_name, avatar_url,
  token_quota, tokens_used,           -- free-tier ledger (Phase 5)
  provider_key_encrypted,             -- BYOK, AES-256-GCM (Phase 5)
  created_at, updated_at
)

identities (                          -- separate table, deliberately
  id, user_id, provider, provider_user_id, email_at_provider, created_at,
  UNIQUE(provider, provider_user_id)
)

campaigns (
  id, owner_user_id, name, description, created_at, updated_at, last_played_at
)

campaign_members (
  campaign_id, user_id, role,         -- 'dm' | 'player' | 'spectator'
  PRIMARY KEY (campaign_id, user_id)
)
```

`identities` is a separate table on purpose: a user who signs in with GitHub on Monday
and Google on Tuesday must land in **one** account. Link on *verified* email only —
linking on an unverified provider email is an account-takeover vector.

### Root aggregates gaining `campaign_id`

`worlds`, `characters`, `parties`, `quests`, `items`, `secrets`, `narrative_notes`,
`nations`. Every other table already reaches one of these by foreign key and needs no
column. `agents` inherits through `characters`.

Scope enforcement lives in the **facade layer**, not in handlers and not in repositories.
Repositories take `campaignId` as an explicit parameter; there is no ambient default.

---

## 2. Phases

Phase 0 is decision-independent and on the critical path for everything else. It can start
immediately.

### Phase 0 — Tenancy and facades · ~2–3 weeks

Implements ADR-005 items 3 and 4, plus identity tables.

1. **Versioned migration runner.** Replace the single 1,109-line idempotent
   `CREATE TABLE IF NOT EXISTS` block in [migrations.ts](../src/storage/migrations.ts)
   with numbered, tracked, forward-only migrations. Idempotent-create is fine against a
   local file you can delete; it is not safe against a shared production database where
   you need to know what ran.
2. **Identity + campaign tables** per §1, with a data migration that folds all existing
   local rows into a single bootstrap campaign so no dev data is lost.
3. **`campaign_id` on the eight root aggregates**, `NOT NULL` after backfill, indexed.
4. **`RequestContext` replaces `SessionContext`** — `{ userId, campaignId, requestId }`,
   threaded through function signatures. ADR-005 item 3 forbids module-scoped mutable
   context; this is that change.
5. **Domain facades** for combat, world, character, party, inventory, quest, agent.
   Handlers orchestrate I/O only.
6. **Delete the 19 `ensureDb()` copies.** They are not merely duplicated — they diverge:
   `ensureDb()` reads `RPG_DATA_DIR` while `getDbPath()` reads `RPG_MCP_DB_PATH`, and
   which one wins depends on call order because `getDb()` memoizes on first call. Replace
   with a db handle injected through `RequestContext`.

**Exit criteria.** An isolation test that creates two campaigns with identically-named
characters, runs combat in both concurrently, and asserts zero cross-read. Full suite
still green. No `getDb()` call outside the storage layer.

### Phase 1 — Postgres · ~3–4 weeks

The largest single chunk, and the reason it comes after facades: facades give you a seam
to convert behind, repository by repository, without touching 30 handlers.

- **Driver: plain `pg` with raw SQL.** With 347 existing `prepare()` sites, an ORM or
  query builder would mean rewriting every statement. Raw `pg` keeps the diff to
  placeholder conversion (`?` → `$1`) and `await`. Only 35 sites use SQLite-specific
  constructs (`INSERT OR REPLACE`, `AUTOINCREMENT`, `json_extract`, pragmas) and need real
  translation.
- **The sync → async conversion is viral.** All 294 repository methods become `async`,
  which propagates up through facades to handlers. Mechanical, tedious, and the main
  source of schedule risk. Convert one repository at a time with its tests, never in bulk.
- **`better-sqlite3` disappears**, and with it the Node 20 ABI pin that currently breaks
  the entire test suite on Node 22 with `ERR_DLOPEN_FAILED`. This also removes the
  synchronous-query event-loop blocking that would otherwise let one user's worldgen stall
  every other user on the instance.
- **In-memory state moves out.** `CombatManager` and `WorldManager`
  ([combat-manager.ts:82](../src/server/state/combat-manager.ts#L82)) are module singletons
  holding `Map`s that die on redeploy and cannot be shared across replicas. They are
  already keyed `${sessionId}:${encounterId}`, so the key shape survives — re-key to
  `${campaignId}:${encounterId}` and back them with Redis.
- Tests run against ephemeral Postgres (testcontainers or a Railway dev database), not
  `:memory:`.

**Exit criteria.** Full suite green against Postgres. No `better-sqlite3` in the
dependency tree. p95 tool latency within 10% of the SQLite baseline (ADR-005's stated bar).

### Phase 2 — Auth and HTTP transport · ~2 weeks

- **OAuth for GitHub and Google.** Authorization Code + PKCE. Account linking strictly on
  verified email.
- **Two credential shapes over one session store.** The web app gets an httpOnly,
  `SameSite=Lax`, Secure session cookie. MCP clients get bearer tokens. Both resolve to
  the same `RequestContext`.
- **Retire `RPG_MCP_TRANSPORT_TOKEN`** — one shared secret for all clients, with no
  identity, expiry, or revocation, cannot survive contact with real users.
- **REST + WebSocket gateway** — the primary surface for the frontend, generated from the
  ADR-005 tool contracts so it cannot drift from the MCP adapter.
- **MCP adapter over Streamable HTTP.** The SDK you already depend on ships
  `server/streamableHttp.js` and a complete OAuth server under `server/auth/`
  (authorize / token / register / revoke handlers) — currently unused. Wire the MCP
  endpoint as an OAuth *resource server* validating the same tokens.
- **One `McpServer` instance per session.** Today
  [websocket.ts](../src/server/transport/websocket.ts) accepts N clients but is a single
  `Transport` bound to a single `McpServer`, routing replies by JSON-RPC id — two
  concurrent players share one session and can collide on request ids. Correct for one
  desktop app, wrong for multi-user.

**Exit criteria.** Sign in with both providers; both land in one account when the verified
email matches. A second user cannot read the first user's campaign through REST *or* MCP.

### Phase 3 — Railway · ~1 week

- Services: **api** (web-facing), **Postgres**, **Redis** (sessions, combat state, pub/sub fan-out).
- Dockerfile on a pinned Node base. Post-Phase-1 there is no native module, so the version
  pin is hygiene rather than a hard constraint.
- **Migrations run as a release step, not on boot** — N replicas booting concurrently must
  not race the migration runner.
- Health check endpoint; secrets as Railway environment variables; `/metrics` for latency
  and per-user token burn.
- Staging environment sharing the pipeline. Do not test migrations first in production.

**Exit criteria.** Push to `main` deploys. Redeploy mid-combat does not lose encounter
state (it is in Redis/Postgres, not process memory).

### Phase 4 — VTT frontend · ~4–6 weeks

The engine is well-positioned here. [combat-grid.ts](../src/engine/spatial/combat-grid.ts)
already provides bounds and position validation, obstacle and difficult-terrain sets,
diagonal and terrain movement cost, AoE resolution, size-category tile occupancy, and
`hasLineOfSight()` at line 684 — which is what fog of war derives from. The spatial work
is largely done; this phase is rendering and state sync.

- **Stack:** React + Vite + TypeScript, TanStack Query for server state, Zustand for local
  UI state, **PixiJS** for the grid canvas (WebGL — token counts and fog masks get
  expensive fast in SVG/DOM).
- **Screens:** campaign picker → VTT (grid canvas, initiative tracker, narrative log,
  character sheet, inventory, dice tray).
- **Realtime:** one WebSocket channel per campaign. [PubSub](../src/engine/pubsub.ts)
  already exists and already emits engine events — bridge it to the socket rather than
  inventing a new event bus.
- **Optimistic UI with server authority.** Render the move immediately, reconcile against
  the engine's validation result. This is the existing "LLM describes, engine validates"
  philosophy applied to the client: the client *proposes*, the engine *decides*.

**Exit criteria.** A full combat encounter — initiative through resolution — played
end-to-end in the browser by two users in the same campaign.

### Phase 5 — LLM metering and BYOK · ~1–2 weeks

- **Free tier.** `users.token_quota` / `tokens_used`, rolled up from the existing
  `agent_calls` table. The preflight gate at
  [preflight.ts](../src/agent/runtime/preflight.ts) already returns a synthetic
  `budget_exhausted` result without spending tokens — extend it from per-agent to
  per-user. Per-agent `budget_tokens` and `tokens_used` already exist on the `agents` table.
- **BYOK.** Per-user provider key, AES-256-GCM at rest, decrypted per request, never
  logged and never returned by any endpoint. `ProviderFactory` becomes per-request instead
  of the process-global singleton constructed once at
  [index.ts:132](../src/server/index.ts#L132).

**Exit criteria.** A user on the free tier hits the cap and gets a clean refusal rather
than a bill. A BYOK user's key never appears in logs, responses, or audit rows.

---

## 3. Critical path and risk

```
Phase 0 (tenancy+facades) ──> Phase 1 (Postgres) ──> Phase 2 (auth+HTTP) ──> Phase 3 (Railway)
                                                                                  │
                          Phase 4 (VTT) can start against Phase 2 staging ────────┘
                          Phase 5 (billing) is independent after Phase 2
```

Roughly 12–17 weeks of focused work to full launch. Phase 4 parallelizes against a staging
API once Phase 2 lands, which is the main schedule lever.

| Risk | Mitigation |
|---|---|
| **Sync → async conversion across 294 methods** — the single largest source of overrun | Convert one repository at a time behind its facade, with its tests. Never bulk-convert. |
| **Phase 0 scope creep into a full ADR-005 contract rewrite** | Phase 0 needs only ADR-005 items 3 and 4 (context + facades). Contract generation (items 1, 2, 6) is valuable but is *not* on the hosting critical path — defer it. |
| **Fog of war performance** with many tokens and large maps | `hasLineOfSight()` is per-pair; cache per token per turn and invalidate on movement. Budget a spike before committing to the render approach. |
| **OAuth account-linking takeover** via unverified provider email | Link on verified email only; require re-auth to link a second provider. |
| **Migration runner racing across replicas** | Release-step migrations, never on boot. |
| **Free-tier cost blowout** before metering ships | Phase 5 is independent of Phase 4 — ship metering *before* public signup, not before the VTT. |

---

## 4. Work that is explicitly out of scope

- ADR-005 contract generators and the docs/registry pipeline (items 1, 2, 6). Worth doing;
  not required to host.
- Legacy tool surface removal (ADR-004 compatibility mode).
- Horizontal scaling beyond a small replica count — the architecture permits it after
  Phase 1, but tuning it is not launch work.
