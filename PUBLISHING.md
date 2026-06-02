# Bastion — Publishing Workflow

*Canonical home for the Bastion publishing convention. This workflow originated in [`bastion-website-spec.md`](./bastion-website-spec.md) §7; it lives here so it doesn't drift inside a longer spec and can be referenced as a standalone procedure.*

---

## Header — provenance

- **Origin:** `bastion-website-spec.md` §7 ("Publishing workflow — the documented convention").
- **Canonical home:** this file (`PUBLISHING.md`) is now the single source of truth for the publish step.
- **Scope:** how a committed scene in the rpg-mcp ledger becomes a published page (and, when narrated, an audio episode) on the Bastion site, served from `docs/` via GitHub Pages.

If website-spec §7 ever disagrees with this file, **this file wins** and §7 should be updated to point here.

---

## Thesis

**Bastion updates are generated into the repo's static `docs/` directory and shipped via GitHub Pages.** One command per step, one commit per publish, written down so the pipeline does not live in anyone's head.

The site is the *fan-out* of one committed event: one ledger entry can produce a chapter page, an engine-log audit panel, a city-timeline mark, a convergence cross-link, and — when invoked — narration audio.

---

## The five steps (canonical order)

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

### Step 1 — PLAY
Run the biography forward in rpg-mcp. The rite, the turns, the rolls — all of them commit to the ledger. Nothing about the chapter is authored ahead of the commit: **narrate from state, never ahead of it.**

### Step 2 — EXPORT
Two files come out of the engine per chapter:
- `bastion/biographies/<slug>/chapters/<id>.md` — front-matter + prose (panel DSL allowed; see website-spec §6.2).
- `ledger/<slug>/<id>.json` — the audit trail behind that chapter, the content of the collapsible Engine Log.

The export is mechanical: `narrative_manage` content becomes the `.md`; the committed ledger entries become the `.json`. There is no editorial step between commit and export.

### Step 3 — BUILD
```
node scripts/build-site.mjs
```
Reads all `bastion/biographies/*` content + themes + ledger exports and renders the full site into `docs/`. The build is **idempotent**: rebuilding without content changes produces no diff.

### Step 3b — NARRATE (hash-gated, on its own step)
```
node scripts/narrate.mjs
```
- Runs **only when a chapter's prose is final** — not on every build.
- Calls OpenAI TTS, using the per-biography `voice` field in `theme.yaml`.
- Writes `docs/<...>/audio/<slug>.mp3` (filename = chapter slug).
- **Hash-gated** via `audio/.hashes.json`: the narrator hashes each chapter's narration text and re-synthesizes ONLY when it has changed. Unchanged chapters are a no-op.

This rule is **non-negotiable**. TTS calls cost money and time; the pipeline must never re-voice an untouched chapter.

### Step 4 — REVIEW
Open `docs/` locally. Verify:
- the chapter renders;
- its Engine Log expands and matches the ledger;
- convergence links resolve (the same event from another interior loads);
- the city timeline carries the new mark;
- if voiced, the audio player works on the chapter page and on the biography ToC.

### Step 5 — SHIP
Commit `docs/` together with the source content/theme changes; push to `main`. GitHub Pages serves `docs/`. This is a continuation of the existing push pattern documented in `CLAUDE.md` (the git-pulse rule).

One biography update = one build = one commit. The git history reads as a publishing log.

---

## Invariants (do not violate)

1. **`docs/` is generated. Never hand-edit a file under `docs/`.**
   Edit content (`bastion/biographies/<slug>/chapters/*.md`), themes (`bastion/biographies/<slug>/theme.yaml`), or templates — and rebuild. This is the fix for the Naruto5e site's hand-authored drift, and the reason the build is idempotent.

2. **Hash-gated narration only.**
   `narrate.mjs` MUST consult `audio/.hashes.json` and skip any chapter whose narration text hash is unchanged. Re-voicing unchanged chapters is a bug, not a no-op-with-cost.

3. **One commit per publish.**
   The source change, the regenerated `docs/`, and (when present) the new `.mp3` ship in the same commit. Reviewers should be able to read the commit and see exactly what changed in the published world.

4. **Narrate from state, never ahead of it.**
   A chapter's `.md` cannot claim an outcome the ledger didn't commit. The export is the contract — content is downstream of commitment.

5. **The build is idempotent.**
   Running `build-site.mjs` twice without content changes produces zero diff. If a rebuild produces a diff with no content change, that is a generator bug.

---

## Acceptance — when is a publish "done"

- `docs/` is regenerated from the current content + themes + ledger.
- The new/changed chapter pages render, their Engine Logs match the committed ledger, and any convergence links resolve.
- If narrated this round: the slug-matched `.mp3` is present under the chapter's `audio/` directory and `audio/.hashes.json` reflects the new hash.
- A single commit on `main` contains both the source changes and the regenerated `docs/`.
- GitHub Pages picks up the push and serves the new state.

If all five hold, the publish is done. If any fails, fix at the corresponding step — do not patch by hand-editing `docs/`.

---

*See also:* `bastion-website-spec.md` (the full website spec, of which §7 was the seed of this file), `bastion-deliverables.md` (the manifest tracking PUBLISHING.md's status), and `CLAUDE.md` (the git-pulse rule the SHIP step extends).
