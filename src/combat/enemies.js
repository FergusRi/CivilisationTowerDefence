/**
 * src/combat/enemies.js
 * Enemy factions, AI movement (vector + separation), spawn queue,
 * cluster spawn system, and the 30-cap active enemy limit.
 */

import { TILE_SIZE, MAP_W, MAP_H } from '../world/map.js';
import { emit, Events } from '../engine/events.js';
import { damageBuilding, getBuildingAtWorld } from '../buildings/placement.js';

// ── Constants ─────────────────────────────────────────────────────────────────
export const MAX_ACTIVE_ENEMIES  = 30;
const CLUSTER_SIZE               = 5;    // enemies spawned per cluster burst
const CLUSTER_INTERVAL           = 2.0;  // seconds between cluster bursts
const SEPARATION_RADIUS          = 28;   // px — enemies push apart within this
const SEPARATION_FORCE           = 60;   // px/s push magnitude
const WORLD_W                    = MAP_W * TILE_SIZE;   // 8000
const WORLD_H                    = MAP_H * TILE_SIZE;   // 8000
const SETTLEMENT_CX              = WORLD_W / 2;         // 4000
const SETTLEMENT_CY              = WORLD_H / 2;         // 4000

// ── Faction definitions ───────────────────────────────────────────────────────
export const FACTION = Object.freeze({
  GOBLIN:    'goblin',
  ORC:       'orc',
  UNDEAD:    'undead',
  DARK_ELF:  'dark_elf',
});

const FACTION_DEFS = {
  [FACTION.GOBLIN]: {
    hp: 30, speed: 90, damage: 6, attackRate: 1.2,
    color: '#6abf45', reward: 5,
    isGiant: false,
  },
  [FACTION.ORC]: {
    hp: 80, speed: 55, damage: 14, attackRate: 0.7,
    color: '#8B4513', reward: 12,
    isGiant: false,
  },
  [FACTION.UNDEAD]: {
    hp: 50, speed: 65, damage: 9, attackRate: 1.0,
    color: '#a0a0c0', reward: 8,
    isGiant: false,
  },
  [FACTION.DARK_ELF]: {
    hp: 45, speed: 80, damage: 11, attackRate: 1.1,
    color: '#7b3fa0', reward: 10,
    isGiant: false,
  },
};

// Giant variant: used for special "boss" spawns (e.g. orc giant)
const GIANT_OVERRIDES = {
  hp: 300, speed: 35, damage: 30, attackRate: 0.5,
  isGiant: true, reward: 40,
};

// ── Spawn-queue state ─────────────────────────────────────────────────────────
// Populated by buildWaveSpawnQueue(); drained each cluster burst.
let _spawnQueue   = [];
let _clusterTimer = 0;

// ── Enemy factory ─────────────────────────────────────────────────────────────
let _nextId = 1;

/**
 * Create a new enemy instance.
 * @param {string}  faction  - FACTION constant
 * @param {number}  wx       - spawn world X
 * @param {number}  wy       - spawn world Y
 * @param {boolean} giant    - override with giant stats
 */
export function createEnemy(faction, wx, wy, giant = false) {
  const base = FACTION_DEFS[faction] ?? FACTION_DEFS[FACTION.GOBLIN];
  const stats = giant ? { ...base, ...GIANT_OVERRIDES } : { ...base };

  return {
    id:           `enemy_${_nextId++}`,
    faction,
    wx,
    wy,
    hp:           stats.hp,
    maxHp:        stats.hp,
    speed:        stats.speed,
    damage:       stats.damage,
    attackRate:   stats.attackRate,   // attacks per second
    attackTimer:  0,
    color:        stats.color,
    reward:       stats.reward,
    isGiant:      stats.isGiant,
    // AI state
    state:        'MOVING',   // MOVING | ATTACKING
    targetId:     null,       // buildingId or citizenId being attacked
    // Status effects
    slowed:       false,
    slowTimer:    0,
    // Scratch vector (reused each frame to avoid allocation)
    _vx: 0,
    _vy: 0,
  };
}

// ── Wave spawn queue ──────────────────────────────────────────────────────────

/**
 * Build the spawn queue for a wave.
 * @param {number}  waveNumber  - 1-based wave index
 * @param {Array}   spawnPoints - [{wx, wy}, …] edge spawn positions
 */
export function buildWaveSpawnQueue(waveNumber, spawnPoints) {
  _spawnQueue   = [];
  _clusterTimer = 0;

  // Scale enemy count with wave number
  const baseCount = 8 + waveNumber * 4;
  const count     = Math.min(baseCount, 120);   // hard cap total per wave

  // Faction pool: unlock factions progressively
  const pool = [];
  pool.push(FACTION.GOBLIN);
  if (waveNumber >= 2)  pool.push(FACTION.ORC);
  if (waveNumber >= 4)  pool.push(FACTION.UNDEAD);
  if (waveNumber >= 6)  pool.push(FACTION.DARK_ELF);

  // Add giant every 5 waves
  const includeGiant = (waveNumber % 5 === 0);

  for (let i = 0; i < count; i++) {
    const spawnPt = spawnPoints[i % spawnPoints.length];
    const faction = pool[Math.floor(Math.random() * pool.length)];
    const giant   = includeGiant && i === 0;
    _spawnQueue.push({ faction, wx: spawnPt.wx, wy: spawnPt.wy, giant });
  }
}

/**
 * Generate evenly-spaced spawn points around the map edge.
 * @param {number} count  - desired number of points
 * @returns {Array<{wx, wy}>}
 */
export function generateSpawnPoints(count) {
  const points = [];
  const margin = TILE_SIZE * 2;
  // Walk perimeter: top, right, bottom, left
  const perimeter = 2 * (WORLD_W + WORLD_H);
  for (let i = 0; i < count; i++) {
    const t = (i / count) * perimeter;
    let wx, wy;
    if (t < WORLD_W) {
      wx = t; wy = margin;
    } else if (t < WORLD_W + WORLD_H) {
      wx = WORLD_W - margin; wy = t - WORLD_W;
    } else if (t < 2 * WORLD_W + WORLD_H) {
      wx = WORLD_W - (t - WORLD_W - WORLD_H); wy = WORLD_H - margin;
    } else {
      wx = margin; wy = WORLD_H - (t - 2 * WORLD_W - WORLD_H);
    }
    points.push({ wx: Math.round(wx), wy: Math.round(wy) });
  }
  return points;
}

// ── Main update ───────────────────────────────────────────────────────────────

/**
 * Update all active enemies and drain the spawn queue via cluster bursts.
 * @param {Array}  enemies  - gs.enemies (mutated in place)
 * @param {number} dt       - seconds since last frame
 * @param {Object} gs       - full game state
 */
export function updateEnemies(enemies, dt, gs) {
  // ── Cluster spawn ─────────────────────────────────────────────────────────
  if (_spawnQueue.length > 0) {
    _clusterTimer += dt;
    if (_clusterTimer >= CLUSTER_INTERVAL) {
      _clusterTimer -= CLUSTER_INTERVAL;
      const canSpawn = MAX_ACTIVE_ENEMIES - enemies.length;
      const burst    = Math.min(CLUSTER_SIZE, canSpawn, _spawnQueue.length);
      for (let i = 0; i < burst; i++) {
        const spec = _spawnQueue.shift();
        // Jitter spawn position slightly so cluster doesn't stack perfectly
        const jx = (Math.random() - 0.5) * TILE_SIZE * 2;
        const jy = (Math.random() - 0.5) * TILE_SIZE * 2;
        enemies.push(createEnemy(spec.faction, spec.wx + jx, spec.wy + jy, spec.giant));
      }
    }
  }

  // ── Per-enemy update ──────────────────────────────────────────────────────
  const toRemove = [];

  for (const e of enemies) {
    // Status effect timers
    if (e.slowed) {
      e.slowTimer -= dt;
      if (e.slowTimer <= 0) { e.slowed = false; }
    }

    const effectiveSpeed = e.slowed ? e.speed * 0.4 : e.speed;

    // Attack timer always ticks
    if (e.attackTimer > 0) e.attackTimer -= dt;

    if (e.state === 'MOVING') {
      _moveTowardSettlement(e, effectiveSpeed, dt, enemies, gs);
    } else if (e.state === 'ATTACKING') {
      _updateAttacking(e, dt, gs, toRemove);
    }
  }

  // Remove dead enemies (flagged during attack resolution)
  for (const id of toRemove) {
    const idx = enemies.findIndex(en => en.id === id);
    if (idx !== -1) enemies.splice(idx, 1);
  }
}

/**
 * Return true if the wave is finished: spawn queue empty AND no active enemies.
 */
export function isWaveComplete(enemies) {
  return _spawnQueue.length === 0 && enemies.length === 0;
}

// ── Internal AI helpers ───────────────────────────────────────────────────────

function _moveTowardSettlement(e, speed, dt, allEnemies, gs) {
  // Primary target: nearest building; fall back to settlement centre
  const target = _findNearestBuilding(e, gs.buildings);

  let tx, ty;
  if (target) {
    tx = target.wx;
    ty = target.wy;
  } else {
    tx = SETTLEMENT_CX;
    ty = SETTLEMENT_CY;
  }

  const dx   = tx - e.wx;
  const dy   = ty - e.wy;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;

  // Attack range: enter ATTACKING if close enough to building
  const attackDist = e.isGiant ? 48 : 32;
  if (dist <= attackDist && target) {
    e.state    = 'ATTACKING';
    e.targetId = target.id;
    return;
  }

  // Normalised direction toward target
  e._vx = (dx / dist) * speed;
  e._vy = (dy / dist) * speed;

  // Separation: push away from nearby allies
  _applySeparation(e, allEnemies);

  e.wx += e._vx * dt;
  e.wy += e._vy * dt;

  // Clamp to world bounds
  e.wx = Math.max(0, Math.min(WORLD_W - 1, e.wx));
  e.wy = Math.max(0, Math.min(WORLD_H - 1, e.wy));
}

function _updateAttacking(e, dt, gs, toRemove) {
  const target = gs.buildings.find(b => b.id === e.targetId);
  if (!target) {
    // Building gone — resume moving
    e.state    = 'MOVING';
    e.targetId = null;
    return;
  }

  // Check still in range
  const dx   = target.wx - e.wx;
  const dy   = target.wy - e.wy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const attackDist = e.isGiant ? 48 : 32;

  if (dist > attackDist * 1.5) {
    e.state    = 'MOVING';
    e.targetId = null;
    return;
  }

  // Deal damage on cooldown
  if (e.attackTimer <= 0) {
    e.attackTimer = 1 / e.attackRate;
    const destroyed = damageBuilding(target.id, e.damage, gs);
    if (destroyed) {
      e.state    = 'MOVING';
      e.targetId = null;
    }
  }
}

function _applySeparation(e, allEnemies) {
  let sx = 0, sy = 0;
  for (const other of allEnemies) {
    if (other.id === e.id) continue;
    const dx   = e.wx - other.wx;
    const dy   = e.wy - other.wy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < SEPARATION_RADIUS && dist > 0) {
      sx += (dx / dist) * (1 - dist / SEPARATION_RADIUS);
      sy += (dy / dist) * (1 - dist / SEPARATION_RADIUS);
    }
  }
  e._vx += sx * SEPARATION_FORCE;
  e._vy += sy * SEPARATION_FORCE;
}

function _findNearestBuilding(e, buildings) {
  let best = null, bestDist = Infinity;
  for (const b of buildings) {
    if (!b.isBuilt) continue;
    const dx = b.wx - e.wx;
    const dy = b.wy - e.wy;
    const d  = dx * dx + dy * dy;
    if (d < bestDist) { bestDist = d; best = b; }
  }
  return best;
}

// ── External helpers ──────────────────────────────────────────────────────────

/**
 * Apply a slow effect to an enemy (used by Lightning Tower or special tiles).
 * @param {Object} enemy
 * @param {number} duration  seconds
 */
export function slowEnemy(enemy, duration) {
  enemy.slowed    = true;
  enemy.slowTimer = Math.max(enemy.slowTimer, duration);
}

/**
 * Damage an enemy.  Returns true if the enemy died (should be removed).
 * Emits ENEMY_DIED and awards gold on death.
 * @param {Object} enemy
 * @param {number} damage
 * @param {Object} stock   - resources stock (to add gold reward)
 */
export function damageEnemy(enemy, damage, stock) {
  enemy.hp -= damage;
  if (enemy.hp <= 0) {
    stock.gold = (stock.gold ?? 0) + enemy.reward;
    emit(Events.ENEMY_DIED, { enemy });
    return true;
  }
  return false;
}
