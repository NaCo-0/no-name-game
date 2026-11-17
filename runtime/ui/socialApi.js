/** Client for alliances, rallies and events (backend/src/social). Same token + error type as src/api.js. */
import { getToken, ApiError } from '../../src/api.js';

async function request(method, path, body) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try { res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, cache: 'no-store' }); }
  catch { throw new ApiError(0, 'cannot reach the game server'); }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.ok === false) {
    const b = data && typeof data === 'object' ? data : {};
    if (b.error === 'stale') { b.code = 'stale'; }
    throw new ApiError(res.status, b.message || b.error || `request failed (${res.status})`, b);
  }
  return data;
}
const get = (p) => request('GET', p);
const post = (p, b = {}) => request('POST', p, b);

// alliances
export const getAlliance = () => get('/api/alliance');
export const listAlliances = (q = '') => get('/api/alliances' + (q ? `?q=${encodeURIComponent(q)}` : ''));
export const createAlliance = (b) => post('/api/alliance', b);
export const joinAlliance = (allianceId) => post('/api/alliance/join', { allianceId });
export const cancelRequest = (allianceId) => post('/api/alliance/cancel-request', { allianceId });
export const answerRequest = (playerId, accept) => post('/api/alliance/answer', { playerId, accept });
export const leaveAlliance = () => post('/api/alliance/leave');
export const kickMember = (playerId) => post('/api/alliance/kick', { playerId });
export const setRole = (playerId, role) => post('/api/alliance/role', { playerId, role });
export const transferLeader = (playerId) => post('/api/alliance/transfer', { playerId });
export const saveSettings = (b) => post('/api/alliance/settings', b);
export const disbandAlliance = () => post('/api/alliance/disband');
// rallies (calls that change your troops need { baseVersion })
export const getRallies = () => get('/api/alliance/rallies');
export const getTargets = () => get('/api/alliance/targets');
export const createRally = (b) => post('/api/rally', b);
export const joinRally = (b) => post('/api/rally/join', b);
export const leaveRally = (b) => post('/api/rally/leave', b);
export const launchRally = (rallyId) => post('/api/rally/launch', { rallyId });
export const cancelRally = (b) => post('/api/rally/cancel', b);
export const claimRally = (baseVersion) => post('/api/rally/claim', { baseVersion });
// events
// the event clock can differ from this device's clock (admins may move it): keep the gap so countdowns match the server
export const getEvents = async () => { const d = await get('/api/events'); d.skew = (Number(d.now) || Date.now()) - Date.now(); return d; };
export const claimEvent = (b) => post('/api/events/claim', b);
// War Elephant (alliance hunt)
export const getElephant = () => get('/api/alliance/elephant');
export const elephantStart = (b) => post('/api/alliance/elephant/start', b);
export const elephantCancel = () => post('/api/alliance/elephant/cancel');
export const elephantDonate = (b) => post('/api/alliance/elephant/donate', b);   // { resources, baseVersion }
export const elephantClaim = (b) => post('/api/alliance/elephant/claim', b);     // { baseVersion }
// Province Conquest
export const getConquest = () => get('/api/conquest');
export const getConquestMap = () => get('/api/conquest/map');
export const getTower = (provinceId) => get('/api/conquest/tower?provinceId=' + encodeURIComponent(provinceId));
export const setTowerLayout = (b) => post('/api/conquest/tower/layout', b);        // { provinceId, layout }
export const reinforceTower = (b) => post('/api/conquest/tower/reinforce', b);     // { provinceId, troops, baseVersion }
export const withdrawTower = (b) => post('/api/conquest/tower/withdraw', b);       // { provinceId }
export const setRallyPlan = (b) => post('/api/rally/plan', b);                      // { rallyId, layout|null }
