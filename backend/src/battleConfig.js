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
export const SLOT_CLASS_LIMIT = 2; // a slot can hold up to two troop types (classes); tiers of one class are free

/**
 * Who shoots at whom: an attacking group in slot X sends this share of its damage at each ENEMY slot
 * (renormalised over the enemy slots that are still alive). Front fights front, flanks wrap around
 * onto the opposite flank and the rear, the rear (archers) fires over the front.
 */
export const TARGETING = {
  S1: { S1: 0.7, S2: 0.12, S3: 0.12, S4: 0.06 },
  S2: { S1: 0.25, S2: 0.15, S3: 0.35, S4: 0.25 },
  S3: { S1: 0.25, S2: 0.35, S3: 0.15, S4: 0.25 },
  S4: { S1: 0.45, S2: 0.2, S3: 0.2, S4: 0.15 },
};
/** Average share of enemy fire each slot draws (for display). */
export const EXPOSURE = Object.fromEntries(SLOTS.map((s) => [s, Math.round(SLOTS.reduce((a, f) => a + TARGETING[f][s], 0) / SLOTS.length * 100) / 100]));

/** Class x slot: atk = attack multiplier, take = damage-taken multiplier. Missing = 1 / 1. */
const flat = { atk: 1, take: 1 };
export const SLOT_AFFINITY = {
  S1: { spear: { atk: 1, take: 0.85 }, sword: { atk: 1.1, take: 1 }, cav: { atk: 0.85, take: 1 }, archer: { atk: 0.8, take: 1.1 } },
  S2: { spear: flat, sword: flat, cav: { atk: 1.25, take: 1 }, archer: { atk: 0.95, take: 1 } },
  S3: { spear: flat, sword: flat, cav: { atk: 1.25, take: 1 }, archer: { atk: 0.95, take: 1 } },
  S4: { spear: { atk: 0.9, take: 1 }, sword: { atk: 0.9, take: 1 }, cav: { atk: 0.85, take: 1 }, archer: { atk: 1.25, take: 0.9 } },
};
/** What each formation does to its own slots (atk/take multipliers) and how much it blurs enemy focus fire (spread 0..1). */
export const FORMATION_MODS = {
  wedge: { atk: { S1: 1.15 }, take: {}, spread: 0 },
  shield_wall: { atk: {}, take: { S1: 0.8 }, spread: 0 },
  flank: { atk: { S2: 1.15, S3: 1.15 }, take: {}, spread: 0 },
  scattered: { atk: {}, take: {}, spread: 0.5 },
  crescent: { atk: { S4: 1.15 }, take: { S2: 0.9, S3: 0.9 }, spread: 0 },
};
/** Once the front line (S1) is wiped out, everything else takes this much more damage. */
export const FRONT_BREAK_TAKEN = 1.2;

const ORDER = ['wedge', 'shield_wall', 'flank', 'scattered', 'crescent'];
/** Max share of the total troops per slot (each sums to >= 1). */
const CAPS = {
  wedge: { S1: 0.5, S2: 0.25, S3: 0.25, S4: 0.25 },
  shield_wall: { S1: 0.6, S2: 0.2, S3: 0.2, S4: 0.3 },
  flank: { S1: 0.3, S2: 0.4, S3: 0.4, S4: 0.2 },
  scattered: { S1: 0.35, S2: 0.35, S3: 0.35, S4: 0.35 },
  crescent: { S1: 0.25, S2: 0.4, S3: 0.4, S4: 0.3 },
};
/** Each formation beats the next two in the cycle (+12% atk). */
export const FORMATIONS = Object.fromEntries(ORDER.map((id, i) => [id, { caps: CAPS[id], beats: [ORDER[(i + 1) % 5], ORDER[(i + 2) % 5]] }]));
export const FORMATION_IDS = ORDER;
export const FORMATION_BONUS = 0.12;

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

const sumArmy = (layout) => {
  const out = {};
  for (const sl of SLOTS) for (const [id, n] of Object.entries(layout?.slots?.[sl] || {})) if (n > 0) out[id] = (out[id] || 0) + n;
  return out;
};
const aff = (slot, cls) => SLOT_AFFINITY[slot]?.[cls] || flat;
/** [atk, take] multipliers of a class standing in a slot of a formation. */
export function groupMods(slot, cls, formation) {
  const fm = FORMATION_MODS[formation] || { atk: {}, take: {} };
  const a = aff(slot, cls);
  return { atk: a.atk * (fm.atk[slot] ?? 1), take: a.take * (fm.take[slot] ?? 1) };
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

/**
 * Power of a LAYOUT: unit power x slot/formation multipliers (sqrt(atk/take), like power itself),
 * and, when `enemy` (a layout) is given, the class counters and the formation counter.
 */
export function layoutPower(layout, enemy) {
  const share = enemy ? classShares(sumArmy(enemy)) : {};
  const mine = (FORMATIONS[layout?.formation]?.beats || []).includes(enemy?.formation) ? 1 + FORMATION_BONUS : 1;
  const theirs = (FORMATIONS[enemy?.formation]?.beats || []).includes(layout?.formation) ? 1 + FORMATION_BONUS : 1;
  let power = 0;
  for (const sl of SLOTS) {
    for (const [id, n] of Object.entries(layout?.slots?.[sl] || {})) {
      const s = STATS.get(id);
      if (!s || !(n > 0)) continue;
      const m = groupMods(sl, s.cls, layout.formation);
      const strong = share[COUNTERS[s.cls]] || 0;
      const weak = Object.entries(COUNTERS).reduce((a, [c, beats]) => a + (beats === s.cls ? share[c] || 0 : 0), 0);
      power += n * POWER.get(id) * Math.sqrt(m.atk / m.take) * (1 + COUNTER_BONUS * strong - COUNTER_BONUS * weak);
    }
  }
  return power * Math.sqrt(mine / theirs);
}

/** Own traits of a layout: the formation's perk and every class x slot bonus/penalty that is actually in play. */
export function ownEffects(layout) {
  const items = [];
  const f = layout?.formation, fm = FORMATION_MODS[f];
  if (fm) items.push({ type: 'formation', formation: f, atk: fm.atk, take: fm.take, spread: fm.spread || 0 });
  for (const sl of SLOTS) {
    const byCls = {};
    for (const [id, n] of Object.entries(layout?.slots?.[sl] || {})) { const s = STATS.get(id); if (s && n > 0) byCls[s.cls] = (byCls[s.cls] || 0) + n; }
    for (const [cls, n] of Object.entries(byCls)) {
      const a = aff(sl, cls);
      if (a.atk !== 1 || a.take !== 1) items.push({ type: 'slot', slot: sl, cls, atk: a.atk, take: a.take, n });
    }
  }
  return items;
}

/** Everything that decides a matchup, from both sides: own traits + formation counter + class counters. */
export function analyze(attLayout, defLayout) {
  const side = (me, foe) => {
    const out = ownEffects(me);
    if (FORMATIONS[me?.formation]?.beats.includes(foe?.formation)) out.push({ type: 'formation_counter', formation: me.formation, over: foe.formation, value: FORMATION_BONUS });
    if (FORMATIONS[foe?.formation]?.beats.includes(me?.formation)) out.push({ type: 'formation_weak', formation: me.formation, over: foe.formation, value: FORMATION_BONUS });
    const a = classShares(sumArmy(me)), b = classShares(sumArmy(foe));
    for (const c of Object.keys(a)) for (const e of Object.keys(b)) {
      if (COUNTERS[c] === e) out.push({ type: 'class_counter', cls: c, vs: e, value: COUNTER_BONUS, share: Math.round(a[c] * 100) / 100, vsShare: Math.round(b[e] * 100) / 100 });
      if (COUNTERS[e] === c) out.push({ type: 'class_weak', cls: c, vs: e, value: COUNTER_BONUS, share: Math.round(a[c] * 100) / 100, vsShare: Math.round(b[e] * 100) / 100 });
    }
    return out;
  };
  return { att: side(attLayout, defLayout), def: side(defLayout, attLayout) };
}

/** What the client needs (GET /api/game/battle-config). */
export function publicConfig() {
  const stats = {}, power = {};
  for (const [id, s] of STATS) { stats[id] = { cls: s.cls, level: s.level, hp: s.hp, atk: s.atk, armor: s.armor, ap: s.ap }; power[id] = POWER.get(id); }
  return {
    stats, power, formations: FORMATIONS, slots: SLOTS, classes: TROOP_CLASSES, counters: COUNTERS,
    counterBonus: COUNTER_BONUS, formationBonus: FORMATION_BONUS, maxTicks: MAX_TICKS,
    slotClassLimit: SLOT_CLASS_LIMIT, targeting: TARGETING, exposure: EXPOSURE, affinity: SLOT_AFFINITY,
    formationMods: FORMATION_MODS, frontBreakTaken: FRONT_BREAK_TAKEN,
  };
}
