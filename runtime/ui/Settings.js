/**
 * Player settings, saved in localStorage (silently skipped if storage is blocked).
 * Listeners are told which key changed.
 */
const KEY = 'nonamegame.settings';

const DEFAULTS = {
  lang: null, // null = decide from the browser language
  showNames: true,
  nameScale: 1, // castle name plates
  uiScale: 1, // HUD size
  minimap: true,
};

let state = { ...DEFAULTS };
const listeners = new Set();

try {
  const raw = localStorage.getItem(KEY);
  if (raw) state = { ...DEFAULTS, ...JSON.parse(raw) };
} catch {
  /* ignore */
}

export const settings = {
  get: (k) => state[k],
  all: () => ({ ...state }),
  set(k, v) {
    if (state[k] === v) return;
    state[k] = v;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
    for (const cb of listeners) cb(k, v);
  },
  onChange(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};
