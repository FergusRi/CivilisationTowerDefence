/**
 * src/combat/towers.js
 * Tower targeting, firing, effectiveness matrix, and per-frame update.
 */

import { BUILDING, getBuildingDef } from '../buildings/registry.js';
import { FACTIONS } from '../buildings/registry.js';
import { damageEnemy, slowEnemy } from './enemies.js';
import { emit, Events } from '../engine/events.js';
import { stock } from '../resources.js';

// ── Effectiveness matrix ──────────────────────────────────────────────────────
// Rows = tower type, Cols = faction index (goblin/orc/undead/dark_elf)
// Values match BUILDING_DEFS[type].effectiveness arrays in registry.js
const EFFECTIVENESS = {
  watch:     [1.0, 0.5, 1.0, 1.5],
  arrow:     [1.5, 1.0, 0.5, 1.0],
  cannon:    [0.5, 1.5, 1.0, 1.0],
  lightning: [1.0, 1.0, 1.5, 0.5],
};

function getFactionIndex(faction) {
  return FACTIONS.indexOf(faction);
}

// ── Projectile factory ────────────────────────────────────────────────────────
let _projId = 1;

function createProjectile(tower, def, targetEnemy) {
  return {
    id:        `proj_${_projId++}`,
    type:      def.towerType,
    wx:        tower.wx,
    wy:        tower.wy,
    targetId:  targetEnemy.id,
    // snapshot target position for initial direction (homing handled each frame)
    tx:        targetEnemy.wx,
    ty:        targetEnemy.wy,
    speed:     def.projectileSpeed,
    damage:    def.damage,
    aoeRadius: def.aoeRadius  ?? 0,
    chainCount:def.chainCount ?? 0,
    chainRange:def.chainRange ?? 0,
    faction:   targetEnemy.faction,
    towerType: def.towerType,
    hit:       false,         // flagged when it reaches target
  };
}

// ── Main tower update ─────────────────────────────────────────────────────────

/**
 * Update all tower buildings: acquire targets, manage fire-rate cooldowns,
 * spawn projectiles into gs.projectiles.
 *
 * @param {Array}  buildings    - gs.buildings
 * @param {Array}  enemies      - gs.enemies
 * @param {Array}  projectiles  - gs.projectiles (mutated)
 * @param {number} dt           - seconds since last frame
 * @param {number} totalTime    - seconds since wave start (for lastFireTime)
 */
export function updateTowers(buildings, enemies, projectiles, dt, totalTime) {
  for (const b of buildings) {
    const def = getBuildingDef(b.type);
    if (!def || !def.towerType) continue;       // not a tower
    if (!b.isBuilt) continue;
    if (enemies.length === 0) continue;

    // Cooldown: time since last fire must exceed 1/fireRate
    const cooldown = 1 / def.fireRate;
    if (totalTime - b.lastFireTime < cooldown) continue;

    // Acquire target: nearest enemy within range
    const target = _acquireTarget(b, def, enemies);
    if (!target) continue;

    // Fire
    b.lastFireTime = totalTime;
    b.target       = target.id;
    projectiles.push(createProjectile(b, def, target));
  }
}

// ── Projectile update ─────────────────────────────────────────────────────────

/**
 * Move projectiles toward their targets, resolve hits, handle AoE & chain.
 * Dead projectiles are removed from the array.
 *
 * @param {Array}  projectiles  - gs.projectiles (mutated)
 * @param {Array}  enemies      - gs.enemies (mutated on damage)
 * @param {number} dt
 */
export function updateProjectiles(projectiles, enemies, dt) {
  const toRemove = new Set();

  for (const p of projectiles) {
    if (p.hit) { toRemove.add(p.id); continue; }

    // Find live target
    const target = enemies.find(e => e.id === p.targetId);
    if (!target) {
      // Target already dead — projectile vanishes
      toRemove.add(p.id);
      continue;
    }

    // Move toward current target position (homing)
    const dx   = target.wx - p.wx;
    const dy   = target.wy - p.wy;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const move = p.speed * dt;

    if (move >= dist) {
      // Hit!
      p.wx = target.wx;
      p.wy = target.wy;
      p.hit = true;
      _resolveHit(p, target, enemies);
      toRemove.add(p.id);
    } else {
      p.wx += (dx / dist) * move;
      p.wy += (dy / dist) * move;
    }
  }

  // Purge
  for (let i = projectiles.length - 1; i >= 0; i--) {
    if (toRemove.has(projectiles[i].id)) projectiles.splice(i, 1);
  }
}

// ── Hit resolution ────────────────────────────────────────────────────────────

function _resolveHit(p, primaryTarget, enemies) {
  const factionIdx   = getFactionIndex(primaryTarget.faction);
  const effectiveness = EFFECTIVENESS[p.towerType]?.[factionIdx] ?? 1.0;
  const finalDamage  = Math.round(p.damage * effectiveness);

  if (p.aoeRadius > 0) {
    // AoE splash — damage all enemies within radius
    for (const e of enemies) {
      const dx   = e.wx - p.wx;
      const dy   = e.wy - p.wy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= p.aoeRadius) {
        const efx  = EFFECTIVENESS[p.towerType]?.[getFactionIndex(e.faction)] ?? 1.0;
        const dmg  = Math.round(p.damage * efx);
        damageEnemy(e, dmg, stock);
      }
    }
  } else if (p.chainCount > 0) {
    // Chain lightning — bounce to nearest unique targets
    _resolveChain(p, primaryTarget, enemies, finalDamage);
  } else {
    // Single-target
    damageEnemy(primaryTarget, finalDamage, stock);
  }
}

function _resolveChain(p, first, enemies, damage) {
  const hit     = new Set([first.id]);
  let   current = first;
  let   bounces = p.chainCount;
  let   dmg     = damage;

  // Hit primary
  damageEnemy(first, dmg, stock);

  while (bounces > 0) {
    bounces--;
    dmg = Math.max(1, Math.floor(dmg * 0.7));   // 30% falloff per bounce

    // Find nearest un-hit enemy within chainRange
    let next = null, bestDist = Infinity;
    for (const e of enemies) {
      if (hit.has(e.id)) continue;
      const dx   = e.wx - current.wx;
      const dy   = e.wy - current.wy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= p.chainRange && dist < bestDist) {
        bestDist = dist; next = e;
      }
    }
    if (!next) break;

    hit.add(next.id);
    // Apply slow on chain targets (lightning flavour)
    slowEnemy(next, 1.5);
    damageEnemy(next, dmg, stock);
    current = next;
  }
}

// ── Target acquisition ────────────────────────────────────────────────────────

function _acquireTarget(tower, def, enemies) {
  let best = null, bestDist = Infinity;
  const rangeSq = def.range * def.range;

  for (const e of enemies) {
    const dx   = e.wx - tower.wx;
    const dy   = e.wy - tower.wy;
    const dist = dx * dx + dy * dy;
    if (dist <= rangeSq && dist < bestDist) {
      bestDist = dist; best = e;
    }
  }
  return best;
}
