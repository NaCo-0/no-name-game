/**
 * Battle v5: deterministic tick simulation (no Math.random, max MAX_TICKS ticks).
 * Layout = { formation, slots: { S1: {troopId: n}, S2, S3, S4 } }, up to two troop types (classes) per slot.
 * `fight(attacker, defender)` keeps the old result shape for world.js (camps).
 */
import { TROOPS } from './troops.js';
import { httpError } from './httpError.js';
import * as C from './battleConfig.js';

export { armyPower, layoutPower, analyze } from './battleConfig.js';

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const bad = (msg) => httpError(400, `layout: ${msg}`, { code: 'bad_layout' });

/** Validates a layout from a client; `army` (optional) = what the player owns. Throws 400. */
export function normalizeLayout(layout, army) {
  if (!isObj(layout)) throw bad('must be an object');
  const formation = layout.formation;
  const f = C.FORMATIONS[formation];
  if (!f) throw bad('unknown formation');
  if (!isObj(layout.slots)) throw bad('slots must be an object');
  for (const k of Object.keys(layout.slots)) if (!C.SLOTS.includes(k)) throw bad(`unknown slot "${String(k).slice(0, 10)}"`);
  const slots = {}, size = {}, used = {};
  let total = 0;
  for (const s of C.SLOTS) {
    const src = layout.slots[s] ?? {};
    if (!isObj(src)) throw bad(`${s} must be an object`);
    const classes = new Set();
    let n0 = 0;
    const out = {};
    for (const [id, n] of Object.entries(src)) {
      if (!Number.isInteger(n) || n < 0 || n > 1e6) throw bad('counts must be whole numbers');
      if (n === 0) continue;
      const t = TROOPS.get(id);
      if (!t) throw bad(`unknown troop "${String(id).slice(0, 40)}"`);
      classes.add(t.cls);
      if (classes.size > C.SLOT_CLASS_LIMIT) throw bad(`${s}: at most ${C.SLOT_CLASS_LIMIT} troop types per slot`);
      out[id] = n; n0 += n; used[id] = (used[id] || 0) + n;
    }
    slots[s] = out; size[s] = n0; total += n0;
  }
  if (!total) throw bad('place at least one soldier');
  if (army) for (const [id, n] of Object.entries(used)) if ((army[id] || 0) < n) throw bad(`you do not have ${n} x ${id}`);
  for (const s of C.SLOTS) if (size[s] > Math.ceil(f.caps[s] * total)) throw bad(`${s} is over its cap`);
  return { formation, slots };
}

/** Sum of all slots -> { troopId: n }. */
export function layoutArmy(layout) {
  const out = {};
  for (const s of C.SLOTS) for (const [id, n] of Object.entries(layout?.slots?.[s] || {})) if (n > 0) out[id] = (out[id] || 0) + n;
  return out;
}

const PREF = { spear: ['S1', 'S2', 'S3', 'S4'], sword: ['S1', 'S3', 'S2', 'S4'], cav: ['S2', 'S3', 'S1', 'S4'], archer: ['S4', 'S3', 'S2', 'S1'] };

/** Deterministic layout for an army (respects caps when possible, never throws). Two troop types per slot at most. */
export function autoLayout(army, formation = 'wedge') {
  if (!C.FORMATIONS[formation]) formation = 'wedge';
  const f = C.FORMATIONS[formation];
  const by = {};
  let total = 0;
  for (const [id, n] of Object.entries(army || {})) {
    const t = TROOPS.get(id);
    const k = Math.floor(Number(n) || 0);
    if (!t || k <= 0) continue;
    (by[t.cls] ||= []).push([id, k, t.level]);
    total += k;
  }
  const slots = { S1: {}, S2: {}, S3: {}, S4: {} };
  if (!total) return { formation, slots };
  const sum = (l) => l.reduce((a, q) => a + q[1], 0);
  const classes = Object.keys(by).sort((a, b) => sum(by[b]) - sum(by[a]) || (a < b ? -1 : 1));
  for (const c of classes) by[c].sort((a, b) => b[2] - a[2] || (a[0] < b[0] ? -1 : 1));
  const cap = (s) => Math.ceil(f.caps[s] * total);
  const size = { S1: 0, S2: 0, S3: 0, S4: 0 };
  const has = { S1: new Set(), S2: new Set(), S3: new Set(), S4: new Set() };
  const allowed = (s, c) => has[s].has(c) || has[s].size < C.SLOT_CLASS_LIMIT;
  const put = (s, c, queue, limit) => {
    while (queue.length && size[s] < limit) {
      const q = queue[0], k = Math.min(q[1], limit - size[s]);
      slots[s][q[0]] = (slots[s][q[0]] || 0) + k; size[s] += k; q[1] -= k; has[s].add(c);
      if (!q[1]) queue.shift();
    }
  };
  for (const c of classes) {
    const queue = by[c].map((q) => [q[0], q[1]]);
    for (const s of PREF[c]) if (allowed(s, c)) put(s, c, queue, cap(s));
    // nothing else fits: go over the cap in the preferred slot that allows this class
    if (queue.length) put(PREF[c].find((s) => allowed(s, c)) || 'S1', c, queue, Infinity);
  }
  return { formation, slots };
}

/** Does the layout respect every cap and the two-types rule? (same checks as normalizeLayout, no throwing) */
export function layoutFits(layout) {
  try { normalizeLayout(layout); return true; } catch { return false; }
}

/** autoLayout for `preferred`, or the first formation where the troop mix fits the slot caps. */
export function bestAutoLayout(army, preferred = 'wedge') {
  const order = [preferred, ...C.FORMATION_IDS.filter((f) => f !== preferred)].filter((f) => C.FORMATIONS[f]);
  let first = null;
  for (const f of order) {
    const l = autoLayout(army, f);
    first ||= l;
    if (layoutFits(l)) return l;
  }
  return first;
}

/** The formation that beats `vs` and fits this army (falls back to the best fitting one). */
export function pickCounterFormation(army, vs) {
  for (const f of C.FORMATION_IDS.filter((x) => C.FORMATIONS[x].beats.includes(vs))) if (layoutFits(autoLayout(army, f))) return f;
  return bestAutoLayout(army, 'wedge').formation;
}

function buildSide(layout) {
  const groups = [];
  for (const s of C.SLOTS) {
    for (const [id, n] of Object.entries(layout?.slots?.[s] || {})) {
      const st = C.unitStats(id);
      if (st && n > 0) groups.push({ slot: s, id, st, sent: n, pool: n * st.hp });
    }
  }
  const frontSent = groups.some((g) => g.slot === 'S1');
  return { formation: layout?.formation, groups, frontSent };
}
const alive = (g) => (g.pool <= 1e-9 ? 0 : Math.ceil(g.pool / g.st.hp - 1e-9));
const count = (gs) => gs.reduce((a, g) => a + alive(g), 0);
/** The front line existed and is now gone. */
const broken = (side) => side.frontSent && !side.groups.some((g) => g.slot === 'S1' && g.pool > 1e-9);

/** Damage `from` deals to each group of `to` this tick. */
function damageOf(from, to, bonus, toBroken) {
  const targets = to.groups;
  const dmg = targets.map(() => 0);
  const slotPool = {};
  for (const t of targets) if (t.pool > 0) slotPool[t.slot] = (slotPool[t.slot] || 0) + t.pool;
  const spread = C.FORMATION_MODS[to.formation]?.spread || 0;
  for (const g of from.groups) {
    const a = alive(g);
    if (!a) continue;
    const gm = C.groupMods(g.slot, g.st.cls, from.formation);
    const base = a * g.st.atk * C.DAMAGE_SCALE * bonus * gm.atk;
    const row = C.TARGETING[g.slot];
    const eff = (s) => (1 - spread) * row[s] + spread * 0.25;
    const W = Object.keys(slotPool).reduce((x, s) => x + eff(s), 0);
    if (!W) return dmg;
    targets.forEach((t, i) => {
      if (t.pool <= 0) return;
      const w = eff(t.slot) / W;
      const share = t.pool / slotPool[t.slot];
      let mult = 1;
      if (C.COUNTERS[g.st.cls] === t.st.cls) mult += C.COUNTER_BONUS;
      if (C.COUNTERS[t.st.cls] === g.st.cls) mult -= C.COUNTER_BONUS;
      const red = (t.st.armor / (t.st.armor + C.ARMOR_K)) * (1 - g.st.ap);
      const take = C.groupMods(t.slot, t.st.cls, to.formation).take * (toBroken ? C.FRONT_BREAK_TAKEN : 1);
      dmg[i] += base * w * share * mult * (1 - red) * take;
    });
  }
  return dmg;
}

function tally(groups) {
  const survivors = {}, losses = {};
  for (const g of groups) {
    const a = alive(g), l = g.sent - a;
    if (a > 0) survivors[g.id] = (survivors[g.id] || 0) + a;
    if (l > 0) losses[g.id] = (losses[g.id] || 0) + l;
  }
  return { survivors, losses };
}
const bySlot = (groups) => Object.fromEntries(C.SLOTS.map((s) => [s, {
  sent: groups.filter((g) => g.slot === s).reduce((a, g) => a + g.sent, 0),
  left: groups.filter((g) => g.slot === s).reduce((a, g) => a + alive(g), 0),
}]));

/** Runs a battle between two (already normalized) layouts. */
export function simulate(attLayout, defLayout) {
  const A = buildSide(attLayout), D = buildSide(defLayout);
  const beats = (x, y) => (C.FORMATIONS[x]?.beats.includes(y) ? 1 + C.FORMATION_BONUS : 1);
  const ba = beats(A.formation, D.formation), bd = beats(D.formation, A.formation);
  const log = [], events = [];
  let ticks = 0, aBroke = false, dBroke = false;
  while (ticks < C.MAX_TICKS && count(A.groups) > 0 && count(D.groups) > 0) {
    ticks++;
    const ab = broken(A), db = broken(D);
    if (ab && !aBroke) { aBroke = true; events.push({ tick: ticks, side: 'att', type: 'front_broken' }); }
    if (db && !dBroke) { dBroke = true; events.push({ tick: ticks, side: 'def', type: 'front_broken' }); }
    const toD = damageOf(A, D, ba, db), toA = damageOf(D, A, bd, ab); // simultaneous
    D.groups.forEach((g, i) => { g.pool = Math.max(0, g.pool - toD[i]); });
    A.groups.forEach((g, i) => { g.pool = Math.max(0, g.pool - toA[i]); });
    log.push({ tick: ticks, attackerAlive: count(A.groups), defenderAlive: count(D.groups) });
  }
  const rem = (gs) => gs.reduce((s, g) => s + (g.pool / g.st.hp) * C.unitPower(g.id), 0);
  const aAlive = count(A.groups), dAlive = count(D.groups);
  const win = aAlive > 0 && (dAlive === 0 || rem(A.groups) > rem(D.groups));
  const a = tally(A.groups), d = tally(D.groups);
  return {
    win, ticks, log, events,
    attackerFormation: A.formation, defenderFormation: D.formation,
    attackerPower: Math.round(C.layoutPower(attLayout, defLayout)), defenderPower: Math.round(C.layoutPower(defLayout, attLayout)),
    effects: C.analyze(attLayout, defLayout),
    slots: { att: bySlot(A.groups), def: bySlot(D.groups) },
    defenderSent: layoutArmy(defLayout),
    attackerSurvivors: a.survivors, attackerLosses: a.losses, defenderSurvivors: d.survivors, defenderLosses: d.losses,
  };
}

/**
 * Old API (camps): plain armies. The defender uses `defenderFormation` (camp type) and the attacker
 * automatically picks a formation that counters it (unless `attackerFormation` is given).
 */
export function fight(attacker, defender, { defenderFormation, attackerFormation } = {}) {
  const defL = bestAutoLayout(defender, defenderFormation || 'wedge');
  const attL = bestAutoLayout(attacker, attackerFormation || pickCounterFormation(attacker, defL.formation));
  return simulate(attL, defL);
}
