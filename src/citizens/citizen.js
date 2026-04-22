// Citizen system: autonomous agents, A* pathfinding, state machine

import { MAP_W, MAP_H, TILE_SIZE, WALKABLE } from '../world/map.js';
import { ZONE, getZone, hasAnyZone, nearestZoneBoundary } from '../world/zones.js';
import { findNearestNode, reserveNode, releaseNode, strikeNode, getNodeById } from '../world/resources_map.js';
import { add } from '../resources.js';
import { emit, Events } from '../engine/events.js';

let uidCounter = 0;
const NAMES = [
  'Aldric','Bera','Colt','Dwyn','Edda','Finn','Gwen','Hadwin','Idris','Jora',
  'Kern','Lira','Mace','Nola','Oswin','Petra','Quinn','Reva','Soren','Tilda',
  'Uther','Vanna','Wren','Xara','Yoel','Zara','Brin','Cade','Dara','Elan',
];

export function createCitizen(wx, wy) {
  return {
    id: `c${uidCounter++}`,
    name: NAMES[Math.floor(Math.random() * NAMES.length)],
    wx, wy,
    tx: Math.floor(wx / TILE_SIZE),
    ty: Math.floor(wy / TILE_SIZE),
    hp: 30, maxHp: 30,
    damage: 4, attackRange: 20, attackCooldown: 1.5, attackTimer: 0,
    speed: 60, // px/s
    state: 'IDLE', // IDLE | WORKING | BUILDING | DEFENDING
    path: [],
    pathTimer: 0,
    job: null,         // { buildingId, nodeId, carrying, carryKind }
    cottageId: null,
    guardPostId: null,
    hasRespawnedThisWave: false,
    retryTimer: 0,
    target: null,      // enemy being attacked
  };
}

// ─── A* Pathfinding ─────────────────────────────────────────────────────────

function heuristic(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

export function findPath(tiles, fromTx, fromTy, toTx, toTy) {
  if (toTx < 0 || toTx >= MAP_W || toTy < 0 || toTy >= MAP_H) return [];
  if (!WALKABLE[tiles[toTy * MAP_W + toTx]]) return [];

  const openSet = new Map();
  const cameFrom = new Map();
  const gScore = new Map();
  const fScore = new Map();

  const key = (x, y) => y * MAP_W + x;
  const startKey = key(fromTx, fromTy);
  const goalKey  = key(toTx, toTy);

  gScore.set(startKey, 0);
  fScore.set(startKey, heuristic(fromTx, fromTy, toTx, toTy));
  openSet.set(startKey, { x: fromTx, y: fromTy });

  const DIRS = [[0,-1],[0,1],[-1,0],[1,0],[1,-1],[1,1],[-1,-1],[-1,1]];
  const COSTS = [1, 1, 1, 1, 1.414, 1.414, 1.414, 1.414];
  let iterations = 0;

  while (openSet.size > 0 && iterations++ < 4000) {
    // Find lowest fScore node
    let currentKey = null;
    let lowestF = Infinity;
    for (const [k] of openSet) {
      const f = fScore.get(k) ?? Infinity;
      if (f < lowestF) { lowestF = f; currentKey = k; }
    }
    if (currentKey === null) break;

    if (currentKey === goalKey) {
      // Reconstruct path
      const path = [];
      let cur = currentKey;
      while (cameFrom.has(cur)) {
        const x = cur % MAP_W, y = Math.floor(cur / MAP_W);
        path.unshift({ tx: x, ty: y, wx: x * TILE_SIZE + 16, wy: y * TILE_SIZE + 16 });
        cur = cameFrom.get(cur);
      }
      return path;
    }

    openSet.delete(currentKey);
    const cx = currentKey % MAP_W, cy = Math.floor(currentKey / MAP_W);

    for (let d = 0; d < DIRS.length; d++) {
      const nx = cx + DIRS[d][0], ny = cy + DIRS[d][1];
      if (nx < 0 || nx >= MAP_W || ny < 0 || ny >= MAP_H) continue;
      if (!WALKABLE[tiles[ny * MAP_W + nx]]) continue;
      // Diagonal: block if both cardinals are walls
      if (d >= 4) {
        const ax = cx + DIRS[d][0], ay = cy;
        const bx = cx, by = cy + DIRS[d][1];
        if (!WALKABLE[tiles[ay * MAP_W + ax]] || !WALKABLE[tiles[by * MAP_W + bx]]) continue;
      }
      const nk = key(nx, ny);
      const tentativeG = (gScore.get(currentKey) ?? Infinity) + COSTS[d];
      if (tentativeG < (gScore.get(nk) ?? Infinity)) {
        cameFrom.set(nk, currentKey);
        gScore.set(nk, tentativeG);
        fScore.set(nk, tentativeG + heuristic(nx, ny, toTx, toTy));
        openSet.set(nk, { x: nx, y: ny });
      }
    }
  }
  return []; // No path found
}

// ─── Citizen Update ──────────────────────────────────────────────────────────

export function updateCitizens(citizens, dt, gs) {
  for (const c of citizens) {
    c.attackTimer = Math.max(0, c.attackTimer - dt);
    c.retryTimer  = Math.max(0, c.retryTimer - dt);

    switch (c.state) {
      case 'IDLE':     updateIdle(c, dt, gs);     break;
      case 'WORKING':  updateWorking(c, dt, gs);  break;
      case 'BUILDING': updateBuilding(c, dt, gs); break;
      case 'DEFENDING':updateDefending(c, dt, gs); break;
    }

    // Move along path
    followPath(c, dt);
    c.tx = Math.floor(c.wx / TILE_SIZE);
    c.ty = Math.floor(c.wy / TILE_SIZE);
  }
}

function followPath(c, dt) {
  if (c.path.length === 0) return;
  const next = c.path[0];
  const dx = next.wx - c.wx, dy = next.wy - c.wy;
  const dist = Math.sqrt(dx*dx + dy*dy);
  const step = c.speed * dt;
  if (dist <= step) {
    c.wx = next.wx; c.wy = next.wy;
    c.path.shift();
  } else {
    c.wx += dx/dist * step;
    c.wy += dy/dist * step;
  }
}

function updateIdle(c, dt, gs) {
  if (c.retryTimer > 0) return;

  // 1. Try to find work
  const openBuilding = gs.buildings.find(b =>
    b.workerSlots && b.workers.length < b.workerSlots && b.id !== 'settlement_hall'
  );
  if (openBuilding) {
    assignWork(c, openBuilding, gs);
    return;
  }

  // 2. Check if new cottage is needed
  const totalCap = gs.buildings.filter(b => b.type === 'cottage').reduce((s,b) => s + b.capacity, 0);
  if (gs.citizens.length > totalCap) {
    tryBuildCottage(c, gs);
    return;
  }

  // 3. Wander in settlement zone
  if (c.path.length === 0) {
    const wx = c.wx + (Math.random() - 0.5) * 128;
    const wy = c.wy + (Math.random() - 0.5) * 128;
    const tx = Math.floor(wx / TILE_SIZE);
    const ty = Math.floor(wy / TILE_SIZE);
    if (tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H &&
        WALKABLE[gs.map.tiles[ty * MAP_W + tx]]) {
      c.path = findPath(gs.map.tiles, c.tx, c.ty, tx, ty);
    }
  }
}

function assignWork(c, building, gs) {
  building.workers.push(c.id);
  c.job = { buildingId: building.id, nodeId: null, carrying: 0, carryKind: building.harvestKind || null };
  c.state = 'WORKING';
  c.path = [];
  // Path to building
  const bTx = Math.floor(building.wx / TILE_SIZE);
  const bTy = Math.floor(building.wy / TILE_SIZE);
  c.path = findPath(gs.map.tiles, c.tx, c.ty, bTx, bTy);
}

function updateWorking(c, dt, gs) {
  if (!c.job) { c.state = 'IDLE'; return; }
  const building = gs.buildings.find(b => b.id === c.job.buildingId);
  if (!building) { c.job = null; c.state = 'IDLE'; return; }

  const bTx = Math.floor(building.wx / TILE_SIZE);
  const bTy = Math.floor(building.wy / TILE_SIZE);

  if (!c.job.nodeId) {
    // Need to find a resource node
    if (c.retryTimer > 0) return;
    const node = findNearestNode(c.job.carryKind, c.tx, c.ty);
    if (!node) { c.retryTimer = 5; return; }
    c.job.nodeId = node.id;
    reserveNode(node.id, c.id);
    c.path = findPath(gs.map.tiles, c.tx, c.ty, node.tx, node.ty);
    return;
  }

  const node = getNodeById(c.job.nodeId);
  if (!node || node.hp <= 0) {
    c.job.nodeId = null; releaseNode(c.job.nodeId); return;
  }

  // At node?
  if (c.path.length === 0) {
    const dx = node.tx - c.tx, dy = node.ty - c.ty;
    if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
      // Harvest
      c.job.carrying++;
      strikeNode(node.id, gs.map.tiles, gs.sprites);
      releaseNode(c.job.nodeId);
      c.job.nodeId = null;
      if (c.job.carrying >= 3) {
        // Return to building to deposit
        c.path = findPath(gs.map.tiles, c.tx, c.ty, bTx, bTy);
      }
    }
  } else if (c.job.carrying >= 3 && c.path.length === 0) {
    // At building, deposit
    const dx = bTx - c.tx, dy = bTy - c.ty;
    if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
      add(c.job.carryKind, c.job.carrying);
      c.job.carrying = 0;
    }
  }
}

function tryBuildCottage(c, gs) {
  // Find nearest free walkable SETTLEMENT tile
  const { zoneData } = gs.zones;
  let best = null, bestDist = Infinity;
  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      if (zoneData[ty * MAP_W + tx] !== ZONE.SETTLEMENT) continue;
      if (!WALKABLE[gs.map.tiles[ty * MAP_W + tx]]) continue;
      if (gs.buildings.some(b => Math.floor(b.wx/TILE_SIZE) === tx && Math.floor(b.wy/TILE_SIZE) === ty)) continue;
      const dx = tx - c.tx, dy = ty - c.ty;
      const d = dx*dx + dy*dy;
      if (d < bestDist) { bestDist = d; best = { tx, ty }; }
    }
  }
  if (!best) { c.retryTimer = 5; return; }
  c.state = 'BUILDING';
  c.job = { buildSite: best, buildTimer: 8 };
  c.path = findPath(gs.map.tiles, c.tx, c.ty, best.tx, best.ty);
}

function updateBuilding(c, dt, gs) {
  if (!c.job?.buildSite) { c.state = 'IDLE'; return; }
  if (c.path.length > 0) return; // Still walking
  c.job.buildTimer -= dt;
  if (c.job.buildTimer <= 0) {
    // Place cottage
    const { tx, ty } = c.job.buildSite;
    const cottageCap = gs.research?.densHousing ? (gs.research?.grandHousing ? 4 : 2) : 1;
    const cottage = {
      id: `b${Date.now()}`,
      type: 'cottage',
      wx: tx * TILE_SIZE + TILE_SIZE/2,
      wy: ty * TILE_SIZE + TILE_SIZE/2,
      hp: 30, maxHp: 30,
      capacity: cottageCap,
      residents: [],
      workerSlots: 0, workers: [],
    };
    gs.buildings.push(cottage);
    // Citizen joins cottage
    cottage.residents.push(c.id);
    c.cottageId = cottage.id;
    emit(Events.BUILDING_PLACED, { building: cottage });
    c.job = null;
    c.state = 'IDLE';
  }
}

function updateDefending(c, dt, gs) {
  // Attack nearest enemy in range
  if (c.target) {
    const e = gs.enemies.find(e => e.id === c.target);
    if (!e || e.hp <= 0) { c.target = null; c.path = []; }
    else {
      const dx = e.wx - c.wx, dy = e.wy - c.wy;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist <= c.attackRange) {
        c.path = [];
        if (c.attackTimer <= 0) {
          e.hp -= c.damage;
          c.attackTimer = c.attackCooldown;
          if (e.hp <= 0) {
            emit(Events.ENEMY_DIED, { enemy: e, gold: e.killReward });
            c.target = null;
          }
        }
      } else {
        // Move toward enemy
        if (c.path.length === 0) {
          c.path = findPath(gs.map.tiles, c.tx, c.ty,
            Math.floor(e.wx/TILE_SIZE), Math.floor(e.wy/TILE_SIZE));
        }
      }
      return;
    }
  }

  // Find enemy within 60px to engage
  const nearby = gs.enemies.find(e => {
    const dx = e.wx - c.wx, dy = e.wy - c.wy;
    return Math.sqrt(dx*dx + dy*dy) <= 60 && e.hp > 0;
  });
  if (nearby) { c.target = nearby.id; return; }

  // Hold position — no wandering during wave
}

export function enterDefendingState(c, gs) {
  c.state = 'DEFENDING';
  c.path = [];
  c.job = null;
  c.target = null;

  if (c.guardPostId) {
    const gp = gs.buildings.find(b => b.id === c.guardPostId);
    if (gp) {
      c.path = findPath(gs.map.tiles, c.tx, c.ty,
        Math.floor(gp.wx/TILE_SIZE), Math.floor(gp.wy/TILE_SIZE));
      return;
    }
  }

  // Path to nearest defence zone boundary
  const boundary = nearestZoneBoundary(gs.zones, c.wx, c.wy, ZONE.DEFENCE);
  if (boundary) {
    c.path = findPath(gs.map.tiles, c.tx, c.ty, boundary.tx, boundary.ty);
  }
}

export function resetCitizensToWork(citizens, gs) {
  for (const c of citizens) {
    c.state = 'IDLE';
    c.path = [];
    c.target = null;
    c.hasRespawnedThisWave = false;
    // Remove from old building worker lists
    for (const b of gs.buildings) {
      if (b.workers) b.workers = b.workers.filter(id => id !== c.id);
    }
    c.job = null;
  }
}
