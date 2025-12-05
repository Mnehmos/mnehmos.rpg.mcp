import { CombatRNG, CheckResult } from './rng.js';
import { Condition, ConditionType, DurationType, Ability, CONDITION_EFFECTS } from './conditions.js';

/**
 * Character interface for combat participants
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
    // HIGH-002: Damage modifiers
    resistances?: string[];    // Damage types that deal half damage
    vulnerabilities?: string[]; // Damage types that deal double damage
    immunities?: string[];      // Damage types that deal no damage
    abilityScores?: {
        strength: number;
        dexterity: number;
        constitution: number;
        intelligence: number;
        wisdom: number;
        charisma: number;
    };
}

/**
 * Combat state tracking
 */
export interface CombatState {
    participants: CombatParticipant[];
    turnOrder: string[]; // IDs in initiative order
    currentTurnIndex: number;
    round: number;
    terrain?: {  // CRIT-003: Terrain configuration
        obstacles: string[];  // "x,y" format blocking tiles
        difficultTerrain?: string[];
    };
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

export interface EventEmitter {
    publish(topic: string, payload: any): void;
}

/**
 * Combat Engine for managing RPG combat encounters
 * Handles initiative, turn order, and combat flow
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
     */
    startEncounter(participants: CombatParticipant[]): CombatState {
        // Roll initiative for each participant and store the value
        const participantsWithInitiative = participants.map(p => {
            const rolledInitiative = this.rng.d20(p.initiativeBonus);
            return {
                ...p,
                initiative: rolledInitiative,
                // Auto-detect isEnemy if not explicitly set
                isEnemy: p.isEnemy ?? this.detectIsEnemy(p.id, p.name)
            };
        });

        // Sort by initiative (highest first), use ID as tiebreaker for determinism
        participantsWithInitiative.sort((a, b) => {
            if (b.initiative !== a.initiative) {
                return b.initiative - a.initiative;
            }
            return a.id.localeCompare(b.id);
        });

        this.state = {
            participants: participantsWithInitiative,
            turnOrder: participantsWithInitiative.map(r => r.id),
            currentTurnIndex: 0,
            round: 1
        };

        this.emitter?.publish('combat', {
            type: 'encounter_started',
            state: this.state
        });

        return this.state;
    }

    /**
     * Auto-detect if a participant is an enemy based on ID/name patterns
     */
    private detectIsEnemy(id: string, name: string): boolean {
        const idLower = id.toLowerCase();
        const nameLower = name.toLowerCase();

        // Common enemy patterns
        const enemyPatterns = [
            'goblin', 'orc', 'wolf', 'bandit', 'skeleton', 'zombie',
            'dragon', 'troll', 'ogre', 'kobold', 'gnoll', 'demon',
            'devil', 'undead', 'enemy', 'monster', 'creature', 'beast',
            'spider', 'rat', 'bat', 'slime', 'ghost', 'wraith'
        ];

        // Check if ID or name contains enemy patterns
        for (const pattern of enemyPatterns) {
            if (idLower.includes(pattern) || nameLower.includes(pattern)) {
                return true;
            }
        }

        // Common player/ally patterns (not enemies)
        const allyPatterns = [
            'hero', 'player', 'pc', 'ally', 'companion', 'npc-friendly'
        ];

        for (const pattern of allyPatterns) {
            if (idLower.includes(pattern) || nameLower.includes(pattern)) {
                return false;
            }
        }

        // Default: assume it's an enemy if not clearly a player
        return !idLower.startsWith('player') && !idLower.startsWith('hero');
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
     */
    getCurrentParticipant(): CombatParticipant | null {
        if (!this.state) return null;

        const currentId = this.state.turnOrder[this.state.currentTurnIndex];
        return this.state.participants.find(p => p.id === currentId) || null;
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
        damage: number,
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

        if (attackRoll.isHit) {
            const baseDamage = attackRoll.isCrit ? damage * 2 : damage;
            // HIGH-002: Apply resistance/vulnerability/immunity
            const modResult = this.calculateDamageWithModifiers(baseDamage, damageType, target);
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

            breakdown += `\n\n💥 Damage: ${damageDealt}${typeStr}${attackRoll.isCrit ? ' (crit)' : ''}${modStr}\n`;
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
     */
    heal(participantId: string, amount: number): void {
        if (!this.state) return;

        const participant = this.state.participants.find(p => p.id === participantId);
        if (participant) {
            participant.hp = Math.min(participant.maxHp, participant.hp + amount);
            this.emitter?.publish('combat', {
                type: 'healed',
                participantId,
                amount,
                newHp: participant.hp
            });
        }
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
     * Process start-of-turn condition effects
     */
    private processStartOfTurnConditions(participant: CombatParticipant): void {
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
     * Enhanced nextTurn with condition processing
     */
    nextTurnWithConditions(): CombatParticipant | null {
        if (!this.state) return null;

        // Process end-of-turn conditions for current participant
        const currentParticipant = this.getCurrentParticipant();
        if (currentParticipant) {
            this.processEndOfTurnConditions(currentParticipant);
        }

        // Advance turn
        this.state.currentTurnIndex++;

        if (this.state.currentTurnIndex >= this.state.turnOrder.length) {
            this.state.currentTurnIndex = 0;
            this.state.round++;
        }

        // Process start-of-turn conditions for new current participant
        const newParticipant = this.getCurrentParticipant();
        if (newParticipant) {
            this.processStartOfTurnConditions(newParticipant);
        }

        this.emitter?.publish('combat', {
            type: 'turn_changed',
            round: this.state.round,
            activeParticipantId: newParticipant?.id
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
