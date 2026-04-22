// Lightweight pub/sub event bus

const listeners = {};

export const Events = {
  RESOURCES_CHANGED: 'RESOURCES_CHANGED',
  WAVE_WARNING:      'WAVE_WARNING',
  WAVE_START:        'WAVE_START',
  WAVE_ENDED:        'WAVE_ENDED',
  PHASE_CHANGED:     'PHASE_CHANGED',
  BUILDING_PLACED:   'BUILDING_PLACED',
  BUILDING_DESTROYED:'BUILDING_DESTROYED',
  ENEMY_DIED:        'ENEMY_DIED',
  CITIZEN_DIED:      'CITIZEN_DIED',
  GAME_OVER:         'GAME_OVER',
};

export function on(event, fn) {
  if (!listeners[event]) listeners[event] = [];
  listeners[event].push(fn);
}

export function off(event, fn) {
  if (!listeners[event]) return;
  listeners[event] = listeners[event].filter(f => f !== fn);
}

export function emit(event, data) {
  if (!listeners[event]) return;
  for (const fn of listeners[event]) fn(data);
}
