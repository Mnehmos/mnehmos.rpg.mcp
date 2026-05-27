/**
 * Character state slice — the live mechanical sheet, auto-built every invoke.
 *
 * Pulls the character row, concentration state, and inventory directly from the DB.
 * Format is terse and parseable so the LLM can reason about its options without
 * the DM typing it manually every turn.
 *
 * Position / action economy (per-turn state) is deliberately NOT included here —
 * the DM passes that via the `situation` string at invoke time. This slice covers
 * what's stable across the turn: HP/AC/slots/known spells/inventory.
 */

import { CharacterRepository } from '../../../storage/repos/character.repo.js';
import { ConcentrationRepository } from '../../../storage/repos/concentration.repo.js';
import { InventoryRepository } from '../../../storage/repos/inventory.repo.js';
import { Character, NPC } from '../../../schema/character.js';

const HEADER = '--- YOUR CHARACTER ---';
const INV_LIMIT = 10; // notable items shown
const SPELLS_LIMIT = 20;

function modifier(score: number): string {
    const mod = Math.floor((score - 10) / 2);
    return mod >= 0 ? `+${mod}` : `${mod}`;
}

function bloodied(hp: number, maxHp: number): string {
    if (hp <= 0) return 'DOWN';
    if (hp <= maxHp / 2) return 'BLOODIED';
    return '';
}

function formatConditions(character: Character | NPC): string {
    if (!character.conditions || character.conditions.length === 0) return 'none';
    return character.conditions.map(c => {
        const dur = c.duration ? ` (${c.duration}r)` : '';
        const src = c.source ? ` ← ${c.source}` : '';
        return `${c.name}${dur}${src}`;
    }).join(', ');
}

function formatSpellSlots(character: Character | NPC): string | null {
    const slots = character.spellSlots as Record<string, { current: number; max: number }> | undefined;
    if (!slots) return null;

    const parts: string[] = [];
    for (let i = 1; i <= 9; i++) {
        const key = `level${i}`;
        const slot = slots[key];
        if (!slot || !slot.max) continue;
        parts.push(`L${i}[${slot.current}/${slot.max}]`);
    }
    if (parts.length === 0) return null;
    return parts.join('  ');
}

function formatPactMagic(character: Character | NPC): string | null {
    const pact = character.pactMagicSlots;
    if (!pact || !pact.max) return null;
    return `Pact L${pact.slotLevel}[${pact.current}/${pact.max}]`;
}

function formatStats(character: Character | NPC): string {
    const s = character.stats;
    return [
        `STR ${s.str} (${modifier(s.str)})`,
        `DEX ${s.dex} (${modifier(s.dex)})`,
        `CON ${s.con} (${modifier(s.con)})`,
        `INT ${s.int} (${modifier(s.int)})`,
        `WIS ${s.wis} (${modifier(s.wis)})`,
        `CHA ${s.cha} (${modifier(s.cha)})`
    ].join('  ');
}

function formatSaves(character: Character | NPC): string | null {
    const saves = character.saveProficiencies;
    if (!saves || saves.length === 0) return null;
    return saves.map(s => s.toUpperCase()).join(', ');
}

function formatSkills(character: Character | NPC): string | null {
    const skills = character.skillProficiencies;
    if (!skills || skills.length === 0) return null;
    const formatted = skills.map(s => s.replace(/_/g, ' '));
    return formatted.join(', ');
}

function formatInventory(items: ReturnType<InventoryRepository['getInventoryWithDetails']>['items']): { equipped: string; carried: string } {
    const equipped = items
        .filter(i => i.equipped)
        .map(i => i.item.name)
        .join(', ') || 'nothing';

    const carriedRaw = items
        .filter(i => !i.equipped)
        .slice(0, INV_LIMIT);
    const carried = carriedRaw.length === 0
        ? 'nothing notable'
        : carriedRaw.map(i => i.quantity > 1 ? `${i.item.name} x${i.quantity}` : i.item.name).join(', ');

    return { equipped, carried };
}

export interface CharacterStateSliceDeps {
    characterRepo: CharacterRepository;
    concentrationRepo: ConcentrationRepository;
    inventoryRepo: InventoryRepository;
}

export function buildCharacterStateSlice(
    characterId: string,
    deps: CharacterStateSliceDeps
): string | null {
    const character = deps.characterRepo.findById(characterId);
    if (!character) return null;

    const lines: string[] = [HEADER];

    // Identity line
    const subclass = character.subclass && character.subclass !== 'none' ? ` ${character.subclass.replace(/_/g, ' ')}` : '';
    lines.push(`${character.name} — ${character.race ?? 'Human'} ${character.characterClass ?? 'fighter'}${subclass}, level ${character.level}`);

    // Vital stats line
    const bloodTag = bloodied(character.hp, character.maxHp);
    const blood = bloodTag ? `  [${bloodTag}]` : '';
    lines.push(`HP: ${character.hp}/${character.maxHp}    AC: ${character.ac}${blood}`);

    // Conditions
    lines.push(`Conditions: ${formatConditions(character)}`);

    // Resistances / immunities (only if present)
    if (character.resistances && character.resistances.length > 0) {
        lines.push(`Resistant to: ${character.resistances.join(', ')}`);
    }
    if (character.immunities && character.immunities.length > 0) {
        lines.push(`Immune to: ${character.immunities.join(', ')}`);
    }
    if (character.vulnerabilities && character.vulnerabilities.length > 0) {
        lines.push(`Vulnerable to: ${character.vulnerabilities.join(', ')}`);
    }

    // Ability scores
    lines.push(`Stats: ${formatStats(character)}`);

    // Saves + skills (only if proficient)
    const saves = formatSaves(character);
    if (saves) lines.push(`Save proficiencies: ${saves}`);
    const skills = formatSkills(character);
    if (skills) lines.push(`Skill proficiencies: ${skills}`);
    if (character.expertise && character.expertise.length > 0) {
        lines.push(`Expertise: ${character.expertise.join(', ')}`);
    }

    // Spellcasting section (only if spellcaster)
    const slots = formatSpellSlots(character);
    const pact = formatPactMagic(character);
    if (slots || pact || (character.knownSpells && character.knownSpells.length > 0)) {
        lines.push('');
        lines.push('Spellcasting:');
        if (character.spellcastingAbility) {
            const dc = character.spellSaveDC ?? '?';
            const atk = character.spellAttackBonus !== undefined
                ? (character.spellAttackBonus >= 0 ? `+${character.spellAttackBonus}` : `${character.spellAttackBonus}`)
                : '?';
            // Schema stores full names ('wisdom'); display as 3-letter abbreviation
            const abilShort = character.spellcastingAbility.slice(0, 3).toUpperCase();
            lines.push(`  Ability: ${abilShort}    Save DC: ${dc}    Attack: ${atk}`);
        }
        if (slots) lines.push(`  Slots: ${slots}`);
        if (pact) lines.push(`  ${pact}`);

        const known = character.knownSpells ?? [];
        const prepared = character.preparedSpells ?? [];
        const cantrips = character.cantripsKnown ?? [];

        if (cantrips.length > 0) {
            lines.push(`  Cantrips: ${cantrips.join(', ')}`);
        }
        if (prepared.length > 0) {
            const shown = prepared.slice(0, SPELLS_LIMIT).join(', ');
            const extra = prepared.length > SPELLS_LIMIT ? ` (+${prepared.length - SPELLS_LIMIT} more)` : '';
            lines.push(`  Prepared: ${shown}${extra}`);
        } else if (known.length > 0) {
            const shown = known.slice(0, SPELLS_LIMIT).join(', ');
            const extra = known.length > SPELLS_LIMIT ? ` (+${known.length - SPELLS_LIMIT} more)` : '';
            lines.push(`  Known: ${shown}${extra}`);
        }

        const concentration = deps.concentrationRepo.findByCharacterId(characterId);
        if (concentration) {
            lines.push(`  Concentrating on: ${concentration.activeSpell} (L${concentration.spellLevel})`);
        }
    }

    // Inventory (only if any items)
    try {
        const inv = deps.inventoryRepo.getInventoryWithDetails(characterId);
        if (inv.items.length > 0) {
            const { equipped, carried } = formatInventory(inv.items);
            lines.push('');
            lines.push('Inventory:');
            lines.push(`  Equipped: ${equipped}`);
            lines.push(`  Carried: ${carried}`);
            if (inv.currency.gold || inv.currency.silver || inv.currency.copper) {
                lines.push(`  Currency: ${inv.currency.gold}gp / ${inv.currency.silver}sp / ${inv.currency.copper}cp`);
            }
        }
    } catch {
        // Inventory queries can fail on minimal test fixtures — silently skip
    }

    // Legendary creatures
    if (character.legendaryActions && character.legendaryActions > 0) {
        lines.push('');
        lines.push(`Legendary actions: ${character.legendaryActionsRemaining ?? character.legendaryActions}/${character.legendaryActions} per round`);
        if (character.legendaryResistances && character.legendaryResistances > 0) {
            lines.push(`Legendary resistances: ${character.legendaryResistancesRemaining ?? character.legendaryResistances}/${character.legendaryResistances} per day`);
        }
    }

    return lines.join('\n');
}
