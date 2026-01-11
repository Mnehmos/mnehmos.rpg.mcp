/**
 * Consolidated session_manage tool
 * Replaces: initialize_session, get_narrative_context
 * 2 tools → 1 tool with 2 actions
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';
import { matchAction, isGuidingError } from '../../utils/fuzzy-enum.js';
import { RichFormatter } from '../utils/formatter.js';
import { getDb } from '../../storage/index.js';
import { PartyRepository } from '../../storage/repos/party.repo.js';
import { QuestRepository } from '../../storage/repos/quest.repo.js';
import { WorldRepository } from '../../storage/repos/world.repo.js';
import { SessionContext } from '../types.js';

export interface McpResponse {
    content: Array<{ type: 'text'; text: string }>;
}

const ACTIONS = ['initialize', 'get_context'] as const;

type SessionAction = typeof ACTIONS[number];

// Alias map for fuzzy action matching
const ALIASES: Record<string, SessionAction> = {
    'init': 'initialize',
    'start': 'initialize',
    'setup': 'initialize',
    'initialize_session': 'initialize',
    'start_session': 'initialize',
    'context': 'get_context',
    'narrative': 'get_context',
    'narrative_context': 'get_context',
    'get_narrative': 'get_context',
    'summary': 'get_context'
};

function ensureDb() {
    const dbPath = process.env.NODE_ENV === 'test'
        ? ':memory:'
        : process.env.RPG_DATA_DIR
            ? `${process.env.RPG_DATA_DIR}/rpg.db`
            : 'rpg.db';
    const db = getDb(dbPath);
    return {
        db,
        partyRepo: new PartyRepository(db),
        questRepo: new QuestRepository(db),
        worldRepo: new WorldRepository(db)
    };
}

// Input schema
const SessionManageInputSchema = z.object({
    action: z.string().describe('Action: initialize, get_context'),

    // initialize fields
    worldId: z.string().optional().describe('World ID to load'),
    partyId: z.string().optional().describe('Party ID to load'),
    createNew: z.boolean().optional().default(false).describe('Create new session resources'),
    worldName: z.string().optional().describe('Name for new world'),
    partyName: z.string().optional().describe('Name for new party'),

    // get_context fields
    includeParty: z.boolean().optional().default(true).describe('Include party details'),
    includeQuests: z.boolean().optional().default(true).describe('Include active quests'),
    includeWorld: z.boolean().optional().default(true).describe('Include world state'),
    includeNarrative: z.boolean().optional().default(true).describe('Include recent narrative'),
    includeCombat: z.boolean().optional().default(true).describe('Include active combat'),
    narrativeLimit: z.number().int().min(1).max(50).optional().default(10).describe('Max narrative entries')
});

type SessionManageInput = z.infer<typeof SessionManageInputSchema>;

// Action handlers
async function handleInitialize(input: SessionManageInput, ctx: SessionContext): Promise<McpResponse> {
    const { worldRepo, partyRepo } = ensureDb();
    const now = new Date().toISOString();

    let worldId = input.worldId;
    let partyId = input.partyId;
    const created: { world?: boolean; party?: boolean } = {};

    // Create or load world
    if (!worldId && input.createNew) {
        worldId = randomUUID();
        worldRepo.create({
            id: worldId,
            name: input.worldName || 'New World',
            seed: randomUUID().slice(0, 8),
            width: 100,
            height: 100,
            createdAt: now,
            updatedAt: now
        });
        created.world = true;
    } else if (!worldId) {
        // Try to find existing world
        const worlds = worldRepo.findAll();
        if (worlds.length > 0) {
            worldId = worlds[0].id;
        }
    }

    // Create or load party
    if (!partyId && input.createNew) {
        partyId = randomUUID();
        partyRepo.create({
            id: partyId,
            name: input.partyName || 'Adventuring Party',
            status: 'active',
            formation: 'standard',
            createdAt: now,
            updatedAt: now
        });
        created.party = true;
    } else if (!partyId) {
        // Try to find existing party
        const parties = partyRepo.findAll();
        if (parties.length > 0) {
            partyId = parties[0].id;
        }
    }

    // Get session state
    const world = worldId ? worldRepo.findById(worldId) : null;
    const party = partyId ? partyRepo.getPartyWithMembers(partyId) : null;

    let output = RichFormatter.header('Session Initialized', '🎮');
    output += RichFormatter.keyValue({
        'Session ID': ctx.sessionId,
        'World': world ? `${world.name} (${worldId})` : 'None',
        'Party': party ? `${party.name} (${partyId})` : 'None'
    });

    if (created.world || created.party) {
        output += RichFormatter.section('Created');
        if (created.world) output += `• New world: ${input.worldName || 'New World'}\n`;
        if (created.party) output += `• New party: ${input.partyName || 'Adventuring Party'}\n`;
    }

    if (party && party.members && party.members.length > 0) {
        output += RichFormatter.section('Party Members');
        const rows = party.members.map(m => [
            m.character.name,
            (m.character as any).characterClass || 'Adventurer',
            `${m.character.hp}/${m.character.maxHp}`,
            m.role === 'leader' ? '★' : ''
        ]);
        output += RichFormatter.table(['Name', 'Class', 'HP', 'Leader'], rows);
    }

    const result = {
        success: true,
        actionType: 'initialize',
        sessionId: ctx.sessionId,
        worldId,
        worldName: world?.name,
        partyId,
        partyName: party?.name,
        partyMembers: party?.members?.map(m => ({
            id: m.character.id,
            name: m.character.name,
            class: (m.character as any).characterClass,
            hp: m.character.hp,
            maxHp: m.character.maxHp,
            isLeader: m.role === 'leader'
        })) || [],
        created
    };

    output += RichFormatter.embedJson(result, 'SESSION_MANAGE');

    return { content: [{ type: 'text', text: output }] };
}

async function handleGetContext(input: SessionManageInput, _ctx: SessionContext): Promise<McpResponse> {
    const { partyRepo, questRepo, worldRepo, db } = ensureDb();

    const context: Record<string, any> = {};

    // Get party context
    if (input.includeParty && input.partyId) {
        const party = partyRepo.getPartyWithMembers(input.partyId);
        if (party) {
            context.party = {
                id: party.id,
                name: party.name,
                members: party.members?.map(m => ({
                    id: m.character.id,
                    name: m.character.name,
                    level: m.character.level,
                    hp: m.character.hp,
                    maxHp: m.character.maxHp,
                    ac: m.character.ac,
                    conditions: [],
                    isLeader: m.role === 'leader'
                })) || []
            };
        }
    }

    // Get active quests
    if (input.includeQuests) {
        const allQuests = questRepo.findAll();
        const activeQuests = allQuests.filter((q: any) => q.status === 'active' || q.status === 'in_progress');
        context.quests = activeQuests.map((q: any) => ({
            id: q.id,
            title: q.name,
            status: q.status,
            currentObjective: q.objectives?.find((o: any) => !o.completed)?.description
        }));
    }

    // Get world context
    if (input.includeWorld && input.worldId) {
        const world = worldRepo.findById(input.worldId);
        if (world) {
            context.world = {
                id: world.id,
                name: world.name,
                currentTime: (world.environment as any)?.timeOfDay || 'day'
            };

            // Get current location if party has position
            if (input.partyId) {
                const party = partyRepo.findById(input.partyId);
                if (party && (party as any).currentLocation) {
                    context.world.currentLocation = (party as any).currentLocation;
                }
            }
        }
    }

    // Get recent narrative (using direct SQL since no repo exists)
    if (input.includeNarrative) {
        try {
            const narratives = db.prepare(`
                SELECT id, type, content, created_at
                FROM narrative_notes
                ORDER BY created_at DESC
                LIMIT ?
            `).all(input.narrativeLimit || 10) as any[];
            context.narrative = narratives.map((n: any) => ({
                timestamp: n.created_at,
                type: n.type,
                content: n.content
            }));
        } catch {
            // narrative_notes table might not exist
            context.narrative = [];
        }
    }

    // Get active combat
    if (input.includeCombat) {
        // Check for active encounters
        try {
            const activeEncounters = db.prepare(`
                SELECT id, round, status, active_token_id
                FROM encounters
                WHERE status = 'active'
                ORDER BY updated_at DESC
                LIMIT 1
            `).all() as any[];

            if (activeEncounters.length > 0) {
                const enc = activeEncounters[0];
                context.activeCombat = {
                    encounterId: enc.id,
                    round: enc.round,
                    currentTurn: enc.active_token_id
                };
            }
        } catch {
            // No encounters table or no active combat
        }
    }

    // Build output
    let output = RichFormatter.header('Narrative Context', '📜');

    if (context.party) {
        output += RichFormatter.section('Party');
        output += `**${context.party.name}** (${context.party.members.length} members)\n`;
        for (const m of context.party.members) {
            const leaderMark = m.isLeader ? ' ★' : '';
            output += `• ${m.name}${leaderMark} - Level ${m.level} ${m.race} ${m.class} (HP: ${m.hp}/${m.maxHp})\n`;
        }
    }

    if (context.quests && context.quests.length > 0) {
        output += RichFormatter.section('Active Quests');
        for (const q of context.quests) {
            output += `• **${q.title}** [${q.status}]\n`;
            if (q.currentObjective) {
                output += `  → ${q.currentObjective}\n`;
            }
        }
    }

    if (context.world) {
        output += RichFormatter.section('World');
        output += `**${context.world.name}**`;
        if (context.world.currentLocation) {
            output += ` - Currently at: ${context.world.currentLocation}`;
        }
        output += '\n';
    }

    if (context.activeCombat) {
        output += RichFormatter.section('Active Combat');
        output += `Encounter: ${context.activeCombat.encounterId}\n`;
        output += `Round: ${context.activeCombat.round}\n`;
    }

    if (context.narrative && context.narrative.length > 0) {
        output += RichFormatter.section('Recent Events');
        for (const n of context.narrative.slice(0, 5)) {
            output += `• [${n.type}] ${n.content.substring(0, 100)}${n.content.length > 100 ? '...' : ''}\n`;
        }
    }

    const result = {
        success: true,
        actionType: 'get_context',
        ...context
    };

    output += RichFormatter.embedJson(result, 'SESSION_MANAGE');

    return { content: [{ type: 'text', text: output }] };
}

// Main handler
export async function handleSessionManage(args: unknown, ctx: SessionContext): Promise<McpResponse> {
    const input = SessionManageInputSchema.parse(args);
    const matchResult = matchAction(input.action, ACTIONS, ALIASES, 0.6);

    if (isGuidingError(matchResult)) {
        let output = RichFormatter.error(`Unknown action: "${input.action}"`);
        output += `\nAvailable actions: ${ACTIONS.join(', ')}`;
        if (matchResult.suggestions.length > 0) {
            output += `\nDid you mean: ${matchResult.suggestions.map(s => `"${s.value}" (${Math.round(s.similarity * 100)}%)`).join(', ')}?`;
        }
        output += RichFormatter.embedJson(matchResult, 'SESSION_MANAGE');
        return { content: [{ type: 'text', text: output }] };
    }

    switch (matchResult.matched) {
        case 'initialize':
            return handleInitialize(input, ctx);
        case 'get_context':
            return handleGetContext(input, ctx);
        default:
            return {
                content: [{
                    type: 'text',
                    text: RichFormatter.error(`Unhandled action: ${matchResult.matched}`) +
                        RichFormatter.embedJson({ error: true, message: `Unhandled: ${matchResult.matched}` }, 'SESSION_MANAGE')
                }]
            };
    }
}

// Tool definition for registration
export const SessionManageTool = {
    name: 'session_manage',
    description: `Consolidated session management (2→1).

Actions:
• initialize - Start or resume a game session with world and party
• get_context - Get comprehensive narrative context for AI decision-making

Examples:
- New session: { action: "initialize", createNew: true, worldName: "Faerun", partyName: "Heroes" }
- Resume: { action: "initialize", worldId: "...", partyId: "..." }
- Get context: { action: "get_context", partyId: "...", worldId: "...", narrativeLimit: 10 }`,
    inputSchema: SessionManageInputSchema
};
