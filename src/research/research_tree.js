/**
 * src/research/research_tree.js
 * 22-node research tree across Industry, Defence, and Population tabs.
 * Manages unlock state, cost checks, and fires side-effects on purchase.
 */

import { stock, spend, canAfford } from '../resources.js';
import { emit, Events } from '../engine/events.js';
import { BUILDING, getBuildingDef } from '../buildings/registry.js';

// ── Node definitions ──────────────────────────────────────────────────────────
// id must match the string used in BUILDING_DEFS[x].lockedBy

export const RESEARCH_NODES = [

  // ════════════════════════════════════════════════════════════════════════════
  // INDUSTRY TAB
  // ════════════════════════════════════════════════════════════════════════════

  {
    id:          'IRON_MINING',
    tab:         'industry',
    name:        'Iron Mining',
    description: 'Unlocks the Iron Mine building. Workers can harvest iron ore nodes.',
    cost:        { gold: 30 },
    requires:    [],
  },
  {
    id:          'FORGE',
    tab:         'industry',
    name:        'Forge Smelting',
    description: 'Unlocks the Forge. Smelt iron into iron bars (3:1), and iron bars into steel (4:1).',
    cost:        { gold: 50 },
    requires:    ['IRON_MINING'],
  },
  {
    id:          'WINDMILL',
    tab:         'industry',
    name:        'Milling',
    description: 'Unlocks the Windmill. Converts food into flour (2:1).',
    cost:        { gold: 25 },
    requires:    [],
  },
  {
    id:          'BAKERY',
    tab:         'industry',
    name:        'Baking',
    description: 'Unlocks the Bakery. Converts flour into bread (1:2). Bread satisfies 2× food upkeep.',
    cost:        { gold: 35 },
    requires:    ['WINDMILL'],
  },
  {
    id:          'EFFICIENT_HARVEST',
    tab:         'industry',
    name:        'Efficient Harvesting',
    description: 'Citizens carry +2 extra resources per trip (5 total).',
    cost:        { gold: 40 },
    requires:    [],
    effect: (gs) => {
      for (const c of gs.citizens) {
        c._carryMax = (c._carryMax ?? 3) + 2;
      }
    },
  },
  {
    id:          'FAST_SAWMILL',
    tab:         'industry',
    name:        'Improved Sawmill',
    description: 'Sawmill conversion ratio improves to 1.5:1 (3 wood → 2 planks).',
    cost:        { gold: 45, planks: 10 },
    requires:    [],
    effect: (gs) => {
      for (const b of gs.buildings) {
        if (b.type === BUILDING.SAWMILL) {
          b._improvedRatio = true;
        }
      }
    },
  },
  {
    id:          'SURPLUS_STORAGE',
    tab:         'industry',
    name:        'Surplus Storage',
    description: 'Each surplus food unit at wave-end now stores correctly. +10 base food stock cap.',
    cost:        { gold: 30, planks: 5 },
    requires:    [],
    effect: (gs) => {
      gs._foodCap = (gs._foodCap ?? 100) + 10;
    },
  },

  // ════════════════════════════════════════════════════════════════════════════
  // DEFENCE TAB
  // ════════════════════════════════════════════════════════════════════════════

  {
    id:          'ARROW_TOWER',
    tab:         'defence',
    name:        'Arrow Tower',
    description: 'Unlocks the Arrow Tower building.',
    cost:        { gold: 40, wood: 20 },
    requires:    [],
  },
  {
    id:          'CANNON_TOWER',
    tab:         'defence',
    name:        'Cannon Tower',
    description: 'Unlocks the Cannon Tower building. AoE splash damage.',
    cost:        { gold: 60, stone: 20, iron_bar: 5 },
    requires:    ['ARROW_TOWER'],
  },
  {
    id:          'LIGHTNING_TOWER',
    tab:         'defence',
    name:        'Lightning Tower',
    description: 'Unlocks the Lightning Tower. Chain-strikes up to 3 enemies.',
    cost:        { gold: 80, steel: 5 },
    requires:    ['CANNON_TOWER'],
  },
  {
    id:          'TOWER_RANGE_UP',
    tab:         'defence',
    name:        'Extended Range',
    description: 'All towers gain +20 px range.',
    cost:        { gold: 50 },
    requires:    [],
    effect: (gs) => {
      for (const b of gs.buildings) {
        const def = getBuildingDef(b.type);
        if (def && def.towerType) b._rangeBonus = (b._rangeBonus ?? 0) + 20;
      }
      gs._towerRangeBonus = (gs._towerRangeBonus ?? 0) + 20;
    },
  },
  {
    id:          'TOWER_DAMAGE_UP',
    tab:         'defence',
    name:        'Sharpened Bolts',
    description: 'All towers deal +15% damage.',
    cost:        { gold: 60, iron_bar: 5 },
    requires:    ['TOWER_RANGE_UP'],
    effect: (gs) => {
      gs._towerDamageMulti = (gs._towerDamageMulti ?? 1.0) * 1.15;
    },
  },
  {
    id:          'BARRACKS_UPGRADE_1',
    tab:         'defence',
    name:        'Trained Guards',
    description: 'Guard Post capacity increases from 2 to 4.',
    cost:        { gold: 45 },
    requires:    [],
    effect: (gs) => {
      for (const b of gs.buildings) {
        if (b.type === BUILDING.GUARD_POST) {
          b.guardCapacity = 4;
        }
      }
      gs._guardCapacity = 4;
    },
  },
  {
    id:          'BARRACKS_UPGRADE_2',
    tab:         'defence',
    name:        'Elite Guards',
    description: 'Guard Post capacity increases from 4 to 6.',
    cost:        { gold: 70 },
    requires:    ['BARRACKS_UPGRADE_1'],
    effect: (gs) => {
      for (const b of gs.buildings) {
        if (b.type === BUILDING.GUARD_POST) {
          b.guardCapacity = 6;
        }
      }
      gs._guardCapacity = 6;
    },
  },
  {
    id:          'CITIZEN_COMBAT',
    tab:         'defence',
    name:        'Militia Training',
    description: 'Citizens deal +2 damage and gain +10 max HP.',
    cost:        { gold: 40 },
    requires:    [],
    effect: (gs) => {
      for (const c of gs.citizens) {
        c.damage += 2;
        c.maxHp  += 10;
        c.hp      = Math.min(c.hp + 10, c.maxHp);
      }
      gs._citizenDamageBonus = (gs._citizenDamageBonus ?? 0) + 2;
      gs._citizenHpBonus     = (gs._citizenHpBonus     ?? 0) + 10;
    },
  },

  // ════════════════════════════════════════════════════════════════════════════
  // POPULATION TAB
  // ════════════════════════════════════════════════════════════════════════════

  {
    id:          'DENSE_HOUSING',
    tab:         'population',
    name:        'Dense Housing',
    description: 'Cottage cap increases from 1 to 2 citizens per cottage.',
    cost:        { gold: 40, planks: 10 },
    requires:    [],
    effect: (gs) => {
      for (const b of gs.buildings) {
        if (b.type === BUILDING.COTTAGE) b.cottageCap = 2;
      }
      gs._cottageCap = 2;
    },
  },
  {
    id:          'GRAND_HOUSING',
    tab:         'population',
    name:        'Grand Housing',
    description: 'Cottage cap increases from 2 to 4 citizens per cottage.',
    cost:        { gold: 70, planks: 20, bricks: 10 },
    requires:    ['DENSE_HOUSING'],
    effect: (gs) => {
      for (const b of gs.buildings) {
        if (b.type === BUILDING.COTTAGE) b.cottageCap = 4;
      }
      gs._cottageCap = 4;
    },
  },
  {
    id:          'FAST_RESPAWN',
    tab:         'population',
    name:        'Quick Recovery',
    description: 'Citizens respawn 50% faster after being killed.',
    cost:        { gold: 35 },
    requires:    [],
    effect: (gs) => {
      gs._respawnMulti = (gs._respawnMulti ?? 1.0) * 0.5;
    },
  },
  {
    id:          'FOOD_EFFICIENCY',
    tab:         'population',
    name:        'Rationing',
    description: 'Food upkeep per citizen reduced by 1 (minimum 1).',
    cost:        { gold: 30 },
    requires:    [],
    effect: (gs) => {
      gs._foodUpkeepReduction = (gs._foodUpkeepReduction ?? 0) + 1;
    },
  },
  {
    id:          'CITIZEN_SPEED',
    tab:         'population',
    name:        'Running Shoes',
    description: 'Citizens move 20% faster.',
    cost:        { gold: 45 },
    requires:    [],
    effect: (gs) => {
      for (const c of gs.citizens) c.speed *= 1.2;
      gs._citizenSpeedMulti = (gs._citizenSpeedMulti ?? 1.0) * 1.2;
    },
  },
  {
    id:          'EXTRA_CITIZEN',
    tab:         'population',
    name:        'Immigration',
    description: 'Immediately spawns one extra citizen in the settlement.',
    cost:        { gold: 50, food: 10 },
    requires:    [],
    effect: (gs, spawnCitizenFn) => {
      if (spawnCitizenFn) spawnCitizenFn(gs);
    },
  },
];

// ── Research state ────────────────────────────────────────────────────────────

/**
 * Create the mutable research state object.  Pass this into gs.research.
 */
export function createResearchState() {
  return {
    unlocked: new Set(),   // set of node IDs that have been purchased
  };
}

/** Build a Map<id, node> for O(1) lookup. */
const _nodeMap = new Map(RESEARCH_NODES.map(n => [n.id, n]));

/** Return the node definition for an id, or null. */
export function getResearchNode(id) {
  return _nodeMap.get(id) ?? null;
}

/** Return all nodes for a given tab. */
export function getTabNodes(tab) {
  return RESEARCH_NODES.filter(n => n.tab === tab);
}

/**
 * Check whether a node can be purchased.
 * @param {string} nodeId
 * @param {Object} researchState  - { unlocked: Set }
 * @returns {{ ok: boolean, reason?: string }}
 */
export function canResearch(nodeId, researchState) {
  const node = getResearchNode(nodeId);
  if (!node) return { ok: false, reason: 'Unknown research node' };
  if (researchState.unlocked.has(nodeId)) return { ok: false, reason: 'Already researched' };

  for (const req of node.requires) {
    if (!researchState.unlocked.has(req)) {
      const reqNode = getResearchNode(req);
      return { ok: false, reason: `Requires: ${reqNode?.name ?? req}` };
    }
  }

  if (!canAfford(node.cost)) return { ok: false, reason: 'Insufficient resources' };

  return { ok: true };
}

/**
 * Purchase a research node.  Deducts cost, marks unlocked, runs effect.
 * @param {string}   nodeId
 * @param {Object}   researchState
 * @param {Object}   gs             - full game state (passed to effect fn)
 * @param {Function} [spawnCitizenFn]  - optional callback for EXTRA_CITIZEN
 * @returns {boolean} true if purchased successfully
 */
export function purchaseResearch(nodeId, researchState, gs, spawnCitizenFn) {
  const check = canResearch(nodeId, researchState);
  if (!check.ok) return false;

  const node = getResearchNode(nodeId);
  spend(node.cost);
  researchState.unlocked.add(nodeId);

  if (node.effect) node.effect(gs, spawnCitizenFn);

  emit(Events.RESOURCES_CHANGED, {});
  return true;
}
