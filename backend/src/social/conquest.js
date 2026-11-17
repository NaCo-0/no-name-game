/**
 * Province Conquest. On server day 7 at 08:00 (server time) the provinces open for ALL alliances (any civilization):
 *   - in EVERY biome two ADJACENT provinces open at the same time, for one hour (so 2 per biome = 10 towers at once);
 *     then a half hour wait and the next two of every biome open (8:00-9:00, 9:30-10:30, ...), until all 15 of each biome are done
 *   - a province's tower holds an NPC garrison. Alliances send RALLIES at it (the army walks there first): win and the tower is yours, and
 *     the tower keeps changing hands as other alliances rally it
 *   - the winning troops STAY in the tower: they are its garrison. Members can set the tower's defensive formation, send reinforcements or pull their
 *     troops out (they walk home). An attacker has to beat that garrison; a tower with no troops left falls. When the province closes everybody walks home.
 *   - the alliance holding the tower earns points every second (+ a bonus for every capture)
 *   - when the province's hour is over, the province is given to the alliance with the MOST POINTS of that tower
 * Alliances can hold members of any civilization, and every alliance can fight for every province.
 * The calendar uses the event clock (real time + the admin's offset); the fights and the points use real time.
 * All numbers are in CFG.
 */
import { Op } from 'sequelize';
import { ProvinceState, Alliance, TowerTroops, TroopReturn } from './models.js';
import { GameSave, Meta, Castle } from '../models.js';
import { armyPower, simulate, bestAutoLayout, pickCounterFormation, fitLayout, normalizeLayout } from '../battle.js';
import * as C from '../battleConfig.js';
import * as mail from '../mail.js';
import { TROOPS, troopFor } from '../troops.js';
import { allocate } from './rally.js';
import { loadRow, troopsOf, withState, writeRow, staleCheck, addTroops } from './saves.js';
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

  // ---------------------------------------------------------------- the garrison (troops that stay in a tower)
  const sumT = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
  const towerKey = (id) => `tower:${id}`;
  const garrisonRows = (provinceId) => TowerTroops.findAll({ where: { provinceId }, order: [['id', 'ASC']] });
  const totalOf = (rows) => rows.reduce((t, r) => addTroops(t, r.troops), {});
  const tileOf = (provinceId) => { const i = load().byId.get(provinceId); return i && i.capital ? { tileX: i.capital.tileX, tileY: i.capital.tileY } : null; };
  async function walkMs(playerId, provinceId) {
    const castle = await Castle.findOne({ where: { playerId } }), to = tileOf(provinceId);
    return castle && to && world.marchMs ? world.marchMs(castle, to) : 5000;
  }
  async function sendHome(playerId, provinceId, troops, why, now = Date.now()) {
    if (sumT(troops) <= 0) return;
    await TroopReturn.create({ playerId, troops, returnAt: now + (await walkMs(playerId, provinceId)), why });
  }
  async function savedTower(provinceId) {
    const m = await Meta.findByPk(towerKey(provinceId));
    try { return m?.value ? JSON.parse(m.value) : null; } catch { return null; }
  }
  /** A tower with nobody in it falls: it has no holder any more (the points it earned stay). */
  async function fallIfEmpty(provinceId, now = Date.now()) {
    if ((await TowerTroops.count({ where: { provinceId } })) > 0) return;
    const st = await ProvinceState.findOne({ where: { provinceId } });
    if (!st || st.status !== 'open' || !st.holderId) return;
    await accrue(st, now);
    const info = load().byId.get(provinceId), tag = st.names[st.holderId]?.tag, was = st.holderId;
    await st.update({ holderId: null, holdSince: null, lastTickAt: now });
    live.broadcast({ type: 'conquest', phase: 'captured', provinceId, name: info?.name, by: null });
    if (info) await notify(was, { type: 'conquest', phase: 'lost', provinceId, name: info.name, by: tag ? `${tag} (empty tower)` : null });
  }
  /** Troops that won the tower stay in it. */
  async function station(provinceId, allianceId, playerId, username, troops) {
    const row = await TowerTroops.findOne({ where: { provinceId, playerId } });
    if (row) await row.update({ troops: addTroops(row.troops, troops), allianceId });
    else await TowerTroops.create({ provinceId, playerId, username, allianceId, troops });
  }
  async function releaseRows(rows, why) {
    const touched = new Set();
    for (const row of rows) { await sendHome(row.playerId, row.provinceId, row.troops, why); touched.add(row.provinceId); await row.destroy(); }
    for (const id of touched) await fallIfEmpty(id);
  }
  /** (inside world.serial) a member left the alliance: their stationed troops walk home */
  const releasePlayer = async (playerId) => releaseRows(await TowerTroops.findAll({ where: { playerId } }), 'left');
  /** (inside world.serial) the alliance was closed */
  const releaseAlliance = async (allianceId) => releaseRows(await TowerTroops.findAll({ where: { allianceId } }), 'closed');

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
    const G = st && st.holderId ? totalOf(await garrisonRows(provinceId)) : {};
    return { name: info.name, local: info.local, closesInMs: t.closesAt - vnow, power: Math.round(armyPower(sumT(G) > 0 ? G : garrisonFor(info.local), {})) };
  }

  /** The fight: the rally against the tower's garrison (the troops that stayed in it, or the NPC garrison). Returns null when the province closed in the meantime (troops go home).
   *  opts: { attLayout (the host's battle plan, fitted), hostName } */
  async function battle(provinceId, allianceId, combined, now = Date.now(), opts = {}) {
    const P = load(), info = P.byId.get(provinceId);
    if (!info) return null;
    const vnow = await serverNow(), t = await times(info, vnow);
    if (t.state !== 'open') return null;
    let st = await ProvinceState.findOne({ where: { provinceId } });
    if (!st) st = await ProvinceState.create({ provinceId, civId: info.civId, status: 'open', lastTickAt: now });
    if (st.holderId === allianceId) return null;

    const rows = st.holderId ? await garrisonRows(provinceId) : [];
    const G = totalOf(rows), players = sumT(G) > 0;
    let defLayout;
    if (players) { const saved = await savedTower(provinceId); defLayout = fitLayout(saved && saved.allianceId === st.holderId ? saved.layout : null, G, CFG.garrisonFormation); }
    else defLayout = bestAutoLayout(garrisonFor(info.local), CFG.garrisonFormation);
    const attLayout = opts.attLayout || bestAutoLayout(combined, pickCounterFormation(combined, defLayout.formation));
    const res = simulate(attLayout, defLayout);
    const report = {
      ticks: res.ticks, log: res.log, events: res.events, attackerPower: res.attackerPower, defenderPower: res.defenderPower,
      attackerFormation: res.attackerFormation, defenderFormation: res.defenderFormation, effects: res.effects, slots: res.slots,
      defenderLosses: res.defenderLosses, defenderSent: res.defenderSent, defenderSurvivors: res.defenderSurvivors,
      ...(players ? { garrison: { defenders: rows.length } } : { campType: 'raider', campLevel: 3, camp: { level: 3, type: 'raider' } }),
      province: { id: provinceId, name: info.name, captured: !!res.win },
    };

    // the defenders' losses, shared out between the players who stand in the tower; the wounded walk home
    if (players) {
      const deadBy = rows.map(() => ({}));
      for (const [id, n] of Object.entries(res.defenderLosses || {})) {
        allocate(n, rows.map((r) => r.troops[id] || 0)).forEach((p, i) => { if (p > 0) deadBy[i][id] = p; });
      }
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i], left = { ...row.troops }, wounded = {};
        for (const [id, n] of Object.entries(deadBy[i])) {
          const w = Math.floor(n * C.WOUNDED_SHARE); if (w) wounded[id] = w;
          left[id] = (left[id] || 0) - n; if (left[id] <= 0) delete left[id];
        }
        await sendHome(row.playerId, provinceId, wounded, 'wounded', now);
        if (res.win) { await sendHome(row.playerId, provinceId, left, 'overrun', now); await row.destroy(); }
        else if (sumT(left) > 0) await row.update({ troops: left });
        else await row.destroy();
        await mail.deliver({
          playerId: row.playerId, kind: 'report', fromName: opts.hostName || null,
          subject: `${res.win ? 'Tower lost' : 'Tower held'}: ${info.name}`,
          data: { role: 'defender', source: 'tower', target: 'province', castleName: `${info.name} tower`, attacker: opts.hostName || 'An alliance', at: now, report: { ...report, win: !!res.win, losses: res.attackerLosses, mine: { lost: deadBy[i] } } },
        }).catch(() => {});
        live.send(row.playerId, { type: 'conquest', phase: res.win ? 'overrun' : 'defended', provinceId, name: info.name });
      }
      if (!res.win) await fallIfEmpty(provinceId, now);
    }
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
    for (const row of await garrisonRows(info.id)) { await sendHome(row.playerId, info.id, row.troops, 'closed'); await row.destroy(); } // the province is decided: the garrison walks home
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
    const stationed = new Map();
    for (const row of await TowerTroops.findAll()) { if (!stationed.has(row.provinceId)) stationed.set(row.provinceId, []); stationed.get(row.provinceId).push(row); }
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
          garrisonPower: Math.round(armyPower(sumT(totalOf(stationed.get(id) || [])) > 0 ? totalOf(stationed.get(id)) : garrisonFor(info.local), {})),
          garrison: (() => { const rows = stationed.get(id) || [], mineRow = rows.find((x) => x.playerId === player.id), ours = !!m && rows.some((x) => x.allianceId === m.allianceId); return { players: rows.length, troops: ours ? sumT(totalOf(rows)) : null, mine: mineRow ? sumT(mineRow.troops) : 0, npc: !rows.length }; })(),
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

  // ---------------------------------------------------------------- the tower: garrison, formation, reinforcements, withdrawing (each one its own world.serial step)
  async function stateFor(player, provinceId) {
    const info = load().byId.get(provinceId);
    if (!info) throw err(404, 'no_province', 'there is no such province');
    const m = await membershipOf(player.id);
    const st = await ProvinceState.findOne({ where: { provinceId } });
    return { info, m, st, holds: !!m && !!st && st.status === 'open' && st.holderId === m.allianceId };
  }

  /** GET /conquest/tower?provinceId= : who stands in the tower and with what formation. */
  const tower = (player, provinceId) => serial(async () => {
    provinceId = Math.floor(Number(provinceId));
    const { info, m, st, holds } = await stateFor(player, provinceId);
    const rows = await garrisonRows(provinceId), G = totalOf(rows), mine = rows.find((r) => r.playerId === player.id);
    const ours = !!m && rows.some((r) => r.allianceId === m.allianceId);
    const saved = await savedTower(provinceId);
    const planned = !!(saved && st && saved.allianceId === st.holderId);
    const layout = ours && sumT(G) > 0 ? fitLayout(planned ? saved.layout : null, G, CFG.garrisonFormation) : null;
    return { tower: {
      provinceId, name: info.name, holds, holder: st && st.holderId ? { allianceId: st.holderId, ...(st.names[st.holderId] || {}) } : null,
      army: ours ? G : null, power: Math.round(armyPower(sumT(G) > 0 ? G : garrisonFor(info.local), {})), npc: !rows.length,
      members: ours ? rows.map((r) => ({ id: r.playerId, username: r.username, count: sumT(r.troops) })) : null,
      mine: mine ? mine.troops : {}, layout, planned, canSet: !!mine && holds,
    } };
  });

  /** body: { provinceId, layout } : the defensive formation of the tower, built from the troops standing in it (fitted again whenever they change). */
  const setTowerLayout = (player, body = {}) => serial(async () => {
    const provinceId = Math.floor(Number(body.provinceId));
    const { st, holds } = await stateFor(player, provinceId);
    const mine = await TowerTroops.findOne({ where: { provinceId, playerId: player.id } });
    if (!holds || !mine) throw err(403, 'not_in_tower', 'only players whose troops stand in a tower your alliance holds can set its defence');
    if (body.layout == null) { await Meta.destroy({ where: { key: towerKey(provinceId) } }); return { layout: null }; }
    const layout = normalizeLayout(body.layout, totalOf(await garrisonRows(provinceId)));
    await Meta.upsert({ key: towerKey(provinceId), value: JSON.stringify({ layout, allianceId: st.holderId, by: player.username, at: Date.now() }) });
    return { layout };
  });

  /** body: { provinceId, troops, baseVersion } : more troops into the tower your alliance holds (they step inside right away). */
  const reinforce = (player, body = {}) => serial(async () => {
    const provinceId = Math.floor(Number(body.provinceId));
    const { info, st, holds } = await stateFor(player, provinceId);
    if (!holds) throw err(409, 'not_holder', 'your alliance does not hold this tower');
    if ((await times(info, await serverNow())).state !== 'open') throw err(409, 'closed', 'this province is closed');
    const row = await loadRow(player.id);
    staleCheck(row, body.baseVersion, 'reinforce');
    const have = troopsOf(row), sent = {};
    if (!body.troops || typeof body.troops !== 'object' || Array.isArray(body.troops)) throw err(400, 'bad_troops', 'troops: choose the troops to send');
    for (const [id, n] of Object.entries(body.troops)) {
      if (!Number.isInteger(n) || n < 0 || n > 1e6) throw err(400, 'bad_troops', 'troops: counts must be whole numbers');
      if (!n) continue;
      if (!troopFor(id, row.culture)) throw err(400, 'bad_troops', 'troops: unknown troop');
      if ((have[id] || 0) < n) throw err(400, 'not_enough', `you do not have ${n} x ${id}`);
      sent[id] = n;
    }
    if (!sumT(sent)) throw err(400, 'no_troops', 'troops: send at least one soldier');
    const left = { ...have };
    for (const [id, n] of Object.entries(sent)) { left[id] -= n; if (left[id] <= 0) delete left[id]; }
    const version = await writeRow(row, withState(row, left));
    await station(provinceId, st.holderId, player.id, player.username, sent);
    return { save: { version, troops: left } };
  });

  /** body: { provinceId } : take YOUR troops out of the tower; they walk home (claim them when they arrive). An empty tower falls. */
  const withdraw = (player, body = {}) => serial(async () => {
    const provinceId = Math.floor(Number(body.provinceId));
    const row = await TowerTroops.findOne({ where: { provinceId, playerId: player.id } });
    if (!row) throw err(404, 'not_in_tower', 'you have no troops in this tower');
    const ms = await walkMs(player.id, provinceId);
    await releaseRows([row], 'withdrawn');
    return { ok: true, returnsInMs: ms };
  });

  /** The top-down picture of the provinces (static per map): see spawner.provinceMap(). */
  function map() { load(); return spawner.provinceMap ? spawner.provinceMap() : null; }

  /** For the admin panel. */
  async function schedule(vnow) {
    const P = load(), start = (await serverStart()), span = await eventSpan(vnow);
    return { startHour: (span.startsAt - start) / HOUR_MS, endHour: (span.endsAt - start) / HOUR_MS, startsAt: span.startsAt, endsAt: span.endsAt, state: span.state, slots: P.slots, stepMin: CFG.windowMin + CFG.breakMin, windowMin: CFG.windowMin };
  }

  return { checkTarget, battle, tick, status, schedule, load, map, tileOf, station, releasePlayer, releaseAlliance, tower, setTowerLayout, reinforce, withdraw };
}
