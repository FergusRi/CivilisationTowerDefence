// Camera: pan + zoom toward cursor

export const camera = {
  x: 0, y: 0,      // world offset (top-left world coord at canvas 0,0)
  zoom: 1.0,
  minZoom: 0.3,
  maxZoom: 3.0,
};

export function initCamera(canvasW, canvasH) {
  // Start centred on settlement (tile 125,125 = world 4000,4000)
  camera.x = 4000 - canvasW / 2;
  camera.y = 4000 - canvasH / 2;
}

export function screenToWorld(sx, sy) {
  return {
    x: camera.x + sx / camera.zoom,
    y: camera.y + sy / camera.zoom,
  };
}

export function worldToScreen(wx, wy) {
  return {
    x: (wx - camera.x) * camera.zoom,
    y: (wy - camera.y) * camera.zoom,
  };
}

export function panCamera(dx, dy) {
  camera.x -= dx / camera.zoom;
  camera.y -= dy / camera.zoom;
}

export function zoomCamera(delta, screenX, screenY) {
  const factor = delta > 0 ? 1.1 : 0.9;
  const newZoom = Math.max(camera.minZoom, Math.min(camera.maxZoom, camera.zoom * factor));
  // Zoom toward cursor
  const wx = camera.x + screenX / camera.zoom;
  const wy = camera.y + screenY / camera.zoom;
  camera.zoom = newZoom;
  camera.x = wx - screenX / camera.zoom;
  camera.y = wy - screenY / camera.zoom;
}

export function applyTransform(ctx) {
  ctx.setTransform(camera.zoom, 0, 0, camera.zoom, -camera.x * camera.zoom, -camera.y * camera.zoom);
}

export function resetTransform(ctx) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// Viewport culling: returns visible tile range
export function visibleTileRange(canvasW, canvasH, tileSize, mapW, mapH) {
  const x0 = Math.max(0, Math.floor(camera.x / tileSize));
  const y0 = Math.max(0, Math.floor(camera.y / tileSize));
  const x1 = Math.min(mapW - 1, Math.ceil((camera.x + canvasW / camera.zoom) / tileSize));
  const y1 = Math.min(mapH - 1, Math.ceil((camera.y + canvasH / camera.zoom) / tileSize));
  return { x0, y0, x1, y1 };
}
