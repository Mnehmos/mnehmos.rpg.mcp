# Game Design Document

## 1. Product summary

RPG MCP Hosted is a simple browser game in which a player describes what their character attempts and an AI dungeon master responds with a persistent adventure.

The product promise is:

> Sit down, describe what your character does, and continue the same adventure tomorrow.

The game should feel like a great tabletop session with the friction removed:

- No rulebook search required.
- No map setup required.
- No group scheduling required.
- No need to manage dice manually.
- The player can always see why an outcome happened.

The product is not trying to simulate every tabletop rule or provide a general-purpose VTT at launch.

## 2. Player and AI roles

### Player

The player controls one character and chooses intent in natural language. They may say:

- “I listen at the door.”
- “I try to persuade the guard.”
- “I draw my sword and attack the goblin.”
- “I cast fireball near the two enemies.”
- “I search the altar for a hidden compartment.”

The player should not need to know the exact tool or command name.

### Dungeon master

The language model:

- Describes the world.
- Portrays NPCs and monsters.
- Interprets ambiguous player intent.
- Presents consequences.
- Maintains tone, pacing, and continuity.
- Asks clarifying questions when an action is underspecified.

The language model must not:

- Choose or alter dice results.
- Invent hit points, spell slots, or inventory.
- Bypass action validation.
- Grant impossible abilities without an explicit rules exception.
- Rewrite persisted state directly.

### Server

The server:

- Owns campaign state.
- Resolves deterministic rules.
- Rolls dice.
- Validates actions.
- Persists events and messages.
- Enforces subscription entitlements.
- Prevents one player's request from reading another player's campaign.

## 3. Target audience

The first audience is:

- Curious solo tabletop players.
- Players who want a low-commitment evening adventure.
- Existing RPG players who want a fast campaign journal.
- LLM users who enjoy interactive fiction but want real game mechanics.

The first audience is not:

- Competitive tactical players.
- Professional dungeon masters seeking a full campaign-management suite.
- Large groups requiring simultaneous multiplayer.
- Users expecting official proprietary Dungeons & Dragons content.

Marketing language and content licensing require review before public launch. The product should describe itself as an open, 5e-compatible fantasy RPG until the legal position is confirmed.

## 4. Product pillars

### Immediate play

The user should reach a first meaningful decision within five minutes of sign-in.

### Trustworthy rules

Every meaningful mechanical outcome should be inspectable. The player may expand a roll to see the check, modifier, target, and result.

### Persistent continuity

The campaign remembers the character, important NPCs, discovered locations, quests, inventory, injuries, and unresolved consequences.

### Focused simplicity

The product has one primary action: describe what the character does.

### Good writing

The DM response should be vivid but compact. A player should be able to read it quickly and know what choices are available.

## 5. Core game loop

~~~text
Read the scene
  → describe an action
  → server interprets and validates it
  → server resolves rules and persists an event
  → DM narrates the result
  → player chooses the next action
~~~

The loop must work for both freeform exploration and combat.

## 6. First-session experience

### Landing

The landing page has:

- A clear one-sentence product promise.
- A short example of player input and DM response.
- A three-point explanation of persistent character, fair dice, and subscription access.
- One primary call to action.
- Pricing and billing FAQ.

### Onboarding

The player supplies:

- Character name.
- One supported ancestry.
- One supported class.
- A short personality or motivation.

The system generates a short character summary but does not silently assign important mechanical choices.

### Opening scene

The first campaign begins with a clear location, immediate tension, and at least two possible actions. The opening should not require map navigation or extensive lore reading.

### First mechanical beat

Within the first scene, the player should encounter one transparent ability check or social decision. Within the first session, the player should encounter a meaningful risk/reward choice and one optional combat encounter.

## 7. MVP rules

The first ruleset is a deliberately small 2014/SRD-compatible slice:

- Six ability scores and modifiers.
- Proficiency bonus.
- Ability checks.
- Saving throws.
- Attack rolls.
- Armor Class.
- Hit points and damage.
- Natural 20 critical hit and natural 1 automatic miss on attacks.
- Short rests and long rests.
- Basic spell slots.
- Concentration.
- A small set of conditions.
- Death saves.
- Basic inventory and equipped items.
- Experience or milestone advancement, with milestone preferred for the first campaign.

The first class roster should be four classes:

- Fighter.
- Rogue.
- Cleric.
- Wizard.

The first content set should be intentionally small:

- Four to six ancestries.
- A compact equipment list.
- A compact spell list.
- A curated set of low-level monsters.
- A handful of conditions.
- One introductory adventure region.

## 8. DM response format

Every response should contain:

1. Narrative result.
2. Mechanical explanation when a rule was resolved.
3. Current danger or consequence.
4. One or two useful next-action prompts when the scene needs direction.

The DM should not turn every sentence into a menu. Freeform input remains primary.

Example presentation:

~~~text
The goblin's blade scrapes across your shield, throwing sparks into the mud.

Attack: d20 9 + 4 = 13 vs AC 16 — miss.

The goblin retreats toward the broken gate. It is hurt, but it is not alone.
~~~

## 9. Frontend surfaces

### Public page

- Hero.
- Example interaction.
- Pricing.
- Sign-in and subscribe actions.
- Terms/privacy/support links.

### Adventure page

- Narrative transcript.
- Freeform message composer.
- Character summary.
- HP, conditions, spell slots, and inventory count.
- Expandable roll evidence.
- Campaign settings and sign out.

### Mobile behavior

The narrative occupies the main screen. The composer stays reachable at the bottom. Character details open as a drawer or sheet.

### Desktop behavior

The narrative remains primary. Character status is a narrow side panel. A tactical map is explicitly out of scope for launch.

## 10. Subscription product

The first commercial model is one paid recurring plan. Do not create multiple confusing tiers until usage data supports them.

The subscription provides:

- Persistent campaign saves.
- Continued DM turns.
- Character and campaign history.
- Reasonable monthly usage allowance.
- Account and billing portal.

The product may offer a limited demonstration before checkout, but the limit must be server-enforced.

## 11. Non-goals for launch

- Multiplayer.
- User-authored campaigns.
- Full virtual tabletop.
- Fog of war.
- Tactical grid movement.
- Voice interface.
- User-provided model keys.
- Live Open5e lookups.
- Arbitrary remote MCP tool execution.
- Large bestiary or complete class catalogue.
- Automatic conversion between 2014 and 2024 rules.

## 12. Success measures

The first release should measure:

- Sign-in to first action completion.
- Checkout completion.
- First-session completion.
- Return play within seven days.
- Campaign resume success.
- Average turns per active subscriber.
- Server-authoritative rule failure rate.
- LLM response latency and cost.
- Support events caused by lost state or confusing billing.

## 13. Launch acceptance

The game is ready for a private launch when:

- Two separate test accounts cannot see each other's campaigns.
- A player can subscribe, play, leave, and resume.
- A Stripe cancellation removes entitlement after the correct billing state.
- A failed LLM call does not lose the player's action or corrupt campaign state.
- Every combat result is reproducible from a stored event.
- No secret is present in browser-delivered assets.
- The first adventure can be completed without operator intervention.
