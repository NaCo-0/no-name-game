/**
 * api.js  —  the game's client for the backend (backend/src).
 *
 *   login / register -> token   (kept in localStorage, or sessionStorage when "Remember me" is off)
 *   join(civId)      -> your castle + all castles + your save
 *   getSave / putSave / flushSave
 *
 * Only the login TOKEN is stored in the browser. Game data (buildings, resources, army ...)
 * lives on the server; the browser never keeps its own copy.
 */
const TOKEN_KEY = 'kingdoms.token';

export class ApiError extends Error {
  constructor(status, message, data = {}) {
    super(message);
    this.status = status; // 0 = server not reachable
    this.data = data;
  }
}

const store = (kind) => { try { return window[kind]; } catch { return null; } };

export function getToken() {
  return store('sessionStorage')?.getItem(TOKEN_KEY) || store('localStorage')?.getItem(TOKEN_KEY) || '';
}
export function setToken(token, remember = true) {
  clearToken();
  try { store(remember ? 'localStorage' : 'sessionStorage').setItem(TOKEN_KEY, token); } catch { /* storage blocked */ }
}
export function clearToken() {
  try { store('localStorage')?.removeItem(TOKEN_KEY); store('sessionStorage')?.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

async function request(method, path, body, { keepalive = false, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, keepalive, cache: 'no-store' });
  } catch {
    throw new ApiError(0, 'cannot reach the game server');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.ok === false) throw new ApiError(res.status, (data && data.error) || `request failed (${res.status})`, data || {});
  return data;
}

/** True when the game server answers (false on plain static hosting / server stopped). */
export async function probeServer(timeoutMs = 2500) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch('/api/game/status', { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) return false;
    const j = await r.json(); // throws on an HTML page -> not the game server
    return !!(j && j.ok);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function register(username, password, remember = true) {
  const d = await request('POST', '/api/auth/register', { username, password }, { auth: false });
  setToken(d.token, remember);
  return d.user;
}
export async function login(username, password, remember = true) {
  const d = await request('POST', '/api/auth/login', { username, password }, { auth: false });
  setToken(d.token, remember);
  return d.user;
}
export async function logout() {
  try { await request('POST', '/api/auth/logout', {}); } catch { /* token already invalid: fine */ }
  clearToken();
}
/** -> { user, culture }  (culture is null until the player has chosen a civilization) */
export const me = () => request('GET', '/api/auth/me');
/** First call chooses the civilization (once). Later calls ignore civId: the server's choice wins. */
export const join = (civId) => request('POST', '/api/game/join', { civId });
export const getSave = () => request('GET', '/api/game/save');

/** @returns {Promise<{version:number}>}  rejects with ApiError(409, data.code === 'stale') if another tab saved in between */
export const putSave = (save, baseVersion) => request('PUT', '/api/game/save', { ...save, baseVersion });

/** Save that survives the page closing (tab hidden / closed). Fire and forget. */
export function flushSave(save) {
  const token = getToken();
  if (!token) return;
  try {
    fetch('/api/game/save', { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(save) }).catch(() => {});
  } catch {
    try { navigator.sendBeacon(`/api/game/save?token=${encodeURIComponent(token)}`, new Blob([JSON.stringify(save)], { type: 'text/plain' })); } catch { /* nothing more to try */ }
  }
}

export const eventsUrl = () => `/api/game/events?token=${encodeURIComponent(getToken())}`;
