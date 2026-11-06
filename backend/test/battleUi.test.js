// The game client (runtime/ui/BattleSheets.js) re-implements the layout rules so the editor can
// validate while you type. These tests keep it identical to the server (src/battle.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoLayout as serverAuto, normalizeLayout } from '../src/battle.js';
import { publicConfig } from '../src/battleConfig.js';
import { TROOPS } from '../src/troops.js';
import {
  SLOTS, autoLayout, bestAutoLayout, layoutStats, stateFromLayout, layoutFromState, layoutArmy, formationMatchups,
} from '../../runtime/ui/BattleSheets.js';

const config = JSON.parse(JSON.stringify(publicConfig())); // what the client really gets: JSON over HTTP
const ids = [...TROOPS.keys()];

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function randomArmy(r) {
  const army = {};
  const kinds = 1 + Math.floor(r() * 6);
  for (let i = 0; i < kinds; i++) army[ids[Math.floor(r() * ids.length)]] = 1 + Math.floor(r() * (r() < 0.3 ? 400 : 40));
  return army;
}

test('client autoLayout == server autoLayout for random armies and every formation', () => {
  const r = rng(7);
  for (let i = 0; i < 300; i++) {
    const army = randomArmy(r);
    for (const f of Object.keys(config.formations)) {
      assert.deepEqual(autoLayout(army, f, config), serverAuto(army, f), `army ${JSON.stringify(army)} formation ${f}`);
    }
  }
});

test('a layout from autoLayout has no error and is accepted by the server', () => {
  const r = rng(11);
  for (let i = 0; i < 200; i++) {
    const army = randomArmy(r);
    for (const f of Object.keys(config.formations)) {
      const layout = autoLayout(army, f, config);
      const st = layoutStats(layout, config);
      let serverOk = true;
      try { normalizeLayout(layout, army); } catch { serverOk = false; }
      assert.equal(st.error === '', serverOk, `client says "${st.error}", server ok=${serverOk}: ${JSON.stringify(layout)}`);
    }
  }
});

test('layoutStats agrees with normalizeLayout on random (often invalid) layouts', () => {
  const r = rng(23);
  let valid = 0, invalid = 0;
  for (let i = 0; i < 4000; i++) {
    const army = randomArmy(r);
    const f = Object.keys(config.formations)[Math.floor(r() * 5)];
    const slots = Object.fromEntries(SLOTS.map((s) => [s, {}]));
    for (const id of Object.keys(army)) {
      if (r() < 0.2) continue;
      const s = SLOTS[Math.floor(r() * 4)];
      const cls = config.stats[id].cls;
      // keep one class per slot (the editor guarantees that), caps may be broken on purpose
      const other = Object.keys(slots[s])[0];
      if (other && config.stats[other].cls !== cls) continue;
      slots[s][id] = Math.max(0, Math.floor(army[id] * r()));
    }
    const layout = { formation: f, slots };
    const st = layoutStats(layout, config);
    // the editor never sends troops it does not own, so only compare caps + emptiness
    let serverOk = true;
    try { normalizeLayout(layout); } catch { serverOk = false; }
    assert.equal(st.error === '', serverOk, `client "${st.error}" vs server ok=${serverOk}: ${JSON.stringify(layout)}`);
    serverOk ? valid++ : invalid++;
  }
  assert.ok(valid > 50 && invalid > 50, `need both kinds of cases (valid ${valid}, invalid ${invalid})`);
});

test('state <-> layout round trip, and wrong-class troops are dropped', () => {
  const army = { spearman: 30, archer: 20, light_cavalry: 10 };
  const layout = autoLayout(army, 'wedge', config);
  assert.deepEqual(layoutFromState(stateFromLayout(layout, config), config), layout);
  assert.deepEqual(layoutArmy(layout), army);
  const st = stateFromLayout(layout, config);
  st.cls.S1 = 'cav'; // S1 now claims to be cavalry: spearmen in it are not valid any more
  assert.deepEqual(layoutFromState(st, config).slots.S1, {});
});

test('formation matchups: beats 2, weak to 2 (a cycle of 5)', () => {
  for (const f of Object.keys(config.formations)) {
    const m = formationMatchups(f, config);
    assert.equal(m.beats.length, 2);
    assert.equal(m.weak.length, 2);
  }
});

test('empty army: no crash, clear message', () => {
  const layout = autoLayout({}, 'wedge', config);
  assert.equal(layoutStats(layout, config).error, 'Place at least one soldier');
});

test('bestAutoLayout: keeps the preferred formation when it fits, otherwise finds one that does', () => {
  const r = rng(99);
  let switched = 0;
  const accepted = (l, army) => { try { normalizeLayout(l, army); return true; } catch { return false; } };
  for (let i = 0; i < 400; i++) {
    const army = randomArmy(r);
    const anyFits = Object.keys(config.formations).some((f) => accepted(serverAuto(army, f), army));
    const pref = Object.keys(config.formations)[Math.floor(r() * 5)];
    const best = bestAutoLayout(army, pref, config);
    if (accepted(serverAuto(army, pref), army)) assert.equal(best.formation, pref, 'preferred formation fits, so it must be kept');
    else if (anyFits) { assert.ok(accepted(best, army), 'some formation fits, so the result must be valid'); switched++; }
  }
  assert.ok(switched > 5, 'the switch path was exercised (' + switched + ')');
  // the 4-class army that has no valid wedge
  const army = { spearman: 60, archer: 40, light_cavalry: 20, swordsman: 25 };
  assert.ok(layoutStats(autoLayout(army, 'wedge', config), config).error);
  assert.equal(bestAutoLayout(army, 'wedge', config).formation, 'shield_wall');
});
