/**
 * Runs the game's real browser client (../../src/api.js) against the real API,
 * with a tiny fake window/localStorage, to check the whole login -> join -> save flow.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.js';

let t, api;
const realFetch = globalThis.fetch;

const memStore = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

before(async () => {
  t = await boot();
  globalThis.window = { localStorage: memStore(), sessionStorage: memStore() };
  // the browser resolves '/api/...' against the page; here we point it at the test server
  globalThis.fetch = (url, opts) => realFetch(String(url).startsWith('/') ? t.base + url : url, opts);
  api = await import('../../src/api.js');
});

after(async () => {
  globalThis.fetch = realFetch;
  await t.close();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  assert.equal(save.version, 0);

  const payload = {
    buildings: { japanese: [{ id: 'dojo', level: 2, stored: 1.5, readyAt: 0 }] },
    resources: { japanese: { food: 1, wood: 2, stone: 3, iron: 4, coin: 5 } },
    army: { troops: { japanese: { samurai: 3 } }, queue: { japanese: [] } },
    marches: [],
    settings: { sound: true },
  };
  const r1 = await api.putSave(payload, 0);
  assert.equal(r1.version, 1);
  ({ save } = await api.getSave());
  assert.deepEqual(save.resources.japanese, payload.resources.japanese);
  assert.equal(save.buildings.japanese[0].level, 2);
});

test('client: a second tab with an old version is told "stale"', async () => {
  const err = await api.putSave({ settings: { sound: false } }, 0).catch((e) => e); // server is at version 1
  assert.equal(err.status, 409);
  assert.equal(err.data.code, 'stale');
});

test('client: flushSave (tab closing) reaches the server', async () => {
  const before = (await api.getSave()).save.version;
  api.flushSave({ settings: { sound: false }, baseVersion: before });
  await sleep(300);
  const after = (await api.getSave()).save;
  assert.equal(after.version, before + 1);
  assert.deepEqual(after.settings, { sound: false });
});

test('client: logout forgets the token, login again gives the same progress ("remember me" off = session only)', async () => {
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

  globalThis.fetch = () => Promise.reject(new TypeError('fetch failed'));
  const down = await api.me().catch((e) => e);
  assert.equal(down.status, 0);
  assert.equal(await api.probeServer(200), false);
  globalThis.fetch = (url, opts) => realFetch(String(url).startsWith('/') ? t.base + url : url, opts);
});
