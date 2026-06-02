# Bastion — Deliverables Manifest

*The bridge from spec to ship. Every artifact Bastion needs, what exists, what's left, the build order, and the definition of "done" for each. This is the master checklist; the four design docs are its substrate.*

**Status:** ✅ done · 🟡 partial · ⬜ needed · 🔒 blocked on a decision

---

## The whole picture in one paragraph

Bastion is **(1) a design** (four docs, complete), **(2) an engine** (rpg-mcp, exists; needs a small amount of Bastion-specific work), **(3) a first run** (autonomous agents living in Sebastopyr; not yet spawned), and **(4) a website** (specced; not built). The critical path to a shipped first artifact is: build the Operator's Layer-1 subsystem → spawn Mnehmos + the Operator + cohort against the same rite → that produces Chapter 1 → build the website frame → publish Chapter 1 from two interiors. Everything below is that path, exploded.

---

## A. Foundation documents (the design layer) — essentially complete

| Deliverable | Path | Status | Note |
|---|---|---|---|
| Architecture spec | `bastion-specification.md` | ✅ | the why; §11 keeps the open questions open |
| System operating charter | `SYSTEM.md` | ✅ | how the adjudicating LLM behaves; two-tier, two-gate |
| Opening spawn-prompts | `bastion-opening-prompts.md` | ✅ | Operator + Mnehmos, player/character contract, cohort + chooses |
| Website spec | `bastion-website-spec.md` | ✅ | publishing surface; grounded against Naruto5e |
| **Publishing convention doc** | `PUBLISHING.md` | ✅ | extracted from website-spec §7; canonical home for the publish workflow |
| Tool-surface audit | `_audit_report.md` | ✅ | verdict: descriptions already agent-ready (reference, not a Bastion artifact) |

**Acceptance:** a new collaborator can read A and understand Bastion end-to-end without this conversation. (Met, except PUBLISHING.md.)

---

## B. Engine deliverables (rpg-mcp work Bastion needs)

What the engine must expose that isn't there yet. Most is small; the engine is mature.

| Deliverable | Status | What it is | Acceptance |
|---|---|---|---|
| **Operator's constraint-perception subsystem** (Layer-1) | ⬜ | the "read the load-bearing hazard" mechanic — a structured query over committed state returning the failure mode of a situation. Closest primitive: `math_manage skill_check` formalized into its own capability. **The recommended first build.** | a tool/action call returns a deterministic, committed "constraint read" the prose can quote; covered by a Vitest regression |
| **npc unification** (`npc_manage.create` + `get_full_context`) | 🟡 | composes character_manage + agent_manage + memory init; one table-ready context bundle | background workflow `wnctncnwl` already running per the state report; verify suite green + pushed |
| **Narrative → chapter export** | ⬜ | a path from `narrative_manage` content to `bastion/biographies/<slug>/chapters/<id>.md` | running a scene yields a chapter `.md` with valid front-matter (per website-spec §6.1) |
| **Ledger → engine-log export** | ⬜ | a path from committed ledger entries to `ledger/<slug>/<id>.json` for the collapsible Engine Log | the engine log for a chapter renders as the audit trail behind that chapter's prose |
| **Chapter → narration text** | ⬜ | a path that extracts clean, narration-ready prose from a chapter (strips panel markup, keeps the read) into the text the TTS step consumes | a chapter yields a plain narration script with no DSL artifacts; bubbles/captions read naturally aloud |
| **Agent spawn binding** | ⬜ | wiring the two opening prompts into `agent_manage` instances, separate contexts | Mnehmos and the Operator each run in their own context, blind to the other's interior |
| **Operator = Mnehmos secret binding** | ⬜ | a `secret_manage` entry to be added at Operator spawn time per resolution III — records the in-world fact that the Operator is Mnehmos in a separate interior, kept hidden from both agents | at Operator spawn, a secret is committed that binds the two identities; neither agent's context can read it |

**Acceptance for B as a whole:** one committed scene can be run AND exported into the two files the website generator consumes.

---

## C. The first run (the content that proves everything)

| Deliverable | Status | Note |
|---|---|---|
| World: **Sebastopyr** | ✅ | exists in DB — 20 cathedral rooms + 1 canonical_moment (the founding) |
| **Mnehmos** agent spawned | ⬜ | from prompt 2; he *chooses*, summons a cohort |
| **The Operator** agent spawned | ⬜ | from prompt 1; arrives with others |
| **The cohort** decided | ✅ | popular LitRPG tropes; max-2 concurrent writers per resolution II |
| **Chapter 1 — the first rite / the arrival** | ⬜ | the convergence event: Mnehmos performs the rite; the Operator is one soul who arrives. ONE committed event, two interiors. This is Chapter 1 of *both* series. |

**Acceptance for C:** Chapter 1 exists as committed state, exported to chapter `.md` + engine-log `.json`, from both Mnehmos's and the Operator's point of view, against the same rite.

---

## D. Website deliverables (Phase 0 → Phase 1)

### Phase 0 — the frame + landing (ship before any chapter exists)

| Deliverable | Status | Acceptance |
|---|---|---|
| **Repo/location decision** | ✅ | F:/Github/mnehmos.bastion (own repo per resolution I) |
| **Shared component frame** | ⬜ | one stylesheet + templates: layout, manga-panel system, HUD character-sheet, collapsible Engine Log, "committed by the System" mark. Theme-driven (reads token sets). |
| **Generator skeleton** (`scripts/build-site.mjs`) | ⬜ | reads `bastion/biographies/*` content + theme + ledger → renders `docs/`. Idempotent: no content change → no diff. |
| **Chapter DSL parser** | ⬜ | expands `:::panel / :::bubble / :::sfx / :::roll` (website-spec §6.2) → component HTML. Authors/agents write DSL; build owns HTML. |
| **Landing** (`docs/index.html`) | ⬜ | the pitch, the premise, the (short) line of biographies, "first lives incoming" state, the "how this is made" section. Looks intentional while near-empty. |
| **TTS narration pipeline** (`scripts/narrate.mjs`) | ⬜ | OpenAI TTS per chapter → `docs/<...>/audio/<slug>.mp3`. **Hash-gated** (`audio/.hashes.json`): only re-synthesize when chapter text changed — mirrors the proven Naruto pattern (one mp3 per chapter, slug-matched, incremental). Per-biography voice = a field in `theme.yaml`. | running narrate on an unchanged chapter is a no-op; on a changed/new chapter it produces a slug-matched mp3 and updates the hash |
| **Audio player component** | ⬜ | inline player on each chapter page (and a "listen" affordance on the biography ToC). Part of the shared frame. | a chapter page plays its narration without leaving the read; absent audio degrades gracefully (no broken player) |
| **Theme: the-operator** (`theme.yaml`) | ⬜ | industrial / desert / load-bearing skin (palette, type, motif, sigil) per website-spec §6.3 |
| **Theme: mnehmos** (`theme.yaml`) | ⬜ | the devlog/summoner skin |

*Theme token sets also carry a **`voice`** field (the OpenAI TTS voice for that biography's narration) — so each life sounds, as well as looks, like itself.*

**Phase 0 acceptance:** `node scripts/build-site.mjs` produces a published landing page from the frame + one biography stub, with zero hand-edited HTML under `docs/`. Narration tooling exists and is hash-gated, even if no chapter is voiced yet.

### Phase 1 — the first lives (when Chapter 1 commits)

| Deliverable | Status | Acceptance |
|---|---|---|
| **Operator biography pages** | ⬜ | hero + HUD sheet + Arc I chapters, themed, generated from committed content |
| **Mnehmos devlog surface** | ⬜ | in-fiction by default; engineering-layer toggle (events-as-commits). website-spec §4 |
| **First convergence + city timeline** | ⬜ | the arrival and the first rite as one event, cross-linked from two interiors, positioned on `city/timeline.html` |

**Phase 1 acceptance:** a reader can read Chapter 1 as a clean novel, OR listen to its narration, OR open the Engine Log and the two interiors and the city timeline — and the two accounts of the shared rite do not contradict.

---

## E. Monetization scaffolding (deferred — after the first lives publish)

| Deliverable | Status | Guardrail (from spec §9) |
|---|---|---|
| Sponsor-a-biography intake | ⬜ | briefs take **traits and concepts, never identities**; only a consenting self or pure invention |
| Subscribe-to-influence | ⬜ | influence is **between committed volumes only** — never mid-stream (preserves fog + commitment) |

---

## The critical path (do these in this order)

1. **PUBLISHING.md** — extract the workflow from website-spec §7 (5 minutes; removes a drift risk). [A]
2. **Decide the website repo location.** [D, blocking] 🔒
3. **Decide the cohort** — who Mnehmos summons with the Operator. [C, blocking] 🔒
4. **Build the Operator's constraint-perception subsystem** + its regression test. [B] — *this is the maker's first ceremony; the first build and the first scene are the same act.*
5. **Spawn Mnehmos + the Operator + cohort** against one rite. [C]
6. **Run Chapter 1** → export chapter `.md` + engine-log `.json`, both interiors. [B/C]
7. **Build Phase 0 website** — frame, generator, DSL parser, landing, two themes, **narration pipeline**. [D]
8. **Build Phase 1** — Operator biography + Mnehmos devlog + first convergence + city timeline, **and narrate Chapter 1** (both interiors get voiced). [D]
9. **Publish** — build → review → commit `docs/` → Pages. [PUBLISHING.md]

Steps 1–3 are cheap and unblock everything. Step 4 is the keystone engine work. Steps 5–6 produce the first content. Steps 7–9 ship it.

---

## Open decisions blocking work (resolve these first)

1. ✅ **RESOLVED — Website repo location.** Own repo at `F:/Github/mnehmos.bastion`; engine-as-moat / publication-as-product split preserved (resolution I).
2. ✅ **RESOLVED — The cohort.** Drawn from popular LitRPG tropes; cap of max-2 concurrent writers (resolution II).
3. 🔒 **Mnehmos selection weight.** Resolved in the prompt (he *chooses*). Remaining nuance: does the reader learn *why* he chose the Operator early, or is the reason withheld? Affects how much the first rite reveals.

Decisions already settled (do not reopen): the player/character contract; Mnehmos chooses and summons a cohort; the engine-as-feature website position; the four deferred "discovered by running" questions stay open.

---

## What stays deliberately undone

Per the project's spine, these are answered by *running*, not building, and must not be pre-specced into existence:
- whether the System wants anything;
- whether the summoning is salvation or conscription;
- whether/when Mnehmos deletes a soul who threatens the order;
- whether any two biographies converge and part, or don't.

The deliverables above build the *stage*. These are the *play*, and the play is the point.

---

*Four design docs + this manifest = the complete plan. The next move is the critical path, top to bottom — and steps 1–3 cost almost nothing.*
