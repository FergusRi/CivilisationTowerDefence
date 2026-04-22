/**
 * src/buildings/registry.js
 * All building type definitions — costs, HP, worker slots, production,
 * tower stats, one-per-game flags, and research locks.
 */

import { TILE_SIZE } from '../world/map.js';

// ── Building type constants ───────────────────────────────────────────────────
export const BUILDING = Object.freeze({
  COTTAGE:          'COTTAGE',
  GUARD_POST:       'GUARD_POST',
  BARRACKS:         'BARRACKS',
  SAWMILL:          'SAWMILL',
  GRAIN_FARM:       'GRAIN_FARM',
  WINDMILL:         'WINDMILL',
  BAKERY:           'BAKERY',
  FORGE:            'FORGE',
  IRON_MINE:        'IRON_MINE',
  WATCH_TOWER:      'WATCH_TOWER',
  ARROW_TOWER:      'ARROW_TOWER',
  CANNON_TOWER:     'CANNON_TOWER',
  LIGHTNING_TOWER:  'LIGHTNING_TOWER',
  TRADE_TERMINAL:   'TRADE_TERMINAL',
  BLACK_MARKET:     'BLACK_MARKET',
});

/**
 * Faction order used for the effectiveness arrays:
 *   index 0 = goblin
 *   index 1 = orc
 *   index 2 = undead
 *   index 3 = dark_elf
 */
export const FACTIONS = ['goblin', 'orc', 'undead', 'dark_elf'];

// ── Master building definitions table ────────────────────────────────────────
export const BUILDING_DEFS = {

  // ── POPULATION ──────────────────────────────────────────────────────────────

  [BUILDING.COTTAGE]: {
    name:         'Cottage',
    description:  'Houses citizens. Build more to grow your population.',
    cost:         { wood: 20, stone: 10 },
    hp:           60,
    size:         1,             // footprint in tiles (size×size)
    maxWorkers:   0,             // citizens employed here (not housed)
    cottageCap:   1,             // max citizens housed; upgraded via research
    category:     'population',
    lockedBy:     null,
    onePerGame:   false,
  },

  // ── DEFENCE ─────────────────────────────────────────────────────────────────

  [BUILDING.GUARD_POST]: {
    name:          'Guard Post',
    description:   'Assigns 2 citizens as guards who defend a radius around this post.',
    cost:          { wood: 15, stone: 20 },
    hp:            80,
    size:          1,
    maxWorkers:    0,
    guardRadius:   120,          // px; citizens defend this area
    guardCapacity: 2,            // upgraded to 4 / 6 via Barracks research
    category:      'defence',
    lockedBy:      null,
    onePerGame:    false,
  },

  [BUILDING.BARRACKS]: {
    name:         'Barracks',
    description:  'Enables guard upgrades and increases guard post capacity.',
    cost:         { wood: 30, stone: 40, iron_bar: 5 },
    hp:           150,
    size:         2,
    maxWorkers:   0,
    category:     'defence',
    lockedBy:     null,
    onePerGame:   true,
    // upgrade levels unlocked via research; each level raises guardCapacity +2
    upgradeCapacityPerLevel: 2,  // base 2 → 4 → 6
  },

  // ── TOWERS ──────────────────────────────────────────────────────────────────

  [BUILDING.WATCH_TOWER]: {
    name:             'Watch Tower',
    description:      'Basic ranged tower. Effective against Dark Elves.',
    cost:             { wood: 30, stone: 20 },
    hp:               80,
    size:             1,
    maxWorkers:       0,
    category:         'towers',
    lockedBy:         null,
    onePerGame:       false,
    // tower combat
    towerType:        'watch',
    range:            150,       // px
    damage:           8,
    fireRate:         1.2,       // shots per second
    projectileSpeed:  200,       // px/s
    aoeRadius:        0,
    chainCount:       0,
    // effectiveness[factionIndex] — multiplier applied to damage
    // goblin / orc / undead / dark_elf
    effectiveness:    [1.0, 0.5, 1.0, 1.5],
  },

  [BUILDING.ARROW_TOWER]: {
    name:             'Arrow Tower',
    description:      'Fast-firing tower. Effective against Goblins.',
    cost:             { wood: 40, stone: 30, planks: 5 },
    hp:               100,
    size:             1,
    maxWorkers:       0,
    category:         'towers',
    lockedBy:         'ARROW_TOWER',
    onePerGame:       false,
    towerType:        'arrow',
    range:            180,
    damage:           12,
    fireRate:         1.8,
    projectileSpeed:  260,
    aoeRadius:        0,
    chainCount:       0,
    effectiveness:    [1.5, 1.0, 0.5, 1.0],
  },

  [BUILDING.CANNON_TOWER]: {
    name:             'Cannon Tower',
    description:      'Slow but deals AoE damage. Effective against Orcs.',
    cost:             { stone: 60, iron_bar: 10, bricks: 10 },
    hp:               130,
    size:             1,
    maxWorkers:       0,
    category:         'towers',
    lockedBy:         'CANNON_TOWER',
    onePerGame:       false,
    towerType:        'cannon',
    range:            140,
    damage:           35,
    fireRate:         0.4,
    projectileSpeed:  180,
    aoeRadius:        40,        // px splash
    chainCount:       0,
    effectiveness:    [0.5, 1.5, 1.0, 1.0],
  },

  [BUILDING.LIGHTNING_TOWER]: {
    name:             'Lightning Tower',
    description:      'Chains between nearby enemies. Effective against Undead.',
    cost:             { stone: 50, iron_bar: 15, steel: 5 },
    hp:               110,
    size:             1,
    maxWorkers:       0,
    category:         'towers',
    lockedBy:         'LIGHTNING_TOWER',
    onePerGame:       false,
    towerType:        'lightning',
    range:            160,
    damage:           22,
    fireRate:         0.8,
    projectileSpeed:  300,
    aoeRadius:        0,
    chainCount:       3,         // number of chain-bounce targets
    chainRange:       90,        // px between chain targets
    effectiveness:    [1.0, 1.0, 1.5, 0.5],
  },

  // ── INDUSTRY ────────────────────────────────────────────────────────────────

  [BUILDING.SAWMILL]: {
    name:         'Sawmill',
    description:  'Workers harvest wood and convert it into planks.',
    cost:         { wood: 25, stone: 15 },
    hp:           70,
    size:         1,
    maxWorkers:   2,
    category:     'industry',
    lockedBy:     null,
    onePerGame:   false,
    harvestKind:  'wood',        // resource node kind workers collect
    produces:     'planks',      // output resource
    // conversion: every 2 wood in stockIn → 1 plank added to stock
    consumesPer:  2,
    yieldsPerConversion: 1,
  },

  [BUILDING.GRAIN_FARM]: {
    name:         'Grain Farm',
    description:  'Workers produce food each wave.',
    cost:         { wood: 20 },
    hp:           50,
    size:         2,
    maxWorkers:   2,
    category:     'industry',
    lockedBy:     null,
    onePerGame:   false,
    harvestKind:  null,          // passive producer; no node required
    produces:     'food',
    yieldPerWorker: 4,           // food added per worker at wave-end tick
  },

  [BUILDING.WINDMILL]: {
    name:         'Windmill',
    description:  'Converts food (grain) into flour.',
    cost:         { wood: 30, stone: 10 },
    hp:           60,
    size:         1,
    maxWorkers:   1,
    category:     'industry',
    lockedBy:     'WINDMILL',
    onePerGame:   false,
    harvestKind:  null,
    consumes:     'food',        // pulled from global stock at wave-end
    produces:     'flour',
    consumesPer:  2,             // 2 food → 1 flour
    yieldsPerConversion: 1,
  },

  [BUILDING.BAKERY]: {
    name:         'Bakery',
    description:  'Converts flour into bread. Bread satisfies 2× food upkeep.',
    cost:         { wood: 25, stone: 15, planks: 5 },
    hp:           60,
    size:         1,
    maxWorkers:   2,
    category:     'industry',
    lockedBy:     'BAKERY',
    onePerGame:   false,
    harvestKind:  null,
    consumes:     'flour',
    produces:     'bread',
    consumesPer:  1,             // 1 flour → 2 bread
    yieldsPerConversion: 2,
  },

  [BUILDING.IRON_MINE]: {
    name:         'Iron Mine',
    description:  'Workers mine iron ore nodes.',
    cost:         { wood: 20, stone: 10 },
    hp:           70,
    size:         1,
    maxWorkers:   2,
    category:     'industry',
    lockedBy:     'IRON_MINING',
    onePerGame:   false,
    harvestKind:  'iron',
    produces:     'iron',
    yieldsPerStrike: 1,
  },

  [BUILDING.FORGE]: {
    name:         'Forge',
    description:  'Smelts iron into iron bars, and iron bars into steel.',
    cost:         { stone: 40, iron: 10 },
    hp:           120,
    size:         2,
    maxWorkers:   2,
    category:     'industry',
    lockedBy:     'FORGE',
    onePerGame:   true,
    harvestKind:  null,
    // Two-pass dual-input processing (executed in order at wave-end):
    //   Pass 1: consume iron     → produce iron_bar  (3:1)
    //   Pass 2: consume iron_bar → produce steel      (4:1)
    passes: [
      { consumes: 'iron',     consumesPer: 3, produces: 'iron_bar', yieldsPerConversion: 1 },
      { consumes: 'iron_bar', consumesPer: 4, produces: 'steel',    yieldsPerConversion: 1 },
    ],
  },

  // ── TRADE / RESEARCH ────────────────────────────────────────────────────────

  [BUILDING.TRADE_TERMINAL]: {
    name:         'Trade Terminal',
    description:  'Sell surplus resources for gold at fluctuating market prices.',
    cost:         { wood: 40, stone: 30, planks: 10 },
    hp:           80,
    size:         1,
    maxWorkers:   0,
    category:     'trade',
    lockedBy:     null,
    onePerGame:   true,
  },

  [BUILDING.BLACK_MARKET]: {
    name:         'Black Market',
    description:  'Spend gold to research upgrades across Industry, Defence, and Population.',
    cost:         { wood: 50, stone: 40, gold: 30 },
    hp:           80,
    size:         1,
    maxWorkers:   0,
    category:     'research',
    lockedBy:     null,
    onePerGame:   true,
  },
};

// ── Helper functions ──────────────────────────────────────────────────────────

/** Return the definition object for a building type, or null if unknown. */
export function getBuildingDef(type) {
  return BUILDING_DEFS[type] ?? null;
}

/**
 * Create a new live building instance from a definition.
 * @param {string} type   - BUILDING constant
 * @param {number} tx     - tile X of top-left corner
 * @param {number} ty     - tile Y of top-left corner
 * @returns {Object}
 */
export function createBuilding(type, tx, ty) {
  const def = getBuildingDef(type);
  if (!def) throw new Error(`Unknown building type: "${type}"`);

  const wx = tx * TILE_SIZE + (def.size * TILE_SIZE) / 2;
  const wy = ty * TILE_SIZE + (def.size * TILE_SIZE) / 2;

  return {
    id:           `${type}_${tx}_${ty}_${Date.now()}`,
    type,
    tx,
    ty,
    wx,            // world-space centre X
    wy,            // world-space centre Y
    hp:            def.hp,
    maxHp:         def.hp,
    level:         1,           // for upgradeable buildings (Barracks, towers)
    isBuilt:       true,        // false while citizen is constructing
    workers:       [],          // citizenIds currently employed here
    // Guard post state
    guardedBy:     [],          // citizenIds assigned as guards
    // Production state (industry buildings)
    stockIn:       0,           // raw input queued for conversion
    stockOut:      0,           // output waiting to be added to global stock
    // Tower combat state
    lastFireTime:  0,           // seconds since last shot
    target:        null,        // enemyId currently targeted
  };
}

/**
 * Return array of all BUILDING type keys that belong to a UI category.
 * @param {string} category  'population' | 'defence' | 'towers' | 'industry' | 'trade' | 'research'
 */
export function getBuildingsByCategory(category) {
  return Object.entries(BUILDING_DEFS)
    .filter(([, def]) => def.category === category)
    .map(([type]) => type);
}

/**
 * Get the current cottage capacity for a cottage building, accounting for
 * any research upgrades stored on the building (or the global research state).
 * Default is def.cottageCap (1 base). Callers can override by setting
 * building.cottageCap after a research unlock fires.
 */
export function getCottageCap(building) {
  return building.cottageCap ?? BUILDING_DEFS[BUILDING.COTTAGE].cottageCap;
}

/**
 * Get the current guard capacity for a guard-post building, accounting for
 * Barracks upgrade level stored on the guard post instance.
 */
export function getGuardCapacity(building) {
  if (building.type !== BUILDING.GUARD_POST) return 0;
  return building.guardCapacity ?? BUILDING_DEFS[BUILDING.GUARD_POST].guardCapacity;
}
