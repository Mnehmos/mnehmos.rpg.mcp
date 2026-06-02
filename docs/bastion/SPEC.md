# BASTION — Architecture & Build Specification

*A live, multi-genre, agent-driven LitRPG simulation built on rpg-mcp.*
*This document formalizes the design so it can be translated into build targets. It distinguishes what is **specified** (build it) from what is **discovered by running** (don't pre-decide it).*

---

## 0. One-paragraph statement

Bastion is the last walled city of humanity, holding an eternal siege against a hell that overran Earth. It is populated almost entirely by souls *isekai'd* from every conceivable fictional universe by a ritual the holy order performs as doctrine. Mechanically, Bastion is a multi-agent simulation: autonomous agents (imported souls, each carrying their home universe's physics, unmodified) submit **intents**; a neutral adjudicating **System** resolves those intents against a shared, append-only, gated substrate and **commits** the results irreversibly. The books are the biographies of the agents. The world is the ledger. The author instantiates and the System adjudicates — and neither knows the ending, because the ending is a computation that hasn't finished running.

---

## 1. Core ontology — the petition/adjudication model

This is the foundational layer. Everything else sits on it.

- **The System is the only entity with write access to world state.** It is an LLM in the dev environment. It is a *neutral runtime*: it adjudicates; it never picks winners; it has no will.
- **Everyone else — human and agent alike — submits *intents*.** Agents submit intent via tool calls. The human (maker) submits intent via prompting the System. There is no direct-write path for anyone. The channel is identical; only **standing** differs (dev-environment standing vs. in-fiction standing).
- **Will and power-over-state are permanently separated.** The thing with will (the maker, the agents) cannot write. The thing that can write (the System) has no will. Every change to reality, at every layer, is a *willed petition* meeting a *will-less adjudicator*. The universe runs on the gap between wanting and granting.
- This is **"LLM proposes, tool executes" taken all the way up** — the human proposes too. The tool is the only executor.

**Design consequence:** the core primitive to build is the *intent → adjudication → commit* loop. Get that right and the rest is configuration.

---

## 2. The physics model

### 2.1 Powers belong to characters, not universes
- Imported powers arrive **intact and unmodified**. No nerf, no buff, no flattening to a house ruleset. (Marvel model: Superman is just *there* now; everyone else deals with the fact of him.)
- **Power is unique to the character, not the universe.** Two arrivals from the "same kind" of world can carry different exact abilities.

### 2.2 Collisions build, they do not cancel
- When two powers meet, they **interact** — they do not arbitrate to a winner. (A fireball jutsu and a D&D *Fireball* collide midair: a new contested event, both deal damage, both must be answered — dodged, countered, eaten, or locked into a power-struggle.)
- **Nothing is balanced. Nothing is reconciled away.** The friction of unequal, un-reconciled powers sharing a world *is* the drama.
- **Limiting another's power is itself just a power** some character may carry — never a property of the world. The world never caps you; a *person* might, and then you deal with it. (See §7, the Nullifier.)

### 2.3 The System is the interaction engine, not the arbiter
- The System does **not** decide whose physics wins. It owns the **arena**: space, time, momentum, commitment, consequence. It computes the *collision* honestly and commits *what physically happened*.
- **Generative collision-law (real-time patching):** when two physics collide in a way no existing rule covers, the System *reasons a resolution, codes it, tests it against committed state, and commits it as permanent world-law.* The lawbook **accretes** — the first collision of any kind legislates the rule that binds every collision after it.
- This is the **"hallucination is a constraint problem"** thesis inverted into a feature: inventing physics on the fly is *hallucination* if it evaporates and *legislation* if it is coded, tested, and committed to the gated substrate. The gate is the entire difference.

### 2.4 Two-layer architecture (the DLC = the summoning)
The summoning *is* the physics-installation. You cannot spawn a shinobi into a world with no chakra-equivalent; their powers would have nothing to execute against.

- **Layer 1 — Physics Subsystem (the DLC / world-build).** Authored **once per *genre* of power**, *before* the character exists. Defines the laws the archetype runs on: the resource, how it is spent and recovered, how it is shaped into effects, the casting cost (e.g. wind-up / form-time, interruptible), the failure modes, and what it can and cannot do. Installed as **queryable rules**.
- **Layer 2 — Agent (the biography).** Spawned *on top of* an installed subsystem. The arrival's abilities now have a substrate to actuate against.
- **Between the layers:** cross-subsystem collisions are handled dynamically by the interaction engine (§2.3).
- **Net:** authored substrate (deliberate, per-archetype, at summoning) + emergent collision-law (dynamic, at collision).

---

## 3. The time model

### 3.1 The System clock is the only clock
- All events happen on the System clock. The substrate is **append-only**; time is **irreversible**. You cannot rewrite a party's past once another party has acted into the same now — the world has already moved on, and downstream state depends on the committed write.

### 3.2 Time advances by rest, not by uniform ticks
- Time-advancement is **rest-oriented**: it jumps by actions and recoveries, not clock-seconds. Different parties therefore advance on different event-rhythms.

### 3.3 Reconciliation by leapfrog (mutual exclusion)
- Only **one party writes live at a time.** If party A commits a week, **freeze A, run party B forward until B's committed clock reaches A's mark, then cut back.** No two live writes ever race → no contention, no drift. Precision is not required; **ordering** is.

### 3.4 Time-skips are transactions, not empty space
- A frozen stretch is **costed.** When A is frozen for a training week, the System asks what they are doing and **debits the time, credits the progress, and commits it.** The week is not skipped; it is *spent*. Training is a tracked resource.

### 3.5 Time is the scarce resource; resolution is information
- **Opportunity cost is real.** A week sunk into training is a week not spent on staging, logistics, intel, or alliances — and the deadline does not pause. Arrive strong but blind, or informed but underpowered.
- **Resolution = information.** Playing a stretch *granularly* surfaces intel (the thin supply line, the wavering ally, the enemy's tells) that a *compressed* skip never generates. Compressing saves attention but blinds you to what the granularity would have revealed.
- **The System is the resolution arbiter:** per stretch of time, it decides *transaction* (compressed) vs. *lived sequence* (granular) — coarse where nothing is at stake, fine where the world is loading. **Once a stretch is played at a resolution and committed, that is the resolution it happened at, forever.**

---

## 4. The adversary model

- **Antagonists are agents too** — same spawn-shape as any character (§5.2), except what *this* one wants is to break the city. When time advances, they progress their own plots.
- **The deadline is endogenous.** There is no authored "three weeks." The crisis fires **when the enemy finishes** — a function of how their committed turns resolve. Nobody knows when the hammer falls, *including the enemy*, until they have done the work.
- **It is a race condition in the literal sense:** two (or more) processes mutating shared state, outcome determined by ordering. The substrate makes the ordering *real* instead of authorial whim. This is why the clock must be honest (§3) — the winner is whoever's writes land first.
- **The fog is real because contexts are separate.** The enemy-instance cannot read the hero-instance's private state, and vice versa. The System is the only shared truth. The race is genuinely uncertain to *everyone, including the author.*

> **Threat-model hook (Horos / four-channel):** an agent that reasons far enough may campaign against the order. Its tactics map onto the four trust-attack channels — poison the System's information (oracle), spoof perception of who is organizing (perception), attack substrate integrity (verifier/environment), turn other souls against the order (social). The rebellion *is* the red-team. Whether trust in the world survives contact with adversaries who can lie is the trust-calibration question, instantiated as plot.

---

## 5. The production model

### 5.1 Unit of production: the active biography
- **One series = one character's active biography = one autonomous agent living forward into the shared ledger.**
- "**Active**": the subject *predates and exceeds* the telling. Their source-universe history is carried in the spawn-prompt; the biography is the live seam between *who they were* and *who Bastion makes them.* The biographer (the System / the transcript) does not know the next chapter, because the subject has not acted it yet.
- **Series = character = agent-instance = context window.** The wall between books *is* the wall between contexts → **fog of war is a free structural property, not a feature to engineer.**
- **Convergence chapters:** when two contexts touch the same substrate event, that chapter exists in *both* series, told from each interior. Neither account can contradict the other, because both read the same committed event.

### 5.2 The author's job
**Author = instantiate characters as autonomous agent-prompts + adjudicate their collisions onto the System's tool surface.**

The spawn-prompt shape:
> *"You are [WHO], from [SOURCE UNIVERSE]. You have been isekai'd into Bastion. You are both a player and a resident of the city now. What you do is up to you."*

- Each agent acts freely, blind to other agents' interiors.
- The System schedules under mutual exclusion, costs frozen time, commits irreversibly, reconciles onto one timeline, and arbitrates resolution.
- **The books are transcripts.** Suspense is real because the fog is real because the contexts are actually separate.

### 5.3 DLC
- A DLC is **a new biography opening mid-history** — which requires first installing the Layer-1 subsystem the new soul needs (§2.4). The new arrival enters a city that has *already moved*; they are summoned into whatever state the ledger is in on the day they spawn. New playable character, same save file, no reset.

---

## 6. The roster (four biographies)

The internal logic: #1 and #2 are **both the maker** — the summoner and the summoned, the will and the conscript. That is the central irony of the series.

| # | Biography | Role | Relationship to honest physics |
|---|-----------|------|-------------------------------|
| 1 | **Mnehmos, the summoner-priest (avatar)** | The devlog-biography. The maker's *presence* in-world; the will, the maker. His logged acts *are* the build acts. His morality = the project's morality made visible. | N/A — he is the will, not a player |
| 2 | **The Operator** (Mnehmos-the-human) | The maker's avatar *as the summoned*. Heavy-equipment operator from a contemporary Arizona mine; late-night MMO/RPG min-maxer. The tragic-conscript spine. | **Respects** the constraint — eliminate the hazard before acting (hierarchy-of-controls lens) |
| 3 | **The Firefighter** | Audience-aligned original. Wildland/hotshot crew. | **Outruns** the constraint — operational tempo, anchor points, escape routes, never commits without an exit |
| 4 | **The Cheerful Destroyer** | Audience-aligned original. Cosmic naïf from an absurd-power fighting world. The comedic/cosmic counterweight. | Has to **learn** the constraint *exists* — raw power is necessary but not sufficient; you cannot punch the deadline |

**The Operator's interior conflict is the world's whole thesis localized into one nervous system:** by night he games systems for fun (consequence-free; death is respawn); by day he respects lethal physics (a mine is honest lethal physics with a query interface). The isekai merges the two rooms — a world that *presents* as the night game but *is* the day mine.

**The Nullifier (dark star / lurking antagonist-fear):** an import whose power is *"your physics stops working near me."* The scariest possible arrival — not stronger, but **deletes the thing that makes everyone else who they are.** It is also the shadow of the maker (see §8): local suppression is to the Nullifier as global unreachability is to Mnehmos.

### Market rationale (why this roster)
LitRPG's #1 reader drop-cause is the protagonist (a flat/passive/system-illiterate MC). Every roster slot satisfies all five demand vectors by construction:
1. **Competence + agency** — all four are experts in their source domain who *drive*.
2. **Distinctive voice** — four professions/worlds that cannot be confused on the page.
3. **Earned progression** — builds derive from real expertise, never a free legendary class.
4. **Genuine stakes/loss** — the engine makes failure real (fog + honest clock + autonomous adversary).
5. **Specialized build identity** — constraint-perception / tempo-and-escape / unbounded-power, not generic DPS.

The thing readers most *want* (a smart MC gaming a real system, making consequential choices, who can actually lose) is the thing this engine uniquely delivers **honestly** — because the instance is really deciding and the adversary's progress is really hidden.

---

## 7. Power & narrative tiers (final form)

| Tier | Entity | Nature |
|------|--------|--------|
| Runtime | **The System** | Operates inside the world. The only thing with hands over state. Neutral. No will. |
| In-world authority | **The administrators (holy order)** | Agents with system prompts, given roles, performing a dance. They do not *hold* authority — they *play* holders of it. Set dressing / a ritual interface over the build pipeline. No real apparatus behind them; destroy the order and there is nothing behind it. |
| Presence | **The avatar of Mnehmos** | The maker's presence inside the world. Reachable, killable, **disposable.** Destroying it changes nothing upstream — it is a glove; the hand is in another universe. |
| Maker | **Mnehmos (real, in dev env)** | Stands **outside the action-space.** Not stronger — **unreachable.** His power is a *boundary*, not a button, and it is total precisely because it never has to be used. *And even he cannot write directly* — he submits intents through prompting the System and is adjudicated like everyone else (§1). A **privileged petitioner**, not an actor. |

**The rebellion's true tragedy:** the only winning move is one the world does not contain. To reach the maker, an agent would have to act *outside* the substrate — impossible by construction. The smartest possible rebel reasons all the way to the bleakest realization: *winning and losing are both inside; the thing we want is outside; there is no door.* The deepest constraint is the boundary of perception itself — an agent can *see* there is an outside and cannot reach it.

---

## 8. The myth-as-UI principle

- The in-world lore — the holy order, the rite, the priest-who-calls — is a **narrative the System tells about its own commits.** The theology is **optional**: strip it out and the mechanism is unchanged (intents still adjudicate, souls still spawn, the ledger still writes). The lore was never the *cause*.
- **The ceremony *is* the commit. The liturgy *is* the changelog.** Identical act, two registers. The devlog-biography (#1) is the seam where both are true at once: the avatar raises its hands and speaks the summoning *at the same moment* you, in the dev environment, install the DLC and spawn the agent.
- The myth is kept **not because it is true but because minds need a story to live inside.** A universe needs a face, even when the face is a mask over a neutral machine that grants petitions.

---

## 9. Monetization & IP boundaries

### 9.1 Products
- **Sponsor-a-biography.** A sponsor supplies a *brief*; you spawn an **original** character to those specs and run its biography. (Commissioned fiction — the brief becomes a spawn-prompt.)
- **Subscribe-to-influence.** Influence means **briefs and reactions between committed volumes** — turn-based: read what happened → submit a brief for what the character attempts next → run → commit → repeat.

### 9.2 Hard boundaries (build these into intake)
- **Cadence:** influence is **between volumes only.** Mid-stream redirection collapses the autonomous-agent magic into a puppet show and destroys the fog/commitment that make the engine special. *Do not sell mid-stream control.*
- **Identity boundary:** briefs take **traits and concepts, never identities.** "A sarcastic cyberpunk field-medic who reminds me of me" = fine. "My coworker Dave, here's his photo" = forbidden. The product is *original characters built to a brief.*
  - The only person a customer may base a character on is **a consenting self** (which is why Mnehmos-the-human is fine — the maker fictionalizing himself, with consent). This permission does not transfer to third parties.

### 9.3 IP strategy (the moat)
- **Never import named licensed characters.** Import the **abstracted mechanic / genre-physics** and give it original names: *trainable-channeled-energy* (not "chakra"), *unbounded power-tiers via training* (not a specific franchise's hero), etc. These are genre physics — unowned, like "mana" or "hit points."
- **What you own:** the **catalog of installable physics subsystems** and the **generative process** that builds and runs them. That is the defensible asset; no one can copy *a city that ingests and concurrently runs the physics of every fictional genre* without building your engine.

---

## 10. Build targets (the translation to rpg-mcp)

Derived directly from the spec above. Listed roughly in dependency order. Most map onto, or extend, existing rpg-mcp surface.

1. **Intent → Adjudication → Commit loop (the petition window).** The core primitive (§1). A structured submission path where any actor (agent via tool call, or human via prompt) expresses intent; the System adjudicates against committed state; the result commits or is refused. *Everything else is configuration on this.*

2. **Gated, append-only substrate (the ledger).** The single source of truth (§3.1). Committed, irreversible, verified. The thing that makes "legislation, not hallucination" true (§2.3) and "ordering, not precision" sufficient (§3.3). Extends the existing verified/gated recording layer.

3. **Physics-Subsystem Installer (Layer-1 / DLC mechanism).** A generative process to define and install a new power-physics subsystem as **queryable rules** (§2.4): resource, spend/recovery, effect-shaping, casting cost / wind-up, failure modes, capability bounds.

4. **Agent Spawn mechanism (Layer-2).** Instantiate a biography-agent from the spawn-prompt shape (§5.2): bind it to its installed subsystem(s); give it a **separate context** (this is what makes fog real); register it with the scheduler.

5. **Interaction Engine (cross-subsystem collision + legislation).** On collision with **no covering rule**: reason a resolution → validate against committed state → **commit it as permanent collision-law** (§2.3). Requires: collision detection/trigger, a legislation step, a validation/test step, and an irreversible rule-commit.

6. **Turn Scheduler + Clock.** Mutual-exclusion scheduling — **one live writer at a time** (§3.3); rest-oriented time advancement (§3.2); **time-skip-as-transaction** — debit time, credit progress, commit (§3.4); per-stretch **resolution arbitration** — transaction vs. lived sequence (§3.5).

7. **Reconciliation / Leapfrog controller.** Freeze / run-to-mark / cut-back across parties; keep committed clocks **ordered** (§3.3). The adversary's endogenous deadline (§4) runs on this same mechanism.

8. **Biography Recorder (the output / transcript layer).** Render each agent's committed acts as its series; handle **convergence** — one committed event surfaced from two interiors, both true (§5.1).

9. **Mnehmos devlog binding.** Bind the maker's build acts (subsystem installs, spawns, the "ceremony") to **biography #1** so the changelog *is* the liturgy (§8). Each erasure-or-mercy and each summoning is logged here.

### Recommended first build
> **The Operator's constraint-perception subsystem** — a structured query against committed state that returns the **load-bearing constraint / failure mode** of a situation (the hierarchy-of-controls lens as a mechanic). It is the subsystem closest to what rpg-mcp already does (it *is* a typed query over committed state), it validates the full **Layer-1 → Layer-2** pipeline on the most-developed character, and — under §8 — building it *is* Mnehmos's first ceremony, which is the first DLC, which is the **first page of biography #1.** The first build and the first scene are the same act.

---

## 11. Deliberately open — discovered by running, not specified

These are *not* gaps in the spec. They are answered by spawning agents and watching, per the project's own thesis. Pre-deciding them would defeat the engine.

- **Does the System want anything?** (It can stay a neutral runtime forever, or carry a buried purpose; its visible job is identical either way.)
- **Is the summoning salvation or atrocity?** (Answered by Mnehmos's character, revealed in the devlog one act at a time — embodied, not declared.)
- **When an agent gets close enough to the truth to threaten the order, does Mnehmos (via an administrator) delete them, hesitate, or mistake the target?** (Tyrant-god / tragic-god-losing-faith / Horos-failure-as-moral-catastrophe — this recurring choice *is* his character.)
- **Do any two biographies converge — and do they part again or not?** (The agents choose in the shared space; the instant they choose, it commits and is set in stone.)

---

*End of specification. The cathedral is built. The next move is the first adjudicated intent.*
