/**
 * src/citizens/citizen.js
 * Citizen entity — creation and per-frame update logic.
 *
 * Each citizen is a plain object with the following shape:
 *   { id, wx, wy, speed, hp, maxHp, damage, state, cottageId,
 *     _carryMax, _carrying, _target, _path, _respawnTimer }
 *
 * Citizen states:
 *   'idle'      — standing near cottage, looking for work
 *   'harvest'   — walking to a resource node to pick up resources
 *   'deliver'   — walking back to deposit resources
 *   'combat'    — engaging a nearby enemy
 *   'dead'      — waiting for respawn timer
 */

// ── ID counter ────────────────────────────────────────────────────────────────
let _nextId = 1;

// ── Constants ─────────────────────────────────────────────────────────────────
const BASE_SPEED       = 60;   // px per second
const BASE_HP          = 30;
const BASE_DAMAGE      = 3;
const BASE_CARRY_MAX   = 3;    // resources per trip
const RESPAWN_TIME     = 15;   // seconds before a dead citizen respawns
const COMBAT_RANGE     = 24;   // px — melee attack range
const ATTACK_COOLDOWN  = 1.0;  // seconds between attacks
const IDLE_WANDER_DIST = 48;   // px — how far citizens wander when idle

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a new citizen at world position (wx, wy).
 * @param {number} wx  World x in pixels
 * @param {number} wy  World y in pixels
 * @returns {Object}   Citizen object
 */
export function createCitizen(wx, wy) {
  return {
    id:             _nextId++,
    wx,
    wy,
    speed:          BASE_SPEED,
    hp:             BASE_HP,
    maxHp:          BASE_HP,
    damage:         BASE_DAMAGE,
    state:          'idle',
    cottageId:      null,       // assigned by spawner
    _carryMax:      BASE_CARRY_MAX,
    _carrying:      0,
    _resourceType:  null,       // which resource type is being carried
    _target:        null,       // { wx, wy } destination
    _nodeTarget:    null,       // resource node object
    _path:          [],         // A* waypoints (not yet implemented — direct movement)
    _respawnTimer:  0,
    _attackTimer:   0,
    _wanderTimer:   0,
  };
}

// ── Update ────────────────────────────────────────────────────────────────────

/**
 * Update all citizens for one frame.
 * @param {Object[]} citizens   gs.citizens array
 * @param {number}   dt         Delta time in seconds
 * @param {Object}   gs         Full game state
 */
export function updateCitizens(citizens, dt, gs) {
  // Cottage cap — how many citizens per cottage (research-driven)
  const cottageCap = gs._cottageCap ?? 1;

  for (const c of citizens) {
    if (c.state === 'dead') {
      _updateDead(c, dt, gs, cottageCap);
      continue;
    }

    // Combat check: scan for nearby enemies first
    if (_checkCombat(c, dt, gs)) continue;

    // State machine
    switch (c.state) {
      case 'idle':    _updateIdle(c, dt, gs);    break;
      case 'harvest': _updateHarvest(c, dt, gs); break;
      case 'deliver': _updateDeliver(c, dt, gs); break;
      default:        c.state = 'idle';
    }
  }
}

// ── State handlers ────────────────────────────────────────────────────────────

function _updateDead(c, dt, gs, cottageCap) {
  c._respawnTimer -= dt * (1 / (gs._respawnMulti ?? 1.0));
  if (c._respawnTimer <= 0) {
    // Respawn near cottage if possible
    const cottage = gs.buildings.find(b => b.id === c.cottageId && b.isBuilt);
    const occupants = gs.citizens.filter(
      x => x.id !== c.id && x.state !== 'dead' && x.cottageId === c.cottageId
    ).length;

    if (cottage && occupants < cottageCap) {
      c.wx    = cottage.wx + (Math.random() - 0.5) * 32;
      c.wy    = cottage.wy + (Math.random() - 0.5) * 32;
      c.hp    = c.maxHp;
      c.state = 'idle';
      c._carrying     = 0;
      c._resourceType = null;
      c._target       = null;
      c._nodeTarget   = null;
    } else {
      // No room — try again after a short delay
      c._respawnTimer = 3;
    }
  }
}

function _updateIdle(c, dt, gs) {
  // Look for a resource node to harvest
  const node = _findNearestResourceNode(c, gs);
  if (node) {
    c._nodeTarget = node;
    c._target     = { wx: node.wx, wy: node.wy };
    c.state       = 'harvest';
    return;
  }

  // Wander randomly near cottage
  c._wanderTimer -= dt;
  if (c._wanderTimer <= 0) {
    c._wanderTimer = 2 + Math.random() * 3;
    const cottage = gs.buildings.find(b => b.id === c.cottageId);
    if (cottage) {
      c._target = {
        wx: cottage.wx + (Math.random() - 0.5) * IDLE_WANDER_DIST * 2,
        wy: cottage.wy + (Math.random() - 0.5) * IDLE_WANDER_DIST * 2,
      };
    }
  }
  if (c._target) _moveToward(c, c._target.wx, c._target.wy, dt);
}

function _updateHarvest(c, dt, gs) {
  // Node may have been depleted
  if (!c._nodeTarget || c._nodeTarget.depleted) {
    c.state       = 'idle';
    c._nodeTarget = null;
    c._target     = null;
    return;
  }

  _moveToward(c, c._target.wx, c._target.wy, dt);

  // Arrived at node?
  if (_distSq(c, c._target) < 16 * 16) {
    // Harvest
    const amount = Math.min(c._carryMax, c._nodeTarget.stock ?? c._carryMax);
    c._carrying     = amount;
    c._resourceType = c._nodeTarget.resourceType ?? 'wood';
    if (c._nodeTarget.stock !== undefined) {
      c._nodeTarget.stock = Math.max(0, c._nodeTarget.stock - amount);
      if (c._nodeTarget.stock <= 0) c._nodeTarget.depleted = true;
    }

    // Find nearest storage building to deliver to
    const depot = _findNearestDepot(c, gs);
    if (depot) {
      c._target = { wx: depot.wx, wy: depot.wy };
      c._depot  = depot;
      c.state   = 'deliver';
    } else {
      // No depot — drop resources and go idle
      c._carrying     = 0;
      c._resourceType = null;
      c.state         = 'idle';
    }
  }
}

function _updateDeliver(c, dt, gs) {
  if (!c._depot || !c._depot.isBuilt) {
    // Depot gone — try to find another
    const depot = _findNearestDepot(c, gs);
    if (depot) {
      c._depot  = depot;
      c._target = { wx: depot.wx, wy: depot.wy };
    } else {
      c._carrying     = 0;
      c._resourceType = null;
      c.state         = 'idle';
      return;
    }
  }

  _moveToward(c, c._target.wx, c._target.wy, dt);

  // Arrived at depot?
  if (_distSq(c, c._target) < 20 * 20) {
    // Deposit resources via resources module (imported dynamically to avoid cycles)
    if (c._carrying > 0 && c._resourceType) {
      // Use add() with object form to match the dual-form API in resources.js
      try {
        // Dynamic import isn't available in sync context; use gs.addResource hook if provided,
        // otherwise fall back to directly mutating stock via a gs-level callback.
        if (gs._addResource) {
          gs._addResource(c._resourceType, c._carrying);
        }
      } catch (_) { /* no-op if resource system not wired */ }
    }
    c._carrying     = 0;
    c._resourceType = null;
    c._depot        = null;
    c._target       = null;
    c.state         = 'idle';
  }
}

function _checkCombat(c, dt, gs) {
  // Find closest enemy within combat range
  let closest = null;
  let closestDist = COMBAT_RANGE * COMBAT_RANGE;
  for (const e of gs.enemies) {
    if (e.hp <= 0) continue;
    const d = _distSq(c, e);
    if (d < closestDist) { closest = e; closestDist = d; }
  }

  if (!closest) return false;

  // Move into attack range if needed
  if (closestDist > (COMBAT_RANGE * 0.8) ** 2) {
    _moveToward(c, closest.wx, closest.wy, dt);
  }

  // Attack on cooldown
  c._attackTimer -= dt;
  if (c._attackTimer <= 0) {
    closest.hp       -= c.damage;
    c._attackTimer    = ATTACK_COOLDOWN;
  }

  return true;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _moveToward(c, tx, ty, dt) {
  const dx = tx - c.wx;
  const dy = ty - c.wy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return;
  const step = c.speed * dt;
  if (step >= dist) {
    c.wx = tx;
    c.wy = ty;
  } else {
    c.wx += (dx / dist) * step;
    c.wy += (dy / dist) * step;
  }
}

function _distSq(a, b) {
  const dx = a.wx - b.wx;
  const dy = a.wy - b.wy;
  return dx * dx + dy * dy;
}

function _findNearestResourceNode(c, gs) {
  if (!gs.resourceNodes) return null;
  let best = null;
  let bestDist = Infinity;
  for (const node of gs.resourceNodes) {
    if (node.depleted) continue;
    // Don't double-assign: check if another citizen is already going there
    const claimed = gs.citizens.some(
      x => x.id !== c.id && x._nodeTarget === node && x.state === 'harvest'
    );
    if (claimed) continue;
    const d = _distSq(c, node);
    if (d < bestDist) { best = node; bestDist = d; }
  }
  return best;
}

function _findNearestDepot(c, gs) {
  // Any built building that accepts resources (cottage, warehouse, etc.)
  // For simplicity, use the citizen's own cottage as depot
  const cottage = gs.buildings.find(b => b.id === c.cottageId && b.isBuilt);
  if (cottage) return cottage;
  // Fallback: any built cottage
  return gs.buildings.find(b => b.isBuilt) ?? null;
}
