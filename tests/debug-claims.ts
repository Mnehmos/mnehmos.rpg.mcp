import Database from 'better-sqlite3';
import { migrate } from '../src/storage/migrations.js';
import { DiplomacyRepository } from '../src/storage/repos/diplomacy.repo.js';
import { RegionRepository } from '../src/storage/repos/region.repo.js';
import { NationRepository } from '../src/storage/repos/nation.repo.js';
import { TurnProcessor } from '../src/engine/strategy/turn-processor.js';
import { ConflictResolver } from '../src/engine/strategy/conflict-resolver.js';

const db = new Database(':memory:');
migrate(db);

// Setup
db.prepare(`
    INSERT INTO worlds (id, name, seed, width, height, created_at, updated_at)
    VALUES ('world-1', 'Test World', 'seed', 100, 100, ?, ?)
`).run(new Date().toISOString(), new Date().toISOString());

db.prepare(`
    INSERT INTO regions (id, world_id, name, type, center_x, center_y, color, control_level, created_at, updated_at)
    VALUES ('region-1', 'world-1', 'Northlands', 'plains', 10, 10, '#00FF00', 0, ?, ?)
`).run(new Date().toISOString(), new Date().toISOString());

const nationRepo = new NationRepository(db);
const regionRepo = new RegionRepository(db);
const diplomacyRepo = new DiplomacyRepository(db);
const conflictResolver = new ConflictResolver();
const turnProcessor = new TurnProcessor(nationRepo, regionRepo, diplomacyRepo, conflictResolver);

// Create Nation
nationRepo.create({
    id: 'nation-1',
    worldId: 'world-1',
    name: 'Nation 1',
    leader: 'Leader 1',
    ideology: 'democracy',
    aggression: 50,
    trust: 50,
    paranoia: 50,
    gdp: 1000,
    resources: { food: 100, metal: 100, oil: 100 },
    relations: {},
    privateMemory: {},
    publicIntent: 'Peace',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
});

// Create Claim
diplomacyRepo.createClaim({
    id: 'claim-1',
    nationId: 'nation-1',
    regionId: 'region-1',
    claimStrength: 100,
    justification: 'Mine',
    createdAt: new Date().toISOString()
});

// Verify Claim Exists
const claims = diplomacyRepo.getClaimsByRegion('region-1');
console.log('Claims found:', claims.length);

// Run Turn Processor
turnProcessor.processTurn('world-1', 1);

// Verify Ownership
const region = regionRepo.findById('region-1');
console.log('Region Owner:', region?.ownerNationId);
