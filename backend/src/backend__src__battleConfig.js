/**
 * Battle v5: all balance numbers in one place (pure, no database).
 * Power = sqrt(EffHP * ATK * (1 + 0.6*AP) * Ability) * K / 1.03^(L-1), K so that spearman = 10.
 */
import { TROOPS, TROOP_CLASSES } from './troops.js';
import { COUNTERS, COUNTER_BONUS } from './npcConfig.js';

export { COUNTERS, COUNTER_BONUS };

/** Base stats per class (level 1). armor reduces damage, ap = armor piercing (0..1). */
export const BASE_STATS = {
  spear: { hp: 60, atk: 10, armor: 6, ap: 0.2 },
  sword: { hp: 55, atk: 13, armor: 4, ap: 0.3 },
  cav: { hp: 70, atk: 12, armor: 3, ap: 0.1 },
  archer: { hp: 35, atk: 14, armor: 1, ap: 0.4 },
};
/** hp and atk are multiplied by this per troop level. */
export const LEVEL_MULT = { 1: 1, 2: 2.2, 3: 4.5, 4: 9 };
export const ABILITY = { spear: 1, sword: 1, cav: 1, archer: 1 };
export const ARMOR_K = 20; // reduction = armor / (armor + ARMOR_K)

export const SLOTS = ['S1', 'S2', 'S3', 'S4']; // S1 front, S2/S3 flanks, S4 rear
/** Share of incoming damage each slot takes (renormalised over non-empty slots). */
export const SLOT_TARGET_WEIGHT = { S1: 0.5, S2: 0.2, S3: 0.2, S4: 0.1 };

const ORDER = ['wedge', 'shield_wall', 'flank', 'scattered', 'crescent'];
/** Max share of the total troops per slot (each sums to >= 1). */
const CAPS = {
  wedge: { S1: 0.5, S2: 0.25, S3: 0.25, S4: 0.25 },
  shield_wall: { S1: 0.6, S2: 0.2, S3: 0.2, S4: 0.3 },
  flank: { S1: 0.3, S2: 0.4, S3: 0.4, S4: 0.2 },
  scattered: { S1: 0.35, S2: 0.35, S3: 0.35, S4: 0.35 },
  crescent: { S1: 0.25, S2: 0.4, S3: 0.4, S4: 0.3 },
};
/** Each formation beats the next two in the cycle (+8% atk). */
export const FORMATIONS = Object.fromEntries(ORDER.map((id, i) => [id, { caps: CAPS[id], beats: [ORDER[(i + 1) % 5], ORDER[(i + 2) % 5]] }]));
export const FORMATION_IDS = ORDER;
export const FORMATION_BONUS = 0.08;

export const MAX_TICKS = 10;
export const DAMAGE_SCALE = 1.5;

// PvP
export const WOUNDED_SHARE = 0.7;
export const LOOT_SHARE = 0.2;
export const CARRY = { spear: 10, sword: 12, cav: 20, archer: 8 };
export const PROTECT_REVISION = 5;
export const PROTECT_POWER = 200;

const effHp = (s) => s.hp * (1 + s.armor / ARMOR_K);
const rawPower = (s) => Math.sqrt(effHp(s) * s.atk * (1 + 0.6 * s.ap) * s.ability) / 1.03 ** (s.level - 1);

const STATS = new Map();
for (const t of TROOPS.values()) {
  const b = BASE_STATS[t.cls], m = LEVEL_MULT[t.level];
  STATS.set(t.id, { id: t.id, cls: t.cls, level: t.level, hp: Math.round(b.hp * m), atk: Math.round(b.atk * m * 100) / 100, armor: b.armor, ap: b.ap, ability: ABILITY[t.cls] });
}
const K = 10 / rawPower(STATS.get('spearman'));
const POWER = new Map([...STATS].map(([id, s]) => [id, Math.round(rawPower(s) * K * 100) / 100]));

/** Stats of one troop, or null. */
export const unitStats = (id) => STATS.get(id) || null;
/** Power of one unit (spearman = 10), 0 for unknown ids. */
export const unitPower = (id) => POWER.get(id) || 0;

function classShares(army) {
  const by = {};
  let total = 0;
  for (const [id, n] of Object.entries(army || {})) {
    const s = STATS.get(id);
    if (!s || !(n > 0)) continue;
    const p = n * POWER.get(id);
    by[s.cls] = (by[s.cls] || 0) + p;
    total += p;
  }
  for (const k of Object.keys(by)) by[k] /= total || 1;
  return by;
}

/** Total power of `army` with the class counters against `enemy` applied. */
export function armyPower(army, enemy) {
  const share = classShares(enemy);
  let power = 0;
  for (const [id, n] of Object.entries(army || {})) {
    const s = STATS.get(id);
    if (!s || !(n > 0)) continue;
    const strong = share[COUNTERS[s.cls]] || 0;
    const weak = Object.entries(COUNTERS).reduce((a, [c, beats]) => a + (beats === s.cls ? share[c] || 0 : 0), 0);
    power += n * POWER.get(id) * (1 + COUNTER_BONUS * strong - COUNTER_BONUS * weak);
  }
  return power;
}

/** What the client needs (GET /api/game/battle-config). */
export function publicConfig() {
  const stats = {}, power = {};
  for (const [id, s] of STATS) { stats[id] = { cls: s.cls, level: s.level, hp: s.hp, atk: s.atk, armor: s.armor, ap: s.ap }; power[id] = POWER.get(id); }
  return {
    stats, power, formations: FORMATIONS, slots: SLOTS, classes: TROOP_CLASSES, counters: COUNTERS,
    counterBonus: COUNTER_BONUS, formationBonus: FORMATION_BONUS, maxTicks: MAX_TICKS,
  };
}
