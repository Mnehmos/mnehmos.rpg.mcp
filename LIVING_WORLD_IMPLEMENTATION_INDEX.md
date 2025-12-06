# Living World Kernel Upgrade - Implementation Index
**Status:** ✅ TRIAGE COMPLETE - READY FOR IMPLEMENTATION
**Date:** December 6, 2025
**Created By:** Triage Analysis

---

## 📋 DOCUMENT STRUCTURE

### EXECUTIVE DOCUMENTS

**1. TRIAGE_SUMMARY.txt** (START HERE)
   - 📖 Quick 2-minute overview
   - 📊 Key findings at a glance
   - ✅ Success metrics
   - 🎯 Decision checklist
   - **Read this first**

**2. TRIAGE_LIVING_WORLD_KERNEL.md** (DETAILED ANALYSIS)
   - Part 1: Architectural Analysis (what exists, 70% done)
   - Part 2: Integration Analysis (how it fits)
   - Part 3: Risk Assessment (what could go wrong)
   - Part 4: Required Game Design Decisions (what you need to decide)
   - Part 5: Success Criteria (rewritten phases 1-3)
   - Part 6: Game Design Decisions (detailed options with recommendations)
   - Part 7: Dependency Mapping (what blocks what)
   - Part 8: Architecture Compliance (does it follow patterns?)
   - Part 9: Known Issues to Fix First (prerequisites)
   - Part 10: Recommended Handoff Structure
   - **Read this before starting implementation**

### IMPLEMENTATION DOCUMENTS

**3. HANDOFF_LIVING_WORLD_PHASE_1.md** (PHASE 1 SPEC)
   - ✅ Complete implementation spec for Spatial Graph System
   - 📝 All 5 deliverables in detail
   - 🧪 15+ test cases fully written out
   - 📊 Database schema with constraints
   - 🔧 MCP tool signatures with examples
   - ✅ Implementation checklist
   - 🎯 Success criteria and acceptance tests
   - **HAND THIS TO CLAUDE CODE FOR PHASE 1**

**4. HANDOFF_LIVING_WORLD_PHASE_2_OUTLINE.md** (PHASE 2 OUTLINE)
   - ⏳ Forward-looking outline for Phase 2
   - ⚠️ DO NOT START YET - wait for Phase 1 + fixes
   - 📋 Game design decisions needed
   - 🎯 Success criteria for Phase 2
   - 📦 All deliverables outlined
   - ⏱️ Estimated timeline
   - **READ BEFORE PHASE 2 - DON'T IMPLEMENT YET**

**5. LIVING_WORLD_IMPLEMENTATION_INDEX.md** (THIS FILE)
   - 📑 Quick reference and navigation
   - 🗺️ Document relationships
   - ⏭️ What to read/do next
   - 🔗 Cross-references

---

## 🎯 QUICK NAVIGATION BY ROLE

### If You're a MANAGER / DESIGNER
1. Read: `TRIAGE_SUMMARY.txt` (5 min)
2. Ask the team: Game design decisions from Part 6 of `TRIAGE_LIVING_WORLD_KERNEL.md`
3. Approve timeline: Phase 1 (3-4 days), blocking fixes (2 hours), Phase 2 (4-5 days)

### If You're Implementing PHASE 1
1. Read: `TRIAGE_SUMMARY.txt` (understand context)
2. Read: `HANDOFF_LIVING_WORLD_PHASE_1.md` (implementation spec)
3. Follow the checklist - start with schema, then repo, then tools, then tests
4. Use TDD: Write test first, then implementation
5. `npm test -- tests/spatial-graph.test.ts` frequently

### If You're Implementing PHASE 2 (LATER)
1. Wait for Phase 1 to be ✅ COMPLETE
2. Wait for blocking issues to be ✅ FIXED (EDGE-001, EDGE-006, stats)
3. Manager/designer must ✅ APPROVE game design decisions
4. Then: Read `HANDOFF_LIVING_WORLD_PHASE_2_OUTLINE.md`
5. Get full Phase 2 implementation spec (created later)

### If You're Reviewing Code
1. Reference: `TRIAGE_LIVING_WORLD_KERNEL.md` Part 8 (architecture compliance)
2. Check: Are schemas using Zod?
3. Check: Is repository pattern followed?
4. Check: Are tests comprehensive?
5. Check: Does it respect "LLM describes, engine validates" pattern?

### If You're Triaging Bugs Found During Implementation
1. Add findings to `Agents/EMERGENT_DISCOVERY_LOG.md`
2. Reference the original triage: `TRIAGE_LIVING_WORLD_KERNEL.md`
3. If it's a Phase 2 issue, note it for Phase 2 planning
4. If it's architectural, flag for design review

---

## 📊 DOCUMENT RELATIONSHIP MAP

```
DECISION POINT
    ↓
[Manager reads TRIAGE_SUMMARY.txt]
    ↓
[Decide: Phase 1 only, or Phase 1+2?]
    ├─ Phase 1 only?
    │  └─→ Developer gets HANDOFF_LIVING_WORLD_PHASE_1.md
    │      Developer implements (3-4 days)
    │      When done: Phase 2 planning happens later
    │
    └─ Phase 1+2 planned?
       ├─→ Designer approves game design decisions
       │  (from TRIAGE_LIVING_WORLD_KERNEL.md Part 6)
       │
       ├─→ Developer Phase 1
       │  Uses: HANDOFF_LIVING_WORLD_PHASE_1.md
       │
       ├─→ [Phase 1 complete]
       │
       ├─→ Fix blocking issues
       │  (EDGE-001, EDGE-006, stats from TRIAGE Part 9)
       │
       ├─→ Developer Phase 2
       │  Uses: HANDOFF_LIVING_WORLD_PHASE_2_OUTLINE.md
       │  Gets: Full Phase 2 spec (created then)
       │
       └─→ [Phase 2 complete]
           ["Living World" system ready for production]
```

---

## ⏱️ READING ROADMAP

### SHORTEST PATH (5 minutes)
→ `TRIAGE_SUMMARY.txt` only
✅ Understand what's being done, why, and timeline

### MANAGEMENT PATH (15 minutes)
1. `TRIAGE_SUMMARY.txt` (5 min)
2. `TRIAGE_LIVING_WORLD_KERNEL.md` Part 6 (10 min)
✅ Understand decisions needed and timeline

### DEVELOPER - PHASE 1 PATH (30 minutes)
1. `TRIAGE_SUMMARY.txt` (5 min)
2. `HANDOFF_LIVING_WORLD_PHASE_1.md` (25 min)
✅ Ready to start implementation

### COMPLETE ANALYSIS PATH (2-3 hours)
1. `TRIAGE_SUMMARY.txt` (5 min)
2. `TRIAGE_LIVING_WORLD_KERNEL.md` - ALL PARTS (60 min)
3. `HANDOFF_LIVING_WORLD_PHASE_1.md` (30 min)
4. `HANDOFF_LIVING_WORLD_PHASE_2_OUTLINE.md` (20 min)
✅ Complete understanding of system, phases, and implementation

---

## 🔍 FINDING SPECIFIC ANSWERS

### "What exists already?"
→ `TRIAGE_LIVING_WORLD_KERNEL.md` Part 1

### "What's the architecture?"
→ `TRIAGE_LIVING_WORLD_KERNEL.md` Part 2 + Part 8

### "What could go wrong?"
→ `TRIAGE_LIVING_WORLD_KERNEL.md` Part 3

### "What do I need to decide before starting?"
→ `TRIAGE_LIVING_WORLD_KERNEL.md` Part 6

### "What's blocking Phase 2?"
→ `TRIAGE_LIVING_WORLD_KERNEL.md` Part 9

### "How long will Phase 1 take?"
→ `TRIAGE_SUMMARY.txt` Timeline section

### "What tests do I need to write?"
→ `HANDOFF_LIVING_WORLD_PHASE_1.md` Section 5

### "What's the database schema?"
→ `HANDOFF_LIVING_WORLD_PHASE_1.md` Section 3

### "What MCP tools need to be created?"
→ `HANDOFF_LIVING_WORLD_PHASE_1.md` Section 4

### "How do I know when Phase 1 is done?"
→ `HANDOFF_LIVING_WORLD_PHASE_1.md` Success Criteria section

### "What about Phase 2?"
→ `HANDOFF_LIVING_WORLD_PHASE_2_OUTLINE.md`

### "I found a bug during implementation"
→ Reference `Agents/EMERGENT_DISCOVERY_LOG.md` and `TRIAGE_LIVING_WORLD_KERNEL.md` Part 9

---

## ✅ IMPLEMENTATION CHECKLIST

### BEFORE YOU START
- [ ] Managers: Read `TRIAGE_SUMMARY.txt`
- [ ] Managers: Approve timeline and game design decisions
- [ ] Developers: Read `HANDOFF_LIVING_WORLD_PHASE_1.md`
- [ ] Developers: Understand TDD approach

### PHASE 1 IMPLEMENTATION
- [ ] Create schema (`src/schema/spatial.ts`)
- [ ] Create repository (`src/storage/repos/spatial.repo.ts`)
- [ ] Add database migration (`src/storage/migrations.ts`)
- [ ] Add character.currentRoomId column
- [ ] Write tests first (`tests/spatial-graph.test.ts`)
- [ ] Create tools (`src/server/spatial-tools.ts`)
- [ ] Register tools (`src/server/index.ts`)
- [ ] All tests passing
- [ ] `npm run build` succeeds
- [ ] Commit with message: `feat(spatial): Implement persistent room system`

### BEFORE PHASE 2 STARTS
- [ ] Phase 1 ✅ complete and merged
- [ ] Fix EDGE-001 (self-theft prevention) ✅
- [ ] Fix EDGE-006 (victim/fence conflict) ✅
- [ ] Add perception/stealth to character stats ✅
- [ ] Manager approves game design decisions ✅
- [ ] Developers review `HANDOFF_LIVING_WORLD_PHASE_2_OUTLINE.md` ✅

### PHASE 2 IMPLEMENTATION (LATER)
- [ ] Create hearing engine (`src/engine/social/hearing.ts`)
- [ ] Create stealth/perception engine (`src/engine/social/stealth-perception.ts`)
- [ ] Extend npc-memory-tools with `interact_socially`
- [ ] Write 20+ integration tests
- [ ] All tests passing
- [ ] Commit with message: `feat(social): Implement hearing and eavesdropping mechanics`

---

## 🚨 CRITICAL SUCCESS FACTORS

### Phase 1 Must:
1. ✅ Use Zod validation (don't skip)
2. ✅ Use repository pattern (don't use raw SQL in tools)
3. ✅ Write tests first (TDD - RED → GREEN → REFACTOR)
4. ✅ Respect "LLM describes, engine validates" pattern
5. ✅ Persist descriptions (can't be retroactively changed)
6. ✅ Follow existing code patterns (study src/schema/, src/storage/, src/server/)

### Before Phase 2 Must:
1. ✅ Fix EDGE-001 and EDGE-006
2. ✅ Add perception/stealth stats
3. ✅ Finalize game design decisions
4. ✅ Get management buy-in

### Phase 2 Must:
1. ✅ All of Phase 1's constraints
2. ✅ Proper Stealth vs Perception opposed rolls
3. ✅ Spatial awareness (hearing ranges)
4. ✅ Environment modifiers (tavern vs forest)
5. ✅ Memory recording for witnesses only

---

## 🎓 LEARNING RESOURCES

### To Understand the Codebase:
1. Read: `Agents/PROJECT_CONTEXT.md` (architecture overview)
2. Study: `src/schema/character.ts` (example Zod schema)
3. Study: `src/storage/repos/character.repo.ts` (example repository)
4. Study: `src/server/combat-tools.ts` (example MCP tools)
5. Study: `tests/server/*.test.ts` (example tests with Vitest)

### To Understand Game Design:
1. Review: D&D 5e rules for Stealth/Perception
2. Review: Combat mechanics in `src/engine/combat/`
3. Review: NPC memory system in `src/server/npc-memory-tools.ts`
4. Review: EMERGENT_DISCOVERY_LOG.md for context on similar systems

### To Understand TDD:
1. Read: `Agents/TDD_FRAMEWORK.md`
2. Review: Example test in `tests/spatial-graph.test.ts` (in Phase 1 spec)
3. Practice: Write test before implementation for every feature

---

## 📞 DECISION POINTS REQUIRING INPUT

**Manager/Designer must decide:**

1. **Phase 1 only or Phase 1+2?**
   - Phase 1 only: 3-4 days, ships sooner
   - Phase 1+2: 2 weeks, complete system

2. **Hearing Range Formula (for Phase 2)?**
   - Option A: Fixed ranges (simple)
   - Option B: Perception-based (complex)
   - Option C: Environment-aware (immersive) ← Recommended
   - Option D: Hybrid (most complex)
   - See: `TRIAGE_LIVING_WORLD_KERNEL.md` Part 6

3. **Character Description Changes?**
   - Should LLM be able to change room descriptions? (Recommendation: No)

4. **Adjacent Room Hearing?**
   - Should characters in adjacent rooms hear conversations?
   - (Recommendation: Loud shouts yes, whispers no)

---

## 🔗 CROSS-REFERENCES

### From EMERGENT_DISCOVERY_LOG.md:
- EDGE-001: Self-theft logic flaw (blocks Phase 2)
- EDGE-006: Victim/fence conflict (blocks Phase 2)
- NEW-MECH-001: No mechanical transfers (affects Phase 1 design)
- MED-007: No actual dialogue system (future enhancement)

### From PROJECT_CONTEXT.md:
- Tech stack and architecture overview
- MCP tool categories and count (122 tools)
- Test coverage (659 tests)
- Repository locations (frontend/backend)

### From PLAYTEST_PHILOSOPHY.md:
- Why we test the way we do
- Player-centric development approach
- Emergent gameplay focus

---

## 📦 DELIVERABLES SUMMARY

| Phase | What | Status | Duration |
|-------|------|--------|----------|
| **1** | Spatial Graph System (rooms, exits, persistence) | 🟢 SPEC READY | 3-4 days |
| **Fixes** | EDGE-001, EDGE-006, add stats | 🟡 OUTLINED | ~2 hours |
| **2** | Social Hearing Mechanics (overhearing, stealth) | 🟡 OUTLINE READY | 4-5 days |
| **3** | Auto-Mender Dev Tools | 🔴 NOT STARTED | Future |

---

## 🎯 SUCCESS LOOKS LIKE

### Phase 1 Complete:
- ✅ Rooms persist in database
- ✅ Room descriptions locked after creation
- ✅ Rooms link via exits
- ✅ Perception-based exit filtering works
- ✅ All 15+ tests pass
- ✅ Code review approved

### Phase 2 Complete:
- ✅ Whispers heard only by target + neighbors
- ✅ Shouts heard across location
- ✅ Stealth vs Perception rolls working
- ✅ Eavesdroppers see filtered memory entries
- ✅ All 20+ tests pass
- ✅ "Living World" feels alive

---

## 🚀 NEXT STEPS

**For Managers:**
1. Read `TRIAGE_SUMMARY.txt` (5 min)
2. Review game design decisions in `TRIAGE_LIVING_WORLD_KERNEL.md` Part 6
3. Decide: Phase 1 only, or Phase 1+2?
4. Approve timeline

**For Developers (Phase 1):**
1. Read `HANDOFF_LIVING_WORLD_PHASE_1.md` (25 min)
2. Set up test database
3. Start with schema (`src/schema/spatial.ts`)
4. Use TDD throughout
5. Reference `src/schema/character.ts` and `src/storage/repos/character.repo.ts` as models

**For Developers (Phase 2):**
1. Wait for Phase 1 ✅ + fixes ✅ + decisions ✅
2. Then review `HANDOFF_LIVING_WORLD_PHASE_2_OUTLINE.md`

---

## ❓ QUESTIONS?

- **What's being built?** → `TRIAGE_SUMMARY.txt`
- **Why this way?** → `TRIAGE_LIVING_WORLD_KERNEL.md`
- **How to implement?** → `HANDOFF_LIVING_WORLD_PHASE_1.md`
- **What about Phase 2?** → `HANDOFF_LIVING_WORLD_PHASE_2_OUTLINE.md`

---

**Status:** ✅ TRIAGE COMPLETE
**Ready for:** Implementation
**Quality:** Production-ready specification
**Confidence:** 95%

Proceed with Phase 1 implementation.
