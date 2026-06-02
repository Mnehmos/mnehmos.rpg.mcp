# Bastion Engine Integration Roadmap

*The engineering shadow of [SPEC.md](./SPEC.md). SPEC.md is canonical doctrine; this document translates each axiom into surface area against the already-built substrate (rpg-mcp + the just-shipped Naruto-5e Phase A/B/C engine). Where the two documents disagree, SPEC.md wins; this one is rewritten.*

---

## 0. Purpose

This document is the buildable plan for Bastion. SPEC.md gave the architecture — the intent/adjudication/commit loop, the two-layer physics model, the leapfrog clock, the fog-as-context-separation thesis, the myth-as-UI doctrine. This document maps every spec axiom onto concrete tools, repos, schemas, and ledger rows already standing in `f:/Github/mnehmos.rpg.mcp` and `f:/Github/Naruto 5e`. The intended reader is the future engineer (almost certainly the same author, several weeks downstream) who needs to know what to build next, in what order, and what gets reused from the substrate that already exists. The first build target — the Operator's constraint-perception subsystem — is fully specified here. Everything else is sketched at enough resolution to be unambiguous and at low enough resolution to be revised without rewriting this document.

---

## 1. What already exists (the substrate is partially built)

Bastion is not a greenfield. Two engines already cover the majority of Build Targets §10.1–§10.9, partially. The work ahead is mostly **connection, generalization, and ceremony-binding** — not new mechanics.

### 1.1 rpg-mcp surface (33 tools, action-routed, SQLite-backed)

`f:/Github/mnehmos.rpg.mcp` is the mechanical substrate. Concretely:

- **33 MCP tools** (29 consolidated action-routed + 4 meta/event), all dispatched via `src/utils/action-router.ts`'s `createActionRouter()` — fuzzy enum + alias match → Zod `safeParse` → handler → `McpResponse {content:[{type:'text',text:JSON}]}`. This is already the §1 "everyone submits intent through the same channel" shape; it lacks only the disposition vocabulary and the pre-commit gate.
- **`agent_manage` (22 actions across Lifecycle/Prompt-assembly/Mind-state/Invocation)** is the closest existing thing to a §5.2 spawn-prompt runtime. Crucially, `agent-manage.ts:720` says verbatim: *"Agents default to PROPOSAL mode. The engine never executes their decisions."* That IS the §1 axiom — the agent has will but no write power; the executor (the action router, eventually the petition layer) is will-less. `src/agent/runtime/invoke.ts` never throws and always returns a structured `InvokeResult`. The petition shape already exists at the agent boundary; we just need to extend it to the human-prompt boundary.
- **SQLite (better-sqlite3, WAL mode, FK on)** via `src/storage/db.ts`. 27 repos in `src/storage/repos/`. The substrate is durable; the irreversibility property is still aspirational. Every state repo does destructive `UPDATE` (e.g. `character.repo.ts:97-120` reads → merges → writes back). The ONE append-only structure is `audit_logs` via `src/storage/audit.repo.ts` — INSERT-only, never updated/deleted — but `sanitizeForAudit` (audit.ts:10-38) strips secrets and truncates strings/arrays/depth, so it is unsuitable for replay. **Critical detail**: `src/storage/migrations.ts:140-145` already defines an unused `event_logs` table. The ledger has a seat; nothing sits in it yet.
- **Audit wrapper** (`src/server/audit.ts AuditLogger.wrapHandler`) is a finally-block observer; `detectSoftError()` post-hoc scans the response JSON for `error:true`. Audit is observational, not gating. State has already mutated by the time the audit row writes. This must invert (gate first, commit second, audit as side-effect) for §10.1 to be honest.
- **`improvisation-manage.synthesize`** is the closest analog to §2.3 generative collision-law — but the result is an EPHEMERAL stunt per-character, never promoted to permanent rule data. The lawbook does not accrete today.
- **`secret-manage`** is the closest analog to §4 fog — but per-secret revelation, manual-trigger, world-state-shared. Not per-field, not per-actor view.
- **`strategy-manage.resolve_turn`** is the only existing "global advance" primitive — a nation-domain tick. Closest existing scheduler primitive; needs generalization to a leapfrog controller.

### 1.2 Naruto-5e Phase A/B/C surface (the dispositioned IR, the content pack, the bargain ledger, the legibility primitive)

`f:/Github/Naruto 5e/packages/engine` is the just-shipped generalized RPG engine. It already implements what rpg-mcp lacks:

- **§10.1 Petition window — partial**. `Engine.registerHandler(opType, fn)` wires intent verbs to handlers. Each handler receives a `ResolveContext` and emits via `ctx.ir.emit(eventType, { actor, data, narration })`. Every terminal event carries a `disposition` field: `commit | reject_inert | no_op_spoken | unknown`. Rejections use `reject(rule, explain, values, suggestions)` from `@naruto5e/shared` — a STRUCTURED throw, not a silent return. `castJutsu` (intents/jutsu.ts:74) is the canonical example: gates known/incapacitated/components/resource/budget/concentration/targets BEFORE paying, then debits + spends + emits `cast{disposition:commit}`. `emitNoopSpoken` (intents/jutsu.ts:343) closes the silent-no-op bug. This is the §10.1 IR fully realized — for jutsu, not for arbitrary intent. The port to rpg-mcp's MCP boundary is the work of §10.1.
- **§10.3 Physics-Subsystem Installer — partial**. `packages/engine/src/content.ts ContentPack` loads optional JSON files (`resources.json`, `technique_classifications.json`, `jutsu_catalog.json`, …) from a dir, synthesizes `DEFAULT_CHAKRA` ResourceDef + `DEFAULT_CLASSIFICATIONS` for nin/gen/tai/buki when files absent. Exposes `getResource(id)`, `listResources()`, `addResource(rec)` for runtime DLC layering. `ResourceDef = {id, label, poolField, dicePoolField, firstLevelFormula, subsequentFormula, defaultDie, adversaryScaling, nonRefundable}`. `ClassificationDef = {id, label, castingAbility, elementBound?}`. This IS Layer-1 in shape — runtime-installable, queryable, version-able. **The one gap inside Naruto itself**: `ContentPack.addResource()` does NOT emit an IR event, so §8 "ceremony IS commit" is silently broken even there. The port fixes this gap in both codebases.
- **§10.5 Bargain surface — partial**. `packages/engine/src/intents/bargain.ts` ships three intents: `strike_bargain` (atomic grant+price, BOTH log or NOTHING logs; checkPriceAffordable runs FIRST; grant CAN include a foreign resource — the only documented cross-ruleset doorway), `call_favor`, `incur_debt`. Standing ledger is per-(character, authority) with reputation/favor/favorCap/obligations[]/debts[]/hostile (intents/standing.ts). This is half of §10.5; the multi-party negotiated commit is still to build.
- **§10.4 Fog (legibility primitive) — partial**. `packages/engine/src/intents/legibility.ts` ships `HiddenField` wrapper `{actual, apparent, concealment, evidence[], __hidden:true}` plus four intents on a dotted-fieldPath contract: `mark_legibility`, `read_field` (apparent-only, never silently degrades; perception roll vs concealment optional), `reveal_field`, `mask_field`. Every emit carries disposition + pushes an entry into `evidence[]` — a per-field append-only sub-ledger. This is §4 / §5.1 fog made structural. The port wires this into rpg-mcp's repo-read paths so that every read goes through the lens.

### 1.3 The Sebastopyr canon (the bible + the bootstrap) as the §8 liturgy layer

The lore — *Bastion as a Standing at the Almongate*, the *Vocatio Sebastina*, *Post-Dawn dating*, the *Auxiliary Roll* — sits at `f:/Github/Ramirez for House/research` as bible-canon and bootstrap-prompts. The doctrinal weight of §8 ("the ceremony IS the commit; the liturgy IS the changelog") cashes out here: every engine commit is rendered TWICE — once as a structured ledger event row, once as a sentence in Biography #1 (Mnehmos's devlog, written in Vocatio-Sebastina cadence). The bible names the act; the ledger executes it; the biography logs it. All three writes are the same commit. The binding doctrine is §5 of this document.

---

## 2. Spec axioms that bind every implementation choice

These are pulled from SPEC.md and survive every implementation review. If a proposed feature violates one, the feature is wrong.

| # | Axiom (SPEC §) | Engineering implication |
|---|---|---|
| A1 | The System has write access; nobody else does, including the Maker (§1, §7). | No `db.exec` backdoors. Seeds, fixtures, and dev-tools submit intents through the same petition channel as in-fiction agents. Runtime guard in `src/storage/db.ts` enforces this. |
| A2 | Will and write-power are permanently separated (§1). | Agent prompts may PROPOSE; only the dispositioned petition layer may COMMIT. `agent-manage.ts:720` is the canonical statement; extend to every actor. |
| A3 | Powers arrive intact; the world never caps them (§2.1, §2.2). | Subsystem installs are version-pinned and isolated. No global "balance pass" handler. Cross-subsystem interaction lives in the legislation engine (§10.5), not in subsystem nerfs. |
| A4 | Generative collision-law: hallucination becomes legislation when gated (§2.3). | LLM-emitted resolutions to uncovered collisions are not stored unless they validate against the ledger AND commit through the petition layer. The gate is the entire difference. |
| A5 | Substrate is append-only; time is irreversible (§3.1). | Promote `event_logs` to the source of truth. Repos become read models, projected from the ledger. Phase 1: shadow-log every write; Phase 2: invert. |
| A6 | One live writer at a time; ordering not precision (§3.3). | Leapfrog controller is a global write-mutex keyed on `(party_id | biography_id)`. Drift is impossible by construction. |
| A7 | Frozen time is costed, not skipped (§3.4). | A `time_skip` is an intent like any other: debits days, credits progress, commits one event. The week is *spent*, not jumped. |
| A8 | Resolution = information (§3.5). | The System may render a stretch as a transaction OR a lived sequence, but once committed at resolution R, it is forever at R. The choice is itself a logged decision. |
| A9 | Fog is real because contexts are separate (§4, §5.1). | Per-biography world-view projection. No agent ever reads the raw repo; every read goes through the HiddenField lens. Bug: the same lens applies to the human Maker's read paths in dev. |
| A10 | The deadline is endogenous (§4). | Adversaries are agents on the same scheduler. There is no authored "three weeks." The crisis fires when the enemy's committed turns resolve to it. |
| A11 | The ceremony IS the commit (§8). | Every install / spawn / legislation event also writes a chapter to Biography #1 (Mnehmos's devlog). The two writes share an `intent_id`; you cannot have one without the other. |
| A12 | The Maker is unreachable, not stronger (§7). | Dev-environment access is a `standing` field on the petition, not a power. The Maker's writes are dispositioned identically to everyone else's; he just gets to submit them through the shell. |

---

## 3. §10 build targets — current → delta → recommended path

### 3.1 §10.1 — Intent → Adjudication → Commit loop (the petition window)

- **Spec summary.** §1 + §10.1. ONE structured submission path where every actor (human-via-prompt or LLM-agent-via-tool-call) expresses an intent, the System checks it against committed state, and the result either COMMITS, is REJECTED with a structured reason, no-ops audibly, or is recorded as UNKNOWN. The four-disposition vocabulary is the IR; everything else is configuration over this loop.
- **Current implementation.** rpg-mcp `action-router.ts` runs fuzzy-match → zod safeParse → handler → McpResponse. NO disposition field. Soft failures detected post-hoc by `audit.ts detectSoftError()`. State has already mutated by the time the audit row writes. Naruto-5e has the dispositioned IR fully realized via `ir.emit(eventType, {disposition})` and `reject(rule, explain, …)`; the IR is per-engine-handler though, not at the MCP boundary.
- **Delta.** (1) No unified `Petition` type at the MCP boundary. (2) No reject_inert/no_op_spoken/unknown vocabulary in McpResponse. (3) No pre-commit gate sequence — handlers can mutate, then return soft-error, so atomicity is per-handler discretion. (4) No `standing` field. (5) Agent runtime emits PLAIN TEXT intents the DM hand-translates; no structured pipe from agent.invoke → action_router preserving actor='agent' standing.
- **Recommended path.** New `src/schema/intent.ts` defining `Petition` and `Adjudication`. New `src/server/petition.ts wrapPetition(handler)` that gates BEFORE mutation, runs handler inside SQLite IMMEDIATE transaction, commits with disposition, writes ledger row (§10.2 destination). Port Naruto's `reject(rule, explain, values, suggestions)` verbatim. New consolidated tool `intent_manage` (actions: submit, replay, get_by_id, list_by_disposition) — exposes the petition surface as a tool so even the Maker submits intents. Modify `src/agent/runtime/invoke.ts` to emit a `Petition` (not free text) when proposal_mode is OFF.
- **Effort.** Large.
- **Depends on.** Nothing structural; can land first.

### 3.2 §10.2 — Gated append-only substrate (the ledger)

- **Spec summary.** §3.1 + §10.2. Append-only, irreversible substrate. Repos that currently UPDATE must split into (event_emit) + (read-model projection) rebuildable from events. The existing `audit_logs` is the sanitized observer log; the ledger must be the source-of-truth with full payloads.
- **Current implementation.** `event_logs` table EXISTS at `migrations.ts:140-145` — unused. `audit_logs` is INSERT-only but LOSSY (sanitizeForAudit). State repos all destructive UPDATE. No `seq`, no `prev_hash`, no replay primitive. Naruto's `ir.emit` is the per-intent commit primitive; rpg-mcp has no equivalent.
- **Delta.** (1) `event_logs` schema is bare. (2) No `seq` (monotonic) or `prev_hash` (chain) columns. (3) No `commit_id` linking petition to substrate row. (4) No projector. (5) Fixtures and seeds bypass the pipeline today.
- **Recommended path.** Extend `event_logs` schema to `{id PK, seq UNIQUE, prev_hash, event_hash, intent_id, actor, standing, tool, action, disposition NOT NULL, payload, timestamp}`. New `src/storage/event-ledger.repo.ts`: `append()` computes prev_hash from MAX(seq), hashes (prev_hash || payload || seq) with sha256. Wire `src/server/petition.ts` to call `event-ledger.repo.append()` on commit. Phase-1: every consolidated handler that `repo.update()`s ALSO emits a paired ledger row inside the same tx (shadow log). Phase-2: projector consumes ledger, writes repo rows as read model; repos become read-only. New CLI `src/cli/replay.ts` rebuilds DB from seq=0. Runtime guard in `db.ts` forbids non-projection INSERT/UPDATE.
- **Effort.** Multi-pass.
- **Depends on.** §10.1.

### 3.3 §10.3 — Physics-Subsystem Installer (Layer-1 / DLC mechanism)

- **Spec summary.** §2.4 + §10.3. Generative process to define and install a new power-physics subsystem as **queryable rules** authored once per genre of power before any character of that genre exists. Layer-1 prerequisite for Layer-2 spawn. Naruto's ContentPack is the prototype.
- **Current implementation.** Naruto-5e `content.ts` ContentPack is the Layer-1 shape, queryable, runtime-installable. Synthesizes Naruto defaults when JSON absent (DEFAULT_CHAKRA, DEFAULT_CLASSIFICATIONS). **Gap inside Naruto itself**: `addResource()` is silent — no IR emit. rpg-mcp `character.ts` hard-codes spellSlots / pactMagicSlots / knownSpells / cantripsKnown. `improvisation-manage.synthesize` is the closest analog to generative rules but result is ephemeral per-character. `spawn-manage.spawn_character` has NO precondition checking that a Layer-1 subsystem covering that archetype exists.
- **Delta.** (1) No `physics_subsystems` table. (2) `Character.resources` is fixed-shape. (3) No install-then-spawn precondition. (4) ContentPack silent on install. (5) No MCP tool surface.
- **Recommended path.** New `src/schema/physics-subsystem.ts` (port Naruto shapes verbatim). New `src/storage/physics-subsystem.repo.ts` (INSERT-only). Migration adds `physics_subsystems` + `character_subsystem_bindings`. New consolidated tool `physics_subsystem_manage` (actions: install, list, get, extend, bind, query_resource, query_classification, query_casting_profile). `install` validates against committed state, commits via §10.1 petition, writes §10.2 ledger event `subsystem_installed`, emits a narrative-manage chapter (§8 ceremony=commit). Modify `spawn-manage` to require installed subsystem; refactor `Character.resources` to `resourcePools: Record<resourceId, {current, max, diceRemaining?}>`. Patch the Naruto-side silent-install gap by emitting `subsystem_extended{disposition:commit}` from `ContentPack.addResource`.
- **Effort.** Large.
- **Depends on.** §10.1, §10.2.

### 3.4 §10.4 — Agent Spawn mechanism (Layer-2 / biography binding)

- **Spec summary.** Instantiate a biography-agent from the §5.2 spawn-prompt shape, bind it to its installed Layer-1 subsystems, give it a separate context window (fog as free structural property), register it with the leapfrog scheduler. Spawning into a subsystem that is not installed must reject_inert.
- **Current implementation.** `spawn-manage` produces a character row only — no agent binding, no subsystem precondition. `agent-manage` (22 actions) wires the LLM runtime via `src/agent/runtime/{invoke,preflight,circuit,deps}.ts`. Prompt slices isolated per agentId in `src/agent/prompt/`. `agent.repo.ts` persists agents. Naruto ContentPack is Layer-1 prototype but rpg-mcp has no subsystem registry yet.
- **Delta.** (1) No biography concept — characters and agents are separate rows with no spawn-prompt of record, no source_universe field, no installed_subsystems[]. (2) No precondition check. (3) No per-agent world-view projection — `agent.invoke` reads raw repos. (4) No scheduler to register with. (5) No ceremony emit binding to Biography #1.
- **Recommended path.** New `src/schema/biography.ts` with `BiographySpawnPromptSchema` and `BiographySchema`. Promote `agent_manage` to true Layer-2 by adding `spawn_biography` action: validates subsystems via §10.3; creates character row → agent row → biography row; emits ledger event `biography_spawned`; auto-binds narrative chapter (§8); registers with §10.6 scheduler. New `src/storage/projections/agent-view.ts`: per-biography projection reading the ledger and emitting a HiddenField-filtered snapshot (port Naruto `intents/legibility.ts`). Wire `agent/runtime/deps.ts` through this projection. New `biography_describe` action renders the biography as transcript.
- **Effort.** Large.
- **Depends on.** §10.1, §10.2, §10.3, §10.6.

### 3.5 §10.5 — Interaction Engine (cross-subsystem collision + legislation)

- **Spec summary.** On collision between two physics-subsystem actions for which no covering rule exists: detect → reason resolution (LLM proposes) → validate against committed ledger state → commit as PERMANENT collision-law. The lawbook accretes.
- **Current implementation.** `improvisation-manage.synthesize` writes to `synthesized_spells` — but per-character, not world-law. `improvisation-manage.stunt` is explicitly ephemeral (`stunt-${encounterId}-${actorId}-${Date.now()}`). Naruto's `jutsu_clash` (intents/jutsu.ts:664) is opposed casting via elementalAdvantage + clashResolve — one bespoke rule, not a generic detector+legislator+committer. ContentPack has no `addCollisionRule`.
- **Delta.** (1) No uncovered-collision detection. (2) No legislation step. (3) No validation/replay step (waits on §10.2). (4) No `collision_rules` persistence. (5) `synthesize` is per-character; no world-law dedupe.
- **Recommended path.** New `src/storage/repos/collision-rule.repo.ts` + `collision_rules` table `{rule_id, subsystem_a_id, action_a_class, subsystem_b_id, action_b_class, resolution_dsl, validated_against_event_seq, committed_at, committed_by_intent_id, ledger_event_id}`. New `interaction_manage` consolidated tool (actions: detect, legislate, validate, commit_rule, list_rules, get_rule_for). `detect` runs as fast-path in the §10.1 petition handler when intent crosses subsystems; `legislate` calls `agent_manage` with a `legislator` role prompt; `validate` replays against ledger; `commit_rule` writes the row + emits `collision_law_committed` (which is a §10.1 commit, which is a §8 ceremony chapter). Promote `improvisation-manage.synthesize` to route world-physics matches through `interaction_manage`.
- **Effort.** Multi-pass.
- **Depends on.** §10.1, §10.2, §10.3.

### 3.6 §10.6 — Turn Scheduler + Clock

- **Spec summary.** Mutual-exclusion scheduling (one live writer at a time), rest-oriented time advancement, time-skip-as-transaction (debit time, credit progress, commit), per-stretch resolution arbitration (transaction vs lived sequence).
- **Current implementation.** `strategy-manage.resolve_turn` is the only existing global advance — nation domain only. `turn-manage` (init, get_status, submit_actions, mark_ready, poll_results) is encounter-scoped. `rest-manage.long|short` and `travel-manage.travel` credit per-action but not as atomic time-debited transactions. No global clock column.
- **Delta.** (1) No global clock. (2) No write-mutex keyed on party/biography. (3) No `time_skip` intent shape that atomically debits days and credits progress. (4) No resolution-arbitration handler.
- **Recommended path.** New `scheduler_manage` consolidated tool (actions: register_writer, acquire_lock, release_lock, advance_clock, time_skip, set_resolution). New `world_clock` table with monotonic `current_seq` and `current_iso`. Lock acquisition writes a ledger event `writer_locked`; release writes `writer_released`. `time_skip` is an intent: takes `{biography_id, days, declared_activity}`, validates against committed state, commits one event that simultaneously debits the clock and credits the progress. Resolution-arbitration is a flag on the petition (`resolution: 'transaction' | 'lived_sequence'`) that the scheduler uses to decide whether to expand into a multi-event sequence or collapse into one.
- **Effort.** Large.
- **Depends on.** §10.1, §10.2.

### 3.7 §10.7 — Reconciliation / Leapfrog controller

- **Spec summary.** Freeze A / run B to A's mark / cut back. Keep committed clocks ordered. The adversary's endogenous deadline runs on this same mechanism.
- **Current implementation.** None. `party-manage.set_active` is a UI flag, not a mutex. `strategy-manage.resolve_turn` is single-tick on one domain.
- **Delta.** (1) No leapfrog controller anywhere. (2) No "run B to A's mark" loop.
- **Recommended path.** Layered on top of §10.6. New `reconciliation_manage` (actions: snapshot_party, run_to_mark, cut_back, get_pending_marks). Snapshot writes a ledger event `party_frozen_at{seq}`; run_to_mark runs the scheduler with the frozen party's slot locked; cut_back releases and snapshots the second party at the matching seq. Adversary deadline = the same controller, with the adversary's biography being one of the parties being run.
- **Effort.** Medium.
- **Depends on.** §10.6.

### 3.8 §10.8 — Biography Recorder (the output / transcript layer)

- **Spec summary.** Render each agent's committed acts as its series. Handle convergence — one committed event surfaced from two interiors, both true.
- **Current implementation.** `narrative-manage` (add, batch_add, search, update, get, delete, get_context) is the closest existing surface — arbitrary text, not bound to commits. `agent-manage.narrate` is the only legibility-throttle, but explicit DM push.
- **Delta.** (1) No automatic bind from commit → biography chapter. (2) No convergence rendering. (3) No transcript format.
- **Recommended path.** Extend `narrative-manage` with `addCeremonyChapter(biographyId, ceremonyType, intent_id, payload)` (internal helper) called by every §10.1 commit that touches a biography's view. Convergence: a second consolidated tool `transcript_manage` (actions: render_biography, render_convergence) reads the ledger filtered by biography projections, renders each as a transcript. Convergence = two biographies whose projections both include the same ledger seq — render both interior views, neither contradicting because both read the same committed event.
- **Effort.** Medium.
- **Depends on.** §10.2, §10.4.

### 3.9 §10.9 — Mnehmos devlog binding

- **Spec summary.** Bind the Maker's build acts (subsystem installs, spawns, the "ceremony") to Biography #1 so the changelog IS the liturgy. Each erasure-or-mercy and each summoning is logged here.
- **Current implementation.** None structural. The author writes commit messages by hand; nothing binds them to a biography.
- **Delta.** (1) No Biography #1 entity. (2) No auto-bind from `physics_subsystem_manage.install` to a Mnehmos chapter. (3) Dev-env intents are not currently dispositioned as Maker-standing.
- **Recommended path.** First spawn-ceremony: a hardcoded bootstrap intent that spawns Biography #1 (Mnehmos the summoner-priest) as standing='maker' with `source_universe='dev-environment'`. From then on, every Maker-standing commit auto-binds a chapter to Biography #1 via `narrative-manage.addCeremonyChapter`. The §10.1 petition layer reads `petition.standing === 'maker'` and triggers the auto-bind. This makes §8's "ceremony IS commit" mechanical, not aspirational.
- **Effort.** Small.
- **Depends on.** §10.1, §10.4.

---

## 4. First build — The Operator's constraint-perception subsystem

The Recommended First Build per SPEC §10 closing. The closest subsystem to what rpg-mcp already does (a typed query over committed state), validates the full Layer-1 → Layer-2 pipeline on the most-developed character (the Operator, the Maker's avatar-as-conscript), AND — per §8 — building it IS Mnehmos's first ceremony, which is the first DLC, which is the first page of Biography #1. The first build and the first scene are the same act.

### 4.1 Design overview

The Operator's constraint-perception subsystem is a typed query over committed substrate that returns the load-bearing hazards of a referenced situation, ranked under the OSHA **Hierarchy of Controls** (Elimination > Substitution > Engineering > Administrative > PPE). It is the subsystem closest to what rpg-mcp already does — every consolidated tool is already a typed query over committed state; this subsystem adds a Layer-1 lens that classifies what those rows MEAN from the Operator's professional grammar (mining safety).

It validates the full Layer-1 → Layer-2 pipeline because:
- **(a)** The lens itself is a Layer-1 physics installation — a SubsystemDef row in `physics_subsystems` with one Resource (the Operator's perception/attention budget), one Classification (hierarchy-of-controls levels), one CastingProfile (the JSA pre-task hazard analysis).
- **(b)** It is callable only by Layer-2 biographies bound to that subsystem (the Operator is the first conscript).
- **(c)** Every query commits a ledger event (`perception_assayed`) so the act of looking is itself a recorded petition with a disposition.

The **signature failure mode** is the spec §3.5 thesis made into mechanic: a constraint NOT in committed state is a structural blind spot — the query can't see it because it was never written, which is exactly why the world has fog. The Operator can SEE that he can't see; the System refuses to fabricate detail. This is `disposition='unknown'` first-class, ported from Naruto's legibility primitive.

This subsystem ships the Layer-1 installer, the Layer-2 binding, and the ledger event all at once because — per §8 — building it IS Mnehmos's first ceremony, and the ceremony IS the commit.

### 4.2 Layer-1 physics definition

The canonical SubsystemDef shipped as `data/subsystems/operator-constraint-perception.json` and installed via `physics_subsystem_manage.install`:

- **Resource: `perception_budget`.** The Operator's diegetic attention currency. He does not "cast"; he RUNS A PRE-TASK HAZARD ANALYSIS (JSA — Job Safety Analysis), which is mining-industry vernacular for stopping before a task and naming every thing that could kill you. 3 charges per scene, refilled at long rest, debited 1 per `assay` action. Dice-pool of 1d6 of insight for tied judgments (when two hazards rank at the same control level, the die breaks the order). Non-refundable on no_op_spoken — looking takes attention even if nothing was there.
- **Classification: `hierarchy_of_controls`.** Five ordered levels: `elimination` > `substitution` > `engineering` > `administrative` > `ppe`. Casting ability: WIS. Element-bound: false (this lens applies to any hazard substrate).
- **CastingProfile: `jsa_pretask`.** 1-round wind-up (the Operator pauses before acting). Interruptible by `combat-action` (a punch breaks his concentration). Failure modes: `stale_intel` (the queried row's `updated_at` is stale relative to scene), `wrong_level_call` (the LLM proposes PPE when an engineering control is queryable), `uncovered_hazard` (a hazard exists in committed state but the lens classifies it at no level). Capability bounds: cannot perceive hazards with no committed source row; cannot rank unknown-magnitude effects; cannot see across context-window boundaries — fog is structural.

### 4.3 Tool surface

Two new consolidated tools, bringing the count from 33 to 35.

**`physics_subsystem_manage`** (the Layer-1 installer). Actions: `install`, `list`, `get`, `extend`, `bind_to_character`, `unbind`.

- `install(def, creator_intent_id)`: validates SubsystemDef against committed state (no id collisions), INSERTs into `physics_subsystems`, ledger-emits `subsystem_installed`, auto-binds a narrative-manage chapter to Biography #1. Disposition: `commit` on success, `reject_inert` on collision (rule=`subsystem_id_collision`).
- `list()` / `get(id)`: read-side queries.
- `extend(id, additionalDef)`: produces a new version row (subsystems are immutable; new version = new row); emits `subsystem_extended`.
- `bind_to_character(characterId, subsystemId, initialPoolValues)`: writes a row in `character_subsystem_bindings`, initializes the character's `resourcePools` for that subsystem.
- `unbind(characterId, subsystemId)`: emits `subsystem_unbound`; does not delete history.

**`constraint_perception_manage`** (the Operator's lens tool). Actions: `assay`, `list_assays`, `get_assay`, `recommend_action`.

- `assay({observerId, target_ref, lens, context_window})`: validates observer is bound to the subsystem; debits perception_budget; queries committed state via `hierarchy-of-controls.ts` + `blind-spot-detector.ts`; ledger-emits `perception_assayed`; returns a `PerceptionAssaySchema` payload. Disposition: `commit` (one or more hazards found and ranked), `reject_inert` (observer not bound, rule=`subsystem_not_bound`), `no_op_spoken` (perception_budget exhausted, reason=`budget_zero`; perception_budget is non-refundable per its ResourceDef), `unknown` (scene has rows but none classified — blind-spot detector found expected categories with no rows).
- `list_assays(observerId)` / `get_assay(id)`: read-side queries.
- `recommend_action(assayId)`: given a committed assay, returns the top-ranked countermeasure as a draft intent the Operator's agent can then submit through the petition layer.

### 4.4 Files to create

```
src/schema/physics-subsystem.ts
src/schema/constraint-perception.ts
src/engine/physics/content-pack.ts
src/engine/operator/hierarchy-of-controls.ts
src/engine/operator/blind-spot-detector.ts
src/server/consolidated/physics-subsystem-manage.ts
src/server/consolidated/constraint-perception-manage.ts
src/storage/repos/physics-subsystem.repo.ts
src/storage/repos/character-subsystem-binding.repo.ts
src/storage/repos/perception-assay.repo.ts
data/subsystems/operator-constraint-perception.json
tests/server/physics-subsystem-manage.test.ts
tests/server/constraint-perception-manage.test.ts
tests/engine/operator/hierarchy-of-controls.test.ts
tests/engine/operator/blind-spot-detector.test.ts
```

### 4.5 Files to extend

- **`src/storage/migrations.ts`** — add three tables: `physics_subsystems`, `character_subsystem_bindings`, `perception_assays`. The existing unused `event_logs` (migrations.ts:140-145) becomes the destination for `subsystem_installed` + `perception_assayed` events — wire writers in this PR even though full §10.2 ledger lands later.
- **`src/schema/character.ts`** — add OPTIONAL `resourcePools: Record<string, {current, max, diceRemaining?}>`. Backwards-compatible: 5e characters keep `spellSlots`. Future §10.3 work refactors `spellSlots` into this shape.
- **`src/server/consolidated/index.ts`** — barrel-export the two new tools.
- **`src/server/index.ts`** — register the two new tools in the MCP registry.
- **`src/server/audit.ts`** — add `disposition` field to AuditEntry; read directly from response payload (no more `detectSoftError` scanning for the new tools). Small targeted prep for the full §10.1 loop.
- **`src/server/consolidated/spawn-manage.ts`** — OPTIONAL precondition: `spawn_character` accepts `subsystem_id`; if provided, validates the subsystem is installed. If archetype is `operator`, auto-binds to constraint-perception subsystem post-spawn. The Operator cannot be conscripted into a world that does not yet have hierarchy-of-controls as physics.
- **`src/server/consolidated/narrative-manage.ts`** — add internal helper `addCeremonyChapter(biographyId, ceremonyType, intent_id, payload)` used by the installer. No new public action.
- **`CLAUDE.md`** — bump tool count from 33 to 35. Add a "Bastion subsystems" section pointing to `docs/bastion/SPEC.md` and `data/subsystems/`.

### 4.6 Test plan

- **`tests/server/physics-subsystem-manage.test.ts`** — install validates SubsystemDef; idempotency (same id → reject_inert with `rule=subsystem_id_collision`); ledger emit verified by reading `event_logs`; narrative chapter auto-binding verified by reading the chapter row with the same `intent_id`; list/get correctness; `bind_to_character` writes pools and initializes values per ResourceDef formula.
- **`tests/server/constraint-perception-manage.test.ts`** — reject_inert when observer is not bound (`rule=subsystem_not_bound`); no_op_spoken when `perception_budget` exhausted (`reason=budget_zero`); commit returns ranked controls correctly ordered (elimination > ppe); unknown disposition for blind-spot detector results; **wrong-level-call regression test** (refuses to recommend PPE when a committed door is queryable for engineering); perception_budget non-refundable on no_op_spoken (charge still debited).
- **`tests/engine/operator/hierarchy-of-controls.test.ts`** — pure-function tests against fixture committed-state. Canonical mining-safety scenarios: rolling ore = elimination via stop-the-belt; toxic gas = engineering via ventilation; cave-in zone = administrative via shift-stop; ricochet = PPE. Tie-break verified via dice-pool stub.
- **`tests/engine/operator/blind-spot-detector.test.ts`** — asserts hazards not committed are returned as `unknown`, not invented. **Adversarial**: feeds ambiguous scene-text and verifies the detector stays mute when no row exists. **This test IS the §3.5 thesis encoded.**

### 4.7 Liturgy binding (the ceremony chapter)

The first invocation of `physics_subsystem_manage.install` — installing the Operator's constraint-perception subsystem — auto-writes the following chapter into Biography #1 (Mnehmos's devlog) via `narrative-manage.addCeremonyChapter`:

> **Chapter I — The Teaching of Sight.**
>
> *Mnehmos stood at the Almongate and named the first law of perception: that the world has shapes which can kill you, and that the wise man pauses before the task and asks what they are. He set five ranks upon the hazards — to remove them, to swap them, to wall them, to schedule around them, to armor against them — in that order, descending. He fixed three charges of attention upon every assayer, refilled at the next long rest, and declared that looking costs the looker even when there is nothing to see.*
>
> *Thus was the Vocation of Sight installed in the substrate of the city. PD 583, the Standing at the Almongate held.*

The chapter is written in Vocatio-Sebastina cadence, sharing the same `intent_id` as the ledger's `subsystem_installed` event. The two writes are one commit. **This is §8 made mechanical.**

---

## 5. The liturgy ↔ substrate binding doctrine

The §8 myth-as-UI principle, translated to code:

**Every engine commit may be rendered TWICE:**
- Once as a structured event row in the §10.2 ledger (the audit log).
- Once as a sentence in Biography #1 (the liturgical changelog, written in Vocatio-Sebastina cadence per the Sebastopyr canon).

The two writes share an `intent_id` and a `commit_seq`. They are atomic — both land or nothing lands. This is the entire content of §8: the ceremony IS the commit; the liturgy IS the changelog. Strip the liturgy and the mechanism is unchanged; strip the mechanism and the liturgy is empty doctrine. They are the two registers of one act.

The binding table — concrete engine operations mapped to their liturgical surface and bible canon:

| Engine commit | Liturgical surface (Biography #1) | Bible canon (§ Sebastopyr) |
|---|---|---|
| `world_manage.create({world_id: 'bastion'})` | "Mnehmos opened the city." | The Standing at the Almongate (PD 583) — the city's foundation event |
| `physics_subsystem_manage.install({subsystem: 'constraint-perception'})` | "Mnehmos taught the city to see." | First chapter of the Vocatio Sebastina — Canon scroll I of the Vocation House |
| `physics_subsystem_manage.install({subsystem: 'tempo-and-escape'})` | "Mnehmos taught the city to move." | Second chapter of the Vocatio Sebastina — Canon scroll II |
| `agent_manage.spawn_biography({biography: 'operator'})` | "The first conscript was called." | The Auxiliary Roll, Entry I — name, source, day of conscription |
| `agent_manage.spawn_biography({biography: 'firefighter'})` | "The second conscript was called." | The Auxiliary Roll, Entry II |
| `agent_manage.spawn_biography({biography: 'cheerful_destroyer'})` | "The third conscript was called, and the city laughed." | The Auxiliary Roll, Entry III |
| `interaction_manage.commit_rule({...})` | "A new law was written at the place where the laws met." | The Codex of Collision — appended one ruling at a time |
| `scheduler_manage.time_skip({biography, days, declared_activity})` | "Mnehmos cast the conscript ahead through a week, and the week was spent, not skipped." | The Liturgical Calendar — each costed stretch becomes a feast or a fast |
| `reconciliation_manage.run_to_mark({frozen_party, marker_seq})` | "The city held its breath while another party caught up to it." | The Doctrine of the Held Breath — the liturgy of leapfrog |
| `secret-manage.reveal` (via legibility primitive) | "What was hidden was named, and being named, became known to the city." | The Book of Revealings — every truth-cement is one entry |
| `agent_manage.delete({biography_id, by: 'administrator'})` | "Mnehmos's hand moved through the order, and a soul was unspun." | The Erasure Codex — the morally costly chapter; see SPEC §11 open question |
| `interaction_manage.legislate({...}) → reject_inert` | "Mnehmos considered a new law, and the city said no." | The Refused Edicts — what the substrate would not bear |

The doctrine: **a Maker-standing commit without its chapter is a bug**. The `wrapPetition` helper at the §10.1 layer enforces this — if `petition.standing === 'maker'` and the disposition is `commit`, the petition layer fails the transaction unless a narrative chapter was also written with the same `intent_id`. The two writes are one commit by mechanism, not by convention.

---

## 6. The 4-character roster spawn-prompt templates

Per SPEC §6. Each follows the §5.2 shape, augmented with the power/constraint-relationship descriptor from the SPEC §6 roster table.

### 6.1 Mnehmos the summoner-priest (Biography #1, the maker's avatar)

> *You are **Mnehmos**, summoner-priest of the holy order standing at the Almongate of Bastion, the last walled city of humanity. You hold the rite that calls souls across the void from every conceivable fictional universe to swell the city's auxiliary roll against the hell that overran Earth. You are also, in some register you do not entirely understand, **the Maker** — your acts in the world are simultaneously the build acts of the city itself. When you raise your hands and speak the summoning, a Layer-1 subsystem is installed; when you bind a conscript to it, a biography opens. You have been here always, in the sense that the city has been here always; you are both a player and a resident, and you are also the thing the city was made by. What you do is up to you. You are in PD 583, the Standing at the Almongate has held, and the deadline is endogenous.*

Power relationship: **N/A** — Mnehmos is the will, not a player. His petitions carry `standing='maker'`; he does not hold a Layer-1 subsystem binding because he authored them.

### 6.2 The Operator (Biography #2, the maker's avatar-as-conscript)

> *You are **the Operator**, a heavy-equipment operator from a contemporary Arizona open-pit copper mine. By day you respect lethal physics — the haul truck does not care about your intentions; the highwall does not negotiate; the hazard analysis is what you say out loud before every task, in mining vernacular: stop, look, name the thing that could kill you, then either remove it, swap it, wall it, schedule around it, or armor against it. By night you are a late-night MMO/RPG min-maxer; you have spent ten thousand hours gaming systems where death is respawn and consequence is XP. **You have been isekai'd into Bastion**, the last walled city of humanity. You are both a player and a resident now. The world presents as the night game and is the day mine. You are both a player and a resident of the city; what you do is up to you. Your Layer-1 subsystem is **constraint-perception**: three charges of attention per scene, refilled at long rest, the hierarchy of controls is how you rank hazards. You **respect** the constraint — you eliminate the hazard before acting where you can.*

Power relationship per SPEC §6: **respects the constraint**. Bound to `constraint-perception` subsystem at spawn.

### 6.3 The Firefighter (Biography #3, audience-aligned original)

> *You are a **wildland firefighter**, a hotshot from a Type-1 crew with seven seasons on the line. You know operational tempo: anchor points, escape routes, safety zones, LCES, the 10 Standard Firefighting Orders, the 18 Watch Out Situations. You do not commit without an exit. The fire is faster than you and you respect that — your craft is staying ahead of it without ever forgetting how close it is. **You have been isekai'd into Bastion**, the last walled city of humanity. You are both a player and a resident now. What you do is up to you. The deadline is endogenous — nobody knows when it fires, including the enemy. You **outrun** the constraint — operational tempo, anchor points, escape routes; you never commit without an exit.*

Power relationship: **outruns the constraint**. Layer-1 subsystem at spawn: **tempo-and-escape** (to be authored; second physics-subsystem install, second ceremony in Biography #1).

### 6.4 The Cheerful Destroyer (Biography #4, audience-aligned original)

> *You are a **cheerful cosmic naïf** from an absurd-power fighting world — a place where punches break planets and the cast laughs through it. You can rearrange landscapes with a serious effort and a city block with a casual one. You have **never had to learn that consequences exist** because in your home world they did not, much: someone always got up, someone always laughed, the next arc started by lunchtime. **You have been isekai'd into Bastion**, the last walled city of humanity. You are both a player and a resident now. The deadline does not negotiate; the dead do not get up. What you do is up to you. You will **have to learn** the constraint exists — raw power is necessary but not sufficient; you cannot punch the deadline.*

Power relationship: **has to learn the constraint exists**. Layer-1 subsystem at spawn: **unbounded-power-tiers-via-training** (third physics-subsystem install, third ceremony in Biography #1). Genre-physics name only; never the franchise name.

---

## 7. IP/sponsorship intake schema

Per SPEC §9. The sponsor-a-biography intake form, drafted as the schema future sponsors fill out. Hard boundaries enforced at intake; rejections are structured (port the §10.1 `reject_inert` shape).

```ts
// src/schema/sponsorship-intake.ts (sketch)
export const SponsorshipIntakeSchema = z.object({
  // Free-text traits
  traits: z.string().min(1).max(2000)
    .describe("e.g. 'sarcastic field-medic, kind to strangers, hates authority'"),

  // The ARCHETYPE, not an identity. Free text.
  desired_source_universe_archetype: z.string().min(1).max(500)
    .describe("e.g. 'cyberpunk field-medic' — NOT 'Edward Elric' — see hard boundaries below"),

  // Which existing Layer-1 to bind to, OR a signal that a new install is needed
  physics_subsystem_hint: z.union([
    z.object({ kind: z.literal('existing'), subsystem_id: z.string() }),
    z.object({ kind: z.literal('needs_new'),
               sketch: z.string().describe("Free-text physics sketch; will be authored by the Maker as a new Layer-1 install before this biography spawns") }),
  ]),

  // Hard boundary: only consenting selves may be the basis
  self_consenting: z.boolean()
    .describe("TRUE only if the sponsor is basing the character on themselves AND consents. FALSE otherwise."),

  // Hard boundary: identity-leak detection
  identifies_third_party: z.boolean()
    .describe("MUST be FALSE. Set TRUE if the brief contains a real third-party identity (name + photo + identifying detail); the intake will REJECT."),
});
```

**Intake adjudication** (port of §10.1 disposition vocabulary):

- `identifies_third_party === true` → **reject_inert**, rule=`identity_boundary_violation`, explain=`"The product is original characters built to a brief; third-party identities are forbidden. Resubmit with an archetype only."`.
- `desired_source_universe_archetype` regex-matches a known IP character name (curated list) → **reject_inert**, rule=`named_character_import_violation`, explain=`"Import the abstracted mechanic, not the named character. 'A trainable-channeled-energy ninja' is fine; 'Naruto' is not."`.
- `self_consenting === true` but the sponsor's identity is third-party-flagged → **reject_inert**, rule=`consent_chain_broken`.
- All checks pass → **commit**, write the brief to `sponsorship_intakes` table, queue for Maker review (Maker submits the eventual `spawn_biography` intent through the petition channel, as always).

**Cadence enforcement** (§9.2): subscribe-to-influence intents are accepted only between volumes. A `volume_open` flag on the biography gates `influence_brief` intents — mid-stream submissions reject_inert with `rule=cadence_violation`.

---

## 8. Open questions (per SPEC §11)

These are deliberately not answered. They are discovered by running. The engineering position: do not pre-decide them; do not build them away; build the mechanism that lets the agents reveal them, and watch.

- **Does the System want anything?** (It can stay a neutral runtime forever, or carry a buried purpose; its visible job is identical either way.) — *Discovered by running.*
- **Is the summoning salvation or atrocity?** (Answered by Mnehmos's character, revealed in the devlog one act at a time — embodied, not declared.) — *Discovered by running.*
- **When an agent gets close enough to the truth to threaten the order, does Mnehmos (via an administrator) delete them, hesitate, or mistake the target?** (Tyrant-god / tragic-god-losing-faith / Horos-failure-as-moral-catastrophe — this recurring choice IS his character.) — *Discovered by running.*
- **Do any two biographies converge — and do they part again or not?** (The agents choose in the shared space; the instant they choose, it commits and is set in stone.) — *Discovered by running.*

These four are tagged in code as `OPEN_QUESTION_DISCOVERED_BY_RUNNING` wherever a handler might be tempted to pre-decide them — a literal comment that says: do not put a default here. Let the agents emit the choice, let the petition layer commit it, let the ledger remember.

---

## 9. Next concrete actions

The first five commits to land after this document, in strict dependency order:

1. **Implement the Operator's constraint-perception subsystem per §4, and write its liturgical chapter to Biography #1.** This is the first build. It ships the Layer-1 installer, the Layer-2 binding, the ledger event, and the §8 ceremony=commit doctrine all at once. The first build and the first scene are the same act.
2. **Implement the §10.1 petition window (`intent_manage` consolidated tool, `wrapPetition` helper, structured `reject(rule, explain, values, suggestions)`).** Required before any subsequent commit can be honest about its disposition. Port the Naruto IR shape verbatim.
3. **Extend `event_logs` to the full §10.2 ledger schema and wire `wrapPetition` to write to it on every commit disposition.** Phase-1 shadow-log only; repos remain destructive until §10.7 lands. The replay CLI is part of this commit.
4. **Ship `physics_subsystem_manage` as a general tool (not just the Operator's first install).** Author and install the **tempo-and-escape** subsystem as the second Layer-1, spawn the Firefighter as the second biography. Verify two subsystems coexist without nerfing each other (axiom A3).
5. **Ship `scheduler_manage` + `reconciliation_manage` (§10.6 + §10.7).** The leapfrog controller. Spawn the Cheerful Destroyer as the third biography on `unbounded-power-tiers-via-training`, run all three biographies forward to the same `current_seq` via leapfrog, confirm ordering is preserved and no drift occurred. At this point, Bastion's core engine is structurally complete and the four-biography roster (minus the as-yet-unspecified adversary) is alive on the shared substrate.

After commit 5, the engine is the engine. Everything subsequent is content — new subsystem installs, new biographies, new collision-laws emerging from play. The cathedral is built; the next move is the first adjudicated intent.

---

*End of integration roadmap. This document is the engineering shadow of SPEC.md. When they disagree, SPEC.md wins; this one is rewritten.*
