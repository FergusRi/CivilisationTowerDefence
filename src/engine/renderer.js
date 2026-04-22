// Main renderer - handles game loop and all draw passes

import { applyTransform, resetTransform, visibleTileRange } from './camera.js';
import { TILE, TILE_SIZE, MAP_W, MAP_H, getAdjacentTiles } from '../world/map.js';

const TILE_COLORS = {
  [TILE.GRASS]:      '#4a7c3f',
  [TILE.DIRT]:       '#8b6914',
  [TILE.STONE_ROCK]: '#6b6b6b',
  [TILE.SAND]:       '#c8a84b',
  [TILE.WATER]:      '#2a6496',
};

const TILE_COLORS_ALT = {
  [TILE.GRASS]:      '#3d6b35',
  [TILE.DIRT]:       '#7a5c12',
  [TILE.STONE_ROCK]: '#5c5c5c',
  [TILE.SAND]:       '#b8973f',
  [TILE.WATER]:      '#1e5580',
};

let gameState = null;
let canvas = null;
let ctx = null;
let lastTime = 0;

export function initRenderer(c, gs) {
  canvas = c;
  ctx = c.getContext('2d');
  gameState = gs;
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  requestAnimationFrame(loop);
}

function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}

function loop(ts) {
  const dt = Math.min((ts - lastTime) / 1000, 0.1); // cap at 100ms
  lastTime = ts;
  if (gameState.update)   gameState.update(dt);
  if (gameState._onFrame) gameState._onFrame(dt);
  render(dt);
  requestAnimationFrame(loop);
}

function render() {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  applyTransform(ctx);

  drawTiles(W, H);
  drawZones(W, H);
  drawSprites(W, H);
  drawBuildings();
  drawCitizens();
  drawEnemies();
  drawProjectiles();
  drawZoneDragPreview();

  resetTransform(ctx);

  drawHUD(W, H);
}

function drawTiles(W, H) {
  if (!gameState.map) return;
  // gs.map is the raw Uint8Array of tile IDs (set in main.js as `map: tiles`)
  const tiles = gameState.map;
  const { x0, y0, x1, y1 } = visibleTileRange(W, H, TILE_SIZE, MAP_W, MAP_H);

  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const t = tiles[ty * MAP_W + tx];
      // Checkerboard subtle variation
      const alt = (tx + ty) % 2 === 0;
      ctx.fillStyle = alt ? TILE_COLORS[t] : TILE_COLORS_ALT[t];
      ctx.fillRect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }

  // Wang transitions
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      drawTransition(tiles, tx, ty);
    }
  }
}

const TRANSITION_PAIRS = new Set(['04','40','01','10','34','43','03','30']);

function drawTransition(tiles, tx, ty) {
  const t = tiles[ty * MAP_W + tx];
  if (t !== TILE.GRASS && t !== TILE.SAND && t !== TILE.DIRT) return;
  const adj = getAdjacentTiles(tiles, tx, ty);
  const wx = tx * TILE_SIZE, wy = ty * TILE_SIZE;

  for (const [dir, nt] of Object.entries(adj)) {
    if (nt < 0) continue;
    const key = `${t}${nt}`;
    if (!TRANSITION_PAIRS.has(key)) continue;
    const color = TILE_COLORS[nt];
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = color;
    const s = 6;
    if (dir === 'n') ctx.fillRect(wx, wy, TILE_SIZE, s);
    if (dir === 's') ctx.fillRect(wx, wy + TILE_SIZE - s, TILE_SIZE, s);
    if (dir === 'e') ctx.fillRect(wx + TILE_SIZE - s, wy, s, TILE_SIZE);
    if (dir === 'w') ctx.fillRect(wx, wy, s, TILE_SIZE);
    ctx.globalAlpha = 1;
  }
}

function drawZones(W, H) {
  if (!gameState.zones) return;
  const { zoneData } = gameState.zones;
  const { x0, y0, x1, y1 } = visibleTileRange(W, H, TILE_SIZE, MAP_W, MAP_H);

  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const z = zoneData[ty * MAP_W + tx];
      if (z === 0) continue;
      ctx.fillStyle = z === 1 ? 'rgba(255,215,0,0.22)' : 'rgba(200,40,40,0.22)';
      ctx.fillRect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }

  // Zone borders
  ctx.strokeStyle = 'rgba(255,215,0,0.6)';
  ctx.lineWidth = 1.5 / (gameState.camera?.zoom || 1);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const z = zoneData[ty * MAP_W + tx];
      if (z === 0) continue;
      const color = z === 1 ? 'rgba(255,215,0,0.6)' : 'rgba(200,40,40,0.6)';
      ctx.strokeStyle = color;
      const wx = tx * TILE_SIZE, wy = ty * TILE_SIZE;
      const adj = getAdjacentTiles(zoneData, tx, ty);
      ctx.beginPath();
      if ((adj.n || 0) !== z) { ctx.moveTo(wx, wy); ctx.lineTo(wx + TILE_SIZE, wy); }
      if ((adj.s || 0) !== z) { ctx.moveTo(wx, wy + TILE_SIZE); ctx.lineTo(wx + TILE_SIZE, wy + TILE_SIZE); }
      if ((adj.e || 0) !== z) { ctx.moveTo(wx + TILE_SIZE, wy); ctx.lineTo(wx + TILE_SIZE, wy + TILE_SIZE); }
      if ((adj.w || 0) !== z) { ctx.moveTo(wx, wy); ctx.lineTo(wx, wy + TILE_SIZE); }
      ctx.stroke();
    }
  }
}

function drawSprites(W, H) {
  if (!gameState.sprites) return;
  // Y-sort
  const sorted = [...gameState.sprites].sort((a, b) => a.wy - b.wy);
  for (const s of sorted) {
    drawSprite(s);
  }
}

function drawSprite(s) {
  const { kind, wx, wy } = s;
  ctx.save();
  ctx.translate(wx, wy);
  switch (kind) {
    case 'tree_oak':   drawTreeOak(ctx);   break;
    case 'tree_pine':  drawTreePine(ctx);  break;
    case 'tree_large': drawTreeLarge(ctx); break;
    case 'rock_small': drawRockSmall(ctx); break;
    case 'rock_large': drawRockLarge(ctx); break;
    case 'iron_ore':   drawIronOre(ctx);   break;
  }
  ctx.restore();
}

function drawTreeOak(c) {
  c.fillStyle = '#5c3d1e'; c.fillRect(-3, 2, 6, 14);
  c.fillStyle = '#2d6a2d'; c.beginPath(); c.arc(0, -4, 12, 0, Math.PI*2); c.fill();
  c.fillStyle = '#3a8c3a'; c.beginPath(); c.arc(-3, -7, 7, 0, Math.PI*2); c.fill();
}
function drawTreePine(c) {
  c.fillStyle = '#4a2e0e'; c.fillRect(-2, 4, 4, 12);
  c.fillStyle = '#1a5c1a';
  c.beginPath(); c.moveTo(0,-16); c.lineTo(10,4); c.lineTo(-10,4); c.closePath(); c.fill();
  c.beginPath(); c.moveTo(0,-22); c.lineTo(7,-4); c.lineTo(-7,-4); c.closePath(); c.fill();
}
function drawTreeLarge(c) {
  c.fillStyle = '#3d2008'; c.fillRect(-4, 4, 8, 18);
  c.fillStyle = '#1e5c1e'; c.beginPath(); c.arc(0, -6, 16, 0, Math.PI*2); c.fill();
  c.fillStyle = '#2a7a2a'; c.beginPath(); c.arc(-4, -10, 9, 0, Math.PI*2); c.fill();
  c.beginPath(); c.arc(4, -10, 8, 0, Math.PI*2); c.fill();
}
function drawRockSmall(c) {
  c.fillStyle = '#888'; c.beginPath(); c.ellipse(0, 2, 9, 6, 0, 0, Math.PI*2); c.fill();
  c.fillStyle = '#aaa'; c.beginPath(); c.ellipse(-2, 0, 5, 4, -0.3, 0, Math.PI*2); c.fill();
}
function drawRockLarge(c) {
  c.fillStyle = '#777'; c.beginPath(); c.ellipse(0, 3, 14, 9, 0, 0, Math.PI*2); c.fill();
  c.fillStyle = '#999'; c.beginPath(); c.ellipse(-3, 0, 8, 6, -0.4, 0, Math.PI*2); c.fill();
}
function drawIronOre(c) {
  c.fillStyle = '#3d2a0a'; c.beginPath(); c.ellipse(0, 2, 11, 7, 0, 0, Math.PI*2); c.fill();
  c.fillStyle = '#c05a00'; c.beginPath(); c.ellipse(-3, -1, 4, 3, 0.4, 0, Math.PI*2); c.fill();
  c.fillStyle = '#e07020'; c.beginPath(); c.ellipse(3, 0, 3, 2, -0.2, 0, Math.PI*2); c.fill();
}

function drawBuildings() {
  if (!gameState.buildings) return;
  for (const b of gameState.buildings) {
    drawBuilding(b);
  }
}

function drawBuilding(b) {
  const { wx, wy, type, hp, maxHp, w = TILE_SIZE, h = TILE_SIZE } = b;
  ctx.save();
  ctx.translate(wx, wy);

  // Base shape
  const color = BUILDING_COLORS[type] || '#888';
  ctx.fillStyle = color;
  ctx.fillRect(-w/2, -h/2, w, h);
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(-w/2, -h/2, w, h);

  // HP bar if damaged
  if (hp < maxHp) {
    const bw = w, bh = 4;
    const bx = -w/2, by = -h/2 - 6;
    ctx.fillStyle = '#333';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = hp > maxHp * 0.5 ? '#4a4' : hp > maxHp * 0.25 ? '#aa4' : '#a44';
    ctx.fillRect(bx, by, bw * (hp / maxHp), bh);
  }

  ctx.restore();
}

const BUILDING_COLORS = {
  settlement_hall: '#c8a020',
  cottage:         '#a0704a',
  lumberyard:      '#5a8a2a',
  farm:            '#a0b840',
  mine:            '#808080',
  sawmill:         '#7a6030',
  mason:           '#9090a0',
  mill:            '#c8b060',
  bakery:          '#c8804a',
  smelter:         '#a05030',
  forge:           '#605050',
  trade_terminal:  '#4080c0',
  wood_wall:       '#7a5a30',
  stone_wall:      '#909090',
  metal_wall:      '#607090',
  archer_tower:    '#8a6030',
  ballista:        '#604020',
  cannon:          '#404040',
  mage_tower:      '#6030a0',
  frost_tower:     '#30a0c0',
  lightning_rod:   '#c0c020',
  catapult:        '#705030',
  barracks:        '#802020',
  guard_post:      '#c06020',
  black_market:    '#303050',
};

function drawCitizens() {
  if (!gameState.citizens) return;
  for (const c of gameState.citizens) {
    drawCitizen(c);
  }
}

function drawCitizen(c) {
  ctx.save();
  ctx.translate(c.wx, c.wy);
  // Body
  ctx.fillStyle = c.guardPost ? '#e8b040' : '#d0c0a0';
  ctx.fillRect(-4, -6, 8, 10);
  // Head
  ctx.fillStyle = '#e8c090';
  ctx.beginPath(); ctx.arc(0, -10, 5, 0, Math.PI*2); ctx.fill();
  // HP bar if damaged
  if (c.hp < c.maxHp) {
    ctx.fillStyle = '#333'; ctx.fillRect(-6, -18, 12, 3);
    ctx.fillStyle = '#4a4'; ctx.fillRect(-6, -18, 12 * (c.hp/c.maxHp), 3);
  }
  ctx.restore();
}

function drawEnemies() {
  if (!gameState.enemies) return;
  for (const e of gameState.enemies) {
    drawEnemy(e);
  }
}

function drawEnemy(e) {
  ctx.save();
  ctx.translate(e.wx, e.wy);
  const col = ENEMY_COLORS[e.faction] || '#c00';

  if (e.faction === 'giant') {
    // Boulder body
    ctx.fillStyle = '#666';
    ctx.beginPath(); ctx.arc(0, 0, 24, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#444'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-10,-5); ctx.lineTo(-4,8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6,-8); ctx.lineTo(12,4); ctx.stroke();
  } else {
    // Legs
    ctx.fillStyle = col;
    ctx.fillRect(-5, 4, 4, 8);
    ctx.fillRect(1, 4, 4, 8);
    // Torso
    ctx.fillRect(-6, -4, 12, 10);
    // Head
    ctx.beginPath(); ctx.arc(0, -9, 6, 0, Math.PI*2); ctx.fill();
  }

  // Slowed shimmer
  if (e.slowTimer > 0) {
    ctx.strokeStyle = 'rgba(0,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI*2); ctx.stroke();
  }

  // HP bar
  if (e.hp < e.maxHp) {
    const bw = e.faction === 'giant' ? 48 : 24;
    ctx.fillStyle = '#333'; ctx.fillRect(-bw/2, -30, bw, 4);
    ctx.fillStyle = '#e44'; ctx.fillRect(-bw/2, -30, bw * (e.hp/e.maxHp), 4);
  }
  ctx.restore();
}

const ENEMY_COLORS = {
  goblin: '#40a040',
  orc:    '#808040',
  undead: '#a0a0c0',
  giant:  '#707070',
};

function drawProjectiles() {
  if (!gameState.projectiles) return;
  for (const p of gameState.projectiles) {
    drawProjectile(p);
  }
}

function drawProjectile(p) {
  ctx.save();
  ctx.translate(p.wx, p.wy);
  ctx.fillStyle = PROJ_COLORS[p.type] || '#fff';
  ctx.beginPath();
  const r = p.type === 'cannonball' || p.type === 'boulder' ? 5 : 3;
  ctx.arc(0, 0, r, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();
}

const PROJ_COLORS = {
  arrow:      '#c8a040',
  bolt:       '#804020',
  cannonball: '#303030',
  magic_bolt: '#8040e0',
  ice_shard:  '#80d0ff',
  lightning:  '#ffff40',
  boulder:    '#706060',
};

function drawZoneDragPreview() {
  if (!gameState.zoneDragPreview) return;
  const { x0, y0, x1, y1, zoneType } = gameState.zoneDragPreview;
  if (x0 === null) return;
  const wx = Math.min(x0, x1) * TILE_SIZE;
  const wy = Math.min(y0, y1) * TILE_SIZE;
  const ww = (Math.abs(x1 - x0) + 1) * TILE_SIZE;
  const wh = (Math.abs(y1 - y0) + 1) * TILE_SIZE;
  ctx.fillStyle   = zoneType === 1 ? 'rgba(255,215,0,0.3)' : 'rgba(200,40,40,0.3)';
  ctx.strokeStyle = zoneType === 1 ? 'rgba(255,215,0,0.8)' : 'rgba(200,40,40,0.8)';
  ctx.lineWidth = 2;
  ctx.fillRect(wx, wy, ww, wh);
  ctx.strokeRect(wx, wy, ww, wh);
}

function drawHUD(W, H) {
  // HUD is handled by hud.js via DOM — canvas HUD is minimal
  // Draw wave warning overlay if active
  if (gameState.phase === 'warning') {
    const t = gameState.warningTimer || 0;
    if (Math.floor(t * 2) % 2 === 0) {
      ctx.fillStyle = 'rgba(200,50,50,0.18)';
      ctx.fillRect(0, 0, W, H);
    }
  }
}
