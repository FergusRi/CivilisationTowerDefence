/**
 * src/ui/barracks_panel.js
 * Barracks upgrade panel — shows current guard capacity level and
 * lets the player purchase the two Barracks upgrade tiers via research.
 */

import { on, Events } from '../engine/events.js';
import { canResearch, purchaseResearch } from '../research/research_tree.js';

let _panel         = null;
let _visible       = false;
let _researchState = null;
let _gs            = null;

// ── Init ──────────────────────────────────────────────────────────────────────

export function initBarracksPanel(researchState, gs) {
  _researchState = researchState;
  _gs            = gs;

  _panel = document.createElement('div');
  _panel.id        = 'barracks-panel';
  _panel.className = 'floating-panel barracks-panel hidden';
  _panel.innerHTML = `
    <div class="panel-header">
      <span>Barracks</span>
      <button class="close-btn" id="barracks-close">✕</button>
    </div>
    <div class="panel-body" id="barracks-body"></div>
  `;
  document.body.appendChild(_panel);

  document.getElementById('barracks-close')?.addEventListener('click', hideBarracksPanel);
  on(Events.RESOURCES_CHANGED, () => { if (_visible) _render(); });
}

// ── Show / hide ───────────────────────────────────────────────────────────────

export function showBarracksPanel() {
  if (!_panel) return;
  _visible = true;
  _panel.classList.remove('hidden');
  _render();
}

export function hideBarracksPanel() {
  _visible = false;
  _panel?.classList.add('hidden');
}

export function toggleBarracksPanel() {
  _visible ? hideBarracksPanel() : showBarracksPanel();
}

// ── Render ────────────────────────────────────────────────────────────────────

const UPGRADES = [
  {
    id:    'BARRACKS_UPGRADE_1',
    title: 'Trained Guards',
    desc:  'Guard Post capacity: 2 → 4',
    cost:  '45 Gold',
  },
  {
    id:    'BARRACKS_UPGRADE_2',
    title: 'Elite Guards',
    desc:  'Guard Post capacity: 4 → 6',
    cost:  '70 Gold',
  },
];

function _render() {
  const body = document.getElementById('barracks-body');
  if (!body || !_researchState) return;
  body.innerHTML = '';

  // Current guard capacity
  const cap = _gs?._guardCapacity ?? 2;
  const statRow = document.createElement('div');
  statRow.className = 'barracks-stat';
  statRow.innerHTML = `<span>Current Guard Capacity per Post:</span> <strong>${cap}</strong>`;
  body.appendChild(statRow);

  // Citizen combat stat
  const dmgBonus = _gs?._citizenDamageBonus ?? 0;
  const hpBonus  = _gs?._citizenHpBonus     ?? 0;
  const combatRow = document.createElement('div');
  combatRow.className = 'barracks-stat';
  combatRow.innerHTML = `<span>Citizen Bonus:</span> <strong>+${dmgBonus} dmg / +${hpBonus} HP</strong>`;
  body.appendChild(combatRow);

  body.appendChild(document.createElement('hr'));

  for (const upg of UPGRADES) {
    const unlocked   = _researchState.unlocked.has(upg.id);
    const check      = canResearch(upg.id, _researchState);

    const card = document.createElement('div');
    card.className = `barracks-card ${unlocked ? 'researched' : ''}`;
    card.innerHTML = `
      <div class="bc-title">${upg.title} ${unlocked ? '✓' : ''}</div>
      <div class="bc-desc">${upg.desc}</div>
      <div class="bc-footer">
        <span class="bc-cost">${upg.cost}</span>
        ${!unlocked
          ? `<button class="bc-buy-btn" data-id="${upg.id}" ${!check.ok ? 'disabled' : ''}>
               ${check.ok ? 'Upgrade' : (check.reason ?? 'Locked')}
             </button>`
          : ''}
      </div>
    `;
    body.appendChild(card);
  }

  // Also expose Militia Training research here
  const militiaId      = 'CITIZEN_COMBAT';
  const militiaUnlocked = _researchState.unlocked.has(militiaId);
  const militiaCheck   = canResearch(militiaId, _researchState);

  const mCard = document.createElement('div');
  mCard.className = `barracks-card ${militiaUnlocked ? 'researched' : ''}`;
  mCard.innerHTML = `
    <div class="bc-title">Militia Training ${militiaUnlocked ? '✓' : ''}</div>
    <div class="bc-desc">Citizens: +2 damage, +10 max HP</div>
    <div class="bc-footer">
      <span class="bc-cost">40 Gold</span>
      ${!militiaUnlocked
        ? `<button class="bc-buy-btn" data-id="${militiaId}" ${!militiaCheck.ok ? 'disabled' : ''}>
             ${militiaCheck.ok ? 'Research' : (militiaCheck.reason ?? 'Locked')}
           </button>`
        : ''}
    </div>
  `;
  body.appendChild(mCard);

  // Bind buttons
  body.querySelectorAll('.bc-buy-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => {
      const ok = purchaseResearch(btn.dataset.id, _researchState, _gs, null);
      if (ok) _render();
    });
  });
}
