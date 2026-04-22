// World map generation - mulberry32 seeded RNG, layered value noise, biome assignment

export const MAP_W = 250;
export const MAP_H = 250;
export const TILE_SIZE = 32;

export const TILE = {
  GRASS:      0,
  DIRT:       1,
  STONE_ROCK: 2,
  SAND:       3,
  WATER:      4,
};

export const WALKABLE = [true, true, false, true, false];

// Seeded RNG - mulberry32
export function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Layered value noise: 4 octaves, persistence 0.5, base freq 0.004
function makeNoiseMap(rng, width, height) {
  const GRID = 8; // gradient grid size
  const grids = [];
  let freq = 0.004;
  for (let oct = 0; oct < 4; oct++, freq *= 2) {
    const gw = Math.ceil(width * freq) + 2;
    const gh = Math.ceil(height * freq) + 2;
    const g = new Float32Array(gw * gh);
    for (let i = 0; i < g.length; i++) g[i] = rng();
    grids.push({ g, gw, gh, freq });
  }

  const out = new Float32Array(width * height);
  let amp = 1.0, totalAmp = 0;
  const amps = [];
  for (let oct = 0; oct < 4; oct++) { amps.push(amp); totalAmp += amp; amp *= 0.5; }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let val = 0;
      for (let oct = 0; oct < 4; oct++) {
        const { g, gw, freq } = grids[oct];
        const fx = x * freq, fy = y * freq;
        const ix = Math.floor(fx), iy = Math.floor(fy);
        const tx = fx - ix, ty = fy - iy;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const idx = (iy % (grids[oct].gh - 1)) * gw + (ix % (gw - 1));
        const a = g[idx], b = g[idx + 1];
        const c = g[idx + gw], d = g[idx + gw + 1];
        val += amps[oct] * (a + sx * (b - a) + sy * (c - a) + sx * sy * (a - b - c + d));
      }
      out[y * width + x] = val / totalAmp;
    }
  }
  // normalise to 0..1
  let mn = Infinity, mx = -Infinity;
  for (const v of out) { if (v < mn) mn = v; if (v > mx) mx = v; }
  const range = mx - mn || 1;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - mn) / range;
  return out;
}

function clearCircle(tiles, cx, cy, radius, tileType) {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) {
        const tx = cx + dx, ty = cy + dy;
        if (tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H) {
          if (tiles[ty * MAP_W + tx] !== TILE.WATER) {
            tiles[ty * MAP_W + tx] = tileType;
          }
        }
      }
    }
  }
}

function placeRoad(tiles, cx, cy, dir, len) {
  for (let i = 1; i <= len; i++) {
    let tx = cx, ty = cy;
    if (dir === 'N') ty = cy - i;
    else if (dir === 'S') ty = cy + i;
    else if (dir === 'E') tx = cx + i;
    else if (dir === 'W') tx = cx - i;
    if (tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H) {
      tiles[ty * MAP_W + tx] = TILE.DIRT;
    }
  }
}

export function generateMap(rng) {
  const tiles = new Uint8Array(MAP_W * MAP_H);
  const elevation = makeNoiseMap(rng, MAP_W, MAP_H);
  const moisture  = makeNoiseMap(rng, MAP_W, MAP_H);

  // Biome assignment
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    const e = elevation[i], m = moisture[i];
    if (e > 0.78)                       tiles[i] = TILE.STONE_ROCK;
    else if (e < 0.35 && m > 0.50)     tiles[i] = TILE.WATER;
    else if (e < 0.40 && m < 0.40)     tiles[i] = TILE.SAND;
    else                                tiles[i] = TILE.GRASS;
  }

  // Settlement centre setup
  const cx = 125, cy = 125;
  clearCircle(tiles, cx, cy, 11, TILE.GRASS);
  clearCircle(tiles, cx, cy, 6,  TILE.DIRT);

  // 4 cardinal roads, random length 20-35
  const roadLen = () => 20 + Math.floor(rng() * 16);
  for (const dir of ['N', 'S', 'E', 'W']) placeRoad(tiles, cx, cy, dir, roadLen());

  return { tiles, elevation, moisture };
}

// Decoration sprites scattered at map gen time
export function scatterSprites(tiles, elevation, rng) {
  const sprites = [];
  let uid = 0;

  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      const idx = ty * MAP_W + tx;
      const t = tiles[idx];
      const e = elevation[idx];
      const cx = 125, cy = 125;
      const distSq = (tx - cx) ** 2 + (ty - cy) ** 2;

      // Trees: oak on GRASS ~3% coverage, pine on high elevation clusters
      if (t === TILE.GRASS) {
        if (rng() < 0.03) {
          sprites.push({ id: `s${uid++}`, kind: e > 0.55 ? 'tree_pine' : 'tree_oak',
            tx, ty, wx: tx * TILE_SIZE + 16, wy: ty * TILE_SIZE + 16, hp: 3, maxHp: 3, kind2: 'wood' });
        } else if (rng() < 0.01) {
          sprites.push({ id: `s${uid++}`, kind: 'tree_large',
            tx, ty, wx: tx * TILE_SIZE + 16, wy: ty * TILE_SIZE + 16, hp: 3, maxHp: 3, kind2: 'wood' });
        }
      }

      // Rocks on STONE_ROCK tiles
      if (t === TILE.STONE_ROCK) {
        if (rng() < 0.20) {
          sprites.push({ id: `s${uid++}`, kind: 'rock_small', tx, ty,
            wx: tx * TILE_SIZE + 16, wy: ty * TILE_SIZE + 16 });
        } else if (rng() < 0.20) {
          sprites.push({ id: `s${uid++}`, kind: 'rock_large', tx, ty,
            wx: tx * TILE_SIZE + 16, wy: ty * TILE_SIZE + 16 });
        }
      }
    }
  }

  // Iron ore: 8 clusters, 40-110 tiles from centre
  for (let c = 0; c < 8; c++) {
    let tries = 0;
    let placed = false;
    while (!placed && tries < 100) {
      tries++;
      const angle = rng() * Math.PI * 2;
      const dist  = 40 + rng() * 70;
      const otx = Math.round(125 + Math.cos(angle) * dist);
      const oty = Math.round(125 + Math.sin(angle) * dist);
      if (otx < 1 || otx >= MAP_W - 1 || oty < 1 || oty >= MAP_H - 1) continue;
      const t2 = tiles[oty * MAP_W + otx];
      if (t2 === TILE.WATER || t2 === TILE.DIRT) continue;
      // Place cluster of 3-6 ore nodes
      const clusterSize = 3 + Math.floor(rng() * 4);
      for (let i = 0; i < clusterSize; i++) {
        const dx = Math.round((rng() - 0.5) * 4);
        const dy = Math.round((rng() - 0.5) * 4);
        const itx = otx + dx, ity = oty + dy;
        if (itx < 0 || itx >= MAP_W || ity < 0 || ity >= MAP_H) continue;
        const it = tiles[ity * MAP_W + itx];
        if (it === TILE.WATER || it === TILE.DIRT) continue;
        sprites.push({ id: `s${uid++}`, kind: 'iron_ore', tx: itx, ty: ity,
          wx: itx * TILE_SIZE + 16, wy: ity * TILE_SIZE + 16, hp: 5, maxHp: 5, kind2: 'iron' });
      }
      placed = true;
    }
  }

  return sprites;
}

// Wang tile transition helper - returns adjacent tile or null
export function getAdjacentTiles(tiles, tx, ty) {
  const get = (x, y) => (x < 0 || x >= MAP_W || y < 0 || y >= MAP_H) ? -1 : tiles[y * MAP_W + x];
  return {
    n: get(tx, ty - 1),
    s: get(tx, ty + 1),
    e: get(tx + 1, ty),
    w: get(tx - 1, ty),
  };
}
