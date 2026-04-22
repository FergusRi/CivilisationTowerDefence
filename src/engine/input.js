// Input: right-click pan, scroll zoom, left-click interaction

import { panCamera, zoomCamera, screenToWorld } from './camera.js';

const state = {
  isPanning: false,
  lastX: 0, lastY: 0,
  mouseX: 0, mouseY: 0,
  // Callbacks set by game
  onLeftClick: null,
  onMouseMove: null,
};

export function initInput(canvas) {
  canvas.addEventListener('mousedown', e => {
    if (e.button === 1 || e.button === 2) {
      state.isPanning = true;
      state.lastX = e.clientX;
      state.lastY = e.clientY;
      e.preventDefault();
    }
    if (e.button === 0 && state.onLeftClick) {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      state.onLeftClick(sx, sy, screenToWorld(sx, sy));
    }
  });

  window.addEventListener('mouseup', e => {
    if (e.button === 1 || e.button === 2) state.isPanning = false;
  });

  window.addEventListener('mousemove', e => {
    state.mouseX = e.clientX;
    state.mouseY = e.clientY;
    if (state.isPanning) {
      panCamera(e.clientX - state.lastX, e.clientY - state.lastY);
      state.lastX = e.clientX;
      state.lastY = e.clientY;
    }
    if (state.onMouseMove) {
      const canvas = document.getElementById('gameCanvas');
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      state.onMouseMove(sx, sy, screenToWorld(sx, sy));
    }
  });

  canvas.addEventListener('wheel', e => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    zoomCamera(-e.deltaY, sx, sy);
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener('contextmenu', e => e.preventDefault());
}

export function setClickHandler(fn) { state.onLeftClick = fn; }
export function setMoveHandler(fn)  { state.onMouseMove = fn; }
export function getMousePos()       { return { x: state.mouseX, y: state.mouseY }; }
