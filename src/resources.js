// Global resource stockpile and economy

import { emit, Events } from './engine/events.js';

export const stock = {
  wood: 50, stone: 30, food: 40, gold: 10,
  iron: 0, planks: 0, bricks: 0,
  flour: 0, bread: 0, iron_bar: 0, steel: 0,
};

export const BASE_PRICES = {
  wood: 2, stone: 3, food: 1, iron: 4,
  planks: 5, bricks: 7, flour: 3, bread: 5, steel: 12,
};

// Current prices (fluctuate each wave end)
export const prices = { ...BASE_PRICES };

export function add(resource, amount) {
  if (!(resource in stock)) return;
  stock[resource] = (stock[resource] || 0) + amount;
  emit(Events.RESOURCES_CHANGED, { resource, amount });
}

export function spend(resource, amount) {
  if ((stock[resource] || 0) < amount) return false;
  stock[resource] -= amount;
  emit(Events.RESOURCES_CHANGED, { resource, amount: -amount });
  return true;
}

export function canAfford(costs) {
  for (const [r, amt] of Object.entries(costs)) {
    if ((stock[r] || 0) < amt) return false;
  }
  return true;
}

export function spendAll(costs) {
  if (!canAfford(costs)) return false;
  for (const [r, amt] of Object.entries(costs)) {
    stock[r] -= amt;
  }
  emit(Events.RESOURCES_CHANGED, {});
  return true;
}

export function fluctuatePrices(rng) {
  for (const r of Object.keys(BASE_PRICES)) {
    prices[r] = Math.max(1, Math.floor(BASE_PRICES[r] * (0.8 + rng() * 0.4)));
  }
}

export function sellResource(resource, amount) {
  const available = Math.min(amount, stock[resource] || 0);
  if (available <= 0) return 0;
  stock[resource] -= available;
  const earned = available * (prices[resource] || 1);
  stock.gold += earned;
  emit(Events.RESOURCES_CHANGED, {});
  return earned;
}
