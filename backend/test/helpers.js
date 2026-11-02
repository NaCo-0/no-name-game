// Test-ha dar yek process-e joda ejra mishan (har file) -> har file ye database-e :memory: dare.
process.env.DB_STORAGE = ':memory:';
process.env.JWT_SECRET = 'test-secret';
process.env.AUTH_RATE_LIMIT = process.env.AUTH_RATE_LIMIT || '1000';
process.env.ADMIN_LOGIN_LIMIT = process.env.ADMIN_LOGIN_LIMIT || '1000';

import http from 'node:http';
import { WebSocket } from 'ws';

const { initDb, AdminUser } = await import('../src/models.js');
const { createApp } = await import('../src/app.js');
const { attachLive, closeAll } = await import('../src/live.js');
const { hashPassword } = await import('../src/auth.js');

/** Naghshe-ye saghteh: jay-ha rooye yek khat, ta test-ha be public/map.json niaz nadashte bashan. */
export function fakeSpawner() {
  return {
    mapKey: () => 'test-map',
    pickSpot: (civId, placed) => ({ tileX: 100 + placed.length * 10, tileY: 200 }),
    pickAnySpot: (placed) => ({ tileX: 300 + placed.length * 7, tileY: 400 }),
    makeNpcs: () => [{ key: 'npc_persia_0', name: 'Npc One', civId: 'persia', tileX: 50, tileY: 50 }],
  };
}

export async function boot({ npc, spawner } = {}) {
  await initDb();
  await AdminUser.create({ username: 'root', role: 'superadmin', passwordHash: await hashPassword('RootPass123') });
  await AdminUser.create({ username: 'mod', role: 'moderator', passwordHash: await hashPassword('ModPass1234') });
  await AdminUser.create({ username: 'watcher', role: 'viewer', passwordHash: await hashPassword('WatchPass123') });
  const app = createApp({ spawner: spawner || fakeSpawner(), npc });
  const { world } = app.locals;
  await world.syncWorld();
  await world.syncCamps();
  const server = http.createServer(app);
  attachLive(server);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  async function call(method, path, { token, body, raw, headers } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  }
  const register = async (username, password = 'password123') => (await call('POST', '/api/auth/register', { body: { username, password } })).json;
  const adminToken = async (username = 'root', password = 'RootPass123') => (await call('POST', '/api/admin/auth/login', { body: { username, password } })).json.token;
  /** Bazikon misaze + vared-e donya mishe (tamaddon: civId). */
  async function player(name, civId = 'persia') {
    const { token, user } = await register(name);
    const j = await call('POST', '/api/game/join', { token, body: { civId } });
    return { token, id: user.id, name, join: j.json };
  }
  /** WebSocket ke payam-ha ro jam mikone. */
  function socket(token) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`);
    const msgs = [];
    const waiters = [];
    const closed = new Promise((r) => ws.on('close', (code) => r(code)));
    ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      msgs.push(m);
      for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
    });
    const opened = new Promise((r) => { ws.on('open', r); ws.on('close', r); });
    const waitFor = (pred, ms = 3000) => {
      const hit = msgs.find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const w = { pred, resolve };
        waiters.push(w);
        setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); reject(new Error('timeout waiting for ws message')); } }, ms);
      });
    };
    return { ws, msgs, closed, opened, waitFor, close: () => ws.close() };
  }

  return {
    base, call, register, adminToken, player, socket, world,
    async close() {
      world.stopTicker();
      closeAll();
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
    },
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
