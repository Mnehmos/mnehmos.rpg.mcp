# Competency Mapping — INT → Model + Reasoning Effort

*Honest Crunch at the cognitive level. The model an agent thinks with is determined by their character's INT stat. The author cannot make a low-INT character monologue like a polymath, because the model bound to that stat-tier physically cannot produce that output.*

---

## The claim

The Honest Crunch positioning (see [`06-honest-crunch-positioning.md`](./06-honest-crunch-positioning.md)) said: the engine prevents the author from fudging the numbers. Dice are real. Stats are committed. The audit log records every commit.

This document extends the claim one layer deeper: **the AGENT itself cannot be smarter than the character's INT stat says it can.**

When an agent is invoked, the runtime reads the bound character's `stats.int` and resolves it to an OpenAI `(model, reasoning_effort)` pair via a published mapping table. The agent literally thinks with that model at that reasoning level. The audit log records both. A reader can open the Engine Log on any chapter and verify which model produced which interior.

## Two binding principles

1. **No `pro` variants, anywhere.** Pro models are explicitly off the table. If capacity beyond `gpt-5.5` is ever needed, raise `reasoning_effort` on the non-pro model or wait for a new frontier model — never reach for `*-pro`.
2. **`gpt-5.5` is the default model.** (User override, 2026-06-02.) **All biography-driving agents run on `gpt-5.5`.** The earlier-tier ladder below — `gpt-4o-mini`, `gpt-5-mini`, `gpt-5.4-mini`, etc. — is RETAINED AS REFERENCE for documenting the cognitive shape we *would* prefer per INT, but in practice the smaller models do not produce the register the project requires. Lower tiers are reserved for **non-driving NPCs** (extras the scene needs but who never speak in chapter prose).

**Where INT goes instead.** Character intelligence stays canon at the stat-sheet level. Its effect surfaces in PROSE DISCIPLINE rather than in model selection:
- The persona slice frames the character's cognitive shape (low-INT characters are written with reactive surface-level cadence; high-INT with second-order observation).
- `reasoning_effort` (none / low / medium / high / xhigh) still tracks INT — a low-INT character runs at `low` effort on gpt-5.5; a high-INT character runs at `xhigh`. The model is the same; the depth differs.
- OOC stat readouts (`[OOC]` blocks) make INT visible to the reader: a character with INT 10 sees a smaller information surface in their `:::perception` than a character with INT 18, because the engine returns less detail at lower reasoning effort.
- Authorial discipline does the rest. A low-INT character does not deliver a polymath aside in their interior; the agent's persona forbids it.

## The active ladder (post-2026-06-02 override)

| INT | RPG tier | Model | `reasoning_effort` |
|---:|---|---|---|
|  1–6 | Mindless / Dull | `gpt-5.5` | `none` (or no agent — deterministic stub) |
|  7–8 | Below Average | `gpt-5.5` | `low` |
|  9–10 | Average | `gpt-5.5` | `low` |
| 11–12 | Clever / Scholar | `gpt-5.5` | `medium` |
| 13–14 | Gifted / Expert | `gpt-5.5` | `medium` |
| 15–16 | Genius / Master | `gpt-5.5` | `high` |
| 17–18 | Archmage | `gpt-5.5` | `high` |
| 19–20 | God-like / Oracle | `gpt-5.5` | `xhigh` |

**One model. Reasoning effort tiers. Persona and OOC discipline carry the rest.**

## Reference ladder (cognitive shape per INT — descriptive, not active)

For documentation: the original tier-by-tier model intent, retained so designers can recognize what cognitive shape each INT score represents.

| INT | Cognitive shape | Reference model |
|---:|---|---|
|  1–3 | Reflex / sense response | babbage / davinci legacy |
|  4–6 | Surface automation | gpt-4 legacy, gpt-oss-20b |
|  7–8 | Fast operator | gpt-4o-mini, gpt-oss-120b |
|  9–10 | Smartest non-reasoning baseline | gpt-4.1-mini, gpt-4.1 |
| 11–12 | Early reasoning, multi-step plans | o3 |
| 13–14 | Agentic core | gpt-5-mini, gpt-5-nano |
| 15–16 | Subagent command | gpt-5.4-mini, gpt-5.4-nano |
| 17–18 | Elite professional | gpt-5.4 |
| 19–20 | Frontier non-pro | gpt-5.5 |

The reference ladder is for understanding what an INT score *means* cognitively. The active ladder is what the engine binds.

Implementation notes:
- Per-agent **override** allowed via `agent.competencyOverride: { model?, reasoningEffort? }` for explicit DM control. Override is recorded in the audit log so the reader can see it was overridden.
- For INT scores below 7 the agent runtime should consider whether to invoke at all — at very low INT the character may not have the cognitive shape for an LLM-driven persona, and the DM may prefer a deterministic stub or `none` reasoning.
- **Pro variants are out of scope.** If a future need pushes for capacity beyond gpt-5.5 xhigh, raise `reasoning_effort`, refine the persona, or wait for a new frontier model — never reach for `*-pro`.
- **Non-driving NPCs (extras the scene needs but who never speak in chapter prose) may run on lower-tier models** as a cost optimization. Driving voices — anyone whose interior appears on a published page — runs on `gpt-5.5`.

## Why this is more than a flourish

In a normal LitRPG, the author can make any character say anything; the INT stat is decoration. A reader feels this when a "low-INT meat-shield" delivers a Sun Tzu quote at the climax. The numbers lied.

In Bastion:
- The author cannot reach past the engine to make a low-INT character monologue like a polymath, because the LLM at that tier physically cannot produce that output.
- The Operator (INT ~10) will sound like an Arizona-mine operator with a sharp eye for hazards — because his agent IS a non-reasoning `gpt-4.1` instance. A reader who has used these models recognizes the shape of their output. The voice is honest at the substrate.
- The senior Cantorial Scribes (INT 18-20) will sound like senior Cantorial Scribes — because their agents ARE `gpt-5.4` or `gpt-5.5` at `high`/`xhigh` reasoning. When they out-think the players, the players know it was earned by the stat, not by the author.
- The Engine Log per chapter renders the `model` and `reasoning_effort` line for every interior. A reader who suspects the author cheated can read the log and audit the model used.

This is the brand line "the first LitRPG the author can't fudge" reaching all the way down to the cognition.

## What this does NOT do

- It does NOT mean smart characters are right. A `gpt-5.5` at `xhigh` still gets things wrong, hallucinates, follows wrong inferences. Higher INT means more compute and more depth, not more truth.
- It does NOT mean the player can't outsmart a high-INT NPC. The PLAYER's intelligence is not capped; the NPC's IS. A clever player can still trap a smart adversary.
- It does NOT replace authorial editing on the PUBLISHED prose. Editing for craft happens after the agent commits its interior. The audit log is the source of truth; the published chapter is the curated version. The transparency is in being able to compare them.
- It does NOT enforce realism. A character can have INT 20 and be wrong about everything they think. The model gives them the COGNITIVE CAPACITY; the persona slice still gives them the worldview, biases, and limits.

## WIS and CHA — open questions per SPEC §11

The user anchored INT specifically. Two natural extensions remain deliberately open until the prose demands them:

- **WIS** could gate what slice of committed state the agent's prompt sees — a *perception cap*. Low WIS sees only their immediate sensory context; high WIS sees more background, more committed history, more inferential connections.
- **CHA** could gate output length and persuasive-structure permission. Low CHA cannot produce a rhetorically sophisticated speech; high CHA can structure an oration.

These are SPEC §11 deliberately-open. Do NOT implement them ahead of need.

## Engine implementation (sketch)

When this becomes a workflow, it will:

1. Add `src/agent/runtime/competency.ts` — a pure function `(intStat: number) => { model: string, reasoningEffort: 'none'|'low'|'medium'|'high'|'xhigh' | null }`, table-driven from a config file.
2. Extend `src/agent/runtime/invoke.ts` — after resolving the character, but before calling the provider, compute `(model, reasoningEffort)` from `character.stats.int`. Override with `agent.competencyOverride` if set.
3. Extend `src/agent/provider/openai.ts` — pass `reasoning_effort` through the request body for reasoning-family models (`gpt-5*`, `o1*`, `o3*`, `o4*`, `gpt-5.4*`, `gpt-5.5*`). The existing `isReasoningModel` helper from `fca1cb3` detects the family; extend to also forward effort. For non-reasoning models (`babbage`, `davinci`, `gpt-4*`, `gpt-oss-*`), omit the field.
4. Extend `agent_manage` audit row — record the resolved `(model, reasoning_effort)` and the source (`stat_derived` | `override`) per call.
5. Extend the chapter export — engine-log JSON includes the model + effort line per interior. Website Phase 1 will render it in the Engine Log toggle so readers can audit per chapter.
6. Test matrix — every INT step has a unit test that fixes the resolved `(model, reasoning_effort)`. Mapping is part of canon; tests are the canary.

The ladder file is **content**, not code; it lives at `config/competency-ladder.yaml` so the user can tune without a code change. The mapping function reads it. Tests reference the same file so canon and code agree by construction.

## Related canon

- [`docs/bastion/06-honest-crunch-positioning.md`](./06-honest-crunch-positioning.md) — the brand line this extends.
- [`docs/bastion/04-world-brief.md`](./04-world-brief.md) — "It does not lie about the numbers — because the numbers aren't its to invent." That passage now applies to cognition too.
- [`docs/bastion/SPEC.md`](./SPEC.md) §11 — WIS and CHA mappings stay open.
- Memory: `competency-mapping-int-to-model.md` — the binding axiom.

---

*Implementation queued after the running end-to-end workflow lands its six baseline phases. This is the natural next major build.*
