/**
 * src/ui/black_market_panel.js
 * Research tree UI for the Black Market building.
 * Three tabs: Industry / Defence / Population.
 * Each node card shows cost, prerequisites, unlock status, and a buy button.
 */

import { on, Events } from '../engine/events.js';
import { stock } from '../resources.js';
import {
  RESEARCH_NODES, getTabNodes, canResearch, purchaseResearch,
} from '../research/research_tree.js';

let _panel        = null;
let _visible      = false;
let _researchState = null;
let _gs            = null;
let _spawnCitizenFn = null;
let _activeTab    = 'industry';

// ── Init ──────────────────────────────────────────────────────────────────────

export function initBlackMarketPanel(researchState, gs, spawnCitizenFn) {
  _researchState  = researchState;
  _gs             = gs;
  _spawnCitizenFn = spawnCitizenFn;

  _panel = document.createElement('div');
  _panel.id        = 'bm-panel';
  _panel.className = 'floating-panel bm-panel hidden';
  _panel.innerHTML = `
    <div class="panel-header">
      <span>Black Market — Research</span>
      <button class="close-btn" id="bm-close">✕</button>
    </div>
    <div class="panel-tabs" id="bm-tabs">
      <button class="tab-btn active" data-tab="industry">Industry</button>
      <button class="tab-btn"        data-tab="defence">Defence</button>
      <button class="tab-btn"        data-tab="population">Population</button>
    </div>
    <div class="panel-body" id="bm-body"></div>
  `;
  document.body.appendChild(_panel);

  document.getElementById('bm-close')?.addEventListener('click', hideBlackMarketPanel);

  document.querySelectorAll('#bm-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#bm-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _activeTab = btn.dataset.tab;
      _renderTab();
    });
  });

  on(Events.RESOURCES_CHANGED, () => { if (_visible) _renderTab(); });
}

// ── Show / hide ───────────────────────────────────────────────────────────────

export function showBlackMarketPanel() {
  if (!_panel) return;
  _visible = true;
  _panel.classList.remove('hidden');
  _renderTab();
}

export function hideBlackMarketPanel() {
  _visible = false;
  _panel?.classList.add('hidden');
}

export function toggleBlackMarketPanel() {
  _visible ? hideBlackMarketPanel() : showBlackMarketPanel();
}

// ── Render ────────────────────────────────────────────────────────────────────

function _renderTab() {
  const body = document.getElementById('bm-body');
  if (!body || !_researchState) return;
  body.innerHTML = '';

  const nodes = getTabNodes(_activeTab);

  for (const node of nodes) {
    const unlocked    = _researchState.unlocked.has(node.id);
    const check       = canResearch(node.id, _researchState);
    const affordable  = check.ok;
    const locked      = !check.ok && check.reason?.startsWith('Requires');

    const card = document.createElement('div');
    card.className = [
      'research-card',
      unlocked   ? 'researched' : '',
      locked     ? 'locked'     : '',
      !unlocked && !locked && !affordable ? 'unaffordable' : '',
    ].filter(Boolean).join(' ');

    // Cost string
    const costParts = Object.entries(node.cost)
      .map(([k, v]) => `${v} ${_label(k)}`)
      .join(', ');

    // Prereq string
    const prereqStr = node.requires.length
      ? `Requires: ${node.requires.map(r => {
          const n = RESEARCH_NODES.find(x => x.id === r);
          return n?.name ?? r;
        }).join(', ')}`
      : '';

    card.innerHTML = `
      <div class="rc-header">
        <span class="rc-name">${node.name}</span>
        ${unlocked ? '<span class="rc-badge">✓</span>' : ''}
      </div>
      <p class="rc-desc">${node.description}</p>
      ${prereqStr ? `<p class="rc-prereq">${prereqStr}</p>` : ''}
      <div class="rc-footer">
        <span class="rc-cost">Cost: ${costParts}</span>
        ${!unlocked
          ? `<button class="rc-buy-btn" data-id="${node.id}" ${!affordable ? 'disabled' : ''}>
               ${locked ? '🔒 Locked' : (affordable ? 'Research' : '💸 Can\'t afford')}
             </button>`
          : ''}
      </div>
    `;

    body.appendChild(card);
  }

  // Bind buy buttons
  body.querySelectorAll('.rc-buy-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const ok = purchaseResearch(id, _researchState, _gs, _spawnCitizenFn);
      if (ok) _renderTab();
    });
  });
}

function _label(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
