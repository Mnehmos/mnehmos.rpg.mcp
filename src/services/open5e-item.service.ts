import { Item } from '../schema/inventory.js';
import { ItemRepository } from '../storage/repos/item.repo.js';
import {
    findOpen5eItem,
    getOpen5eCatalogProvenance,
    Open5eItem,
} from '../content/open5e-catalog.js';

export interface MaterializedOpen5eItem {
    item: Item;
    created: boolean;
    sourceItem: Open5eItem;
}
export function open5eItemId(sourceKey: string): string {
    return `open5e-srd-2014-${sourceKey.replace(/[^a-z0-9_-]+/giu, '-')}`;
}

export function toEngineItem(sourceItem: Open5eItem, timestamp = new Date().toISOString()): Item {
    const provenance = getOpen5eCatalogProvenance();
    return {
        id: open5eItemId(sourceItem.sourceKey),
        name: sourceItem.name,
        description: sourceItem.description,
        type: sourceItem.type,
        weight: sourceItem.weight,
        value: sourceItem.valueCopper / 100,
        properties: {
            ...sourceItem.properties,
            open5e: {
                provider: provenance.provider,
                packHash: provenance.packHash,
                rulesVersion: provenance.rulesVersion,
                gamesystem: provenance.gamesystem,
                documentKey: 'srd-2014',
                sourceKey: sourceItem.sourceKey,
                contentKey: sourceItem.contentKey,
                license: provenance.license.key,
            },
        },
        createdAt: timestamp,
        updatedAt: timestamp,
    };
}

export function materializeOpen5eItem(itemRepo: ItemRepository, value: string): MaterializedOpen5eItem {
    const sourceItem = findOpen5eItem(value);
    if (!sourceItem) throw new Error(`Open5e SRD item not found: ${value}`);

    const desired = toEngineItem(sourceItem);
    const existing = itemRepo.findById(desired.id);
    if (!existing) {
        itemRepo.create(desired);
        return { item: desired, created: true, sourceItem };
    }

    const item = itemRepo.update(existing.id, {
        name: desired.name,
        description: desired.description,
        type: desired.type,
        weight: desired.weight,
        value: desired.value,
        properties: desired.properties,
        updatedAt: desired.updatedAt,
    });
    if (!item) throw new Error(`Failed to refresh Open5e SRD item: ${value}`);
    return { item, created: false, sourceItem };
}
