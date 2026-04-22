/**
 * src/ui/hud.js
 * DOM HUD: resource bar, wave counter, intel panel, start-wave button.
 * All DOM elements are created once; updated via RESOURCES_CHANGED / PHASE_CHANGED events.
 */

import { on, Events } from '../engine/events.js';
import { stock, prices } from '../resources.js';
import { PHASE, startWave, getWaveNumber, getPhase } from '../phases/phases.js';

// ── Element refs ──────────────────────────────────────────────────────────────
let _hud        = null;
let _resBar     = null;
let _waveInfo   = null;
let _startBtn   = null;
let _intelPanel = null;
let _msgLog     = null;

// ── Init ──────────────────────────────────────────────────────────────────────

export function initHUD(gs) {
  _hud = document.getElementById('hud');
  if (!_hud) return;

  _hud.innerHTML = '';

  // ── Top bar ────────────────────────────────────────────────────────────────
  const topBar = _el('div', 'top-bar');
  _hud.appendChild(topBar);

  // Resource bar
  _resBar = _el('div', 'resource-bar');
  topBar.appendChild(_resBar);

  // Wave info + start button
  _waveInfo = _el('div', 'wave-info');
  topBar.appendChild(_waveInfo);

  _startBtn = _el('button', 'start-wave-btn');
  _startBtn.textContent = 'Start Wave';
  _startBtn.addEventListener('click', () => {
    if (getPhase() === PHASE.PLANNING) startWave();
  });
  topBar.appendChild(_startBtn);

  // ── Intel panel (right side) ───────────────────────────────────────────────
  _intelPanel = _el('div', 'intel-panel');
  _hud.appendChild(_intelPanel);
  _buildIntelPanel();

  // ── Message log (bottom-left) ─────────────────────────────────────────────
  _msgLog = _el('div', 'message-log');
  _hud.appendChild(_msgLog);

  // ── Event listeners ────────────────────────────────────────────────────────
  on(Events.RESOURCES_CHANGED, () => _updateResBar());
  on(Events.PHASE_CHANGED,     (d) => _updateWaveUI(d));
  on(Events.WAVE_WARNING,      (d) => _logMessage(`⚠️ Wave ${d.wave} incoming in 10 seconds!`, 'warning'));
  on(Events.WAVE_START,        (d) => _logMessage(`⚔️ Wave ${d.wave} has begun!`, 'danger'));
  on(Events.WAVE_ENDED,        (d) => _logMessage(`✅ Wave ${d.wave} survived!`, 'success'));
  on(Events.BUILDING_DESTROYED,(d) => _logMessage(`🔥 ${d.building.type} destroyed!`, 'danger'));
  on(Events.CITIZEN_DIED,      ()  => _logMessage('💀 A citizen has died.', 'danger'));
  on(Events.GAME_OVER,         ()  => _showGameOver());

  // Initial render
  _updateResBar();
  _updateWaveUI({ phase: PHASE.PLANNING, wave: 0 });
}

// ── Resource bar ──────────────────────────────────────────────────────────────

const RES_ICONS = {
  wood:     '🪵', stone:    '🪨', food:  '🌾',
  gold:     '💰', iron:     '⛏️',  planks: '🪵📦',
  bricks:   '🧱', flour:    '🌾📦', bread: '🍞',
  iron_bar: '🔩', steel:    '⚙️',
};

function _updateResBar() {
  if (!_resBar) return;
  _resBar.innerHTML = '';
  for (const [key, icon] of Object.entries(RES_ICONS)) {
    const val = stock[key] ?? 0;
    if (val === 0 && !_alwaysShow(key)) continue;
    const chip = _el('span', 'res-chip');
    chip.title = _capitalise(key);
    chip.innerHTML = `${icon} <strong>${val}</strong>`;
    _resBar.appendChild(chip);
  }
  // Gold always shown
  const goldChip = _resBar.querySelector('[data-key="gold"]');
}

function _alwaysShow(key) {
  return ['wood', 'stone', 'food', 'gold'].includes(key);
}

// ── Wave UI ───────────────────────────────────────────────────────────────────

function _updateWaveUI({ phase, wave }) {
  if (!_waveInfo) return;

  const wn = getWaveNumber();
  switch (phase) {
    case PHASE.PLANNING:
      _waveInfo.textContent = wn === 0 ? 'Wave: Ready' : `Wave ${wn} complete`;
      _startBtn.disabled    = false;
      _startBtn.textContent = `Start Wave ${wn + 1}`;
      break;
    case PHASE.WARNING:
      _waveInfo.textContent = `⚠️ Wave ${wave} incoming…`;
      _startBtn.disabled    = true;
      _startBtn.textContent = 'Incoming…';
      break;
    case PHASE.WAVE:
      _waveInfo.textContent = `⚔️ Wave ${wave} in progress`;
      _startBtn.disabled    = true;
      _startBtn.textContent = 'Fight!';
      break;
    case PHASE.WAVE_END:
      _waveInfo.textContent = `Wave ${wave} ended`;
      _startBtn.disabled    = true;
      break;
  }
}

// ── Intel panel ───────────────────────────────────────────────────────────────

function _buildIntelPanel() {
  if (!_intelPanel) return;
  _intelPanel.innerHTML = '<h3>Intel</h3>';

  const table = _el('table', 'intel-table');
  const rows = [
    ['Next Wave', '—'],
    ['Citizens',  '—'],
    ['Buildings', '—'],
  ];
  for (const [label, val] of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${label}</td><td class="intel-val">${val}</td>`;
    table.appendChild(tr);
  }
  _intelPanel.appendChild(table);
}

export function updateIntelPanel(gs) {
  if (!_intelPanel) return;
  const vals = _intelPanel.querySelectorAll('.intel-val');
  if (vals.length < 3) return;
  vals[0].textContent = getPhase() === PHASE.PLANNING
    ? `Wave ${getWaveNumber() + 1}`
    : `Wave ${getWaveNumber()}`;
  vals[1].textContent = gs.citizens.length;
  vals[2].textContent = gs.buildings.filter(b => b.isBuilt).length;
}

// ── Message log ───────────────────────────────────────────────────────────────

const MAX_LOG_MESSAGES = 6;

function _logMessage(text, type = 'info') {
  if (!_msgLog) return;
  const entry = _el('div', `log-entry log-${type}`);
  entry.textContent = text;
  _msgLog.prepend(entry);
  // Trim old messages
  while (_msgLog.children.length > MAX_LOG_MESSAGES) {
    _msgLog.removeChild(_msgLog.lastChild);
  }
  // Auto-fade after 6 seconds
  setTimeout(() => entry.classList.add('log-fade'), 4000);
  setTimeout(() => entry.remove(),                   6000);
}

// ── Game over ─────────────────────────────────────────────────────────────────

function _showGameOver() {
  const overlay = document.getElementById('game-over') ?? _el('div', 'game-over');
  overlay.id = 'game-over';
  overlay.innerHTML = `
    <h1>GAME OVER</h1>
    <p>You survived <strong>${getWaveNumber()}</strong> wave(s).</p>
    <button id="restart-btn">Restart</button>
  `;
  document.body.appendChild(overlay);
  document.getElementById('restart-btn')?.addEventListener('click', () => location.reload());
}

// ── Build panel tab switching (wired from style.css tabs) ─────────────────────

export function initBuildPanel(onSelectBuilding) {
  const panel = document.querySelector('.build-panel');
  if (!panel) return;

  // Tab buttons
  panel.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      panel.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      panel.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      const target = panel.querySelector(`#tab-${btn.dataset.tab}`);
      if (target) target.classList.add('active');
    });
  });

  // Building buttons
  panel.querySelectorAll('.build-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.building;
      if (type && onSelectBuilding) onSelectBuilding(type);
    });
  });
}

// ── Utility ───────────────────────────────────────────────────────────────────

function _el(tag, className) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  return el;
}

function _capitalise(str) {
  return str.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
