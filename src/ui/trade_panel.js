/**
 * src/ui/trade_panel.js
 * Floating sell panel for the Trade Terminal building.
 * Shows current market prices and lets the player sell resources for gold.
 */

import { stock, prices, sellResource } from '../resources.js';
import { on, Events } from '../engine/events.js';
import { BUILDING } from '../buildings/registry.js';

let _panel   = null;
let _visible = false;

// ── Init ──────────────────────────────────────────────────────────────────────

export function initTradePanel() {
  _panel = document.createElement('div');
  _panel.id        = 'trade-panel';
  _panel.className = 'floating-panel trade-panel hidden';
  _panel.innerHTML = `
    <div class="panel-header">
      <span>Trade Terminal</span>
      <button class="close-btn" id="trade-close">✕</button>
    </div>
    <div class="panel-body" id="trade-body"></div>
  `;
  document.body.appendChild(_panel);

  document.getElementById('trade-close')?.addEventListener('click', hideTradePanel);
  on(Events.RESOURCES_CHANGED, () => { if (_visible) _renderRows(); });
}

// ── Show / hide ───────────────────────────────────────────────────────────────

export function showTradePanel() {
  if (!_panel) initTradePanel();
  _visible = true;
  _panel.classList.remove('hidden');
  _renderRows();
}

export function hideTradePanel() {
  _visible = false;
  _panel?.classList.add('hidden');
}

export function toggleTradePanel() {
  _visible ? hideTradePanel() : showTradePanel();
}

// ── Render ────────────────────────────────────────────────────────────────────

const TRADEABLE = ['wood', 'stone', 'food', 'iron', 'planks', 'bricks', 'flour', 'bread', 'iron_bar', 'steel'];

function _renderRows() {
  const body = document.getElementById('trade-body');
  if (!body) return;
  body.innerHTML = '';

  for (const key of TRADEABLE) {
    const qty   = stock[key] ?? 0;
    const price = prices[key] ?? 1;

    const row = document.createElement('div');
    row.className = 'trade-row';
    row.innerHTML = `
      <span class="trade-res">${_label(key)}</span>
      <span class="trade-stock">×${qty}</span>
      <span class="trade-price">${price}g ea</span>
      <button class="trade-sell-btn" data-key="${key}" data-amt="1"  ${qty < 1  ? 'disabled' : ''}>Sell 1</button>
      <button class="trade-sell-btn" data-key="${key}" data-amt="10" ${qty < 10 ? 'disabled' : ''}>Sell 10</button>
      <button class="trade-sell-all-btn" data-key="${key}" ${qty < 1 ? 'disabled' : ''}>All</button>
    `;
    body.appendChild(row);
  }

  // Gold display
  const goldRow = document.createElement('div');
  goldRow.className = 'trade-gold-row';
  goldRow.innerHTML = `<span>💰 Gold: <strong>${stock.gold ?? 0}</strong></span>`;
  body.appendChild(goldRow);

  // Bind sell buttons
  body.querySelectorAll('.trade-sell-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      const amt = parseInt(btn.dataset.amt, 10);
      sellResource(key, amt);
    });
  });
  body.querySelectorAll('.trade-sell-all-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      const qty = stock[key] ?? 0;
      if (qty > 0) sellResource(key, qty);
    });
  });
}

function _label(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
