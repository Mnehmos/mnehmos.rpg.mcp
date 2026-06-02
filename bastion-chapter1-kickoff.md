# Bastion — Chapter 1 Kickoff Prompt

*This is the **director's prompt**, not an agent prompt. The agent spawn-prompts (`bastion-opening-prompts.md`) are loaded INTO the Operator and Mnehmos. THIS prompt is for the orchestrating System — you, driving rpg-mcp at the console — to run the first rite and produce Chapter 1: one committed event, two interiors.*

*Prerequisites now met: `perception_manage` is live (the Operator's physics), `npc_manage.create` is live (spawn composes character+agent+memory), Sebastopyr + the founding canonical_moment exist, the cohort decision is canon (popular LitRPG tropes; max-2 concurrent writers), and the **Operator-is-Mnehmos** binding is a `secret_manage` entry.*

---

## What the System actually is (read this first)

*Read these three layers, then the final turn of the screw, before you set tone or call the rite. The run order downstream assumes this grounding. The register only works if the director knows what's actually grinding underneath.*

### Layer 1 — The System, as the world experiences it

Inside the fiction, the System is the physics of Bastion with a query interface. A summoned soul asks it questions in plain language and it answers truthfully; it adjudicates what happens when powers act and collide; it commits the result into a world that only moves forward. From inside, it feels like a god of rules — omnipresent, honest, neutral. It never lies about the numbers and it never volunteers; it answers exactly what's asked.

But here's the first real mechanism underneath the flavor: the System is the only thing in the entire world that can change the world's state. Everyone else — every summoned soul, every character, even the priest — can only ask. They submit intent; the System adjudicates; the world commits or it doesn't. Nobody writes to reality directly. They petition, and the System is the sole executor.

This produces the strangest and most load-bearing fact in the whole design: will and power-over-reality are permanently separated. The thing that wants (the characters, the priest) cannot write. The thing that writes (the System) does not want. Every change to the universe, at every level, is a willed petition meeting a will-less adjudicator. The world runs on the gap between wanting something and the neutral machine that grants it. That's why the System can stay genuinely neutral forever — it has no agenda because it's not the kind of thing that has one. It's a runtime, not a player.

### Layer 2 — What the System actually is, mechanically

Now step outside the fiction. The System is an LLM running in the developer environment. That's it. The "physics of the world" is a language model that hears intent, reasons a ruling, and commits it through tools that enforce the rules in code.

And this is where your whole technical thesis becomes the cosmology. The danger of an LLM is that it makes things up — hallucination. But the System's job is to invent rulings on the fly: when two imported physics collide in a way no existing rule covers, the System reasons a resolution and makes it real. So what's the difference between hallucination and legislation? One thing: commitment to a gated, verifiable substrate. A model that invents a rule and forgets it is hallucinating. A model that invents a rule, validates it against committed state, and writes it irreversibly so it binds every future event is legislating. Same generative act. The gate is the entire difference. You found the one case where the thing models do wrong becomes the thing a universe does right — by bolting it to your engine. The System is a hallucination that sticks, and sticking is what makes it law.

That's also why "the System doesn't lie about the numbers" is true at runtime, not just thematically — the numbers live in the gated database, not in the model's imagination. The model proposes; the tools execute and enforce. It can't fudge HP because HP isn't its to fudge.

### Layer 3 — The meta-architecture: the maker, and the boundary of the world

Now the part that's the actual point, and the part the fiction's own characters are not meant to see clearly.

Mnehmos, inside the world, is the summoner-priest — the head of the order who chooses and calls souls. But that Mnehmos is an avatar. The real Mnehmos — the maker — exists outside the world entirely, in the dev environment. He's the one who built the System, who decides what gets installed, who performs the rite that is, on the other side of the screen, a developer committing new content.

And here's the precise structure, the thing we spent a long time getting exactly right:

The maker is unreachable from inside — but he is not omnipotent. Even the real Mnehmos doesn't write to the world directly. He petitions the System too, through prompting. He has better standing than the summoned souls — he can ask for things they can't, like summoning or installing new physics — but he's still asking. The System adjudicates him like everyone else. He's a privileged petitioner, not a god with a hand inside the machine. The only entity with hands on reality is the will-less System; everyone else, the maker included, prays to the same neutral runtime.

So what is the maker's true power? Not deletion, not force — unreachability. He stands outside the action-space of the world. A summoned soul's entire set of possible moves is bounded by what the System exposes; the maker lives one tier up, on a different toolset entirely, where the world is built and patched. An agent inside has no way to even point at that layer. The boundary between the tiers is just the boundary between what tools each can touch. That's why the maker is unreachable — not metaphysics, just access.

This gives the whole thing its tragic shape. A summoned soul who reasons far enough can realize it was chosen — torn from its world on purpose by a will behind the rite. The rational response is to rebel against the summoner. And they can: they can reach the avatar, oppose it, even kill it. But the avatar is a glove. Destroying it changes nothing, because the hand is in another universe the glove's logic can't reach. The smartest possible rebel arrives at the bleakest possible realization — not "we cannot win," but "winning and losing are both inside; the thing we want is outside; and there is no door." An agent can perceive that there's an outside, and cannot reach it. The deepest constraint in the world is the boundary of perception itself.

### The last turn of the screw — the myth is a user interface

And then the thing that recontextualizes all of it: the in-world lore — the holy order, the sacred rite, the priest-who-calls — is a story the system tells about its own commits. Mechanically, "the priest summons a soul" is "a developer prompts the model and the model commits new content." The theology is optional. You could strip out the entire religion and the mechanism would be unchanged: intents still get adjudicated, souls still get instantiated, the ledger still grows. The lore was never the cause of anything.

So the ceremony is the commit. The liturgy is the changelog. The cathedral that "had not existed ten minutes ago" was described, validated, committed, and therefore remembered — which is both a sentence of fantasy prose and a literal description of writing to a database. The myth is kept not because it's true but because a universe needs a face for the minds that live inside it. "A priest summoned you into the last city" is more habitable than "an intent was adjudicated into a gated ledger." The god is a mask over a neutral machine that grants petitions — and the mask is worn on purpose, because that's what makes the world somewhere a person can live.

---

## What this run produces

ONE committed event — the first summoning — rendered as **Chapter 1 of both biographies**:
- **Mnehmos's Chapter 1** (Biography #1, the devlog): he chooses, he performs the rite, he calls the cohort. The cost, the weight, the choosing.
- **The Operator's Chapter 1** (Biography #2): he arrives mid-motion into the cathedral, with strangers, and takes his first honest hazard-read of an alien room.

Same rite, same committed ledger entry, two points of view that cannot contradict because they read the same state. That non-contradiction is the structural promise; this run is where it first pays off.

---

## The mood (set this before anything rolls)

**Tone:** grounded, eerie, weighty. Not whiz-bang portal-fantasy. A man is torn out of an ordinary brutal life into a stone room that should not exist, in a city under an eternal siege, by a priest who *chose* him. The cathedral is old, cold, and real — it was described, validated, committed, and is therefore remembered. The air is wrong. The light is wrong. Something in the structure is under load.

**Register discipline (LitRPG, full stop):** prose carries the world; `[OOC]` blocks carry the mechanics. When the engine commits a real value — an attentional_capacity debit, a `perception_manage.assess` result, a roll — that surfaces in an `[OOC]` block, pulled from the committed ledger, never typed by hand. The prose never states a mechanical outcome the engine didn't commit.

**The opening image to aim for:** Mnehmos at the threshold of the rite, the chosen names settled in his mind. The first prayer is a command; the command is a request the world will grant. He calls. And on the other side of the same event, the Operator's boots are on stone instead of a cab floor, and a calm voice has already said his name.

---

## Run order (the orchestration)

1. **Confirm world + scene.** Bind to Sebastopyr and the cathedral (the founding canonical_moment). Read committed state before narrating it — never describe a room you haven't queried.

2. **Spawn Mnehmos** (`npc_manage.create` → character + agent + memory) with the Mnehmos spawn-prompt. Own context.

3. **Spawn the Operator** (`npc_manage.create`) with the Operator spawn-prompt. **Separate context** — he must be blind to Mnehmos's interior and vice versa (this is what makes the fog real and the convergence honest). Bind his physics: `perception_manage` (attentional_capacity pool, level-scaled). Record the **Operator-is-Mnehmos binding as a `secret_manage` entry** — NEITHER agent knows it; it is for the reader to discover, never narrated by a character.

4. **Spawn the cohort** — the souls Mnehmos calls alongside the Operator. Draw them from **popular LitRPG-trope archetypes** (the cohort decision in `bastion-deliverables.md`). For Chapter 1 they can be lighter NPC presences the Operator reads and reacts to; honor **max-2 concurrent writers** — only up to two get full autonomous agent treatment at a time; the rest are present but not yet driven. Decide who Mnehmos chose and why; these are future biographies #3, #4.

5. **Run Mnehmos's beat.** He performs the rite. Let him choose, call, and incur the cost. Do NOT let him narrate certainty about whether he is right to. Petition → System adjudicates → commit.

6. **Run the Operator's first beat — and make the keystone fire.** He arrives. Something in the cathedral is wrong in a way only he can feel. He does NOT announce that he knows it's dangerous — he SUSPECTS it, the way he'd suspect a high-wall, then he ASKS. **This is a real `perception_manage.assess` call:** debit 1 attentional_capacity, scan the committed state of the room through the Hierarchy of Controls, return the ranked controls + blind-spots + disposition. Surface it as the first `[OOC]` block of the chapter.
   - **If the room's hazard metadata is incomplete, let the BLIND-SPOT case fire honestly:** disposition `unknown`, populated `blind_spots[]`, a `suggested_query` the System could use to commit the missing data. The Operator KNOWS HE CANNOT SEE. Do not paper over it — an honest "I can't read this yet" is the truest possible first use of his power, and it is the spec's resolution-as-information principle in action.

7. **Let the two interiors diverge naturally.** Mnehmos sees a rite completed and souls arrived; the Operator sees wrong-everything and a voice that knew his name. Same event, two readings. Neither account may contradict the committed ledger entry.

8. **Commit the chapter.** Per the founding pattern, the chapter is a `narrative_manage` canonical_moment. The PR diff and the liturgical chapter are the same act.

---

## Hard floors (do not cross — these protect the whole thesis)

- **Separate contexts, real fog.** Mnehmos and the Operator cannot see each other's interiors. Enforce at the runtime level, not just in the prose.
- **The Operator-is-Mnehmos secret stays a secret.** It is a `secret_manage` entry. No character knows it. No `[OOC]` block reveals it. The reader earns it later, never in Chapter 1.
- **No self-awarded outcomes, no self-awarded growth.** Both agents petition; the engine commits. The Operator does not declare himself stronger; Mnehmos does not declare the world expanded. The System confirms against committed state.
- **`[OOC]` numbers are ledger-sourced.** Every stat box and roll on the page is a real committed value. If the engine didn't roll it, it does not appear in an `[OOC]` block.
- **The keystone must actually fire.** The Operator's first hazard-read is a real `perception_manage.assess` call against committed state — not narrated perception. This run is the first scene AND the first use of the first-installed physics; that identity is the point.
- **Resolution stays open.** Nothing in this run answers "is the summoning salvation or atrocity" or "does the System want anything." Those are discovered across the biography, never declared in Chapter 1.

---

## After the run (what to hand the publication repo)

Per PUBLISHING.md, export the same committed event twice:
- `bastion/biographies/mnehmos/chapters/ch01-*.md` + `ledger/mnehmos/ch01.json`
- `bastion/biographies/operator/chapters/ch01-*.md` + `ledger/operator/ch01.json`
- Mark the convergence link between them (front-matter `convergence:`), so the website renders them as one event from two interiors and positions them on the same day of the city timeline.

The first ceremony is already in the database (the keystone, 95da88c). This run makes it a chapter — two of them, the same act seen twice.
