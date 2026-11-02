// Battle v5: pure unit tests (no database).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fight, simulate, autoLayout, normalizeLayout, layoutArmy, armyPower } from '../src/battle.js';
import { unitPower, publicConfig, FORMATIONS, COUNTERS } from '../src/battleConfig.js';
import { TROOPS } from '../src/troops.js';
import { CAMP_TYPES, CAMP_LEVELS } from '../src/npcConfig.js';

const GEN = new Map();
for (const t of TROOPS.values()) if (!t.culture) GEN.set(`${t.cls}:${t.level}`, t.id);
// Same as camps.makeCampArmy, but with a fixed cycle instead of random.
function campArmy(type, level) {
  const def = CAMP_TYPES[type], lv = CAMP_LEVELS[level], army = {};
  for (const [cls, share] of Object.entries(def.army)) {
    const n = Math.max(1, Math.round(lv.units * share));
    for (let i = 0; i < n; i++) { const id = GEN.get(`${cls}:${lv.troopLevels[i % lv.troopLevels.length]}`); army[id] = (army[id] || 0) + 1; }
  }
  return army;
}
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const lay = (formation, slots) => ({ formation, slots });

test('spearman power is 10 and camps have power > 0', () => {
  assert.equal(unitPower('spearman'), 10);
  for (const type of Object.keys(CAMP_TYPES)) assert.ok(Math.round(armyPower(campArmy(type, 1), {})) > 0);
});

test('deterministic: same input, same result', () => {
  const a = { guard: 40, archer: 30, cavalry: 10 }, d = campArmy('bandit', 3);
  assert.deepEqual(fight(a, d), fight(a, d));
});

test('survivors + losses == sent, whole numbers', () => {
  const a = { spearman: 37, swordsman: 21, light_cavalry: 13, archer: 9 }, d = campArmy('nomad', 2);
  const r = fight(a, d);
  for (const [id, n] of Object.entries(a)) assert.equal((r.attackerSurvivors[id] || 0) + (r.attackerLosses[id] || 0), n);
  for (const [id, n] of Object.entries(d)) assert.equal((r.defenderSurvivors[id] || 0) + (r.defenderLosses[id] || 0), n);
  for (const v of [...Object.values(r.attackerSurvivors), ...Object.values(r.defenderLosses)]) assert.ok(Number.isInteger(v));
  assert.ok(r.ticks <= 10 && r.log.length === r.ticks);
});

test('legacy camp scenarios still hold for every camp type', () => {
  for (const type of Object.keys(CAMP_TYPES)) {
    const r1 = fight({ guard: 400, elite_archer: 200 }, campArmy(type, 1));
    assert.equal(r1.win, true, type); assert.ok(sum(r1.attackerSurvivors) > 0);
    assert.equal(fight({ guard: 300 }, campArmy(type, 1)).win, true, type);
    assert.equal(fight({ spearman: 3 }, campArmy(type, 3)).win, false, type);
  }
});

test('counter cycle: the counter class wins an equal fight', () => {
  for (const [c, beats] of Object.entries(COUNTERS)) {
    const a = GEN.get(`${c}:2`), d = GEN.get(`${beats}:2`);
    const r = simulate(lay('wedge', { S1: { [a]: 100 } }), lay('wedge', { S1: { [d]: 100 } }));
    const back = simulate(lay('wedge', { S1: { [d]: 100 } }), lay('wedge', { S1: { [a]: 100 } }));
    assert.ok(sum(r.attackerSurvivors) > sum(back.attackerSurvivors), `${c} > ${beats}`);
  }
});

test('formation beats: exactly 2 each, and the bonus helps', () => {
  for (const [id, f] of Object.entries(FORMATIONS)) { assert.equal(f.beats.length, 2); assert.ok(!f.beats.includes(id)); assert.ok(sum(Object.values(f.caps)) >= 1); }
  const army = { S1: { spearman: 50 }, S4: { skirmisher: 25 } };
  const [x, y] = ['wedge', FORMATIONS.wedge.beats[0]];
  const good = simulate(lay(x, army), lay(y, army)), bad = simulate(lay(y, army), lay(x, army));
  assert.ok(sum(good.attackerSurvivors) > sum(bad.attackerSurvivors));
  assert.ok(good.win);
});

test('normalizeLayout: rejects mixed classes, over cap, unknown things; accepts valid', () => {
  assert.throws(() => normalizeLayout(lay('wedge', { S1: { spearman: 5, swordsman: 5 }, S2: { archer: 10 } })), (e) => e.status === 400);
  assert.throws(() => normalizeLayout(lay('wedge', { S1: { spearman: 90 }, S4: { archer: 10 } })), (e) => e.status === 400);
  assert.throws(() => normalizeLayout(lay('nope', { S1: { spearman: 1 } })), (e) => e.status === 400);
  assert.throws(() => normalizeLayout(lay('wedge', { S9: { spearman: 1 } })), (e) => e.status === 400);
  assert.throws(() => normalizeLayout(lay('wedge', { S1: { spearman: 1.5 } })), (e) => e.status === 400);
  assert.throws(() => normalizeLayout(lay('wedge', { S1: { spearman: 5 }, S2: { archer: 5 } }), { spearman: 4, archer: 5 }), (e) => e.status === 400);
  const ok = normalizeLayout(lay('wedge', { S1: { spearman: 5 }, S2: { light_cavalry: 3 }, S3: { swordsman: 2 }, S4: { archer: 2 } }));
  assert.equal(ok.formation, 'wedge');
});

test('autoLayout places every troop and respects caps when possible', () => {
  const mixed = { guard: 40, linebreaker: 30, cavalry: 20, archer: 30 };
  for (const f of Object.keys(FORMATIONS)) {
    assert.deepEqual(layoutArmy(autoLayout(mixed, f)), mixed, f);
    const two = { guard: 60, archer: 40 };
    assert.doesNotThrow(() => normalizeLayout(autoLayout(two, f)), f);
  }
  assert.doesNotThrow(() => normalizeLayout(autoLayout(mixed, 'wedge')));
});

test('publicConfig shape', () => {
  const c = publicConfig();
  assert.deepEqual(c.slots, ['S1', 'S2', 'S3', 'S4']);
  assert.equal(c.power.spearman, 10);
  assert.ok(c.stats.samurai.level === 4 && c.formations.crescent.caps.S4 > 0);
});
