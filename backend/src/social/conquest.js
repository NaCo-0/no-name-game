/**
 * Province Conquest. On server day 7 at 08:00 (server time) the provinces open for ALL alliances (any civilization):
 *   - in EVERY biome two ADJACENT provinces open at the same time, for one hour (so 2 per biome = 10 towers at once);
 *     then a half hour wait and the next two of every biome open (8:00-9:00, 9:30-10:30, ...), until all 15 of each biome are done
 *   - a province's tower holds an NPC garrison. Alliances send RALLIES at it: win and the tower is yours, and
 *     the tower keeps changing hands as other alliances rally it
 *   - the alliance holding the tower earns points every second (+ a bonus for every capture)
 *   - when the province's hour is over, the province is given to the alliance with the MOST POINTS of that tower
 * Alliances can hold members of any civilization, and every alliance can fight for every province.
 * The calendar uses the event clock (real time + the admin's offset); the fights and the points use real time.
 * All numbers are in CFG.
 */
import { Op } from 'sequelize';
import { ProvinceState, Alliance } from './models.js';
import { GameSave } from '../models.js';
import { fight, armyPower } from '../battle.js';
import { TROOPS } from '../troops.js';
import { CULTURE_TO_CIV } from '../constants.js';
import * as live from '../live.js';
import { httpError } from '../httpError.js';
import { membershipOf, notify } from './alliance.js';
import { serverStart, serverNow, DAY_MS, HOUR_MS } from './clock.js';

export const CFG = {
  startDay: 7, startHour: 8,       // server day 7, 08:00 after the day begins (start the season at midnight to make this wall-clock 08:00)
  windowMin: 60, breakMin: 30,     // in every biome 2 provinces open for 60 minutes, then a 30 minute wait, then the next 2 (never overlapping)
  holdPointsPerSec: 1,             // points per second for the holder
  capturePoints: 300,              // bonus for the alliance that takes the tower
  garrisonBase: 150, garrisonPerIndex: 15, // units in the garrison = base + index x this (index 0..14), troop level 3
  garrisonMix: { spear: 0.3, sword: 0.3, archer: 0.3, cav: 0.1 },
  garrisonFormation: 'shield_wall',
  logMax: 12,
};
const WINDOW_MS = CFG.windowMin * 60000, STEP_MS = (CFG.windowMin + CFG.breakMin) * 60000;
const err = (status, code, msg, extra = {}) => httpError(status, msg, { code, ...extra });

// ---------------------------------------------------------------- the provinces and which two open together
const GENERAL = new Map();
for (const t of TROOPS.values()) if (!t.culture) GENERAL.set(`${t.cls}:${t.level}`, t.id);

export function garrisonFor(local) {
  const units = CFG.garrisonBase + CFG.garrisonPerIndex * local, army = {};
  for (const [cls, share] of Object.entries(CFG.garrisonMix)) { const id = GENERAL.get(`${cls}:3`); if (id) army[id] = Math.max(1, Math.round(units * share)); }
  return army;
}

/** Splits one biome into groups of two ADJACENT provinces (one left alone if the number is odd), ordered from the inner provinces out. */
export function groupsFor(provs) {
  const byId = new Map(provs.map((p) => [p.id, p]));
  const adj = (id) => (byId.get(id).neighbors || []).filter((n) => byId.has(n)).sort((a, b) => byId.get(a).local - byId.get(b).local);
  const order = [...provs].sort((a, b) => a.local - b.local).map((p) => p.id);
  const matchAll = (left) => { // perfect matching of `left` (array of ids), or null
    if (!left.length) return [];
    const [a, ...rest] = left;
    for (const b of adj(a)) {
      if (!rest.includes(b)) continue;
      const m = matchAll(rest.filter((x) => x !== b));
      if (m) return [[a, b], ...m];
    }
    return null;
  };
  let pairs = null, single = [];
  if (order.length % 2 === 0) pairs = matchAll(order);
  else for (const drop of [...order].reverse()) { const m = matchAll(order.filter((x) => x !== drop)); if (m) { pairs = m; single = [[drop]]; break; } }
  if (!pairs) { // no perfect pairing (odd map): greedy, leftovers play alone
    const used = new Set(); pairs = [];
    for (const a of order) { if (used.has(a)) continue; const b = adj(a).find((x) => !used.has(x)); used.add(a); if (b !== undefined) { used.add(b); pairs.push([a, b]); } else single.push([a]); }
  }
  const key = (g) => Math.min(...g.map((id) => byId.get(id).local));
  return [...pairs.sort((x, y) => key(x) - key(y)), ...single.sort((x, y) => key(x) - key(y))].map((g) => g.sort((a, b) => byId.get(a).local - byId.get(b).local));
}

export function createConquest(world, { spawner }) {
  const serial = world.serial;
  let plan = null; // { key, byId: Map(id -> {...info, slot}), civs: Map(civId -> [{ids, slot}]), slots }

  function load() {
    const key = spawner.mapKey?.() ?? 'none';
    if (plan && plan.key === key) return plan;
    const list = spawner.provinces ? spawner.provinces().provinces : [];
    const byId = new Map(), civs = new Map();
    for (const p of list) { byId.set(p.id, { ...p }); if (!civs.has(p.civId)) civs.set(p.civId, []); civs.get(p.civId).push(p); }
    // EVERY biome has its own sequence: slot 0 = the first adjacent pair of every biome (they all open together), slot 1 = the next pair, ...
    let slots = 0;
    const groups = [];
    for (const [civId, provs] of civs) {
      const gs = groupsFor(provs).map((ids, slot) => { for (const id of ids) byId.get(id).slot = slot; return { ids, slot }; });
      civs.set(civId, gs); groups.push(...gs);
      slots = Math.max(slots, gs.length);
    }
    groups.sort((x, y) => x.slot - y.slot);
    return (plan = { key, byId, civs, groups, slots });
  }

  async function times(info, vnow) {
    const start = (await serverStart()) + (CFG.startDay - 1) * DAY_MS + CFG.startHour * HOUR_MS;
    const opensAt = start + info.slot * STEP_MS, closesAt = opensAt + WINDOW_MS;
    return { opensAt, closesAt, state: vnow < opensAt ? 'closed' : vnow < closesAt ? 'open' : 'over' };
  }
  async function eventSpan(vnow) {
    const P = load(), start = (await serverStart()) + (CFG.startDay - 1) * DAY_MS + CFG.startHour * HOUR_MS;
    const endsAt = start + Math.max(0, P.slots - 1) * STEP_MS + WINDOW_MS;
    return { startsAt: start, endsAt, state: !P.byId.size ? 'none' : vnow < start ? 'upcoming' : vnow < endsAt ? 'live' : 'over' };
  }

  const allianceName = async (id) => { const a = await Alliance.findByPk(id); return { name: a?.name || '?', tag: a?.tag || '?' }; };

  // ---------------------------------------------------------------- called by rally.js (already inside world.serial)
  /** Can this alliance rally this province right now? Returns what the rally needs, or throws. */
  async function checkTarget(provinceId, allianceId) {
    const P = load(), info = P.byId.get(provinceId);
    if (!info) throw err(404, 'no_province', 'there is no such province');
    const al = await Alliance.findByPk(allianceId);
    if (!al) throw err(404, 'no_alliance', 'there is no such alliance');
    const vnow = await serverNow(), t = await times(info, vnow);
    if (t.state === 'closed') throw err(409, 'not_open', 'this province has not opened yet');
    if (t.state === 'over') throw err(409, 'closed', 'this province is closed: it has been given to an alliance');
    const st = await ProvinceState.findOne({ where: { provinceId } });
    if (st && st.holderId === allianceId) throw err(409, 'already_holder', 'your alliance already holds this tower');
    return { name: info.name, local: info.local, closesInMs: t.closesAt - vnow, power: Math.round(armyPower(garrisonFor(info.local), {})) };
  }

  /** The fight: the rally against the garrison. Returns null when the province closed in the meantime (troops go home). */
  async function battle(provinceId, allianceId, combined, now = Date.now()) {
    const P = load(), info = P.byId.get(provinceId);
    if (!info) return null;
    const vnow = await serverNow(), t = await times(info, vnow);
    if (t.state !== 'open') return null;
    let st = await ProvinceState.findOne({ where: { provinceId } });
    if (!st) st = await ProvinceState.create({ provinceId, civId: info.civId, status: 'open', lastTickAt: now });
    if (st.holderId === allianceId) return null;
    const garrison = garrisonFor(info.local);
    const res = fight(combined, garrison, { defenderFormation: CFG.garrisonFormation });
    const report = {
      ticks: res.ticks, log: res.log, events: res.events, attackerPower: res.attackerPower, defenderPower: res.defenderPower,
      attackerFormation: res.attackerFormation, defenderFormation: res.defenderFormation, effects: res.effects, slots: res.slots,
      defenderLosses: res.defenderLosses, defenderSent: res.defenderSent, campType: 'raider', campLevel: 3, camp: { level: 3, type: 'raider' },
      province: { id: provinceId, name: info.name, captured: !!res.win },
    };
    if (res.win) {
      const al = await allianceName(allianceId), previous = st.holderId;
      await accrue(st, now);
      const points = { ...st.points }, names = { ...st.names };
      points[allianceId] = (points[allianceId] || 0) + CFG.capturePoints; names[allianceId] = al;
      const log = [{ at: now, allianceId, tag: al.tag, name: al.name, from: previous ? (names[previous]?.tag || '?') : null }, ...st.log].slice(0, CFG.logMax);
      await st.update({ holderId: allianceId, holdSince: now, points, names, captures: st.captures + 1, log, lastTickAt: now });
      live.broadcast({ type: 'conquest', phase: 'captured', provinceId, name: info.name, by: al.tag });
      if (previous) await notify(previous, { type: 'conquest', phase: 'lost', provinceId, name: info.name, by: al.tag });
      report.province.holder = al;
    }
    return { win: !!res.win, dead: res.attackerLosses, report, name: info.name };
  }

  // ---------------------------------------------------------------- points + closing
  async function accrue(st, now) {
    if (!st.holderId || st.status !== 'open') return;
    const dt = Math.min(5, Math.max(0, (now - (st.lastTickAt || now)) / 1000));
    if (dt <= 0) return;
    await st.update({ points: { ...st.points, [st.holderId]: (st.points[st.holderId] || 0) + dt * CFG.holdPointsPerSec }, lastTickAt: now });
  }

  async function close(st, info) {
    const entries = Object.entries(st.points).filter(([, p]) => p > 0).sort((a, b) => (b[1] - a[1]) || ((Number(b[0]) === st.holderId) - (Number(a[0]) === st.holderId)));  // a tie goes to the holder
    const winner = entries.length ? Number(entries[0][0]) : null;
    await st.update({ status: 'done', ownerId: winner, holderId: null });
    live.broadcast({ type: 'conquest', phase: 'closed', provinceId: info.id, name: info.name, winner: winner ? st.names[winner]?.tag : null });
    if (winner) await notify(winner, { type: 'conquest', phase: 'won', provinceId: info.id, name: info.name });
  }

  /** Every second: holders earn points, provinces whose hour is over are handed to the top alliance. */
  const tick = (now = Date.now()) => serial(async () => {
    const P = load();
    if (!P.byId.size) return;
    const vnow = await serverNow();
    if ((await eventSpan(vnow)).state === 'upcoming') return;
    for (const st of await ProvinceState.findAll({ where: { status: 'open' } })) {
      const info = P.byId.get(st.provinceId); if (!info) continue;
      const t = await times(info, vnow);
      if (t.state === 'over') { await accrue(st, now); await close(st, info); }
      else if (t.state === 'open') await accrue(st, now);
    }
    // provinces nobody attacked just stay NPC: nothing to hand out
  });

  // ---------------------------------------------------------------- what the screens need
  async function status(player) {
    const P = load(), vnow = await serverNow(), now = Date.now();
    const save = await GameSave.findOne({ where: { playerId: player.id }, attributes: ['culture'] });
    const civId = CULTURE_TO_CIV[save?.culture]; // only informational now: every province is open to every alliance
    const span = await eventSpan(vnow);
    const m = await membershipOf(player.id);
    const states = new Map((await ProvinceState.findAll()).map((s) => [s.provinceId, s]));
    const provinces = [];
    for (const group of P.groups) {
      for (const id of group.ids) {
        const info = P.byId.get(id), t = await times(info, vnow), st = states.get(id);
        const ranking = st ? Object.entries(st.points).map(([a, p]) => ({ allianceId: Number(a), ...(st.names[a] || { name: '?', tag: '?' }), points: Math.floor(p) })).sort((a, b) => b.points - a.points) : [];
        const holder = st && st.holderId ? { allianceId: st.holderId, ...(st.names[st.holderId] || { name: '?', tag: '?' }) } : null;
        const owner = st && st.ownerId ? { allianceId: st.ownerId, ...(st.names[st.ownerId] || { name: '?', tag: '?' }) } : null;
        const state = st && st.status === 'done' ? 'done' : t.state === 'over' ? 'done' : t.state;
        provinces.push({
          id, civId: info.civId, local: info.local, name: info.name, slot: info.slot, partner: group.ids.find((x) => x !== id) ?? null, capital: info.capital,
          state, opensAt: t.opensAt, closesAt: t.closesAt, msToOpen: Math.max(0, t.opensAt - vnow), msLeft: state === 'open' ? Math.max(0, t.closesAt - vnow) : 0,
          holder, holdSecs: holder && st.holdSince ? Math.floor((now - st.holdSince) / 1000) : 0, owner, captures: st ? st.captures : 0,
          garrisonPower: Math.round(armyPower(garrisonFor(info.local), {})),
          top: ranking.slice(0, 3).map((r) => ({ ...r, you: !!m && r.allianceId === m.allianceId })),
          myPoints: m && st ? Math.floor(st.points[m.allianceId] || 0) : 0,
          mine: !!(m && ((holder && holder.allianceId === m.allianceId) || (owner && owner.allianceId === m.allianceId))),
          canAttack: !!m && state === 'open' && !(holder && holder.allianceId === m.allianceId),
          log: st ? st.log.slice(0, 5) : [],
        });
      }
    }
    return { conquest: { now, serverNow: vnow, event: span, civId, inAlliance: !!m, canRally: !!m, provinces, config: { holdPointsPerSec: CFG.holdPointsPerSec, capturePoints: CFG.capturePoints, stepMin: CFG.windowMin + CFG.breakMin, breakMin: CFG.breakMin, windowMin: CFG.windowMin, startDay: CFG.startDay, startHour: CFG.startHour } } };
  }

  /** The top-down picture of the provinces (static per map): see spawner.provinceMap(). */
  function map() { load(); return spawner.provinceMap ? spawner.provinceMap() : null; }

  /** For the admin panel. */
  async function schedule(vnow) {
    const P = load(), start = (await serverStart()), span = await eventSpan(vnow);
    return { startHour: (span.startsAt - start) / HOUR_MS, endHour: (span.endsAt - start) / HOUR_MS, startsAt: span.startsAt, endsAt: span.endsAt, state: span.state, slots: P.slots, stepMin: CFG.windowMin + CFG.breakMin, windowMin: CFG.windowMin };
  }

  return { checkTarget, battle, tick, status, schedule, load, map };
}
