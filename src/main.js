/**
 * src/main.js
 * Boot sequence — wires all modules together and starts the game loop.
 *
 * Boot order (10 steps):
 *  1. Canvas setup
 *  2. Generate map + scatter sprites
 *  3. Init camera
 *  4. Init input
 *  5. Init resource nodes
 *  6. Init phase system
 *  7. Build initial game state (gs)
 *  8. Init renderer (starts RAF loop)
 *  9. Init HUD + UI panels
 * 10. Spawn starter citizens + buildings
 */

// ── Engine ────────────────────────────────────────────────────────────────────
import { on, emit, Events }               from './engine/events.js';
import { initCamera, camera }             from './engine/camera.js';
import { initInput, setClickHandler }     from './engine/input.js';
import { initRenderer }                   from './engine/renderer.js';

// ── World ─────────────────────────────────────────────────────────────────────
import { mulberry32, generateMap, scatterSprites, TILE_SIZE, MAP_W, MAP_H } from './world/map.js';
import { createZones }                    from './world/zones.js';
import { initResourceNodes }              from './world/resources_map.js';

// ── Resources ─────────────────────────────────────────────────────────────────
import { stock, add }                     from './resources.js';

// ── Buildings ─────────────────────────────────────────────────────────────────
import { BUILDING, createBuilding, getBuildingDef } from './buildings/registry.js';
import {
  canPlace, placeBuilding, destroyBuilding,
  getBuildingAtWorld, isTowerType,
}                                          from './buildings/placement.js';

// ── Citizens ──────────────────────────────────────────────────────────────────
import { createCitizen, updateCitizens }  from './citizens/citizen.js';

// ── Combat ────────────────────────────────────────────────────────────────────
import { updateEnemies }                  from './combat/enemies.js';
import { updateTowers, updateProjectiles } from './combat/towers.js';

// ── Research ──────────────────────────────────────────────────────────────────
import { createResearchState }            from './research/research_tree.js';

// ── Phases ────────────────────────────────────────────────────────────────────
import { initPhases, updatePhases, PHASE, getPhase } from './phases/phases.js';

// ── UI ────────────────────────────────────────────────────────────────────────
import { initHUD, initBuildPanel, updateIntelPanel } from './ui/hud.js';
import { initZoneToolbar }                from './ui/zone_toolbar.js';
import { initTradePanel, toggleTradePanel } from './ui/trade_panel.js';
import {
  initBlackMarketPanel, toggleBlackMarketPanel,
}                                          from './ui/black_market_panel.js';
import {
  initBarracksPanel, toggleBarracksPanel,
}                                          from './ui/barracks_panel.js';

// ═════════════════════════════════════════════════════════════════════════════
// STEP 1 — Canvas
// ═════════════════════════════════════════════════════════════════════════════
const canvas = document.getElementById('gameCanvas');
canvas.width  = window.innerWidth;
canvas.height = window.innerHeight;

window.addEventListener('resize', () => {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  initCamera(canvas.width, canvas.height);
});

// ═════════════════════════════════════════════════════════════════════════════
// STEP 2 — Map generation
// ═════════════════════════════════════════════════════════════════════════════
const SEED = 42;
const rng   = mulberry32(SEED);
const { tiles, elevation } = generateMap(rng);
const sprites = scatterSprites(tiles, elevation, rng);

// ═════════════════════════════════════════════════════════════════════════════
// STEP 3 — Camera
// ═════════════════════════════════════════════════════════════════════════════
initCamera(canvas.width, canvas.height);

// ═════════════════════════════════════════════════════════════════════════════
// STEP 4 — Input
// ═════════════════════════════════════════════════════════════════════════════
initInput(canvas);

// ═════════════════════════════════════════════════════════════════════════════
// STEP 5 — Resource nodes
// ═════════════════════════════════════════════════════════════════════════════
initResourceNodes(tiles, sprites);

// ═════════════════════════════════════════════════════════════════════════════
// STEP 6 — Phase system
// ═════════════════════════════════════════════════════════════════════════════
initPhases();

// ═════════════════════════════════════════════════════════════════════════════
// STEP 7 — Game state
// ═════════════════════════════════════════════════════════════════════════════
const gs = {
  map:             tiles,
  zones:           createZones(),
  sprites,
  buildings:       [],
  citizens:        [],
  enemies:         [],
  projectiles:     [],
  research:        createResearchState(),
  zoneDragPreview: null,
  phase:           PHASE.PLANNING,
  warningTimer:    0,
  totalTime:       0,
  waveNumber:      0,
  camera,
  // Research-driven global modifiers (populated by research effects)
  _cottageCap:           1,
  _guardCapacity:        2,
  _towerRangeBonus:      0,
  _towerDamageMulti:     1.0,
  _citizenDamageBonus:   0,
  _citizenHpBonus:       0,
  _citizenSpeedMulti:    1.0,
  _foodUpkeepReduction:  0,
  _respawnMulti:         1.0,
  _foodCap:              100,
};

// ═════════════════════════════════════════════════════════════════════════════
// STEP 8 — Renderer
// ═════════════════════════════════════════════════════════════════════════════
initRenderer(canvas, gs);

// ═════════════════════════════════════════════════════════════════════════════
// STEP 9 — HUD + UI panels
// ═════════════════════════════════════════════════════════════════════════════
initHUD(gs);
initZoneToolbar(canvas, gs);
initTradePanel();
initBlackMarketPanel(gs.research, gs, _spawnNewCitizen);
initBarracksPanel(gs.research, gs);

// Wire build-panel tab buttons → placement mode
let _pendingBuildType = null;

initBuildPanel((type) => {
  _pendingBuildType = type;
  canvas.style.cursor = 'cell';
});

// Left-click handler: place building OR open panel for existing building
setClickHandler((wx, wy, screenX, screenY) => {
  if (_pendingBuildType) {
    const tx = Math.floor(wx / TILE_SIZE);
    const ty = Math.floor(wy / TILE_SIZE);
    const result = canPlace(_pendingBuildType, tx, ty, gs, gs.research);
    if (result.ok) {
      placeBuilding(_pendingBuildType, tx, ty, gs);
    } else {
      console.warn(`Cannot place ${_pendingBuildType}: ${result.reason}`);
      // TODO: show toast notification
    }
    _pendingBuildType = null;
    canvas.style.cursor = 'default';
    return;
  }

  // Click on existing building → open its panel
  const building = getBuildingAtWorld(wx, wy, gs.buildings);
  if (building) {
    switch (building.type) {
      case BUILDING.TRADE_TERMINAL: toggleTradePanel();       break;
      case BUILDING.BLACK_MARKET:   toggleBlackMarketPanel(); break;
      case BUILDING.BARRACKS:       toggleBarracksPanel();    break;
    }
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// STEP 10 — Starter citizens + buildings
// ═════════════════════════════════════════════════════════════════════════════
const WORLD_CX = (MAP_W / 2) * TILE_SIZE;   // 4000
const WORLD_CY = (MAP_H / 2) * TILE_SIZE;   // 4000

// Place a starter cottage at settlement centre
const starterCottage = createBuilding(BUILDING.COTTAGE, MAP_W / 2 - 1, MAP_H / 2 - 1);
starterCottage.cottageCap = 1;
gs.buildings.push(starterCottage);

// Spawn 2 starter citizens
for (let i = 0; i < 2; i++) {
  const jx = (Math.random() - 0.5) * TILE_SIZE * 3;
  const jy = (Math.random() - 0.5) * TILE_SIZE * 3;
  const c  = createCitizen(WORLD_CX + jx, WORLD_CY + jy);
  c.cottageId = starterCottage.id;
  gs.citizens.push(c);
}
starterCottage.workers = [];   // citizens find jobs on their own

// Fire initial resource update
emit(Events.RESOURCES_CHANGED, {});

// ═════════════════════════════════════════════════════════════════════════════
// GAME LOOP EXTENSIONS
// Renderer handles RAF; we hook extra per-frame logic here via a secondary
// updatePhases call routed through the renderer's frame callback.
// ═════════════════════════════════════════════════════════════════════════════

// Patch renderer to also call our update each frame.
// renderer.js calls requestAnimationFrame internally; we extend via the
// PHASE_CHANGED event and a lightweight frame hook stored on gs.
gs._onFrame = (dt) => {
  updatePhases(dt, gs);
  updateEnemies(gs.enemies, dt, gs);
  updateTowers(
    gs.buildings, gs.enemies, gs.projectiles,
    dt, gs.totalTime,
  );
  updateProjectiles(gs.projectiles, gs.enemies, dt);
  updateIntelPanel(gs);
};

// ═════════════════════════════════════════════════════════════════════════════
// SURPLUS SPAWN listener (fired by phases.js when food surplus >= 5)
// ═════════════════════════════════════════════════════════════════════════════
on('SURPLUS_SPAWN', () => {
  // Only spawn if there's room in a cottage
  const totalCap  = gs.buildings
    .filter(b => b.type === BUILDING.COTTAGE && b.isBuilt)
    .reduce((s, b) => s + (b.cottageCap ?? 1), 0);
  if (gs.citizens.length < totalCap) {
    _spawnNewCitizen(gs);
    // Consume 5 food as growth cost
    const cost = Math.min(5, stock.food ?? 0);
    if (cost > 0) { stock.food -= cost; emit(Events.RESOURCES_CHANGED, {}); }
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// GAME OVER
// ═════════════════════════════════════════════════════════════════════════════
on(Events.BUILDING_DESTROYED, () => {
  // If ALL buildings are gone, game over
  if (gs.buildings.filter(b => b.isBuilt).length === 0) {
    emit(Events.GAME_OVER, {});
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════════════════════

function _spawnNewCitizen(gameState) {
  const jx = (Math.random() - 0.5) * TILE_SIZE * 4;
  const jy = (Math.random() - 0.5) * TILE_SIZE * 4;
  const c  = createCitizen(WORLD_CX + jx, WORLD_CY + jy);
  // Apply research bonuses to new citizens
  c.speed  *= gameState._citizenSpeedMulti  ?? 1.0;
  c.damage += gameState._citizenDamageBonus ?? 0;
  c.maxHp  += gameState._citizenHpBonus     ?? 0;
  c.hp      = c.maxHp;
  c._carryMax = 3;
  gameState.citizens.push(c);
  emit(Events.RESOURCES_CHANGED, {});
  return c;
}
