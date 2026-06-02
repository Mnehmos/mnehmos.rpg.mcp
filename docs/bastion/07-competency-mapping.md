# Competency Mapping — INT → Model + Reasoning Effort

*Honest Crunch at the cognitive level. The model an agent thinks with is determined by their character's INT stat. The author cannot make a low-INT character monologue like a polymath, because the model bound to that stat-tier physically cannot produce that output.*

---

## The claim

The Honest Crunch positioning (see [`06-honest-crunch-positioning.md`](./06-honest-crunch-positioning.md)) said: the engine prevents the author from fudging the numbers. Dice are real. Stats are committed. The audit log records every commit.

This document extends the claim one layer deeper: **the AGENT itself cannot be smarter than the character's INT stat says it can.**

When an agent is invoked, the runtime reads the bound character's `stats.int` and resolves it to an OpenAI `(model, reasoning_effort)` pair via a published mapping table. The agent literally thinks with that model at that reasoning level. The audit log records both. A reader can open the Engine Log on any chapter and verify which model produced which interior.

## The user-anchored ladder

The user provided one concrete anchor: **INT 20 = `gpt-5.5` at `xhigh` reasoning.** The full ladder below is sketched against that anchor, tunable per session.

| INT | Model | reasoning_effort | What it produces |
|---:|---|---|---|
|  6 | `gpt-5.4-mini` | `none` | Reflex. Sense-detail and surface response only. |
|  8 | `gpt-5.4-mini` | `none` | Plain reactive prose; no second-order observation. |
| 10 | `gpt-5.4-mini` | `low` | Workmanlike. Honest, blue-collar reasoning chains. Default for the Operator and similar craft-competent souls. |
| 12 | `gpt-5.4-mini` | `medium` | Routine professional cognition. Most NPCs the players meet at the table. |
| 13 | `gpt-5.4-mini` | `high` | Skilled-practitioner reasoning; can plan two steps ahead. |
| 14 | `gpt-5.5-mini` | `medium` | First tier where pattern-noticing emerges. |
| 16 | `gpt-5.5-mini` | `high` | Polymath beginner; can connect distant frames. |
| 17 | `gpt-5.5-mini` | `high` | Polymath mid-tier; reads structure and ambiguity. |
| 18 | `gpt-5.5` | `high` | Top-tier human reasoning; multi-step planning, theory-of-mind, surprise insight. |
| 19 | `gpt-5.5` | `high` | At the edge of the human ceiling. |
| 20 | `gpt-5.5` | `xhigh` | **User-anchored.** Approaches what the System itself can adjudicate. Sebastopyr's senior Cantorial Scribes; the Long Confessor; Velim Aurriste; characters whose interior should make the reader feel out-paced. |

Implementation notes on the ladder:
- The mapping is monotonic — higher INT never gets a strictly smaller model AND a strictly lower reasoning effort at the same time.
- The ladder is content, not engine code. It lives in a YAML/JSON file (`config/competency-ladder.yaml` or similar) and the engine reads it at startup. Tune without redeploying.
- Per-agent **override** allowed via `agent.competencyOverride: { model?, reasoningEffort? }` for explicit DM control. Override is recorded in the audit log so the reader can see it was overridden.

## Why this is more than a flourish

In a normal LitRPG, the author can make any character say anything; the INT stat is decoration. A reader feels this when a "low-INT meat-shield" delivers a Sun Tzu quote at the climax. The numbers lied.

In Bastion:
- The author cannot reach past the engine to make a low-INT character monologue like a polymath, because the LLM at that tier physically cannot produce that output.
- The Operator (INT ~10) will sound like an Arizona-mine operator with a sharp eye for hazards — because his agent IS a small, fast, low-reasoning model running at low effort. A reader who has used these models recognizes the shape of their output. The voice is honest at the substrate.
- The senior Cantorial Scribes (INT 18-20) will sound like senior Cantorial Scribes — because their agents ARE polymath-tier models at high reasoning. When they out-think the players, the players know it was earned by the stat, not by the author.
- The Engine Log per chapter renders the `model` and `reasoning_effort` line for every interior. A reader who suspects the author cheated can read the log and audit the model used.

This is the brand line "the first LitRPG the author can't fudge" reaching all the way down to the cognition.

## What this does NOT do

- It does NOT mean smart characters are right. A gpt-5.5-xhigh model still gets things wrong, hallucinates, follows wrong inferences. Higher INT means more compute and more depth, not more truth.
- It does NOT mean the player can't outsmart a high-INT NPC. The PLAYER's intelligence is not capped; the NPC's IS. A clever player can still trap a smart adversary.
- It does NOT replace authorial editing on the PUBLISHED prose. Editing for craft happens after the agent commits its interior. The audit log is the source of truth; the published chapter is the curated version. The transparency is in being able to compare them.
- It does NOT enforce realism. A character can have INT 20 and be wrong about everything they think. The model gives them the COGNITIVE CAPACITY; the persona slice still gives them the worldview, biases, and limits.

## WIS and CHA — open questions per SPEC §11

The user mentioned INT specifically. Two natural extensions remain deliberately open until the prose demands them:

- **WIS** could gate what slice of committed state the agent's prompt sees — a *perception cap*. Low WIS sees only their immediate sensory context; high WIS sees more background, more committed history, more inferential connections.
- **CHA** could gate output length and persuasive-structure permission. Low CHA cannot produce a rhetorically sophisticated speech; high CHA can structure an oration. Less obviously useful than INT or WIS, but available if a chapter needs it.

These are SPEC §11 deliberately-open. Do NOT implement them ahead of need.

## Engine implementation (sketch)

When this becomes a workflow, it will:

1. Add `src/agent/runtime/competency.ts` — a pure function `(intStat: number) => { model: string, reasoningEffort: 'none'|'low'|'medium'|'high'|'xhigh' }`, table-driven from a config file.
2. Extend `src/agent/runtime/invoke.ts` — after resolving the character, but before calling the provider, compute `(model, reasoningEffort)` from `character.stats.int` (or `character.stats.wis` for WIS-anchored agents — TBD). Override with `agent.competencyOverride` if set.
3. Extend `src/agent/provider/openai.ts` — pass `reasoning_effort` through the request body for reasoning-family models (gpt-5*, o1*, o3*, o4*). The existing `isReasoningModel` helper from `fca1cb3` already detects the family; extend to also pass effort.
4. Extend `agent_manage` audit row — record the resolved `(model, reasoning_effort)` and the source (`stat_derived` | `override`) per call.
5. Extend the chapter export — engine-log JSON includes the model + effort line per interior. Website Phase 1 will render it in the Engine Log toggle so readers can audit per chapter.
6. Test matrix — every INT step has a unit test that fixes the resolved `(model, reasoning_effort)`. Mapping is part of canon; tests are the canary.

The ladder file is **content**, not code; it lives at `config/competency-ladder.yaml` so the user can tune without a code change. The mapping function reads it.

## Related canon

- [`docs/bastion/06-honest-crunch-positioning.md`](./06-honest-crunch-positioning.md) — the brand line this extends.
- [`docs/bastion/04-world-brief.md`](./04-world-brief.md) — "It does not lie about the numbers — because the numbers aren't its to invent." That passage now applies to cognition too.
- [`docs/bastion/SPEC.md`](./SPEC.md) §11 — WIS and CHA mappings stay open.
- Memory: [`competency-mapping-int-to-model.md`](../../C:/Users/mnehm/.claude/projects/f--Github-mnehmos-rpg-mcp/memory/competency-mapping-int-to-model.md) — the binding axiom.

---

*Implementation queued after end-to-end workflow `w1d1x79zt` lands its six baseline phases. This is the natural next major build.*
