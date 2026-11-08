import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, sleep } from './helpers.js';
import * as eco from '../src/economy.js';
import { Castle } from '../src/models.js';

let t;
before(async () => { t = await boot(); });
after(async () => { eco.setSpeed(1); await t.close(); });

const H = 3600000;
const C = 'persian';
const fresh = (now = 1_000_000) => eco.prepare(null, C, now);
const lvl = (d, id) => d.buildings[C].find((b) => b.id === id).level;
const up = (d, id, now) => eco.startUpgrade(d, C, id, now);
/** run the clock forward and settle */
const at = (d, now) => eco.settle(d, C, now);

test('economy: a new account gets 20 level-1 buildings, a starting package and one builder', () => {
  const d = fresh();
  assert.equal(d.buildings[C].length, 20);
  assert.ok(d.buildings[C].every((b) => b.level === 1));
  assert.deepEqual(d.resources[C], eco.START_RESOURCES);
  const v = eco.view(d, C, 1_000_000);
  assert.equal(v.slots, 1);
  assert.equal(v.hallLevel, 1);
  assert.equal(v.buildings.find((b) => b.id === 'farm_1').ratePerHour, eco.ratePerHour(1));
});

test('economy: a building can not be higher than the Main Hall', () => {
  let d = fresh();
  assert.throws(() => up(d, 'farm_1', 1_000_000), (e) => e.extra?.code === 'hall_level');
  up(d, 'main_hall', 1_000_000);
  d = at(d, 1_000_000 + 11_000); // 10 s later the hall is level 2
  assert.equal(lvl(d, 'main_hall'), 2);
  up(d, 'farm_1', 1_011_000); // now level 2 is allowed...
  d = at(d, 1_011_000 + 7_000);
  assert.equal(lvl(d, 'farm_1'), 2);
  assert.throws(() => up(d, 'farm_1', 1_020_000), (e) => e.extra?.code === 'hall_level'); // ...but not 3
  assert.equal(eco.view(d, C, 1_020_000).buildings.find((b) => b.id === 'farm_1').next.blocked, 'hall_level');
});

test('economy: an upgrade costs resources, takes time, and one building can not be queued twice', () => {
  const d = fresh();
  const cost = eco.upgradeCost('main_hall', 1);
  up(d, 'main_hall', 1_000_000);
  assert.equal(d.resources[C].wood, eco.START_RESOURCES.wood - cost.wood);
  assert.equal(d.build[C][0].endsAt, 1_000_000 + eco.upgradeSeconds('main_hall', 1) * 1000);
  assert.throws(() => up(d, 'main_hall', 1_000_001), (e) => e.extra?.code === 'upgrading' || e.code === 'queue_full');
  assert.equal(lvl(at(d, 1_005_000), 'main_hall'), 1); // not yet
  assert.equal(lvl(at(d, 1_011_000), 'main_hall'), 2);
});

test('economy: levels stop at 15, the second builder arrives with Main Hall 5', () => {
  const d = fresh();
  d.buildings[C].find((b) => b.id === 'main_hall').level = 15;
  assert.throws(() => up(d, 'main_hall', 1_000_000), (e) => e.extra?.code === 'max_level');
  assert.equal(eco.builderSlots(4), 1);
  assert.equal(eco.builderSlots(5), 2);
  for (const b of d.buildings[C]) b.level = 5;
  d.resources[C] = { food: 1e9, wood: 1e9, stone: 1e9, iron: 1e9, coin: 0 };
  d.buildings[C].find((b) => b.id === 'main_hall').level = 6;
  up(d, 'farm_1', 1_000_000);
  up(d, 'farm_2', 1_000_000);
  assert.throws(() => up(d, 'farm_3', 1_000_000), (e) => e.extra?.code === 'queue_full');
});

test('economy: production comes from timestamps, is capped at 12 hours, and a level-up changes the rate from that moment', () => {
  let d = fresh(0);
  d = at(d, 1 * H);
  const f1 = d.buildings[C].find((b) => b.id === 'farm_1');
  assert.ok(Math.abs(f1.stored - eco.ratePerHour(1)) < 1);
  d = at(d, 100 * H); // away for days: capped
  assert.equal(d.buildings[C].find((b) => b.id === 'farm_1').stored, eco.capacity(1));
  // level-up mid-way: 1h at level 1, then level 2
  let e = fresh(0);
  e.buildings[C].find((b) => b.id === 'main_hall').level = 3;
  up(e, 'farm_1', 0);
  const endsAt = e.build[C][0].endsAt; // a few seconds in
  e = at(e, endsAt + H);
  const f = e.buildings[C].find((b) => b.id === 'farm_1');
  const expected = (eco.ratePerHour(1) * endsAt) / H + eco.ratePerHour(2);
  assert.ok(Math.abs(f.stored - expected) < 2, `${f.stored} vs ${expected}`);
});

test('economy: spending collects what the producers hold first; collect() moves whole units only', () => {
  let d = fresh(0);
  d.resources[C] = { food: 0, wood: 0, stone: 0, iron: 0, coin: 0 };
  d = at(d, 8 * H);
  const n = eco.collect(d, C, 'farm_1');
  assert.ok(n >= eco.ratePerHour(1) * 8 - 1 && d.resources[C].food === n);
  assert.ok(d.buildings[C].find((b) => b.id === 'farm_1').stored < 1);
  // everything the 12 producers hold is used for the hall upgrade without a manual collect
  d.resources[C] = { food: 0, wood: 0, stone: 0, iron: 0, coin: 0 };
  assert.doesNotThrow(() => up(d, 'main_hall', 8 * H));
});

test('economy: not enough resources -> 409 with what is missing, nothing is spent', () => {
  const d = fresh();
  d.resources[C] = { food: 0, wood: 5, stone: 0, iron: 0, coin: 0 };
  let err;
  try { up(d, 'main_hall', 1_000_000); } catch (e) { err = e; }
  assert.equal(err.extra.code, 'not_enough_resources');
  assert.deepEqual(d.resources[C], { food: 0, wood: 5, stone: 0, iron: 0, coin: 0 });
  assert.equal(d.build[C].length, 0);
});

test('economy: training costs resources, is queued one after another, finishes into the army', () => {
  let d = fresh(0);
  eco.startTraining(d, C, 'spearman', 10, 0);
  eco.startTraining(d, C, 'spearman', 10, 0);
  const [a, b] = d.army.queue[C];
  assert.equal(a.endsAt, 10 * eco.TUNING.troopLevelSeconds[0] * 1000);
  assert.equal(b.endsAt, 2 * a.endsAt);
  assert.equal(d.resources[C].food, eco.START_RESOURCES.food - 2 * 10 * 20);
  d = at(d, a.endsAt);
  assert.equal(d.army.troops[C].spearman, 10);
  d = at(d, b.endsAt);
  assert.equal(d.army.troops[C].spearman, 20);
  assert.throws(() => eco.startTraining(d, C, 'berserker', 1, 0), (e) => e.extra?.code === 'unknown_troop'); // viking-only
  assert.throws(() => eco.startTraining(d, C, 'spearman', 0, 0), (e) => e.extra?.code === 'bad_count');
  assert.throws(() => eco.startTraining(d, C, 'spearman', 1.5, 0), (e) => e.extra?.code === 'bad_count');
  assert.throws(() => eco.startTraining(d, C, 'immortal_guard', 1e4, 0), (e) => e.extra?.code === 'not_enough_resources');
});

test('economy API: state -> upgrade -> time passes -> new level; the server decides everything', async () => {
  eco.setSpeed(100); // 100x faster: the 10 s hall upgrade takes 100 ms
  try {
    const p = await t.player('Builder', 'persia');
    const st = (await t.call('GET', '/api/game/state', { token: p.token })).json;
    assert.equal(st.buildings.length, 20);
    assert.equal(st.resources.wood, 1000);
    assert.equal((await t.call('POST', '/api/game/upgrade', { token: p.token, body: { id: 'farm_1' } })).json.code, 'hall_level');
    assert.equal((await t.call('POST', '/api/game/upgrade', { token: p.token, body: { id: 'nope' } })).status, 404);
    const r = await t.call('POST', '/api/game/upgrade', { token: p.token, body: { id: 'main_hall' } });
    assert.equal(r.status, 201);
    assert.equal(r.json.queue.length, 1);
    assert.ok(r.json.resources.wood < 1000);
    assert.equal((await t.call('POST', '/api/game/upgrade', { token: p.token, body: { id: 'main_hall' } })).status, 409);
    await sleep(180);
    const st2 = (await t.call('GET', '/api/game/state', { token: p.token })).json;
    assert.equal(st2.hallLevel, 2);
    assert.equal(st2.queue.length, 0);
    assert.ok(st2.version > st.version);
    // collect + train through the API
    const c = await t.call('POST', '/api/game/collect', { token: p.token, body: {} });
    assert.equal(c.status, 200);
    assert.equal((await t.call('POST', '/api/game/train', { token: p.token, body: { troopId: 'spearman', count: 5 } })).status, 201);
    assert.equal((await t.call('POST', '/api/game/train', { token: p.token, body: { troopId: 'spearman', count: -5 } })).status, 400);
    await sleep(350);
    const st3 = (await t.call('GET', '/api/game/state', { token: p.token })).json;
    assert.equal(st3.army.troops.persian.spearman, 5);
    // needs a login
    assert.equal((await t.call('POST', '/api/game/upgrade', { body: { id: 'main_hall' } })).status, 401);
  } finally { eco.setSpeed(1); }
});

test('economy + PvP: a castle attack uses the settled army of both sides and the loot goes through the treasury', async () => {
  const a = await t.player('Raider', 'persia');
  const b = await t.player('Holder', 'rome');
  const rich = { food: 50000, wood: 50000, stone: 50000, iron: 50000, coin: 50000 };
  // the defender's only army is a training batch that finished long ago: it must count as troops (settle), no revision games
  for (let i = 0; i < 5; i++) await t.grant(b.id, { army: { troops: { roman: {} }, queue: { roman: [{ id: 'old', troopId: 'spearman', count: 300, endsAt: 1 }] } }, resources: { roman: rich } });
  await t.grant(a.id, { army: { troops: { persian: { spearman: 5000 } }, queue: { persian: [] } }, resources: { persian: { food: 0, wood: 0, stone: 0, iron: 0, coin: 0 } } });
  const castle = await Castle.findOne({ where: { playerId: b.id } });
  const r = await t.call('POST', '/api/game/attack-castle', { token: a.token, body: { castleId: castle.key, troops: { spearman: 5000 } } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.ok(r.json.report.defenderPower > 0, 'the defender had troops');
  assert.equal(r.json.report.win, true);
  const loot = r.json.report.loot;
  assert.ok(Object.values(loot).some((n) => n > 0));
  const sa = (await t.call('GET', '/api/game/state', { token: a.token })).json;
  const sb = (await t.call('GET', '/api/game/state', { token: b.token })).json;
  for (const k of Object.keys(loot)) {
    assert.ok(sa.resources[k] >= loot[k] && sa.resources[k] <= loot[k] + 2000, `attacker got ${k}`);
    assert.ok(sb.resources[k] <= rich[k] - loot[k] + 5, `defender lost ${k}`);
  }
  assert.ok(sa.army.troops.persian.spearman < 5000 + 1); // the battle losses are in the server's army
  assert.equal(sa.buildings.length, 20); // the economy survived the battle write
});
