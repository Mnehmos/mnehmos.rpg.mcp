# Honest Crunch — Verified LitRPG

*The marketing positioning. Bastion's strongest differentiator in plain reader-facing prose. Backed by code, not vibes.*

---

## The claim

**In 99% of LitRPG, the stats are decorative theater.** The author decides the hero wins, so the hero's strength stat is exactly what it needs to be. The dice "happen to" roll high in the climax. The system "happens to" surface the perfect skill at the perfect moment. The numbers serve the narrative.

**In Bastion, the numbers cannot be fudged.** Every die roll is rolled by a real RNG with a recorded seed. Every state change passes through a schema gate before it's allowed to commit. Every commit is logged in an append-only ledger. The author cannot reach past the engine to nudge a result. **Even the maker, in-fiction and out, has to ask — and the System grants or refuses by rule.**

This is **Honest Crunch**: the property that the LitRPG's mechanical claims are *enforced* by the substrate, not narrated. If the ledger says a character takes lethal damage, they take lethal damage. There is no plot-armor escape hatch, because there is no escape hatch.

---

## Why this matters to a reader

Progression readers are burnt out on overpowered, untouchable protagonists. The genre's central promise — "I want to watch a character earn power one verified step at a time" — gets broken every time an author lets a stat-block be cosmetic.

What Bastion delivers instead:

- **The numbers on the character sheet are the numbers the engine reads.** When Mira casts Fireball, the engine reads her spell-save DC off her sheet, rolls the target's save with a logged seed, applies damage from the dice it actually rolled. The number on the page is the number the engine used.
- **The protagonist can lose.** Not because the author chose tension — because the dice said so. The fight is real. The plan can fail. The clock can run out.
- **The world doesn't pause for the hero.** Time-skips are transactions: a week training is a week the antagonist also got to act in. Choices cost.
- **Power is real, not balanced.** A summoned ninja brings real chakra. A summoned wizard brings real spellcraft. They don't get nerfed to fit a house ruleset. When their physics collide, the collision is computed honestly — both deal damage, both have to answer.
- **The reader can audit the prose.** Every chapter has an Engine Log toggle. The reader can open it and see the actual tool calls that committed the scene. If you doubt that the swing missed, the log shows you the d20 result and the AC it failed to beat.

This is what you get when *the System cannot lie and the System has no will*.

---

## Why this is true (the proof points)

It is real because of how the engine is built. The audit at [`docs/bastion/05-world-brief-vs-tool-surface.md`](./05-world-brief-vs-tool-surface.md) verified each of these against the actual source.

**Every die roll is seeded and persisted.**
[`src/math/dice.ts:1-11`](../../src/math/dice.ts) uses seedrandom with an explicit seed stored on the result; [`src/server/consolidated/math-manage.ts:96-123`](../../src/server/consolidated/math-manage.ts) persists every roll via `CalculationRepository` with the seed at line 107. Open any roll's record and you can re-roll it deterministically by hand.

**Every state change passes through a schema gate.**
[`src/utils/action-router.ts:182-203`](../../src/utils/action-router.ts) runs `schema.safeParse` on every tool call. Invalid petitions produce **no commit** — not an apologetic narration, not a softer outcome, no commit at all. The truth gate has no override.

**The System answers exactly what's asked — it does not volunteer.**
[`src/utils/action-router.ts:146-203`](../../src/utils/action-router.ts) executes only the single handler matched. No broadcast. No proactive suggestion. The audit logger writes asynchronously in a `finally{}` block and **never modifies the returned response** ([`src/server/audit.ts:66-99`](../../src/server/audit.ts)). The four meta tools (`search_tools`, `load_tool_schema`, `subscribe_to_events`, `unsubscribe_from_events`) exist precisely so the LLM has to *ask* for schema and events. Pull, not push.

**The System has no will of its own.**
The router has no agent, no preference, no scheduler-initiated invocation. The fuzzy matcher ([`src/utils/fuzzy-enum.ts:133-197`](../../src/utils/fuzzy-enum.ts)) is symmetric across all valid actions. Persona lives in [`src/server/consolidated/agent-manage.ts`](../../src/server/consolidated/agent-manage.ts), never in the router. The thing that grants and the thing that wants are different things by construction.

**Even the maker cannot route around the gate.**
[`SYSTEM.md:25`](../../SYSTEM.md) declares: *"Every mechanical fact you assert must have been produced by a tool call."* There is no admin-only tool in [`src/server/consolidated/index.ts:1-54`](../../src/server/consolidated/index.ts). The maker's standing differs from a player's; the channel is identical.

The brief calls this "the law of reality itself, with a query interface." The audit calls it the **strongest fit** in the entire codebase.

---

## The market gap, in one paragraph

LitRPG promises "watch a real character grow inside a real system." But the genre's secret is that the system is usually theater — the dice happen to roll high when the plot needs them to, the stats happen to add up when the author wants them to, and the protagonist's plot armor is the actual physics. Readers can feel this. The complaint surfaces as "the MC is too overpowered" or "the stakes are fake" or "the system reads as inconsistent." The cause is always the same: the author is allowed to lie about the numbers, and they do.

Bastion's engine is the first published LitRPG substrate where **the author structurally cannot lie about the numbers**. Every chapter is a transcript of a verifiable computation. Every die roll has a seed. Every commit has a hash. The Engine Log is a public audit trail. The protagonist can really lose because the System will really commit it. **That is what we sell.**

---

## How to say it

A few one-line versions to keep on the shelf. Match the register to the surface.

**Tagline:**

> Bastion. The first LitRPG the author can't fudge.

**Tighter:**

> Verified LitRPG. The numbers don't lie.

**Pitch sentence:**

> Bastion is a LitRPG where every die roll is rolled, every chapter is a verifiable computation, and the protagonist can actually lose — because the System commits the truth and even the author has to ask for the result.

**Devlog opener (for the publication site):**

> The dice are real. The seed is logged. The author asked for the same thing the protagonist asked for, and the System returned the same number to both. This chapter is what came back.

**Anti-pitch (when someone asks "why should I care"):**

> Because every time you read a LitRPG and thought "that fight was rigged in the hero's favor," you were right. In Bastion you can open the engine log and check.

**Banner copy:**

> Honest Crunch.
> Verified LitRPG.
> The numbers don't lie because the author can't write them.

---

## What stays deliberately out

A few things the positioning must NOT promise, because the engine deliberately does not deliver them:

- **It is not "balanced."** Power is not normalized across summoned souls. The melting-pot physics is the texture; promising balance would defeat it.
- **It is not deterministic.** Honest does not mean predictable. The dice can still roll high — they just roll for real.
- **It is not optimized.** Verifiable computation costs more than narrative shortcuts. We trade speed for honesty, on purpose.
- **It is not infallible.** The author *cannot lie about the numbers*. They can still write a bad sentence. The honest engine is the floor of integrity, not the ceiling of quality.

---

## Related canon

- [`docs/bastion/04-world-brief.md`](./04-world-brief.md) — the storytelling charter; the "System hears plain language and answers truthfully" passage is the in-fiction version of this doc's claims.
- [`docs/bastion/05-world-brief-vs-tool-surface.md`](./05-world-brief-vs-tool-surface.md) — the audit that verified the strong-fit findings cited above.
- [`SYSTEM.md`](../../SYSTEM.md) — the operating charter; standing rules 1, 2, 4, 8, 9 are the LLM-facing version.
- [`docs/bastion/SPEC.md`](./SPEC.md) §1 (petition/adjudication), §7 (power tiers) — the engineering charter's grounding.
