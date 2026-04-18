import { CombatRNG, CheckResult } from './rng.js';
import { Condition, ConditionType, DurationType, Ability, CONDITION_EFFECTS } from './conditions.js';

import { SizeCategory, GridBounds } from '../../schema/encounter.js';

/**
 * Character interface for combat participants
 *
 * D&D 5e legendary creature properties:
 * - legendaryActions: Total actions available (usually 3)
 * - legendaryActionsRemaining: Actions left this round (resets at start of their turn)
 * - legendaryResistances: Total resistances (usually 3/day)
 * - legendaryResistancesRemaining: Resistances left (does NOT reset between rounds)
 * - hasLairActions: Whether this creature can use lair actions on initiative 20
 *
 * Spatial combat properties (Phase 1-4):
 * - position: Current grid position
 * - movementSpeed: Base speed in feet (default 30)
 * - movementRemaining: Remaining movement this turn
 * - size: Creature size category (affects footprint)
 */
export interface CombatParticipant {
    id: string;
    name: string;
    initiativeBonus: number;
    initiative?: number;  // Rolled initiative value (set when encounter starts)
    isEnemy?: boolean;    // Whether this is an enemy (for turn automation)
    hp: number;
    maxHp: number;
    conditions: Condition[];
    position?: { x: number; y: number; z?: number };  // CRIT-003: Spatial position
    // Phase 4: Movement economy
    movementSpeed?: number;       // Base speed in feet (default 30)
    movementRemaining?: number;   // Remaining movement this turn (in feet)
    size?: SizeCategory;          // Creature size for footprint calculation
    hasDashed?: boolean;          // Whether dash action was used this turn
    // HIGH-002: Damage modifiers
    resistances?: string[];    // Damage types that deal half damage
    vulnerabilities?: string[]; // Damage types that deal double damage
    immunities?: string[];      // Damage types that deal no damage
    // HIGH-003: Opportunity attack tracking
    reactionUsed?: boolean;    // Whether reaction has been used this round
    hasDisengaged?: boolean;   // Whether creature took disengage action this turn
    // ACTION ECONOMY
    actionUsed?: boolean;          // Has used main Action this turn
    bonusActionUsed?: boolean;     // Has used Bonus Action this turn
    spellsCast?: {                 // Track spells cast this turn for Bonus Action Rule
        action?: number;           // Level of spell cast as Action
        bonus?: number;            // Level of spell cast as Bonus Action
        reaction?: number;         // Level of spell cast as Reaction
    };
    // LEGENDARY CREATURE SUPPORT
    legendaryActions?: number;           // Total legendary actions per round (usually 3)
    legendaryActionsRemaining?: number;  // Remaining legendary actions this round
    legendaryResistances?: number;       // Total legendary resistances (usually 3/day)
    legendaryResistancesRemaining?: number; // Remaining legendary resistances
    hasLairActions?: boolean;            // Can use lair actions on initiative 20
    abilityScores?: {
        strength: number;
        dexterity: number;
        constitution: number;
        intelligence: number;
        wisdom: number;
        charisma: number;
    };
    // MED-003: Death Saving Throw tracking
    deathSaveSuccesses?: number;  // 0-3, 3 = stabilized
    deathSaveFailures?: number;   // 0-3, 3 = dead
    isStabilized?: boolean;       // Unconscious but won't die
    isDead?: boolean;             // Permanently defeated
    // COMBAT STATS (Auto-resolution)
    ac?: number;               // Armor Class
    attackDamage?: string;     // Default attack damage (e.g., "1d6+2")
    attackBonus?: number;      // Default attack bonus used if none provided
}

/**
 * Combat state tracking
 */
export interface CombatState {
    participants: CombatParticipant[];
    turnOrder: string[]; // IDs in initiative order (may include 'LAIR' for lair actions)
    currentTurnIndex: number;
    round: number;
    terrain?: {  // CRIT-003: Terrain configuration
        obstacles: string[];  // "x,y" format blocking tiles
        difficultTerrain?: string[];
        water?: string[];  // Water terrain (streams, rivers)
    };
    props?: Array<{  // Improvised props/objects (trees, ladders, buildings, etc.)
        id: string;
        position: string;  // "x,y" format
        label: string;     // Free-text label
        propType: 'structure' | 'cover' | 'climbable' | 'hazard' | 'interactive' | 'decoration';
        heightFeet?: number;
        cover?: 'none' | 'half' | 'three_quarter' | 'full';
        climbable?: boolean;
        climbDC?: number;
        breakable?: boolean;
        hp?: number;
        currentHp?: number;
        description?: string;
    }>;
    gridBounds?: GridBounds;   // Phase 2: Spatial boundary validation (BUG-001 fix)
    hasLairActions?: boolean;  // Whether any participant has lair actions
    lairOwnerId?: string;      // ID of the creature that owns the lair
}

/**
 * Result of a combat action with full transparency
 */
export interface CombatActionResult {
    type: 'attack' | 'heal' | 'damage' | 'save';
    actor: { id: string; name: string };
    target: { id: string; name: string; hpBefore: number; hpAfter: number; maxHp: number };
    
    // Attack specifics (if type === 'attack')
    attackRoll?: CheckResult;
    damage?: number;
    damageRolls?: number[];  // Individual damage dice
    
    // Heal specifics (if type === 'heal')
    healAmount?: number;
    
    // Status
    success: boolean;
    defeated: boolean;
    message: string;
    detailedBreakdown: string;
}

/**
 * Result of a legendary action use
 */
export interface LegendaryActionResult {
    success: boolean;
    remaining: number;
    error?: string;
}

/**
 * Result of a legendary resistance use
 */
export interface LegendaryResistanceResult {
    success: boolean;
    remaining: number;
    error?: string;
}

/**
 * MED-003: Result of a death saving throw
 */
export interface DeathSaveResult {
    roll: number;           // d20 result
    isNat20: boolean;       // Regain 1 HP
    isNat1: boolean;        // Counts as 2 failures
    success: boolean;       // 10+ = success
    successes: number;      // Total successes (0-3)
    failures: number;       // Total failures (0-3)
    isStabilized: boolean;  // 3 successes
    isDead: boolean;        // 3 failures
    regainedHp: boolean;    // Nat 20 - character is conscious again
}

export interface EventEmitter {
    publish(topic: string, payload: any): void;
}

/**
 * Combat Engine for managing RPG combat encounters
 * Handles initiative, turn order, and combat flow
 * 
 * Now supports D&D 5e legendary creatures:
 * - Legendary Actions (usable at end of other creatures' turns)
 * - Legendary Resistances (auto-succeed failed saves)
 * - Lair Actions (trigger on initiative count 20)
 */
export class CombatEngine {
    private rng: CombatRNG;
    private state: CombatState | null = null;
    private emitter?: EventEmitter;

    constructor(seed: string, emitter?: EventEmitter) {
        this.rng = new CombatRNG(seed);
        this.emitter = emitter;
    }

    /**
     * Start a new combat encounter
     * Rolls initiative for all participants and establishes turn order
     * 
     * If any participant has hasLairActions=true, adds 'LAIR' to turn order at initiative 20
     */
    startEncounter(participants: CombatParticipant[]): CombatState {
        // Roll initiative for each participant and store the value
        const participantsWithInitiative = participants.map(p => {
            const rolledInitiative = this.rng.d20(p.initiativeBonus);
            return {
                ...p,
                ac: p.ac,
                attackDamage: p.attackDamage,
                attackBonus: p.attackBonus,
                initiative: rolledInitiative,
                // Auto-detect isEnemy if not explicitly set
                isEnemy: p.isEnemy ?? this.detectIsEnemy(p.id, p.name),
                // Initialize legendary actions remaining to max if applicable
                legendaryActionsRemaining: p.legendaryActions ?? p.legendaryActionsRemaining,
                legendaryResistancesRemaining: p.legendaryResistances ?? p.legendaryResistancesRemaining,
                // Initialize resources
                movementRemaining: p.movementSpeed ?? 30,
                actionUsed: false,
                bonusActionUsed: false,
                spellsCast: {},
                reactionUsed: false,
                hasDashed: false,
                hasDisengaged: false
            };
        });

        // Check if any participant has lair actions
        const lairOwner = participantsWithInitiative.find(p => p.hasLairActions);
        const hasLairActions = !!lairOwner;

        // Sort by initiative (highest first), use ID as tiebreaker for determinism
        participantsWithInitiative.sort((a, b) => {
            if (b.initiative !== a.initiative) {
                return b.initiative - a.initiative;
            }
            return a.id.localeCompare(b.id);
        });

        // Build turn order
        let turnOrder = participantsWithInitiative.map(r => r.id);

        // If there's a lair owner, insert 'LAIR' at initiative 20
        if (hasLairActions) {
            // Find the right position for initiative 20
            // LAIR goes after all creatures with initiative > 20, before those with initiative <= 20
            const lairIndex = participantsWithInitiative.findIndex(p => (p.initiative ?? 0) <= 20);
            if (lairIndex === -1) {
                // All initiatives are above 20, add at end
                turnOrder.push('LAIR');
            } else {
                // Insert LAIR at the correct position
                turnOrder.splice(lairIndex, 0, 'LAIR');
            }
        }

        this.state = {
            participants: participantsWithInitiative,
            turnOrder,
            currentTurnIndex: 0,
            round: 1,
            hasLairActions,
            lairOwnerId: lairOwner?.id
        };

        this.emitter?.publish('combat', {
            type: 'encounter_started',
            state: this.state
        });

        return this.state;
    }

    /**
     * Auto-detect if a participant is an enemy based on ID/name patterns
     * 
     * IMPORTANT: UUIDs (like "9e48fa16-0ee4-4b99-a1e0-a162528d1e24") are typically 
     * player characters created via the UI. Pattern-based IDs (like "goblin-1", 
     * "orc-archer-2") are typically spawned enemies. Default to false for UUIDs.
     */
    private detectIsEnemy(id: string, name: string): boolean {
        const idLower = id.toLowerCase();
        const nameLower = name.toLowerCase();

        // Common enemy patterns - check NAME first (most reliable for determination)
        const enemyPatterns = [
            'goblin', 'orc', 'wolf', 'bandit', 'skeleton', 'zombie',
            'dragon', 'troll', 'ogre', 'kobold', 'gnoll', 'demon',
            'devil', 'undead', 'enemy', 'monster', 'creature', 'beast',
            'spider', 'rat', 'bat', 'slime', 'ghost', 'wraith',
            'dracolich', 'lich', 'vampire', 'golem', 'elemental',
            'cultist', 'thug', 'assassin', 'minion', 'guard', 'scout',
            'warrior', 'archer', 'mage', 'shaman', 'warlord', 'boss'
        ];

        // Check NAME for enemy patterns (more reliable since IDs can be UUIDs)
        for (const pattern of enemyPatterns) {
            if (nameLower.includes(pattern)) {
                return true;
            }
        }

        // Check ID for enemy patterns (for pattern-based IDs like "goblin-1")
        for (const pattern of enemyPatterns) {
            if (idLower.includes(pattern)) {
                return true;
            }
        }

        // Common player/ally patterns (not enemies)
        const allyPatterns = [
            'hero', 'player', 'pc', 'ally', 'companion', 'npc-friendly',
            'party', 'adventurer', 'cleric', 'paladin', 'ranger', 'rogue',
            'wizard', 'sorcerer', 'warlock', 'bard', 'druid', 'monk', 'fighter'
        ];

        for (const pattern of allyPatterns) {
            if (idLower.includes(pattern) || nameLower.includes(pattern)) {
                return false;
            }
        }

        // Check if ID looks like a UUID (player characters created via UI have UUIDs)
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (uuidPattern.test(id)) {
            // UUIDs are typically player characters - default to NOT enemy
            return false;
        }

        // Default: for non-UUID IDs that don't match patterns, check if ID starts with enemy pattern
        // This catches pattern-based IDs like "enemy-1" or "mob-3"
        if (idLower.startsWith('enemy') || idLower.startsWith('mob') || idLower.startsWith('hostile')) {
            return true;
        }

        // Fallback default: unknown entities default to NOT enemy
        // Reasoning: It's safer to have an enemy show as friendly (player corrects it)
        // than to have a player character show as enemy (breaks immersion)
        return false;
    }

    /**
     * Get the current state
     */
    getState(): CombatState | null {
        return this.state;
    }

    /**
     * Load an existing combat state
     */
    loadState(state: CombatState): void {
        this.state = state;
    }

    /**
     * Get the participant whose turn it currently is
     * Returns null if it's LAIR's turn
     */
    getCurrentParticipant(): CombatParticipant | null {
        if (!this.state) return null;

        const currentId = this.state.turnOrder[this.state.currentTurnIndex];
        
        // LAIR is a special entry, not a participant
        if (currentId === 'LAIR') return null;
        
        return this.state.participants.find(p => p.id === currentId) || null;
    }

    /**
     * Check if it's currently the LAIR's turn (initiative 20)
     */
    isLairActionPending(): boolean {
        if (!this.state) return false;
        return this.state.turnOrder[this.state.currentTurnIndex] === 'LAIR';
    }

    /**
     * Check if a legendary creature can use a legendary action
     * Rules: Can only use at the end of another creature's turn, not their own
     */
    canUseLegendaryAction(participantId: string): boolean {
        if (!this.state) return false;

        const participant = this.state.participants.find(p => p.id === participantId);
        if (!participant) return false;

        // Must have legendary actions
        if (!participant.legendaryActions || participant.legendaryActions <= 0) return false;

        // Must have remaining uses
        if (!participant.legendaryActionsRemaining || participant.legendaryActionsRemaining <= 0) return false;

        // Cannot use on their own turn
        const currentId = this.state.turnOrder[this.state.currentTurnIndex];
        if (currentId === participantId) return false;

        // Cannot use if it's the LAIR's turn (no creature to follow)
        if (currentId === 'LAIR') return false;

        return true;
    }

    /**
     * Use a legendary action
     * @param participantId - ID of the legendary creature
     * @param cost - How many legendary actions this use costs (default 1)
     * @returns Result with success status and remaining actions
     */
    useLegendaryAction(participantId: string, cost: number = 1): LegendaryActionResult {
        if (!this.state) {
            return { success: false, remaining: 0, error: 'No active combat' };
        }

        const participant = this.state.participants.find(p => p.id === participantId);
        if (!participant) {
            return { success: false, remaining: 0, error: 'Participant not found' };
        }

        if (!this.canUseLegendaryAction(participantId)) {
            return { 
                success: false, 
                remaining: participant.legendaryActionsRemaining ?? 0,
                error: 'Cannot use legendary action (own turn, no actions, or none remaining)'
            };
        }

        const remaining = participant.legendaryActionsRemaining ?? 0;
        if (remaining < cost) {
            return {
                success: false,
                remaining,
                error: `Not enough legendary actions (need ${cost}, have ${remaining})`
            };
        }

        participant.legendaryActionsRemaining = remaining - cost;

        this.emitter?.publish('combat', {
            type: 'legendary_action_used',
            participantId,
            cost,
            remaining: participant.legendaryActionsRemaining
        });

        return {
            success: true,
            remaining: participant.legendaryActionsRemaining
        };
    }

    /**
     * Use a legendary resistance to automatically succeed on a failed save
     * Unlike legendary actions, these do NOT reset each round
     */
    useLegendaryResistance(participantId: string): LegendaryResistanceResult {
        if (!this.state) {
            return { success: false, remaining: 0, error: 'No active combat' };
        }

        const participant = this.state.participants.find(p => p.id === participantId);
        if (!participant) {
            return { success: false, remaining: 0, error: 'Participant not found' };
        }

        // Must have legendary resistances
        if (!participant.legendaryResistances || participant.legendaryResistances <= 0) {
            return { success: false, remaining: 0, error: 'No legendary resistances' };
        }

        const remaining = participant.legendaryResistancesRemaining ?? 0;
        if (remaining <= 0) {
            return { success: false, remaining: 0, error: 'No legendary resistances remaining' };
        }

        participant.legendaryResistancesRemaining = remaining - 1;

        this.emitter?.publish('combat', {
            type: 'legendary_resistance_used',
            participantId,
            remaining: participant.legendaryResistancesRemaining
        });

        return {
            success: true,
            remaining: participant.legendaryResistancesRemaining
        };
    }

    /**
     * Reset legendary actions for a participant (called at start of their turn)
     */
    private resetLegendaryActions(participant: CombatParticipant): void {
        if (participant.legendaryActions && participant.legendaryActions > 0) {
            participant.legendaryActionsRemaining = participant.legendaryActions;
        }
    }

    /**
     * Advance to the next turn
     * Returns the participant whose turn it now is
     */
    nextTurn(): CombatParticipant | null {
        if (!this.state) return null;

        this.state.currentTurnIndex++;

        // If we've gone through everyone, start a new round
        if (this.state.currentTurnIndex >= this.state.turnOrder.length) {
            this.state.currentTurnIndex = 0;
            this.state.round++;
        }

        return this.getCurrentParticipant();
    }

    /**
     * HIGH-002: Calculate damage after applying resistance/vulnerability/immunity
     */
    private calculateDamageWithModifiers(
        baseDamage: number,
        damageType: string | undefined,
        target: CombatParticipant
    ): { finalDamage: number; modifier: 'immune' | 'resistant' | 'vulnerable' | 'normal' } {
        if (!damageType) {
            return { finalDamage: baseDamage, modifier: 'normal' };
        }

        const typeLC = damageType.toLowerCase();

        // Check immunity first (takes precedence)
        if (target.immunities?.some(i => i.toLowerCase() === typeLC)) {
            return { finalDamage: 0, modifier: 'immune' };
        }

        // Check resistance
        if (target.resistances?.some(r => r.toLowerCase() === typeLC)) {
            return { finalDamage: Math.floor(baseDamage / 2), modifier: 'resistant' };
        }

        // Check vulnerability
        if (target.vulnerabilities?.some(v => v.toLowerCase() === typeLC)) {
            return { finalDamage: baseDamage * 2, modifier: 'vulnerable' };
        }

        return { finalDamage: baseDamage, modifier: 'normal' };
    }

    /**
     * Execute an attack with full transparency
     * Returns detailed breakdown of what happened
     */
    executeAttack(
        actorId: string,
        targetId: string,
        attackBonus: number,
        dc: number,
        damage: number | string,
        damageType?: string  // HIGH-002: Optional damage type for resistance calculation
    ): CombatActionResult {
        if (!this.state) throw new Error('No active combat');

        const actor = this.state.participants.find(p => p.id === actorId);
        const target = this.state.participants.find(p => p.id === targetId);

        if (!actor) throw new Error(`Actor ${actorId} not found`);
        if (!target) throw new Error(`Target ${targetId} not found`);

        const hpBefore = target.hp;

        // Roll with full transparency
        const attackRoll = this.rng.checkDegreeDetailed(attackBonus, dc);

        let damageDealt = 0;
        let damageModifier: 'immune' | 'resistant' | 'vulnerable' | 'normal' = 'normal';

        // Calculate base damage from number or string
        let baseDamageVal = 0;
        let damageBreakdownStr = '';

        if (typeof damage === 'string') {
            const dmgResult = this.rng.rollDamageDetailed(damage);
            baseDamageVal = dmgResult.total;
            damageBreakdownStr = ` (${dmgResult.rolls.join('+')}${dmgResult.modifier >= 0 ? '+' + dmgResult.modifier : dmgResult.modifier})`;
        } else {
            baseDamageVal = damage;
        }

        if (attackRoll.isHit) {
            // Critical Hit: Double the dice (approx. double the value for now if passing number)
            // If string was passed, we ideally double the DICE, but for now double the total is consistent with current impl.
            // TODO(medium): Implement proper crit rules (double dice) using rollDamageDetailed
            const finalBaseDamage = attackRoll.isCrit ? baseDamageVal * 2 : baseDamageVal;
            
            // HIGH-002: Apply resistance/vulnerability/immunity
            const modResult = this.calculateDamageWithModifiers(finalBaseDamage, damageType, target);
            damageDealt = modResult.finalDamage;
            damageModifier = modResult.modifier;
            target.hp = Math.max(0, target.hp - damageDealt);
        }

        const defeated = target.hp <= 0;

        // Build detailed breakdown
        let breakdown = `🎲 Attack Roll: d20(${attackRoll.roll}) + ${attackBonus} = ${attackRoll.total} vs AC ${dc}\n`;

        if (attackRoll.isNat20) {
            breakdown += `   ⭐ NATURAL 20!\n`;
        } else if (attackRoll.isNat1) {
            breakdown += `   💀 NATURAL 1!\n`;
        }

        breakdown += `   ${attackRoll.isHit ? '✅ HIT' : '❌ MISS'}`;

        if (attackRoll.isHit) {
            breakdown += attackRoll.isCrit ? ' (CRITICAL!)' : '';

            // HIGH-002: Show damage type and modifier
            const typeStr = damageType ? ` ${damageType}` : '';
            let modStr = '';
            if (damageModifier === 'immune') {
                modStr = ' [IMMUNE - No damage!]';
            } else if (damageModifier === 'resistant') {
                modStr = ' [Resistant - Halved!]';
            } else if (damageModifier === 'vulnerable') {
                modStr = ' [Vulnerable - Doubled!]';
            }

            breakdown += `\n\n💥 Damage: ${damageDealt}${typeStr}${damageBreakdownStr}${attackRoll.isCrit ? ' (crit)' : ''}${modStr}\n`;
            breakdown += `   ${target.name}: ${hpBefore} → ${target.hp}/${target.maxHp} HP`;
            if (defeated) {
                breakdown += ` [DEFEATED]`;
            }
        }

        // Build simple message
        let message = '';
        if (attackRoll.isHit) {
            message = `${attackRoll.isCrit ? 'CRITICAL ' : ''}HIT! ${actor.name} deals ${damageDealt} damage to ${target.name}`;
            if (defeated) message += ' [DEFEATED]';
        } else {
            message = `MISS! ${actor.name}'s attack misses ${target.name}`;
        }

        this.emitter?.publish('combat', {
            type: 'attack_executed',
            result: {
                actor: actor.name,
                target: target.name,
                roll: attackRoll.roll,
                total: attackRoll.total,
                dc,
                hit: attackRoll.isHit,
                crit: attackRoll.isCrit,
                damage: damageDealt,
                targetHp: target.hp
            }
        });

        return {
            type: 'attack',
            actor: { id: actor.id, name: actor.name },
            target: { id: target.id, name: target.name, hpBefore, hpAfter: target.hp, maxHp: target.maxHp },
            attackRoll,
            damage: damageDealt,
            success: attackRoll.isHit,
            defeated,
            message,
            detailedBreakdown: breakdown
        };
    }

    /**
     * Execute a heal action
     */
    executeHeal(actorId: string, targetId: string, amount: number): CombatActionResult {
        if (!this.state) throw new Error('No active combat');

        const actor = this.state.participants.find(p => p.id === actorId);
        const target = this.state.participants.find(p => p.id === targetId);
        
        if (!actor) throw new Error(`Actor ${actorId} not found`);
        if (!target) throw new Error(`Target ${targetId} not found`);

        const hpBefore = target.hp;
        const actualHeal = Math.min(amount, target.maxHp - target.hp);
        target.hp = Math.min(target.maxHp, target.hp + amount);

        const breakdown = `💚 Heal: ${amount} HP\n` +
            `   ${target.name}: ${hpBefore} → ${target.hp}/${target.maxHp} HP\n` +
            (actualHeal < amount ? `   (${amount - actualHeal} HP wasted - at max)` : '');

        const message = `${actor.name} heals ${target.name} for ${actualHeal} HP`;

        this.emitter?.publish('combat', {
            type: 'heal_executed',
            result: {
                actor: actor.name,
                target: target.name,
                amount: actualHeal,
                targetHp: target.hp
            }
        });

        return {
            type: 'heal',
            actor: { id: actor.id, name: actor.name },
            target: { id: target.id, name: target.name, hpBefore, hpAfter: target.hp, maxHp: target.maxHp },
            healAmount: actualHeal,
            success: true,
            defeated: false,
            message,
            detailedBreakdown: breakdown
        };
    }

    /**
     * Pathfinder 2e: Make a check and return degree of success
     */
    makeCheck(
        modifier: number,
        dc: number
    ): 'critical-failure' | 'failure' | 'success' | 'critical-success' {
        return this.rng.checkDegree(modifier, dc);
    }

    /**
     * Make a detailed check exposing all dice mechanics
     */
    makeCheckDetailed(modifier: number, dc: number): CheckResult {
        return this.rng.checkDegreeDetailed(modifier, dc);
    }

    /**
     * Apply damage to a participant
     */
    applyDamage(participantId: string, damage: number): void {
        if (!this.state) return;

        const participant = this.state.participants.find(p => p.id === participantId);
        if (participant) {
            participant.hp = Math.max(0, participant.hp - damage);
            this.emitter?.publish('combat', {
                type: 'damage_applied',
                participantId,
                amount: damage,
                newHp: participant.hp
            });
        }
    }

    /**
     * Heal a participant
     * MED-003: Also resets death saves if healing from 0 HP
     */
    heal(participantId: string, amount: number): void {
        if (!this.state) return;

        const participant = this.state.participants.find(p => p.id === participantId);
        if (participant) {
            const wasAtZero = participant.hp === 0;
            participant.hp = Math.min(participant.maxHp, participant.hp + amount);

            // MED-003: Reset death saves when healed from 0 HP
            if (wasAtZero && participant.hp > 0) {
                participant.deathSaveSuccesses = 0;
                participant.deathSaveFailures = 0;
                participant.isStabilized = false;
            }

            this.emitter?.publish('combat', {
                type: 'healed',
                participantId,
                amount,
                newHp: participant.hp
            });
        }
    }

    /**
     * MED-003: Roll a death saving throw for a participant at 0 HP
     * D&D 5e Rules:
     * - Roll d20
     * - 10+ = success
     * - 9 or less = failure
     * - Natural 20 = regain 1 HP (conscious again)
     * - Natural 1 = counts as 2 failures
     * - 3 successes = stabilized (unconscious but won't die)
     * - 3 failures = dead
     */
    rollDeathSave(participantId: string): DeathSaveResult | null {
        if (!this.state) return null;

        const participant = this.state.participants.find(p => p.id === participantId);
        if (!participant) return null;

        // Can only roll death saves at 0 HP
        if (participant.hp > 0) {
            return null;
        }

        // Already dead - can't roll
        if (participant.isDead) {
            return null;
        }

        // Already stabilized - no need to roll
        if (participant.isStabilized) {
            return null;
        }

        // Initialize death save counters if needed
        if (participant.deathSaveSuccesses === undefined) {
            participant.deathSaveSuccesses = 0;
        }
        if (participant.deathSaveFailures === undefined) {
            participant.deathSaveFailures = 0;
        }

        // Roll the d20
        const roll = Math.floor(Math.random() * 20) + 1;
        const isNat20 = roll === 20;
        const isNat1 = roll === 1;
        const success = roll >= 10;

        // Apply results
        if (isNat20) {
            // Natural 20: regain 1 HP, reset death saves
            participant.hp = 1;
            participant.deathSaveSuccesses = 0;
            participant.deathSaveFailures = 0;
            participant.isStabilized = false;
        } else if (isNat1) {
            // Natural 1: counts as 2 failures
            participant.deathSaveFailures = Math.min(3, participant.deathSaveFailures + 2);
        } else if (success) {
            participant.deathSaveSuccesses = Math.min(3, participant.deathSaveSuccesses + 1);
        } else {
            participant.deathSaveFailures = Math.min(3, participant.deathSaveFailures + 1);
        }

        // Check for stabilization or death
        if (participant.deathSaveSuccesses >= 3) {
            participant.isStabilized = true;
        }
        if (participant.deathSaveFailures >= 3) {
            participant.isDead = true;
        }

        const result: DeathSaveResult = {
            roll,
            isNat20,
            isNat1,
            success,
            successes: participant.deathSaveSuccesses,
            failures: participant.deathSaveFailures,
            isStabilized: participant.isStabilized ?? false,
            isDead: participant.isDead ?? false,
            regainedHp: isNat20
        };

        this.emitter?.publish('combat', {
            type: 'death_save',
            participantId,
            result
        });

        return result;
    }

    /**
     * MED-003: Apply damage at 0 HP (causes automatic death save failures)
     * D&D 5e Rules: Taking damage at 0 HP = 1 failure (crit = 2 failures)
     */
    applyDamageAtZeroHp(participantId: string, isCritical: boolean = false): void {
        if (!this.state) return;

        const participant = this.state.participants.find(p => p.id === participantId);
        if (!participant || participant.hp > 0 || participant.isDead) return;

        // Initialize if needed
        if (participant.deathSaveFailures === undefined) {
            participant.deathSaveFailures = 0;
        }

        // Critical hits cause 2 failures, normal hits cause 1
        const failures = isCritical ? 2 : 1;
        participant.deathSaveFailures = Math.min(3, participant.deathSaveFailures + failures);

        if (participant.deathSaveFailures >= 3) {
            participant.isDead = true;
        }

        // No longer stabilized if taking damage
        participant.isStabilized = false;

        this.emitter?.publish('combat', {
            type: 'death_save_failure',
            participantId,
            failures,
            total: participant.deathSaveFailures,
            isDead: participant.isDead
        });
    }

    /**
     * Check if a participant is still conscious (hp > 0)
     */
    isConscious(participantId: string): boolean {
        if (!this.state) return false;

        const participant = this.state.participants.find(p => p.id === participantId);
        return participant ? participant.hp > 0 : false;
    }

    /**
     * Get count of conscious participants
     */
    getConsciousCount(): number {
        if (!this.state) return 0;

        return this.state.participants.filter(p => p.hp > 0).length;
    }

    /**
     * Apply a condition to a participant
     */
    applyCondition(participantId: string, condition: Omit<Condition, 'id'>): Condition {
        if (!this.state) throw new Error('No active combat');

        const participant = this.state.participants.find(p => p.id === participantId);
        if (!participant) throw new Error(`Participant ${participantId} not found`);

        // Generate unique ID for condition instance
        const fullCondition: Condition = {
            ...condition,
            id: `${participantId}-${condition.type}-${Date.now()}-${Math.random()}`
        };

        participant.conditions.push(fullCondition);
        return fullCondition;
    }

    /**
     * Remove a specific condition instance by ID
     */
    removeCondition(participantId: string, conditionId: string): boolean {
        if (!this.state) return false;

        const participant = this.state.participants.find(p => p.id === participantId);
        if (!participant) return false;

        const initialLength = participant.conditions.length;
        participant.conditions = participant.conditions.filter(c => c.id !== conditionId);
        return participant.conditions.length < initialLength;
    }

    /**
     * Remove all conditions of a specific type from a participant
     */
    removeConditionsByType(participantId: string, type: ConditionType): number {
        if (!this.state) return 0;

        const participant = this.state.participants.find(p => p.id === participantId);
        if (!participant) return 0;

        const initialLength = participant.conditions.length;
        participant.conditions = participant.conditions.filter(c => c.type !== type);
        return initialLength - participant.conditions.length;
    }

    /**
     * Check if a participant has a specific condition type
     */
    hasCondition(participantId: string, type: ConditionType): boolean {
        if (!this.state) return false;

        const participant = this.state.participants.find(p => p.id === participantId);
        return participant ? participant.conditions.some(c => c.type === type) : false;
    }

    /**
     * Get all conditions on a participant
     */
    getConditions(participantId: string): Condition[] {
        if (!this.state) return [];

        const participant = this.state.participants.find(p => p.id === participantId);
        return participant ? [...participant.conditions] : [];
    }

    /**
     * HIGH-003: Reset reaction and disengage status at start of turn
     */
    private resetTurnResources(participant: CombatParticipant): void {
        participant.reactionUsed = false;
        participant.hasDisengaged = false;
        participant.hasDashed = false;
        participant.actionUsed = false;
        participant.bonusActionUsed = false;
        participant.spellsCast = {};
        participant.movementRemaining = participant.movementSpeed ?? 30;
    }

    /**
     * Apply the Dash action for a participant. Adds a fresh movement
     * allotment on top of whatever they already have left, and flags
     * hasDashed so the budget-check in move actions sees the doubled
     * window. Consumes the main action.
     */
    applyDash(participantId: string): { ok: true; movementRemaining: number } | { ok: false; error: string } {
        if (!this.state) return { ok: false, error: 'No active combat' };
        const participant = this.state.participants.find((p) => p.id === participantId);
        if (!participant) return { ok: false, error: `Participant ${participantId} not found` };
        if (participant.hasDashed) return { ok: false, error: 'Already dashed this turn' };

        const baseSpeed = participant.movementSpeed ?? 30;
        const currentRemaining = participant.movementRemaining ?? baseSpeed;
        participant.movementRemaining = currentRemaining + baseSpeed;
        participant.hasDashed = true;
        participant.actionUsed = true;

        return { ok: true, movementRemaining: participant.movementRemaining };
    }

    /**
     * Process start-of-turn condition effects
     */
    private processStartOfTurnConditions(participant: CombatParticipant): void {
        // HIGH-003: Reset reaction at start of turn
        this.resetTurnResources(participant);

        // LEGENDARY: Reset legendary actions at start of legendary creature's turn
        this.resetLegendaryActions(participant);

        for (const condition of [...participant.conditions]) {
            // Process ongoing effects
            if (condition.ongoingEffects) {
                for (const effect of condition.ongoingEffects) {
                    if (effect.trigger === 'start_of_turn') {
                        if (effect.type === 'damage' && effect.amount) {
                            this.applyDamage(participant.id, effect.amount);
                        } else if (effect.type === 'healing' && effect.amount) {
                            this.heal(participant.id, effect.amount);
                        } else if (effect.type === 'damage' && effect.dice) {
                            const damage = this.rng.roll(effect.dice);
                            this.applyDamage(participant.id, damage);
                        }
                    }
                }
            }

            // Handle duration for START_OF_TURN conditions
            if (condition.durationType === DurationType.START_OF_TURN) {
                this.removeCondition(participant.id, condition.id);
            } else if (condition.durationType === DurationType.ROUNDS && condition.duration !== undefined) {
                // Decrement round-based durations at start of turn
                condition.duration--;
                if (condition.duration <= 0) {
                    this.removeCondition(participant.id, condition.id);
                }
            }
        }
    }

    /**
     * Process end-of-turn condition effects
     */
    private processEndOfTurnConditions(participant: CombatParticipant): void {
        for (const condition of [...participant.conditions]) {
            // Process ongoing effects
            if (condition.ongoingEffects) {
                for (const effect of condition.ongoingEffects) {
                    if (effect.trigger === 'end_of_turn') {
                        if (effect.type === 'damage' && effect.amount) {
                            this.applyDamage(participant.id, effect.amount);
                        } else if (effect.type === 'healing' && effect.amount) {
                            this.heal(participant.id, effect.amount);
                        } else if (effect.type === 'damage' && effect.dice) {
                            const damage = this.rng.roll(effect.dice);
                            this.applyDamage(participant.id, damage);
                        }
                    }
                }
            }

            // Handle duration for END_OF_TURN conditions
            if (condition.durationType === DurationType.END_OF_TURN) {
                this.removeCondition(participant.id, condition.id);
            }

            // Handle save-ends conditions
            if (condition.durationType === DurationType.SAVE_ENDS && condition.saveDC && condition.saveAbility) {
                const saveBonus = this.getSaveBonus(participant, condition.saveAbility);
                const degree = this.rng.checkDegree(saveBonus, condition.saveDC);

                if (degree === 'success' || degree === 'critical-success') {
                    this.removeCondition(participant.id, condition.id);
                }
            }
        }
    }

    /**
     * Get saving throw bonus for a participant
     */
    private getSaveBonus(participant: CombatParticipant, ability: Ability): number {
        if (!participant.abilityScores) return 0;

        const score = participant.abilityScores[ability];
        // D&D 5e modifier calculation: (score - 10) / 2
        return Math.floor((score - 10) / 2);
    }

    /**
     * Enhanced nextTurn with condition processing and legendary action reset
     * Now auto-skips dead participants (HP <= 0)
     */
    nextTurnWithConditions(): CombatParticipant | null {
        if (!this.state) return null;

        // Process end-of-turn conditions for current participant (if not LAIR)
        const currentParticipant = this.getCurrentParticipant();
        if (currentParticipant && currentParticipant.hp > 0) {
            this.processEndOfTurnConditions(currentParticipant);
        }

        // Advance turn, automatically skipping dead participants
        let iterations = 0;
        const maxIterations = this.state.turnOrder.length + 1; // Safety limit
        let newParticipant: CombatParticipant | null = null;

        do {
            // Advance turn index
            this.state.currentTurnIndex++;

            if (this.state.currentTurnIndex >= this.state.turnOrder.length) {
                this.state.currentTurnIndex = 0;
                this.state.round++;
            }

            newParticipant = this.getCurrentParticipant();
            iterations++;

            // Exit if we found a living participant or exhausted all options
        } while (
            newParticipant && 
            newParticipant.hp <= 0 && 
            iterations < maxIterations
        );

        // Process start-of-turn conditions for new current participant (if alive)
        if (newParticipant && newParticipant.hp > 0) {
            this.processStartOfTurnConditions(newParticipant);
        }

        this.emitter?.publish('combat', {
            type: 'turn_changed',
            round: this.state.round,
            activeParticipantId: newParticipant?.id,
            isLairAction: this.isLairActionPending()
        });

        return newParticipant;
    }

    /**
     * Check if a participant can take actions (not incapacitated)
     */
    canTakeActions(participantId: string): boolean {
        if (!this.state) return false;

        const participant = this.state.participants.find(p => p.id === participantId);
        if (!participant || participant.hp <= 0) return false;

        // Check for incapacitating conditions
        return !participant.conditions.some(c => {
            const effects = CONDITION_EFFECTS[c.type];
            return effects.canTakeActions === false;
        });
    }

    /**
     * Check if a participant can take reactions
     */
    canTakeReactions(participantId: string): boolean {
        if (!this.state) return false;

        const participant = this.state.participants.find(p => p.id === participantId);
        if (!participant || participant.hp <= 0) return false;

        return !participant.conditions.some(c => {
            const effects = CONDITION_EFFECTS[c.type];
            return effects.canTakeReactions === false;
        });
    }

    /**
     * Validate Action Economy rules
     * Handles: Action/Bonus Action availability and "Bonus Action Spell" rule
     */
    validateActionEconomy(
        participantId: string, 
        actionType: 'action' | 'bonus' | 'reaction',
        spellLevel?: number
    ): { valid: boolean; error?: string } {
        if (!this.state) return { valid: false, error: 'No active combat' };

        const participant = this.state.participants.find(p => p.id === participantId);
        if (!participant) return { valid: false, error: 'Participant not found' };

        // 1. Check strict incapacitation
        if (!this.canTakeActions(participantId)) {
            return { valid: false, error: 'Participant is incapacitated' };
        }

        // 2. Check Action availability
        if (actionType === 'action') {
            if (participant.actionUsed) {
                return { valid: false, error: 'Action already used this turn' };
            }
            
            // Bonus Action Spell Rule: If bonus spell cast, Action can only be Cantrip (level 0)
            if (spellLevel !== undefined && spellLevel > 0) {
                if (participant.spellsCast?.bonus !== undefined) {
                    return { valid: false, error: 'Cannot cast leveled spell as Action after casting Bonus Action spell (only Cantrips allowed)' };
                }
            }
        } 
        else if (actionType === 'bonus') {
            if (participant.bonusActionUsed) {
                return { valid: false, error: 'Bonus Action already used this turn' };
            }

            // Bonus Action Spell Rule: If casting spell as BA, no leveled Action spell allowed
            if (spellLevel !== undefined) {
                // If we already cast a leveled action spell, we cannot cast a BA spell
                if (participant.spellsCast?.action !== undefined && participant.spellsCast.action > 0) {
                     return { valid: false, error: 'Cannot cast Bonus Action spell if leveled spell was cast as Action' };
                }
            }
        }
        else if (actionType === 'reaction') {
            if (!this.canTakeReactions(participantId)) {
                return { valid: false, error: 'Cannot take reactions (incapacitated or condition)' };
            }
            if (participant.reactionUsed) {
                return { valid: false, error: 'Reaction already used this round' };
            }
        }

        return { valid: true };
    }

    /**
     * Commit an action to the economy tracking
     */
    commitAction(
        participantId: string, 
        actionType: 'action' | 'bonus' | 'reaction', 
        spellLevel?: number
    ): void {
        if (!this.state) return;
        const participant = this.state.participants.find(p => p.id === participantId);
        if (!participant) return;

        if (!participant.spellsCast) participant.spellsCast = {};

        if (actionType === 'action') {
            participant.actionUsed = true;
            if (spellLevel !== undefined) participant.spellsCast.action = spellLevel;
        } else if (actionType === 'bonus') {
            participant.bonusActionUsed = true;
            if (spellLevel !== undefined) participant.spellsCast.bonus = spellLevel;
        } else if (actionType === 'reaction') {
            participant.reactionUsed = true;
            if (spellLevel !== undefined) participant.spellsCast.reaction = spellLevel;
        }
    }

    /**
     * HIGH-003: Check if two positions are adjacent (within 1 tile - 8-directional)
     */
    isAdjacent(pos1: { x: number; y: number }, pos2: { x: number; y: number }): boolean {
        const dx = Math.abs(pos1.x - pos2.x);
        const dy = Math.abs(pos1.y - pos2.y);
        return dx <= 1 && dy <= 1 && !(dx === 0 && dy === 0);
    }

    /**
     * HIGH-003: Get adjacent enemies that could make opportunity attacks
     * @param moverId - The creature that is moving
     * @param fromPos - Starting position
     * @param toPos - Target position
     * @returns Array of participants who can make opportunity attacks
     */
    getOpportunityAttackers(
        moverId: string,
        fromPos: { x: number; y: number },
        toPos: { x: number; y: number }
    ): CombatParticipant[] {
        if (!this.state) return [];

        const mover = this.state.participants.find(p => p.id === moverId);
        if (!mover) return [];

        // If mover has disengaged, no opportunity attacks are provoked
        if (mover.hasDisengaged) return [];

        const attackers: CombatParticipant[] = [];

        for (const p of this.state.participants) {
            // Skip self
            if (p.id === moverId) continue;

            // Skip defeated participants
            if (p.hp <= 0) continue;

            // Skip same faction (allies don't attack each other)
            if (p.isEnemy === mover.isEnemy) continue;

            // Skip if reaction already used
            if (p.reactionUsed) continue;

            // Skip if no position
            if (!p.position) continue;

            // Check if creature was adjacent to mover at start and is no longer adjacent at end
            const wasAdjacent = this.isAdjacent(fromPos, p.position);
            const stillAdjacent = this.isAdjacent(toPos, p.position);

            // Opportunity attack triggers when leaving threatened square (was adjacent, now not)
            if (wasAdjacent && !stillAdjacent) {
                attackers.push(p);
            }
        }

        return attackers;
    }

    /**
     * HIGH-003: Execute an opportunity attack
     * Uses simplified attack: d20 + attacker's initiative bonus vs target's initiative + 10
     * Damage is fixed at 1d6 + 2 for simplicity
     */
    executeOpportunityAttack(
        attackerId: string,
        targetId: string
    ): CombatActionResult {
        if (!this.state) throw new Error('No active combat');

        const attacker = this.state.participants.find(p => p.id === attackerId);
        const target = this.state.participants.find(p => p.id === targetId);

        if (!attacker) throw new Error(`Attacker ${attackerId} not found`);
        if (!target) throw new Error(`Target ${targetId} not found`);

        // Mark reaction as used
        attacker.reactionUsed = true;

        // Simple attack calculation: use initiative bonus as attack modifier
        // AC approximation: 10 + initiative bonus (simple heuristic)
        const attackBonus = attacker.initiativeBonus + 2; // Add a small bonus
        const targetAC = 10 + (target.initiativeBonus > 0 ? Math.floor(target.initiativeBonus / 2) : 0);

        // Fixed damage for opportunity attacks: 1d6 + 2
        const baseDamage = this.rng.roll('1d6') + 2;

        const hpBefore = target.hp;
        const attackRoll = this.rng.checkDegreeDetailed(attackBonus, targetAC);

        let damageDealt = 0;
        if (attackRoll.isHit) {
            damageDealt = attackRoll.isCrit ? baseDamage * 2 : baseDamage;
            target.hp = Math.max(0, target.hp - damageDealt);
        }

        const defeated = target.hp <= 0;

        // Build detailed breakdown
        let breakdown = `⚡ OPPORTUNITY ATTACK by ${attacker.name}!\n`;
        breakdown += `🎲 Attack Roll: d20(${attackRoll.roll}) + ${attackBonus} = ${attackRoll.total} vs AC ${targetAC}\n`;

        if (attackRoll.isNat20) {
            breakdown += `   ⭐ NATURAL 20!\n`;
        } else if (attackRoll.isNat1) {
            breakdown += `   💀 NATURAL 1!\n`;
        }

        breakdown += `   ${attackRoll.isHit ? '✅ HIT' : '❌ MISS'}`;

        if (attackRoll.isHit) {
            breakdown += attackRoll.isCrit ? ' (CRITICAL!)' : '';
            breakdown += `\n\n💥 Damage: ${damageDealt}${attackRoll.isCrit ? ' (crit)' : ''}\n`;
            breakdown += `   ${target.name}: ${hpBefore} → ${target.hp}/${target.maxHp} HP`;
            if (defeated) {
                breakdown += ` [DEFEATED]`;
            }
        }

        const message = attackRoll.isHit
            ? `OPPORTUNITY ATTACK HIT! ${attacker.name} strikes ${target.name} for ${damageDealt} damage`
            : `OPPORTUNITY ATTACK MISS! ${attacker.name}'s attack misses ${target.name}`;

        this.emitter?.publish('combat', {
            type: 'opportunity_attack',
            result: {
                attacker: attacker.name,
                target: target.name,
                roll: attackRoll.roll,
                total: attackRoll.total,
                ac: targetAC,
                hit: attackRoll.isHit,
                crit: attackRoll.isCrit,
                damage: damageDealt,
                targetHp: target.hp
            }
        });

        return {
            type: 'attack',
            actor: { id: attacker.id, name: attacker.name },
            target: { id: target.id, name: target.name, hpBefore, hpAfter: target.hp, maxHp: target.maxHp },
            attackRoll,
            damage: damageDealt,
            success: attackRoll.isHit,
            defeated,
            message,
            detailedBreakdown: breakdown
        };
    }

    /**
     * HIGH-003: Mark a participant as having taken the disengage action
     */
    disengage(participantId: string): void {
        if (!this.state) return;

        const participant = this.state.participants.find(p => p.id === participantId);
        if (participant) {
            participant.hasDisengaged = true;
        }
    }

    /**
     * Check if attacks against a participant have advantage
     */
    attacksAgainstHaveAdvantage(participantId: string): boolean {
        if (!this.state) return false;

        const participant = this.state.participants.find(p => p.id === participantId);
        if (!participant) return false;

        return participant.conditions.some(c => {
            const effects = CONDITION_EFFECTS[c.type];
            return effects.attacksAgainstAdvantage === true;
        });
    }

    /**
     * Check if a participant's attacks have disadvantage
     */
    attacksHaveDisadvantage(participantId: string): boolean {
        if (!this.state) return false;

        const participant = this.state.participants.find(p => p.id === participantId);
        if (!participant) return false;

        return participant.conditions.some(c => {
            const effects = CONDITION_EFFECTS[c.type];
            return effects.attackDisadvantage === true;
        });
    }
}
