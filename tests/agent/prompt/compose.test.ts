import * as fs from 'fs';
import { initDB } from '../../../src/storage/db';
import { migrate } from '../../../src/storage/migrations';
import { CharacterRepository } from '../../../src/storage/repos/character.repo';
import { AgentRepository } from '../../../src/storage/repos/agent.repo';
import { ConcentrationRepository } from '../../../src/storage/repos/concentration.repo';
import { InventoryRepository } from '../../../src/storage/repos/inventory.repo';
import { NpcMemoryRepository } from '../../../src/storage/repos/npc-memory.repo';
import { composePrompt, ComposeDeps } from '../../../src/agent/prompt/compose';
import { Character } from '../../../src/schema/character';
import { FIXED_TIMESTAMP } from '../../fixtures.js';

const TEST_DB = 'test-agent-compose.db';

function cleanup() {
    for (const s of ['', '-wal', '-shm']) {
        const p = TEST_DB + s;
        if (fs.existsSync(p)) fs.unlinkSync(p);
    }
}

function makeChar(id: string, overrides: Partial<Character> = {}): Character {
    return {
        id,
        name: `Char-${id}`,
        stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
        hp: 20,
        maxHp: 20,
        ac: 15,
        level: 1,
        characterType: 'pc',
        characterClass: 'fighter',
        race: 'Human',
        createdAt: FIXED_TIMESTAMP,
        updatedAt: FIXED_TIMESTAMP,
        ...overrides
    } as Character;
}

describe('composePrompt', () => {
    let db: ReturnType<typeof initDB>;
    let deps: ComposeDeps;

    beforeEach(() => {
        cleanup();
        db = initDB(TEST_DB);
        migrate(db);
        deps = {
            agentRepo: new AgentRepository(db),
            characterRepo: new CharacterRepository(db),
            concentrationRepo: new ConcentrationRepository(db),
            inventoryRepo: new InventoryRepository(db),
            npcMemoryRepo: new NpcMemoryRepository(db)
        };
    });

    afterEach(() => {
        db.close();
        cleanup();
    });

    function setupAgent(charId: string) {
        deps.characterRepo.create(makeChar(charId));
        return deps.agentRepo.create({
            characterId: charId,
            provider: 'openai',
            model: 'gpt-4o-mini'
        });
    }

    it('returns no system message when there are no slices and no override', () => {
        const agent = setupAgent('char-1');
        const result = composePrompt(
            { agentId: agent.id, characterId: 'char-1', situation: 'Your turn.' },
            deps
        );

        // No system message, only the user situation message
        // (character_state slice does include the character row though)
        const systemMessages = result.messages.filter(m => m.role === 'system');
        expect(systemMessages.length).toBe(1); // character_state IS auto-built
        expect(systemMessages[0].content).toContain('Char-char-1');
        expect(result.slicesIncluded).toContain('character_state');
    });

    it('assembles slices in the documented order: persona → directive → secrets → character_state → recent → narrative_feed', () => {
        const agent = setupAgent('char-1');
        deps.agentRepo.upsertSlice({ agentId: agent.id, kind: 'persona', content: 'PERSONA_BODY' });
        deps.agentRepo.upsertSlice({ agentId: agent.id, kind: 'directive', content: 'DIRECTIVE_BODY' });
        deps.agentRepo.addSecret({ agentId: agent.id, content: 'SECRET_BODY' });
        deps.agentRepo.upsertSlice({ agentId: agent.id, kind: 'narrative_feed', content: 'FEED_BODY', label: '2026-01-01T00:00:00Z' });

        const result = composePrompt(
            { agentId: agent.id, characterId: 'char-1', situation: 'Go.' },
            deps
        );

        const sys = result.messages.find(m => m.role === 'system');
        expect(sys).toBeDefined();
        const txt = sys!.content;

        const order = [
            txt.indexOf('--- YOU ---'),
            txt.indexOf('--- YOUR DIRECTIVES ---'),
            txt.indexOf('--- YOUR PRIVATE KNOWLEDGE ---'),
            txt.indexOf('--- YOUR CHARACTER ---'),
            txt.indexOf('--- RECENT OBSERVATIONS (TOLD TO YOU) ---')
        ];
        // No -1 entries (all sections present)
        for (const i of order) expect(i).toBeGreaterThan(-1);
        // Strictly ascending order
        for (let i = 1; i < order.length; i++) {
            expect(order[i]).toBeGreaterThan(order[i - 1]);
        }
    });

    it('embeds slice content verbatim', () => {
        const agent = setupAgent('char-1');
        deps.agentRepo.upsertSlice({ agentId: agent.id, kind: 'persona', content: 'You are Kara, a stoic ranger.' });
        deps.agentRepo.upsertSlice({ agentId: agent.id, kind: 'directive', content: 'Protect Theron at all costs.' });
        deps.agentRepo.addSecret({ agentId: agent.id, content: 'The amulet was stolen.', importance: 'critical' });

        const result = composePrompt(
            { agentId: agent.id, characterId: 'char-1', situation: 'Your turn.' },
            deps
        );

        const sys = result.messages.find(m => m.role === 'system')!.content;
        expect(sys).toContain('You are Kara, a stoic ranger.');
        expect(sys).toContain('Protect Theron at all costs.');
        expect(sys).toContain('[CRITICAL] The amulet was stolen.');
    });

    it('skips disabled slices', () => {
        const agent = setupAgent('char-1');
        const persona = deps.agentRepo.upsertSlice({ agentId: agent.id, kind: 'persona', content: 'persona text' });
        deps.agentRepo.upsertSlice({ agentId: agent.id, kind: 'directive', content: 'directive text' });

        deps.agentRepo.toggleSlice(persona.id, false);

        const result = composePrompt(
            { agentId: agent.id, characterId: 'char-1', situation: 'go' },
            deps
        );
        const sys = result.messages.find(m => m.role === 'system')!.content;
        expect(sys).not.toContain('persona text');
        expect(sys).toContain('directive text');
        expect(result.slicesSkipped).toContain('persona');
    });

    it('includes a how-to-respond instruction in the system message', () => {
        const agent = setupAgent('char-1');
        const result = composePrompt(
            { agentId: agent.id, characterId: 'char-1', situation: 'go' },
            deps
        );
        const sys = result.messages.find(m => m.role === 'system')!.content;
        expect(sys).toContain('HOW TO RESPOND');
        expect(sys).toContain('Speak in character');
    });

    it('honors systemOverride (replaces all assembled slices)', () => {
        const agent = setupAgent('char-1');
        deps.agentRepo.upsertSlice({ agentId: agent.id, kind: 'persona', content: 'IGNORED' });

        const result = composePrompt(
            { agentId: agent.id, characterId: 'char-1', situation: 'go', systemOverride: 'CUSTOM SYSTEM TEXT' },
            deps
        );

        const sys = result.messages.find(m => m.role === 'system')!.content;
        expect(sys).toContain('CUSTOM SYSTEM TEXT');
        expect(sys).not.toContain('IGNORED');
        expect(sys).not.toContain('--- YOU ---');
        expect(result.slicesIncluded).toContain('system_override');
    });

    it('honors messagesOverride (bypasses everything)', () => {
        const agent = setupAgent('char-1');
        deps.agentRepo.upsertSlice({ agentId: agent.id, kind: 'persona', content: 'IGNORED' });

        const result = composePrompt(
            {
                agentId: agent.id,
                characterId: 'char-1',
                situation: 'also ignored',
                messagesOverride: [
                    { role: 'system', content: 'OVERRIDE SYS' },
                    { role: 'user', content: 'OVERRIDE USER' }
                ]
            },
            deps
        );

        expect(result.messages.length).toBe(2);
        expect(result.messages[0].content).toBe('OVERRIDE SYS');
        expect(result.messages[1].content).toBe('OVERRIDE USER');
        expect(result.slicesIncluded).toEqual(['messages_override']);
    });

    it('uses a default user message when situation is omitted', () => {
        const agent = setupAgent('char-1');
        const result = composePrompt({ agentId: agent.id, characterId: 'char-1' }, deps);
        const user = result.messages.find(m => m.role === 'user');
        expect(user).toBeDefined();
        expect(user!.content.length).toBeGreaterThan(0);
    });

    it('estimates prompt tokens roughly', () => {
        const agent = setupAgent('char-1');
        deps.agentRepo.upsertSlice({ agentId: agent.id, kind: 'persona', content: 'x'.repeat(400) });

        const result = composePrompt(
            { agentId: agent.id, characterId: 'char-1', situation: 'go' },
            deps
        );
        expect(result.estimatedPromptTokens).toBeGreaterThan(50);
    });
});
