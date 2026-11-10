import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { handleRestManage } from '../../src/server/consolidated/rest-manage.js';
import { handleTravelManage } from '../../src/server/consolidated/travel-manage.js';
import { closeDb, getDb } from '../../src/storage/index.js';
import { CharacterRepository } from '../../src/storage/repos/character.repo.js';
import { PartyRepository } from '../../src/storage/repos/party.repo.js';
import { getInitialSpellSlots } from '../../src/engine/magic/spell-validator.js';

const ctx = { sessionId: 'test-session' } as any;
const STATS = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };

describe('rest rules', () => {
    let characters: CharacterRepository;

    beforeEach(() => {
        closeDb();
        characters = new CharacterRepository(getDb(':memory:'));
    });

    function create(overrides: Record<string, unknown>): string {
        const id = randomUUID();
        const now = new Date().toISOString();
        characters.create({
            id, name: 'Rester', characterType: 'pc', level: 3, hp: 1, maxHp: 200, ac: 10,
            stats: STATS, createdAt: now, updatedAt: now, ...overrides,
        } as any);
        return id;
    }

    const short = async (characterId: string, hitDiceToSpend: number) =>
        JSON.parse((await handleRestManage({ action: 'short', characterId, hitDiceToSpend }, ctx)).content[0].text);
    const long = async (characterId: string) =>
        JSON.parse((await handleRestManage({ action: 'long', characterId }, ctx)).content[0].text);

    describe('hit dice are a limited pool', () => {
        it('a character cannot spend more hit dice than it has levels', async () => {
            const id = create({ level: 3 });

            const rest = await short(id, 20);

            expect(rest.hitDiceSpent).toBe(3);
            expect(rest.rolls).toHaveLength(3);
            expect(rest.hitDiceRemaining).toBe(0);
        });

        it('spent hit dice stay spent across short rests', async () => {
            const id = create({ level: 3 });
            await short(id, 2);

            const second = await short(id, 2);
            expect(second.hitDiceSpent).toBe(1);

            const third = await short(id, 2);
            expect(third.hitDiceSpent).toBe(0);
            expect(third.hpRestored).toBe(0);
            expect(third.newHp).toBe(third.previousHp);
        });

        it('a long rest returns half the character\'s hit dice, at least one', async () => {
            const id = create({ level: 6 });
            await short(id, 6);

            const rest = await long(id);
            expect(rest.hitDiceRestored).toBe(3);
            expect(rest.hitDiceRemaining).toBe(3);

            const levelOne = create({ level: 1 });
            await short(levelOne, 1);
            expect((await long(levelOne)).hitDiceRemaining).toBe(1);
        });

        it('a long rest never raises the pool above the character\'s level', async () => {
            const id = create({ level: 4 });
            expect((await long(id)).hitDiceRemaining).toBe(4);
        });
    });

    it('rolls the class\'s own hit die', async () => {
        expect((await short(create({ characterClass: 'barbarian' }), 1)).hitDieSize).toBe('d12');
        expect((await short(create({ characterClass: 'Wizard' }), 1)).hitDieSize).toBe('d6');
        expect((await short(create({ characterClass: 'fighter' }), 1)).hitDieSize).toBe('d10');
        // A class the engine has no data for falls back to a d8.
        expect((await short(create({ characterClass: 'chronomancer' }), 1)).hitDieSize).toBe('d8');
    });

    describe('party rests follow the same rules', () => {
        function party(memberIds: string[]): string {
            const db = getDb();
            const repo = new PartyRepository(db);
            const id = randomUUID();
            const now = new Date().toISOString();
            repo.create({ id, name: 'Company', status: 'active', formation: 'standard', createdAt: now, updatedAt: now } as any);
            memberIds.forEach((characterId, i) => repo.addMember({
                id: randomUUID(), partyId: id, characterId, role: i === 0 ? 'leader' : 'member',
                isActive: true, sharePercentage: 100, joinedAt: now, position: i,
            } as any));
            return id;
        }
        const parse = (result: any) => JSON.parse(result.content[0].text.match(/<!-- TRAVEL_MANAGE_JSON\n([\s\S]*?)\nTRAVEL_MANAGE_JSON -->/)[1]);

        it('a party long rest restores spell slots, not just hit points', async () => {
            const slots = getInitialSpellSlots('wizard' as any, 5);
            slots.level1.current = 0;
            slots.level3.current = 0;
            const wizard = create({ characterClass: 'wizard', level: 5, spellSlots: slots, stats: { ...STATS, int: 18 } });

            await handleTravelManage({ action: 'rest', partyId: party([wizard]), restType: 'long' }, ctx);

            const after = characters.findById(wizard)!;
            expect(after.spellSlots!.level1.current).toBe(after.spellSlots!.level1.max);
            expect(after.spellSlots!.level3.current).toBe(after.spellSlots!.level3.max);
            expect(after.hp).toBe(200);
        });

        it('a party short rest spends from each member\'s hit dice pool', async () => {
            const member = create({ level: 2 });
            const partyId = party([member]);

            await handleTravelManage({ action: 'rest', partyId, restType: 'short', hitDicePerMember: 5 }, ctx);
            const hpAfterFirst = characters.findById(member)!.hp;
            expect(hpAfterFirst).toBeGreaterThan(1);

            const second = parse(await handleTravelManage({ action: 'rest', partyId, restType: 'short', hitDicePerMember: 5 }, ctx));
            expect(characters.findById(member)!.hp).toBe(hpAfterFirst);
            expect(second.members[0].healed).toBe(0);
        });
    });
});
