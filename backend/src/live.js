import { WebSocketServer } from 'ws';
import { verifyToken, playerFromToken } from './auth.js';
import { GameSave } from './models.js';

// playerId -> { socket, since, username, culture }
const online = new Map();
let presenceTimer = null;

export const isOnline = (id) => online.has(Number(id));
export const onlineIds = () => [...online.keys()];
export const onlineList = () => [...online.entries()].map(([id, v]) => ({ id, username: v.username, culture: v.culture, since: v.since }));

export function send(id, msg) {
  const c = online.get(Number(id));
  if (!c || c.socket.readyState !== 1) return false;
  c.socket.send(JSON.stringify(msg));
  return true;
}
export function broadcast(msg) {
  let n = 0;
  for (const id of online.keys()) if (send(id, msg)) n++;
  return n;
}
/** Faghat be bazikon-haye yek tamaddon (chat-e "Alliance"). */
export function sendToCulture(culture, msg) {
  let n = 0;
  for (const [id, c] of online) if (c.culture === culture && send(id, msg)) n++;
  return n;
}
export function kick(id, reason = 'kicked') {
  const c = online.get(Number(id));
  if (!c) return false;
  send(id, { type: 'kicked', reason });
  c.socket.close(4000, reason);
  online.delete(Number(id));
  schedulePresence();
  return true;
}

// Ghale-ye bazikon dar naghshe key = 'u_<id>' dare; bazi ba hamin ghale-haye offline ro kam-rang mikone.
const presenceMsg = () => ({ type: 'presence', ids: onlineIds().map((id) => `u_${id}`) });
export const broadcastPresence = () => broadcast(presenceMsg());
// reload-e sari nabayad bazikon ro offline neshun bede -> kami sabr
function schedulePresence() {
  clearTimeout(presenceTimer);
  presenceTimer = setTimeout(broadcastPresence, 1500);
  presenceTimer.unref?.();
}

export function closeAll() {
  clearTimeout(presenceTimer);
  for (const c of online.values()) { try { c.socket.terminate(); } catch { /* already closed */ } }
  online.clear();
}

export function attachLive(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', async (socket, req) => {
    socket.on('error', () => {});
    const url = new URL(req.url, 'http://x');
    const player = await playerFromToken(verifyToken(url.searchParams.get('token'), 'player'));
    if (!player || player.banned) return socket.close(4001, 'unauthorized');
    const save = await GameSave.findOne({ where: { playerId: player.id }, attributes: ['culture'] });
    const old = online.get(player.id);
    if (old) { try { old.socket.close(4002, 'replaced'); } catch { /* ignore */ } } // yek session baraye har bazikon
    online.set(player.id, { socket, since: new Date().toISOString(), username: player.username, culture: save?.culture ?? null });
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });
    socket.on('close', () => {
      if (online.get(player.id)?.socket === socket) { online.delete(player.id); schedulePresence(); }
    });
    send(player.id, { type: 'hello', id: player.id });
    broadcastPresence();
  });
  const timer = setInterval(() => {
    for (const s of wss.clients) {
      if (!s.isAlive) { s.terminate(); continue; }
      s.isAlive = false; s.ping();
    }
  }, 30000);
  timer.unref?.();
  wss.on('close', () => clearInterval(timer));
  return wss;
}
