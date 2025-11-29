import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/storage/migrations.js';
import { StrategyTools, handleStrategyTool } from '../../src/server/strategy-tools.js';
import { setDb } from '../../src/storage/index.js';

describe('Grand Strategy Integration', () => {
    let db: Database.Database;

    beforeEach(() => {
        db = new Database(':memory:');
        migrate(db);
        setDb(db);

        // Setup world
        db.prepare(`
            INSERT INTO worlds (id, name, seed, width, height, created_at, updated_at)
            VALUES ('world-1', 'Strategy World', 'seed', 100, 100, ?, ?)
        `).run(new Date().toISOString(), new Date().toISOString());

        // Setup regions
        db.prepare(`
            INSERT INTO regions (id, world_id, name, type, center_x, center_y, color, control_level, created_at, updated_at)
            VALUES 
            ('region-1', 'world-1', 'Northlands', 'plains', 10, 10, '#00FF00', 0, ?, ?),
            ('region-2', 'world-1', 'Southlands', 'desert', 90, 90, '#FF0000', 0, ?, ?)
        `).run(new Date().toISOString(), new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
    });

    it('runs a full game loop', async () => {
        // 1. Create Nations
        const nation1Res = await handleStrategyTool(StrategyTools.CREATE_NATION.name, {
            worldId: 'world-1',
            name: 'Empire of A',
            leader: 'Emperor A',
            ideology: 'autocracy',
            aggression: 80,
            trust: 20,
            paranoia: 60
        });
        const nation1 = JSON.parse(nation1Res.content[0].text);

        const nation2Res = await handleStrategyTool(StrategyTools.CREATE_NATION.name, {
            worldId: 'world-1',
            name: 'Republic of B',
            leader: 'President B',
            ideology: 'democracy',
            aggression: 20,
            trust: 80,
            paranoia: 30
        });
        const nation2 = JSON.parse(nation2Res.content[0].text);

        // 2. Claim Regions
        await handleStrategyTool(StrategyTools.CLAIM_REGION.name, {
            nationId: nation1.id,
            regionId: 'region-1',
            justification: 'Ancestral lands'
        });

        await handleStrategyTool(StrategyTools.CLAIM_REGION.name, {
            nationId: nation2.id,
            regionId: 'region-2',
            justification: 'Settlement'
        });

        // 3. Propose Alliance
        await handleStrategyTool(StrategyTools.PROPOSE_ALLIANCE.name, {
            fromNationId: nation2.id,
            toNationId: nation1.id
        });

        // 4. Resolve Turn 1 (Establishment)
        const turn1Res = await handleStrategyTool(StrategyTools.RESOLVE_TURN.name, {
            worldId: 'world-1',
            turnNumber: 1
        });
        const turn1Events = JSON.parse(turn1Res.content[0].text).events;
        console.log('Turn 1 Events:', JSON.stringify(turn1Events, null, 2));
        expect(turn1Events.length).toBeGreaterThan(0); // Should have claim events

        // 5. Verify World State (Fog of War)
        // Nation 1 viewing
        const view1Res = await handleStrategyTool(StrategyTools.GET_WORLD_STATE.name, {
            worldId: 'world-1',
            viewerNationId: nation1.id
        });
        const view1 = JSON.parse(view1Res.content[0].text);

        // Should see own region
        expect(view1.regions.find((r: any) => r.id === 'region-1')).toBeDefined();

        // 6. Conflict (Nation 1 claims Nation 2's region)
        await handleStrategyTool(StrategyTools.CLAIM_REGION.name, {
            nationId: nation1.id,
            regionId: 'region-2',
            justification: 'Expansion'
        });

        // 7. Resolve Turn 2 (Conflict)
        const turn2Res = await handleStrategyTool(StrategyTools.RESOLVE_TURN.name, {
            worldId: 'world-1',
            turnNumber: 2
        });
        const turn2Events = JSON.parse(turn2Res.content[0].text).events;
        console.log('Turn 2 Events:', JSON.stringify(turn2Events, null, 2));

        // Should see conflict log
        const conflictEvent = turn2Events.find((e: any) => e.eventType === 'REGION_CONQUERED' || e.eventType === 'REGION_CLAIMED');
        expect(conflictEvent).toBeDefined();
    });
});
