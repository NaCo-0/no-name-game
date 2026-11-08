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

  // a player can only save marches + settings; the economy (buildings, resources, army) is the server's
  const payload = {
    buildings: { japanese: [{ id: 'main_hall', level: 9, stored: 1.5 }] },
    resources: { japanese: { food: 1e9, wood: 1e9, stone: 1e9, iron: 1e9, coin: 1e9 } },
    marches: [],
    settings: { sound: true },
  };
  const r1 = await api.putSave(payload, v0);
  assert.equal(r1.version, v0 + 1);
  ({ save } = await api.getSave());
  assert.equal(save.resources, null); // the cheat was ignored
  assert.equal(save.buildings, null);
  assert.deepEqual(save.settings, { sound: true });
  assert.equal(save.version, v0 + 1);
  assert.match(api.socketUrl(), /^ws:\/\/127\.0\.0\.1:\d+\/ws\?token=/);
});

test('client: the economy through the real api.js (state, upgrade, collect, train)', async () => {
  const st = await api.getState();
  assert.equal(st.buildings.length, 20);
  assert.equal(st.hallLevel, 1);
  const hall = st.buildings.find((b) => b.id === 'main_hall');
  assert.deepEqual(Object.keys(hall.next.cost).sort(), ['food', 'iron', 'stone', 'wood']); // coins are not an upgrade cost
  assert.ok(hall.next.seconds > 0 && hall.ratePerSec === 0);
  const farm = st.buildings.find((b) => b.id === 'farm_1');
  assert.ok(farm.ratePerSec > 0 && farm.cap > 0 && farm.next.blocked === 'hall_level');
  await assert.rejects(api.upgrade('farm_1'), (e) => e.status === 409 && e.data.code === 'hall_level');
  const up = await api.upgrade('main_hall');
  assert.equal(up.queue.length, 1);
  assert.ok(up.buildings.find((b) => b.id === 'main_hall').upgrading.endsAt > up.now);
  assert.ok(up.version > st.version);
  const col = await api.collect('farm_1');
  assert.ok(col.resources.food <= up.resources.food + 1);
  await assert.rejects(api.train('nope', 1), (e) => e.status === 400);
  const tr = await api.train('spearman', 3);
  assert.equal(tr.army.queue.japanese.length, 1);
});

test('client: attack a camp, collect survivors + loot (real api.js)', async () => {
  const j = await api.join();
  const camp = j.camps.find((c) => c.level === 1);
  assert.ok(camp);
  const v = await t.grant((await api.me()).user.id, { army: { troops: { japanese: { samurai: 200, yumi_archer: 100 } }, queue: {} } });
  const r = await api.attackCamp({ campId: camp.id, troops: { samurai: 200, yumi_archer: 100 }, baseVersion: v });
  assert.equal(r.save.troops.samurai, undefined);
  assert.equal((await api.getExpeditions()).expeditions.length, 1);
  await sleep(150);
  const c = await api.claimExpeditions(r.save.version);
  assert.equal(c.reports.length, 1);
  assert.ok(c.save.version > r.save.version);
  await assert.rejects(api.attackCamp({ campId: camp.id, troops: { samurai: 1 }, baseVersion: v }), (e) => e.status === 409 && e.data.code === 'stale');
});
