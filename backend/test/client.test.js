/**
 * Runs the game's real browser client (../../src/api.js) against the real server,
 * with a tiny fake window/localStorage: login -> join -> save -> chat -> attack.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, sleep } from './helpers.js';

let t, api;
const realFetch = globalThis.fetch;
const memStore = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const viaServer = (url, opts) => realFetch(String(url).startsWith('/') ? t.base + url : url, opts);

before(async () => {
  t = await boot({ npc: { marchMinMs: 20, marchMsPerTile: 0 } });
  globalThis.window = { localStorage: memStore(), sessionStorage: memStore(), location: { protocol: 'http:', host: t.base.replace('http://', '') } };
  globalThis.fetch = viaServer; // the browser resolves '/api/...' against the page; here we point it at the test server
  api = await import('../../src/api.js');
});
after(async () => {
  globalThis.fetch = realFetch;
  await t.close();
});

test('client: server is detected', async () => {
  assert.equal(await api.probeServer(), true);
});

test('client: register stores only the token, civilization is chosen once, save round-trips', async () => {
  const user = await api.register('ClientHero', 'password123', true);
  assert.equal(user.username, 'ClientHero');
  assert.ok(window.localStorage.getItem('kingdoms.token'));
  assert.equal(window.sessionStorage.getItem('kingdoms.token'), null);

  assert.equal((await api.me()).culture, null);
  const joined = await api.join('japan');
  assert.equal(joined.you.civId, 'japan');
  assert.equal((await api.join('rome')).you.civId, 'japan'); // cannot switch

  let { save } = await api.getSave();
  assert.equal(save.culture, 'japanese');
  const v0 = save.version;
  assert.equal(save.buildings, null); // never saved: the game builds its starting state

  const payload = {
    buildings: { japanese: [{ id: 'dojo', level: 2, stored: 1.5, readyAt: 0 }] },
    resources: { japanese: { food: 1, wood: 2, stone: 3, iron: 4, coin: 5 } },
    army: { troops: { japanese: { samurai: 3 } }, queue: { japanese: [] } },
    marches: [],
    settings: { sound: true },
  };
  const r1 = await api.putSave(payload, v0);
  assert.equal(r1.version, v0 + 1);
  ({ save } = await api.getSave());
  assert.deepEqual(save.resources.japanese, payload.resources.japanese);
  assert.equal(save.buildings.japanese[0].level, 2);
  assert.equal(save.version, v0 + 1);
});

test('client: a second tab with an old version is told "stale" (code, version)', async () => {
  const cur = (await api.getSave()).save.version;
  const err = await api.putSave({ settings: { sound: false } }, cur - 1).catch((e) => e);
  assert.equal(err.status, 409);
  assert.equal(err.data.code, 'stale');
  assert.equal(err.data.version, cur);
});

test('client: flushSave (tab closing) reaches the server', async () => {
  const before = (await api.getSave()).save.version;
  api.flushSave({ settings: { sound: false }, baseVersion: before });
  await sleep(300);
  const after = (await api.getSave()).save;
  assert.equal(after.version, before + 1);
  assert.deepEqual(after.settings, { sound: false });
});

test('client: logout forgets the token; login again gives the same progress ("remember me" off = session only)', async () => {
  await api.logout();
  assert.equal(window.localStorage.getItem('kingdoms.token'), null);
  assert.equal(api.getToken(), '');
  await assert.rejects(api.me(), (e) => e.status === 401);
  await api.login('clienthero', 'password123', false);
  assert.equal(window.localStorage.getItem('kingdoms.token'), null);
  assert.ok(window.sessionStorage.getItem('kingdoms.token'));
  const { save } = await api.getSave();
  assert.equal(save.culture, 'japanese');
  assert.equal(save.resources.japanese.coin, 5);
});

test('client: wrong password and unreachable server give clear errors', async () => {
  const bad = await api.login('clienthero', 'wrong-password', true).catch((e) => e);
  assert.equal(bad.status, 401);
  assert.match(bad.message, /wrong username or password/);
  globalThis.fetch = () => Promise.reject(new TypeError('fetch failed'));
  const down = await api.me().catch((e) => e);
  assert.equal(down.status, 0);
  assert.equal(await api.probeServer(200), false);
  globalThis.fetch = viaServer;
  await api.login('clienthero', 'password123', true);
});

test('client: chat is sent, read back and rate limited with a readable message', async () => {
  await api.sendChat('global', 'hello from the client');
  const { messages } = await api.getChat('global');
  assert.ok(messages.some((m) => m.text === 'hello from the client' && m.username === 'ClientHero'));
  const err = await api.sendChat('global', 'too fast').catch((e) => e);
  assert.equal(err.status, 429);
  assert.match(err.message, /too fast/);
  assert.match(api.socketUrl(), /^ws:\/\/127\.0\.0\.1:\d+\/ws\?token=/);
});

test('client: attack a camp, collect survivors + loot (real api.js)', async () => {
  const j = await api.join();
  const camp = j.camps.find((c) => c.level === 1);
  assert.ok(camp);
  let v = (await api.putSave({ army: { troops: { japanese: { samurai: 200, yumi_archer: 100 } }, queue: {} } }, (await api.getSave()).save.version)).version;
  const r = await api.attackCamp({ campId: camp.id, troops: { samurai: 200, yumi_archer: 100 }, baseVersion: v });
  assert.equal(r.save.troops.samurai, undefined);
  assert.equal((await api.getExpeditions()).expeditions.length, 1);
  await sleep(150);
  const c = await api.claimExpeditions(r.save.version);
  assert.equal(c.reports.length, 1);
  assert.ok(c.save.version > r.save.version);
  await assert.rejects(api.attackCamp({ campId: camp.id, troops: { samurai: 1 }, baseVersion: v }), (e) => e.status === 409 && e.data.code === 'stale');
});
