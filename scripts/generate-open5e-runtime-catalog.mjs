import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_PACK_HASH = 'fbd846cf7b7833560b22f4ebffaf950fb6b2adf62cf9c6fff469266325ac31fa';
const TARGET_DOCUMENT = 'srd-2014';
const TARGET_GAMESYSTEM = '5e-2014';
const TAXONOMY_DOCUMENT = 'core';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const requestedPackDir = argument('--pack-dir') ?? process.env.OPEN5E_PACK_DIR;
if (!requestedPackDir) {
  throw new Error('Provide the reviewed source pack with --pack-dir <path> or OPEN5E_PACK_DIR');
}
const packDir = resolve(requestedPackDir);
const outputPath = resolve(
  argument('--output') ?? resolve(repoRoot, 'config', 'open5e-srd-2014-runtime.json'),
);

const manifest = JSON.parse(readFileSync(resolve(packDir, 'manifest.json'), 'utf8'));
if (manifest.packHash !== EXPECTED_PACK_HASH) {
  throw new Error(`Refusing unreviewed Open5e pack ${manifest.packHash}; expected ${EXPECTED_PACK_HASH}`);
}
if (manifest.schemaVersion !== 2 || manifest.targetDocumentKey !== TARGET_DOCUMENT) {
  throw new Error('Open5e pack schema or target document does not match the reviewed runtime contract');
}

function readCollection(name, tier) {
  const descriptor = manifest.collections?.[name]?.[tier];
  if (!descriptor) throw new Error(`Missing ${tier} ${name} collection in Open5e manifest`);

  const path = resolve(packDir, descriptor.path);
  const bytes = readFileSync(path);
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  if (actualHash !== descriptor.sha256) {
    throw new Error(`${descriptor.path} hash mismatch: ${actualHash} !== ${descriptor.sha256}`);
  }

  const text = bytes.toString('utf8').trim();
  return text ? text.split(/\r?\n/u).map((line) => JSON.parse(line)) : [];
}

function inRuntimeScope(record) {
  return record.gamesystem === TARGET_GAMESYSTEM
    && (record.documentKey === TARGET_DOCUMENT || record.documentKey === TAXONOMY_DOCUMENT);
}

function exactTarget(record) {
  return record.gamesystem === TARGET_GAMESYSTEM && record.documentKey === TARGET_DOCUMENT;
}

function byContentKey(records) {
  return new Map(records.map((record) => [record.contentKey, record]));
}

function engineSkillKey(sourceKey) {
  return sourceKey.replaceAll('-', '_');
}

function compactChoice(choice, mapOption = (option) => option) {
  if (!choice) return null;
  return {
    count: choice.count,
    ...(choice.description ? { description: choice.description } : {}),
    ...(choice.options?.length ? { options: choice.options.map(mapOption) } : {}),
  };
}

const normalizedClasses = readCollection('classes', 'normalized').filter(exactTarget);
const normalizedSpecies = readCollection('species', 'normalized').filter(exactTarget);
const normalizedBackgrounds = readCollection('backgrounds', 'normalized').filter(exactTarget);
const classNames = byContentKey(normalizedClasses);
const speciesNames = byContentKey(normalizedSpecies);
const backgroundNames = byContentKey(normalizedBackgrounds);

const classes = readCollection('classes', 'compiled')
  .filter(exactTarget)
  .map((profile) => ({
    sourceKey: profile.sourceContentKey.split(':').at(-1),
    contentKey: profile.sourceContentKey,
    name: classNames.get(profile.sourceContentKey)?.name,
    hitDie: profile.hitDie,
    savingThrows: profile.savingThrows,
    armorProficiencies: profile.proficiencies.armor,
    weaponProficiencies: profile.proficiencies.weapons,
    toolProficiencies: profile.proficiencies.tools,
    toolChoice: compactChoice(profile.toolChoice),
    skillChoice: compactChoice(profile.skillChoice, (option) => ({
      key: engineSkillKey(option.sourceKey),
      name: option.name,
    })),
    levelOneFeatures: profile.levelOneFeatures.map((feature) => feature.name),
    startingEquipmentDescription: profile.startingEquipmentDescription,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const species = readCollection('species', 'compiled')
  .filter(exactTarget)
  .map((profile) => ({
    sourceKey: profile.sourceContentKey.split(':').at(-1),
    contentKey: profile.sourceContentKey,
    name: speciesNames.get(profile.sourceContentKey)?.name,
    parent: profile.parent,
    abilityBonuses: profile.abilityBonuses,
    abilityChoice: profile.abilityChoice,
    size: profile.size,
    speedFeet: profile.speedFeet,
    languages: profile.languages.map((language) => language.name),
    languageChoiceCount: profile.languageChoiceCount,
    featureNames: profile.featureNames,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const backgrounds = readCollection('backgrounds', 'compiled')
  .filter((profile) => exactTarget(profile) && profile.selectable)
  .map((profile) => ({
    sourceKey: profile.sourceContentKey.split(':').at(-1),
    contentKey: profile.sourceContentKey,
    name: backgroundNames.get(profile.sourceContentKey)?.name,
    skillProficiencies: profile.skillProficiencies.map((skill) => engineSkillKey(skill.sourceKey)),
    skillChoice: compactChoice(profile.skillChoice, (option) => ({
      key: engineSkillKey(option.sourceKey),
      name: option.name,
    })),
    fixedLanguages: profile.fixedLanguages.map((language) => language.name),
    languageChoiceCount: profile.languageChoiceCount,
    toolProficiencies: profile.toolProficiencies,
    toolChoice: compactChoice(profile.toolChoice),
    startingCurrencyCopper: profile.startingCurrencyCopper,
    startingItemSourceKeys: profile.startingItemSourceKeys,
    startingEquipmentDescription: profile.startingEquipmentDescription
      || backgroundNames.get(profile.sourceContentKey)?.benefits
        ?.find((benefit) => benefit.benefitType === 'equipment')?.description
      || '',
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const skills = readCollection('skills', 'normalized')
  .filter((record) => inRuntimeScope(record) && record.kind === 'skill')
  .map((record) => ({
    key: engineSkillKey(record.sourceKey),
    name: record.name,
    ability: record.ability,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const languages = readCollection('languages', 'normalized')
  .filter((record) => inRuntimeScope(record) && record.kind === 'language' && !record.isSecret)
  .map((record) => ({
    key: record.sourceKey,
    name: record.name,
    isExotic: record.isExotic,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const alignments = readCollection('alignments', 'normalized')
  .filter((record) => inRuntimeScope(record) && record.kind === 'alignment')
  .map((record) => ({
    key: record.sourceKey,
    name: record.name,
    shortName: record.shortName,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const weapons = byContentKey(readCollection('weapons', 'normalized').filter(exactTarget));
const armor = byContentKey(readCollection('armor', 'normalized').filter(exactTarget));

function propertyKey(name) {
  const words = name.toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean);
  return words.map((word, index) => index === 0 ? word : `${word[0].toUpperCase()}${word.slice(1)}`).join('');
}

function classifyItem(item) {
  if (item.weaponContentKey) return 'weapon';
  if (item.armorContentKey || item.categoryKey === 'shield') return 'armor';
  if (item.categoryKey === 'poison' || /^(acid|alchemist's fire|holy water|rations\b|potion\b)/iu.test(item.name)) {
    return 'consumable';
  }
  if (/scroll/iu.test(item.name)) return 'scroll';
  return 'misc';
}

function itemProperties(item, type) {
  const properties = { category: item.categoryName };

  if (type === 'weapon') {
    const weapon = weapons.get(item.weaponContentKey);
    if (!weapon) throw new Error(`Missing weapon mechanics for ${item.name}`);
    const twoHanded = weapon.properties.some((property) => property.name === 'Two-Handed');
    Object.assign(properties, {
      damage: weapon.damageDice,
      damageDice: weapon.damageDice,
      damageType: weapon.damageTypeKey,
      range: weapon.range.normal > 0 ? `${weapon.range.normal}/${weapon.range.long}` : undefined,
      rangeFeet: weapon.range,
      isSimple: weapon.isSimple,
      isMartial: weapon.isMartial,
      weaponClass: weapon.isMartial ? 'martial' : 'simple',
      weaponProperties: weapon.properties.map((property) => ({
        name: property.name,
        ...(property.detail ? { detail: property.detail } : {}),
      })),
      equipSlots: twoHanded ? ['mainhand'] : ['mainhand', 'offhand'],
    });
    for (const property of weapon.properties) {
      properties[propertyKey(property.name)] = property.detail ?? true;
    }
  } else if (type === 'armor' && item.categoryKey === 'shield') {
    Object.assign(properties, { acBonus: 2, equipSlots: ['offhand'] });
  } else if (type === 'armor') {
    const armorRecord = armor.get(item.armorContentKey);
    if (!armorRecord) throw new Error(`Missing armor mechanics for ${item.name}`);
    Object.assign(properties, {
      armorCategory: armorRecord.category,
      ac: armorRecord.armorClass.base,
      baseAC: armorRecord.armorClass.base,
      addDexterityModifier: armorRecord.armorClass.addDexterityModifier,
      maxDexBonus: armorRecord.armorClass.addDexterityModifier
        ? (armorRecord.armorClass.dexterityModifierCap ?? undefined)
        : 0,
      stealthDisadvantage: armorRecord.grantsStealthDisadvantage,
      strengthRequired: armorRecord.strengthScoreRequired ?? undefined,
      equipSlots: ['armor'],
    });
  } else if (type === 'consumable') {
    Object.assign(properties, { effect: item.description });
  }

  return properties;
}

const items = readCollection('items', 'normalized')
  .filter(exactTarget)
  .map((item) => {
    const type = classifyItem(item);
    return {
      sourceKey: item.sourceKey,
      contentKey: item.contentKey,
      name: item.name,
      description: item.description,
      categoryKey: item.categoryKey,
      categoryName: item.categoryName,
      type,
      weight: item.weight,
      valueCopper: item.valueCopper,
      properties: itemProperties(item, type),
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

const runtimeCatalog = {
  schemaVersion: 1,
  provenance: {
    provider: 'Open5e',
    sourceApiVersion: manifest.sourceApiVersion,
    sourceFetchedAt: manifest.sourceFetchedAt,
    packVersion: manifest.packVersion,
    packHash: manifest.packHash,
    rulesVersion: `${manifest.packVersion}@${manifest.packHash}`,
    gamesystem: TARGET_GAMESYSTEM,
    documents: [TAXONOMY_DOCUMENT, TARGET_DOCUMENT],
    license: {
      key: 'cc-by-40',
      name: 'Creative Commons Attribution 4.0',
      url: 'https://creativecommons.org/licenses/by/4.0/',
      source: 'https://dnd.wizards.com/resources/systems-reference-document',
      attribution: 'System Reference Document 5.1 by Wizards of the Coast, via Open5e.',
    },
  },
  classes,
  species,
  backgrounds,
  skills,
  languages,
  alignments,
  items,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(runtimeCatalog, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  outputPath,
  packHash: runtimeCatalog.provenance.packHash,
  counts: {
    classes: classes.length,
    species: species.length,
    backgrounds: backgrounds.length,
    skills: skills.length,
    languages: languages.length,
    alignments: alignments.length,
    items: items.length,
  },
}, null, 2));
