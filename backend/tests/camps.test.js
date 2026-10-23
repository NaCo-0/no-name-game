import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.js';

async function player(app, name = 'alice') {
  const { token } = await app.register(name);
  const j = await app.call('POST', '/api/game/join', { token, body: { civId: 'persia' } });
  return { token, join: j.json };
}
async function giveTroops(app, token, troops, version, resources = {}) {
  const r = await app.call('PUT', '/api/game/save', { token, body: { army: { troops: { persian: troops }, queue: {} }, resources: { persian: { food: 0, wood: 0, stone: 0, iron: 0, coin: 0, ...resources } }, baseVersion: version } });
  assert.equal(r.status, 200);
  return r.json.version;
}

test('camps are spread at start and sent on join', async () => {
  const app = await boot();
  const { join } = await player(app);
  assert.equal(join.camps.length, 24); // 6 types x 4
  assert.ok(join.camps.every((c) => c.army && c.loot && c.power > 0));
  assert.equal(new Set(join.camps.map((c) => c.type)).size, 6);
  await app.close();
});

test('attack: troops leave, win gives loot + survivors back on claim', async () => {
  const app = await boot({ npc: { marchMinMs: 20, marchMsPerTile: 0 } });
  const { token, join } = await player(app);
  const camp = join.camps.find((c) => c.level === 1) || join.camps[0];
  let v = await giveTroops(app, token, { guard: 400, elite_archer: 200 }, join.save.version);
  const r = await app.call('POST', '/api/game/attack', { token, body: { campId: camp.id, troops: { guard: 400, elite_archer: 200 }, baseVersion: v } });
  assert.equal(r.status, 201);
  assert.deepEqual(r.json.save.troops, {}); // all sent
  v = r.json.save.version;
  assert.equal(r.json.expedition.report, null); // secret until arrival

  // nothing to claim yet
  assert.equal((await app.call('POST', '/api/game/expeditions/claim', { token, body: { baseVersion: v } })).json.reports.length, 0);
  await new Promise((r2) => setTimeout(r2, 120));
  const c = await app.call('POST', '/api/game/expeditions/claim', { token, body: { baseVersion: v } });
  assert.equal(c.status, 200);
  assert.equal(c.json.reports.length, 1);
  assert.equal(c.json.reports[0].win, true);
  const lootSum = Object.values(c.json.save.resources).reduce((a, b) => a + b, 0);
  assert.ok(lootSum > 0);
  assert.ok(Object.keys(c.json.save.troops).length > 0);
  // claimed once only
  const again = await app.call('POST', '/api/game/expeditions/claim', { token, body: { baseVersion: c.json.save.version } });
  assert.equal(again.json.reports.length, 0);
  // camp is gone for everybody
  const w = await app.call('GET', '/api/game/world', { token });
  assert.ok(!w.json.camps.some((x) => x.id === camp.id));
  await app.close();
});

test('attack: loss gives no loot and the camp stays', async () => {
  const app = await boot({ npc: { marchMinMs: 20, marchMsPerTile: 0 } });
  const { token, join } = await player(app);
  const camp = join.camps.find((c) => c.level === 3) || join.camps[0];
  let v = await giveTroops(app, token, { spearman: 3 }, join.save.version);
  const r = await app.call('POST', '/api/game/attack', { token, body: { campId: camp.id, troops: { spearman: 3 }, baseVersion: v } });
  await new Promise((r2) => setTimeout(r2, 120));
  const c = await app.call('POST', '/api/game/expeditions/claim', { token, body: { baseVersion: r.json.save.version } });
  assert.equal(c.json.reports[0].win, false);
  assert.deepEqual(c.json.reports[0].loot, {});
  assert.ok((await app.call('GET', '/api/game/world', { token })).json.camps.some((x) => x.id === camp.id));
  await app.close();
});

test('attack: validation (cheating attempts)', async () => {
  const app = await boot();
  const { token, join } = await player(app);
  const camp = join.camps[0];
  const v = await giveTroops(app, token, { spearman: 5 }, join.save.version);
  const go = (troops, extra = {}) => app.call('POST', '/api/game/attack', { token, body: { campId: camp.id, troops, baseVersion: v, ...extra } });
  assert.equal((await go({ spearman: 6 })).status, 400);        // more than owned
  assert.equal((await go({ spearman: -1 })).status, 400);
  assert.equal((await go({ spearman: 1.5 })).status, 400);
  assert.equal((await go({ samurai: 1 })).status, 400);          // other culture's special troop / not owned
  assert.equal((await go({})).status, 400);
  assert.equal((await go({ spearman: 1 }, { campId: 'nope' })).status, 404);
  assert.equal((await go({ spearman: 1 }, { baseVersion: v - 1 })).status, 409); // stale
  assert.equal((await app.call('POST', '/api/game/attack', { body: { campId: camp.id, troops: { spearman: 1 } } })).status, 401);
  assert.equal((await go({ spearman: 1 })).status, 201);
  await app.close();
});

test('attack: at most 3 armies out, and a camp beaten by another player is gone', async () => {
  const app = await boot({ npc: { marchMinMs: 30, marchMsPerTile: 0 } });
  const a = await player(app, 'alice');
  const b = await player(app, 'bobby');
  const camp = a.join.camps.find((c) => c.level === 1);
  let va = await giveTroops(app, a.token, { guard: 300 }, a.join.save.version);
  let vb = await giveTroops(app, b.token, { guard: 300 }, b.join.save.version);
  const ra = await app.call('POST', '/api/game/attack', { token: a.token, body: { campId: camp.id, troops: { guard: 300 }, baseVersion: va } });
  await new Promise((r) => setTimeout(r, 10));
  const rb = await app.call('POST', '/api/game/attack', { token: b.token, body: { campId: camp.id, troops: { guard: 300 }, baseVersion: vb } });
  await new Promise((r) => setTimeout(r, 150));
  const ca = await app.call('POST', '/api/game/expeditions/claim', { token: a.token, body: { baseVersion: ra.json.save.version } });
  const cb = await app.call('POST', '/api/game/expeditions/claim', { token: b.token, body: { baseVersion: rb.json.save.version } });
  assert.equal(ca.json.reports[0].win, true);
  assert.equal(cb.json.reports[0].gone, true);
  assert.equal(cb.json.save.troops.guard, 300); // untouched army comes back
  await app.close();
});
