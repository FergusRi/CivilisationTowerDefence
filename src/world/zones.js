// Zone system: NONE=0, SETTLEMENT=1, DEFENCE=2

import { MAP_W, MAP_H } from './map.js';

export const ZONE = { NONE: 0, SETTLEMENT: 1, DEFENCE: 2 };

export function createZones() {
  return {
    zoneData: new Uint8Array(MAP_W * MAP_H),
  };
}

export function paintZone(zones, x0, y0, x1, y1, zoneType) {
  const minX = Math.max(0, Math.min(x0, x1));
  const maxX = Math.min(MAP_W - 1, Math.max(x0, x1));
  const minY = Math.max(0, Math.min(y0, y1));
  const maxY = Math.min(MAP_H - 1, Math.max(y0, y1));
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      zones.zoneData[ty * MAP_W + tx] = zoneType;
    }
  }
}

export function getZone(zones, tx, ty) {
  if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) return ZONE.NONE;
  return zones.zoneData[ty * MAP_W + tx];
}

// Find nearest tile in a zone from a world position
export function nearestZoneBoundary(zones, wx, wy, zoneType) {
  const startTX = Math.floor(wx / 32);
  const startTY = Math.floor(wy / 32);
  let best = null, bestDist = Infinity;

  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      if (zones.zoneData[ty * MAP_W + tx] !== zoneType) continue;
      // Check if it's a boundary tile (has at least one non-zone neighbour)
      const isBoundary = [
        zones.zoneData[(ty-1)*MAP_W+tx],
        zones.zoneData[(ty+1)*MAP_W+tx],
        zones.zoneData[ty*MAP_W+(tx-1)],
        zones.zoneData[ty*MAP_W+(tx+1)],
      ].some(n => n !== zoneType);
      if (!isBoundary) continue;
      const dx = tx - startTX, dy = ty - startTY;
      const d = dx*dx + dy*dy;
      if (d < bestDist) { bestDist = d; best = { tx, ty }; }
    }
  }
  return best;
}

export function hasAnyZone(zones, zoneType) {
  return zones.zoneData.some(z => z === zoneType);
}
