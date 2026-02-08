/**
 * Consolidated Combat Action Tool
 * Wraps execute_combat_action with action-router pattern for consistent API.
 * Actions: attack, heal, move, disengage, cast_spell, dash, dodge, help, ready
 */

import { z } from 'zod';
import { createActionRouter, ActionDefinition, McpResponse } from '../../utils/action-router.js';
import { SessionContext } from '../types.js';
import { RichFormatter } from '../utils/formatter.js';
import { handleExecuteCombatAction } from '../handlers/combat-handlers.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const ACTIONS = ['attack', 'heal', 'move', 'disengage', 'cast_spell', 'dash', 'dodge', 'help', 'ready'] as const;
type CombatAction = typeof ACTIONS[number];

// ═══════════════════════════════════════════════════════════════════════════
// ACTION SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

const AttackSchema = z.object({
    action: z.literal('attack'),
    encounterId: z.string(),
    actorId: z.string(),
    targetId: z.string(),
    attackBonus: z.number().int().optional(),
    dc: z.number().int().optional(),
    damage: z.union([z.number(), z.string()]).optional(),
    damageType: z.string().optional()
});

const HealSchema = z.object({
    action: z.literal('heal'),
    encounterId: z.string(),
    actorId: z.string(),
    targetId: z.string(),
    amount: z.number().int().positive()
});

const MoveSchema = z.object({
    action: z.literal('move'),
    encounterId: z.string(),
    actorId: z.string(),
    targetPosition: z.object({ x: z.number(), y: z.number() })
});

const DisengageSchema = z.object({
    action: z.literal('disengage'),
    encounterId: z.string(),
    actorId: z.string()
});

const CastSpellSchema = z.object({
    action: z.literal('cast_spell'),
    encounterId: z.string(),
    actorId: z.string(),
    spellName: z.string(),
    targetId: z.string().optional(),
    targetIds: z.array(z.string()).optional(),
    slotLevel: z.number().int().min(1).max(9).optional()
});

const DashSchema = z.object({
    action: z.literal('dash'),
    encounterId: z.string(),
    actorId: z.string(),
    targetPosition: z.object({ x: z.number(), y: z.number() }).optional()
});

const DodgeSchema = z.object({
    action: z.literal('dodge'),
    encounterId: z.string(),
    actorId: z.string()
});

const HelpSchema = z.object({
    action: z.literal('help'),
    encounterId: z.string(),
    actorId: z.string(),
    targetId: z.string().describe('Ally to help')
});

const ReadySchema = z.object({
    action: z.literal('ready'),
    encounterId: z.string(),
    actorId: z.string(),
    readiedAction: z.string().describe('Description of the readied action'),
    trigger: z.string().describe('Trigger condition for the readied action')
});

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXT HOLDER
// ═══════════════════════════════════════════════════════════════════════════

let currentContext: SessionContext | null = null;

// ═══════════════════════════════════════════════════════════════════════════
// ACTION DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

const definitions: Record<CombatAction, ActionDefinition> = {
    attack: {
        schema: AttackSchema,
        handler: async (params: z.infer<typeof AttackSchema>) => {
            if (!currentContext) throw new Error('No session context');
            const result = await handleExecuteCombatAction({
                encounterId: params.encounterId,
                action: 'attack',
                actorId: params.actorId,
                targetId: params.targetId,
                attackBonus: params.attackBonus,
                dc: params.dc,
                damage: params.damage,
                damageType: params.damageType
            }, currentContext);
            return extractResultData(result, 'attack');
        },
        aliases: ['hit', 'strike', 'swing', 'shoot']
    },

    heal: {
        schema: HealSchema,
        handler: async (params: z.infer<typeof HealSchema>) => {
            if (!currentContext) throw new Error('No session context');
            const result = await handleExecuteCombatAction({
                encounterId: params.encounterId,
                action: 'heal',
                actorId: params.actorId,
                targetId: params.targetId,
                amount: params.amount
            }, currentContext);
            return extractResultData(result, 'heal');
        },
        aliases: ['cure', 'restore', 'mend']
    },

    move: {
        schema: MoveSchema,
        handler: async (params: z.infer<typeof MoveSchema>) => {
            if (!currentContext) throw new Error('No session context');
            const result = await handleExecuteCombatAction({
                encounterId: params.encounterId,
                action: 'move',
                actorId: params.actorId,
                targetPosition: params.targetPosition
            }, currentContext);
            return extractResultData(result, 'move');
        },
        aliases: ['walk', 'run', 'go', 'position']
    },

    disengage: {
        schema: DisengageSchema,
        handler: async (params: z.infer<typeof DisengageSchema>) => {
            if (!currentContext) throw new Error('No session context');
            const result = await handleExecuteCombatAction({
                encounterId: params.encounterId,
                action: 'disengage',
                actorId: params.actorId
            }, currentContext);
            return extractResultData(result, 'disengage');
        },
        aliases: ['retreat', 'withdraw', 'back_off']
    },

    cast_spell: {
        schema: CastSpellSchema,
        handler: async (params: z.infer<typeof CastSpellSchema>) => {
            if (!currentContext) throw new Error('No session context');
            const result = await handleExecuteCombatAction({
                encounterId: params.encounterId,
                action: 'cast_spell',
                actorId: params.actorId,
                spellName: params.spellName,
                targetId: params.targetId,
                targetIds: params.targetIds,
                slotLevel: params.slotLevel
            }, currentContext);
            return extractResultData(result, 'cast_spell');
        },
        aliases: ['cast', 'spell', 'magic', 'invoke']
    },

    dash: {
        schema: DashSchema,
        handler: async (params: z.infer<typeof DashSchema>) => {
            if (!currentContext) throw new Error('No session context');
            // Dash doubles movement speed for the turn
            return {
                success: true,
                actionType: 'dash',
                actorId: params.actorId,
                effect: 'Movement speed doubled for this turn',
                message: `${params.actorId} takes the Dash action, doubling movement speed.`
            };
        },
        aliases: ['sprint', 'run', 'hustle']
    },

    dodge: {
        schema: DodgeSchema,
        handler: async (params: z.infer<typeof DodgeSchema>) => {
            if (!currentContext) throw new Error('No session context');
            // Dodge grants advantage on DEX saves, attackers have disadvantage
            return {
                success: true,
                actionType: 'dodge',
                actorId: params.actorId,
                effect: 'Attacks against you have disadvantage. Advantage on DEX saves until your next turn.',
                message: `${params.actorId} takes the Dodge action.`
            };
        },
        aliases: ['evade', 'defensive']
    },

    help: {
        schema: HelpSchema,
        handler: async (params: z.infer<typeof HelpSchema>) => {
            if (!currentContext) throw new Error('No session context');
            // Help grants advantage to an ally's next attack/check
            return {
                success: true,
                actionType: 'help',
                actorId: params.actorId,
                targetId: params.targetId,
                effect: `${params.targetId} gains advantage on their next attack roll or ability check.`,
                message: `${params.actorId} helps ${params.targetId}.`
            };
        },
        aliases: ['assist', 'aid']
    },

    ready: {
        schema: ReadySchema,
        handler: async (params: z.infer<typeof ReadySchema>) => {
            if (!currentContext) throw new Error('No session context');
            // Ready holds an action for a trigger
            return {
                success: true,
                actionType: 'ready',
                actorId: params.actorId,
                readiedAction: params.readiedAction,
                trigger: params.trigger,
                effect: `Readied action: "${params.readiedAction}" when "${params.trigger}"`,
                message: `${params.actorId} readies an action.`
            };
        },
        aliases: ['prepare', 'hold', 'wait']
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function extractResultData(result: McpResponse, actionType: string): Record<string, unknown> {
    const text = result.content[0].text;

    // Try to extract STATE_JSON
    const stateMatch = text.match(/<!-- STATE_JSON\n([\s\S]*?)\nSTATE_JSON -->/);
    if (stateMatch) {
        try {
            const stateData = JSON.parse(stateMatch[1]);
            return {
                success: true,
                actionType,
                ...stateData,
                rawText: text.replace(/<!-- STATE_JSON[\s\S]*?STATE_JSON -->/, '').trim()
            };
        } catch {
            // Fall through
        }
    }

    return {
        success: true,
        actionType,
        message: text
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// ROUTER & TOOL DEFINITION
// ═══════════════════════════════════════════════════════════════════════════

const router = createActionRouter({
    actions: ACTIONS,
    definitions,
    threshold: 0.6
});

export const CombatActionTool = {
    name: 'combat_action',
    description: `Execute combat actions during an encounter. Actions: ${ACTIONS.join(', ')}.

🎯 SELF-CONTAINED - This tool handles EVERYTHING for combat:
- Rolls dice internally (d20 for attacks, damage dice, saves)
- Auto-calculates attack bonus from character stats if not provided
- Auto-calculates damage from character stats if not provided
- Applies damage/healing and syncs HP to character database
- Tracks action economy (action/bonus/reaction)

DO NOT use math_manage for combat rolls - use this tool instead!

⚔️ ATTACK (minimal call):
{ action: "attack", encounterId, actorId, targetId }
Everything else auto-calculated. Returns: roll result, damage dealt, HP change.

🔮 CAST_SPELL (minimal call):
{ action: "cast_spell", encounterId, actorId, spellName, targetId }
Validates spell, rolls damage, applies effects, handles saves - all automatic.

💚 SUPPORT:
- heal - Restore HP to a target
- help - Grant advantage to an ally

🏃 MOVEMENT:
- move - Move to a position (use available movement)
- dash - Double movement speed for the turn
- disengage - Move without provoking opportunity attacks

🛡️ DEFENSIVE:
- dodge - Disadvantage on attacks against you, advantage on DEX saves
- ready - Prepare an action with a trigger

Aliases: hit/strike→attack, cast/spell→cast_spell, sprint→dash, evade→dodge.`,
    inputSchema: z.object({
        action: z.string().describe(`Action: ${ACTIONS.join(', ')}`),
        encounterId: z.string().describe('Encounter ID'),
        actorId: z.string().describe('ID of the acting character'),
        targetId: z.string().optional().describe('Target ID (attack, heal, help)'),
        targetIds: z.array(z.string()).optional().describe('Multiple targets (AoE spells)'),
        targetPosition: z.object({ x: z.number(), y: z.number() }).optional().describe('Target position (move, dash)'),
        attackBonus: z.number().optional().describe('Attack bonus modifier'),
        dc: z.number().optional().describe('DC for the attack'),
        damage: z.union([z.number(), z.string()]).optional().describe('Damage amount or dice'),
        damageType: z.string().optional().describe('Damage type (fire, slashing, etc.)'),
        amount: z.number().optional().describe('Healing amount'),
        spellName: z.string().optional().describe('Spell name'),
        slotLevel: z.number().optional().describe('Spell slot level'),
        readiedAction: z.string().optional().describe('Description of readied action'),
        trigger: z.string().optional().describe('Trigger for readied action')
    })
};

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════════════════════════

export async function handleCombatAction(args: unknown, ctx: SessionContext): Promise<McpResponse> {
    currentContext = ctx;
    const response = await router(args as Record<string, unknown>);

    // Wrap response with ASCII formatting
    try {
        const parsed = JSON.parse(response.content[0].text);
        let output = '';

        if (parsed.error) {
            output = RichFormatter.header('Combat Error', '❌');
            output += RichFormatter.alert(parsed.message || 'Unknown error', 'error');
            if (parsed.suggestions) {
                output += RichFormatter.section('Did you mean?');
                parsed.suggestions.forEach((s: { action: string; similarity: number }) => {
                    output += `  • ${s.action} (${s.similarity}% match)\n`;
                });
            }
            if (parsed.validActions) {
                output += RichFormatter.section('Valid Actions');
                output += RichFormatter.list(parsed.validActions);
            }
        } else {
            // Format based on action type
            switch (parsed.actionType) {
                case 'attack':
                    output = RichFormatter.header('Attack', '⚔️');
                    if (parsed.hit !== undefined) {
                        output += RichFormatter.keyValue({
                            'Result': parsed.hit ? '🎯 HIT' : '💨 MISS',
                            'Roll': parsed.roll || 'N/A',
                            'vs AC': parsed.targetAC || 'N/A',
                            'Damage': parsed.hit ? (parsed.damage || 0) : '-'
                        });
                        if (parsed.damageType) {
                            output += `Damage type: ${parsed.damageType}\n`;
                        }
                    }
                    break;
                case 'heal':
                    output = RichFormatter.header('Healing', '💚');
                    output += RichFormatter.keyValue({
                        'Target': parsed.targetId || 'Unknown',
                        'HP Restored': parsed.amount || 0
                    });
                    break;
                case 'move':
                    output = RichFormatter.header('Movement', '🏃');
                    output += RichFormatter.keyValue({
                        'Actor': parsed.actorId,
                        'Position': parsed.targetPosition ? `(${parsed.targetPosition.x}, ${parsed.targetPosition.y})` : 'N/A'
                    });
                    break;
                case 'cast_spell':
                    output = RichFormatter.header('Spell Cast', '✨');
                    output += RichFormatter.keyValue({
                        'Spell': parsed.spellName || 'Unknown',
                        'Caster': parsed.actorId,
                        'Target': parsed.targetId || parsed.targetIds?.join(', ') || 'N/A'
                    });
                    break;
                case 'disengage':
                    output = RichFormatter.header('Disengage', '🔙');
                    output += `${parsed.actorId} disengages, avoiding opportunity attacks.\n`;
                    break;
                case 'dash':
                    output = RichFormatter.header('Dash', '💨');
                    output += `${parsed.actorId} dashes, doubling movement speed.\n`;
                    break;
                case 'dodge':
                    output = RichFormatter.header('Dodge', '🛡️');
                    output += `${parsed.actorId} takes the Dodge action.\n`;
                    break;
                case 'help':
                    output = RichFormatter.header('Help', '🤝');
                    output += `${parsed.actorId} helps ${parsed.targetId}.\n`;
                    break;
                case 'ready':
                    output = RichFormatter.header('Ready Action', '⏳');
                    output += RichFormatter.keyValue({
                        'Action': parsed.readiedAction,
                        'Trigger': parsed.trigger
                    });
                    break;
                default:
                    output = RichFormatter.header('Combat Action', '⚔️');
            }

            // Add effect/message
            if (parsed.effect) {
                output += RichFormatter.alert(parsed.effect, 'info');
            }
            if (parsed.rawText) {
                output += '\n' + parsed.rawText + '\n';
            } else if (parsed.message && !parsed.effect) {
                output += parsed.message + '\n';
            }
        }

        // Embed JSON for programmatic access
        output += RichFormatter.embedJson(parsed, 'COMBAT_ACTION');

        currentContext = null;
        return { content: [{ type: 'text', text: output }] };
    } catch {
        // If JSON parsing fails, return original response
        currentContext = null;
        return response;
    }
}
