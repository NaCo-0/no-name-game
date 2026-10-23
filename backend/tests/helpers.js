import http from 'http';
import { createDb } from '../src/db.js';
import { createApp } from '../src/app.js';

/** Fake map: hands out spots along a line, so tests don't need a baked map. */
export function fakeSpawner() {
  return {
    mapKey: () => 'test-map',
    pickSpot: (civId, placed) => ({ tileX: 100 + placed.length * 10, tileY: 200 }),
    pickAnySpot: (placed) => ({ tileX: 300 + placed.length * 7, tileY: 400 }),
    makeNpcs: () => [{ key: 'npc_persia_0', name: 'Npc One', civId: 'persia', tileX: 50, tileY: 50 }],
  };
}

export async function boot(extra = {}) {
  const db = await createDb({ storage: ':memory:' });
  const config = { tokenTtlDays: 30, prod: false, ...extra.config };
  const { app, syncWorld, syncCamps, resolveDue, closeStreams } = createApp({ db, config, spawner: extra.spawner || fakeSpawner(), npc: extra.npc });
  await syncWorld();
  await syncCamps();
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, path, { token, body, raw } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  }
  const register = async (username, password = 'password123') => (await call('POST', '/api/auth/register', { body: { username, password } })).json;

  return {
    db, base, call, register, resolveDue,
    async close() {
      closeStreams();
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
      await db.sequelize.close();
    },
  };
}
