import Database from 'better-sqlite3';

export function migrate(db: Database.Database) {
  // First, create all tables (without indexes that depend on new columns)
  db.exec(`
    CREATE TABLE IF NOT EXISTS worlds(
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    seed TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

    CREATE TABLE IF NOT EXISTS regions(
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    center_x INTEGER NOT NULL,
    center_y INTEGER NOT NULL,
    color TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
  );

    CREATE TABLE IF NOT EXISTS tiles(
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    biome TEXT NOT NULL,
    elevation INTEGER NOT NULL,
    moisture INTEGER NOT NULL,
    temperature INTEGER NOT NULL,
    FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE,
    UNIQUE(world_id, x, y)
  );

    CREATE TABLE IF NOT EXISTS structures(
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL,
    region_id TEXT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    population INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    metadata TEXT,
    FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
  );

    CREATE TABLE IF NOT EXISTS rivers(
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL,
    name TEXT NOT NULL,
    path TEXT NOT NULL, --JSON array of coordinates
      width INTEGER NOT NULL,
    source_elevation INTEGER NOT NULL,
    mouth_elevation INTEGER NOT NULL,
    FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
  );

    CREATE TABLE IF NOT EXISTS characters(
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    stats TEXT NOT NULL, --JSON
      hp INTEGER NOT NULL,
    max_hp INTEGER NOT NULL,
    ac INTEGER NOT NULL,
    level INTEGER NOT NULL,
    faction_id TEXT,
    behavior TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

    CREATE TABLE IF NOT EXISTS encounters(
    id TEXT PRIMARY KEY,
    region_id TEXT,
    tokens TEXT NOT NULL, --JSON
      round INTEGER NOT NULL,
    active_token_id TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(region_id) REFERENCES regions(id) ON DELETE CASCADE
  );

    CREATE TABLE IF NOT EXISTS patches(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    op TEXT NOT NULL,
    path TEXT NOT NULL,
    value TEXT, --JSON
      timestamp TEXT NOT NULL
  );

    CREATE TABLE IF NOT EXISTS battlefield(
    id TEXT PRIMARY KEY,
    encounter_id TEXT NOT NULL,
    grid_data TEXT NOT NULL, --JSON
      created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(encounter_id) REFERENCES encounters(id) ON DELETE CASCADE
  );

    CREATE TABLE IF NOT EXISTS audit_logs(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    actor_id TEXT,
    target_id TEXT,
    details TEXT, --JSON
      timestamp TEXT NOT NULL
  );

    CREATE TABLE IF NOT EXISTS event_logs(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    payload TEXT NOT NULL, --JSON
      timestamp TEXT NOT NULL
  );

    CREATE TABLE IF NOT EXISTS items(
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL,
    weight REAL NOT NULL DEFAULT 0,
    value INTEGER NOT NULL DEFAULT 0,
    properties TEXT, --JSON
      created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

    CREATE TABLE IF NOT EXISTS inventory_items(
    character_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    equipped INTEGER NOT NULL DEFAULT 0, --boolean 0 / 1
      slot TEXT,
    PRIMARY KEY(character_id, item_id),
    FOREIGN KEY(character_id) REFERENCES characters(id) ON DELETE CASCADE,
    FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE
  );

    CREATE TABLE IF NOT EXISTS quests(
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL,
    objectives TEXT NOT NULL, --JSON
      rewards TEXT NOT NULL, --JSON
      prerequisites TEXT NOT NULL, --JSON
      giver TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
  );

    CREATE TABLE IF NOT EXISTS quest_logs(
    character_id TEXT PRIMARY KEY,
    active_quests TEXT NOT NULL, --JSON array of IDs
      completed_quests TEXT NOT NULL, --JSON array of IDs
      failed_quests TEXT NOT NULL, --JSON array of IDs
      FOREIGN KEY(character_id) REFERENCES characters(id) ON DELETE CASCADE
  );

    CREATE TABLE IF NOT EXISTS calculations(
    id TEXT PRIMARY KEY,
    session_id TEXT,
    input TEXT NOT NULL,
    result TEXT NOT NULL, --JSON or string
      steps TEXT, --JSON array
      seed TEXT,
    timestamp TEXT NOT NULL,
    metadata TEXT-- JSON
  );

  CREATE TABLE IF NOT EXISTS turn_state(
    world_id TEXT PRIMARY KEY,
    current_turn INTEGER NOT NULL DEFAULT 1,
    turn_phase TEXT NOT NULL DEFAULT 'planning',
    phase_started_at TEXT NOT NULL,
    nations_ready TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS nations(
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL,
    name TEXT NOT NULL,
    leader TEXT NOT NULL,
    ideology TEXT NOT NULL,
    aggression INTEGER NOT NULL DEFAULT 50,
    trust INTEGER NOT NULL DEFAULT 50,
    paranoia INTEGER NOT NULL DEFAULT 50,
    gdp REAL NOT NULL DEFAULT 1000,
    resources TEXT NOT NULL DEFAULT '{"food":0,"metal":0,"oil":0}', --JSON
    relations TEXT NOT NULL DEFAULT '{}', --JSON
    private_memory TEXT, --JSON
    public_intent TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_nations_world ON nations(world_id);

  CREATE TABLE IF NOT EXISTS diplomatic_relations(
    from_nation_id TEXT NOT NULL,
    to_nation_id TEXT NOT NULL,
    opinion INTEGER NOT NULL DEFAULT 0,
    is_allied INTEGER NOT NULL DEFAULT 0,
    truce_until INTEGER,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(from_nation_id, to_nation_id),
    FOREIGN KEY(from_nation_id) REFERENCES nations(id) ON DELETE CASCADE,
    FOREIGN KEY(to_nation_id) REFERENCES nations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS territorial_claims(
    id TEXT PRIMARY KEY,
    nation_id TEXT NOT NULL,
    region_id TEXT NOT NULL,
    claim_strength INTEGER NOT NULL DEFAULT 50,
    justification TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(nation_id) REFERENCES nations(id) ON DELETE CASCADE,
    FOREIGN KEY(region_id) REFERENCES regions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_territorial_claims_nation ON territorial_claims(nation_id);
  CREATE INDEX IF NOT EXISTS idx_territorial_claims_region ON territorial_claims(region_id);

  CREATE TABLE IF NOT EXISTS nation_events(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_id TEXT NOT NULL,
    turn_number INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    involved_nations TEXT NOT NULL, --JSON array
    details TEXT NOT NULL, --JSON
    timestamp TEXT NOT NULL,
    FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_nation_events_world ON nation_events(world_id);
  CREATE INDEX IF NOT EXISTS idx_nation_events_turn ON nation_events(world_id, turn_number);

  CREATE TABLE IF NOT EXISTS secrets(
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL,
    type TEXT NOT NULL,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    public_description TEXT NOT NULL,
    secret_description TEXT NOT NULL,
    linked_entity_id TEXT,
    linked_entity_type TEXT,
    revealed INTEGER NOT NULL DEFAULT 0,
    revealed_at TEXT,
    revealed_by TEXT,
    reveal_conditions TEXT NOT NULL DEFAULT '[]', --JSON array of conditions
    sensitivity TEXT NOT NULL DEFAULT 'medium',
    leak_patterns TEXT NOT NULL DEFAULT '[]', --JSON array of keywords to avoid
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_secrets_world ON secrets(world_id);
  CREATE INDEX IF NOT EXISTS idx_secrets_revealed ON secrets(revealed);
  CREATE INDEX IF NOT EXISTS idx_secrets_linked ON secrets(linked_entity_id, linked_entity_type);

  -- Party management tables
  CREATE TABLE IF NOT EXISTS parties(
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    world_id TEXT REFERENCES worlds(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dormant', 'archived')),
    current_location TEXT,
    current_quest_id TEXT REFERENCES quests(id) ON DELETE SET NULL,
    formation TEXT NOT NULL DEFAULT 'standard',
    position_x INTEGER,
    position_y INTEGER,
    current_poi TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_played_at TEXT
  );

  CREATE TABLE IF NOT EXISTS party_members(
    id TEXT PRIMARY KEY,
    party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('leader', 'member', 'companion', 'hireling', 'prisoner', 'mount')),
    is_active INTEGER NOT NULL DEFAULT 0,
    position INTEGER,
    share_percentage INTEGER NOT NULL DEFAULT 100,
    joined_at TEXT NOT NULL,
    notes TEXT,
    UNIQUE(party_id, character_id)
  );

  CREATE INDEX IF NOT EXISTS idx_party_members_party ON party_members(party_id);
  CREATE INDEX IF NOT EXISTS idx_party_members_character ON party_members(character_id);
  CREATE INDEX IF NOT EXISTS idx_parties_status ON parties(status);
  CREATE INDEX IF NOT EXISTS idx_parties_world ON parties(world_id);
  -- idx_parties_position moved to createPostMigrationIndexes (depends on position_x column)

  -- HIGH-004: NPC Memory System
  CREATE TABLE IF NOT EXISTS npc_relationships(
    character_id TEXT NOT NULL,
    npc_id TEXT NOT NULL,
    familiarity TEXT NOT NULL DEFAULT 'stranger' CHECK (familiarity IN ('stranger', 'acquaintance', 'friend', 'close_friend', 'rival', 'enemy')),
    disposition TEXT NOT NULL DEFAULT 'neutral' CHECK (disposition IN ('hostile', 'unfriendly', 'neutral', 'friendly', 'helpful')),
    notes TEXT,
    first_met_at TEXT NOT NULL,
    last_interaction_at TEXT NOT NULL,
    interaction_count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY(character_id, npc_id)
  );

  CREATE TABLE IF NOT EXISTS conversation_memories(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id TEXT NOT NULL,
    npc_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    importance TEXT NOT NULL DEFAULT 'medium' CHECK (importance IN ('low', 'medium', 'high', 'critical')),
    topics TEXT NOT NULL DEFAULT '[]', --JSON array of topic keywords
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_npc_relationships_char ON npc_relationships(character_id);
  CREATE INDEX IF NOT EXISTS idx_npc_relationships_npc ON npc_relationships(npc_id);
  CREATE INDEX IF NOT EXISTS idx_conversation_memories_char_npc ON conversation_memories(character_id, npc_id);
  CREATE INDEX IF NOT EXISTS idx_conversation_memories_importance ON conversation_memories(importance);

  -- HIGH-008: Stolen Items System
  CREATE TABLE IF NOT EXISTS stolen_items(
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL,
    stolen_from TEXT NOT NULL,
    stolen_by TEXT NOT NULL,
    stolen_at TEXT NOT NULL,
    stolen_location TEXT,

    heat_level TEXT NOT NULL DEFAULT 'burning' CHECK (heat_level IN ('burning', 'hot', 'warm', 'cool', 'cold')),
    heat_updated_at TEXT NOT NULL,

    reported_to_guards INTEGER NOT NULL DEFAULT 0,
    bounty INTEGER NOT NULL DEFAULT 0,
    witnesses TEXT NOT NULL DEFAULT '[]',

    recovered INTEGER NOT NULL DEFAULT 0,
    recovered_at TEXT,
    fenced INTEGER NOT NULL DEFAULT 0,
    fenced_at TEXT,
    fenced_to TEXT,

    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE,
    FOREIGN KEY(stolen_from) REFERENCES characters(id),
    FOREIGN KEY(stolen_by) REFERENCES characters(id)
  );

  CREATE INDEX IF NOT EXISTS idx_stolen_items_item ON stolen_items(item_id);
  CREATE INDEX IF NOT EXISTS idx_stolen_items_thief ON stolen_items(stolen_by);
  CREATE INDEX IF NOT EXISTS idx_stolen_items_victim ON stolen_items(stolen_from);
  CREATE INDEX IF NOT EXISTS idx_stolen_items_heat ON stolen_items(heat_level);

  CREATE TABLE IF NOT EXISTS fence_npcs(
    npc_id TEXT PRIMARY KEY,
    faction_id TEXT,
    buy_rate REAL NOT NULL DEFAULT 0.4,
    max_heat_level TEXT NOT NULL DEFAULT 'hot',
    daily_heat_capacity INTEGER NOT NULL DEFAULT 100,
    current_daily_heat INTEGER NOT NULL DEFAULT 0,
    last_reset_at TEXT NOT NULL,
    specializations TEXT NOT NULL DEFAULT '[]',
    cooldown_days INTEGER NOT NULL DEFAULT 7,
    reputation INTEGER NOT NULL DEFAULT 50,
    FOREIGN KEY(npc_id) REFERENCES characters(id) ON DELETE CASCADE
  );

  -- FAILED-004: Corpse/Loot System
  CREATE TABLE IF NOT EXISTS corpses(
    id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    character_name TEXT NOT NULL,
    character_type TEXT NOT NULL,
    creature_type TEXT,
    cr REAL,

    world_id TEXT,
    region_id TEXT,
    position_x INTEGER,
    position_y INTEGER,
    encounter_id TEXT,

    state TEXT NOT NULL DEFAULT 'fresh' CHECK (state IN ('fresh', 'decaying', 'skeletal', 'gone')),
    state_updated_at TEXT NOT NULL,

    loot_generated INTEGER NOT NULL DEFAULT 0,
    looted INTEGER NOT NULL DEFAULT 0,
    looted_by TEXT,
    looted_at TEXT,

    harvestable INTEGER NOT NULL DEFAULT 0,
    harvestable_resources TEXT NOT NULL DEFAULT '[]',

    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_corpses_encounter ON corpses(encounter_id);
  CREATE INDEX IF NOT EXISTS idx_corpses_world_position ON corpses(world_id, position_x, position_y);
  CREATE INDEX IF NOT EXISTS idx_corpses_state ON corpses(state);
  CREATE INDEX IF NOT EXISTS idx_corpses_character ON corpses(character_id);

  CREATE TABLE IF NOT EXISTS corpse_inventory(
    corpse_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    looted INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(corpse_id, item_id),
    FOREIGN KEY(corpse_id) REFERENCES corpses(id) ON DELETE CASCADE,
    FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS loot_tables(
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    creature_types TEXT NOT NULL DEFAULT '[]',
    cr_min REAL,
    cr_max REAL,
    guaranteed_drops TEXT NOT NULL DEFAULT '[]',
    random_drops TEXT NOT NULL DEFAULT '[]',
    currency_range TEXT,
    harvestable_resources TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_loot_tables_name ON loot_tables(name);

  -- IMPROVISATION SYSTEMS: Custom Effects Table
  -- Tracks divine boons, curses, transformations, and player-invented conditions
  CREATE TABLE IF NOT EXISTS custom_effects(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_id TEXT NOT NULL,
    target_type TEXT NOT NULL CHECK (target_type IN ('character', 'npc')),
    name TEXT NOT NULL,
    description TEXT,
    source_type TEXT NOT NULL CHECK (source_type IN ('divine', 'arcane', 'natural', 'cursed', 'psionic', 'unknown')),
    source_entity_id TEXT,
    source_entity_name TEXT,
    category TEXT NOT NULL CHECK (category IN ('boon', 'curse', 'neutral', 'transformative')),
    power_level INTEGER NOT NULL CHECK (power_level BETWEEN 1 AND 5),
    mechanics TEXT NOT NULL DEFAULT '[]', -- JSON array of mechanic objects
    duration_type TEXT NOT NULL CHECK (duration_type IN ('rounds', 'minutes', 'hours', 'days', 'permanent', 'until_removed')),
    duration_value INTEGER,
    rounds_remaining INTEGER,
    triggers TEXT NOT NULL DEFAULT '[]', -- JSON array of trigger objects
    removal_conditions TEXT NOT NULL DEFAULT '[]', -- JSON array of removal condition objects
    stackable INTEGER NOT NULL DEFAULT 0, -- boolean
    max_stacks INTEGER NOT NULL DEFAULT 1,
    current_stacks INTEGER NOT NULL DEFAULT 1,
    is_active INTEGER NOT NULL DEFAULT 1, -- boolean
    created_at TEXT NOT NULL,
    expires_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_custom_effects_target ON custom_effects(target_id, target_type);
  CREATE INDEX IF NOT EXISTS idx_custom_effects_active ON custom_effects(is_active);
  CREATE INDEX IF NOT EXISTS idx_custom_effects_name ON custom_effects(name);

  -- IMPROVISATION SYSTEMS: Synthesized Spells Table
  -- Tracks spells permanently learned through Arcane Synthesis mastery
  CREATE TABLE IF NOT EXISTS synthesized_spells(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id TEXT NOT NULL,
    name TEXT NOT NULL,
    level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 9),
    school TEXT NOT NULL,
    effect_type TEXT NOT NULL,
    effect_dice TEXT,
    damage_type TEXT,
    targeting_type TEXT NOT NULL,
    targeting_range INTEGER NOT NULL,
    targeting_area_size INTEGER,
    targeting_max_targets INTEGER,
    saving_throw_ability TEXT,
    saving_throw_effect TEXT,
    components_verbal INTEGER NOT NULL DEFAULT 1,
    components_somatic INTEGER NOT NULL DEFAULT 1,
    components_material TEXT, -- JSON object or null
    concentration INTEGER NOT NULL DEFAULT 0,
    duration TEXT NOT NULL,
    synthesis_dc INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    mastered_at TEXT NOT NULL,
    times_cast INTEGER NOT NULL DEFAULT 0,
    UNIQUE(character_id, name)
  );

  CREATE INDEX IF NOT EXISTS idx_synthesized_spells_character ON synthesized_spells(character_id);
  CREATE INDEX IF NOT EXISTS idx_synthesized_spells_school ON synthesized_spells(school);

  -- PHASE-1: Spatial Graph System - Room Nodes
  CREATE TABLE IF NOT EXISTS room_nodes(
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK(length(trim(name)) > 0 AND length(name) <= 100),
    base_description TEXT NOT NULL CHECK(length(trim(base_description)) >= 10 AND length(base_description) <= 2000),
    biome_context TEXT NOT NULL CHECK(biome_context IN (
      'forest', 'mountain', 'urban', 'dungeon', 'coastal', 'cavern', 'divine', 'arcane'
    )),
    atmospherics TEXT NOT NULL DEFAULT '[]', -- JSON array of atmospheric effects
    exits TEXT NOT NULL DEFAULT '[]', -- JSON array of exit objects {direction, targetNodeId, type, dc?, description?}
    entity_ids TEXT NOT NULL DEFAULT '[]', -- JSON array of UUID strings
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    visited_count INTEGER NOT NULL DEFAULT 0,
    last_visited_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_room_nodes_biome ON room_nodes(biome_context);
  CREATE INDEX IF NOT EXISTS idx_room_nodes_visited ON room_nodes(last_visited_at DESC);

  -- Concentration System - tracks active concentration spells
  CREATE TABLE IF NOT EXISTS concentration(
    character_id TEXT PRIMARY KEY,
    active_spell TEXT NOT NULL,
    spell_level INTEGER NOT NULL CHECK (spell_level BETWEEN 0 AND 9),
    target_ids TEXT, -- JSON array of target IDs
    started_at INTEGER NOT NULL, -- Round number
    max_duration INTEGER, -- Maximum rounds (null = indefinite)
    save_dc_base INTEGER NOT NULL DEFAULT 10, -- Base DC for concentration saves
    FOREIGN KEY(character_id) REFERENCES characters(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_concentration_character ON concentration(character_id);

  -- Aura System - tracks active area-effect auras centered on characters
  CREATE TABLE IF NOT EXISTS auras(
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    spell_name TEXT NOT NULL,
    spell_level INTEGER NOT NULL CHECK (spell_level BETWEEN 0 AND 9),
    radius INTEGER NOT NULL CHECK (radius > 0), -- Radius in feet
    affects_allies INTEGER NOT NULL DEFAULT 0, -- boolean
    affects_enemies INTEGER NOT NULL DEFAULT 0, -- boolean
    affects_self INTEGER NOT NULL DEFAULT 0, -- boolean
    effects TEXT NOT NULL, -- JSON array of AuraEffect objects
    started_at INTEGER NOT NULL, -- Round number
    max_duration INTEGER, -- Maximum rounds (null = indefinite)
    requires_concentration INTEGER NOT NULL DEFAULT 0, -- boolean
    FOREIGN KEY(owner_id) REFERENCES characters(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_auras_owner ON auras(owner_id);
  `);

  // Run migrations for existing databases that don't have the new columns
  // This MUST happen before creating indexes on new columns
  runMigrations(db);

  // Now create indexes that depend on migrated columns
  createPostMigrationIndexes(db);
}

function runMigrations(db: Database.Database) {
  // Check if character_type column exists and add it if missing
  const charColumns = db.prepare("PRAGMA table_info(characters)").all() as { name: string }[];
  const hasCharacterType = charColumns.some(col => col.name === 'character_type');

  if (!hasCharacterType) {
    console.error('[Migration] Adding character_type column to characters table');
    db.exec(`ALTER TABLE characters ADD COLUMN character_type TEXT DEFAULT 'pc';`);
  }

  // Check if regions table has owner_nation_id and control_level columns
  const regionColumns = db.prepare("PRAGMA table_info(regions)").all() as { name: string }[];
  const hasOwnerNationId = regionColumns.some(col => col.name === 'owner_nation_id');
  const hasControlLevel = regionColumns.some(col => col.name === 'control_level');

  if (!hasOwnerNationId) {
    console.error('[Migration] Adding owner_nation_id column to regions table');
    db.exec(`ALTER TABLE regions ADD COLUMN owner_nation_id TEXT REFERENCES nations(id) ON DELETE SET NULL;`);
  }

  if (!hasControlLevel) {
    console.error('[Migration] Adding control_level column to regions table');
    db.exec(`ALTER TABLE regions ADD COLUMN control_level INTEGER NOT NULL DEFAULT 0;`);
  }

  // Check if party position columns exist and add them if missing
  const partyColumns = db.prepare("PRAGMA table_info(parties)").all() as { name: string }[];
  const hasPositionX = partyColumns.some(col => col.name === 'position_x');
  const hasPositionY = partyColumns.some(col => col.name === 'position_y');
  const hasCurrentPOI = partyColumns.some(col => col.name === 'current_poi');
  
  if (!hasPositionX) {
    console.error('[Migration] Adding position_x column to parties table');
    db.exec(`ALTER TABLE parties ADD COLUMN position_x INTEGER;`);
  }
  
  if (!hasPositionY) {
    console.error('[Migration] Adding position_y column to parties table');
    db.exec(`ALTER TABLE parties ADD COLUMN position_y INTEGER;`);
  }
  
  if (!hasCurrentPOI) {
    console.error('[Migration] Adding current_poi column to parties table');
    db.exec(`ALTER TABLE parties ADD COLUMN current_poi TEXT;`);
  }

  // Set safe default positions for existing parties (map center)
  db.exec(`
    UPDATE parties
    SET position_x = 50, position_y = 50
    WHERE position_x IS NULL;
  `);

  // CRIT-002/006: Add spellcasting columns to characters table
  const hasCharacterClass = charColumns.some(col => col.name === 'character_class');
  const hasSpellSlots = charColumns.some(col => col.name === 'spell_slots');
  const hasPactMagicSlots = charColumns.some(col => col.name === 'pact_magic_slots');
  const hasKnownSpells = charColumns.some(col => col.name === 'known_spells');
  const hasPreparedSpells = charColumns.some(col => col.name === 'prepared_spells');
  const hasCantripsKnown = charColumns.some(col => col.name === 'cantrips_known');
  const hasMaxSpellLevel = charColumns.some(col => col.name === 'max_spell_level');
  const hasConcentratingOn = charColumns.some(col => col.name === 'concentrating_on');
  const hasConditions = charColumns.some(col => col.name === 'conditions');

  if (!hasCharacterClass) {
    console.error('[Migration] Adding character_class column to characters table');
    db.exec(`ALTER TABLE characters ADD COLUMN character_class TEXT DEFAULT 'fighter';`);
  }
  if (!hasSpellSlots) {
    console.error('[Migration] Adding spell_slots column to characters table');
    db.exec(`ALTER TABLE characters ADD COLUMN spell_slots TEXT;`);
  }
  if (!hasPactMagicSlots) {
    console.error('[Migration] Adding pact_magic_slots column to characters table');
    db.exec(`ALTER TABLE characters ADD COLUMN pact_magic_slots TEXT;`);
  }
  if (!hasKnownSpells) {
    console.error('[Migration] Adding known_spells column to characters table');
    db.exec(`ALTER TABLE characters ADD COLUMN known_spells TEXT DEFAULT '[]';`);
  }
  if (!hasPreparedSpells) {
    console.error('[Migration] Adding prepared_spells column to characters table');
    db.exec(`ALTER TABLE characters ADD COLUMN prepared_spells TEXT DEFAULT '[]';`);
  }
  if (!hasCantripsKnown) {
    console.error('[Migration] Adding cantrips_known column to characters table');
    db.exec(`ALTER TABLE characters ADD COLUMN cantrips_known TEXT DEFAULT '[]';`);
  }
  if (!hasMaxSpellLevel) {
    console.error('[Migration] Adding max_spell_level column to characters table');
    db.exec(`ALTER TABLE characters ADD COLUMN max_spell_level INTEGER DEFAULT 0;`);
  }
  if (!hasConcentratingOn) {
    console.error('[Migration] Adding concentrating_on column to characters table');
    db.exec(`ALTER TABLE characters ADD COLUMN concentrating_on TEXT;`);
  }
  if (!hasConditions) {
    console.error('[Migration] Adding conditions column to characters table');
    db.exec(`ALTER TABLE characters ADD COLUMN conditions TEXT DEFAULT '[]';`);
  }

  // HIGH-007: Add legendary creature columns to characters table
  const hasLegendaryActions = charColumns.some(col => col.name === 'legendary_actions');
  const hasLegendaryActionsRemaining = charColumns.some(col => col.name === 'legendary_actions_remaining');
  const hasLegendaryResistances = charColumns.some(col => col.name === 'legendary_resistances');
  const hasLegendaryResistancesRemaining = charColumns.some(col => col.name === 'legendary_resistances_remaining');
  const hasLairActions = charColumns.some(col => col.name === 'has_lair_actions');
  const hasResistances = charColumns.some(col => col.name === 'resistances');
  const hasVulnerabilities = charColumns.some(col => col.name === 'vulnerabilities');
  const hasImmunities = charColumns.some(col => col.name === 'immunities');

  if (!hasLegendaryActions) {
    console.error('[Migration] Adding legendary_actions column to characters table');
    db.exec(`ALTER TABLE characters ADD COLUMN legendary_actions INTEGER;`);
  }
  if (!hasLegendaryActionsRemaining) {
    console.error('[Migration] Adding legendary_actions_remaining column to characters table');
    db.exec(`ALTER TABLE characters ADD COLUMN legendary_actions_remaining INTEGER;`);
  }
  if (!hasLegendaryResistances) {
    console.error('[Migration] Adding legendary_resistances column to characters table');
    db.exec(`ALTER TABLE characters ADD COLUMN legendary_resistances INTEGER;`);
  }
  if (!hasLegendaryResistancesRemaining) {
    console.error('[Migration] Adding legendary_resistances_remaining column to characters table');
    db.exec(`ALTER TABLE characters ADD COLUMN legendary_resistances_remaining INTEGER;`);
  }
  if (!hasLairActions) {
    console.error('[Migration] Adding has_lair_actions column to characters table');
    db.exec(`ALTER TABLE characters ADD COLUMN has_lair_actions INTEGER DEFAULT 0;`);
  }
  if (!hasResistances) {
    console.error('[Migration] Adding resistances column to characters table');
    db.exec(`ALTER TABLE characters ADD COLUMN resistances TEXT DEFAULT '[]';`);
  }
  if (!hasVulnerabilities) {
    console.error('[Migration] Adding vulnerabilities column to characters table');
    db.exec(`ALTER TABLE characters ADD COLUMN vulnerabilities TEXT DEFAULT '[]';`);
  }
  if (!hasImmunities) {
    console.error('[Migration] Adding immunities column to characters table');
    db.exec(`ALTER TABLE characters ADD COLUMN immunities TEXT DEFAULT '[]';`);
  }

  // Add currency column for gold/silver/copper tracking
  const hasCurrency = charColumns.some(col => col.name === 'currency');
  if (!hasCurrency) {
    console.error('[Migration] Adding currency column to characters table');
    db.exec(`ALTER TABLE characters ADD COLUMN currency TEXT DEFAULT '{"gold":0,"silver":0,"copper":0}';`);
  }

  // Add currency column to corpses table for generated loot currency
  const corpseColumns = db.prepare("PRAGMA table_info(corpses)").all() as { name: string }[];
  const hasCorpseCurrency = corpseColumns.some(col => col.name === 'currency');
  if (!hasCorpseCurrency) {
    console.error('[Migration] Adding currency column to corpses table');
    db.exec(`ALTER TABLE corpses ADD COLUMN currency TEXT DEFAULT '{"gold":0,"silver":0,"copper":0}';`);
  }

  // Add currency_looted flag to corpses table
  const hasCorpseCurrencyLooted = corpseColumns.some(col => col.name === 'currency_looted');
  if (!hasCorpseCurrencyLooted) {
    console.error('[Migration] Adding currency_looted column to corpses table');
    db.exec(`ALTER TABLE corpses ADD COLUMN currency_looted INTEGER NOT NULL DEFAULT 0;`);
  }

  // PHASE-1: Add current_room_id to characters table for spatial awareness
  const hasCurrentRoomId = charColumns.some(col => col.name === 'current_room_id');
  if (!hasCurrentRoomId) {
    console.error('[Migration] Adding current_room_id column to characters table');
    db.exec(`ALTER TABLE characters ADD COLUMN current_room_id TEXT REFERENCES room_nodes(id) ON DELETE SET NULL;`);
  }

  // PHASE-2: Add perception and stealth skill bonuses for social hearing mechanics
  const hasPerceptionBonus = charColumns.some(col => col.name === 'perception_bonus');
  const hasStealthBonus = charColumns.some(col => col.name === 'stealth_bonus');

  if (!hasPerceptionBonus) {
    console.error('[Migration] Adding perception_bonus column to characters table');
    db.exec(`ALTER TABLE characters ADD COLUMN perception_bonus INTEGER DEFAULT 0;`);
  }
  if (!hasStealthBonus) {
    console.error('[Migration] Adding stealth_bonus column to characters table');
    db.exec(`ALTER TABLE characters ADD COLUMN stealth_bonus INTEGER DEFAULT 0;`);
  }

  // SPATIAL: Add coordinate and network support to room_nodes
  const roomColumns = db.prepare('PRAGMA table_info(room_nodes)').all() as Array<{ name: string }>;
  const hasNetworkId = roomColumns.some(col => col.name === 'network_id');
  const hasLocalX = roomColumns.some(col => col.name === 'local_x');
  const hasLocalY = roomColumns.some(col => col.name === 'local_y');

  // Migration: Rename world_x/world_y to local_x/local_y if needed
  const hasWorldX = roomColumns.some(col => col.name === 'world_x');
  const hasWorldY = roomColumns.some(col => col.name === 'world_y');

  if (hasWorldX && !hasLocalX) {
    console.error('[Migration] Renaming world_x to local_x in room_nodes table');
    db.exec(`ALTER TABLE room_nodes RENAME COLUMN world_x TO local_x;`);
  } else if (!hasLocalX && !hasWorldX) {
    console.error('[Migration] Adding local_x column to room_nodes table');
    db.exec(`ALTER TABLE room_nodes ADD COLUMN local_x INTEGER;`);
  }

  if (hasWorldY && !hasLocalY) {
    console.error('[Migration] Renaming world_y to local_y in room_nodes table');
    db.exec(`ALTER TABLE room_nodes RENAME COLUMN world_y TO local_y;`);
  } else if (!hasLocalY && !hasWorldY) {
    console.error('[Migration] Adding local_y column to room_nodes table');
    db.exec(`ALTER TABLE room_nodes ADD COLUMN local_y INTEGER;`);
  }

  if (!hasNetworkId) {
    console.error('[Migration] Adding network_id column to room_nodes table');
    db.exec(`ALTER TABLE room_nodes ADD COLUMN network_id TEXT REFERENCES node_networks(id) ON DELETE SET NULL;`);
  }

  // SPATIAL: Create node_networks table
  db.exec(`
    CREATE TABLE IF NOT EXISTS node_networks(
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL CHECK(length(trim(name)) > 0 AND length(name) <= 100),
      type TEXT NOT NULL CHECK(type IN ('cluster', 'linear')),
      world_id TEXT NOT NULL,
      center_x INTEGER NOT NULL,
      center_y INTEGER NOT NULL,
      bounding_box TEXT, -- JSON: {minX, maxX, minY, maxY}
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_node_networks_coords ON node_networks(center_x, center_y);
    CREATE INDEX IF NOT EXISTS idx_node_networks_world ON node_networks(world_id);
    CREATE INDEX IF NOT EXISTS idx_room_nodes_local_coords ON room_nodes(local_x, local_y);
    CREATE INDEX IF NOT EXISTS idx_room_nodes_network ON room_nodes(network_id);
  `);
}

function createPostMigrationIndexes(db: Database.Database) {
  // Create indexes that depend on columns added by migrations
  // Using try-catch since CREATE INDEX IF NOT EXISTS should handle duplicates
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_characters_type ON characters(character_type);`);
  } catch (e) {
    // Index may already exist or column may not exist in very old DBs
    console.error('[Migration] Note: Could not create idx_characters_type:', (e as Error).message);
  }
  
  // Create parties position index (depends on position_x, position_y columns added by migration)
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_parties_position ON parties(position_x, position_y);`);
  } catch (e) {
    console.error('[Migration] Note: Could not create idx_parties_position:', (e as Error).message);
  }

  // Create regions owner_nation_id index (depends on column added by migration)
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_regions_owner_nation ON regions(owner_nation_id);`);
  } catch (e) {
    console.error('[Migration] Note: Could not create idx_regions_owner_nation:', (e as Error).message);
  }
}
