/**
 * Player's Handbook Armor Presets
 *
 * All armor from D&D 5e PHB, including:
 * - Light Armor (Padded, Leather, Studded Leather)
 * - Medium Armor (Hide, Chain Shirt, Scale Mail, Breastplate, Half Plate)
 * - Heavy Armor (Ring Mail, Chain Mail, Splint, Plate)
 * - Shield
 *
 * Data sourced from PHB page 145
 */

import type { ArmorPreset, PresetSource } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// ARMOR PRESETS
// ═══════════════════════════════════════════════════════════════════════════

const ARMOR: Record<string, ArmorPreset> = {
    // -------------------------------------------------------------------------
    // LIGHT ARMOR
    // -------------------------------------------------------------------------

    padded: {
        name: 'Padded Armor',
        type: 'armor',
        category: 'light',
        ac: 11,
        // maxDexBonus: undefined (light armor has no limit)
        stealthDisadvantage: true,
        weight: 8,
        value: 5,
        donTime: '1 minute',
        doffTime: '1 minute',
        tags: ['light', 'cloth', 'cheap', 'stealth-penalty'],
        source: 'PHB',
        description: 'Padded armor consists of quilted layers of cloth and batting.'
    },

    leather: {
        name: 'Leather Armor',
        type: 'armor',
        category: 'light',
        ac: 11,
        weight: 10,
        value: 10,
        donTime: '1 minute',
        doffTime: '1 minute',
        tags: ['light', 'leather', 'flexible', 'basic'],
        source: 'PHB',
        description: 'The breastplate and shoulder protectors of this armor are made of leather that has been stiffened by being boiled in oil. The rest of the armor is made of softer and more flexible materials.'
    },

    studded_leather: {
        name: 'Studded Leather',
        type: 'armor',
        category: 'light',
        ac: 12,
        weight: 13,
        value: 45,
        donTime: '1 minute',
        doffTime: '1 minute',
        tags: ['light', 'leather', 'reinforced', 'studded'],
        source: 'PHB',
        description: 'Made from tough but flexible leather, studded leather is reinforced with close-set rivets or spikes.'
    },

    // -------------------------------------------------------------------------
    // MEDIUM ARMOR
    // -------------------------------------------------------------------------

    hide: {
        name: 'Hide Armor',
        type: 'armor',
        category: 'medium',
        ac: 12,
        maxDexBonus: 2,
        weight: 12,
        value: 10,
        donTime: '5 minutes',
        doffTime: '1 minute',
        tags: ['medium', 'hide', 'crude', 'cheap', 'tribal'],
        source: 'PHB',
        description: 'This crude armor consists of thick furs and pelts. It is commonly worn by barbarian tribes, evil humanoids, and other folk who lack access to the tools and materials needed to create better armor.'
    },

    chain_shirt: {
        name: 'Chain Shirt',
        type: 'armor',
        category: 'medium',
        ac: 13,
        maxDexBonus: 2,
        weight: 20,
        value: 50,
        donTime: '5 minutes',
        doffTime: '1 minute',
        tags: ['medium', 'chain', 'metal', 'flexible'],
        source: 'PHB',
        description: 'Made of interlocking metal rings, a chain shirt is worn between layers of clothing or leather. This armor offers modest protection to the wearer\'s upper body and allows the sound of the rings rubbing against one another to be muffled by outer layers.'
    },

    scale_mail: {
        name: 'Scale Mail',
        type: 'armor',
        category: 'medium',
        ac: 14,
        maxDexBonus: 2,
        stealthDisadvantage: true,
        weight: 45,
        value: 50,
        donTime: '5 minutes',
        doffTime: '1 minute',
        tags: ['medium', 'scale', 'metal', 'stealth-penalty', 'heavy-medium'],
        source: 'PHB',
        description: 'This armor consists of a coat and leggings (and perhaps a separate skirt) of leather covered with overlapping pieces of metal, much like the scales of a fish. The suit includes gauntlets.'
    },

    breastplate: {
        name: 'Breastplate',
        type: 'armor',
        category: 'medium',
        ac: 14,
        maxDexBonus: 2,
        weight: 20,
        value: 400,
        donTime: '5 minutes',
        doffTime: '1 minute',
        tags: ['medium', 'metal', 'plate', 'expensive', 'mobility'],
        source: 'PHB',
        description: 'This armor consists of a fitted metal chest piece worn with supple leather. Although it leaves the legs and arms relatively unprotected, this armor provides good protection for the wearer\'s vital organs while leaving the wearer relatively unencumbered.'
    },

    half_plate: {
        name: 'Half Plate',
        type: 'armor',
        category: 'medium',
        ac: 15,
        maxDexBonus: 2,
        stealthDisadvantage: true,
        weight: 40,
        value: 750,
        donTime: '5 minutes',
        doffTime: '1 minute',
        tags: ['medium', 'plate', 'metal', 'stealth-penalty', 'heavy-medium', 'expensive'],
        source: 'PHB',
        description: 'Half plate consists of shaped metal plates that cover most of the wearer\'s body. It does not include leg protection beyond simple greaves that are attached with leather straps.'
    },

    // -------------------------------------------------------------------------
    // HEAVY ARMOR
    // -------------------------------------------------------------------------

    ring_mail: {
        name: 'Ring Mail',
        type: 'armor',
        category: 'heavy',
        ac: 14,
        maxDexBonus: 0,
        stealthDisadvantage: true,
        weight: 40,
        value: 30,
        donTime: '10 minutes',
        doffTime: '5 minutes',
        tags: ['heavy', 'metal', 'rings', 'stealth-penalty', 'cheap-heavy'],
        source: 'PHB',
        description: 'This armor is leather armor with heavy rings sewn into it. The rings help reinforce the armor against blows from swords and axes. Ring mail is inferior to chain mail, and it\'s usually worn only by those who can\'t afford better armor.'
    },

    chain_mail: {
        name: 'Chain Mail',
        type: 'armor',
        category: 'heavy',
        ac: 16,
        maxDexBonus: 0,
        minStrength: 13,
        stealthDisadvantage: true,
        weight: 55,
        value: 75,
        donTime: '10 minutes',
        doffTime: '5 minutes',
        tags: ['heavy', 'chain', 'metal', 'stealth-penalty', 'str-requirement'],
        source: 'PHB',
        description: 'Made of interlocking metal rings, chain mail includes a layer of quilted fabric worn underneath the mail to prevent chafing and to cushion the impact of blows. The suit includes gauntlets.'
    },

    splint: {
        name: 'Splint Armor',
        type: 'armor',
        category: 'heavy',
        ac: 17,
        maxDexBonus: 0,
        minStrength: 15,
        stealthDisadvantage: true,
        weight: 60,
        value: 200,
        donTime: '10 minutes',
        doffTime: '5 minutes',
        tags: ['heavy', 'metal', 'plate', 'stealth-penalty', 'str-requirement', 'expensive'],
        source: 'PHB',
        description: 'This armor is made of narrow vertical strips of metal riveted to a backing of leather that is worn over cloth padding. Flexible chain mail protects the joints.'
    },

    plate: {
        name: 'Plate Armor',
        type: 'armor',
        category: 'heavy',
        ac: 18,
        maxDexBonus: 0,
        minStrength: 15,
        stealthDisadvantage: true,
        weight: 65,
        value: 1500,
        donTime: '10 minutes',
        doffTime: '5 minutes',
        tags: ['heavy', 'plate', 'metal', 'stealth-penalty', 'str-requirement', 'expensive', 'best-ac'],
        source: 'PHB',
        description: 'Plate consists of shaped, interlocking metal plates to cover the entire body. A suit of plate includes gauntlets, heavy leather boots, a visored helmet, and thick layers of padding underneath the armor. Buckles and straps distribute the weight over the body.'
    },

    // -------------------------------------------------------------------------
    // SHIELD
    // -------------------------------------------------------------------------

    shield: {
        name: 'Shield',
        type: 'armor',
        category: 'shield',
        ac: 2, // AC bonus, not base AC
        weight: 6,
        value: 10,
        donTime: '1 action',
        doffTime: '1 action',
        tags: ['shield', 'ac-bonus', 'one-hand', 'basic'],
        source: 'PHB',
        description: 'A shield is made from wood or metal and is carried in one hand. Wielding a shield increases your Armor Class by 2. You can benefit from only one shield at a time.'
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export const ArmorPHB: PresetSource = {
    id: 'armor-phb',
    name: 'Player\'s Handbook Armor',
    source: 'PHB',
    version: '1.0.0',
    presets: ARMOR
};
