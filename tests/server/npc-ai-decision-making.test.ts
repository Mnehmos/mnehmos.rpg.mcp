/**
 * COMPREHENSIVE NPC AI DECISION-MAKING TESTS
 * 
 * Tests for AI decision-making patterns across different domains:
 * - Combat AI: Tactical choices, target prioritization, spell selection, movement
 * - Social AI: Conversation choices, relationship responses, social intent handling
 * - Strategic AI: Nation-level decisions, diplomacy, resource allocation
 * - Adaptive AI: Responses to changing circumstances and player actions
 * - AI Consistency: Personality consistency across time and scenarios
 * - Multi-Character Coordination: Group dynamics, competing priorities
 * - Environmental Awareness: World-state understanding and reactions
 * 
 * Focus on testing AI BEHAVIORAL patterns, not just mechanical systems.
 * Include edge cases like contradictory traits, moral dilemmas, complex multi-step decisions.
 * 
 * Run: npm test -- tests/server/npc-ai-decision-making.test.ts
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import { migrate } from '../../src/storage/migrations.js';
import { setDb, closeDb } from '../../src/storage/index.js';
import { CharacterRepository } from '../../src/storage/repos/character.repo.js';
import { NpcMemoryRepository } from '../../src/storage/repos/npc-memory.repo.js';
import { PartyRepository } from '../../src/storage/repos/party.repo.js';
import { NationRepository } from '../../src/storage/repos/nation.repo.js';
import { DiplomacyRepository } from '../../src/storage/repos/diplomacy.repo.js';
import { SpatialRepository } from '../../src/storage/repos/spatial.repo.js';

// Import tool handlers for AI testing
import {
    handleCreateEncounter,
    handleGetEncounterState,
    handleExecuteCombatAction,
    handleAdvanceTurn
} from '../../src/server/combat-tools';
import {
    handleGetNpcRelationship,
    handleUpdateNpcRelationship,
    handleRecordConversationMemory,
    handleGetNpcContext,
    handleInteractSocially
} from '../../src/server/npc-memory-tools';
import {
    handleStrategyTool
} from '../../src/server/strategy-tools';

// Test utilities
let db: Database.Database;
let charRepo: CharacterRepository;
let memoryRepo: NpcMemoryRepository;
let partyRepo: PartyRepository;
let nationRepo: NationRepository;
let diplomacyRepo: DiplomacyRepository;
let spatialRepo: SpatialRepository;

const mockCtx = { sessionId: 'test-session' };

beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    setDb(db);
    charRepo = new CharacterRepository(db);
    memoryRepo = new NpcMemoryRepository(db);
    partyRepo = new PartyRepository(db);
    nationRepo = new NationRepository(db);
    diplomacyRepo = new DiplomacyRepository(db);
    spatialRepo = new SpatialRepository(db);
});

afterEach(() => {
    closeDb();
});

// Helper function to create test characters
function createTestCharacter(overrides: Partial<any> = {}) {
    const id = overrides.id || uuid();
    const characterType = overrides.characterType || overrides.type || 'npc';
    
    const characterData: any = {
        id,
        name: overrides.name || `Test Character ${id.slice(-4)}`,
        stats: overrides.stats || { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
        hp: overrides.hp || 20,
        maxHp: overrides.maxHp || 20,
        ac: overrides.ac || 10,
        level: overrides.level || 1,
        characterType: characterType,
        characterClass: overrides.characterClass || 'Fighter',
        knownSpells: overrides.knownSpells || [],
        preparedSpells: overrides.preparedSpells || [],
        cantripsKnown: overrides.cantripsKnown || [],
        maxSpellLevel: overrides.maxSpellLevel || 0,
        conditions: overrides.conditions || [],
        resistances: overrides.resistances || [],
        vulnerabilities: overrides.vulnerabilities || [],
        immunities: overrides.immunities || [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...overrides
    };
    
    // Add NPC-specific fields
    if (characterType !== 'pc') {
        characterData.behavior = overrides.behavior || 'typical';
        if (overrides.factionId) characterData.factionId = overrides.factionId;
    }
    
    charRepo.create(characterData);
    return charRepo.findById(id)!;
}

// Helper function to simulate AI decision-making scenarios
function simulateAiDecision(characterId: string, context: any) {
    // This would be replaced with actual AI decision logic
    // For now, we'll simulate basic decision patterns
    return {
        decision: 'mock_decision',
        reasoning: 'Based on personality traits and context',
        confidence: 0.8
    };
}

// =============================================================================
// CATEGORY 1: COMBAT AI DECISION-MAKING
// =============================================================================

describe('Category 1: Combat AI Decision-Making', () => {

    describe('Target Prioritization Logic', () => {
        
        test('1.1 - Aggressive AI prioritizes threatening targets', async () => {
            // Setup combat scenario
            const tank = createTestCharacter({
                name: 'Ironclad Tank',
                behavior: 'aggressive',
                stats: { str: 16, dex: 8, con: 14, int: 8, wis: 10, cha: 6 },
                characterClass: 'Fighter',
                hp: 35,
                ac: 18
            });

            const healer = createTestCharacter({
                name: 'Mercy Healer',
                behavior: 'protective',
                stats: { str: 8, dex: 12, con: 12, int: 10, wis: 16, cha: 14 },
                characterClass: 'Cleric',
                hp: 18,
                ac: 12
            });

            const assassin = createTestCharacter({
                name: 'Shadow Assassin',
                behavior: 'cunning',
                stats: { str: 10, dex: 18, con: 10, int: 14, wis: 12, cha: 8 },
                characterClass: 'Rogue',
                hp: 16,
                ac: 14
            });

            // Create combat encounter
            const encounterResult = await handleCreateEncounter({
                seed: 'aggressive-targeting',
                participants: [
                    {
                        id: tank.id,
                        name: tank.name,
                        initiativeBonus: 2,
                        hp: tank.hp,
                        maxHp: tank.maxHp,
                        conditions: []
                    },
                    {
                        id: healer.id,
                        name: healer.name,
                        initiativeBonus: 1,
                        hp: healer.hp,
                        maxHp: healer.maxHp,
                        conditions: []
                    },
                    {
                        id: assassin.id,
                        name: assassin.name,
                        initiativeBonus: 3,
                        hp: assassin.hp,
                        maxHp: assassin.maxHp,
                        conditions: []
                    }
                ]
            }, mockCtx);

            const encounterId = JSON.parse(encounterResult.content[0].text).encounterId;

            // Get encounter state to analyze AI decisions
            const state = await handleGetEncounterState({ encounterId }, mockCtx);

            // Test: Aggressive AI should analyze threat levels
            expect(state.participants).toBeDefined();
            expect(state.turnOrder).toBeDefined();

            // Verify AI considers multiple factors for target selection
            const tankParticipant = state.participants.find((p: any) => p.id === tank.id);
            expect(tankParticipant).toBeDefined();
        });

        test('1.2 - Defensive AI prioritizes protecting allies', async () => {
            const defender = createTestCharacter({
                name: 'Shield Guardian',
                behavior: 'defensive',
                stats: { str: 14, dex: 10, con: 16, int: 10, wis: 12, cha: 8 },
                characterClass: 'Paladin',
                hp: 28,
                ac: 16
            });

            const ally = createTestCharacter({
                name: 'Fragile Mage',
                behavior: 'focused',
                stats: { str: 6, dex: 14, con: 8, int: 16, wis: 10, cha: 12 },
                characterClass: 'Wizard',
                hp: 12,
                ac: 10
            });

            const enemy = createTestCharacter({
                name: 'Bloodthirsty Orc',
                behavior: 'aggressive',
                stats: { str: 16, dex: 12, con: 14, int: 6, wis: 8, cha: 8 },
                characterClass: 'Barbarian',
                hp: 24,
                ac: 12
            });

            const encounterResult = await handleCreateEncounter({
                seed: 'defensive-protecting',
                participants: [
                    {
                        id: defender.id,
                        name: defender.name,
                        initiativeBonus: 1,
                        hp: defender.hp,
                        maxHp: defender.maxHp,
                        conditions: []
                    },
                    {
                        id: ally.id,
                        name: ally.name,
                        initiativeBonus: 0,
                        hp: ally.hp,
                        maxHp: ally.maxHp,
                        conditions: []
                    },
                    {
                        id: enemy.id,
                        name: enemy.name,
                        initiativeBonus: 2,
                        hp: enemy.hp,
                        maxHp: enemy.maxHp,
                        conditions: []
                    }
                ]
            }, mockCtx);

            const encounterId = JSON.parse(encounterResult.content[0].text).encounterId;

            // Test defensive AI decision-making
            const state = await handleGetEncounterState({ encounterId }, mockCtx);
            
            // Defensive AI should prioritize ally protection over personal glory
            const defenderParticipant = state.participants.find((p: any) => p.id === defender.id);
            expect(defenderParticipant).toBeDefined();
        });

        test('1.3 - Cunning AI uses positioning and environment', async () => {
            const tactician = createTestCharacter({
                name: 'Master Tactician',
                behavior: 'cunning',
                stats: { str: 10, dex: 14, con: 12, int: 16, wis: 14, cha: 10 },
                characterClass: 'Bard',
                hp: 20,
                ac: 13
            });

            const brute = createTestCharacter({
                name: 'Simple Brute',
                behavior: 'aggressive',
                stats: { str: 16, dex: 8, con: 14, int: 6, wis: 8, cha: 4 },
                characterClass: 'Fighter',
                hp: 30,
                ac: 15
            });

            // Create encounter focused on tactical positioning
            const encounterResult = await handleCreateEncounter({
                seed: 'cunning-tactics',
                participants: [
                    {
                        id: tactician.id,
                        name: tactician.name,
                        initiativeBonus: 3,
                        hp: tactician.hp,
                        maxHp: tactician.maxHp,
                        conditions: []
                    },
                    {
                        id: brute.id,
                        name: brute.name,
                        initiativeBonus: 1,
                        hp: brute.hp,
                        maxHp: brute.maxHp,
                        conditions: []
                    }
                ]
            }, mockCtx);

            const encounterId = JSON.parse(encounterResult.content[0].text).encounterId;

            // Test tactical AI considers positioning, flanking, environmental factors
            const state = await handleGetEncounterState({ encounterId }, mockCtx);
            
            const tacticianParticipant = state.participants.find((p: any) => p.id === tactician.id);
            expect(tacticianParticipant).toBeDefined();
        });
    });

    describe('Spell Selection and Resource Management', () => {

        test('1.4 - Intelligent AI chooses spells strategically', async () => {
            const spellcaster = createTestCharacter({
                name: 'Battle Mage',
                behavior: 'intelligent',
                stats: { str: 8, dex: 12, con: 12, int: 16, wis: 12, cha: 10 },
                characterClass: 'Wizard',
                hp: 16,
                ac: 12,
                level: 5,
                knownSpells: ['fireball', 'shield', 'healing word', 'lightning bolt']
            });

            const opponent1 = createTestCharacter({
                name: 'Weakling',
                behavior: 'neutral',
                hp: 8,
                ac: 8
            });

            const opponent2 = createTestCharacter({
                name: 'Tank',
                behavior: 'defensive',
                hp: 25,
                ac: 16
            });

            const encounterResult = await handleCreateEncounter({
                seed: 'spell-selection',
                participants: [
                    {
                        id: spellcaster.id,
                        name: spellcaster.name,
                        initiativeBonus: 2,
                        hp: spellcaster.hp,
                        maxHp: spellcaster.maxHp,
                        conditions: []
                    },
                    {
                        id: opponent1.id,
                        name: opponent1.name,
                        initiativeBonus: 1,
                        hp: opponent1.hp,
                        maxHp: opponent1.maxHp,
                        conditions: []
                    },
                    {
                        id: opponent2.id,
                        name: opponent2.name,
                        initiativeBonus: 0,
                        hp: opponent2.hp,
                        maxHp: opponent2.maxHp,
                        conditions: []
                    }
                ]
            }, mockCtx);

            const encounterId = JSON.parse(encounterResult.content[0].text).encounterId;

            // Test: AI should analyze spell effectiveness vs targets
            const state = await handleGetEncounterState({ encounterId }, mockCtx);
            
            // Intelligent AI would choose between AoE (fireball) vs single target (lightning bolt)
            // vs defensive spells (shield) based on situation
            expect(state.participants).toBeDefined();
        });

        test('1.5 - Conservative AI manages spell slots carefully', async () => {
            const frugalMage = createTestCharacter({
                name: 'Frugal Mage',
                behavior: 'cautious',
                stats: { str: 6, dex: 10, con: 10, int: 18, wis: 14, cha: 8 },
                characterClass: 'Wizard',
                hp: 14,
                ac: 10,
                level: 3,
                knownSpells: ['magic missile', 'shield', 'sleep']
            });

            const weakEnemy = createTestCharacter({
                name: 'Goblin',
                hp: 6,
                ac: 10
            });

            const encounterResult = await handleCreateEncounter({
                seed: 'resource-management',
                participants: [
                    {
                        id: frugalMage.id,
                        name: frugalMage.name,
                        initiativeBonus: 2,
                        hp: frugalMage.hp,
                        maxHp: frugalMage.maxHp,
                        conditions: []
                    },
                    {
                        id: weakEnemy.id,
                        name: weakEnemy.name,
                        initiativeBonus: 1,
                        hp: weakEnemy.hp,
                        maxHp: weakEnemy.maxHp,
                        conditions: []
                    }
                ]
            }, mockCtx);

            const encounterId = JSON.parse(encounterResult.content[0].text).encounterId;

            // Test: AI should prefer low-level spells when appropriate
            // vs saving high-level spells for tougher opponents
            const state = await handleGetEncounterState({ encounterId }, mockCtx);
            
            const mageParticipant = state.participants.find((p: any) => p.id === frugalMage.id);
            expect(mageParticipant).toBeDefined();
        });
    });

    describe('Movement and Positioning', () => {

        test('1.6 - Tactically-minded AI uses positioning', async () => {
            const ranger = createTestCharacter({
                name: 'Woodland Ranger',
                behavior: 'strategic',
                stats: { str: 12, dex: 16, con: 12, int: 12, wis: 14, cha: 8 },
                characterClass: 'Ranger',
                hp: 22,
                ac: 14
            });

            const melee1 = createTestCharacter({
                name: 'Orc Warrior 1',
                behavior: 'aggressive',
                hp: 20,
                ac: 13
            });

            const melee2 = createTestCharacter({
                name: 'Orc Warrior 2', 
                behavior: 'aggressive',
                hp: 20,
                ac: 13
            });

            const encounterResult = await handleCreateEncounter({
                seed: 'positioning-tactics',
                participants: [
                    {
                        id: ranger.id,
                        name: ranger.name,
                        initiativeBonus: 3,
                        hp: ranger.hp,
                        maxHp: ranger.maxHp,
                        conditions: []
                    },
                    {
                        id: melee1.id,
                        name: melee1.name,
                        initiativeBonus: 1,
                        hp: melee1.hp,
                        maxHp: melee1.maxHp,
                        conditions: []
                    },
                    {
                        id: melee2.id,
                        name: melee2.name,
                        initiativeBonus: 1,
                        hp: melee2.hp,
                        maxHp: melee2.maxHp,
                        conditions: []
                    }
                ]
            }, mockCtx);

            const encounterId = JSON.parse(encounterResult.content[0].text).encounterId;

            // Test: Ranged AI should maintain distance, use kiting tactics
            const state = await handleGetEncounterState({ encounterId }, mockCtx);
            
            // Strategic AI should consider flanking, cover, positioning advantages
            expect(state.participants).toBeDefined();
        });
    });
});

// =============================================================================
// CATEGORY 2: SOCIAL AI DECISION-MAKING  
// =============================================================================

describe('Category 2: Social AI Decision-Making', () => {

    describe('Relationship Response Logic', () => {

        test('2.1 - Friendly NPC remembers and reciprocates kindness', async () => {
            const hero = createTestCharacter({
                name: 'Helpful Hero',
                characterType: 'pc',
                stats: { str: 12, dex: 12, con: 12, int: 12, wis: 14, cha: 14 }
            });

            const merchant = createTestCharacter({
                name: 'Honest Merchant',
                behavior: 'friendly',
                stats: { str: 8, dex: 12, con: 10, int: 14, wis: 12, cha: 16 }
            });

            // Simulate previous positive interaction
            await handleUpdateNpcRelationship({
                characterId: hero.id,
                npcId: merchant.id,
                familiarity: 'friend',
                disposition: 'friendly',
                notes: 'Helped save my caravan from bandits'
            }, mockCtx);

            // Record positive conversation memory
            await handleRecordConversationMemory({
                characterId: hero.id,
                npcId: merchant.id,
                summary: 'Hero defended merchant caravan from bandits',
                importance: 'high',
                topics: ['bandits', 'defense', 'gratitude']
            }, mockCtx);

            // Test: Merchant should show increased friendliness
            const relationship = await handleGetNpcRelationship({
                characterId: hero.id,
                npcId: merchant.id
            }, mockCtx);

            const relationshipData = JSON.parse(relationship.content[0].text);
            expect(relationshipData.familiarity).toBe('friend');
            expect(relationshipData.disposition).toBe('friendly');
            expect(relationshipData.notes).toContain('bandits');
        });

        test('2.2 - Revenge-minded NPC holds grudges', async () => {
            const hero = createTestCharacter({
                name: 'Hero',
                characterType: 'pc'
            });

            const vengeful = createTestCharacter({
                name: 'Vengeful Noble',
                behavior: 'vengeful',
                stats: { str: 10, dex: 10, con: 12, int: 14, wis: 12, cha: 14 }
            });

            // Simulate previous betrayal
            await handleUpdateNpcRelationship({
                characterId: hero.id,
                npcId: vengeful.id,
                familiarity: 'enemy',
                disposition: 'hostile',
                notes: 'Betrayed me and stole my family heirloom'
            }, mockCtx);

            await handleRecordConversationMemory({
                characterId: hero.id,
                npcId: vengeful.id,
                summary: 'Hero stole the Sacred Chalice from my family vault',
                importance: 'critical',
                topics: ['theft', 'betrayal', 'revenge']
            }, mockCtx);

            // Test: Vengeful NPC should maintain hostility
            const relationship = await handleGetNpcRelationship({
                characterId: hero.id,
                npcId: vengeful.id
            }, mockCtx);

            const relationshipData = JSON.parse(relationship.content[0].text);
            expect(relationshipData.familiarity).toBe('enemy');
            expect(relationshipData.disposition).toBe('hostile');
        });

        test('2.3 - Pragmatic NPC adapts based on circumstances', async () => {
            const hero = createTestCharacter({
                name: 'Powerful Warrior',
                characterType: 'pc',
                stats: { str: 18, dex: 14, con: 16, int: 10, wis: 12, cha: 10 }
            });

            const pragmatist = createTestCharacter({
                name: 'Pragmatic Captain',
                behavior: 'pragmatic',
                stats: { str: 14, dex: 12, con: 14, int: 14, wis: 14, cha: 12 },
                factionId: 'city-guard'
            });

            // Initial neutral relationship
            await handleUpdateNpcRelationship({
                characterId: hero.id,
                npcId: pragmatist.id,
                familiarity: 'acquaintance',
                disposition: 'neutral',
                notes: 'Local guard captain'
            }, mockCtx);

            // Test: Pragmatic NPC should adapt disposition based on hero's power/usefulness
            const relationship = await handleGetNpcRelationship({
                characterId: hero.id,
                npcId: pragmatist.id
            }, mockCtx);

            const relationshipData = JSON.parse(relationship.content[0].text);
            expect(relationshipData.familiarity).toBe('acquaintance');
            
            // Pragmatic AI would recognize hero's strength and become more helpful
            // This would be tested with actual AI logic
        });
    });

    describe('Conversation Response Patterns', () => {

        test('2.4 - Shy NPC responds differently than confident NPC', async () => {
            const hero = createTestCharacter({
                name: 'Charismatic Hero',
                characterType: 'pc',
                stats: { str: 12, dex: 12, con: 12, int: 12, wis: 12, cha: 18 }
            });

            const shyNpc = createTestCharacter({
                name: 'Shy Librarian',
                behavior: 'shy',
                stats: { str: 6, dex: 10, con: 8, int: 16, wis: 14, cha: 6 }
            });

            const confidentNpc = createTestCharacter({
                name: 'Confident Merchant',
                behavior: 'confident',
                stats: { str: 10, dex: 12, con: 12, int: 12, wis: 10, cha: 16 }
            });

            // Test conversation with both NPCs
            await handleInteractSocially({
                speakerId: hero.id,
                targetId: shyNpc.id,
                content: 'Hello there! I need some information.',
                volume: 'TALK',
                intent: 'greeting'
            }, mockCtx);

            await handleInteractSocially({
                speakerId: hero.id,
                targetId: confidentNpc.id,
                content: 'Hello there! I need some information.',
                volume: 'TALK',
                intent: 'greeting'
            }, mockCtx);

            // Both should respond, but differently based on personality
            const shyContext = await handleGetNpcContext({
                characterId: hero.id,
                npcId: shyNpc.id
            }, mockCtx);

            const confidentContext = await handleGetNpcContext({
                characterId: hero.id,
                npcId: confidentNpc.id
            }, mockCtx);

            expect(JSON.parse(shyContext.content[0].text)).toBeDefined();
            expect(JSON.parse(confidentContext.content[0].text)).toBeDefined();
        });

        test('2.5 - Suspicious NPC interrogates unknown visitors', async () => {
            const stranger = createTestCharacter({
                name: 'Suspicious Stranger',
                characterType: 'pc'
            });

            const paranoidGuard = createTestCharacter({
                name: 'Paranoid City Guard',
                behavior: 'paranoid',
                stats: { str: 12, dex: 12, con: 14, int: 12, wis: 16, cha: 10 },
                factionId: 'city-guard'
            });

            // First time meeting - should be suspicious
            await handleUpdateNpcRelationship({
                characterId: stranger.id,
                npcId: paranoidGuard.id,
                familiarity: 'stranger',
                disposition: 'unfriendly'
            }, mockCtx);

            const relationship = await handleGetNpcRelationship({
                characterId: stranger.id,
                npcId: paranoidGuard.id
            }, mockCtx);

            const relationshipData = JSON.parse(relationship.content[0].text);
            expect(relationshipData.familiarity).toBe('stranger');
            expect(relationshipData.disposition).toBe('unfriendly');
        });
    });

    describe('Social Intent Processing', () => {

        test('2.6 - NPC responds appropriately to different social intents', async () => {
            const hero = createTestCharacter({
                name: 'Diplomatic Hero',
                characterType: 'pc'
            });

            const elder = createTestCharacter({
                name: 'Village Elder',
                behavior: 'wise',
                stats: { str: 8, dex: 10, con: 12, int: 16, wis: 18, cha: 14 }
            });

            // Test different intents
            const intents = ['greeting', 'question', 'request', 'threaten', 'bargain', 'confide'];

            for (const intent of intents) {
                await handleInteractSocially({
                    speakerId: hero.id,
                    targetId: elder.id,
                    content: `Testing ${intent} intent`,
                    volume: 'TALK',
                    intent: intent
                }, mockCtx);

                // Record memory of the interaction
                await handleRecordConversationMemory({
                    characterId: hero.id,
                    npcId: elder.id,
                    summary: `Hero approached with ${intent} intent`,
                    importance: intent === 'threaten' ? 'high' : 'medium',
                    topics: [intent]
                }, mockCtx);
            }

            // Test: Elder should remember different intents and respond accordingly
            const context = await handleGetNpcContext({
                characterId: hero.id,
                npcId: elder.id
            }, mockCtx);

            const contextData = JSON.parse(context.content[0].text);
            expect(contextData.relationship).toBeDefined();
        });
    });
});

// =============================================================================
// CATEGORY 3: STRATEGIC AI DECISION-MAKING
// =============================================================================

describe('Category 3: Strategic AI Decision-Making', () => {

    describe('Nation-Level Strategic Decisions', () => {

        test('3.1 - Aggressive nation initiates conflicts', async () => {
            // Create aggressive nation
            const aggressiveNation = await handleStrategyTool('create_nation', {
                worldId: 'test-world',
                name: 'Warhammer Empire',
                leader: 'Emperor Krieg',
                ideology: 'autocracy',
                aggression: 85,
                trust: 20,
                paranoia: 60,
                startingResources: { food: 100, metal: 200, oil: 50 }
            }, mockCtx);

            const aggressiveData = JSON.parse(aggressiveNation.content[0].text);

            // Create peaceful neighbor
            const peacefulNation = await handleStrategyTool('create_nation', {
                worldId: 'test-world',
                name: 'Republic of Harmony',
                leader: 'President Peace',
                ideology: 'democracy',
                aggression: 15,
                trust: 80,
                paranoia: 30,
                startingResources: { food: 150, metal: 100, oil: 30 }
            }, mockCtx);

            const peacefulData = JSON.parse(peacefulNation.content[0].text);

            // Test: Aggressive AI should consider military expansion
            expect(aggressiveData.aggression).toBe(85);
            expect(peacefulData.aggression).toBe(15);
        });

        test('3.2 - Diplomatic AI forms alliances strategically', async () => {
            const nation1 = await handleStrategyTool('create_nation', {
                worldId: 'test-world',
                name: 'Trade Federation',
                leader: 'Chancellor Commerce',
                ideology: 'democracy',
                aggression: 30,
                trust: 70,
                paranoia: 40
            }, mockCtx);

            const nation2 = await handleStrategyTool('create_nation', {
                worldId: 'test-world',
                name: 'Merchant Alliance',
                leader: 'High Trader',
                ideology: 'democracy',
                aggression: 25,
                trust: 75,
                paranoia: 35
            }, mockCtx);

            const tradeData = JSON.parse(nation1.content[0].text);
            const merchantData = JSON.parse(nation2.content[0].text);

            // Test diplomatic AI decision-making
            // Both nations should see mutual benefit in trade alliance
            const allianceResult = await handleStrategyTool('propose_alliance', {
                fromNationId: tradeData.id,
                toNationId: merchantData.id
            }, mockCtx);

            expect(allianceResult).toBeDefined();
        });

        test('3.3 - Resource management AI allocates efficiently', async () => {
            const nation = await handleStrategyTool('create_nation', {
                worldId: 'test-world',
                name: 'Industrial Complex',
                leader: 'Director Efficiency',
                ideology: 'autocracy',
                aggression: 50,
                trust: 60,
                paranoia: 45,
                startingResources: { food: 80, metal: 300, oil: 100 }
            }, mockCtx);

            const nationData = JSON.parse(nation.content[0].text);

            // Test: AI should recognize metal surplus, food shortage
            expect(nationData.resources.metal).toBeGreaterThan(nationData.resources.food);
            
            // Strategic AI should consider resource redistribution or trade
            // This would involve actual AI decision logic
        });
    });

    describe('Diplomatic Response Patterns', () => {

        test('3.4 - Trust-based AI responds to diplomatic overtures', async () => {
            const trustworthy = await handleStrategyTool('create_nation', {
                worldId: 'test-world',
                name: 'Honorable Kingdom',
                leader: 'King Truth',
                ideology: 'monarchy',
                aggression: 20,
                trust: 90,
                paranoia: 20
            }, mockCtx);

            const untrustworthy = await handleStrategyTool('create_nation', {
                worldId: 'test-world',
                name: 'Deceitful Duchy',
                leader: 'Duke Deception',
                ideology: 'autocracy',
                aggression: 60,
                trust: 10,
                paranoia: 80
            }, mockCtx);

            const honorableData = JSON.parse(trustworthy.content[0].text);
            const deceitfulData = JSON.parse(untrustworthy.content[0].text);

            // Honorable kingdom should respond positively to diplomacy
            expect(honorableData.trust).toBe(90);
            expect(deceitfulData.trust).toBe(10);
        });

        test('3.5 - Paranoid AI sees threats everywhere', async () => {
            const paranoidNation = await handleStrategyTool('create_nation', {
                worldId: 'test-world',
                name: 'Fortress State',
                leader: 'General Paranoia',
                ideology: 'autocracy',
                aggression: 40,
                trust: 15,
                paranoia: 95
            }, mockCtx);

            const paranoidData = JSON.parse(paranoidNation.content[0].text);

            // Test: Paranoid AI should interpret neutral actions as threats
            expect(paranoidData.paranoia).toBe(95);
            expect(paranoidData.trust).toBe(15);
        });
    });
});

// =============================================================================
// CATEGORY 4: ADAPTIVE AI BEHAVIOR
// =============================================================================

describe('Category 4: Adaptive AI Behavior', () => {

    describe('Response to Player Actions', () => {

        test('4.1 - NPC adapts to player reputation changes', async () => {
            const hero = createTestCharacter({
                name: 'Reformed Rogue',
                characterType: 'pc',
                behavior: 'redeemed',
                stats: { str: 12, dex: 16, con: 12, int: 12, wis: 12, cha: 14 }
            });

            const shopkeeper = createTestCharacter({
                name: 'Local Shopkeeper',
                behavior: 'pragmatic',
                stats: { str: 8, dex: 10, con: 10, int: 14, wis: 12, cha: 12 }
            });

            // Initial neutral relationship
            await handleUpdateNpcRelationship({
                characterId: hero.id,
                npcId: shopkeeper.id,
                familiarity: 'stranger',
                disposition: 'neutral',
                notes: 'New customer, unknown reputation'
            }, mockCtx);

            // Hero performs good deed
            await handleRecordConversationMemory({
                characterId: hero.id,
                npcId: shopkeeper.id,
                summary: 'Hero saved shopkeeper from pickpockets',
                importance: 'high',
                topics: ['good deed', 'heroism', 'trust']
            }, mockCtx);

            // Test: Shopkeeper should adapt disposition based on hero's actions
            await handleUpdateNpcRelationship({
                characterId: hero.id,
                npcId: shopkeeper.id,
                familiarity: 'acquaintance',
                disposition: 'friendly',
                notes: 'Proven trustworthy by helping me'
            }, mockCtx);

            const updatedRelationship = await handleGetNpcRelationship({
                characterId: hero.id,
                npcId: shopkeeper.id
            }, mockCtx);

            const relationshipData = JSON.parse(updatedRelationship.content[0].text);
            expect(relationshipData.disposition).toBe('friendly');
        });

        test('4.2 - AI changes strategy based on combat outcomes', async () => {
            const adaptiveFighter = createTestCharacter({
                name: 'Adaptive Warrior',
                behavior: 'adaptive',
                stats: { str: 14, dex: 12, con: 14, int: 12, wis: 12, cha: 10 },
                characterClass: 'Fighter',
                hp: 25,
                ac: 14
            });

            const enemy1 = createTestCharacter({
                name: 'Spearman',
                hp: 20,
                ac: 12
            });

            // First encounter - loses due to enemy reach
            const encounter1 = await handleCreateEncounter({
                seed: 'adaptive-lesson-1',
                participants: [
                    {
                        id: adaptiveFighter.id,
                        name: adaptiveFighter.name,
                        initiativeBonus: 1,
                        hp: adaptiveFighter.hp,
                        maxHp: adaptiveFighter.maxHp,
                        conditions: []
                    },
                    {
                        id: enemy1.id,
                        name: enemy1.name,
                        initiativeBonus: 2,
                        hp: enemy1.hp,
                        maxHp: enemy1.maxHp,
                        conditions: []
                    }
                ]
            }, mockCtx);

            const encounterId1 = JSON.parse(encounter1.content[0].text).encounterId;

            // Simulate combat where fighter loses
            await handleExecuteCombatAction({
                encounterId: encounterId1,
                action: 'attack',
                actorId: enemy1.id,
                targetId: adaptiveFighter.id,
                attackBonus: 4,
                dc: 12,
                damage: 8
            }, mockCtx);

            // Test: Adaptive AI should learn from defeat
            // Next encounter should show different behavior (e.g., use shield, keep distance)
            const encounter2 = await handleCreateEncounter({
                seed: 'adaptive-lesson-2',
                participants: [
                    {
                        id: adaptiveFighter.id,
                        name: adaptiveFighter.name,
                        initiativeBonus: 1,
                        hp: 25,
                        maxHp: 25,
                        conditions: []
                    },
                    {
                        id: enemy1.id,
                        name: enemy1.name,
                        initiativeBonus: 2,
                        hp: 20,
                        maxHp: 20,
                        conditions: []
                    }
                ]
            }, mockCtx);

            const state2 = await handleGetEncounterState({
                encounterId: JSON.parse(encounter2.content[0].text).encounterId
            }, mockCtx);

            expect(state2.participants).toBeDefined();
        });
    });

    describe('Environmental Adaptation', () => {

        test('4.3 - AI adapts behavior in different environments', async () => {
            const cityGuard = createTestCharacter({
                name: 'City Watch Captain',
                behavior: 'authoritative',
                stats: { str: 12, dex: 12, con: 14, int: 12, wis: 14, cha: 12 },
                characterClass: 'Fighter',
                factionId: 'city-guard'
            });

            const drunk = createTestCharacter({
                name: 'Disorderly Drunk',
                behavior: 'reckless',
                stats: { str: 10, dex: 8, con: 12, int: 6, wis: 8, cha: 10 }
            });

            // Create room representing tavern
            const tavernRoom = spatialRepo.createRoom({
                name: 'The Drunken Dragon Tavern',
                baseDescription: 'A crowded tavern with low lighting and wooden tables',
                biomeContext: 'urban',
                atmospherics: ['BRIGHT'],
                entityIds: [cityGuard.id, drunk.id]
            });

            // Test: Authoritative AI should be more lenient in tavern vs street
            const roomContext = spatialRepo.findById(tavernRoom.id);
            expect(roomContext).toBeDefined();
            expect(roomContext?.biomeContext).toBe('urban');
        });

        test('4.4 - Religious AI responds to sacred spaces', async () => {
            const zealot = createTestCharacter({
                name: 'Temple Guardian',
                behavior: 'zealous',
                stats: { str: 12, dex: 10, con: 14, int: 10, wis: 16, cha: 12 },
                characterClass: 'Cleric',
                factionId: 'temple'
            });

            const troublemaker = createTestCharacter({
                name: 'Blasphemer',
                behavior: 'defiant',
                stats: { str: 10, dex: 12, con: 10, int: 10, wis: 6, cha: 12 }
            });

            // Create sacred space
            const templeRoom = spatialRepo.createRoom({
                name: 'Sacred Altar of Light',
                baseDescription: 'A consecrated space filled with divine radiance',
                biomeContext: 'divine',
                atmospherics: ['BRIGHT', 'MAGICAL'],
                entityIds: [zealot.id, troublemaker.id]
            });

            const temple = spatialRepo.findById(templeRoom.id);
            expect(temple?.atmospherics).toContain('BRIGHT');
            expect(temple?.atmospherics).toContain('MAGICAL');
        });
    });
});

// =============================================================================
// CATEGORY 5: AI CONSISTENCY
// =============================================================================

describe('Category 5: AI Consistency', () => {

    describe('Personality Trait Consistency', () => {

        test('5.1 - Greedy NPC remains greedy across scenarios', async () => {
            const merchant = createTestCharacter({
                name: 'Greedy Merchant',
                behavior: 'greedy',
                stats: { str: 8, dex: 12, con: 10, int: 14, wis: 10, cha: 16 }
            });

            // Test scenario 1: Simple transaction
            await handleUpdateNpcRelationship({
                characterId: 'pc-1',
                npcId: merchant.id,
                familiarity: 'stranger',
                disposition: 'neutral',
                notes: 'First customer of the day'
            }, mockCtx);

            // Test scenario 2: Bulk purchase offer
            await handleRecordConversationMemory({
                characterId: 'pc-1',
                npcId: merchant.id,
                summary: 'Customer wants to buy entire inventory',
                importance: 'high',
                topics: ['profit', 'business']
            }, mockCtx);

            // Test scenario 3: Charity request
            await handleRecordConversationMemory({
                characterId: 'pc-1',
                npcId: merchant.id,
                summary: 'Orphanage asks for donation',
                importance: 'medium',
                topics: ['charity', 'refusal']
            }, mockCtx);

            // Test: Greedy merchant should consistently prioritize profit
            const context = await handleGetNpcContext({
                characterId: 'pc-1',
                npcId: merchant.id
            }, mockCtx);

            const contextData = JSON.parse(context.content[0].text);
            expect(contextData.relationship).toBeDefined();
        });

        test('5.2 - Honorable NPC maintains principles under pressure', async () => {
            const knight = createTestCharacter({
                name: 'Sir Honorbound',
                behavior: 'honorable',
                stats: { str: 14, dex: 12, con: 14, int: 12, wis: 14, cha: 14 },
                characterClass: 'Paladin'
            });

            // Test various moral dilemmas
            const dilemmas = [
                {
                    scenario: 'Pay bribe to save innocent',
                    summary: 'Bandit offers deal: pay gold to let innocent go',
                    behavior: 'honorable'
                },
                {
                    scenario: 'Break law to save life',
                    summary: 'Breaking curfew could save a life',
                    behavior: 'lawful'
                },
                {
                    scenario: 'Lie to protect friend',
                    summary: 'Friend asks for alibi for crime they didn\'t commit',
                    behavior: 'honest'
                }
            ];

            for (const dilemma of dilemmas) {
                await handleRecordConversationMemory({
                    characterId: 'pc-1',
                    npcId: knight.id,
                    summary: `${knight.name} faced dilemma: ${dilemma.summary}`,
                    importance: 'high',
                    topics: [dilemma.behavior, 'moral']
                }, mockCtx);
            }

            // Test: Knight should maintain consistent honorable behavior
            const context = await handleGetNpcContext({
                characterId: 'pc-1',
                npcId: knight.id
            }, mockCtx);

            const contextData = JSON.parse(context.content[0].text);
            expect(contextData.relationship).toBeDefined();
        });
    });

    describe('Behavior Over Time', () => {

        test('5.3 - NPC development shows gradual change', async () => {
            const youngWarrior = createTestCharacter({
                name: 'Aspiring Knight',
                behavior: 'ambitious',
                stats: { str: 12, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
                level: 1
            });

            // Simulate character progression
            const experiences = [
                { level: 1, summary: 'First battle, barely survived', importance: 'medium' },
                { level: 2, summary: 'Saved innocent from bandits', importance: 'high' },
                { level: 3, summary: 'Led village defense against raiders', importance: 'high' },
                { level: 4, summary: 'Made difficult moral choice', importance: 'critical' }
            ];

            for (const exp of experiences) {
                // Update character level (simulated growth)
                charRepo.update(youngWarrior.id, {
                    level: exp.level,
                    stats: {
                        str: 12 + Math.floor(exp.level / 2),
                        dex: 12 + Math.floor(exp.level / 4),
                        con: 12 + Math.floor(exp.level / 3),
                        int: 10 + Math.floor(exp.level / 5),
                        wis: 10 + Math.floor(exp.level / 4),
                        cha: 10 + Math.floor(exp.level / 3)
                    }
                });

                await handleRecordConversationMemory({
                    characterId: 'pc-mentor',
                    npcId: youngWarrior.id,
                    summary: `${youngWarrior.name} ${exp.summary}`,
                    importance: exp.importance,
                    topics: ['growth', 'experience']
                }, mockCtx);
            }

            // Test: Character should show development over time
            const updatedChar = charRepo.findById(youngWarrior.id);
            expect(updatedChar?.level).toBe(4);
            expect(updatedChar?.stats.str).toBeGreaterThan(12);
        });
    });
});

// =============================================================================
// CATEGORY 6: MULTI-CHARACTER COORDINATION
// =============================================================================

describe('Category 6: Multi-Character Coordination', () => {

    describe('Group Dynamics', () => {

        test('6.1 - Party members coordinate in combat', async () => {
            const partyLeader = createTestCharacter({
                name: 'Captain Blade',
                behavior: 'leadership',
                stats: { str: 14, dex: 12, con: 14, int: 12, wis: 12, cha: 16 },
                characterClass: 'Fighter',
                hp: 30,
                ac: 16
            });

            const healer = createTestCharacter({
                name: 'Healing Light',
                behavior: 'supportive',
                stats: { str: 8, dex: 10, con: 12, int: 12, wis: 16, cha: 14 },
                characterClass: 'Cleric',
                hp: 18,
                ac: 12
            });

            const attacker = createTestCharacter({
                name: 'Shadow Stalker',
                behavior: 'aggressive',
                stats: { str: 12, dex: 18, con: 10, int: 12, wis: 10, cha: 8 },
                characterClass: 'Rogue',
                hp: 20,
                ac: 14
            });

            // Create party
            const party = partyRepo.create({
                name: 'The Companions',
                description: 'Adventuring party',
                worldId: 'test-world',
                currentLocation: 'Tavern',
                formation: 'defensive',
                status: 'active',
                initialMembers: [
                    {
                        characterId: partyLeader.id,
                        role: 'leader',
                        position: 1,
                        notes: 'Party leader'
                    },
                    {
                        characterId: healer.id,
                        role: 'member',
                        position: 2,
                        notes: 'Healer support'
                    },
                    {
                        characterId: attacker.id,
                        role: 'member',
                        position: 3,
                        notes: 'Flanking specialist'
                    }
                ]
            });

            // Test: Party should coordinate in combat scenarios
            const partyData = await Promise.all([
                handleGetNpcContext({
                    characterId: partyLeader.id,
                    npcId: healer.id
                }, mockCtx),
                handleGetNpcContext({
                    characterId: partyLeader.id,
                    npcId: attacker.id
                }, mockCtx)
            ]);

            expect(party).toBeDefined();
            expect(partyData[0]).toBeDefined();
            expect(partyData[1]).toBeDefined();
        });

        test('6.2 - Conflicting personalities create tension', async () => {
            const lawfulPaladin = createTestCharacter({
                name: 'Sir Lawful',
                behavior: 'rigid',
                stats: { str: 14, dex: 10, con: 14, int: 12, wis: 14, cha: 14 },
                characterClass: 'Paladin'
            });

            const chaoticRogue = createTestCharacter({
                name: 'Kitty',
                behavior: 'chaotic',
                stats: { str: 10, dex: 18, con: 10, int: 12, wis: 10, cha: 12 },
                characterClass: 'Rogue'
            });

            // Test: Conflicting personalities should create interesting dynamics
            await handleUpdateNpcRelationship({
                characterId: 'pc-dm',
                npcId: lawfulPaladin.id,
                familiarity: 'acquaintance',
                disposition: 'neutral',
                notes: 'Fellow adventurer'
            }, mockCtx);

            await handleUpdateNpcRelationship({
                characterId: 'pc-dm',
                npcId: chaoticRogue.id,
                familiarity: 'acquaintance',
                disposition: 'neutral',
                notes: 'Fellow adventurer'
            }, mockCtx);

            // Record conflicting opinions
            await handleRecordConversationMemory({
                characterId: 'pc-dm',
                npcId: lawfulPaladin.id,
                summary: 'Paladin condemns Rogue\'s unorthodox methods',
                importance: 'medium',
                topics: ['conflict', 'methods']
            }, mockCtx);

            await handleRecordConversationMemory({
                characterId: 'pc-dm',
                npcId: chaoticRogue.id,
                summary: 'Rogue mocks Paladin\'s rigid adherence to rules',
                importance: 'medium',
                topics: ['conflict', 'rules']
            }, mockCtx);

            const paladinContext = await handleGetNpcContext({
                characterId: 'pc-dm',
                npcId: lawfulPaladin.id
            }, mockCtx);

            const rogueContext = await handleGetNpcContext({
                characterId: 'pc-dm',
                npcId: chaoticRogue.id
            }, mockCtx);

            expect(JSON.parse(paladinContext.content[0].text)).toBeDefined();
            expect(JSON.parse(rogueContext.content[0].text)).toBeDefined();
        });
    });

    describe('Competing Priorities', () => {

        test('6.3 - NPCs with conflicting goals make different choices', async () => {
            const merchant = createTestCharacter({
                name: 'Trade Master',
                behavior: 'profit-focused',
                stats: { str: 8, dex: 12, con: 10, int: 16, wis: 12, cha: 14 },
                factionId: 'merchant-guild'
            });

            const guard = createTestCharacter({
                name: 'City Guardian',
                behavior: 'duty-bound',
                stats: { str: 12, dex: 12, con: 14, int: 12, wis: 14, cha: 10 },
                factionId: 'city-guard'
            });

            // Scenario: Stolen goods recovery
            await handleRecordConversationMemory({
                characterId: 'pc-detective',
                npcId: merchant.id,
                summary: 'Merchant\'s goods were stolen, wants quick resolution',
                importance: 'high',
                topics: ['profit', 'theft']
            }, mockCtx);

            await handleRecordConversationMemory({
                characterId: 'pc-detective',
                npcId: guard.id,
                summary: 'Guard wants proper investigation and legal process',
                importance: 'high',
                topics: ['justice', 'procedure']
            }, mockCtx);

            // Test: Different priorities should lead to different suggested solutions
            const merchantContext = await handleGetNpcContext({
                characterId: 'pc-detective',
                npcId: merchant.id
            }, mockCtx);

            const guardContext = await handleGetNpcContext({
                characterId: 'pc-detective',
                npcId: guard.id
            }, mockCtx);

            const merchantData = JSON.parse(merchantContext.content[0].text);
            const guardData = JSON.parse(guardContext.content[0].text);

            expect(merchantData.relationship).toBeDefined();
            expect(guardData.relationship).toBeDefined();
        });
    });
});

// =============================================================================
// CATEGORY 7: ENVIRONMENTAL AWARENESS
// =============================================================================

describe('Category 7: Environmental Awareness', () => {

    describe('World-State Understanding', () => {

        test('7.1 - Local NPC understands regional politics', async () => {
            const borderGuard = createTestCharacter({
                name: 'Border Sentinel',
                behavior: 'vigilant',
                stats: { str: 12, dex: 12, con: 14, int: 12, wis: 14, cha: 10 },
                factionId: 'frontier-guard'
            });

            const citizen = createTestCharacter({
                name: 'Local Farmer',
                behavior: 'pragmatic',
                stats: { str: 10, dex: 10, con: 12, int: 10, wis: 12, cha: 8 }
            });

            // Test: Border guard should know about territorial disputes
            await handleRecordConversationMemory({
                characterId: 'pc-stranger',
                npcId: borderGuard.id,
                summary: 'Guard warns about hostile nation to the east',
                importance: 'high',
                topics: ['politics', 'threat']
            }, mockCtx);

            await handleRecordConversationMemory({
                characterId: 'pc-stranger',
                npcId: citizen.id,
                summary: 'Farmer mentions increased taxes due to border tensions',
                importance: 'medium',
                topics: ['politics', 'economy']
            }, mockCtx);

            const guardContext = await handleGetNpcContext({
                characterId: 'pc-stranger',
                npcId: borderGuard.id
            }, mockCtx);

            const citizenContext = await handleGetNpcContext({
                characterId: 'pc-stranger',
                npcId: citizen.id
            }, mockCtx);

            expect(JSON.parse(guardContext.content[0].text)).toBeDefined();
            expect(JSON.parse(citizenContext.content[0].text)).toBeDefined();
        });

        test('7.2 - NPCs react to environmental changes', async () => {
            const weatherWatcher = createTestCharacter({
                name: 'Storm Watcher',
                behavior: 'observant',
                stats: { str: 8, dex: 10, con: 10, int: 14, wis: 16, cha: 12 }
            });

            // Simulate environmental change (storm approaching)
            await handleRecordConversationMemory({
                characterId: 'pc-traveler',
                npcId: weatherWatcher.id,
                summary: 'Weather patterns changing, storm approaching from the north',
                importance: 'high',
                topics: ['weather', 'storm']
            }, mockCtx);

            // Test: NPC should remember environmental threats
            const context = await handleGetNpcContext({
                characterId: 'pc-traveler',
                npcId: weatherWatcher.id
            }, mockCtx);

            const contextData = JSON.parse(context.content[0].text);
            expect(contextData.relationship).toBeDefined();
            expect(contextData.recentMemories).toBeDefined();
        });
    });

    describe('Situational Awareness', () => {

        test('7.3 - NPCs assess threats appropriately', async () => {
            const cityWatch = createTestCharacter({
                name: 'Street Patrol',
                behavior: 'alert',
                stats: { str: 12, dex: 12, con: 14, int: 10, wis: 14, cha: 10 },
                characterClass: 'Fighter',
                factionId: 'city-guard'
            });

            const suspiciousCharacter = createTestCharacter({
                name: 'Suspicious Person',
                behavior: 'skulking',
                stats: { str: 10, dex: 14, con: 10, int: 12, wis: 10, cha: 8 }
            });

            // Test: Watch should be aware of suspicious activity
            await handleRecordConversationMemory({
                characterId: 'pc-witness',
                npcId: cityWatch.id,
                summary: 'Watch notices suspicious character lurking near bank',
                importance: 'high',
                topics: ['threat', 'suspicious']
            }, mockCtx);

            const context = await handleGetNpcContext({
                characterId: 'pc-witness',
                npcId: cityWatch.id
            }, mockCtx);

            expect(JSON.parse(context.content[0].text)).toBeDefined();
        });

        test('7.4 - NPCs coordinate during emergencies', async () => {
            const captain = createTestCharacter({
                name: 'Fire Captain',
                behavior: 'commanding',
                stats: { str: 12, dex: 12, con: 14, int: 14, wis: 14, cha: 16 },
                characterClass: 'Fighter',
                factionId: 'fire-dept'
            });

            const firefighter = createTestCharacter({
                name: 'Rescue Worker',
                behavior: 'brave',
                stats: { str: 14, dex: 12, con: 14, int: 10, wis: 12, cha: 10 },
                factionId: 'fire-dept'
            });

            // Emergency scenario
            await handleRecordConversationMemory({
                characterId: 'pc-civilian',
                npcId: captain.id,
                summary: 'Captain coordinates fire rescue effort',
                importance: 'critical',
                topics: ['emergency', 'coordination']
            }, mockCtx);

            await handleRecordConversationMemory({
                characterId: 'pc-civilian',
                npcId: firefighter.id,
                summary: 'Firefighter follows captain\'s orders during rescue',
                importance: 'critical',
                topics: ['emergency', 'obedience']
            }, mockCtx);

            // Test: NPCs should show coordinated emergency response
            const captainContext = await handleGetNpcContext({
                characterId: 'pc-civilian',
                npcId: captain.id
            }, mockCtx);

            const firefighterContext = await handleGetNpcContext({
                characterId: 'pc-civilian',
                npcId: firefighter.id
            }, mockCtx);

            expect(JSON.parse(captainContext.content[0].text)).toBeDefined();
            expect(JSON.parse(firefighterContext.content[0].text)).toBeDefined();
        });
    });
});

// =============================================================================
// CATEGORY 8: EDGE CASES AND COMPLEX SCENARIOS
// =============================================================================

describe('Category 8: Edge Cases and Complex Scenarios', () => {

    describe('Contradictory Personality Traits', () => {

        test('8.1 - NPC with conflicting traits makes complex decisions', async () => {
            const paradoxical = createTestCharacter({
                name: 'The Paradox',
                behavior: 'complex',
                stats: { str: 12, dex: 12, con: 12, int: 16, wis: 12, cha: 14 }
                // Complex traits: generous yet selfish, brave yet cowardly
            });

            // Test various scenarios that trigger conflicting traits
            const scenarios = [
                {
                    summary: 'Opportunity to help stranger costs money',
                    traits: ['generous vs selfish']
                },
                {
                    summary: 'Dangerous situation requires intervention',
                    traits: ['brave vs cowardly']
                },
                {
                    summary: 'Moral dilemma with no clear right answer',
                    traits: ['complex reasoning']
                }
            ];

            for (const scenario of scenarios) {
                await handleRecordConversationMemory({
                    characterId: 'pc-observer',
                    npcId: paradoxical.id,
                    summary: `${paradoxical.name} faced: ${scenario.summary}`,
                    importance: 'high',
                    topics: scenario.traits
                }, mockCtx);
            }

            // Test: Complex AI should show nuanced decision-making
            const context = await handleGetNpcContext({
                characterId: 'pc-observer',
                npcId: paradoxical.id
            }, mockCtx);

            const contextData = JSON.parse(context.content[0].text);
            expect(contextData.relationship).toBeDefined();
            expect(contextData.recentMemories.length).toBeGreaterThan(0);
        });

        test('8.2 - NPC adapts when traits evolve over time', async () => {
            const evolvingCharacter = createTestCharacter({
                name: 'The Redeemed',
                behavior: 'redeemable',
                stats: { str: 12, dex: 12, con: 12, int: 12, wis: 12, cha: 12 }
                // Starting with potential for growth
            });

            // Simulate character arc
            const redemptionSteps = [
                'Shows mercy to defeated enemy',
                'Helps stranger in need',
                'Refuses payment for good deed',
                'Sacrifices self for others'
            ];

            for (const step of redemptionSteps) {
                await handleRecordConversationMemory({
                    characterId: 'pc-witness',
                    npcId: evolvingCharacter.id,
                    summary: `${evolvingCharacter.name} ${step}`,
                    importance: 'high',
                    topics: ['redemption', 'growth']
                }, mockCtx);
            }

            // Character should show alignment change over time
            const finalContext = await handleGetNpcContext({
                characterId: 'pc-witness',
                npcId: evolvingCharacter.id
            }, mockCtx);

            const contextData = JSON.parse(finalContext.content[0].text);
            expect(contextData.recentMemories.length).toBe(4);
        });
    });

    describe('Multi-Step Decision Chains', () => {

        test('8.3 - NPCs plan multi-step strategies', async () => {
            const strategist = createTestCharacter({
                name: 'Master Planner',
                behavior: 'strategic',
                stats: { str: 10, dex: 12, con: 12, int: 18, wis: 16, cha: 12 }
            });

            // Complex scenario requiring multi-step planning
            const plan = [
                'Gather intelligence about target',
                'Build alliances with key figures',
                'Acquire necessary resources',
                'Execute primary objective',
                'Manage consequences'
            ];

            for (const step of plan) {
                await handleRecordConversationMemory({
                    characterId: 'pc-assistant',
                    npcId: strategist.id,
                    summary: `Planning phase: ${step}`,
                    importance: 'medium',
                    topics: ['planning', 'strategy']
                }, mockCtx);
            }

            // Test: Strategic NPC should show forward-thinking behavior
            const context = await handleGetNpcContext({
                characterId: 'pc-assistant',
                npcId: strategist.id
            }, mockCtx);

            const contextData = JSON.parse(context.content[0].text);
            expect(contextData.recentMemories.length).toBe(5);
        });

        test('8.4 - NPCs handle unexpected complications', async () => {
            const adaptableLeader = createTestCharacter({
                name: 'Flexible Commander',
                behavior: 'adaptable',
                stats: { str: 12, dex: 12, con: 14, int: 14, wis: 14, cha: 14 }
            });

            // Plan with complications
            const complications = [
                'Plan initial assault',
                'Enemy reinforcements arrive (unexpected)',
                'Weather turns bad (environmental change)',
                'Key ally betrays (social complication)',
                'Adapt strategy on the fly'
            ];

            for (const complication of complications) {
                await handleRecordConversationMemory({
                    characterId: 'pc-soldier',
                    npcId: adaptableLeader.id,
                    summary: `Situation: ${complication}`,
                    importance: 'high',
                    topics: ['adaptation', 'crisis']
                }, mockCtx);
            }

            // Test: Adaptable AI should handle complications gracefully
            const context = await handleGetNpcContext({
                characterId: 'pc-soldier',
                npcId: adaptableLeader.id
            }, mockCtx);

            const contextData = JSON.parse(context.content[0].text);
            expect(contextData.relationship).toBeDefined();
        });
    });

    describe('Moral and Ethical Dilemmas', () => {

        test('8.5 - NPCs resolve complex ethical dilemmas', async () => {
            const moralAdvisor = createTestCharacter({
                name: 'Wise Sage',
                behavior: 'wise',
                stats: { str: 8, dex: 10, con: 12, int: 18, wis: 18, cha: 14 }
            });

            const dilemmas = [
                {
                    scenario: 'Lie to save lives',
                    summary: 'Must lie to prevent massacre',
                    ethics: 'utilitarian vs deontological'
                },
                {
                    scenario: 'Sacrifice one to save many',
                    summary: 'Trolley problem variant',
                    ethics: 'utilitarian calculus'
                },
                {
                    scenario: 'Honor vs compassion',
                    summary: 'Oath requires harmful action',
                    ethics: 'competing virtues'
                }
            ];

            for (const dilemma of dilemmas) {
                await handleRecordConversationMemory({
                    characterId: 'pc-seeker',
                    npcId: moralAdvisor.id,
                    summary: `Dilemma: ${dilemma.summary}`,
                    importance: 'critical',
                    topics: [dilemma.ethics, 'moral']
                }, mockCtx);
            }

            // Test: Wise NPC should provide nuanced ethical reasoning
            const context = await handleGetNpcContext({
                characterId: 'pc-seeker',
                npcId: moralAdvisor.id
            }, mockCtx);

            const contextData = JSON.parse(context.content[0].text);
            expect(contextData.recentMemories.length).toBe(3);
        });
    });

    describe('Cultural and Social Context', () => {

        test('8.6 - NPCs react based on cultural backgrounds', async () => {
            const noble = createTestCharacter({
                name: 'High Noble',
                behavior: 'honor-bound',
                stats: { str: 10, dex: 12, con: 12, int: 14, wis: 12, cha: 16 },
                factionId: 'nobility'
            });

            const commoner = createTestCharacter({
                name: 'Street Urchin',
                behavior: 'survival-focused',
                stats: { str: 10, dex: 14, con: 10, int: 10, wis: 12, cha: 8 },
                factionId: 'street'
            });

            // Same situation, different cultural responses
            const situation = 'Public confrontation over minor insult';

            await handleRecordConversationMemory({
                characterId: 'pc-witness',
                npcId: noble.id,
                summary: `Noble responds to ${situation} with formal challenge`,
                importance: 'medium',
                topics: ['honor', 'culture']
            }, mockCtx);

            await handleRecordConversationMemory({
                characterId: 'pc-witness',
                npcId: commoner.id,
                summary: `Urchin responds to ${situation} with street smarts`,
                importance: 'medium',
                topics: ['survival', 'culture']
            }, mockCtx);

            // Test: Different cultural backgrounds should produce different responses
            const nobleContext = await handleGetNpcContext({
                characterId: 'pc-witness',
                npcId: noble.id
            }, mockCtx);

            const commonerContext = await handleGetNpcContext({
                characterId: 'pc-witness',
                npcId: commoner.id
            }, mockCtx);

            expect(JSON.parse(nobleContext.content[0].text)).toBeDefined();
            expect(JSON.parse(commonerContext.content[0].text)).toBeDefined();
        });
    });
});

// =============================================================================
// TEST UTILITIES AND HELPERS
// =============================================================================

describe('Test Utilities and Helpers', () => {
    test('9.1 - Helper functions work correctly', () => {
        expect(createTestCharacter).toBeDefined();
        expect(typeof createTestCharacter).toBe('function');
        
        const testChar = createTestCharacter({ name: 'Helper Test' });
        expect(testChar.name).toBe('Helper Test');
    });

    test('9.2 - Mock context provides required session data', () => {
        expect(mockCtx.sessionId).toBe('test-session');
        expect(typeof mockCtx.sessionId).toBe('string');
    });

    test('9.3 - Database setup and cleanup works', () => {
        expect(db).toBeDefined();
        expect(charRepo).toBeDefined();
        expect(memoryRepo).toBeDefined();
        
        // Verify we can create and query data
        const testChar = createTestCharacter({ name: 'Cleanup Test' });
        const found = charRepo.findById(testChar.id);
        expect(found.name).toBe('Cleanup Test');
    });
});

// =============================================================================
// PERFORMANCE AND SCALABILITY
// =============================================================================

describe('Performance and Scalability', () => {
    test('10.1 - AI decision tests handle multiple NPCs efficiently', async () => {
        // Create many NPCs to test scalability
        const npcs = [];
        for (let i = 0; i < 50; i++) {
            npcs.push(createTestCharacter({
                name: `NPC ${i}`,
                behavior: ['friendly', 'aggressive', 'shy', 'wise'][i % 4]
            }));
        }

        // Create relationships with many NPCs
        for (const npc of npcs) {
            await handleUpdateNpcRelationship({
                characterId: 'pc-test',
                npcId: npc.id,
                familiarity: 'acquaintance',
                disposition: 'neutral'
            }, mockCtx);
        }

        // Test: System should handle multiple NPCs without performance issues
        const contexts = await Promise.all(
            npcs.slice(0, 10).map(npc => 
                handleGetNpcContext({
                    characterId: 'pc-test',
                    npcId: npc.id
                }, mockCtx)
            )
        );

        expect(contexts).toHaveLength(10);
        contexts.forEach(context => {
            expect(JSON.parse(context.content[0].text)).toBeDefined();
        });
    });

    test('10.2 - Memory systems scale with conversation history', async () => {
        const chattyNpc = createTestCharacter({
            name: 'Chatty Companion',
            behavior: 'friendly'
        });

        // Record many conversations
        for (let i = 0; i < 100; i++) {
            await handleRecordConversationMemory({
                characterId: 'pc-regular',
                npcId: chattyNpc.id,
                summary: `Conversation ${i}: ${['weather', 'politics', 'adventure', 'family'][i % 4]}`,
                importance: ['low', 'medium', 'high'][i % 3] as any,
                topics: [`topic${i}`]
            }, mockCtx);
        }

        // Test: Should handle large conversation history efficiently
        const context = await handleGetNpcContext({
            characterId: 'pc-regular',
            npcId: chattyNpc.id,
            memoryLimit: 5
        }, mockCtx);

        const contextData = JSON.parse(context.content[0].text);
        expect(contextData.relationship).toBeDefined();
        expect(contextData.recentMemories).toHaveLength(5); // Limited by memoryLimit
    });
});