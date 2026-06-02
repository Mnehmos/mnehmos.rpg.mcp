# Bastion — Resolved Decisions (PD 606 author log)

*Three architectural beats locked in by the maker. These were open in
the deliverables manifest; they are no longer open. Subsequent design
work must honor them.*

## I. The publication has its own repo

- Location: **F:/Github/mnehmos.bastion/** (sibling to rpg.mcp).
- Why: reader-facing product has a different audience and lifecycle
  from the engine. Engine is the moat; Bastion is the artifact.
- Engine repo retains: SPEC.md, SYSTEM.md, docs/bastion/ (canon +
  integration), scripts/seed-bastion.ts, consolidated tools.
- Publication repo holds: bastion/biographies/<slug>/chapters/*.md,
  ledger/<slug>/<id>.json, themes (theme-operator.yaml + theme-
  mnehmos.yaml), scripts/build-site.mjs + scripts/narrate.mjs, docs/
  output (GitHub Pages target).

## II. Cohort = popular LitRPG tropes; max-2 concurrent writers

- Composition: souls Mnehmos summons alongside the Operator embody
  recognizable LitRPG archetypes (min-maxer, cheerful destroyer,
  spreadsheet mage, unkillable tank, relentless crafter, lore-
  master, etc.). Each role already in the reader's vocabulary.
- Scheduling: **at most TWO biographies write live concurrently.**
  The spec §3.3 leapfrog scheduler is tightened: |active_writers|
  ≤ 2; one freezes while the other advances toward the held mark.
  Engine implication: turn_manage (or successor) tracks an active-
  writer set capped at 2.
- Production implication: other biographies are frozen; their time
  is debited and credited per §3.4 when they unfreeze.

## III. Operator = Mnehmos (hidden + arbitrary)

- **Canonical fact:** the Operator (biography #2, Arizona-mine
  heavy-equipment operator) IS another version of Mnehmos —
  literally another Mnehmos summoned by the summoner-priest avatar.
  Not a parallel, not an analog.
- **Hidden knowledge:** concealed from every in-world adjudicator,
  every other agent, and the Operator himself. Sebastopater
  chancery, Cantorial Scribes, Inquisition Readers all read him
  clean. The aspersoir does not measure this doubling.
- **Arbitrary:** no in-world justification. Mnehmos chose. Maker-
  prerogative per spec §7, exercised in its rawest form.
- **Engine implication:** at Operator spawn time, a secret_manage
  entry records the Mnehmos-binding (visibility dm_only). Mnehmos's
  persona slice MAY reference it; the Operator's MUST NOT.
- **Narrative implication:** the devlog-biography (#1) and the
  conscript-biography (#2) are the same person from two interiors
  that cannot meet. The convergence chapter, when it comes, is the
  Operator failing to recognize himself.

## What stays open

Per spec §11: does the System want anything; is the summoning
salvation or atrocity; when does Mnehmos delete a soul who threatens
the order; do biographies converge. Discovered by running, not
specified.

---

*PD 606. Three decisions land. The critical path is unblocked.*
