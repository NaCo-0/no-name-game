/**
 * Battle v5: deterministic tick simulation (no Math.random, max MAX_TICKS ticks).
 * Layout = { formation, slots: { S1: {troopId: n}, S2, S3, S4 } }, one class per slot.
 * `fight(attacker, defender)` keeps the old result shape for world.js (camps).
 */
import { TROOPS } from './troops.js';
import { httpError } from './httpError.js';
import * as C from './battleConfig.js';

export { armyPower } from './battleConfig.js';

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
    let cls = null, n0 = 0;
    const out = {};
    for (const [id, n] of Object.entries(src)) {
      if (!Number.isInteger(n) || n < 0 || n > 1e6) throw bad('counts must be whole numbers');
      if (n === 0) continue;
      const t = TROOPS.get(id);
      if (!t) throw bad(`unknown troop "${String(id).slice(0, 40)}"`);
      if (cls && cls !== t.cls) throw bad(`${s}: only one class per slot`);
      cls = t.cls;
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

/** Deterministic layout for an army (respects caps when possible, never throws). */
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
  // Try every slot -> class assignment; keep the feasible one closest to the preferences.
  let best = null, bestScore = Infinity, bestOver = Infinity;
  const choice = [];
  const walk = (i) => {
    if (i === C.SLOTS.length) {
      let score = 0, over = 0;
      for (const c of classes) {
        const own = C.SLOTS.filter((s, j) => choice[j] === c);
        if (!own.length) return;
        over += Math.max(0, sum(by[c]) - own.reduce((a, s) => a + cap(s), 0));
        for (const s of own) score += PREF[c].indexOf(s);
      }
      if (over < bestOver || (over === bestOver && score < bestScore)) { best = [...choice]; bestOver = over; bestScore = score; }
      return;
    }
    for (const c of [...classes, null]) { choice[i] = c; walk(i + 1); }
  };
  walk(0);
  for (const c of classes) {
    const own = PREF[c].filter((s) => best[C.SLOTS.indexOf(s)] === c);
    const queue = by[c].map((q) => [q[0], q[1]]);
    const size = Object.fromEntries(own.map((s) => [s, 0]));
    const place = (s, limit) => {
      while (queue.length && size[s] < limit) {
        const q = queue[0], k = Math.min(q[1], limit - size[s]);
        slots[s][q[0]] = (slots[s][q[0]] || 0) + k; size[s] += k; q[1] -= k;
        if (!q[1]) queue.shift();
      }
    };
    for (const s of own) place(s, cap(s));
    place(own[0], Infinity); // over cap only when nothing else fits
  }
  return { formation, slots };
}

function buildSide(layout) {
  const groups = [];
  for (const s of C.SLOTS) {
    for (const [id, n] of Object.entries(layout?.slots?.[s] || {})) {
      const st = C.unitStats(id);
      if (st && n > 0) groups.push({ slot: s, id, st, sent: n, pool: n * st.hp });
    }
  }
  return groups;
}
const alive = (g) => (g.pool <= 1e-9 ? 0 : Math.ceil(g.pool / g.st.hp - 1e-9));
const count = (gs) => gs.reduce((a, g) => a + alive(g), 0);

/** Damage `from` deals to each group of `targets` this tick. */
function damageOf(from, targets, bonus) {
  const dmg = targets.map(() => 0);
  const slotPool = {};
  for (const t of targets) if (t.pool > 0) slotPool[t.slot] = (slotPool[t.slot] || 0) + t.pool;
  const W = Object.keys(slotPool).reduce((a, s) => a + C.SLOT_TARGET_WEIGHT[s], 0);
  if (!W) return dmg;
  for (const g of from) {
    const a = alive(g);
    if (!a) continue;
    const base = a * g.st.atk * C.DAMAGE_SCALE * bonus;
    targets.forEach((t, i) => {
      if (t.pool <= 0) return;
      const share = (C.SLOT_TARGET_WEIGHT[t.slot] / W) * (t.pool / slotPool[t.slot]);
      let mult = 1;
      if (C.COUNTERS[g.st.cls] === t.st.cls) mult += C.COUNTER_BONUS;
      if (C.COUNTERS[t.st.cls] === g.st.cls) mult -= C.COUNTER_BONUS;
      const red = (t.st.armor / (t.st.armor + C.ARMOR_K)) * (1 - g.st.ap);
      dmg[i] += base * share * mult * (1 - red);
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

/** Runs a battle between two (already normalized) layouts. */
export function simulate(attLayout, defLayout) {
  const A = buildSide(attLayout), D = buildSide(defLayout);
  const beats = (x, y) => (C.FORMATIONS[x]?.beats.includes(y) ? 1 + C.FORMATION_BONUS : 1);
  const ba = beats(attLayout?.formation, defLayout?.formation), bd = beats(defLayout?.formation, attLayout?.formation);
  const log = [];
  let ticks = 0;
  while (ticks < C.MAX_TICKS && count(A) > 0 && count(D) > 0) {
    ticks++;
    const toD = damageOf(A, D, ba), toA = damageOf(D, A, bd); // simultaneous
    D.forEach((g, i) => { g.pool = Math.max(0, g.pool - toD[i]); });
    A.forEach((g, i) => { g.pool = Math.max(0, g.pool - toA[i]); });
    log.push({ tick: ticks, attackerAlive: count(A), defenderAlive: count(D) });
  }
  const rem = (gs) => gs.reduce((s, g) => s + (g.pool / g.st.hp) * C.unitPower(g.id), 0);
  const aAlive = count(A), dAlive = count(D);
  const win = aAlive > 0 && (dAlive === 0 || rem(A) > rem(D));
  const a = tally(A), d = tally(D);
  const attArmy = layoutArmy(attLayout), defArmy = layoutArmy(defLayout);
  return {
    win, ticks, log,
    attackerPower: Math.round(C.armyPower(attArmy, defArmy)), defenderPower: Math.round(C.armyPower(defArmy, attArmy)),
    attackerSurvivors: a.survivors, attackerLosses: a.losses, defenderSurvivors: d.survivors, defenderLosses: d.losses,
  };
}

/** Old API (camps): plain armies, auto layout on both sides. */
export function fight(attacker, defender) {
  return simulate(autoLayout(attacker), autoLayout(defender));
}
