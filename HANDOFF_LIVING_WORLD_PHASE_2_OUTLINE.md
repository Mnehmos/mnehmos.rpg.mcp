# HANDOFF: Living World - Phase 2 (Social Hearing Mechanics) - OUTLINE ONLY
**Status:** OUTLINE FOR FUTURE IMPLEMENTATION
**Dependencies:** Phase 1 + blocking issue fixes (EDGE-001, EDGE-006)
**Estimated Time:** 4-5 days with tests

---

## ⚠️ DO NOT START THIS YET

This is a **forward-looking document** created for planning purposes.

**Prerequisites that must be completed first:**
1. ✅ Phase 1 (Spatial Graph) - MUST BE DONE
2. ✅ EDGE-001 fix (self-theft prevention) - MUST BE DONE
3. ✅ EDGE-006 fix (victim/fence conflict) - MUST BE DONE
4. ⏳ Game design decisions finalized (hearing ranges, etc.) - MUST DECIDE

**Only start Phase 2 after all prerequisites are complete and approved.**

---

## PHASE 2 OBJECTIVE

Implement spatial-aware social mechanics where:
- NPCs can hear conversations based on distance and volume
- Stealth vs Perception rolls determine if overhearing succeeds
- Conversation memories are recorded only for those who should hear
- Environment affects hearing ranges (tavern noise vs forest silence)

### PLAYER EXPERIENCE

**Before Phase 2:**
```
Rogue: "I whisper to the Wizard about picking the lock"
Everyone in the party hears (no distance awareness)
The Barbarian 30 feet away somehow heard the secret plan
```

**After Phase 2:**
```
Rogue whispers (WHISPER volume at target)
  → Wizard hears (always)
  → Nearby NPCs within 5 feet hear (Stealth vs Perception)
  → Barbarian 30 feet away hears nothing (outside whisper range)
```

---

## PHASE 2 DELIVERABLES (OVERVIEW)

### 1. Hearing Radius Engine

**File:** `src/engine/social/hearing.ts`

```typescript
interface HearingRangeConfig {
  volume: 'WHISPER' | 'TALK' | 'SHOUT';
  environment: RoomNode; // For atmospheric effects
  listenerPerception: number; // WIS modifier
}

function calculateHearingRadius(config: HearingRangeConfig): number {
  // Returns feet-based hearing radius
  // Accounts for volume, atmospherics, perception
}
```

**Game Design Decisions Needed:**
- Option A: Linear (Whisper = 5ft, Talk = 30ft, Shout = 100ft)
- Option B: Perception-based (base + WIS modifier)
- Option C: Environment-aware (varies by room atmospherics)
- Option D: Complex (combines all factors)

**Recommendation:** Option C for immersion

### 2. Extended NPC Memory Tools

**File:** `src/server/npc-memory-tools.ts` (extend existing)

**New Tool:** `interact_socially`

```typescript
interface InteractSociallyInput {
  speaker_id: string; // UUID of speaker
  target_id?: string; // UUID of intended target (optional for broadcast)
  content: string; // What they're saying
  volume: 'WHISPER' | 'TALK' | 'SHOUT';
  intent: string; // 'gossip', 'interrogate', 'negotiate', etc.
}

interface InteractSociallyOutput {
  success: boolean;
  targetHeard: boolean;
  eavesdroppers: Array<{
    listenerId: string;
    heardFully: boolean; // true if target, false if eavesdropped
    stealthCheck?: {
      speakerRoll: number;
      listenerRoll: number;
      success: boolean;
    };
  }>;
  recordedMemories: number; // How many characters recorded this?
}
```

**Logic:**
1. Validate speaker exists and is in a room
2. Get room and all entities in room + adjacent rooms
3. For target: Record full conversation
4. For eavesdroppers: Roll Stealth (speaker) vs Perception (listener)
   - Success: Record "overheard conversation about..."
   - Fail: Record "saw whispering but couldn't hear content"
5. Store in conversation_memories for each listener

### 3. Helper: Stealth vs Perception Opposed Roll

**Location:** `src/engine/social/stealth-perception.ts`

```typescript
interface OpposedRollResult {
  speakerRoll: number;
  speakerModifier: number;
  speakerTotal: number;

  listenerRoll: number;
  listenerModifier: number;
  listenerTotal: number;

  success: boolean; // listenerTotal >= speakerTotal
  margin: number; // How much they beat it by
}

function rollStealthVsPerception(
  speaker: Character, // For stealth check
  listener: Character, // For perception check
  baseModifier: number = 0 // From environment
): OpposedRollResult {
  // Roll d20 for each
  // Apply DEX modifier for speaker (stealth)
  // Apply WIS modifier for listener (perception)
  // Compare totals
  // Return result
}
```

### 4. Test Suite

**File:** `tests/social-hearing.test.ts`

**Must cover:**
- [ ] Whisper heard only by target + adjacent characters
- [ ] Shout heard across entire location
- [ ] Stealth roll beats low Perception (common case)
- [ ] Perception beats low Stealth (opposite case)
- [ ] Target ALWAYS hears full message (no roll)
- [ ] Eavesdroppers get "overheard" log, not full content
- [ ] SILENCE atmosphere reduces hearing range
- [ ] Multiple listeners with different Perception scores
- [ ] Adjacent room boundaries (hearing through walls?)
- [ ] Conversation memory records only what should be heard
- [ ] Same conversation appears in different listeners' memory with different content
- [ ] Environment modifiers affect hearing rolls
- [ ] No hearing through obstacles (walls, closed doors)
- [ ] DARKNESS doesn't affect hearing (sound still works)
- [ ] Integration with Phase 1 rooms

### 5. Integration Points

**Need to connect with existing systems:**

1. **NPC Memory System**
   - Record in `conversation_memories` table
   - Use existing `record_conversation_memory` tool
   - Link with relationship/importance tracking

2. **Spatial System (Phase 1)**
   - Query room for entities
   - Check room atmospherics
   - Determine hearing ranges based on room type

3. **Character Stats**
   - DEX modifier for Stealth
   - WIS modifier for Perception
   - Conditions that affect hearing (deafness, etc.)

4. **Combat System**
   - Could integrate with surprise/stealth checks in combat

---

## PHASE 2 RISKS & MITIGATIONS

### Risk 1: Complex Opposed Rolls
**Problem:** Stealth vs Perception can be confusing with many listeners
**Mitigation:**
- Resolve all rolls server-side (LLM doesn't see rolls)
- Return clean output: "Overheard" vs "Heard nothing"
- Log rolls in conversation_memories for DM review

### Risk 2: Performance with Many Listeners
**Problem:** If 20 NPCs in same room, checking hearing for each is slow
**Mitigation:**
- Query only entities in room + adjacent rooms
- Cache hearing radius calculations
- Batch roll calculations

### Risk 3: Immersion Breaking
**Problem:** "You hear the Barbarian whisper to himself"
**Mitigation:**
- Whisper range so small (5 ft) that many characters won't hear
- SILENCE atmosphere can prevent eavesdropping entirely
- DM can design room layout to prevent unwanted overhearing

### Risk 4: Game Design Decisions Not Made
**Problem:** Without knowing hearing ranges, can't implement correctly
**Mitigation:**
- Document 4 options in TRIAGE document
- Get approval before starting implementation
- Make ranges configurable (easy to tweak later)

---

## GAME DESIGN DECISIONS FOR PHASE 2

These MUST be decided before implementation starts:

### Decision 1: Base Hearing Ranges
```
Option A: Fixed (Easy to implement)
  Whisper: 5 feet
  Talk:    30 feet
  Shout:   100 feet

Option B: Perception-based (More complex)
  Whisper: 5 + listener.wis_modifier (can be 0-20 feet)
  Talk:    30 + listener.wis_modifier (can be 20-50 feet)
  Shout:   100 + listener.wis_modifier (can be 90-120 feet)

Option C: Environment-aware (Most immersive)
  Tavern (loud): Whisper=0, Talk=10, Shout=30
  Forest (quiet): Whisper=10, Talk=60, Shout=300
  Desert (open): Whisper=15, Talk=100, Shout=500

Option D: Hybrid (Complex)
  Base range from environment
  + Listener.wis_modifier
  - Speaker.dex_modifier (stealth helps)
```

**RECOMMENDATION:** Option C (environment-aware)

### Decision 2: Stealth Bonus for Whispering
```
Should a character get bonus to Stealth when whispering?

Option A: No (stealth is separate from volume)
  Whisper requires low Perception check but no stealth roll

Option B: Yes, minor (+2 bonus)
  Whispering gives +2 to hide attempts

Option C: Yes, major (+5 bonus)
  Whispering significantly harder to detect

Option D: Automatic (no roll for whispers)
  If distance > hearing range, automatic success
```

**RECOMMENDATION:** Option A (separate concerns)

### Decision 3: Adjacent Room Hearing
```
Can characters in adjacent rooms hear conversations?

Option A: No (walls block sound)
  Closed doors prevent all hearing

Option B: Partial (sound travels through walls)
  Loud shouts heard in adjacent rooms, whispers don't

Option C: Yes, with penalty
  Adjacent room listeners take -5 penalty to perception

Option D: Complex (depends on door type)
  Open doors allow hearing, closed doors block, thin walls give -5
```

**RECOMMENDATION:** Option B (realistic, balanced)

### Decision 4: SILENCE Atmosphere Effect
```
What does SILENCE do to hearing?

Option A: Complete silence
  No sounds heard at all (even shouts)

Option B: Suppressed ranges
  All hearing ranges reduced to 50%

Option C: Magical silence
  Can't hear specific target(s), others OK

Option D: Configurable
  SILENCE can specify what's affected
```

**RECOMMENDATION:** Option B (50% reduction)

---

## PHASE 2 IMPLEMENTATION SEQUENCE

1. **Game Design Review** (4 hours)
   - Finalize hearing ranges
   - Finalize stealth/perception rules
   - Document as config constants

2. **Hearing Engine** (1 day)
   - Create `src/engine/social/hearing.ts`
   - Implement `calculateHearingRadius()`
   - Unit tests for radius calculations

3. **Stealth vs Perception** (0.5 day)
   - Create `src/engine/social/stealth-perception.ts`
   - Implement opposed roll logic
   - Unit tests for roll mechanics

4. **MCP Tool** (1 day)
   - Create `interact_socially` in npc-memory-tools.ts
   - Implement witness loop
   - Register in MCP registry

5. **Integration** (1 day)
   - Connect to Phase 1 rooms
   - Connect to character stats
   - Connect to memory system

6. **Testing** (1 day)
   - Write 20+ integration tests
   - Test all scenarios in test suite section
   - Test edge cases

7. **Polish** (0.5 day)
   - Performance optimization
   - Documentation
   - Example scenarios

---

## PHASE 2 SUCCESS CRITERIA

All of the following must work:

```typescript
// 1. Whisper heard only by target
const whisper = await interact_socially({
  speaker_id: 'rogue-1',
  target_id: 'wizard-1',
  content: 'I pick the lock',
  volume: 'WHISPER'
});
expect(whisper.targetHeard).toBe(true);
expect(whisper.eavesdroppers).toHaveLength(0); // 15+ feet away

// 2. Shout heard across location
const shout = await interact_socially({
  speaker_id: 'barbarian-1',
  content: 'CHARGE!',
  volume: 'SHOUT'
});
expect(shout.recordedMemories).toBeGreaterThan(5);

// 3. Stealth beats low perception
const lowPer = createChar({ stats: { wis: 8 } });
const results = [];
for (let i = 0; i < 100; i++) {
  const r = await interact_socially({...});
  results.push(r.eavesdroppers.length);
}
expect(average(results)).toBeLessThan(30); // Low success rate

// 4. High perception beats stealth
const highPer = createChar({ stats: { wis: 18 } });
// ... similar test, expect higher eavesdrop rate

// 5. Memory stores different content for listeners
const target = await getConversationHistory(wizard.id);
expect(target.conversations[0].content).toContain('pick the lock');

const eavesdropper = await getConversationHistory(barbarian.id);
expect(eavesdropper.conversations[0].content).toContain('overheard');
expect(eavesdropper.conversations[0].content).not.toContain('lock');
```

---

## PHASE 2 BLOCKING FIXES NEEDED FIRST

Before starting Phase 2, these MUST be fixed:

### EDGE-001: Self-Theft Logic Flaw
```
// Currently allows this (shouldn't):
await steal_item(thief_id: 'same-char', victim_id: 'same-char', item_id)

// Fix needed:
if (thief_id === victim_id) return { error: 'Cannot steal from yourself' }
```

**Impact on Phase 2:** Prevents nonsensical "overheard self" scenarios

### EDGE-006: Victim Can Be Fence
```
// Currently allows this (shouldn't):
await register_fence(merchant_id) // merchant was stolen from earlier

// Fix needed:
Check if character was recent theft victim
Prevent fence registration or add warning
```

**Impact on Phase 2:** Prevents "character buys back own stolen goods"

### Character Stats: Add Perception/Stealth
```
// Currently missing:
character.skills.stealth (for DEX-based checks)
character.skills.perception (for WIS-based checks)

// Or simpler: Just use stats.dex and stats.wis directly
No need for separate skill scores
```

**Impact on Phase 2:** Needed for opposed rolls

---

## REFERENCE: PHASE 1 OUTPUTS USED BY PHASE 2

Phase 2 depends on Phase 1 providing:

```typescript
// Room with entities and atmospherics
const room = spatialRepo.findById(characterRoom.id);
room.entityIds // Who's in room?
room.atmospherics // ['SILENCE'], ['DARKNESS'], etc.
room.exits // For adjacent room queries

// Character with stats
const char = characterRepo.findById(listenerId);
char.stats.wis // For perception
char.stats.dex // For stealth
char.conditions // Deafness, etc.

// Conversation recording
await recordConversationMemory({
  character_id: listenerId,
  npc_id: speakerId,
  content: whatTheyHeard,
  importance: 'medium',
  timestamp: now
});
```

---

## WHAT NOT TO DO IN PHASE 2

- ❌ Don't implement combat stealth yet (save for Phase 3)
- ❌ Don't create "sound propagation simulation" (too complex)
- ❌ Don't allow LLM to modify hearing ranges (hardcode them)
- ❌ Don't implement multiple languages yet
- ❌ Don't handle "recording devices" or scrying spells
- ❌ Don't implement lip-reading or signing
- ❌ Don't add dynamic atmosphere changes during conversation

---

## READY FOR IMPLEMENTATION WHEN:

1. ✅ Phase 1 (Spatial Graph) is complete and tested
2. ✅ EDGE-001, EDGE-006, and stat additions are fixed
3. ✅ Game design decisions (above) are approved
4. ✅ You have buy-in from DM/designer on hearing mechanics
5. ✅ You're ready to write 20+ tests

Only then should Phase 2 handoff be created and assigned.

---

## ESTIMATED PHASE 2 TIMELINE

- Game design review: 4 hours
- Hearing engine: 8 hours
- Stealth rolls: 4 hours
- MCP tool: 8 hours
- Integration: 8 hours
- Tests: 8 hours
- Polish: 4 hours
- **Total: 4-5 days of focused work**

---

## CONCLUSION

Phase 2 is well-defined but depends on:
1. Phase 1 completing successfully
2. Blocking issues fixed
3. Game design decisions made

Once those prerequisites are met, Phase 2 can be implemented following this outline.

**DO NOT START until prerequisites are complete.**

---

**This document is ready for reference but implementation should not begin until Phase 1 and blocking issues are resolved.**
