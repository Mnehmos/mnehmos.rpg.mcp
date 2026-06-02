# Bastion — Website Specification

*The publishing surface for Bastion biographies. A static site (GitHub Pages, served from the repo) that presents agent-generated lives as a reader-first product, with the engine as an opt-in trust layer.*

*Grounded against the Naruto5e site (`mnehmos.github.io/naruto5e`), which is the proven prior art. This spec keeps what that site does well and fixes the four things that won't survive Bastion's scale.*

---

## 0. Thesis

**Naruto5e is the engine demo. Bastion is the publishable product.** Same engine, same "every die rolled by the engine" trust spine — but Bastion sells the *biography*, not the machinery. The reader should feel they are reading lives; the engine is the moat, and the moat is visible as a *feature*, never as the foreground.

Public pitch (above the fold, never the backend):
> **Bastion is the last city. It summons heroes from every kind of world. Their powers arrive intact. Nothing is balanced. The city only records what survives.**

The unit of production is **committed-world-state change per author-hour** (spec §5). One committed event fans out into many surfaces: an Operator chapter, a cohort-member chapter, an antagonist interlude, the Mnehmos devlog, a ledger appendix, a recap, TTS. The website is where that fan-out lands.

---

## 1. What we keep from Naruto5e (proven, do not reinvent)

These work. Carry them forward:

1. **Prose-first, engine-as-collapsible-audit.** Story chapters are the reading experience; each chapter's *Engine Log* is a collapsible audit trail — "the deterministic state behind the prose." A debrief explains how the engine constrained the AI. This is the **engine-as-feature** position, already correct.
2. **"Every die rolled by the engine" as the spine — and the loss as the proof.** Naruto leads with Iwao *losing* the finals to an honest failed save. That single fact ("the protagonist did not win his own tournament; the engine wouldn't let him") is the most persuasive thing on the site. Bastion must preserve the same: when a biography's agent loses honestly, that is a *headline*, not an embarrassment.
3. **The HUD character sheet.** Engine-validated stats (HP/chakra/AC/renown bars, jutsu chips, motif) rendered as a living sheet — literally `character_manage` state made visible. Keep per-biography.
4. **The "Behind the X" development timeline.** Naruto's "Behind the Dust" turns *the bug-find-and-fix loop* into content (commits, what broke, what it became). This is the devlog instinct shipping. In Bastion this becomes Mnehmos's biography surface (§4) and a per-world engineering log.
5. **Craft-grade art direction.** Real type pairing, hand-tuned palette, a thematic generative background (Naruto: a Three.js particle field as Dust Release). Bastion matches this bar — but per biography (§3).
6. **Three-level reader funnel:** `index` (the hero / journey / character sheet / behind-the-scenes) → `story` (the chapter index / ToC) → `chapters/*` (the chapters themselves). Keep the funnel; generate it (§2).
7. **Per-chapter audio narration.** Naruto ships one `.mp3` per chapter (slug-matched, in `docs/audio/`) with a `.hashes.json` so narration is regenerated incrementally — only when the chapter text changed. Keep this exact pattern; it is the right architecture for paid API synthesis (don't re-render what didn't change). Bastion makes it OpenAI TTS, per-biography voice (§5.5).

---

## 2. What we fix for scale (the "plan ahead" deltas)

### 2.1 Content model + generator — NOT hand-authored HTML
**Naruto's limit:** every chapter is a bespoke hand-written `.html`; the index is one giant hand-built file with each chapter's panels inline. Fine for ONE ~40-chapter biography. Bastion runs MANY concurrent biographies, each generating chapters continuously. Hand-authoring does not survive that.

**Bastion:** chapters are **structured content** (front-matter + body) rendered to HTML by a **generator script**. Author/agent produces content; the build produces pages. Add a biography, add a chapter, rebuild — never hand-edit a `<div class="panel">`.

- **Source of truth for content:** `bastion/biographies/<slug>/chapters/*.md` (front-matter + prose, optionally with panel markup as a light DSL — see §6).
- **Source of truth for state:** the rpg-mcp ledger / `narrative_manage` export per biography (the Engine Log content).
- **Build:** `scripts/build-site.mjs` renders content + ledger → `docs/` (the published Pages site). This is the publishing step that must be documented (§7).

### 2.2 Per-biography theming off a shared frame
**Naruto's limit:** the whole palette (ember/gold/stone + a Dust particle field) *is* Iwao's bloodline. Bastion is a melting pot — every biography is a different source-universe with different physics. One fixed theme flattens the exact thing that makes Bastion Bastion.

**Bastion:** a **shared structural frame** (layout, funnel, components, the manga-panel system, the HUD sheet, the collapsible Engine Log) + a **per-biography theme token set** (palette, type pairing, background motif, sigil). The Operator's pages read industrial/desert/load-bearing; a different cohort member reads however their world reads. Theme is data, applied at build (§6). This is the website expression of "powers arrive intact, nothing is balanced" — each life looks like where it came from.

### 2.3 Cross-biography / shared-event model (convergence)
**Naruto's limit:** one protagonist, one linear timeline. No concept of two lives sharing an event.

**Bastion:** the data model has **biographies** AND **events**, and an event can belong to multiple biographies. The site must render:
- a **convergence chapter** — one committed event shown from two (or more) interiors, cross-linked, neither account contradicting the other (because both read the same committed ledger entry);
- a **city timeline** — the shared clock, on which all biographies are positioned, so a reader can see that the Operator's arrival and Mnehmos's first rite are the *same day* (the convergence card from the opening prompts);
- **cohort links** — the souls summoned together, surfaced as related lives (future series).

### 2.4 Documented publishing workflow
**Naruto's limit:** the pipeline exists but isn't written down anywhere.

**Bastion:** the convention is explicit (§7): Bastion updates are generated into the repo's static `docs/` and shipped via GitHub Pages. One command, one commit pattern, written down so it doesn't live in anyone's head.

---

## 3. Information architecture

```
SITE ROOT (docs/)
│
├── index.html ........... Bastion landing — the city, the pitch, the line of biographies,
│                          the shared city-timeline, "how this is made" (engine-as-feature)
│
├── biographies/
│   └── <slug>/
│       ├── index.html ... biography hero: who they were, the world they came from,
│       │                  their engine-validated HUD sheet, their arc-so-far, themed
│       ├── story.html ... that biography's chapter index (ToC), arc/act grouping
│       └── chapters/
│           └── <id>.html  a chapter: prose panels + collapsible Engine Log + nav
│
├── city/
│   ├── timeline.html .... the shared clock: all biographies positioned on one timeline,
│   │                      convergence points marked
│   └── ledger.html ...... the world ledger / appendix (opt-in trust layer)
│
├── devlog/  ............. Mnehmos's biography = the making-of (see §4)
│
└── about.html ........... the thesis + "every event committed by the System" + the method
```

**Routing principle:** biography-scoped. A reader lands on the city, picks a life, and reads it end-to-end without leaving that biography's theme — except at *convergence*, where a cross-link carries them into the other life's account of the shared event and back.

---

## 4. The Mnehmos devlog surface (special)

Mnehmos's biography (Biography #1) is the **making-of**, rendered as a life. This is the Naruto "Behind the Dust" timeline, elevated: the summoner-priest's logged acts (each summoning, each subsystem installed, each ruling) ARE the build acts. Two registers, one surface:

- **In-fiction layer (default view):** the rite, the cathedral, the choosing of cohorts, the weight. Reads as a biography like any other.
- **Engineering layer (opt-in toggle):** the same events as commits — what was built, what the engine did, the ledger entries. The "ceremony is the commit, liturgy is the changelog" made literal and *viewable*.

A reader who wants the story gets the priest. A reader who wants the machine flips the toggle and sees the build. Same page. This is where the moat becomes the most explicit selling point on the whole site — and it stays optional.

---

## 5. The engine-as-feature layer (the trust UI)

The differentiator is an honest, committed, verifiable world. Surface it as a *feature the reader can opt into*, never as foreground:

- **Per-chapter collapsible Engine Log** (from Naruto): the deterministic state behind the prose — rolls, HP deltas, slot spends, the committed result. Collapsed by default.
- **"Committed by the System" marks** on consequential events: a small, consistent sigil that says *this happened in the ledger, it was not authored after the fact.* Hover/expand → the ledger entry.
- **The loss-as-proof callout:** when an agent loses or fails honestly, the site can flag it ("the dice, honestly: …") the way Naruto flags Iwao's finals loss. This is the trust spine; give it a recognizable component.
- **The ledger/appendix page** (`city/ledger.html`): the full committed record, for the reader who wants to audit. The deep end of the opt-in.
- **The debrief / about page:** the thesis — how the engine constrains the AI, why the story is trustworthy.

Design rule: a reader who never clicks any of this gets a clean novel. A reader who clicks all of it gets a verifiable simulation. Both are first-class.

### 5.5 Narration (the audiobook layer) — OpenAI TTS
Audio is a **first-class output**, not an afterthought — the product is "audiobook-style episodes," and the fan-out math (one committed event → chapter + interlude + devlog + **narration** + shorts) depends on it. The proven Naruto pattern is the contract:

- **One `.mp3` per chapter**, filename = chapter slug (so `ch01-the-arrival.html` ↔ `ch01-the-arrival.mp3`), under the biography's `audio/`.
- **Hash-gated regeneration** via `audio/.hashes.json`: the narrator hashes each chapter's narration text and re-synthesizes ONLY when it changed. Unchanged chapters are a no-op. This is non-negotiable — TTS calls cost money and time; the pipeline must never re-voice an untouched chapter.
- **Synthesis: OpenAI TTS.** The narrator script (`scripts/narrate.mjs`) takes the narration-ready text (panel markup stripped, captions/bubbles flattened to read aloud naturally — see the engine-side "chapter → narration text" export) and calls the OpenAI TTS API.
- **Per-biography voice.** The voice is a `voice` field in each biography's `theme.yaml` (§6.3) — so each life *sounds* like itself, the audio counterpart to per-biography theming. (Open question to settle in play: does the Operator's narration use one voice throughout, or does dialogue get distinct voices? Start with one narrator voice per biography; revisit only if it earns its complexity.)
- **Player UI.** An inline audio player on each chapter page, plus a "listen" affordance on the biography ToC. Part of the shared frame. Missing audio degrades gracefully — no broken player when a chapter isn't voiced yet.
- **Cost discipline.** Because synthesis is paid and irreversible-ish (you don't want to burn re-renders), narration runs as its OWN build step, after prose is final for a chapter — not on every site rebuild. `build-site.mjs` renders pages every time; `narrate.mjs` only touches changed chapters and only when invoked.

Design rule for audio: the read is primary; narration is an enhancement a reader opts into, generated cheaply and incrementally, voiced per life.

---

## 6. Content & theme formats (for the generator)

### 6.1 Chapter front-matter (per chapter)
```yaml
---
biography: the-operator
id: ch01-the-arrival
act: "Arc I — The Summoning"
title: "The Arrival"
when: "Day 1 · the cathedral at Sebastopyr"
teaser: "One second in the cab; the next, a room that smells wrong and a voice that knew his name."
tags: [Summoning, ConstraintSight, Story]
convergence: [mnehmos/ch01-the-first-rite]   # shared event, other interiors
engine_log: ledger/the-operator/ch01.json     # the audit trail for this chapter
status: published
---
```

### 6.2 Body — a light panel DSL (so prose isn't raw HTML)
Keep Naruto's manga-panel vocabulary, but as authorable markup the generator expands, not hand-written divs. Indicative:
```
:::panel tone
The room is wrong in a way only he can feel — a structure under load, somewhere above.
:::

:::bubble who="System"
Query received. Ask precisely.
:::

:::sfx
GROAN—
:::

:::roll
Constraint read — DC 14 — rolled 17. The east arch is bearing what three should.
:::
```
The generator maps `panel/bubble/sfx/roll/cap` to the shared component CSS. Authors (and agents emitting chapter content) write the DSL; the build owns the HTML.

### 6.3 Biography theme token set (per biography)
```yaml
# bastion/biographies/the-operator/theme.yaml
name: The Operator
source_world: "contemporary Earth — an Arizona copper mine"
palette:
  night:  "#0d0f10"
  paper:  "#e8e4dc"
  accent: "#d4711c"     # hazard-amber
  metal:  "#8a8f93"
  line:   "rgba(212,113,28,.25)"
type:
  display: "Oswald"        # industrial, stencil-adjacent
  serif:   "Newsreader"
  mono:    "JetBrains Mono"
motif: "load-lines"         # background generator: stress diagrams / survey grid
sigil:  "▣"
voice:  "onyx"               # OpenAI TTS voice for this biography's narration (§5.5)
```
The shared frame reads these tokens at build. Add a biography → drop a `theme.yaml` → its pages render in its world's skin, on the same bones as every other life.

---

## 7. Publishing workflow (the documented convention)

**Bastion updates are generated into the repo's static `docs/` directory and shipped via GitHub Pages.** This is the canonical step; it does not live in anyone's head.

```
1. PLAY        run the biography forward in rpg-mcp; the rite/turns commit to the ledger.
2. EXPORT      export the chapter's narrative + engine log:
                 narrative_manage (story content)  +  ledger entry (engine log JSON)
                 → bastion/biographies/<slug>/chapters/<id>.md  (+ ledger/<slug>/<id>.json)
3. BUILD       node scripts/build-site.mjs
                 renders all biographies + city timeline + devlog → docs/
3b. NARRATE    node scripts/narrate.mjs   (when a chapter's prose is final)
                 OpenAI TTS → docs/<...>/audio/<slug>.mp3, hash-gated;
                 unchanged chapters skipped. Runs as its own step, not every build.
4. REVIEW      open docs/ locally; verify the chapter, its Engine Log, convergence links,
                 and — if voiced — its narration player.
5. SHIP        commit docs/ + source; push to main. GitHub Pages serves docs/.
                 (continuation of the existing push pattern — see CLAUDE.md git-pulse.)
```

Convention notes:
- `docs/` is **generated** — never hand-edit a file under `docs/`; edit content/theme/templates and rebuild. (This is the fix for Naruto's hand-authored drift.)
- One biography update = one build = one commit, so the git history reads as a publishing log.
- The build is idempotent: rebuilding without content changes produces no diff.

---

## 8. Day-one scope (given no chapters exist yet)

Build the **front door now, structured so the rest grows out of it** — same lesson as everything else in this project: ship the entrance, let the rooms fill as the rite runs.

**Phase 0 — the frame + landing (ship now):**
- `docs/index.html` — the Bastion landing: the pitch, the premise, the (initially short) line of biographies, a "first lives incoming" state, and the "how this is made" section. Looks intentional while nearly empty.
- The **shared component frame**: layout, manga-panel CSS, HUD-sheet component, collapsible Engine Log component, the "committed by the System" mark — all built once, theme-driven.
- The **generator skeleton** (`scripts/build-site.mjs`) reading the content/theme formats from §6, even if only one biography stub exists.
- `bastion/biographies/the-operator/theme.yaml` + `bastion/biographies/mnehmos/theme.yaml` as the first two theme sets.

**Phase 1 — the first lives (when Chapter 1 commits):**
- The Operator's biography (hero + HUD + Arc I chapters) and Mnehmos's devlog, both generated from real committed content.
- The **first convergence**: the Operator's arrival and Mnehmos's first rite as the same committed event, cross-linked from two interiors, positioned on `city/timeline.html`. This is the structural promise paying off on the first published page.

**Do NOT** build empty chapter shells or a story index around nothing. The landing + frame + generator is the day-one artifact; biographies slot in as they are run.

---

## 9. Non-negotiables (carried from the project's spine)

- **Reader-first.** A reader who never opens an Engine Log gets a clean novel. The engine layer is always opt-in.
- **The story is the transcript.** Site content is generated from committed state, not authored ahead of it. "Narrate from state, never ahead of it" (Naruto's law) applies to the website too — a chapter cannot claim an outcome the ledger didn't commit.
- **Generated, not hand-built.** `docs/` is build output. Content + theme + templates are the editable surface.
- **Per-biography skin, shared bones.** Every life looks like its source-world; every life runs on the same frame.
- **Convergence is structural, not bolted on.** The data model knows that events can belong to many biographies, from the start.
- **The moat is a feature, never the foreground.** "Every event committed by the System" is the strongest thing we have to say — say it where the curious will find it, never where it interrupts the read.
- **Audio is first-class but cheap.** Narration is a primary output (audiobook episodes), voiced per biography via OpenAI TTS — but generated incrementally and hash-gated so it never re-renders an unchanged chapter. The read never depends on the audio; the audio never blocks the build.

---

*Prior art: `mnehmos.github.io/naruto5e` (the demo). This spec is how Bastion does deliberately, and at scale, what that site did intuitively for one life.*
