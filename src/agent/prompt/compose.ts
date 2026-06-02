/**
 * Prompt composer — assembles modular slices into a ChatMessage[] for the provider.
 *
 * Slice order (fixed):
 *   system message (concatenated):
 *     1. persona            — DM-authored identity / voice
 *     2. directive          — DM-authored behavioral instructions
 *     3. secrets            — agent-private knowledge
 *     4. character_state    — auto-built mechanical sheet (HP/AC/slots/etc)
 *     5. recent             — long-term memories from npc_memories
 *     6. narrative_feed     — rolling DM-curated observations
 *
 *   user message:
 *     7. situation          — DM-supplied per-invoke scene narrative
 *
 * Escape hatches:
 *   - systemOverride: replaces the assembled system message entirely
 *   - messagesOverride: replaces messages[] entirely (max control)
 *
 * Token estimation: 1 token ≈ 4 chars (English). Rough but cheap and good enough
 * for budget enforcement; provider returns exact counts in the response.
 */

import { ChatMessage } from '../provider/types.js';
import { AgentRepository } from '../../storage/repos/agent.repo.js';
import { CharacterRepository } from '../../storage/repos/character.repo.js';
import { ConcentrationRepository } from '../../storage/repos/concentration.repo.js';
import { InventoryRepository } from '../../storage/repos/inventory.repo.js';
import { NpcMemoryRepository } from '../../storage/repos/npc-memory.repo.js';
import { SceneRepository } from '../../storage/repos/scene.repo.js';

import { buildPersonaSlice } from './slices/persona.js';
import { buildDirectiveSlice } from './slices/directive.js';
import { buildSecretsSlice } from './slices/secrets.js';
import { buildCharacterStateSlice } from './slices/character_state.js';
import { buildRecentSlice } from './slices/recent.js';
import { buildNarrativeFeedSlice } from './slices/narrative_feed.js';
import { buildSceneSlice } from './slices/scene.js';

export interface ComposeDeps {
    agentRepo: AgentRepository;
    characterRepo: CharacterRepository;
    concentrationRepo: ConcentrationRepository;
    inventoryRepo: InventoryRepository;
    npcMemoryRepo: NpcMemoryRepository;
    sceneRepo?: SceneRepository;
}

export interface ComposeInput {
    agentId: string;
    characterId: string;
    situation?: string;
    /** Replace the assembled system message entirely. */
    systemOverride?: string;
    /** Replace messages[] entirely. Bypasses everything else. */
    messagesOverride?: ChatMessage[];
}

export interface ComposeResult {
    messages: ChatMessage[];
    estimatedPromptTokens: number;
    slicesIncluded: string[];
    slicesSkipped: string[];
}

const TOKEN_RATIO = 4; // chars per token (rough)

function totalChars(messages: ChatMessage[]): number {
    return messages.reduce((sum, m) => sum + m.role.length + m.content.length + 8, 0);
}

export function composePrompt(input: ComposeInput, deps: ComposeDeps): ComposeResult {
    // ---- Override path 1: full messages override ----
    if (input.messagesOverride && input.messagesOverride.length > 0) {
        return {
            messages: input.messagesOverride,
            estimatedPromptTokens: Math.ceil(totalChars(input.messagesOverride) / TOKEN_RATIO),
            slicesIncluded: ['messages_override'],
            slicesSkipped: []
        };
    }

    const slicesIncluded: string[] = [];
    const slicesSkipped: string[] = [];
    const systemParts: string[] = [];

    // ---- Override path 2: system override (replace assembly) ----
    if (input.systemOverride !== undefined) {
        if (input.systemOverride.trim().length > 0) {
            systemParts.push(input.systemOverride);
            slicesIncluded.push('system_override');
        }
    } else {
        // ---- Normal slice assembly ----
        const persona = buildPersonaSlice(input.agentId, deps.agentRepo);
        if (persona) { systemParts.push(persona); slicesIncluded.push('persona'); } else { slicesSkipped.push('persona'); }

        const directive = buildDirectiveSlice(input.agentId, deps.agentRepo);
        if (directive) { systemParts.push(directive); slicesIncluded.push('directive'); } else { slicesSkipped.push('directive'); }

        const secrets = buildSecretsSlice(input.agentId, deps.agentRepo);
        if (secrets) { systemParts.push(secrets); slicesIncluded.push('secrets'); } else { slicesSkipped.push('secrets'); }

        const characterState = buildCharacterStateSlice(input.characterId, {
            characterRepo: deps.characterRepo,
            concentrationRepo: deps.concentrationRepo,
            inventoryRepo: deps.inventoryRepo
        });
        if (characterState) { systemParts.push(characterState); slicesIncluded.push('character_state'); } else { slicesSkipped.push('character_state'); }

        const recent = buildRecentSlice(input.characterId, deps.npcMemoryRepo);
        if (recent) { systemParts.push(recent); slicesIncluded.push('recent'); } else { slicesSkipped.push('recent'); }

        const narrative = buildNarrativeFeedSlice(input.agentId, deps.agentRepo);
        if (narrative) { systemParts.push(narrative); slicesIncluded.push('narrative_feed'); } else { slicesSkipped.push('narrative_feed'); }

        // Scene slice: the DM-committed shared narrative frame for THIS character.
        // Renders the current scene (and optional prior context) so every
        // party-mate reads the same world state. Goes LAST in the system
        // assembly so it sits closest to the user message — the freshest
        // foreground for the agent's intent declaration.
        if (deps.sceneRepo) {
            const scene = buildSceneSlice(input.characterId, deps.sceneRepo, deps.characterRepo);
            if (scene) { systemParts.push(scene); slicesIncluded.push('scene'); } else { slicesSkipped.push('scene'); }
        } else {
            slicesSkipped.push('scene');
        }
    }

    const messages: ChatMessage[] = [];

    if (systemParts.length > 0) {
        // Append a small standing instruction to encourage the plain-text intent shape.
        const closing = '\n\n--- HOW TO RESPOND ---\nSpeak in character. Briefly describe what you want to do, the way a player at the table would declare their action ("I attack the orc with my longbow.", "I cast cure wounds on Theron at 2nd level.", "I want to make a Stealth check to slip past the guard."). The DM will roll dice and narrate the outcome.';
        messages.push({
            role: 'system',
            content: systemParts.join('\n\n') + closing
        });
    }

    const situation = input.situation?.trim();
    if (situation && situation.length > 0) {
        messages.push({ role: 'user', content: situation });
    } else {
        // Even with no situation text, give the LLM a clear prompt to respond to.
        messages.push({ role: 'user', content: "What do you do? (Speak in character; declare your intent so the DM can resolve it.)" });
    }

    return {
        messages,
        estimatedPromptTokens: Math.ceil(totalChars(messages) / TOKEN_RATIO),
        slicesIncluded,
        slicesSkipped
    };
}
