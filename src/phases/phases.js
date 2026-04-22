/**
 * src/phases/phases.js
 * Phase state machine: PLANNING → WARNING → WAVE → WAVE_END
 * Handles wave progression, production tick, food upkeep, starvation,
 * surplus growth, and price fluctuation.
 */

import { emit, on, Events } from '../engine/events.js';
import { stock, add, spend, fluctuatePrices } from '../resources.js';
import { BUILDING } from '../buildings/registry.js';
import { buildWaveSpawnQueue, generateSpawnPoints, isWaveComplete } from '../combat/enemies.js';
import { updateCitizens, enterDefendingState, resetCitizensToWork } from '../citizens/citizen.js';

// ── Phase constants ───────────────────────────────────────────────────────────
export const PHASE = Object.freeze({
  PLANNING:  'planning',
  WARNING:   'warning',
  WAVE:      'wave',
  WAVE_END:  'wave_end',
});

const WARNING_DURATION = 10;   // seconds of pre-wave warning
const STARVATION_DAMAGE = 10;  // HP lost per citizen when unfed
const SPAWN_POINT_COUNT = 12;  // evenly-spaced points around map edge

// ── Phase state ───────────────────────────────────────────────────────────────
let _phase       = PHASE.PLANNING;
let _waveNumber  = 0;
let _waveTimer   = 0;        // time elapsed within current phase
let _totalTime   = 0;        // cumulative seconds since game start (for tower cooldowns)
let _spawnPoints = null;

/** Expose to renderer for the red-flash overlay */
export function getPhase()       { return _phase; }
export function getWaveNumber()  { return _waveNumber; }
export function getTotalTime()   { return _totalTime; }
export function getWarningTimer(){ return _waveTimer; }   // seconds elapsed in WARNING

// ── Boot ──────────────────────────────────────────────────────────────────────

export function initPhases() {
  _phase       = PHASE.PLANNING;
  _waveNumber  = 0;
  _waveTimer   = 0;
  _totalTime   = 0;
  _spawnPoints = generateSpawnPoints(SPAWN_POINT_COUNT);
  emit(Events.PHASE_CHANGED, { phase: _phase, wave: _waveNumber });
}

// ── "Start Wave" button → called from HUD ────────────────────────────────────

export function startWave() {
  if (_phase !== PHASE.PLANNING) return;
  _phase     = PHASE.WARNING;
  _waveTimer = 0;
  emit(Events.WAVE_WARNING, { wave: _waveNumber + 1 });
  emit(Events.PHASE_CHANGED, { phase: _phase, wave: _waveNumber + 1 });
}

// ── Master update — called every frame ───────────────────────────────────────

/**
 * @param {number} dt  - seconds since last frame
 * @param {Object} gs  - full game state
 */
export function updatePhases(dt, gs) {
  _totalTime += dt;
  _waveTimer += dt;

  switch (_phase) {
    case PHASE.PLANNING:  _updatePlanning(dt, gs);  break;
    case PHASE.WARNING:   _updateWarning(dt, gs);   break;
    case PHASE.WAVE:      _updateWave(dt, gs);      break;
    case PHASE.WAVE_END:  _updateWaveEnd(dt, gs);   break;
  }

  // Sync phase + timer into gs for renderer access
  gs.phase       = _phase;
  gs.warningTimer = _waveTimer;
  gs.totalTime    = _totalTime;
  gs.waveNumber   = _waveNumber;
}

// ── Phase handlers ────────────────────────────────────────────────────────────

function _updatePlanning(dt, gs) {
  // Citizens work normally during planning
  updateCitizens(gs.citizens, dt, gs);
}

function _updateWarning(dt, gs) {
  // Citizens still work; red-flash overlay shown by renderer
  updateCitizens(gs.citizens, dt, gs);

  if (_waveTimer >= WARNING_DURATION) {
    _enterWave(gs);
  }
}

function _enterWave(gs) {
  _waveNumber++;
  _phase     = PHASE.WAVE;
  _waveTimer = 0;

  // Build spawn queue
  buildWaveSpawnQueue(_waveNumber, _spawnPoints);

  // Send all citizens to defend
  for (const c of gs.citizens) {
    enterDefendingState(c, gs);
  }

  emit(Events.WAVE_START, { wave: _waveNumber });
  emit(Events.PHASE_CHANGED, { phase: _phase, wave: _waveNumber });
}

function _updateWave(dt, gs) {
  // Update towers (imported inline to avoid circular — towers.js is pure)
  updateCitizens(gs.citizens, dt, gs);

  // Check wave completion
  if (isWaveComplete(gs.enemies)) {
    _enterWaveEnd(gs);
  }
}

function _enterWaveEnd(gs) {
  _phase     = PHASE.WAVE_END;
  _waveTimer = 0;
  emit(Events.WAVE_ENDED, { wave: _waveNumber });
  emit(Events.PHASE_CHANGED, { phase: _phase, wave: _waveNumber });

  _runProductionTick(gs);

  // Immediately return to planning
  _phase     = PHASE.PLANNING;
  _waveTimer = 0;
  resetCitizensToWork(gs.citizens, gs);
  emit(Events.PHASE_CHANGED, { phase: _phase, wave: _waveNumber });
}

function _updateWaveEnd(dt, gs) {
  // Handled synchronously in _enterWaveEnd; this case shouldn't linger
}

// ── Production tick (wave-end, ordered per spec §15) ─────────────────────────

function _runProductionTick(gs) {
  const buildings = gs.buildings;
  const citizens  = gs.citizens;
  const research  = gs.research;

  // ── 1. Producers yield ────────────────────────────────────────────────────
  // Grain Farms: yield food per worker
  for (const b of buildings) {
    if (b.type !== BUILDING.GRAIN_FARM) continue;
    const workerCount = b.workers.length;
    if (workerCount === 0) continue;
    const yieldAmt = workerCount * 4;   // 4 food per worker (base)
    add({ food: yieldAmt });
  }

  // ── 2. Processors convert ─────────────────────────────────────────────────
  // Sawmill: wood → planks
  for (const b of buildings) {
    if (b.type !== BUILDING.SAWMILL) continue;
    if (b.workers.length === 0) continue;
    const improved = b._improvedRatio;
    // Drain all available wood from building stockIn
    const woodAvail = Math.min(b.stockIn, stock.wood);
    if (woodAvail <= 0) continue;
    if (improved) {
      // 3 wood → 2 planks
      const sets = Math.floor(woodAvail / 3);
      if (sets > 0) { spend({ wood: sets * 3 }); add({ planks: sets * 2 }); b.stockIn -= sets * 3; }
    } else {
      // 2 wood → 1 plank
      const sets = Math.floor(woodAvail / 2);
      if (sets > 0) { spend({ wood: sets * 2 }); add({ planks: sets }); b.stockIn -= sets * 2; }
    }
  }

  // Windmill: food → flour
  for (const b of buildings) {
    if (b.type !== BUILDING.WINDMILL) continue;
    if (b.workers.length === 0) continue;
    const sets = Math.floor(stock.food / 2);
    if (sets > 0) { spend({ food: sets * 2 }); add({ flour: sets }); }
  }

  // Bakery: flour → bread
  for (const b of buildings) {
    if (b.type !== BUILDING.BAKERY) continue;
    if (b.workers.length === 0) continue;
    const sets = Math.floor(stock.flour / 1);
    if (sets > 0) { spend({ flour: sets }); add({ bread: sets * 2 }); }
  }

  // ── 3. Forge dual-input ────────────────────────────────────────────────────
  for (const b of buildings) {
    if (b.type !== BUILDING.FORGE) continue;
    if (b.workers.length === 0) continue;
    // Pass 1: iron → iron_bar (3:1)
    const ironSets = Math.floor(stock.iron / 3);
    if (ironSets > 0) { spend({ iron: ironSets * 3 }); add({ iron_bar: ironSets }); }
    // Pass 2: iron_bar → steel (4:1)
    const barSets = Math.floor(stock.iron_bar / 4);
    if (barSets > 0) { spend({ iron_bar: barSets * 4 }); add({ steel: barSets }); }
  }

  // ── 4. Food upkeep ────────────────────────────────────────────────────────
  const upkeepReduction = gs._foodUpkeepReduction ?? 0;
  const baseUpkeep      = Math.max(1, 2 - upkeepReduction);   // 2 food/citizen baseline
  const totalUpkeep     = citizens.length * baseUpkeep;

  // Bread satisfies 2× upkeep per unit
  let remaining = totalUpkeep;
  const breadUsed = Math.min(stock.bread ?? 0, Math.ceil(remaining / 2));
  remaining -= breadUsed * 2;
  if (breadUsed > 0) spend({ bread: breadUsed });

  const foodUsed = Math.min(stock.food ?? 0, remaining);
  remaining -= foodUsed;
  if (foodUsed > 0) spend({ food: foodUsed });

  // ── 5. Starvation ─────────────────────────────────────────────────────────
  if (remaining > 0) {
    // Each citizen that couldn't be fed takes STARVATION_DAMAGE
    let unfedCount = Math.ceil(remaining / baseUpkeep);
    for (let i = 0; i < Math.min(unfedCount, citizens.length); i++) {
      const c = citizens[i];
      c.hp -= STARVATION_DAMAGE;
      if (c.hp <= 0) {
        emit(Events.CITIZEN_DIED, { citizen: c });
        citizens.splice(i, 1);
        i--; unfedCount--;
      }
    }
  }

  // ── 6. Surplus growth ────────────────────────────────────────────────────
  // If all citizens fed AND food surplus ≥ 5, spawn a new cottage builder
  const surplus = (stock.food ?? 0) - citizens.length * baseUpkeep;
  if (surplus >= 5) {
    // Signal that a new citizen should be spawned (handled by main.js listener)
    emit('SURPLUS_SPAWN', { surplus });
  }

  // ── 7. Price fluctuation ──────────────────────────────────────────────────
  fluctuatePrices();

  // ── Fire RESOURCES_CHANGED ────────────────────────────────────────────────
  emit(Events.RESOURCES_CHANGED, {});
}
