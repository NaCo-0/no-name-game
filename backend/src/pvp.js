/** PvP: defense layout (Meta) + instant castle attack. */
import { Castle, GameSave, Meta, sequelize } from './models.js';
import { httpError } from './httpError.js';
import { normalizeLayout, autoLayout, layoutArmy, simulate } from './battle.js';
import * as C from './battleConfig.js';
import * as live from './live.js';

let chain = Promise.resolve();
const serial = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };

const RES = ['food', 'wood', 'stone', 'iron', 'coin'];
const defKey = (playerId) => `defense:${playerId}`;
const troopsOf = (row) => ({ ...((((row.data || {}).army || {}).troops || {})[row.culture] || {}) });
const resOf = (row) => ({ food: 0, wood: 0, stone: 0, iron: 0, coin: 0, ...(((row.data || {}).resources || {})[row.culture] || {}) });

function withState(row, troops, resources) {
  const data = row.data || {};
  const army = { ...(data.army || { troops: {}, queue: {} }) };
  army.troops = { ...(army.troops || {}), [row.culture]: troops };
  const out = { ...data, army };
  if (resources) out.resources = { ...(data.resources || {}), [row.culture]: resources };
  return out;
}

async function write(row, data, transaction) {
  const [n] = await GameSave.update({ data, revision: row.revision + 1 }, { where: { id: row.id, revision: row.revision }, transaction });
  if (!n) throw httpError(409, 'stale save: try again', { code: 'stale', version: row.revision });
  return row.revision + 1;
}

async function loadRow(playerId) {
  const row = await GameSave.findOne({ where: { playerId } });
  if (!row?.culture) throw httpError(409, 'choose a civilization first (POST /api/game/join)', { code: 'no_culture' });
  return row;
}

async function savedLayout(playerId) {
  const m = await Meta.findByPk(defKey(playerId));
  try { return m?.value ? JSON.parse(m.value) : null; } catch { return null; }
}

/** Saved layout if it still fits the army, else an auto layout. */
function usable(saved, army) {
  if (saved) { try { return normalizeLayout(saved, army); } catch { /* troops changed */ } }
  return autoLayout(army, saved?.formation);
}

/** Lost troops: the wounded share comes back. */
function apply(have, losses) {
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

export async function getDefense(player) {
  const row = await loadRow(player.id);
  const army = troopsOf(row), saved = await savedLayout(player.id);
  return { layout: usable(saved, army), saved: !!saved, army, version: row.revision };
}

export async function setDefense(player, body = {}) {
  const row = await loadRow(player.id);
  const layout = normalizeLayout(body.layout, troopsOf(row));
  await Meta.upsert({ key: defKey(player.id), value: JSON.stringify(layout) });
  return { layout };
}

/** body: { castleId, layout | troops, baseVersion } */
export const attackCastle = (player, body = {}) => serial(async () => {
  const att = await loadRow(player.id);
  if (Number.isInteger(body.baseVersion) && body.baseVersion !== att.revision) {
    throw httpError(409, 'stale save: save first, then attack', { code: 'stale', version: att.revision });
  }
  const castle = await Castle.findOne({ where: { key: String(body.castleId || '') } });
  if (!castle) throw httpError(404, 'this castle does not exist', { code: 'no_castle' });
  if (castle.isNpc) throw httpError(400, 'npc castles cannot be attacked yet', { code: 'npc_castle' });
  if (castle.playerId === player.id) throw httpError(400, 'you cannot attack your own castle', { code: 'own_castle' });
  const def = await loadRow(castle.playerId);

  const attHave = troopsOf(att), defHave = troopsOf(def);
  const attLayout = normalizeLayout(body.layout ?? autoLayout(body.troops || {}), attHave);
  if (def.revision < C.PROTECT_REVISION || C.armyPower(defHave, {}) < C.PROTECT_POWER) {
    throw httpError(409, 'this player is under beginner protection', { code: 'protected' });
  }
  const defLayout = usable(await savedLayout(castle.playerId), defHave);

  const r = simulate(attLayout, defLayout);
  const A = apply(attHave, r.attackerLosses), D = apply(defHave, r.defenderLosses);

  const attRes = resOf(att), defRes = resOf(def), loot = {};
  if (r.win) {
    let cap = 0;
    for (const [id, n] of Object.entries(r.attackerSurvivors)) cap += n * (C.CARRY[C.unitStats(id)?.cls] || 0);
    const want = Object.fromEntries(RES.map((k) => [k, Math.floor((defRes[k] || 0) * C.LOOT_SHARE)]));
    const sum = RES.reduce((a, k) => a + want[k], 0);
    const f = sum > cap ? cap / sum : 1;
    for (const k of RES) {
      const n = Math.floor(want[k] * f);
      if (n > 0) { loot[k] = n; defRes[k] -= n; attRes[k] = Math.min(1e12, attRes[k] + n); }
    }
  }

  const report = {
    castleId: castle.key, castleName: castle.name, win: r.win, ticks: r.ticks, log: r.log,
    attackerPower: r.attackerPower, defenderPower: r.defenderPower,
    attackerFormation: attLayout.formation, defenderFormation: defLayout.formation,
    sent: layoutArmy(attLayout), survivors: r.attackerSurvivors, losses: A.dead, wounded: A.wounded,
    defenderLosses: D.dead, defenderWounded: D.wounded, loot,
  };
  const version = await sequelize.transaction(async (t) => {
    const v = await write(att, withState(att, A.left, attRes), t);
    await write(def, withState(def, D.left, defRes), t);
    return v;
  });
  live.send(castle.playerId, { type: 'attacked', by: player.username, win: !r.win, losses: D.dead, wounded: D.wounded, loot });
  return { report, save: { version, troops: A.left, resources: attRes } };
});
