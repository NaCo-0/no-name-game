/**
 * Rallies: a member calls the alliance to attack ONE target (an NPC camp or another player's castle).
 *   1. host creates the rally and puts in their first troops; it launches by itself after `minutes` (or the host / an officer launches it early)
 *   2. other members "donate" troops while it is gathering (troops leave their save right away, so nobody can use them twice)
 *   3. at launch ALL troops fight as ONE army (one battle, instant like castle attacks); winners split the loot by contributed power
 *   4. every donor claims survivors + loot share (POST /rally/claim), exactly like returning expeditions
 * Everything runs inside world.serial so it never races with camp attacks.
 */
import { Op } from 'sequelize';
import { Rally, RallyJoin, AllianceMember, Alliance } from './models.js';
import { Castle, NpcCamp, GameSave, Meta } from '../models.js';
import { httpError } from '../httpError.js';
import { troopFor } from '../troops.js';
import { fight, simulate, autoLayout, normalizeLayout, layoutArmy, armyPower } from '../battle.js';
import * as C from '../battleConfig.js';
import * as NPC from '../npcConfig.js';
import * as live from '../live.js';
import * as mail from '../mail.js';
import * as events from './events.js';
import * as elephant from './elephant.js';
import { hooks as allianceHooks, membershipOf, notify } from './alliance.js';
import { loadRow, troopsOf, resOf, withState, writeRow, staleCheck, retryStale, addTroops, addRes, RES } from './saves.js';

export const MAX_ACTIVE_PER_ALLIANCE = 3;
export const MAX_PROVINCE_RALLIES = 6;  // rallies on province towers (Province Conquest), counted apart as well
export const MAX_ELEPHANT_RALLIES = 6; // rallies on the War Elephant run side by side (they do not count in the 3 above)
export const DEFAULT_MINUTES = 10, MIN_MINUTES = 1, MAX_MINUTES = 60;
const FINISHED_KEEP_MS = 24 * 3600 * 1000;

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const err = (status, code, msg, extra = {}) => httpError(status, msg, { code, ...extra });
const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
const defKey = (id) => `defense:${id}`;

/** Splits integer `total` by `weights` (largest remainder): the parts add up to exactly `total`. */
export function allocate(total, weights) {
  const w = weights.map((x) => Math.max(0, x)), s = w.reduce((a, b) => a + b, 0);
  if (!(total > 0) || !s) return weights.map(() => 0);
  const raw = w.map((x) => (total * x) / s), out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k][1]]++;
  return out;
}

/** Lost troops: the wounded share comes back (same rule as castle attacks in pvp.js). */
function applyLosses(have, losses) {
  const left = { ...have }, dead = {}, wounded = {};
  for (const [id, n] of Object.entries(losses || {})) {
    const w = Math.floor(n * C.WOUNDED_SHARE), d = n - w;
    if (w) wounded[id] = w;
    if (d) dead[id] = d;
    left[id] = (left[id] || 0) - d;
    if (left[id] <= 0) delete left[id];
  }
  return { left, dead, wounded };
}

async function defenseLayout(playerId, army) {
  const m = await Meta.findByPk(defKey(playerId));
  let saved = null;
  try { saved = m?.value ? JSON.parse(m.value) : null; } catch { /* ignore */ }
  if (saved) { try { return normalizeLayout(saved, army); } catch { /* troops changed */ } }
  return autoLayout(army, saved?.formation);
}

const isProtected = (row) => row.revision < C.PROTECT_REVISION || armyPower(troopsOf(row), {}) < C.PROTECT_POWER;

export function createRally(world, { conquest } = {}) {
  const serial = world.serial;

  // ---- json ---------------------------------------------------------------------------
  async function targetInfo(r) {
    if (r.targetType === 'elephant') return { exists: true };
    if (r.targetType === 'province') { try { const i = await conquest.checkTarget(Number(String(r.targetKey).split(':')[1]), r.allianceId); return { exists: true, power: i.power }; } catch { return { exists: false }; } }
    if (r.targetType === 'camp') {
      const c = await NpcCamp.findOne({ where: { key: r.targetKey } });
      return c ? { exists: true, level: c.level, power: Math.round(armyPower(c.army, {})), tileX: c.tileX, tileY: c.tileY } : { exists: false };
    }
    const c = await Castle.findOne({ where: { key: r.targetKey } });
    return c ? { exists: true, tileX: c.tileX, tileY: c.tileY } : { exists: false };
  }

  async function rallyJson(r, meId, now = Date.now()) {
    const all = await RallyJoin.findAll({ where: { rallyId: r.id }, order: [['id', 'ASC']] });
    const mineJoin = all.find((j) => j.playerId === meId);
    const joins = r.status === 'gathering' ? all.filter((j) => !j.result) : all; // a member who left keeps a refund row, but is not part of the army
    const total = {};
    for (const j of joins) for (const [id, n] of Object.entries(j.troops)) total[id] = (total[id] || 0) + n;
    return {
      id: r.id, allianceId: r.allianceId, hostId: r.hostId, hostName: r.hostName,
      target: { type: r.targetType, id: r.targetKey, name: r.targetName, ...(r.status === 'gathering' ? await targetInfo(r) : {}) },
      status: r.status, launchAt: r.launchAt, msLeft: Math.max(0, r.launchAt - now),
      troops: sum(total), power: Math.round(armyPower(total, {})), donors: joins.length,
      members: joins.map((j) => ({ id: j.playerId, username: j.username, troops: sum(j.troops), power: Math.round(armyPower(j.troops, {})) })),
      mine: mineJoin && !(r.status === 'gathering' && mineJoin.result) ? { troops: mineJoin.troops, count: sum(mineJoin.troops), result: mineJoin.result || null } : null,
      report: r.report || null,
    };
  }

  // ---- troop bookkeeping --------------------------------------------------------------
  function parseTroops(raw, row) {
    if (!isObj(raw)) throw err(400, 'bad_troops', 'troops: choose the troops to send');
    const have = troopsOf(row), sent = {};
    let total = 0;
    for (const [id, n] of Object.entries(raw)) {
      if (!Number.isInteger(n) || n < 0 || n > 1e6) throw err(400, 'bad_troops', 'troops: counts must be whole numbers');
      if (n === 0) continue;
      if (!troopFor(id, row.culture)) throw err(400, 'bad_troops', `troops: unknown troop "${String(id).slice(0, 40)}"`);
      if ((have[id] || 0) < n) throw err(400, 'not_enough', `you do not have ${n} x ${id}`);
      sent[id] = n; total += n;
    }
    if (!total) throw err(400, 'no_troops', 'troops: send at least one soldier');
    return { sent, have };
  }

  async function takeFromSave(row, sent, have) {
    const left = { ...have };
    for (const [id, n] of Object.entries(sent)) { left[id] -= n; if (left[id] <= 0) delete left[id]; }
    const version = await writeRow(row, withState(row, left));
    return { version, troops: left };
  }

  async function giveToSave(row, troops, loot) {
    const t = addTroops(troopsOf(row), troops);
    const r = addRes(resOf(row), loot);
    const version = await writeRow(row, withState(row, t, r));
    return { version, troops: t, resources: r };
  }

  async function mustBeMember(player) {
    const m = await membershipOf(player.id);
    if (!m) throw err(409, 'no_alliance', 'you are not in an alliance');
    return m;
  }
  async function gatheringRally(m, rallyId, now) {
    const r = await Rally.findByPk(Number(rallyId));
    if (!r || r.allianceId !== m.allianceId) throw err(404, 'no_rally', 'this rally does not exist');
    if (r.status !== 'gathering') throw err(409, 'rally_over', 'this rally is over');
    if (now >= r.launchAt) throw err(409, 'rally_closing', 'this rally is about to launch');
    return r;
  }
  const ping = (allianceId, extra) => notify(allianceId, { type: 'rally', ...extra });

  // ---- create / join / leave / cancel -------------------------------------------------
  /** body: { targetType: 'camp'|'castle', targetId, troops, minutes?, baseVersion } */
  const create = (player, body = {}) => serial(async () => {
    const m = await mustBeMember(player);
    const row = await loadRow(player.id);
    staleCheck(row, body.baseVersion, 'start the rally');
    const now = Date.now();
    const type = body.targetType === 'castle' ? 'castle' : body.targetType === 'camp' ? 'camp' : body.targetType === 'elephant' ? 'elephant' : body.targetType === 'province' ? 'province' : null;
    if (!type) throw err(400, 'bad_target', 'targetType must be camp, castle, province or elephant');
    let key = String(body.targetId || '');

    const open = await Rally.findAll({ where: { allianceId: m.allianceId, status: 'gathering' } });
    const openMain = open.filter((r) => r.targetType !== 'elephant' && r.targetType !== 'province'), openEle = open.filter((r) => r.targetType === 'elephant'), openProv = open.filter((r) => r.targetType === 'province');
    if (type === 'elephant' ? openEle.length >= MAX_ELEPHANT_RALLIES : type === 'province' ? openProv.length >= MAX_PROVINCE_RALLIES : openMain.length >= MAX_ACTIVE_PER_ALLIANCE) throw err(409, 'too_many', `your alliance can have at most ${type === 'elephant' ? MAX_ELEPHANT_RALLIES : type === 'province' ? MAX_PROVINCE_RALLIES : MAX_ACTIVE_PER_ALLIANCE} rallies like this at the same time`);
    if (open.some((r) => r.hostId === player.id)) throw err(409, 'already_hosting', 'you already have a rally: launch or cancel it first');
    if (type === 'province') key = `province:${Math.floor(Number(body.targetId))}`;
    if (type !== 'elephant' && open.some((r) => r.targetKey === key)) throw err(409, 'same_target', 'your alliance is already gathering for this target');

    let targetName, lastLaunch = Infinity;
    if (type === 'elephant') {
      const hunt = await elephant.activeHunt(m.allianceId, now);
      if (!hunt) throw err(409, 'no_hunt', 'the War Elephant is not here: your leader or an officer has to start the hunt first');
      key = `elephant:${hunt.id}`; targetName = 'War Elephant'; lastLaunch = hunt.endsAt - 1500; // it must launch before the hunt ends
    } else if (type === 'province') {
      if (!conquest) throw err(400, 'bad_target', 'provinces are not available');
      const info = await conquest.checkTarget(Math.floor(Number(body.targetId)), m.allianceId);
      targetName = `${info.name} tower`; lastLaunch = now + info.closesInMs - 1500; // it must launch before the province closes
    } else if (type === 'camp') {
      const camp = await NpcCamp.findOne({ where: { key } });
      if (!camp) throw err(404, 'no_camp', 'this camp does not exist (any more)');
      targetName = `${NPC.CAMP_TYPES[camp.type]?.name || 'Camp'} (Lv ${camp.level})`;
    } else {
      const castle = await Castle.findOne({ where: { key } });
      if (!castle) throw err(404, 'no_castle', 'this castle does not exist');
      if (castle.isNpc) throw err(400, 'npc_castle', 'npc castles cannot be attacked yet');
      if (castle.playerId === player.id) throw err(400, 'own_castle', 'you cannot attack your own castle');
      if (await AllianceMember.findOne({ where: { allianceId: m.allianceId, playerId: castle.playerId } })) throw err(400, 'ally_castle', 'this castle belongs to your alliance');
      const def = await GameSave.findOne({ where: { playerId: castle.playerId } });
      if (!def || isProtected(def)) throw err(409, 'protected', 'this player is under beginner protection');
      targetName = castle.name;
    }

    const { sent, have } = parseTroops(body.troops, row);
    const minutes = Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.floor(Number(body.minutes)) || DEFAULT_MINUTES));
    const save = await takeFromSave(row, sent, have);
    const r = await Rally.create({ allianceId: m.allianceId, hostId: player.id, hostName: player.username, targetType: type, targetKey: key, targetName, status: 'gathering', launchAt: Math.min(now + minutes * 60000, lastLaunch) });
    await RallyJoin.create({ rallyId: r.id, playerId: player.id, username: player.username, troops: sent });
    ping(m.allianceId, { phase: 'new', rallyId: r.id, by: player.username, target: targetName }, player.id);
    return { rally: await rallyJson(r, player.id, now), save: { version: save.version, troops: save.troops } };
  });

  /** body: { rallyId, troops, baseVersion } : adds to what you already put in. */
  const join = (player, body = {}) => serial(async () => {
    const m = await mustBeMember(player);
    const now = Date.now();
    const r = await gatheringRally(m, body.rallyId, now);
    const row = await loadRow(player.id);
    staleCheck(row, body.baseVersion, 'join the rally');
    const { sent, have } = parseTroops(body.troops, row);
    const mineJoin = await RallyJoin.findOne({ where: { rallyId: r.id, playerId: player.id } });
    if (mineJoin?.result && !mineJoin.claimed) throw err(409, 'claim_first', 'claim the troops you got back from your last alliance first');
    const save = await takeFromSave(row, sent, have);
    if (mineJoin?.result) {
      if (!mineJoin.claimed) throw err(409, 'claim_first', 'claim the troops you got back from your last alliance first');
      await mineJoin.update({ troops: sent, result: null, claimed: false });
    } else if (mineJoin) await mineJoin.update({ troops: addTroops(mineJoin.troops, sent) });
    else await RallyJoin.create({ rallyId: r.id, playerId: player.id, username: player.username, troops: sent });
    ping(m.allianceId, { phase: 'update', rallyId: r.id }, player.id);
    return { rally: await rallyJson(r, player.id, now), save: { version: save.version, troops: save.troops } };
  });

  /** A donor takes their troops back before launch (the host cannot: cancel instead). body: { rallyId, baseVersion } */
  const leave = (player, body = {}) => serial(async () => {
    const m = await mustBeMember(player);
    const now = Date.now();
    const r = await gatheringRally(m, body.rallyId, now);
    if (r.hostId === player.id) throw err(409, 'host_cannot_leave', 'you started this rally: cancel it instead');
    const j = await RallyJoin.findOne({ where: { rallyId: r.id, playerId: player.id } });
    if (!j || j.result) throw err(404, 'not_in_rally', 'you did not put troops into this rally');
    const row = await loadRow(player.id);
    staleCheck(row, body.baseVersion, 'leave the rally');
    const save = await giveToSave(row, j.troops, {});
    await j.destroy();
    ping(m.allianceId, { phase: 'update', rallyId: r.id }, player.id);
    return { rally: await rallyJson(r, player.id, now), save: { version: save.version, troops: save.troops } };
  });

  async function refundAll(r, reason) {
    const joins = (await RallyJoin.findAll({ where: { rallyId: r.id } })).filter((j) => !j.result);
    for (const j of joins) await j.update({ result: { win: false, refund: true, reason, targetName: r.targetName, targetType: r.targetType, sent: j.troops, dead: {}, returned: j.troops, loot: {}, rallyId: r.id } });
    await r.update({ status: 'cancelled', report: { cancelled: true, reason } });
    for (const j of joins) live.send(j.playerId, { type: 'rally', phase: 'done', rallyId: r.id, win: false, cancelled: true });
  }

  /** Host or an officer cancels: everybody gets their troops back (claim them). body: { rallyId } */
  const cancel = (player, body = {}) => serial(async () => {
    const m = await mustBeMember(player);
    const r = await Rally.findByPk(Number(body.rallyId));
    if (!r || r.allianceId !== m.allianceId) throw err(404, 'no_rally', 'this rally does not exist');
    if (r.status !== 'gathering') throw err(409, 'rally_over', 'this rally is over');
    if (r.hostId !== player.id && m.role === 'member') throw err(403, 'not_allowed', 'only the host, an officer or the leader can cancel');
    await refundAll(r, 'cancelled');
    return { rally: await rallyJson(r, player.id) };
  });

  // ---- the battle -----------------------------------------------------------------------
  async function runBattle(r, joins) {
    const combined = {};
    for (const j of joins) for (const [id, n] of Object.entries(j.troops)) combined[id] = (combined[id] || 0) + n;

    let win = false, loot = {}, dead = {}, report = {}, defenderId = null, defenderNote = null;
    if (r.targetType === 'elephant') {
      const hit = await elephant.applyRally(Number(String(r.targetKey).split(':')[1]), joins);
      if (!hit) return { refund: 'over' }; // the hunt ended before the rally launched: troops come home
      return { win: true, loot: {}, dead: {}, report: { elephant: hit.summary }, combined, defenderId: null, defenderNote: null, elephantDamage: hit.dmg };
    }
    if (r.targetType === 'province') {
      const out = await conquest.battle(Number(String(r.targetKey).split(':')[1]), r.allianceId, combined);
      if (!out) return { refund: 'over' }; // closed (or your alliance already holds it): troops come home
      return { win: out.win, loot: {}, dead: out.dead, report: out.report, combined, defenderId: null, defenderNote: null };
    }
    if (r.targetType === 'camp') {
      const camp = await NpcCamp.findOne({ where: { key: r.targetKey } });
      if (!camp) return { refund: 'gone' };
      const res = fight(combined, camp.army, { defenderFormation: NPC.CAMP_TYPES[camp.type]?.formation });
      win = res.win; dead = res.attackerLosses; loot = win ? camp.loot : {};
      report = {
        ticks: res.ticks, log: res.log, events: res.events, attackerPower: res.attackerPower, defenderPower: res.defenderPower,
        attackerFormation: res.attackerFormation, defenderFormation: res.defenderFormation, effects: res.effects, slots: res.slots,
        defenderLosses: res.defenderLosses, defenderSent: res.defenderSent, campType: camp.type, campLevel: camp.level, camp: { level: camp.level, type: camp.type },
      };
      if (win) await world.removeCamp(camp);
      if (win) for (const j of joins) await events.record(j.playerId, 'camp_win', { level: camp.level });
    } else {
      const castle = await Castle.findOne({ where: { key: r.targetKey } });
      if (!castle || castle.isNpc) return { refund: 'gone' };
      if (await AllianceMember.findOne({ where: { allianceId: r.allianceId, playerId: castle.playerId } })) return { refund: 'ally' };
      defenderId = castle.playerId;
      const attLayout = autoLayout(combined);
      const out = await retryStale(async () => {
        const def = await loadRow(defenderId);
        if (isProtected(def)) return { refund: 'protected' };
        const defHave = troopsOf(def), defRes = resOf(def);
        const defLayout = await defenseLayout(defenderId, defHave);
        const res = simulate(attLayout, defLayout);
        const A = applyLosses(combined, res.attackerLosses), D = applyLosses(defHave, res.defenderLosses);
        const got = {};
        if (res.win) {
          let cap = 0;
          for (const [id, n] of Object.entries(res.attackerSurvivors)) cap += n * (C.CARRY[C.unitStats(id)?.cls] || 0);
          const want = Object.fromEntries(RES.map((k) => [k, Math.floor((defRes[k] || 0) * C.LOOT_SHARE)]));
          const total = RES.reduce((a, k) => a + want[k], 0);
          const f = total > cap ? cap / total : 1;
          for (const k of RES) { const n = Math.floor(want[k] * f); if (n > 0) { got[k] = n; defRes[k] -= n; } }
        }
        await writeRow(def, withState(def, D.left, defRes));
        return { res, A, D, got, defLayout };
      });
      if (out.refund) return out;
      win = out.res.win; loot = out.got; dead = out.A.dead;
      report = {
        ticks: out.res.ticks, log: out.res.log, attackerPower: out.res.attackerPower, defenderPower: out.res.defenderPower,
        attackerFormation: attLayout.formation, defenderFormation: out.defLayout.formation, wounded: out.A.wounded,
        defenderLosses: out.D.dead, defenderWounded: out.D.wounded, sent: layoutArmy(attLayout),
        events: out.res.events, effects: out.res.effects, slots: out.res.slots, defenderSent: out.res.defenderSent, defenderSurvivors: out.res.defenderSurvivors,
      };
      defenderNote = { type: 'attacked', by: `${r.hostName} (rally)`, win: !out.res.win, losses: out.D.dead, wounded: out.D.wounded, loot };
    }
    return { win, loot, dead, report, combined, defenderId, defenderNote };
  }

  async function resolve(r) {
    if (r.status !== 'gathering') return;
    const joins = (await RallyJoin.findAll({ where: { rallyId: r.id }, order: [['id', 'ASC']] })).filter((j) => !j.result);
    if (!joins.length) return refundAll(r, 'empty');
    let out;
    try { out = await runBattle(r, joins); } catch (e) { console.error('[rally] battle failed, refunding:', e.message); return refundAll(r, 'error'); }
    if (out.refund) return refundAll(r, out.refund);

    const power = joins.map((j) => armyPower(j.troops, {}));
    const lootBy = {}; for (const k of RES) lootBy[k] = allocate(out.loot[k] || 0, power);
    const deadBy = joins.map(() => ({}));
    for (const [id, n] of Object.entries(out.dead)) {
      const parts = allocate(n, joins.map((j) => j.troops[id] || 0));
      parts.forEach((p, i) => { if (p > 0) deadBy[i][id] = p; });
    }
    const totalPower = power.reduce((a, b) => a + b, 0) || 1;
    for (let i = 0; i < joins.length; i++) {
      const j = joins[i], returned = { ...j.troops };
      for (const [id, n] of Object.entries(deadBy[i])) { returned[id] = (returned[id] || 0) - n; if (returned[id] <= 0) delete returned[id]; }
      const myLoot = {}; for (const k of RES) if (lootBy[k][i] > 0) myLoot[k] = lootBy[k][i];
      await j.update({ result: { rallyId: r.id, win: out.win, targetName: r.targetName, targetType: r.targetType, sent: j.troops, dead: deadBy[i], returned, loot: myLoot, share: Math.round((power[i] / totalPower) * 100), ...(out.elephantDamage ? { damage: out.elephantDamage[i], elephant: out.report.elephant } : {}), ...(out.report && out.report.province ? { province: out.report.province } : {}) } });
    }
    await r.update({ status: 'done', report: { win: out.win, participants: joins.length, loot: out.loot, dead: out.dead, ...out.report } });
    for (const j of joins) live.send(j.playerId, { type: 'rally', phase: 'done', rallyId: r.id, win: out.win });
    await mailReports(r, joins, out, { deadBy, lootBy, power, totalPower });
    if (out.defenderId && out.defenderNote) live.send(out.defenderId, out.defenderNote);
  }

  /** Every donor gets the fight in their battle reports (letters); the defender of a castle gets it too. Never blocks the rally. */
  async function mailReports(r, joins, out, { deadBy, lootBy, power, totalPower }) {
    const at = Date.now();
    const tag = r.targetType === 'camp' ? 'camp' : r.targetType === 'elephant' ? 'elephant' : 'castle';
    try {
      if (tag === 'elephant') {
        for (let i = 0; i < joins.length; i++) {
          const j = joins[i], res = j.result || {};
          const mine = { win: true, loot: {}, losses: {}, sent: j.troops, survivors: res.returned || {}, elephant: { ...out.report.elephant, damage: res.damage, share: res.share }, rally: { host: r.hostName, participants: joins.length, share: res.share } };
          await mail.deliver({ playerId: j.playerId, kind: 'report', read: true, subject: `War Elephant: ${Math.round(res.damage || 0).toLocaleString('en-US')} damage`, data: { role: 'attacker', source: 'rally', target: 'elephant', castleName: 'War Elephant', host: r.hostName, at, report: mine } }).catch(() => {});
        }
        return;
      }
      for (let i = 0; i < joins.length; i++) {
        const j = joins[i], res = j.result || {};
        const mine = { ...out.report, wounded: undefined, win: out.win, loot: res.loot || {}, sent: j.troops, losses: deadBy[i], survivors: res.returned || {}, rally: { host: r.hostName, participants: joins.length, share: res.share } };
        await mail.deliver({
          playerId: j.playerId, kind: 'report', read: true,
          subject: `Rally ${out.win ? 'victory' : 'defeat'}: ${r.targetName}`,
          data: { role: 'attacker', source: 'rally', target: tag, castleName: r.targetName, host: r.hostName, at, report: mine },
        }).catch(() => {});
      }
      if (out.defenderId) {
        await mail.deliver({
          playerId: out.defenderId, kind: 'report', fromName: r.hostName,
          subject: `${out.win ? 'Raided' : 'Held'}: ${r.hostName}'s alliance rally attacked ${r.targetName}`,
          data: { role: 'defender', source: 'rally', target: 'castle', castleName: r.targetName, attacker: r.hostName, at, report: { ...out.report, win: out.win, loot: out.loot, losses: out.dead, rally: { host: r.hostName, participants: joins.length } } },
        }).catch(() => {});
      }
    } catch (e) { console.error('[rally] report mail failed', e.message); }
  }

  /** Host / officer / leader launches before the timer ends. body: { rallyId } */
  const launch = (player, body = {}) => serial(async () => {
    const m = await mustBeMember(player);
    const r = await Rally.findByPk(Number(body.rallyId));
    if (!r || r.allianceId !== m.allianceId) throw err(404, 'no_rally', 'this rally does not exist');
    if (r.status !== 'gathering') throw err(409, 'rally_over', 'this rally is over');
    if (r.hostId !== player.id && m.role === 'member') throw err(403, 'not_allowed', 'only the host, an officer or the leader can launch it');
    await resolve(r);
    await r.reload();
    return { rally: await rallyJson(r, player.id) };
  });

  /** Ticker (every second, from world.startTicker): launches rallies whose time is up. */
  const tick = (now = Date.now()) => serial(async () => {
    const due = await Rally.findAll({ where: { status: 'gathering', launchAt: { [Op.lte]: now } }, order: [['launchAt', 'ASC']] });
    for (const r of due) { try { await resolve(r); } catch (e) { console.error('[rally] resolve failed', e.message); } }
  });

  // ---- results ----------------------------------------------------------------------------
  /** POST /rally/claim { baseVersion } : survivors + loot of every finished rally you were in. */
  const claim = (player, body = {}) => serial(async () => {
    const joins = await RallyJoin.findAll({ where: { playerId: player.id, claimed: false } });
    const done = joins.filter((j) => j.result);
    const row = await loadRow(player.id);
    if (!done.length) return { reports: [], save: { version: row.revision, troops: troopsOf(row), resources: resOf(row) } };
    staleCheck(row, body.baseVersion, 'claim');
    let troops = {}, loot = {};
    for (const j of done) { troops = addTroops(troops, j.result.returned); loot = addRes(loot, j.result.loot); }
    const save = await giveToSave(row, troops, loot);
    for (const j of done) await j.update({ claimed: true });
    const reports = done.map((j) => ({ id: j.rallyId, ...j.result }));
    return { reports, save: { version: save.version, troops: save.troops, resources: save.resources } };
  });

  /** GET /alliance/rallies */
  async function list(player) {
    const m = await mustBeMember(player);
    const now = Date.now();
    const rows = await Rally.findAll({ where: { allianceId: m.allianceId, [Op.or]: [{ status: 'gathering' }, { updatedAt: { [Op.gte]: new Date(now - FINISHED_KEEP_MS) } }] }, order: [['id', 'DESC']], limit: 12 });
    const pending = await RallyJoin.count({ where: { playerId: player.id, claimed: false, result: { [Op.ne]: null } } });
    const all = await Promise.all(rows.map((r) => rallyJson(r, player.id, now)));
    return { now, rallies: all.filter((r) => r.status === 'gathering'), recent: all.filter((r) => r.status !== 'gathering').slice(0, 5), pending, maxActive: MAX_ACTIVE_PER_ALLIANCE };
  }

  /** GET /alliance/targets : camps + castles of OTHER alliances, nearest first. */
  async function targets(player) {
    const m = await mustBeMember(player);
    const mine = await Castle.findOne({ where: { playerId: player.id } });
    const from = mine || { tileX: 0, tileY: 0 };
    const dist = (c) => Math.round(Math.hypot(c.tileX - from.tileX, c.tileY - from.tileY));
    const camps = (await NpcCamp.findAll()).map((c) => ({ id: c.key, name: NPC.CAMP_TYPES[c.type]?.name || 'Camp', level: c.level, power: Math.round(armyPower(c.army, {})), loot: c.loot, distance: dist(c) }));
    const allies = new Set((await AllianceMember.findAll({ where: { allianceId: m.allianceId }, attributes: ['playerId'] })).map((x) => x.playerId));
    const castles = (await Castle.findAll({ where: { isNpc: false } })).filter((c) => !allies.has(c.playerId));
    const saves = new Map((await GameSave.findAll({ where: { playerId: castles.map((c) => c.playerId) } })).map((s) => [s.playerId, s]));
    const alliances = new Map();
    for (const am of await AllianceMember.findAll({ where: { playerId: castles.map((c) => c.playerId) } })) alliances.set(am.playerId, am.allianceId);
    const tags = new Map((await Alliance.findAll({ where: { id: [...new Set(alliances.values())] } })).map((a) => [a.id, a.tag]));
    return {
      camps: camps.sort((a, b) => a.distance - b.distance).slice(0, 30),
      castles: castles.map((c) => ({ id: c.key, name: c.name, civId: c.civId, tag: tags.get(alliances.get(c.playerId)) || null, distance: dist(c), protected: !saves.get(c.playerId) || isProtected(saves.get(c.playerId)) }))
        .sort((a, b) => a.distance - b.distance).slice(0, 40),
    };
  }

  // ---- alliance hooks: troops must never be lost when somebody leaves / the alliance ends ----
  allianceHooks.onMemberGone = (playerId, allianceId) => serial(async () => {
    const open = await Rally.findAll({ where: { allianceId, status: 'gathering' } });
    for (const r of open) {
      if (r.hostId === playerId) { await refundAll(r, 'host_left'); continue; }
      const j = await RallyJoin.findOne({ where: { rallyId: r.id, playerId } });
      if (j) await j.update({ result: { win: false, refund: true, reason: 'left_alliance', targetName: r.targetName, targetType: r.targetType, sent: j.troops, dead: {}, returned: j.troops, loot: {}, rallyId: r.id } });
    }
  });
  allianceHooks.onDisband = (allianceId) => serial(async () => {
    for (const r of await Rally.findAll({ where: { allianceId, status: 'gathering' } })) await refundAll(r, 'disbanded');
  });

  return { create, join, leave, cancel, launch, tick, claim, list, targets };
}
