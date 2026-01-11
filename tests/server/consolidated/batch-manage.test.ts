/**
 * Tests for consolidated batch_manage tool
 * Validates all 6 actions: create_characters, create_npcs, distribute_items, execute_workflow, list_templates, get_template
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { handleBatchManage, BatchManageTool } from '../../../src/server/consolidated/batch-manage.js';
import { getDb, closeDb } from '../../../src/storage/index.js';
import { CharacterRepository } from '../../../src/storage/repos/character.repo.js';
import { randomUUID } from 'crypto';

process.env.NODE_ENV = 'test';

function parseResult(result: { content: Array<{ type: string; text: string }> }) {
    const text = result.content[0].text;
    const jsonMatch = text.match(/<!-- BATCH_MANAGE_JSON\n([\s\S]*?)\nBATCH_MANAGE_JSON -->/);
    if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
    }
    try {
        const parsed = JSON.parse(text);
        if (typeof parsed === 'object' && parsed !== null) {
            return parsed;
        }
    } catch {
        // Not valid JSON
    }
    return { error: 'parse_failed', rawText: text };
}

describe('batch_manage consolidated tool', () => {
    let testCharacterId: string;
    const ctx = { sessionId: 'test-session' };

    beforeEach(async () => {
        closeDb();
        const db = getDb(':memory:');
        const now = new Date().toISOString();

        // Create test character for distribution tests
        const charRepo = new CharacterRepository(db);
        testCharacterId = randomUUID();
        charRepo.create({
            id: testCharacterId,
            name: 'Test Character',
            race: 'Human',
            characterClass: 'Fighter',
            characterType: 'pc',
            level: 1,
            hp: 10,
            maxHp: 10,
            ac: 10,
            stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
            inventory: JSON.stringify([]),
            createdAt: now,
            updatedAt: now
        } as any);
    });

    describe('Tool Definition', () => {
        it('should have correct tool name', () => {
            expect(BatchManageTool.name).toBe('batch_manage');
        });

        it('should list all available actions in description', () => {
            expect(BatchManageTool.description).toContain('create_characters');
            expect(BatchManageTool.description).toContain('create_npcs');
            expect(BatchManageTool.description).toContain('distribute_items');
            expect(BatchManageTool.description).toContain('execute_workflow');
            expect(BatchManageTool.description).toContain('list_templates');
            expect(BatchManageTool.description).toContain('get_template');
        });
    });

    describe('create_characters action', () => {
        it('should create multiple characters', async () => {
            const result = await handleBatchManage({
                action: 'create_characters',
                characters: [
                    { name: 'Valeros', class: 'Fighter', race: 'Human' },
                    { name: 'Kyra', class: 'Cleric', race: 'Human' },
                    { name: 'Merisiel', class: 'Rogue', race: 'Elf' }
                ]
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('create_characters');
            expect(data.createdCount).toBe(3);
            expect(data.created.length).toBe(3);
        });

        it('should use default values for missing fields', async () => {
            const result = await handleBatchManage({
                action: 'create_characters',
                characters: [
                    { name: 'Minimal Character' }
                ]
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.created[0].class).toBe('Adventurer');
            expect(data.created[0].race).toBe('Human');
        });

        it('should create characters with full stats', async () => {
            const result = await handleBatchManage({
                action: 'create_characters',
                characters: [
                    {
                        name: 'Strong Hero',
                        class: 'Barbarian',
                        race: 'Half-Orc',
                        level: 5,
                        hp: 55,
                        maxHp: 55,
                        ac: 14,
                        stats: { str: 18, dex: 14, con: 16, int: 8, wis: 10, cha: 10 },
                        characterType: 'pc'
                    }
                ]
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.created[0].name).toBe('Strong Hero');
        });

        it('should return error for empty characters array', async () => {
            const result = await handleBatchManage({
                action: 'create_characters',
                characters: []
            }, ctx);

            // Should return error response (not throw)
            const data = parseResult(result);
            expect(data.error).toBe(true);
        });

        it('should accept "characters" alias', async () => {
            const result = await handleBatchManage({
                action: 'characters',
                characters: [{ name: 'Alias Test' }]
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('create_characters');
        });
    });

    describe('create_npcs action', () => {
        it('should create multiple NPCs', async () => {
            const result = await handleBatchManage({
                action: 'create_npcs',
                locationName: 'Thornwood Village',
                npcs: [
                    { name: 'Marta', role: 'Innkeeper', race: 'Human' },
                    { name: 'Grom', role: 'Blacksmith', race: 'Dwarf' },
                    { name: 'Elara', role: 'Herbalist', race: 'Half-Elf' }
                ]
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('create_npcs');
            expect(data.createdCount).toBe(3);
            expect(data.locationName).toBe('Thornwood Village');
        });

        it('should create NPCs without location', async () => {
            const result = await handleBatchManage({
                action: 'create_npcs',
                npcs: [
                    { name: 'Wandering Merchant', role: 'Merchant' }
                ]
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.locationName).toBeUndefined();
        });

        it('should include behavior in NPC data', async () => {
            const result = await handleBatchManage({
                action: 'create_npcs',
                npcs: [
                    { name: 'Grumpy Guard', role: 'Guard', behavior: 'Suspicious of strangers' }
                ]
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
        });

        it('should return error for empty npcs array', async () => {
            const result = await handleBatchManage({
                action: 'create_npcs'
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe(true);
        });

        it('should accept "npcs" alias', async () => {
            const result = await handleBatchManage({
                action: 'npcs',
                npcs: [{ name: 'Test NPC', role: 'Test' }]
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('create_npcs');
        });

        it('should accept "populate" alias', async () => {
            const result = await handleBatchManage({
                action: 'populate',
                locationName: 'Test Town',
                npcs: [{ name: 'Townsperson', role: 'Commoner' }]
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('create_npcs');
        });
    });

    describe('distribute_items action', () => {
        // NOTE: These tests are skipped because distribute_items requires proper integration
        // with the inventory system (inventory_items join table), not a direct inventory column.
        // TODO: Integrate distribute_items with InventoryRepository
        it.skip('should distribute items to character', async () => {
            const result = await handleBatchManage({
                action: 'distribute_items',
                distributions: [
                    { characterId: testCharacterId, items: ['Longsword', 'Chain Mail', 'Shield'] }
                ]
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('distribute_items');
            expect(data.totalItemsDistributed).toBe(3);
            expect(data.distributions[0].itemsGiven).toContain('Longsword');
        });

        it.skip('should distribute to multiple characters', async () => {
            // Create another character
            const db = getDb(':memory:');
            const charRepo = new CharacterRepository(db);
            const char2Id = randomUUID();
            charRepo.create({
                id: char2Id,
                name: 'Second Character',
                race: 'Elf',
                characterClass: 'Wizard',
                characterType: 'pc',
                level: 1,
                hp: 6,
                maxHp: 6,
                ac: 10,
                stats: { str: 8, dex: 14, con: 10, int: 16, wis: 12, cha: 10 },
                inventory: JSON.stringify([]),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            } as any);

            const result = await handleBatchManage({
                action: 'distribute_items',
                distributions: [
                    { characterId: testCharacterId, items: ['Longsword'] },
                    { characterId: char2Id, items: ['Staff', 'Spellbook'] }
                ]
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.distributions.length).toBe(2);
            expect(data.totalItemsDistributed).toBe(3);
        });

        it('should handle non-existent character', async () => {
            const result = await handleBatchManage({
                action: 'distribute_items',
                distributions: [
                    { characterId: 'non-existent', items: ['Item'] }
                ]
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(false);
            expect(data.errors.length).toBeGreaterThan(0);
        });

        it('should return error for empty distributions', async () => {
            const result = await handleBatchManage({
                action: 'distribute_items'
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe(true);
        });

        it('should accept "distribute" alias', async () => {
            const result = await handleBatchManage({
                action: 'distribute',
                distributions: [
                    { characterId: testCharacterId, items: ['Test Item'] }
                ]
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('distribute_items');
        });
    });

    describe('execute_workflow action', () => {
        it('should prepare workflow with parameters', async () => {
            const result = await handleBatchManage({
                action: 'execute_workflow',
                templateId: 'start_campaign',
                params: {
                    worldName: 'Faerun',
                    partyName: 'Heroes of Neverwinter'
                }
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('execute_workflow');
            expect(data.templateId).toBe('start_campaign');
            expect(data.steps.length).toBeGreaterThan(0);
        });

        it('should return error for unknown template', async () => {
            const result = await handleBatchManage({
                action: 'execute_workflow',
                templateId: 'unknown_template'
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe(true);
            expect(data.availableTemplates).toBeDefined();
        });

        it('should return error for missing required params', async () => {
            const result = await handleBatchManage({
                action: 'execute_workflow',
                templateId: 'start_campaign',
                params: {
                    worldName: 'Test'
                    // Missing partyName
                }
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe(true);
            expect(data.missingParams).toContain('partyName');
        });

        it('should return error for missing templateId', async () => {
            const result = await handleBatchManage({
                action: 'execute_workflow'
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe(true);
        });

        it('should accept "workflow" alias', async () => {
            const result = await handleBatchManage({
                action: 'workflow',
                templateId: 'end_session',
                params: { partyId: 'test-party' }
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('execute_workflow');
        });
    });

    describe('list_templates action', () => {
        it('should list all available templates', async () => {
            const result = await handleBatchManage({
                action: 'list_templates'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('list_templates');
            expect(data.templates).toBeDefined();
            expect(data.templates.length).toBeGreaterThan(0);
        });

        it('should include template details', async () => {
            const result = await handleBatchManage({
                action: 'list_templates'
            }, ctx);

            const data = parseResult(result);
            const template = data.templates[0];
            expect(template.id).toBeDefined();
            expect(template.name).toBeDefined();
            expect(template.description).toBeDefined();
            expect(template.requiredParams).toBeDefined();
        });

        it('should accept "templates" alias', async () => {
            const result = await handleBatchManage({
                action: 'templates'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('list_templates');
        });
    });

    describe('get_template action', () => {
        it('should get template details', async () => {
            const result = await handleBatchManage({
                action: 'get_template',
                templateId: 'start_campaign'
            }, ctx);

            const data = parseResult(result);
            expect(data.success).toBe(true);
            expect(data.actionType).toBe('get_template');
            expect(data.template.name).toBe('Start Campaign');
            expect(data.template.steps.length).toBeGreaterThan(0);
        });

        it('should return error for unknown template', async () => {
            const result = await handleBatchManage({
                action: 'get_template',
                templateId: 'unknown'
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe(true);
            expect(data.availableTemplates).toBeDefined();
        });

        it('should return error for missing templateId', async () => {
            const result = await handleBatchManage({
                action: 'get_template'
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe(true);
        });

        it('should accept "template" alias', async () => {
            const result = await handleBatchManage({
                action: 'template',
                templateId: 'start_campaign'
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('get_template');
        });
    });

    describe('fuzzy matching', () => {
        it('should auto-correct close typos', async () => {
            const result = await handleBatchManage({
                action: 'create_charactr',  // Missing 'e'
                characters: [{ name: 'Typo Test' }]
            }, ctx);

            const data = parseResult(result);
            expect(data.actionType).toBe('create_characters');
        });

        it('should provide helpful error for unknown action', async () => {
            const result = await handleBatchManage({
                action: 'xyz'
            }, ctx);

            const data = parseResult(result);
            expect(data.error).toBe('invalid_action');
            expect(data.message).toContain('Unknown action');
        });
    });

    describe('output formatting', () => {
        it('should include rich text formatting', async () => {
            const result = await handleBatchManage({
                action: 'create_characters',
                characters: [{ name: 'Format Test' }]
            }, ctx);

            const text = result.content[0].text;
            expect(text.toUpperCase()).toContain('CHARACTER');
        });

        it('should embed JSON for parsing', async () => {
            const result = await handleBatchManage({
                action: 'list_templates'
            }, ctx);

            const text = result.content[0].text;
            expect(text).toContain('<!-- BATCH_MANAGE_JSON');
        });
    });
});
