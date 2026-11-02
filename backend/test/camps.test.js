import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, sleep } from './helpers.js';

let t;
before(async () => { t = await boot({ npc: { marchMinMs: 30, marchMsPerTile: 0, respawnMs: 60000 } }); });
after(async () => { await t.close(); });

async function giveTroops(token, troops, revision) {
  const r = await t.call('PUT', '/api/game/save', {
    token, body: { revision, data: { army: { troops: { persian: troops }, queue: {} }, resources: { persian: { food: 0, wood: 0, stone: 0, iron: 0, coin: 0 } } } },
  });
  assert.equal(r.status, 200);
  return r.json.revision;
}
const atk = (token, campId, troops, baseVersion) => t.call('POST', '/api/game/attack', { token, body: { campId, troops, baseVersion } });
const claim = (token, baseVersion) => t.call('POST', '/api/game/expeditions/claim', { token, body: { baseVersion } });

test('camps are spread at start and sent on join', async () => {
  const { join } = await t.player('Scout1');
  assert.equal(join.camps.length, 24); // 6 types x 4
  assert.ok(join.camps.every((c) => c.army && c.loot && c.power > 0));
  assert.equal(new Set(join.camps.map((c) => c.type)).size, 6);
});

test('attack: troops leave, a win gives loot + survivors back on claim, the camp is gone for everybody', async () => {
  const { token, join } = await t.player('Hero1');
  const camp = join.camps.find((c) => c.level === 1) || join.camps[0];
  let v = await giveTroops(token, { guard: 400, elite_archer: 200 }, join.save.version);
  const r = await atk(token, camp.id, { guard: 400, elite_archer: 200 }, v);
  assert.equal(r.status, 201);
  assert.deepEqual(r.json.save.troops, {}); // everything was sent
  v = r.json.save.version;
  assert.equal(r.json.expedition.report, null); // secret until it arrives
  assert.equal((await claim(token, v)).json.reports.length, 0); // still marching
  await sleep(250);
  const c = await claim(token, v);
  assert.equal(c.status, 200);
  assert.equal(c.json.reports.length, 1);
  assert.equal(c.json.reports[0].win, true);
  assert.ok(Object.values(c.json.save.resources).reduce((a, b) => a + b, 0) > 0);
  assert.ok(Object.keys(c.json.save.troops).length > 0);
  // the server's save has the loot and survivors
  const saved = (await t.call('GET', '/api/game/save', { token })).json;
  assert.equal(saved.revision, c.json.save.version);
  assert.ok(saved.data.resources.persian.coin + saved.data.resources.persian.food + saved.data.resources.persian.wood > 0);
  // claimed once only
  assert.equal((await claim(token, c.json.save.version)).json.reports.length, 0);
  assert.ok(!(await t.call('GET', '/api/game/world', { token })).json.camps.some((x) => x.id === camp.id));
});

test('attack: a loss gives no loot and the camp stays', async () => {
  const { token, join } = await t.player('Loser1');
  const camp = join.camps.find((c) => c.level === 3) || join.camps[0];
  const v = await giveTroops(token, { spearman: 3 }, join.save.version);
  const r = await atk(token, camp.id, { spearman: 3 }, v);
  await sleep(250);
  const c = await claim(token, r.json.save.version);
  assert.equal(c.json.reports[0].win, false);
  assert.deepEqual(c.json.reports[0].loot, {});
  assert.ok((await t.call('GET', '/api/game/world', { token })).json.camps.some((x) => x.id === camp.id));
});

test('attack: validation (cheating attempts)', async () => {
  const { token, join } = await t.player('Cheat1');
  const camp = join.camps[0];
  const v = await giveTroops(token, { spearman: 5 }, join.save.version);
  const go = (troops, extra = {}) => t.call('POST', '/api/game/attack', { token, body: { campId: camp.id, troops, baseVersion: v, ...extra } });
  assert.equal((await go({ spearman: 6 })).status, 400);   // more than owned
  assert.equal((await go({ spearman: -1 })).status, 400);
  assert.equal((await go({ spearman: 1.5 })).status, 400);
  assert.equal((await go({ samurai: 1 })).status, 400);    // other culture's troop
  assert.equal((await go({})).status, 400);
  assert.equal((await go({ spearman: 1 }, { campId: 'nope' })).status, 404);
  const stale = await go({ spearman: 1 }, { baseVersion: v - 1 });
  assert.equal(stale.status, 409); assert.equal(stale.json.error, 'stale');
  assert.equal((await t.call('POST', '/api/game/attack', { body: { campId: camp.id, troops: { spearman: 1 } } })).status, 401);
  assert.equal((await go({ spearman: 1 })).status, 201);
});

test('attack: at most 3 armies out, and a camp beaten by another player is gone', async () => {
  const a = await t.player('Rival1');
  const b = await t.player('Rival2');
  const camp = a.join.camps.find((c) => c.level === 1);
  const va = await giveTroops(a.token, { guard: 300 }, a.join.save.version);
  const vb = await giveTroops(b.token, { guard: 300 }, b.join.save.version);
  const ra = await atk(a.token, camp.id, { guard: 300 }, va);
  await sleep(10);
  const rb = await atk(b.token, camp.id, { guard: 300 }, vb);
  await sleep(300);
  const ca = await claim(a.token, ra.json.save.version);
  const cb = await claim(b.token, rb.json.save.version);
  assert.equal(ca.json.reports[0].win, true);
  assert.equal(cb.json.reports[0].gone, true);
  assert.equal(cb.json.save.troops.guard, 300); // the untouched army comes back

  // limit of 3 at the same time
  const c = await t.player('Limit1');
  let v = await giveTroops(c.token, { spearman: 10 }, c.join.save.version);
  for (let i = 0; i < 3; i++) { const r = await atk(c.token, c.join.camps[i].id, { spearman: 1 }, v); assert.equal(r.status, 201); v = r.json.save.version; }
  assert.equal((await atk(c.token, c.join.camps[3].id, { spearman: 1 }, v)).status, 409);
});

test('ws: the player is told when the army arrived and when it is home', async () => {
  const p = await t.player('Notify1');
  const s = t.socket(p.token);
  await s.waitFor((m) => m.type === 'hello');
  const v = await giveTroops(p.token, { guard: 50 }, p.join.save.version);
  const r = await atk(p.token, p.join.camps[0].id, { guard: 50 }, v);
  assert.equal(r.status, 201);
  t.world.startTicker(20);
  await s.waitFor((m) => m.type === 'expedition' && m.phase === 'arrived');
  await s.waitFor((m) => m.type === 'expedition' && m.phase === 'home');
  t.world.stopTicker();
  s.close();
});
