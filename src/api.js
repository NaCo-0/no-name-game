/**
 * api.js  —  the game's client for the backend (backend/src).
 *
 *   login / register -> token   (kept in localStorage, or sessionStorage when "Remember me" is off)
 *   join(civId)      -> your castle + all castles + your save
 *   getSave / putSave / flushSave
 *   getChat / sendChat           (every message is also recorded for the admin panel)
 *   socketUrl()                  (WebSocket: other players' castles, camps, chat, admin messages)
 *
 * Only the login TOKEN is stored in the browser. Game data (buildings, resources, army ...)
 * lives on the server; the browser never keeps its own copy.
 *
 * The server stores the save as { culture, data, revision }. The game works with the flat shape
 * { version, buildings, resources, army, marches, settings }, so this file converts between the two.
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
  if (!res.ok || !data || data.ok === false) {
    const body = data && typeof data === 'object' ? data : {};
    // another tab / the admin saved in between: the game shows its "opened elsewhere" screen for code === 'stale'
    if (body.error === 'revision_conflict' || body.error === 'stale') { body.code = 'stale'; body.version = body.revision ?? body.version; }
    throw new ApiError(res.status, body.message || FRIENDLY[body.error] || body.error || `request failed (${res.status})`, body);
  }
  return data;
}

const FRIENDLY = {
  bad_credentials: 'wrong username or password',
  bad_username: 'username: 3-24 letters, digits or _',
  bad_password: 'password: 8-72 characters',
  username_taken: 'this username is taken',
  unauthorized: 'not logged in',
  banned: 'account banned',
  muted: 'you are muted',
  slow_down: 'you are sending messages too fast',
  too_many_requests: 'too many attempts: try again in a few minutes',
};

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
/** Server shape { culture, data, revision } -> the flat shape game.html uses. */
const toSave = (d) => {
  const x = d.data || {};
  return {
    culture: d.culture, version: d.revision,
    buildings: x.buildings ?? null, resources: x.resources ?? null, army: x.army ?? null,
    marches: x.marches ?? [], settings: x.settings ?? {},
  };
};
export const getSave = async () => ({ save: toSave(await request('GET', '/api/game/save')) });

/** @returns {Promise<{version:number}>}  rejects with ApiError(409, data.code === 'stale') if another tab (or the admin) saved in between */
export const putSave = (save, baseVersion) => request('PUT', '/api/game/save', { data: save, revision: baseVersion });

/** Save that survives the page closing (tab hidden / closed). Fire and forget. `save.baseVersion` = the version we last saw. */
export function flushSave(save) {
  const token = getToken();
  if (!token) return;
  const { baseVersion, ...data } = save;
  const body = JSON.stringify({ data, revision: baseVersion });
  try {
    fetch('/api/game/save', { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body }).catch(() => {});
  } catch {
    try { navigator.sendBeacon(`/api/game/save?token=${encodeURIComponent(token)}`, new Blob([body], { type: 'text/plain' })); } catch { /* nothing more to try */ }
  }
}

/** NPC camps. The server decides everything; the game must save first and sends its save version (baseVersion). */
export const getExpeditions = () => request('GET', '/api/game/expeditions');
/** @param {{campId:string, troops:Object<string,number>, baseVersion:number}} a  -> { expedition, save:{version, troops}, now } */
export const attackCamp = (a) => request('POST', '/api/game/attack', a);
/** Armies that are back hand over survivors + loot. -> { save:{version, troops, resources}, reports, now } */
export const claimExpeditions = (baseVersion) => request('POST', '/api/game/expeditions/claim', { baseVersion });

/** Chat. channel: 'global' (everybody) or 'civ' (only your civilization). */
export const getChat = (channel = 'global', limit = 50) => request('GET', `/api/game/chat?channel=${encodeURIComponent(channel)}&limit=${limit}`);
export const sendChat = (channel, text) => request('POST', '/api/game/chat', { channel, text });

/** Live connection (ws://host/ws?token=...): castle, camp, campGone, expedition, presence, chat, chat_deleted, save_changed, admin_message, kicked. */
export const socketUrl = () => {
  const loc = window.location;
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws?token=${encodeURIComponent(getToken())}`;
};
