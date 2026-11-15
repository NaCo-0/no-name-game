/**
 * War Elephant: the alliance hunt (our Bear Trap).
 *   - opens on server day 5, then every 4 days (one hunt per alliance per cycle; the server lasts 31 days)
 *   - members enhance the trap with resources (+5% damage per level, resets after each hunt)
 *   - leader / officers activate it (now or in a few minutes); the elephant stays 30 minutes
 *   - members call / join RALLIES on it (rally.js); troops are never lost; damage is counted per player
 *   - when the time is up everybody gets rewards: personal (how many "army hits" you dealt), alliance (how much of the
 *     elephant's health the alliance took), top-3 bonus and a share of what you gave to the trap back. Claim them any time.
 * All balance numbers are in CFG below.
 */
import { Op } from 'sequelize';
import { ElephantHunt, ElephantScore, AllianceMember } from './models.js';
import { GameSave, Player } from '../models.js';
import { httpError } from '../httpError.js';
import * as C from '../battleConfig.js';
import * as live from '../live.js';
import { membershipOf, notify } from './alliance.js';
import { serverStart, serverNow, DAY_MS, HOUR_MS } from './clock.js';
import { loadRow, troopsOf, resOf, withState, writeRow, staleCheck, addRes, RES } from './saves.js';

export const CFG = {
  unlockDay: 5, cycleDays: 4, serverDays: 31,
  durationMin: 30, maxDelayMin: 120,
  damagePerPower: 3,            // damage of one troop = its power x this x class multiplier
  poolHits: 4,                  // the elephant's health = the whole alliance's army power x damagePerPower x this ("4 full hits of everybody")
  poolMin: 4000,
  classMult: { spear: 1.3, sword: 1.0, archer: 1.0, cav: 0.7 }, // spears pierce the armor, horses panic
  rallyBonusPer: 0.04, rallyBonusMax: 0.4,   // +4% per extra member in the rally, up to +40%
  enhanceBonus: 0.05,                         // per trap level
  enhanceWeight: { food: 1, wood: 1, stone: 1, iron: 2, coin: 2 },
  enhanceThresholds: [1500, 5000, 12000, 25000, 45000], // points for level 1..5 (scaled up for big alliances, see enhanceScale)
  refundShare: 0.4,
  phaseAt: [0, 0.35, 0.7],                    // phase 1 / 2 / 3 of the elephant (the three pictures)
  cycleBonus: 0.15,                           // rewards x (1 + this x cycle index): later hunts pay more
  personalTiers: [ // "army hits" = your damage / (your army power x damagePerPower)
    { at: 0.5, reward: { food: 1500, wood: 1500, stone: 1000 } },
    { at: 1, reward: { food: 4000, wood: 4000, stone: 3000, coin: 1500 } },
    { at: 2, reward: { food: 9000, wood: 9000, stone: 7000, iron: 3500, coin: 4000 } },
    { at: 3.5, reward: { food: 16000, wood: 16000, stone: 12000, iron: 7000, coin: 9000 } },
    { at: 5, reward: { food: 28000, wood: 28000, stone: 22000, iron: 13000, coin: 18000 } },
  ],
  allianceTiers: [ // share of the elephant's health taken by the whole alliance
    { at: 0.25, reward: { food: 2000, wood: 2000 } },
    { at: 0.5, reward: { wood: 4000, stone: 3000, coin: 2000 } },
    { at: 0.75, reward: { food: 6000, wood: 6000, stone: 5000, iron: 2000 } },
    { at: 1, reward: { food: 10000, wood: 10000, stone: 8000, iron: 5000, coin: 6000 } },
    { at: 1.5, reward: { food: 16000, wood: 16000, stone: 14000, iron: 9000, coin: 12000 } },
  ],
  rankBonus: {
    1: { coin: 8000, iron: 4000, stone: 4000, wood: 4000, food: 4000 },
    2: { coin: 5000, iron: 2500, stone: 2500, wood: 2500, food: 2500 },
    3: { coin: 3000, iron: 1500, stone: 1500, wood: 1500, food: 1500 },
  },
};

export const UNLOCK_MS = (CFG.unlockDay - 1) * DAY_MS;
export const CYCLE_MS = CFG.cycleDays * DAY_MS;
export const SERVER_MS = CFG.serverDays * DAY_MS;
export const DURATION_MS = CFG.durationMin * 60000;
export const CYCLES = Math.ceil((SERVER_MS - UNLOCK_MS) / CYCLE_MS);

const err = (status, code, msg, extra = {}) => httpError(status, msg, { code, ...extra });
const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// ---------------------------------------------------------------- the calendar (event clock = real time + admin offset)
export async function cycleAt(vnow) {
  const start = await serverStart(), t = vnow - start;
  if (t < UNLOCK_MS) return { phase: 'locked', unlockAt: start + UNLOCK_MS };
  if (t >= SERVER_MS) return { phase: 'over' };
  const index = Math.floor((t - UNLOCK_MS) / CYCLE_MS), startsAt = start + UNLOCK_MS + index * CYCLE_MS;
  return { phase: 'open', index, number: index + 1, total: CYCLES, startsAt, endsAt: Math.min(startsAt + CYCLE_MS, start + SERVER_MS) };
}

/** For the admin panel. */
export async function schedule(vnow) {
  const start = await serverStart(), cur = await cycleAt(vnow);
  return {
    unlockHour: UNLOCK_MS / HOUR_MS, cycleHours: CYCLE_MS / HOUR_MS, serverHours: SERVER_MS / HOUR_MS,
    cycles: Array.from({ length: CYCLES }, (_, i) => {
      const startsAt = start + UNLOCK_MS + i * CYCLE_MS, endsAt = Math.min(startsAt + CYCLE_MS, start + SERVER_MS);
      return { index: i, number: i + 1, startHour: (startsAt - start) / HOUR_MS, endHour: (endsAt - start) / HOUR_MS, startsAt, endsAt, state: vnow < startsAt ? 'upcoming' : vnow < endsAt ? 'open' : 'past' };
    }),
    current: cur.phase === 'open' ? cur.index : null,
  };
}

// ---------------------------------------------------------------- damage
export const classOf = (id) => C.unitStats(id)?.cls || null;
export function troopDamage(troops) {
  let d = 0;
  for (const [id, n] of Object.entries(troops || {})) d += n * C.unitPower(id) * CFG.damagePerPower * (CFG.classMult[classOf(id)] ?? 1);
  return d;
}
const enhanceScale = (members) => Math.min(5, Math.max(1, members / 6));
export function trapLevel(points, members) {
  const k = enhanceScale(members), th = CFG.enhanceThresholds.map((x) => Math.round(x * k));
  let level = 0;
  for (const t of th) if (points >= t) level++;
  return { level, max: th.length, bonus: level * CFG.enhanceBonus, prevAt: level ? th[level - 1] : 0, nextAt: level < th.length ? th[level] : null, thresholds: th };
}
export const phaseOf = (pct) => (pct >= CFG.phaseAt[2] ? 3 : pct >= CFG.phaseAt[1] ? 2 : 1);
const tierIndex = (tiers, v) => { let i = -1; tiers.forEach((t, k) => { if (v >= t.at) i = k; }); return i; };
const scaled = (reward, cycle) => Object.fromEntries(Object.entries(reward).map(([k, n]) => [k, Math.round(n * (1 + CFG.cycleBonus * cycle))]));
const basisOf = (s) => Math.max(s.power || 0, 500) * CFG.damagePerPower;

async function memberRows(allianceId) { return AllianceMember.findAll({ where: { allianceId } }); }
async function powersOf(ids) {
  const out = new Map(ids.map((id) => [id, 0]));
  for (const s of await GameSave.findAll({ where: { playerId: ids } })) out.set(s.playerId, Math.round(C.armyPower(troopsOf(s), {})));
  return out;
}
const poolFor = (totalPower) => Math.max(CFG.poolMin, Math.round(totalPower * CFG.damagePerPower * CFG.poolHits));

async function ensureScore(huntId, player, extra = {}) {
  let s = await ElephantScore.findOne({ where: { huntId, playerId: player.id } });
  if (!s) s = await ElephantScore.create({ huntId, playerId: player.id, username: player.username, ...extra });
  return s;
}

// ---------------------------------------------------------------- hunts
export const findHunt = (allianceId, cycle) => ElephantHunt.findOne({ where: { allianceId, cycle } });
export async function activeHunt(allianceId, now = Date.now()) {
  const h = await ElephantHunt.findOne({ where: { allianceId, status: 'active' } });
  return h && h.endsAt - now > 3000 ? h : null;
}

async function activate(hunt) {
  const members = await memberRows(hunt.allianceId);
  const ids = members.map((m) => m.playerId), powers = await powersOf(ids);
  const names = new Map((await Player.findAll({ where: { id: ids }, attributes: ['id', 'username'] })).map((p) => [p.id, p.username]));
  let total = 0;
  for (const id of ids) {
    total += powers.get(id) || 0;
    const s = await ElephantScore.findOne({ where: { huntId: hunt.id, playerId: id } });
    if (s) await s.update({ power: powers.get(id) || 0 }); else await ElephantScore.create({ huntId: hunt.id, playerId: id, username: names.get(id) || '?', power: powers.get(id) || 0 });
  }
  await hunt.update({ status: 'active', pool: poolFor(total) });
  await notify(hunt.allianceId, { type: 'elephant', phase: 'start', huntId: hunt.id });
}

async function finalize(hunt) {
  const members = new Set((await memberRows(hunt.allianceId)).map((m) => m.playerId));
  const scores = await ElephantScore.findAll({ where: { huntId: hunt.id }, order: [['damage', 'DESC'], ['id', 'ASC']] });
  const pct = hunt.pool ? hunt.damage / hunt.pool : 0, aIdx = tierIndex(CFG.allianceTiers, pct);
  let rank = 0;
  for (const s of scores) {
    if (!members.has(s.playerId)) continue; // whoever left before the end gets nothing
    const parts = {};
    let pIdx = -1, myRank = null;
    if (s.damage > 0) {
      rank++;
      pIdx = tierIndex(CFG.personalTiers, s.damage / basisOf(s));
      if (pIdx >= 0) { parts.personal = scaled(CFG.personalTiers[pIdx].reward, hunt.cycle); if (rank <= 3) { parts.rank = scaled(CFG.rankBonus[rank], hunt.cycle); myRank = rank; } }
      if (aIdx >= 0) parts.alliance = scaled(CFG.allianceTiers[aIdx].reward, hunt.cycle);
    }
    const refund = {};
    for (const [k, n] of Object.entries(s.donated || {})) { const back = Math.floor(n * CFG.refundShare); if (back > 0) refund[k] = back; }
    if (sum(refund)) parts.refund = refund;
    let total = {};
    for (const p of Object.values(parts)) total = addRes(total, p);
    if (!sum(total)) continue;
    await s.update({ reward: { ...parts, total, personalTier: pIdx + 1, allianceTier: aIdx + 1, rank: myRank, pct: Math.round(pct * 100) } });
  }
  await hunt.update({ status: 'ended' });
  await notify(hunt.allianceId, { type: 'elephant', phase: 'ended', huntId: hunt.id });
}

/**
 * Called by rally.js when a rally on the elephant is launched (already inside world.serial: no serial() here).
 * joins = RallyJoin rows. Troops are never lost. Returns null when the hunt is over.
 */
export async function applyRally(huntId, joins, now = Date.now()) {
  const hunt = await ElephantHunt.findByPk(huntId);
  if (!hunt || hunt.status !== 'active' || now > hunt.endsAt + 1500) return null;
  const members = await AllianceMember.count({ where: { allianceId: hunt.allianceId } });
  const lvl = trapLevel(hunt.enhancePoints, members);
  const rallyBonus = 1 + Math.min(CFG.rallyBonusMax, CFG.rallyBonusPer * (joins.length - 1));
  const mult = rallyBonus * (1 + lvl.bonus);
  const raw = joins.map((j) => troopDamage(j.troops));
  const dmg = raw.map((x) => Math.round(x * mult));
  const total = dmg.reduce((a, b) => a + b, 0);
  const byClass = {};
  for (const j of joins) for (const [id, n] of Object.entries(j.troops)) { const c = classOf(id); if (c) byClass[c] = (byClass[c] || 0) + Math.round(n * C.unitPower(id) * CFG.damagePerPower * (CFG.classMult[c] ?? 1) * mult); }
  for (let i = 0; i < joins.length; i++) {
    const s = await ensureScore(hunt.id, { id: joins[i].playerId, username: joins[i].username });
    await s.update({ damage: s.damage + dmg[i], hits: s.hits + 1 });
  }
  const before = hunt.damage;
  await hunt.update({ damage: before + total });
  const pct = hunt.pool ? hunt.damage / hunt.pool : 0;
  await notify(hunt.allianceId, { type: 'elephant', phase: 'hit', huntId: hunt.id, total });
  return { dmg, total, summary: { huntId: hunt.id, total, rallyBonus: Math.round((rallyBonus - 1) * 100), trapBonus: Math.round(lvl.bonus * 100), byClass, alliance: Math.round(hunt.damage), pct: Math.round(pct * 100), phase: phaseOf(pct), phaseBefore: phaseOf(hunt.pool ? before / hunt.pool : 0) } };
}

// ---------------------------------------------------------------- what the screens need
export function publicConfig(members = 1) {
  const lvl = trapLevel(0, members);
  return {
    durationMin: CFG.durationMin, maxDelayMin: CFG.maxDelayMin, unlockDay: CFG.unlockDay, cycleDays: CFG.cycleDays, serverDays: CFG.serverDays, cycles: CYCLES,
    classMult: CFG.classMult, rallyBonusPer: Math.round(CFG.rallyBonusPer * 100), rallyBonusMax: Math.round(CFG.rallyBonusMax * 100),
    enhanceBonus: Math.round(CFG.enhanceBonus * 100), enhanceThresholds: lvl.thresholds, enhanceWeight: CFG.enhanceWeight, refundShare: Math.round(CFG.refundShare * 100),
    phaseAt: CFG.phaseAt, personalTiers: CFG.personalTiers, allianceTiers: CFG.allianceTiers, rankBonus: CFG.rankBonus, cycleBonus: Math.round(CFG.cycleBonus * 100),
  };
}

export function createElephant(world) {
  const serial = world.serial;
  const mustBeMember = async (player) => { const m = await membershipOf(player.id); if (!m) throw err(409, 'no_alliance', 'you are not in an alliance'); return m; };
  const mustLead = (m) => { if (m.role === 'member') throw err(403, 'not_allowed', 'only the leader or an officer can do this'); };
  const saveOf = (row) => ({ version: row.revision, troops: troopsOf(row), resources: resOf(row) });

  async function pendingOf(playerId) {
    const rows = await ElephantScore.findAll({ where: { playerId, claimed: false, reward: { [Op.ne]: null } } });
    let total = {};
    for (const s of rows) total = addRes(total, s.reward.total);
    return { count: rows.length, total };
  }

  async function huntJson(hunt, player, members, now) {
    const lvl = trapLevel(hunt.enhancePoints, members);
    const scores = await ElephantScore.findAll({ where: { huntId: hunt.id } });
    const ranked = scores.filter((s) => s.damage > 0).sort((a, b) => b.damage - a.damage || a.id - b.id);
    const mine = scores.find((s) => s.playerId === player.id) || null;
    let pool = hunt.pool;
    if (!pool) { const ids = (await memberRows(hunt.allianceId)).map((x) => x.playerId); pool = poolFor([...(await powersOf(ids)).values()].reduce((a, b) => a + b, 0)); }
    const pct = pool ? hunt.damage / pool : 0, started = hunt.status === 'active' || hunt.status === 'ended';
    const myHits = mine ? mine.damage / basisOf(mine) : 0;
    return {
      id: hunt.id, status: hunt.status, startsAt: hunt.startsAt, endsAt: hunt.endsAt, startedBy: hunt.startedByName,
      msToStart: hunt.status === 'scheduled' ? Math.max(0, hunt.startsAt - now) : 0,
      msLeft: hunt.status === 'active' ? Math.max(0, hunt.endsAt - now) : 0,
      pool: Math.round(pool), poolIsEstimate: !hunt.pool, damage: Math.round(hunt.damage), pct, phase: started ? phaseOf(pct) : 1,
      trap: { points: hunt.enhancePoints, ...lvl, thresholds: undefined },
      allianceTier: tierIndex(CFG.allianceTiers, pct) + 1,
      me: mine ? { damage: Math.round(mine.damage), hits: mine.hits, donated: mine.donated || {}, donatedPoints: mine.donatedPoints, armyHits: Math.round(myHits * 100) / 100, tier: tierIndex(CFG.personalTiers, myHits) + 1, rank: mine.damage > 0 ? ranked.findIndex((s) => s.playerId === player.id) + 1 : null, reward: mine.reward || null, claimed: mine.claimed } : { damage: 0, hits: 0, donated: {}, donatedPoints: 0, armyHits: 0, tier: 0, rank: null, reward: null, claimed: false },
      top: ranked.slice(0, 10).map((s, i) => ({ rank: i + 1, username: s.username, damage: Math.round(s.damage), hits: s.hits, you: s.playerId === player.id })),
      donors: scores.filter((s) => s.donatedPoints > 0).sort((a, b) => b.donatedPoints - a.donatedPoints).slice(0, 5).map((s) => ({ username: s.username, points: s.donatedPoints, you: s.playerId === player.id })),
    };
  }

  /** GET /alliance/elephant */
  async function status(player, now = Date.now()) {
    const m = await membershipOf(player.id);
    const pending = await pendingOf(player.id);
    if (!m) return { elephant: { available: false, reason: 'no_alliance', pending, config: publicConfig() } };
    const members = await AllianceMember.count({ where: { allianceId: m.allianceId } });
    const vnow = await serverNow(), cyc = await cycleAt(vnow);
    const base = { available: true, canManage: m.role !== 'member', role: m.role, serverNow: vnow, cycle: cyc, pending, config: publicConfig(members), members };
    if (cyc.phase !== 'open') return { elephant: { ...base, state: cyc.phase, hunt: null } };
    const hunt = await findHunt(m.allianceId, cyc.index);
    const state = !hunt || hunt.status === 'prep' ? 'idle' : hunt.status;
    return { elephant: { ...base, state, hunt: hunt ? await huntJson(hunt, player, members, now) : null, nextCycleAt: cyc.endsAt } };
  }

  const start = (player, body = {}) => serial(async () => {
    const m = await mustBeMember(player); mustLead(m);
    const cyc = await cycleAt(await serverNow());
    if (cyc.phase === 'locked') throw err(409, 'locked', `the War Elephant arrives on server day ${CFG.unlockDay}`);
    if (cyc.phase === 'over') throw err(409, 'server_over', 'the server season is over');
    let hunt = await findHunt(m.allianceId, cyc.index);
    if (hunt && hunt.status !== 'prep') throw err(409, 'already_used', 'your alliance already used its hunt for this period. The next one opens in a few days.');
    const minutes = Math.min(CFG.maxDelayMin, Math.max(0, Math.floor(Number(body.minutes)) || 0));
    const now = Date.now(), startsAt = now + minutes * 60000;
    if (!hunt) hunt = await ElephantHunt.create({ allianceId: m.allianceId, cycle: cyc.index, status: 'prep' });
    await hunt.update({ status: 'scheduled', startsAt, endsAt: startsAt + DURATION_MS, startedBy: player.id, startedByName: player.username });
    if (minutes === 0) await activate(hunt);
    else await notify(m.allianceId, { type: 'elephant', phase: 'scheduled', huntId: hunt.id });
    return status(player);
  });

  const cancel = (player) => serial(async () => {
    const m = await mustBeMember(player); mustLead(m);
    const cyc = await cycleAt(await serverNow());
    const hunt = cyc.phase === 'open' ? await findHunt(m.allianceId, cyc.index) : null;
    if (!hunt || hunt.status !== 'scheduled') throw err(409, 'not_scheduled', 'there is no scheduled hunt to cancel');
    await hunt.update({ status: 'prep', startsAt: null, endsAt: null });
    await notify(m.allianceId, { type: 'elephant', phase: 'cancelled', huntId: hunt.id });
    return status(player);
  });

  /** body: { resources: { wood: n, ... }, baseVersion } */
  const donate = (player, body = {}) => serial(async () => {
    const m = await mustBeMember(player);
    const cyc = await cycleAt(await serverNow());
    if (cyc.phase !== 'open') throw err(409, 'closed', 'the trap can not be enhanced right now');
    let hunt = await findHunt(m.allianceId, cyc.index);
    if (hunt && (hunt.status === 'active' || hunt.status === 'ended')) throw err(409, 'trap_busy', 'the trap can only be enhanced before the hunt starts');
    if (!isObj(body.resources)) throw err(400, 'bad_resources', 'choose what to give');
    const give = {};
    for (const k of RES) {
      const n = body.resources[k];
      if (n === undefined || n === 0) continue;
      if (!Number.isInteger(n) || n < 0 || n > 1e7) throw err(400, 'bad_resources', 'amounts must be whole numbers');
      give[k] = n;
    }
    const points = RES.reduce((a, k) => a + (give[k] || 0) * CFG.enhanceWeight[k], 0);
    if (!points) throw err(400, 'nothing', 'choose something to give');
    const row = await loadRow(player.id);
    staleCheck(row, body.baseVersion, 'enhance the trap');
    const have = resOf(row);
    for (const k of Object.keys(give)) if ((have[k] || 0) < give[k]) throw err(400, 'not_enough', `you do not have ${give[k]} ${k}`);
    const left = { ...have };
    for (const k of Object.keys(give)) left[k] -= give[k];
    await writeRow(row, withState(row, troopsOf(row), left));
    if (!hunt) hunt = await ElephantHunt.create({ allianceId: m.allianceId, cycle: cyc.index, status: 'prep' });
    await hunt.update({ enhancePoints: hunt.enhancePoints + points });
    const s = await ensureScore(hunt.id, player);
    await s.update({ donated: addRes(s.donated || {}, give), donatedPoints: s.donatedPoints + points });
    await notify(m.allianceId, { type: 'elephant', phase: 'enhanced', huntId: hunt.id }, player.id);
    const fresh = await loadRow(player.id);
    return { ...(await status(player)), save: saveOf(fresh) };
  });

  /** body: { baseVersion } : every unclaimed reward of every finished hunt */
  const claim = (player, body = {}) => serial(async () => {
    const rows = await ElephantScore.findAll({ where: { playerId: player.id, claimed: false, reward: { [Op.ne]: null } } });
    const row = await loadRow(player.id);
    if (!rows.length) return { rewards: [], save: saveOf(row) };
    staleCheck(row, body.baseVersion, 'claim');
    let total = {};
    for (const s of rows) total = addRes(total, s.reward.total);
    await writeRow(row, withState(row, troopsOf(row), addRes(resOf(row), total)));
    for (const s of rows) await s.update({ claimed: true });
    const hunts = new Map((await ElephantHunt.findAll({ where: { id: rows.map((s) => s.huntId) } })).map((h) => [h.id, h]));
    const fresh = await loadRow(player.id);
    return { rewards: rows.map((s) => ({ huntId: s.huntId, cycle: (hunts.get(s.huntId)?.cycle ?? 0) + 1, ...s.reward })), total, save: saveOf(fresh) };
  });

  /** Ticker (every second): scheduled hunts start, hunts whose 30 minutes are over pay out. */
  const tick = (now = Date.now()) => serial(async () => {
    for (const h of await ElephantHunt.findAll({ where: { status: 'scheduled', startsAt: { [Op.lte]: now } } })) { try { await activate(h); } catch (e) { console.error('[elephant] start failed', e.message); } }
    for (const h of await ElephantHunt.findAll({ where: { status: 'active', endsAt: { [Op.lte]: now } } })) { try { await finalize(h); } catch (e) { console.error('[elephant] finish failed', e.message); } }
  });

  return { status, start, cancel, donate, claim, tick };
}
