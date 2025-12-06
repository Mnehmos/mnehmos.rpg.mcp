import Database from 'better-sqlite3';
import { Character, CharacterSchema, NPC, NPCSchema } from '../../schema/character.js';
import { CharacterType } from '../../schema/party.js';

export class CharacterRepository {
    constructor(private db: Database.Database) { }

    create(character: Character | NPC): void {
        // Determine if it's an NPC or Character for validation
        const isNPC = 'factionId' in character || 'behavior' in character;
        const validChar = isNPC ? NPCSchema.parse(character) : CharacterSchema.parse(character);

        const stmt = this.db.prepare(`
      INSERT INTO characters (id, name, stats, hp, max_hp, ac, level, faction_id, behavior, character_type,
                              character_class, spell_slots, pact_magic_slots, known_spells, prepared_spells,
                              cantrips_known, max_spell_level, concentrating_on, conditions,
                              legendary_actions, legendary_actions_remaining, legendary_resistances,
                              legendary_resistances_remaining, has_lair_actions, resistances, vulnerabilities, immunities,
                              current_room_id, perception_bonus, stealth_bonus, created_at, updated_at)
      VALUES (@id, @name, @stats, @hp, @maxHp, @ac, @level, @factionId, @behavior, @characterType,
              @characterClass, @spellSlots, @pactMagicSlots, @knownSpells, @preparedSpells,
              @cantripsKnown, @maxSpellLevel, @concentratingOn, @conditions,
              @legendaryActions, @legendaryActionsRemaining, @legendaryResistances,
              @legendaryResistancesRemaining, @hasLairActions, @resistances, @vulnerabilities, @immunities,
              @currentRoomId, @perceptionBonus, @stealthBonus, @createdAt, @updatedAt)
    `);

        stmt.run({
            id: validChar.id,
            name: validChar.name,
            stats: JSON.stringify(validChar.stats),
            hp: validChar.hp,
            maxHp: validChar.maxHp,
            ac: validChar.ac,
            level: validChar.level,
            factionId: (validChar as NPC).factionId || null,
            behavior: (validChar as NPC).behavior || null,
            characterType: validChar.characterType || 'pc',
            // CRIT-002/006: Spellcasting fields
            characterClass: validChar.characterClass || 'fighter',
            spellSlots: validChar.spellSlots ? JSON.stringify(validChar.spellSlots) : null,
            pactMagicSlots: validChar.pactMagicSlots ? JSON.stringify(validChar.pactMagicSlots) : null,
            knownSpells: JSON.stringify(validChar.knownSpells || []),
            preparedSpells: JSON.stringify(validChar.preparedSpells || []),
            cantripsKnown: JSON.stringify(validChar.cantripsKnown || []),
            maxSpellLevel: validChar.maxSpellLevel || 0,
            concentratingOn: validChar.concentratingOn || null,
            conditions: JSON.stringify(validChar.conditions || []),
            // HIGH-007: Legendary creature fields
            legendaryActions: validChar.legendaryActions ?? null,
            legendaryActionsRemaining: validChar.legendaryActionsRemaining ?? null,
            legendaryResistances: validChar.legendaryResistances ?? null,
            legendaryResistancesRemaining: validChar.legendaryResistancesRemaining ?? null,
            hasLairActions: validChar.hasLairActions ? 1 : 0,
            resistances: JSON.stringify(validChar.resistances || []),
            vulnerabilities: JSON.stringify(validChar.vulnerabilities || []),
            immunities: JSON.stringify(validChar.immunities || []),
            // PHASE-1: Spatial awareness
            currentRoomId: validChar.currentRoomId || null,
            // PHASE-2: Social hearing mechanics skill bonuses
            perceptionBonus: validChar.perceptionBonus || 0,
            stealthBonus: validChar.stealthBonus || 0,
            createdAt: validChar.createdAt,
            updatedAt: validChar.updatedAt,
        });
    }

    findById(id: string): Character | NPC | null {
        const stmt = this.db.prepare('SELECT * FROM characters WHERE id = ?');
        const row = stmt.get(id) as CharacterRow | undefined;

        if (!row) return null;
        return this.rowToCharacter(row);
    }

    findAll(filters?: { characterType?: CharacterType }): (Character | NPC)[] {
        let query = 'SELECT * FROM characters';
        const params: any[] = [];

        if (filters?.characterType) {
            query += ' WHERE character_type = ?';
            params.push(filters.characterType);
        }

        const stmt = this.db.prepare(query);
        const rows = stmt.all(...params) as CharacterRow[];
        return rows.map(row => this.rowToCharacter(row));
    }

    findByType(characterType: CharacterType): (Character | NPC)[] {
        const stmt = this.db.prepare('SELECT * FROM characters WHERE character_type = ?');
        const rows = stmt.all(characterType) as CharacterRow[];
        return rows.map(row => this.rowToCharacter(row));
    }

    update(id: string, updates: Partial<Character | NPC>): Character | NPC | null {
        const existing = this.findById(id);
        if (!existing) return null;

        const updated = {
            ...existing,
            ...updates,
            updatedAt: new Date().toISOString()
        };

        // Validate
        const isNPC = 'factionId' in updated || 'behavior' in updated;
        const validChar = isNPC ? NPCSchema.parse(updated) : CharacterSchema.parse(updated);

        const stmt = this.db.prepare(`
            UPDATE characters
            SET name = ?, stats = ?, hp = ?, max_hp = ?, ac = ?, level = ?,
                faction_id = ?, behavior = ?, character_type = ?,
                character_class = ?, spell_slots = ?, pact_magic_slots = ?,
                known_spells = ?, prepared_spells = ?, cantrips_known = ?,
                max_spell_level = ?, concentrating_on = ?, conditions = ?,
                legendary_actions = ?, legendary_actions_remaining = ?,
                legendary_resistances = ?, legendary_resistances_remaining = ?,
                has_lair_actions = ?, resistances = ?, vulnerabilities = ?, immunities = ?,
                current_room_id = ?, perception_bonus = ?, stealth_bonus = ?, updated_at = ?
            WHERE id = ?
        `);

        stmt.run(
            validChar.name,
            JSON.stringify(validChar.stats),
            validChar.hp,
            validChar.maxHp,
            validChar.ac,
            validChar.level,
            (validChar as NPC).factionId || null,
            (validChar as NPC).behavior || null,
            validChar.characterType || 'pc',
            // CRIT-002/006: Spellcasting fields
            validChar.characterClass || 'fighter',
            validChar.spellSlots ? JSON.stringify(validChar.spellSlots) : null,
            validChar.pactMagicSlots ? JSON.stringify(validChar.pactMagicSlots) : null,
            JSON.stringify(validChar.knownSpells || []),
            JSON.stringify(validChar.preparedSpells || []),
            JSON.stringify(validChar.cantripsKnown || []),
            validChar.maxSpellLevel || 0,
            validChar.concentratingOn || null,
            JSON.stringify(validChar.conditions || []),
            // HIGH-007: Legendary creature fields
            validChar.legendaryActions ?? null,
            validChar.legendaryActionsRemaining ?? null,
            validChar.legendaryResistances ?? null,
            validChar.legendaryResistancesRemaining ?? null,
            validChar.hasLairActions ? 1 : 0,
            JSON.stringify(validChar.resistances || []),
            JSON.stringify(validChar.vulnerabilities || []),
            JSON.stringify(validChar.immunities || []),
            // PHASE-1: Spatial awareness
            validChar.currentRoomId || null,
            // PHASE-2: Social hearing mechanics skill bonuses
            validChar.perceptionBonus || 0,
            validChar.stealthBonus || 0,
            validChar.updatedAt,
            id
        );

        return validChar;
    }

    delete(id: string): boolean {
        const stmt = this.db.prepare('DELETE FROM characters WHERE id = ?');
        const result = stmt.run(id);
        return result.changes > 0;
    }

    private rowToCharacter(row: CharacterRow): Character | NPC {
        const base = {
            id: row.id,
            name: row.name,
            stats: JSON.parse(row.stats),
            hp: row.hp,
            maxHp: row.max_hp,
            ac: row.ac,
            level: row.level,
            characterType: (row.character_type as CharacterType) || 'pc',
            // CRIT-002/006: Spellcasting fields
            characterClass: row.character_class || 'fighter',
            spellSlots: row.spell_slots ? JSON.parse(row.spell_slots) : undefined,
            pactMagicSlots: row.pact_magic_slots ? JSON.parse(row.pact_magic_slots) : undefined,
            knownSpells: row.known_spells ? JSON.parse(row.known_spells) : [],
            preparedSpells: row.prepared_spells ? JSON.parse(row.prepared_spells) : [],
            cantripsKnown: row.cantrips_known ? JSON.parse(row.cantrips_known) : [],
            maxSpellLevel: row.max_spell_level || 0,
            concentratingOn: row.concentrating_on || null,
            conditions: row.conditions ? JSON.parse(row.conditions) : [],
            // HIGH-007: Legendary creature fields
            legendaryActions: row.legendary_actions ?? undefined,
            legendaryActionsRemaining: row.legendary_actions_remaining ?? undefined,
            legendaryResistances: row.legendary_resistances ?? undefined,
            legendaryResistancesRemaining: row.legendary_resistances_remaining ?? undefined,
            hasLairActions: row.has_lair_actions === 1,
            resistances: row.resistances ? JSON.parse(row.resistances) : [],
            vulnerabilities: row.vulnerabilities ? JSON.parse(row.vulnerabilities) : [],
            immunities: row.immunities ? JSON.parse(row.immunities) : [],
            // PHASE-1: Spatial awareness
            currentRoomId: row.current_room_id || undefined,
            // PHASE-2: Social hearing mechanics skill bonuses
            perceptionBonus: row.perception_bonus ?? 0,
            stealthBonus: row.stealth_bonus ?? 0,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };

        if (row.faction_id || row.behavior) {
            return NPCSchema.parse({
                ...base,
                factionId: row.faction_id || undefined,
                behavior: row.behavior || undefined,
            });
        }

        return CharacterSchema.parse(base);
    }
}

interface CharacterRow {
    id: string;
    name: string;
    stats: string;
    hp: number;
    max_hp: number;
    ac: number;
    level: number;
    faction_id: string | null;
    behavior: string | null;
    character_type: string | null;
    // CRIT-002/006: Spellcasting columns
    character_class: string | null;
    spell_slots: string | null;
    pact_magic_slots: string | null;
    known_spells: string | null;
    prepared_spells: string | null;
    cantrips_known: string | null;
    max_spell_level: number | null;
    concentrating_on: string | null;
    conditions: string | null;
    // HIGH-007: Legendary creature columns
    legendary_actions: number | null;
    legendary_actions_remaining: number | null;
    legendary_resistances: number | null;
    legendary_resistances_remaining: number | null;
    has_lair_actions: number | null;
    resistances: string | null;
    vulnerabilities: string | null;
    immunities: string | null;
    // PHASE-1: Spatial awareness
    current_room_id: string | null;
    // PHASE-2: Social hearing mechanics skill bonuses
    perception_bonus: number | null;
    stealth_bonus: number | null;
    created_at: string;
    updated_at: string;
}
