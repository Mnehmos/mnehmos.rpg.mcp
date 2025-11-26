# Unified MCP Simulation Server — Master Build Checklist (TDD Focus)

## 0. PROJECT PRINCIPLES

- [ ] **Determinism First:** All systems must produce identical output from identical seeds.
- [ ] **Schema-Driven Development:** Every tool input/output validated using Zod schemas.
- [ ] **TDD Driven:** All functionality must be introduced *through tests first*.
- [ ] **Structured, LLM-Safe:** Map editing, world generation, and combat use strict typed structures.
- [ ] **Small Surface Area:** Build minimal valuable components before expanding.
- [ ] **Multi-Transport Stability:** Support stdio, Unix socket, and TCP from day one.
- [ ] **Zero Hidden State:** All state must be explicit in storage, logs, or schemas.
- [ ] **Replayable:** Every operation yields deterministic event logs.

### 0.1 CODE REVIEW SAFETY CHECKLIST

Before marking any phase as complete, ALL code must pass this checklist:

#### ✅ Determinism Safety
- [ ] No `Math.random()` anywhere in codebase (use seedable PRNG)
- [ ] No `Date.now()` or `new Date()` in production code (use seed-derived time)
- [ ] Test fixtures use deterministic constants (`FIXED_TIMESTAMP = '2025-01-01T00:00:00.000Z'`)
- [ ] No floating global state or side effects

#### ✅ Schema Safety
- [ ] All I/O validated by Zod schemas (no unvalidated data paths)
- [ ] NEVER use `z.any()` (use `z.unknown()` with runtime validation instead)
- [ ] All types derived from schemas via `z.infer<>` (no manual type drift)
- [ ] Integer fields use `.int()` validation (hp, stats, coordinates, counts)
- [ ] Numeric fields have reasonable `.min()` and `.max()` bounds
- [ ] Enums defined in schemas match database CHECK constraints

#### ✅ Type Safety
- [ ] No `as any` type assertions (define proper typed interfaces)
- [ ] No silent coercions (e.g., `Number(x)` without validation)
- [ ] Database result types explicitly defined (no untyped SQL)
- [ ] Type guards used for discriminated unions (e.g., `isNPC()` helper)

#### ✅ Test Coverage
- [ ] Tests written BEFORE implementation (TDD discipline)
- [ ] Positive test cases (happy path)
- [ ] Negative test cases (invalid inputs, missing records, constraint violations)
- [ ] Edge cases (empty arrays, boundary values, multiple items)
- [ ] All tests use deterministic fixtures

#### ✅ Repository Pattern
- [ ] Input validation before DB writes (parse incoming data)
- [ ] Output validation after DB reads (parse outgoing data)
- [ ] Proper NULL handling for optional fields
- [ ] No logic in migrations (migrations are schema-only)

#### ✅ Database Integrity
- [ ] Foreign key constraints match schema relationships
- [ ] CHECK constraints enforce enum values
- [ ] NOT NULL constraints mirror required Zod fields
- [ ] Unique constraints prevent duplicate records
- [ ] ON DELETE CASCADE for dependent entities

#### ✅ Code Quality
- [ ] No duplicated logic (extract to helper functions)
- [ ] Clear variable naming matching domain concepts
- [ ] Module boundaries respected (correct folder placement)
- [ ] Public API exports tested
- [ ] No dead code or commented-out logic

### 0.2 REFLECTION PROTOCOL

After completing each major phase (Schema, Storage, World Gen, Combat, MCP):

1. **Run Full Test Suite** — All tests must pass green
2. **Run Code Review Checklist** — Address all blocking issues
3. **Document Learnings** — Add reflection section to Task Map
4. **Fix Blockers Before Proceeding** — No phase advancement until clean
5. **Update Best Practices** — Incorporate new patterns discovered

---

## 1. INITIATION

### 1.1 Repo & Project Setup
- [x] Create new repository with clean structure
- [x] Initialize TypeScript project with `"strict": true`
- [x] Add `.editorconfig`, `.gitignore`, `README.md`
- [x] Configure test runner (Vitest or Jest)
- [ ] Configure CI for lint + type-check + test

### 1.2 Dependencies
- [x] Install: `typescript`, `tsup/esbuild`, `zod`
- [x] Install: `better-sqlite3`, `seedrandom`, `uuid`
- [x] Install: testing libs (`vitest`, `supertest`)
- [x] Configure scripts: `test`, `test:watch`, `build`, `dev`

### 1.3 Clone Azgaar (Reference Only)
- [ ] Clone https://github.com/Azgaar/Fantasy-Map-Generator into `/reference/azgaar/`
- [ ] Add LICENSE notes
- [ ] Document what we will and will not reuse

---

## 2. SCHEMA LAYER (WRITE TESTS FIRST)

### 2.1 Core Schemas
- [x] Write failing tests describing desired objects:
  - [x] `World`
  - [x] `Region`
  - [x] `Tile`
  - [x] `Biome`
  - [x] `RiverPath`
  - [x] `Structure`
  - [x] `Character`, `NPC`
  - [x] `Encounter`, `Token`
  - [x] `MapPatch`, `Annotation`
- [x] Implement minimal Zod schemas to satisfy tests
- [x] Validate JSON compatibility

### 2.2 REFLECTION: Schema & Storage Review (Code Review Findings)
**Status**: ✅ COMPLETE

#### Critical Fixes Completed:
- [x] **BLOCKER 1**: Replace all `new Date()` calls in tests with deterministic fixtures
- [x] **BLOCKER 2**: Remove `z.any()` from MapPatchSchema
- [x] **BLOCKER 3**: Add `.int()` validation to all integer fields
- [x] **BLOCKER 4**: Remove `as any` type assertions in repos
- [x] **BLOCKER 5**: Add negative test cases to all repo tests

---

## 3. STORAGE LAYER (TDD)

### 3.1 SQLite Setup
- [x] Configure SQLite client with safe synchronous mode
- [x] Write tests for migrations:
  - [x] `worlds`
  - [x] `regions`
  - [x] `tiles`
  - [x] `structures`
  - [x] `rivers`
  - [x] `patches`
  - [x] `characters`, `npcs`
  - [x] `encounters`
  - [x] `battlefield`
  - [x] `audit_logs`
  - [x] `event_logs`

### 3.2 Repository Layer
For each repo:
- [x] Write failing CRUD tests
- [x] Implement minimal repo functions
- [x] Validate schema before DB writes
- [x] Validate schema after reads
- [x] Test deterministic data integrity

### 3.3 REFLECTION: Storage Layer Review
**Status**: ✅ COMPLETE

Use Code Review Safety Checklist (§0.1) to validate:
- [x] All repos follow validation pattern (in + out)
- [x] All negative test cases implemented
- [x] No `as any` assertions remain
- [x] Database constraints match schemas
- [x] Test suite passes green (63 tests passing)

---

## 4. WORLD GENERATION (TDD + INSPIRED BY AZGAAR)

### 4.1 Algorithm Research Tests
- [x] Snapshot Azgaar output for a seed
- [x] Write tests describing expected:
  - [x] Terrain continuity
  - [x] Biome plausibility
  - [x] River validity (placeholders for Section 4.5)
- [x] These tests serve as *quality gates*

### 4.2 Heightmap Generator
- [x] Write tests for seed → heightmap determinism
- [x] Implement layered noise heightmap
- [x] Add ridges/tectonic hints (inspired by Azgaar)
- [x] Normalize and validate elevation ranges

### 4.3 Climate Layer
- [x] Tests for temperature gradient by latitude
- [x] Tests for moisture distribution consistency
- [x] Implement climate model

### 4.4 Biome Assignment
- [x] Tests for biome correctness based on (temp, moisture)
- [x] Implement lookup-table biome mapper

### 4.5 Rivers
- [x] Tests: rivers must flow downhill
- [x] Tests: branch correctness & no loops
- [x] Implement drainage + flow accumulation

### 4.6 Structures & Regions
- [ ] Tests defining correct region segmentation
- [ ] Settlement placement rules:
  - [ ] Cities near coasts
  - [ ] Towns near rivers
- [ ] Implement minimal generator

### 4.7 REFLECTION: World Generation Review
**Status**: ⏳ PENDING — Run after world gen complete

Use Code Review Safety Checklist (§0.1) to validate:
- [ ] All generation uses seedable PRNG (no Math.random)
- [ ] Same seed produces identical worlds
- [ ] All algorithms deterministic and reproducible
- [ ] Generated data validates against schemas
- [ ] Test suite confirms quality gates

---

## 5. WORLD EDITING DSL (TDD)

### 5.1 DSL Parsing
- [ ] Write tests for valid DSL commands:
  - [ ] ADD_STRUCTURE
  - [ ] SET_BIOME
  - [ ] EDIT_TILE
  - [ ] ADD_ROAD
  - [ ] MOVE_STRUCTURE
  - [ ] ADD_ANNOTATION

### 5.2 Patch Engine
- [ ] Test patch application → world diff
- [ ] Test patch reversion
- [ ] Test patch history correctness
- [ ] Implement DSL → MapPatch transformer

### 5.3 REFLECTION: DSL & Patch Review
**Status**: ⏳ PENDING — Run after DSL implementation

Use Code Review Safety Checklist (§0.1) to validate:
- [ ] Patch operations deterministic and reversible
- [ ] All patches validated by MapPatchSchema
- [ ] Patch history reproduces exact state
- [ ] No side effects or hidden mutations
- [ ] Test coverage includes edge cases

---

## 6. COMBAT ENGINE (TDD)

### 6.1 Deterministic RNG
- [ ] Test seed consistency
- [ ] Test dice roll determinism

### 6.2 Combat Rules
- [ ] Tests for attack rolls, saving throws
- [ ] Tests for damage calculations
- [ ] Tests for movement + AoO
- [ ] Implement minimal rules to satisfy tests

### 6.3 Encounter Simulation
- [ ] Test turn order mechanics
- [ ] Test conditions & state diffs
- [ ] Implement deterministic encounter loop

### 6.4 REFLECTION: Combat Engine Review
**Status**: ⏳ PENDING — Run after combat implementation

Use Code Review Safety Checklist (§0.1) to validate:
- [ ] All dice rolls use seeded PRNG
- [ ] Same combat seed produces identical results
- [ ] Turn order deterministic
- [ ] State transitions validated by schemas
- [ ] All combat rules tested (positive + negative cases)

---

## 7. SPATIAL REASONING (TDD)

### 7.1 LOS
- [ ] Write tests for obstruction detection
- [ ] Implement LOS algorithm

### 7.2 AoE Tools
- [ ] Tests for cone/sphere/line intersection
- [ ] Implement geometry engine

### 7.3 Pathfinding
- [ ] Tests for shortest path validity
- [ ] Integrate deterministic pathfinding

### 7.4 REFLECTION: Spatial Reasoning Review
**Status**: ⏳ PENDING — Run after spatial systems complete

Use Code Review Safety Checklist (§0.1) to validate:
- [ ] All geometry algorithms deterministic
- [ ] Edge cases tested (diagonal, corners, boundaries)
- [ ] Coordinates validated against world bounds
- [ ] LOS/AoE calculations reproducible
- [ ] Pathfinding returns consistent results

---

## 8. MCP LAYER (TDD)

### 8.1 Transport Servers
- [ ] Tests: stdio echo server
- [ ] Tests: TCP request/response
- [ ] Tests: Unix socket request/response
- [ ] Implement servers

### 8.2 MCP Tool Metadata & Introspection
- [ ] Tests for:
  - [ ] get_tool_metadata
  - [ ] get_schema
  - [ ] get_server_capabilities

### 8.3 Full Tool Surface
Write failing tests for:
- [ ] generate_world
- [ ] apply_map_patch
- [ ] preview_map_patch
- [ ] get_world
- [ ] get_region_map
- [ ] get_world_map_overview
- [ ] Combat tools
- [ ] Character/world CRUD tools

Implement only enough code to satisfy tests.

### 8.4 REFLECTION: MCP Layer Review
**Status**: ⏳ PENDING — Run after MCP tools implemented

Use Code Review Safety Checklist (§0.1) to validate:
- [ ] All tool inputs validated by Zod schemas
- [ ] All tool outputs validated by Zod schemas
- [ ] Error responses follow MCP spec
- [ ] Transport servers handle disconnects gracefully
- [ ] Tool metadata accurate and complete
- [ ] Integration tests cover full request/response cycle

---

## 9. EVENT STREAMING (TDD)

### 9.1 Pub/Sub
- [ ] Test subscription registration
- [ ] Test event push
- [ ] Test world + combat notifications

### 9.2 Streaming Protocol
- [ ] Implement JSON events over socket streams

### 9.3 REFLECTION: Event Streaming Review
**Status**: ⏳ PENDING — Run after streaming implementation

Use Code Review Safety Checklist (§0.1) to validate:
- [ ] Events validated by schemas
- [ ] Subscription management deterministic
- [ ] No race conditions in event delivery
- [ ] Reconnection handling tested
- [ ] Event ordering preserved

---

## 10. AUDITING & LOGGING (TDD)

### 10.1 Audit Logs
- [ ] Tests for audit record creation
- [ ] Test filtering by tool/time/requestId
- [ ] Implement audit logging

### 10.2 Replay Logs
- [ ] Tests: replay reproduces identical state
- [ ] Implement replay generator

### 10.3 REFLECTION: Auditing & Logging Review
**Status**: ⏳ PENDING — Run after audit/replay implementation

Use Code Review Safety Checklist (§0.1) to validate:
- [ ] All operations logged with deterministic timestamps
- [ ] Replay produces identical state from logs
- [ ] Audit logs validated by schemas
- [ ] No PII leakage in logs
- [ ] Log filtering and querying tested

---

## 11. PACKAGING & DISTRIBUTION

### 11.1 Build Pipeline
- [ ] Test build artifact existence
- [ ] Generate unified JS bundle

### 11.2 Binary Packaging
- [ ] Optional: `pkg` or `nexe` tests for binary execution

---

## 12. COMPLETION CRITERIA

- [ ] All tests pass green
- [ ] All MCP tools validated
- [ ] World generation deterministic and high-quality
- [ ] Combat simulation deterministic
- [ ] Visualizer geometry correct
- [ ] Event streaming stable
- [ ] Cross-platform binaries build successfully
