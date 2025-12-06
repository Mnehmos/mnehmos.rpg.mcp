/**
 * Combat Visualization Tests
 * Tests for render_map and calculate_aoe tools
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { CombatEngine, CombatState, CombatParticipant } from '../../src/engine/combat/engine.js';
import { SpatialEngine } from '../../src/engine/spatial/engine.js';

describe('Combat Visualization', () => {
    let engine: CombatEngine;
    let state: CombatState;

    beforeEach(() => {
        engine = new CombatEngine('test-viz-seed');
        
        const participants: CombatParticipant[] = [
            {
                id: 'hero-1',
                name: 'Valeros',
                initiativeBonus: 2,
                hp: 20,
                maxHp: 20,
                conditions: [],
                position: { x: 5, y: 5 },
                isEnemy: false
            },
            {
                id: 'goblin-1',
                name: 'Goblin',
                initiativeBonus: 1,
                hp: 7,
                maxHp: 7,
                conditions: [],
                position: { x: 10, y: 5 },
                isEnemy: true
            },
            {
                id: 'goblin-2',
                name: 'Goblin Archer',
                initiativeBonus: 1,
                hp: 7,
                maxHp: 7,
                conditions: [],
                position: { x: 12, y: 7 },
                isEnemy: true
            }
        ];
        
        state = engine.startEncounter(participants);
        
        // Add terrain
        (state as any).terrain = {
            obstacles: ['7,5', '7,6', '7,7'],  // Wall
            difficultTerrain: ['8,5', '9,5']   // Rough ground
        };
    });

    describe('buildStateJson spatial data', () => {
        it('should include position in participant data', () => {
            const hero = state.participants.find(p => p.id === 'hero-1');
            expect(hero?.position).toEqual({ x: 5, y: 5 });
        });

        it('should include terrain in state', () => {
            expect((state as any).terrain.obstacles).toContain('7,5');
            expect((state as any).terrain.difficultTerrain).toContain('8,5');
        });
    });

    describe('SpatialEngine AoE calculations', () => {
        let spatial: SpatialEngine;

        beforeEach(() => {
            spatial = new SpatialEngine();
        });

        it('should calculate circle AoE (Fireball)', () => {
            const tiles = spatial.getCircleTiles({ x: 10, y: 5 }, 4);
            
            // Should include the center and surrounding tiles
            expect(tiles.some(t => t.x === 10 && t.y === 5)).toBe(true);
            expect(tiles.some(t => t.x === 12 && t.y === 7)).toBe(true);  // Goblin Archer
            expect(tiles.length).toBeGreaterThan(40);  // ~50 tiles in a radius 4 circle
        });

        it('should calculate cone AoE (Burning Hands)', () => {
            const tiles = spatial.getConeTiles(
                { x: 5, y: 5 },      // origin
                { x: 1, y: 0 },      // direction (East)
                3,                   // length
                90                   // angle
            );
            
            expect(tiles.length).toBeGreaterThan(0);
            expect(tiles.some(t => t.x === 5 && t.y === 5)).toBe(true);  // Origin included
        });

        it('should calculate line AoE (Lightning Bolt)', () => {
            const tiles = spatial.getLineTiles(
                { x: 0, y: 5 },
                { x: 15, y: 5 }
            );
            
            expect(tiles.length).toBe(16);  // 0 to 15 inclusive
            expect(tiles.every(t => t.y === 5)).toBe(true);  // All on same y
        });
    });

    describe('Affected participants detection', () => {
        it('should find participants in circle AoE', () => {
            const spatial = new SpatialEngine();
            const tiles = spatial.getCircleTiles({ x: 11, y: 6 }, 3);
            
            const tileSet = new Set(tiles.map(t => `${t.x},${t.y}`));
            const affected = state.participants
                .filter(p => p.position && tileSet.has(`${p.position.x},${p.position.y}`))
                .map(p => p.name);
            
            expect(affected).toContain('Goblin');
            expect(affected).toContain('Goblin Archer');
            expect(affected).not.toContain('Valeros');
        });
    });
});
