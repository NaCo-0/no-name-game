/**
 * Server-authoritative economy: buildings, production, upgrades (with timers) and troop training.
 *
 * The client never sends resources / levels any more -- it only asks ("upgrade main_hall", "collect", "train").
 * Everything is calculated here from TIMESTAMPS, so nothing needs a 1-second server tick:
 *   - every producer keeps `stored` + `at` (last time `stored` was calculated); the amount now = stored + rate * (now - at)
 *   - an upgrade is a queue item { id, toLevel, startedAt, endsAt }; when endsAt has passed, the level changes
 *     (production before that moment is paid with the OLD rate, after it with the new one)
 *
 * Rules (see README "Economy"):
 *   - levels 1..15, the Main Hall (main_hall) goes to 15, every other building may not be higher than the Main Hall
 *   - 1 builder; a 2nd builder from Main Hall level 5 (= two upgrades can run at the same time)
 *   - upgrades cost the 4 main resources only (coins are a separate system: market, trader, spies...)
 *   - producers keep up to STORAGE_HOURS of production; any spending first collects everything automatically
 *
 * All numbers are in TUNING, `npm run balance` prints how long a player needs with them.
 */
import { httpError } from './httpError.js';
import { troopFor } from './troops.js';

export const MAX_LEVEL = 15;
export const HALL_ID = 'main_hall';
export const STORAGE_HOURS = 12;
export const ECON_VERSION = 1;
export const MAIN_RESOURCES = ['food', 'wood', 'stone', 'iron'];
export const START_RESOURCES = { food: 1000, wood: 1000, stone: 1000, iron: 600, coin: 250 };

const def = (id, category, produces = null) => ({ id, category, produces });
/** Same 20 buildings in every civilization (the layout x/y lives in public/kingdom_art/kingdom_data.js). */
export const BUILDINGS = [
  def('main_hall', 'hq'), def('research', 'research'), def('alliance_hall', 'alliance'), def('market', 'market'),
  ...[1, 2, 3, 4].map((i) => def(`barracks_${i}`, 'barracks')),
  ...[1, 2, 3].map((i) => def(`iron_mine_${i}`, 'mine', 'iron')),
  ...[1, 2, 3].map((i) => def(`quarry_${i}`, 'quarry', 'stone')),
  ...[1, 2, 3].map((i) => def(`lumber_${i}`, 'lumber', 'wood')),
  ...[1, 2, 3].map((i) => def(`farm_${i}`, 'farm', 'food')),
];
const DEF = new Map(BUILDINGS.map((b) => [b.id, b]));

/** Every balance number in one place (the balance script changes them to try ideas). */
export const TUNING = {
  // seconds for level n -> n+1 (index n-1), for the Main Hall; the other buildings use otherTimeFactor of it
  upgradeSeconds: [10, 30, 120, 480, 1800, 5400, 14400, 32400, 57600, 86400, 129600, 172800, 216000, 259200],
  otherTimeFactor: 0.45,
  prodBase: 600,       // per hour at level 1
  prodGrowth: 1.22,    // x per level
  costBase: 300,       // upgrade cost from level 1 (before the per-resource weight)
  costGrowth: 1.75,
  hallCostFactor: 1.4,
  weights: { food: 0.5, wood: 1, stone: 0.9, iron: 0.6 },
  speed: Number(process.env.ECONOMY_SPEED) > 0 ? Number(process.env.ECONOMY_SPEED) : 1, // dev/test: 100 = everything 100x faster
  secondBuilderHall: 5,
  // troops (same numbers as TROOP_* in game.html)
  troopBaseCost: {
    spear: { food: 20, wood: 25 }, sword: { food: 20, iron: 20 },
    cav: { food: 35, iron: 25 }, archer: { food: 20, wood: 30 },
  },
  troopLevelMult: [1, 2.2, 4.5, 9],
  troopLevelSeconds: [5, 12, 25, 45],
  maxTrainBatch: 10000,
  maxTrainQueue: 30,
};
export const setSpeed = (x) => { TUNING.speed = x > 0 ? x : 1; };

// ---------- pure formulas ----------
export const ratePerHour = (level) => Math.round(TUNING.prodBase * Math.pow(TUNING.prodGrowth, level - 1));
export const capacity = (level) => ratePerHour(level) * STORAGE_HOURS;
/** Real seconds the upgrade from `level` takes (before TUNING.speed). */
export const upgradeSeconds = (id, level) => {
  const t = TUNING.upgradeSeconds[level - 1];
  return Math.max(5, Math.round(t * (id === HALL_ID ? 1 : TUNING.otherTimeFactor)));
};
export const upgradeCost = (id, level) => {
  const base = TUNING.costBase * Math.pow(TUNING.costGrowth, level - 1) * (id === HALL_ID ? TUNING.hallCostFactor : 1);
  const out = {};
  for (const [k, w] of Object.entries(TUNING.weights)) out[k] = Math.round(base * w);
  return out;
};
export const builderSlots = (hallLevel) => (hallLevel >= TUNING.secondBuilderHall ? 2 : 1);
export const troopUnitCost = (t) => {
  const m = TUNING.troopLevelMult[t.level - 1];
  const out = {};
  for (const [r, v] of Object.entries(TUNING.troopBaseCost[t.cls])) out[r] = Math.round(v * m);
  return out;
};
export const troopUnitSeconds = (t) => TUNING.troopLevelSeconds[t.level - 1];

// ---------- helpers ----------
const clone = (o) => JSON.parse(JSON.stringify(o ?? {}));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const clampInt = (v, min, max, dflt) => (isNum(v) ? Math.min(max, Math.max(min, Math.trunc(v))) : dflt);
const lvl = (d, c, id) => d.buildings[c].find((b) => b.id === id)?.level ?? 1;

/** Does this save still need its economy created / migrated (first visit, or a save made by the old client)? */
export const needsInit = (data, culture) => !data || data.econ !== ECON_VERSION || !Array.isArray(data.buildings?.[culture]);

/** Fills in everything the economy needs (idempotent). Old client-made saves are kept but clamped to the new rules. */
export function initState(data, culture, now) {
  const d = clone(data);
  const saved = Array.isArray(d.buildings?.[culture]) ? d.buildings[culture].filter(isObj) : [];
  const byId = new Map(saved.map((b) => [b.id, b]));
  const list = BUILDINGS.map((b) => {
    const s = byId.get(b.id) || {};
    return {
      ...s, id: b.id, level: clampInt(s.level, 1, MAX_LEVEL, 1),
      stored: isNum(s.stored) && s.stored > 0 ? s.stored : 0,
      at: isNum(s.at) && s.at > 0 && s.at <= now ? s.at : now,
    };
  });
  const extras = saved.filter((b) => !DEF.has(b.id));
  d.buildings = { ...(isObj(d.buildings) ? d.buildings : {}), [culture]: [...list, ...extras] };

  const oldRes = isObj(d.resources) && isObj(d.resources[culture]) ? d.resources[culture] : null;
  const res = {};
  for (const k of [...MAIN_RESOURCES, 'coin']) res[k] = oldRes ? Math.max(0, isNum(oldRes[k]) ? oldRes[k] : 0) : START_RESOURCES[k];
  d.resources = { ...(isObj(d.resources) ? d.resources : {}), [culture]: res };

  const q = Array.isArray(d.build?.[culture]) ? d.build[culture] : [];
  d.build = {
    ...(isObj(d.build) ? d.build : {}),
    [culture]: q.filter((it) => isObj(it) && DEF.has(it.id) && isNum(it.endsAt) && isNum(it.toLevel)),
  };

  const army = isObj(d.army) ? d.army : {};
  d.army = { ...army, troops: isObj(army.troops) ? army.troops : {}, queue: isObj(army.queue) ? army.queue : {} };
  if (!isObj(d.army.troops[culture])) d.army.troops[culture] = {};
  if (!Array.isArray(d.army.queue[culture])) d.army.queue[culture] = [];
  d.econ = ECON_VERSION;
  return d;
}

function accrue(b, to) {
  if (!(to > b.at)) return;
  const p = DEF.get(b.id)?.produces;
  if (p) {
    const perMs = (ratePerHour(b.level) * TUNING.speed) / 3600000;
    b.stored = Math.min(capacity(b.level), b.stored + perMs * (to - b.at));
  }
  b.at = to;
}

/** Applies everything that happened up to `now`: finished upgrades, production, finished troop batches. Pure: returns new data. */
export function settle(data, culture, now) {
  const d = clone(data);
  const bs = d.buildings[culture];
  const byId = new Map(bs.map((b) => [b.id, b]));
  const rest = [];
  for (const it of d.build[culture].slice().sort((a, b) => a.endsAt - b.endsAt)) {
    if (it.endsAt <= now) {
      const b = byId.get(it.id);
      if (b) { accrue(b, it.endsAt); b.level = Math.min(MAX_LEVEL, Math.max(b.level, it.toLevel)); }
    } else rest.push(it);
  }
  d.build[culture] = rest;
  for (const b of bs) accrue(b, now);
  const troops = { ...d.army.troops[culture] };
  const left = [];
  for (const j of d.army.queue[culture]) {
    if (j.endsAt <= now) troops[j.troopId] = Math.min(1e9, (troops[j.troopId] || 0) + j.count);
    else left.push(j);
  }
  d.army.troops[culture] = troops;
  d.army.queue[culture] = left;
  return d;
}

/** init + settle (what every request does first). */
export const prepare = (data, culture, now) => settle(initState(data, culture, now), culture, now);

/** Moves what the producers hold into the treasury (all of them, or just `onlyId`). Mutates `d` (already a private copy). */
export function collect(d, culture, onlyId = null) {
  const res = d.resources[culture];
  let total = 0;
  for (const b of d.buildings[culture]) {
    const p = DEF.get(b.id)?.produces;
    if (!p || (onlyId && b.id !== onlyId)) continue;
    const whole = Math.floor(b.stored);
    if (whole < 1) continue;
    res[p] = Math.min(1e12, res[p] + whole);
    b.stored -= whole;
    total += whole;
  }
  return total;
}

const lacks = (res, cost) => Object.entries(cost).filter(([k, v]) => (res[k] || 0) < v).map(([k]) => k);
const spend = (res, cost) => { for (const [k, v] of Object.entries(cost)) res[k] -= v; };

/** Why can this building not be upgraded right now (without looking at the money)? null = it can. */
function blockedReason(d, c, b, now) {
  if (b.level >= MAX_LEVEL) return 'max_level';
  if (d.build[c].some((it) => it.id === b.id)) return 'upgrading';
  if (b.id !== HALL_ID && b.level + 1 > lvl(d, c, HALL_ID)) return 'hall_level';
  if (d.build[c].length >= builderSlots(lvl(d, c, HALL_ID))) return 'queue_full';
  return null;
}

export function startUpgrade(d, c, id, now) {
  const b = d.buildings[c].find((x) => x.id === id);
  if (!b || !DEF.has(id)) throw httpError(404, 'unknown building', { code: 'unknown_building' });
  const why = blockedReason(d, c, b, now);
  const msg = {
    max_level: `already at the maximum level (${MAX_LEVEL})`,
    upgrading: 'this building is already being upgraded',
    hall_level: `upgrade the Main Hall first (a building can not be higher than the Main Hall)`,
    queue_full: 'all your builders are busy',
  };
  if (why) throw httpError(409, msg[why], { code: why });
  collect(d, c); // spending first collects everything the producers hold
  const cost = upgradeCost(id, b.level);
  const miss = lacks(d.resources[c], cost);
  if (miss.length) throw httpError(409, `not enough ${miss.join(', ')}`, { code: 'not_enough_resources', missing: miss, cost });
  spend(d.resources[c], cost);
  d.build[c].push({ id, toLevel: b.level + 1, startedAt: now, endsAt: now + Math.round((upgradeSeconds(id, b.level) * 1000) / TUNING.speed) });
}

export function startTraining(d, c, troopId, count, now) {
  const t = troopFor(troopId, c);
  if (!t) throw httpError(400, 'unknown troop', { code: 'unknown_troop' });
  if (!Number.isInteger(count) || count < 1 || count > TUNING.maxTrainBatch) throw httpError(400, `count: 1 to ${TUNING.maxTrainBatch}`, { code: 'bad_count' });
  const q = d.army.queue[c];
  if (q.length >= TUNING.maxTrainQueue) throw httpError(409, 'the training queue is full', { code: 'queue_full' });
  collect(d, c);
  const unit = troopUnitCost(t);
  const cost = Object.fromEntries(Object.entries(unit).map(([k, v]) => [k, v * count]));
  const miss = lacks(d.resources[c], cost);
  if (miss.length) throw httpError(409, `not enough ${miss.join(', ')}`, { code: 'not_enough_resources', missing: miss, cost });
  spend(d.resources[c], cost);
  const start = q.length ? Math.max(now, q[q.length - 1].endsAt) : now;
  q.push({
    id: `${now}_${Math.random().toString(36).slice(2, 6)}`, troopId, count,
    endsAt: start + Math.round((troopUnitSeconds(t) * count * 1000) / TUNING.speed),
  });
}

/** What the client gets (data must already be prepared/settled for `now`). */
export function view(d, c, now) {
  const hall = lvl(d, c, HALL_ID);
  const buildings = d.buildings[c].filter((b) => DEF.has(b.id)).map((b) => {
    const dd = DEF.get(b.id);
    const up = d.build[c].find((it) => it.id === b.id) || null;
    const reason = blockedReason(d, c, b, now);
    return {
      id: b.id, category: dd.category, produces: dd.produces, level: b.level, stored: b.stored, at: b.at,
      ratePerSec: dd.produces ? (ratePerHour(b.level) * TUNING.speed) / 3600 : 0,
      ratePerHour: dd.produces ? ratePerHour(b.level) * TUNING.speed : 0,
      cap: dd.produces ? capacity(b.level) : 0,
      upgrading: up && { toLevel: up.toLevel, startedAt: up.startedAt, endsAt: up.endsAt },
      next: b.level >= MAX_LEVEL ? null : {
        level: b.level + 1, cost: upgradeCost(b.id, b.level),
        seconds: Math.round((upgradeSeconds(b.id, b.level) * 1) / TUNING.speed * 10) / 10,
        // 'queue_full' / 'upgrading' are about right now; 'hall_level' / 'max_level' need other upgrades first
        blocked: reason,
      },
    };
  });
  return {
    now, maxLevel: MAX_LEVEL, hallLevel: hall, slots: builderSlots(hall), storageHours: STORAGE_HOURS,
    buildings, resources: d.resources[c], queue: d.build[c], army: d.army,
  };
}
