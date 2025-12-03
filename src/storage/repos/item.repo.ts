import Database from 'better-sqlite3';
import { Item, ItemSchema } from '../../schema/inventory.js';

export class ItemRepository {
    constructor(private db: Database.Database) { }

    create(item: Item): void {
        const validItem = ItemSchema.parse(item);

        const stmt = this.db.prepare(`
            INSERT INTO items (id, name, description, type, weight, value, properties, created_at, updated_at)
            VALUES (@id, @name, @description, @type, @weight, @value, @properties, @createdAt, @updatedAt)
        `);

        stmt.run({
            id: validItem.id,
            name: validItem.name,
            description: validItem.description || null,
            type: validItem.type,
            weight: validItem.weight,
            value: validItem.value,
            properties: JSON.stringify(validItem.properties || {}),
            createdAt: validItem.createdAt,
            updatedAt: validItem.updatedAt
        });
    }

    findById(id: string): Item | null {
        const stmt = this.db.prepare('SELECT * FROM items WHERE id = ?');
        const row = stmt.get(id) as ItemRow | undefined;

        if (!row) return null;
        return this.rowToItem(row);
    }

    findAll(): Item[] {
        const stmt = this.db.prepare('SELECT * FROM items');
        const rows = stmt.all() as ItemRow[];
        return rows.map(row => this.rowToItem(row));
    }

    delete(id: string): void {
        const stmt = this.db.prepare('DELETE FROM items WHERE id = ?');
        stmt.run(id);
    }

    update(id: string, updates: Partial<Omit<Item, 'id' | 'createdAt'>>): Item | null {
        const existing = this.findById(id);
        if (!existing) return null;

        const now = new Date().toISOString();
        const updated = {
            ...existing,
            ...updates,
            updatedAt: now
        };

        const stmt = this.db.prepare(`
            UPDATE items SET
                name = @name,
                description = @description,
                type = @type,
                weight = @weight,
                value = @value,
                properties = @properties,
                updated_at = @updatedAt
            WHERE id = @id
        `);

        stmt.run({
            id: updated.id,
            name: updated.name,
            description: updated.description || null,
            type: updated.type,
            weight: updated.weight,
            value: updated.value,
            properties: JSON.stringify(updated.properties || {}),
            updatedAt: updated.updatedAt
        });

        return this.findById(id);
    }

    findByName(name: string): Item[] {
        const stmt = this.db.prepare('SELECT * FROM items WHERE LOWER(name) LIKE LOWER(?)');
        const rows = stmt.all(`%${name}%`) as ItemRow[];
        return rows.map(row => this.rowToItem(row));
    }

    findByType(type: string): Item[] {
        const stmt = this.db.prepare('SELECT * FROM items WHERE type = ?');
        const rows = stmt.all(type) as ItemRow[];
        return rows.map(row => this.rowToItem(row));
    }

    search(query: { name?: string; type?: string; minValue?: number; maxValue?: number }): Item[] {
        let sql = 'SELECT * FROM items WHERE 1=1';
        const params: any[] = [];

        if (query.name) {
            sql += ' AND LOWER(name) LIKE LOWER(?)';
            params.push(`%${query.name}%`);
        }
        if (query.type) {
            sql += ' AND type = ?';
            params.push(query.type);
        }
        if (query.minValue !== undefined) {
            sql += ' AND value >= ?';
            params.push(query.minValue);
        }
        if (query.maxValue !== undefined) {
            sql += ' AND value <= ?';
            params.push(query.maxValue);
        }

        const stmt = this.db.prepare(sql);
        const rows = stmt.all(...params) as ItemRow[];
        return rows.map(row => this.rowToItem(row));
    }

    private rowToItem(row: ItemRow): Item {
        return ItemSchema.parse({
            id: row.id,
            name: row.name,
            description: row.description || undefined,
            type: row.type,
            weight: row.weight,
            value: row.value,
            properties: row.properties ? JSON.parse(row.properties) : undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        });
    }
}

interface ItemRow {
    id: string;
    name: string;
    description: string | null;
    type: string;
    weight: number;
    value: number;
    properties: string | null;
    created_at: string;
    updated_at: string;
}
