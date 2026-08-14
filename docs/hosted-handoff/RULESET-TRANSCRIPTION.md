# Ruleset Transcription Plan

## 1. Purpose

This document defines how Open5e research becomes stable engine data. It is not a runtime integration design.

The first reviewed runtime slice is checked in at `config/open5e-srd-2014-runtime.json`. The engine reads that local artifact; it does not call Open5e during play. Regenerate it manually with `npm run open5e:sync-runtime -- --pack-dir <pinned-pack>` after reviewing and updating the expected pack hash in the generator.

## 2. Source boundary

Use the local Open5e MCP during development to:

- Find candidate records.
- Compare source documents.
- Inspect class, spell, monster, equipment, and condition details.
- Confirm wording and mechanical fields.
- Record source attribution and license information.

Do not:

- Call Open5e during a player turn.
- Let the LLM query Open5e to decide a result.
- Treat a search result as a final rules decision.
- Mix records from incompatible rules versions.

Open5e documents multiple API versions and content sources. The project must record the exact source document and slug used for each transcribed record. See the [Open5e API documentation](https://open5e.com/api-docs) and [legal information](https://open5e.com/legal/).

## 3. Version policy

The initial ruleset identifier is:

~~~text
5e-srd-2014
~~~

The identifier is a compatibility promise, not a claim that every Open5e record shares one document slug.

Examples observed during research:

- A goblin lookup returned a 2014-style stat block with AC 15, 7 hit points, Nimble Escape, scimitar, and shortbow.
- A fighter lookup returned 2014-style class progression and features.
- The 2014 Fireball record was found as srd_fireball.
- A default Fireball lookup could resolve to a 2024 record.

These examples should become transcription fixtures and regression tests after review.

## 4. Transcription workflow

For every record:

1. Identify the desired mechanical version.
2. Query the local Open5e MCP.
3. Record source document, slug, endpoint family, source URL, and retrieval date.
4. Compare the record against the existing engine schema.
5. Normalize names, dice expressions, modifiers, ranges, durations, and prerequisites.
6. Decide whether the engine already supports the mechanic.
7. Add or adapt only the minimum engine behavior required.
8. Write a focused fixture test.
9. Record attribution and unresolved interpretation questions.
10. Mark the record reviewed.

## 5. Content order

### Slice A: character foundation

- Ability scores and modifiers.
- Proficiency bonus.
- Twelve SRD base classes (runtime catalog landed).
- Thirteen SRD species profiles (runtime catalog landed).
- Source-backed background mechanics where the reviewed SRD pack has a selectable profile; custom backgrounds remain supported.

### Slice B: basic play

- Ability checks.
- Saving throws.
- Common skills.
- Basic equipment.
- Armor Class.
- Carrying and inventory limits only if already supported.

The checked-in first slice contains 237 SRD item definitions. Source items are materialized into deterministic engine templates, and reviewed equip-slot/AC mechanics are enforced by the inventory engine.

### Slice C: combat

- Goblin and a small low-level bestiary.
- Weapon attacks.
- Damage expressions.
- Critical hits.
- Death saves.
- Short and long rests.

### Slice D: magic

- Spell slots.
- Spell attack rolls.
- Saving throw spells.
- Concentration.
- A small list of level 1 and level 2 spells.
- Fireball only after the underlying spell model is verified.

### Slice E: conditions and progression

- Prone, restrained, poisoned, blinded, frightened, grappled, and unconscious as supported.
- Milestone advancement.
- Level 2 only after level 1 play is stable.

## 6. Engine mapping

The transcription must map into engine-native concepts:

| Rules concern | Engine responsibility |
|---|---|
| Dice expression | Dice engine |
| Attack vs AC | Combat engine |
| Damage and critical dice | Combat engine |
| Saving throw | Combat engine |
| Spell definition | Spell database/schema |
| Spell validation | Spell validator |
| Concentration | Concentration manager |
| Condition application | Condition engine |
| Item and equipment | Item/inventory services |
| Character progression | Class progression data and service |
| Monster stat block | Creature/encounter data |

If a rule cannot be represented without changing the engine contract, open an ADR before adding a special case.

## 7. Data quality requirements

Every transcribed content record should have:

- Stable engine ID.
- Display name.
- Ruleset ID.
- Source document.
- Source slug.
- Source URL or attribution reference.
- Review date.
- Reviewer.
- Mechanical test fixture where applicable.

## 8. Compatibility rules

- A 2024 record does not silently replace a 2014 record.
- A missing field is not invented by the LLM.
- Ambiguous wording is documented and resolved before launch.
- Rules exceptions are explicit and testable.
- Narrative flavor may be generated; mechanical facts may not.

## 9. License and attribution gate

Before public launch, review the exact source material used, its license, attribution requirements, and product marketing language. Keep source attribution with the transcribed data and publish the required notices.
