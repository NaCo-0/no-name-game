/** Battle endpoints (own fetch helper, same token + error shape as src/api.js). */
const TOKEN_KEY = 'kingdoms.token';

const store = (kind) => { try { return window[kind]; } catch { return null; } };
const token = () => store('sessionStorage')?.getItem(TOKEN_KEY) || store('localStorage')?.getItem(TOKEN_KEY) || '';

async function request(method, path, body) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const tk = token();
  if (tk) headers.Authorization = `Bearer ${tk}`;
  let res;
  try {
    res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, cache: 'no-store' });
  } catch {
    const e = new Error('cannot reach the game server'); e.status = 0; e.data = {}; throw e;
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.ok === false) {
    const d = data && typeof data === 'object' ? data : {};
    if (d.error === 'revision_conflict' || d.error === 'stale') { d.code = 'stale'; d.version = d.revision ?? d.version; }
    const e = new Error(d.message || d.error || `request failed (${res.status})`);
    e.status = res.status; e.data = d;
    throw e;
  }
  return data;
}

export const getBattleConfig = () => request('GET', '/api/game/battle-config');
export const getDefense = () => request('GET', '/api/game/defense');
export const setDefense = (layout, baseVersion) => request('PUT', '/api/game/defense', { layout, baseVersion });
export const attackCastle = ({ castleId, troops, layout, baseVersion }) => request('POST', '/api/game/attack-castle', { castleId, troops, layout, baseVersion });
