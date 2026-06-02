# Competency Mapping — INT → Model + Reasoning Effort

*Honest Crunch at the cognitive level. The model an agent thinks with is determined by their character's INT stat. The author cannot make a low-INT character monologue like a polymath, because the model bound to that stat-tier physically cannot produce that output.*

---

## The claim

The Honest Crunch positioning (see [`06-honest-crunch-positioning.md`](./06-honest-crunch-positioning.md)) said: the engine prevents the author from fudging the numbers. Dice are real. Stats are committed. The audit log records every commit.

This document extends the claim one layer deeper: **the AGENT itself cannot be smarter than the character's INT stat says it can.**

When an agent is invoked, the runtime reads the bound character's `stats.int` and resolves it to an OpenAI `(model, reasoning_effort)` pair via a published mapping table. The agent literally thinks with that model at that reasoning level. The audit log records both. A reader can open the Engine Log on any chapter and verify which model produced which interior.

## Two binding principles

1. **No `pro` variants, anywhere.** The ladder uses base models and `mini` / `nano` cheaper variants only. Where the temptation would be to step up to `o3-pro` / `gpt-5.4-pro` / `gpt-5.5-pro`, the ladder instead bumps `reasoning_effort` on the non-pro model. Pro models are explicitly off the table.
2. **Modulate through `reasoning_effort` within a tier.** When a tier covers more than one INT score, the floor INT uses the cheaper variant or lower effort; the ceiling INT uses the same variant at a higher effort. The mapping never reaches for a more expensive model when more reasoning effort on the same model still resolves cleanly.

## The ladder

| INT | RPG tier | Model | `reasoning_effort` | Note |
|---:|---|---|---|---|
|  1 | Mindless | `babbage-002` | n/a (legacy) | Reflex only. Sense response. No instruction-following expected. |
|  2 | Mindless | `babbage-002` | n/a | Same; minor distinction is descriptive only. |
|  3 | Creature | `davinci-002` | n/a | Slightly more capacity than babbage; still pre-instruction-tuned. |
|  4 | Dull | `gpt-4` (legacy) | n/a | Functional surface automation; restricted depth. |
|  5 | Uneducated | `gpt-oss-20b` | n/a | The Basic Framework — small open architecture. |
|  6 | Uneducated | `gpt-oss-20b` | n/a | Same tier; ceiling on this rung. |
|  7 | Below Average | `gpt-4o-mini` | n/a | The Fast Operator. Straightforward text tasks; no strategy. |
|  8 | Below Average | `gpt-oss-120b` | n/a | Slightly more headroom; still no reasoning loop. |
|  9 | Average | `gpt-4.1-mini` | n/a | Cheaper non-reasoning baseline. |
| 10 | Average | `gpt-4.1` | n/a | **The Smartest Non-Reasoning Baseline.** Peak pure pattern-matching without internal reasoning. |
| 11 | Clever | `o3` | `medium` | Early reasoning. First rung where the model can hold a multi-step plan. |
| 12 | Scholar | `o3` | `high` | Same model, more effort — handles harder logic at higher cost. |
| 13 | Gifted | `gpt-5-nano` | `medium` | Agentic core, smallest variant. |
| 14 | Expert | `gpt-5-mini` | `high` | Cost-sensitive agentic execution at depth. |
| 15 | Genius | `gpt-5.4-nano` | `medium` | Dense, efficient subagent rung. |
| 16 | Master | `gpt-5.4-mini` | `high` | Subagent command tier — computer use, tool integration, nested orchestration. |
| 17 | Archmage | `gpt-5.4` | `medium` | Elite professional reasoning at moderate effort. |
| 18 | Archmage | `gpt-5.4` | `high` | Same model, harder thinking. |
| 19 | God-like | `gpt-5.5` | `high` | Frontier non-pro variant; flawless code execution territory. |
| 20 | Oracle | `gpt-5.5` | `xhigh` | **User-anchored.** Top of the ladder. Approaches what the System itself can adjudicate. |

Implementation notes on the ladder:
- The mapping is monotonic — higher INT never gets a strictly smaller model AND a strictly lower reasoning effort at the same time.
- The ladder is **content**, not engine code. It lives in a YAML/JSON file (`config/competency-ladder.yaml` or similar) and the engine reads it at startup. Tune without redeploying.
- Per-agent **override** allowed via `agent.competencyOverride: { model?, reasoningEffort? }` for explicit DM control. Override is recorded in the audit log so the reader can see it was overridden.
- For INT scores below 7 the agent runtime should consider whether to invoke at all — at very low INT the character may not have the cognitive shape for an LLM-driven persona, and the DM may prefer a deterministic stub. This is a future design question; the ladder records the model in case invocation is requested.
- **Pro variants are out of scope.** If a future need pushes for capacity beyond INT 20, raise `reasoning_effort` on `gpt-5.5` or wait for a new frontier model — never reach for `*-pro`.

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
