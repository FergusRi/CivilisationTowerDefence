/**
 * src/ui/zone_toolbar.js
 * Zone-painting drag UI: click+drag on the canvas to paint SETTLEMENT or
 * DEFENCE zones over a rectangular tile region.
 */

import { ZONE, paintZone } from '../world/zones.js';
import { screenToWorld } from '../engine/camera.js';
import { TILE_SIZE, MAP_W, MAP_H } from '../world/map.js';

// ── State ─────────────────────────────────────────────────────────────────────
let _activeZone  = null;       // ZONE.SETTLEMENT | ZONE.DEFENCE | null
let _dragging    = false;
let _startTx     = 0;
let _startTy     = 0;
let _curTx       = 0;
let _curTy       = 0;
let _canvas      = null;
let _gs          = null;

// ── Init ──────────────────────────────────────────────────────────────────────

export function initZoneToolbar(canvas, gs) {
  _canvas = canvas;
  _gs     = gs;

  _buildToolbarDOM();
  _bindCanvasEvents();
}

// ── DOM ───────────────────────────────────────────────────────────────────────

function _buildToolbarDOM() {
  // Check if already built (re-init guard)
  if (document.getElementById('zone-toolbar')) return;

  const toolbar = document.createElement('div');
  toolbar.id        = 'zone-toolbar';
  toolbar.className = 'zone-toolbar';
  toolbar.innerHTML = `
    <button class="zone-btn" data-zone="settlement" title="Paint Settlement zone">
      🏘️ Settlement
    </button>
    <button class="zone-btn" data-zone="defence" title="Paint Defence zone">
      🛡️ Defence
    </button>
    <button class="zone-btn" data-zone="none" title="Erase zone">
      ✖ Erase
    </button>
  `;

  document.getElementById('hud')?.appendChild(toolbar);

  toolbar.querySelectorAll('.zone-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const z = btn.dataset.zone;
      if (_activeZone !== null && _zoneFromStr(z) === _activeZone) {
        // Deselect if clicking the active tool
        _setActiveZone(null);
      } else {
        _setActiveZone(_zoneFromStr(z));
      }
      _updateButtonStates(toolbar);
    });
  });
}

function _zoneFromStr(str) {
  switch (str) {
    case 'settlement': return ZONE.SETTLEMENT;
    case 'defence':    return ZONE.DEFENCE;
    case 'none':       return ZONE.NONE;
    default:           return null;
  }
}

function _updateButtonStates(toolbar) {
  toolbar.querySelectorAll('.zone-btn').forEach(btn => {
    const z = _zoneFromStr(btn.dataset.zone);
    btn.classList.toggle('active', z === _activeZone);
  });
}

function _setActiveZone(zone) {
  _activeZone = zone;
  if (_canvas) {
    _canvas.style.cursor = zone !== null ? 'crosshair' : 'default';
  }
}

// ── Canvas drag events ────────────────────────────────────────────────────────

function _bindCanvasEvents() {
  _canvas.addEventListener('mousedown', _onMouseDown);
  _canvas.addEventListener('mousemove', _onMouseMove);
  _canvas.addEventListener('mouseup',   _onMouseUp);
  _canvas.addEventListener('mouseleave',_onMouseUp);
}

function _onMouseDown(e) {
  // Only left-click + active zone tool
  if (e.button !== 0 || _activeZone === null) return;

  // Don't interfere with panning (right/middle handled by input.js)
  const { tx, ty } = _eventToTile(e);
  _startTx  = tx;
  _startTy  = ty;
  _curTx    = tx;
  _curTy    = ty;
  _dragging = true;

  // Show live preview
  _updateDragPreview();
  e.stopPropagation();
}

function _onMouseMove(e) {
  if (!_dragging) return;
  const { tx, ty } = _eventToTile(e);
  _curTx = tx;
  _curTy = ty;
  _updateDragPreview();
}

function _onMouseUp(e) {
  if (!_dragging) return;
  _dragging = false;

  if (_activeZone !== null && _gs) {
    const x0 = Math.min(_startTx, _curTx);
    const y0 = Math.min(_startTy, _curTy);
    const x1 = Math.max(_startTx, _curTx);
    const y1 = Math.max(_startTy, _curTy);
    paintZone(_gs.zones, x0, y0, x1, y1, _activeZone);
  }

  // Clear preview
  if (_gs) _gs.zoneDragPreview = null;
}

// ── Drag preview ──────────────────────────────────────────────────────────────

function _updateDragPreview() {
  if (!_gs) return;
  const x0 = Math.min(_startTx, _curTx);
  const y0 = Math.min(_startTy, _curTy);
  const x1 = Math.max(_startTx, _curTx);
  const y1 = Math.max(_startTy, _curTy);

  _gs.zoneDragPreview = {
    x0, y0, x1, y1,
    zone: _activeZone,
  };
}

// ── Coordinate helpers ────────────────────────────────────────────────────────

function _eventToTile(e) {
  const rect   = _canvas.getBoundingClientRect();
  const sx     = e.clientX - rect.left;
  const sy     = e.clientY - rect.top;
  const world  = screenToWorld(sx, sy);
  const tx     = Math.max(0, Math.min(MAP_W - 1, Math.floor(world.x / TILE_SIZE)));
  const ty     = Math.max(0, Math.min(MAP_H - 1, Math.floor(world.y / TILE_SIZE)));
  return { tx, ty };
}
