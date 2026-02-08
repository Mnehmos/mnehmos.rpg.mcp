/**
 * Legacy Handler Wrappers
 *
 * Provides backward-compatible function signatures for old tool handler tests.
 * Delegates to the consolidated action-based tools under the hood.
 * Remaps embedded JSON tags to match old format (e.g., CHARACTER_MANAGE -> CHARACTER).
 */

import { handleCharacterManage } from '../../src/server/consolidated/character-manage.js';
import { handleRestManage } from '../../src/server/consolidated/rest-manage.js';
import { closeDb } from '../../src/storage/index.js';
import { SessionContext } from '../../src/server/types.js';

type McpResponse = { content: Array<{ type: string; text: string }> };

const defaultCtx: SessionContext = { sessionId: 'test-session' };

/** Remap embedded JSON tags from consolidated format to legacy format */
function remapTag(response: McpResponse, from: string, to: string): McpResponse {
    if (!response?.content?.[0]?.text) return response;
    return {
        content: [{
            type: 'text',
            text: response.content[0].text.replace(
                new RegExp(from, 'g'),
                to
            )
        }]
    };
}

export async function handleCreateCharacter(args: Record<string, unknown>, ctx: SessionContext = defaultCtx) {
    const result = await handleCharacterManage({ action: 'create', ...args }, ctx);
    return remapTag(result, 'CHARACTER_MANAGE', 'CHARACTER');
}

export async function handleGetCharacter(args: Record<string, unknown>, ctx: SessionContext = defaultCtx) {
    // Map legacy 'id' param to consolidated 'characterId'
    const mapped = { ...args };
    if (mapped.id && !mapped.characterId) { mapped.characterId = mapped.id; delete mapped.id; }
    const result = await handleCharacterManage({ action: 'get', ...mapped }, ctx);
    return remapTag(result, 'CHARACTER_MANAGE', 'CHARACTER');
}

export async function handleUpdateCharacter(args: Record<string, unknown>, ctx: SessionContext = defaultCtx) {
    const mapped = { ...args };
    if (mapped.id && !mapped.characterId) { mapped.characterId = mapped.id; delete mapped.id; }
    const result = await handleCharacterManage({ action: 'update', ...mapped }, ctx);
    return remapTag(result, 'CHARACTER_MANAGE', 'CHARACTER');
}

export async function handleTakeLongRest(args: Record<string, unknown>, ctx: SessionContext = defaultCtx) {
    return handleRestManage({ action: 'long', ...args }, ctx);
}

export async function handleTakeShortRest(args: Record<string, unknown>, ctx: SessionContext = defaultCtx) {
    return handleRestManage({ action: 'short', ...args }, ctx);
}

export const closeTestDb = closeDb;
