/**
 * src/buildings/placement.js
 * Validates building placement, enforces one-per-game rules,
 * handles zone requirements, and commits placements to game state.
 */

import { BUILDING_DEFS, BUILDING, createBuilding, getBuildingDef } from './registry.js';
import { MAP_W, MAP_H, TILE_SIZE, WALKABLE, TILE } from '../world/map.js';
import { ZONE } from '../world/zones.js';
import { canAfford, spend } from '../resources.js';
import { emit, Events } from '../engine/events.js';

// ── Placement validation ──────────────────────────────────────────────────────

/**
 * Check whether a building of `type` can be placed with its top-left
 * corner at tile (tx, ty).  Returns { ok: true } or { ok: false, reason }.
 *
 * @param {string}   type      - BUILDING constant
 * @param {number}   tx        - tile column
 * @param {number}   ty        - tile row
 * @param {Object}   gs        - full game state
 * @param {Object}   research  - research state (for lock checks)
 */
export function canPlace(type, tx, ty, gs, research) {
  const def = getBuildingDef(type);
  if (!def) return { ok: false, reason: `Unknown building type: ${type}` };

  // ── Research lock ──────────────────────────────────────────────────────────
  if (def.lockedBy && !research.unlocked.has(def.lockedBy)) {
    return { ok: false, reason: `Requires research: ${def.lockedBy}` };
  }

  // ── One-per-game ───────────────────────────────────────────────────────────
  if (def.onePerGame) {
    const exists = gs.buildings.some(b => b.type === type && b.isBuilt);
    if (exists) return { ok: false, reason: `Only one ${def.name} allowed per game` };
  }

  // ── Map bounds ─────────────────────────────────────────────────────────────
  if (tx < 0 || ty < 0 || tx + def.size > MAP_W || ty + def.size > MAP_H) {
    return { ok: false, reason: 'Out of map bounds' };
  }

  // ── Tile walkability + zone checks ────────────────────────────────────────
  for (let dy = 0; dy < def.size; dy++) {
    for (let dx = 0; dx < def.size; dx++) {
      const idx = (ty + dy) * MAP_W + (tx + dx);
      const tileType = gs.map[idx];

      // Must be on a walkable tile (not WATER or STONE_ROCK)
      if (!WALKABLE[tileType]) {
        return { ok: false, reason: 'Cannot build on this tile type' };
      }

      // Towers must be in DEFENCE zone; all others must be in SETTLEMENT zone
      const zone = gs.zones[idx];
      if (isTowerType(type)) {
        if (zone !== ZONE.DEFENCE) {
          return { ok: false, reason: 'Towers must be placed in a Defence zone' };
        }
      } else {
        if (zone !== ZONE.SETTLEMENT) {
          return { ok: false, reason: 'Buildings must be placed in a Settlement zone' };
        }
      }

      // Must not overlap any existing built building
      if (isTileOccupied(tx + dx, ty + dy, gs.buildings)) {
        return { ok: false, reason: 'Tile already occupied' };
      }
    }
  }

  // ── Afford check ──────────────────────────────────────────────────────────
  if (!canAfford(def.cost)) {
    return { ok: false, reason: 'Insufficient resources' };
  }

  return { ok: true };
}

/**
 * Commit a valid placement: deduct cost, create building instance, push to
 * gs.buildings, emit BUILDING_PLACED.
 *
 * Caller should have already called canPlace() and confirmed ok===true.
 *
 * @returns {Object} the new building instance
 */
export function placeBuilding(type, tx, ty, gs) {
  const def = getBuildingDef(type);
  spend(def.cost);

  const building = createBuilding(type, tx, ty);
  gs.buildings.push(building);

  emit(Events.BUILDING_PLACED, { building });
  return building;
}

// ── Preview / highlight helpers ───────────────────────────────────────────────

/**
 * Return an array of { tx, ty, valid } objects for every tile in the
 * footprint.  Used by the renderer to draw the placement preview overlay.
 *
 * @param {string}  type
 * @param {number}  tx        - cursor tile X
 * @param {number}  ty        - cursor tile Y
 * @param {Object}  gs
 * @param {Object}  research
 */
export function getPlacementPreview(type, tx, ty, gs, research) {
  const def = getBuildingDef(type);
  if (!def) return [];

  const result = canPlace(type, tx, ty, gs, research);
  const tiles = [];

  for (let dy = 0; dy < def.size; dy++) {
    for (let dx = 0; dx < def.size; dx++) {
      tiles.push({ tx: tx + dx, ty: ty + dy, valid: result.ok });
    }
  }
  return tiles;
}

// ── Destruction ───────────────────────────────────────────────────────────────

/**
 * Destroy a building: remove from gs.buildings, free workers/guards,
 * emit BUILDING_DESTROYED.
 *
 * @param {string} buildingId
 * @param {Object} gs
 */
export function destroyBuilding(buildingId, gs) {
  const idx = gs.buildings.findIndex(b => b.id === buildingId);
  if (idx === -1) return;

  const building = gs.buildings[idx];
  gs.buildings.splice(idx, 1);

  // Detach any citizens employed here
  for (const citizen of gs.citizens) {
    if (citizen.job && citizen.job.buildingId === buildingId) {
      citizen.job = null;
      citizen.state = 'IDLE';
      citizen.path = [];
    }
    if (citizen.guardPostId === buildingId) {
      citizen.guardPostId = null;
      citizen.state = 'IDLE';
      citizen.path = [];
    }
    if (citizen.cottageId === buildingId) {
      citizen.cottageId = null;
    }
  }

  emit(Events.BUILDING_DESTROYED, { building });
}

/**
 * Apply `damage` to a building.  Destroys it if HP drops to 0.
 * @returns {boolean} true if destroyed
 */
export function damageBuilding(buildingId, damage, gs) {
  const building = gs.buildings.find(b => b.id === buildingId);
  if (!building) return false;

  building.hp = Math.max(0, building.hp - damage);
  if (building.hp === 0) {
    destroyBuilding(buildingId, gs);
    return true;
  }
  return false;
}

// ── Utility ───────────────────────────────────────────────────────────────────

/** Returns true if this building type is a tower. */
export function isTowerType(type) {
  return [
    BUILDING.WATCH_TOWER,
    BUILDING.ARROW_TOWER,
    BUILDING.CANNON_TOWER,
    BUILDING.LIGHTNING_TOWER,
  ].includes(type);
}

/**
 * Check whether a specific tile (tx, ty) is already occupied by a built
 * building's footprint.
 */
export function isTileOccupied(tx, ty, buildings) {
  for (const b of buildings) {
    if (!b.isBuilt) continue;
    const def = getBuildingDef(b.type);
    if (!def) continue;
    if (
      tx >= b.tx && tx < b.tx + def.size &&
      ty >= b.ty && ty < b.ty + def.size
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Find the building occupying tile (tx, ty), or null.
 */
export function getBuildingAtTile(tx, ty, buildings) {
  for (const b of buildings) {
    const def = getBuildingDef(b.type);
    if (!def) continue;
    if (
      tx >= b.tx && tx < b.tx + def.size &&
      ty >= b.ty && ty < b.ty + def.size
    ) {
      return b;
    }
  }
  return null;
}

/**
 * Find a building by world-pixel position (wx, wy).
 * Returns the first building whose bounding box contains the point, or null.
 */
export function getBuildingAtWorld(wx, wy, buildings) {
  for (const b of buildings) {
    const def = getBuildingDef(b.type);
    if (!def) continue;
    const x0 = b.tx * TILE_SIZE;
    const y0 = b.ty * TILE_SIZE;
    const x1 = x0 + def.size * TILE_SIZE;
    const y1 = y0 + def.size * TILE_SIZE;
    if (wx >= x0 && wx < x1 && wy >= y0 && wy < y1) {
      return b;
    }
  }
  return null;
}

/**
 * Return all buildings of a given type.
 */
export function getBuildingsOfType(type, buildings) {
  return buildings.filter(b => b.type === type);
}

/**
 * Return count of citizens currently housed across all cottages, and the
 * total cottage cap across all cottages.
 */
export function getCottageStats(buildings, citizens) {
  const cottages = getBuildingsOfType(BUILDING.COTTAGE, buildings);
  const totalCap = cottages.reduce((sum, b) => sum + (b.cottageCap ?? 1), 0);
  const housed   = citizens.filter(c => c.cottageId !== null).length;
  return { housed, totalCap, cottages: cottages.length };
}
