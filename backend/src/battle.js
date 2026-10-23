/**
 * Battle calculation (pure functions, no database). PLACEHOLDER formula: the real one
 * (formations etc.) will replace `fight`; everything else only uses its result shape.
 *
 * An army is { troopId: count }. Result:
 *   { win, attackerPower, defenderPower, attackerSurvivors: {troopId: count}, attackerLosses: {...} }
 */
import { TROOPS } from './troops.js';
import { UNIT_POWER, COUNTERS, COUNTER_BONUS } from './npcConfig.js';

/** Share of each class in an army (by power), e.g. { spear: 0.6, archer: 0.4 }. */
function classShares(army) {
  const by = {};
  let total = 0;
  for (const [id, n] of Object.entries(army)) {
    const t = TROOPS.get(id);
    if (!t || n <= 0) continue;
    const p = n * UNIT_POWER[t.level];
    by[t.cls] = (by[t.cls] || 0) + p;
    total += p;
  }
  for (const k of Object.keys(by)) by[k] /= total || 1;
  return by;
}

/** Total power of `army`, with the class counters against `enemy` applied. */
export function armyPower(army, enemy) {
  const enemyShare = classShares(enemy);
  let power = 0;
  for (const [id, n] of Object.entries(army)) {
    const t = TROOPS.get(id);
    if (!t || n <= 0) continue;
    // classes this class counters / is countered by, weighted by how much of the enemy they are
    const strong = enemyShare[COUNTERS[t.cls]] || 0;
    const weak = Object.entries(COUNTERS).reduce((s, [c, beats]) => s + (beats === t.cls ? enemyShare[c] || 0 : 0), 0);
    const mult = 1 + COUNTER_BONUS * strong - COUNTER_BONUS * weak;
    power += n * UNIT_POWER[t.level] * mult;
  }
  return power;
}

const scale = (army, keep) => {
  const out = {};
  for (const [id, n] of Object.entries(army)) {
    const k = Math.floor(n * keep + 1e-9);
    if (k > 0) out[id] = k;
  }
  return out;
};
const sub = (a, b) => {
  const out = {};
  for (const [id, n] of Object.entries(a)) {
    const d = n - (b[id] || 0);
    if (d > 0) out[id] = d;
  }
  return out;
};

export function fight(attacker, defender) {
  const a = armyPower(attacker, defender);
  const d = armyPower(defender, attacker);
  const win = a > d;
  let keep;
  if (win) {
    const r = d / a; // 0 = walkover, ~1 = very close
    keep = 1 - Math.min(0.9, 0.6 * r * r);
  } else {
    const r = d > 0 ? a / d : 0;
    keep = Math.max(0, 0.3 * r * r); // a lost battle: only a few escape
  }
  const attackerSurvivors = scale(attacker, keep);
  return { win, attackerPower: Math.round(a), defenderPower: Math.round(d), attackerSurvivors, attackerLosses: sub(attacker, attackerSurvivors) };
}
