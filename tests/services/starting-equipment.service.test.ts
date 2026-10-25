import * as fs from 'fs';
import { initDB } from '../../src/storage/db';
import { migrate } from '../../src/storage/migrations';
import { CharacterRepository } from '../../src/storage/repos/character.repo';
import { provisionStartingEquipment } from '../../src/services/starting-equipment.service';
import { Character } from '../../src/schema/character';
import { FIXED_TIMESTAMP } from '../fixtures.js';

const TEST_DB = 'test-starting-equipment.db';

function cleanup() {
    for (const suffix of ['', '-wal', '-shm']) {
        if (fs.existsSync(TEST_DB + suffix)) fs.unlinkSync(TEST_DB + suffix);
    }
}

describe('starting equipment weight', () => {
    let db: ReturnType<typeof initDB>;

    beforeEach(() => {
        cleanup();
        db = initDB(TEST_DB);
        migrate(db);
        new CharacterRepository(db).create({
            id: 'rogue-1',
            name: 'Mara Venn',
            stats: { str: 10, dex: 15, con: 13, int: 14, wis: 12, cha: 8 },
            hp: 9,
            maxHp: 9,
            ac: 11,
            level: 1,
            characterType: 'pc',
            characterClass: 'rogue',
            race: 'Human',
            createdAt: FIXED_TIMESTAMP,
            updatedAt: FIXED_TIMESTAMP,
        } as Character);
    });

    afterEach(() => {
        db.close();
        cleanup();
    });

    function carried(): Array<{ name: string; weight: number; quantity: number }> {
        return db.prepare(
            `SELECT items.name AS name, items.weight AS weight, inventory_items.quantity AS quantity
             FROM inventory_items JOIN items ON items.id = inventory_items.item_id
             WHERE inventory_items.character_id = ?`
        ).all('rogue-1') as Array<{ name: string; weight: number; quantity: number }>;
    }

    it('gives a rogue one 2 lb bag of ball bearings, not 1,000 one-pound bearings', () => {
        provisionStartingEquipment(db, 'rogue-1', 'rogue', 1);

        const bearings = carried().filter((row) => /ball bearings/i.test(row.name));
        expect(bearings).toEqual([{ name: 'Ball Bearings (bag of 1000)', weight: 2, quantity: 1 }]);
    });

    it('keeps a starting rogue well under their carrying capacity', () => {
        provisionStartingEquipment(db, 'rogue-1', 'rogue', 1);

        const total = carried().reduce((sum, row) => sum + row.weight * row.quantity, 0);
        // Strength 10 carries 150 lb; a 1st-level rogue's kit is a few dozen pounds.
        expect(total).toBeLessThan(150);
    });
});
