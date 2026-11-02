/**
 * Donya-ye bazi (server-authoritative baraye chizayi ke client nabayad tasmim begire):
 *   - ghale-haye bazikon-ha + ghale-haye NPC rooye naghshe-ye baked (public/map.json)
 *   - ordogah-haye NPC (spawn, respawn)
 *   - hamle-ha (expedition): ferestadan, jang, bargasht, gereftan-e ghanimat
 * Hame-chiz dar yek saf (serial) anjam mishe ta dota bazikon yek jaye ghale ya yek ordogah ro nagiran.
 */
import { Op } from 'sequelize';
import { Castle, NpcCamp, Expedition, GameSave, Meta, Player, Territory, sequelize } from './models.js';
import { CIV_TO_CULTURE, CULTURE_TO_CIV, CIV_IDS } from './constants.js';
import { httpError } from './httpError.js';
import { troopFor } from './troops.js';
import { fight, armyPower } from './battle.js';
import { rollLevel, makeCampArmy, makeCampLoot, newCampKey } from './camps.js';
import * as NPC from './npcConfig.js';
import * as live from './live.js';

export function createWorld({ spawner, npc = {} }) {
  const N = {
    campsPerType: NPC.CAMPS_PER_TYPE, respawnMs: NPC.RESPAWN_MS, marchMsPerTile: NPC.MARCH_MS_PER_TILE,
    marchMinMs: NPC.MARCH_MIN_MS, maxActive: NPC.MAX_ACTIVE_EXPEDITIONS, ...npc,
  };
  const rules = { marchMsPerTile: N.marchMsPerTile, marchMinMs: N.marchMinMs, maxActive: N.maxActive, unitPower: NPC.UNIT_POWER };

  // ---- json-haye ke be client mirran ---------------------------------------------------
  const castleJson = (c) => ({ id: c.key, name: c.name, civId: c.civId, tileX: c.tileX, tileY: c.tileY });
  const campJson = (c) => ({
    id: c.key, type: c.type, name: NPC.CAMP_TYPES[c.type].name, level: c.level, tileX: c.tileX, tileY: c.tileY,
    army: c.army, power: Math.round(armyPower(c.army, {})), loot: c.loot,
  });
  const expJson = (e, now = Date.now()) => ({
    id: e.id, campId: e.campKey, campType: e.campType, campLevel: e.campLevel, troops: e.troops,
    from: { tileX: e.fromX, tileY: e.fromY }, to: { tileX: e.toX, tileY: e.toY },
    arriveAt: e.arriveAt, returnAt: e.returnAt, status: e.status, claimed: e.claimed,
    report: now >= e.arriveAt ? e.report : null, // natije ta residan-e lashkar mahrame
  });

  // Yek kar dar har lahze: entekhab-e jay-e ghale / ordogah va jang-ha.
  let chain = Promise.resolve();
  const serial = (fn) => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };

  // ---- ghale-ha -----------------------------------------------------------------------
  /** Ghale-haye NPC ro ba naghshe-ye baked-e felli hamahang mikone. */
  async function syncWorld() {
    const key = spawner.mapKey();
    if (!key) return;
    const saved = await Meta.findByPk('mapKey');
    if (saved && saved.value === key && (await Castle.count({ where: { isNpc: true } })) > 0) return;
    await Castle.destroy({ where: { isNpc: true } });
    for (const n of spawner.makeNpcs()) await Castle.create({ ...n, isNpc: true, isCapital: true });
    // Naghshe dobare baked shode: jay-e ghadimi-e bazikon-ha shayad nadorost bashe -> jay-e jadid (save-ha mimoonan).
    if (saved) {
      const players = await Castle.findAll({ where: { isNpc: false } });
      const placed = await Castle.findAll({ where: { isNpc: true } });
      for (const c of players) {
        const spot = spawner.pickSpot(c.civId, placed);
        if (spot) { await c.update({ tileX: spot.tileX, tileY: spot.tileY }); placed.push(c); }
      }
      console.log('[game] map was baked again: castles were placed anew');
    }
    await Meta.upsert({ key: 'mapKey', value: key });
  }

  /**
   * Vorood be donya. Avvalin bar: tamaddon ONJA entekhab mishe (fght yek bar) va ghale ja dade mishe.
   * Bad az on, tamaddon-e server hamishe bar-e (civId-e darkhast ignore mishe).
   * Agar admin tamaddon ro set karde ama ghale nist, ghale baraye hamon tamaddon sakhte mishe.
   */
  const joinWorld = (player, requestedCivId) => serial(async () => {
    await syncWorld();
    const save = await GameSave.findOne({ where: { playerId: player.id } });
    let castle = await Castle.findOne({ where: { playerId: player.id } });
    const returning = !!castle;
    if (!castle) {
      const civId = save.culture ? CULTURE_TO_CIV[save.culture] : requestedCivId;
      if (!CIV_IDS.includes(civId)) throw httpError(400, 'choose a civilization', { code: 'bad_civ' });
      const placed = await Castle.findAll();
      const spot = spawner.pickSpot(civId, placed);
      if (!spot) throw httpError(503, 'no free spot found for a new castle', { code: 'no_spot' });
      castle = await sequelize.transaction(async (t) => {
        const c = await Castle.create({
          key: `u_${player.id}`, name: player.username.slice(0, 32), civId, tileX: spot.tileX, tileY: spot.tileY,
          isNpc: false, isCapital: true, playerId: player.id,
        }, { transaction: t });
        if (!save.culture) {
          const terr = await Territory.findOne({ where: { culture: CIV_TO_CULTURE[civId] }, transaction: t });
          save.culture = CIV_TO_CULTURE[civId]; save.revision += 1;
          await save.save({ transaction: t });
          await player.update({ territoryId: terr?.id ?? null }, { transaction: t });
        }
        return c;
      });
      live.broadcast({ type: 'castle', castle: castleJson(castle) });
      console.log(`[game] new player "${player.username}" (${civId}) at tile ${spot.tileX},${spot.tileY}`);
    }
    return { returning, castle, save: await GameSave.findOne({ where: { playerId: player.id } }) };
  });

  /** Ghale + hamle-haye yek bazikon pak mishe (reset / taghir-e tamaddon / hazf-e bazikon). */
  async function dropPlayer(playerId, transaction) {
    const castles = await Castle.findAll({ where: { playerId }, transaction });
    await Expedition.destroy({ where: { playerId }, transaction });
    await Castle.destroy({ where: { playerId }, transaction });
    for (const c of castles) live.broadcast({ type: 'castleGone', id: c.key });
  }

  const worldJson = async () => ({
    castles: (await Castle.findAll()).map(castleJson),
    camps: (await NpcCamp.findAll()).map(campJson),
    rules,
  });

  // ---- ordogah-haye NPC -----------------------------------------------------------------
  const respawnTimers = new Set();
  const notifiedHome = new Set();

  async function spawnCamp(type) {
    const placed = [...(await Castle.findAll()), ...(await NpcCamp.findAll())];
    const spot = spawner.pickAnySpot(placed);
    if (!spot) return null;
    const level = rollLevel(Math.random);
    const camp = await NpcCamp.create({
      key: newCampKey(type, Math.random), type, level, tileX: spot.tileX, tileY: spot.tileY,
      army: makeCampArmy(type, level, Math.random), loot: makeCampLoot(type, level),
    });
    live.broadcast({ type: 'camp', camp: campJson(camp) });
    return camp;
  }

  /** Har bar ke server start mishe hame-ye ordogah-ha tasadofi dobare pakhsh mishan. */
  async function syncCamps() {
    if (!spawner.mapKey()) return;
    await NpcCamp.destroy({ where: {} });
    for (const type of Object.keys(NPC.CAMP_TYPES)) {
      for (let i = 0; i < N.campsPerType; i++) await spawnCamp(type);
    }
    console.log(`[game] ${await NpcCamp.count()} NPC camps placed`);
  }

  // ---- hamle-ha ----------------------------------------------------------------------------
  /** Lashkar-haye reside jang mikonan (ghadimi-tarin avval) va natije zakhire mishe. Ba ticker-e 1 sanie-ee va ghabl-e har attack/claim. */
  function resolveDue(now = Date.now()) {
    return serial(async () => {
      const arrived = await Expedition.findAll({ where: { status: 'marching', arriveAt: { [Op.lte]: now } }, order: [['arriveAt', 'ASC']] });
      for (const e of arrived) {
        const camp = await NpcCamp.findOne({ where: { key: e.campKey } });
        let report;
        if (!camp) {
          report = { gone: true, win: false, survivors: e.troops, losses: {}, loot: {} }; // yeki dige zoodtar bood
        } else {
          const r = fight(e.troops, camp.army);
          report = { gone: false, win: r.win, attackerPower: r.attackerPower, defenderPower: r.defenderPower, survivors: r.attackerSurvivors, losses: r.attackerLosses, loot: r.win ? camp.loot : {} };
          if (r.win) {
            await camp.destroy();
            live.broadcast({ type: 'campGone', id: camp.key });
            const t = setTimeout(() => { respawnTimers.delete(t); serial(() => spawnCamp(camp.type)).catch(() => {}); }, N.respawnMs);
            t.unref?.();
            respawnTimers.add(t);
          }
        }
        await e.update({ status: 'returning', report });
        live.send(e.playerId, { type: 'expedition', id: e.id, phase: 'arrived' });
      }
      const home = await Expedition.findAll({ where: { status: 'returning', claimed: false, returnAt: { [Op.lte]: now } } });
      for (const e of home) if (!notifiedHome.has(e.id)) { notifiedHome.add(e.id); live.send(e.playerId, { type: 'expedition', id: e.id, phase: 'home' }); }
    });
  }

  const tick = { id: null };
  const startTicker = (ms = 1000) => {
    if (tick.id) return;
    tick.id = setInterval(() => resolveDue().catch((err) => console.error('[tick]', err)), ms);
    tick.id.unref?.();
  };
  const stopTicker = () => {
    clearInterval(tick.id); tick.id = null;
    for (const t of respawnTimers) clearTimeout(t);
    respawnTimers.clear();
  };

  /** Zakhire-ye jadid ba ghofl-e revision: agar dar in beyn kasi save karde bashe, 409 stale. */
  async function writeData(row, data) {
    const [changed] = await GameSave.update({ data, revision: row.revision + 1 }, { where: { id: row.id, revision: row.revision } });
    if (!changed) throw httpError(409, 'stale save: try again', { code: 'stale', version: row.revision });
    return row.revision + 1;
  }
  const staleCheck = (row, baseVersion, what) => {
    if (Number.isInteger(baseVersion) && baseVersion !== row.revision) {
      throw httpError(409, `stale save: save first, then ${what}`, { code: 'stale', version: row.revision });
    }
  };

  async function expeditionsOf(playerId) {
    const now = Date.now();
    const list = await Expedition.findAll({ where: { playerId, claimed: false }, order: [['id', 'ASC']] });
    return { now, expeditions: list.map((e) => expJson(e, now)) };
  }

  /** body: { campId, troops: { troopId: count }, baseVersion } -- sarbaz-ha az army-ye ZAKHIRE-SHODE-ye server kam mishan. */
  async function attack(player, body = {}) {
    await resolveDue();
    const out = await serial(async () => {
      const row = await GameSave.findOne({ where: { playerId: player.id } });
      if (!row.culture) throw httpError(409, 'choose a civilization first (POST /api/game/join)', { code: 'no_culture' });
      staleCheck(row, body.baseVersion, 'attack');
      const camp = await NpcCamp.findOne({ where: { key: String(body.campId || '') } });
      if (!camp) throw httpError(404, 'this camp does not exist (any more)', { code: 'no_camp' });
      if (!body.troops || typeof body.troops !== 'object' || Array.isArray(body.troops)) throw httpError(400, 'troops: choose the troops to send');
      const data = row.data || {};
      const have = ((data.army || {}).troops || {})[row.culture] || {};
      const sent = {};
      let total = 0;
      for (const [id, n] of Object.entries(body.troops)) {
        if (!Number.isInteger(n) || n < 0 || n > 1e6) throw httpError(400, 'troops: counts must be whole numbers');
        if (n === 0) continue;
        if (!troopFor(id, row.culture)) throw httpError(400, `troops: unknown troop "${String(id).slice(0, 40)}"`);
        if ((have[id] || 0) < n) throw httpError(400, `you do not have ${n} x ${id}`);
        sent[id] = n; total += n;
      }
      if (!total) throw httpError(400, 'troops: send at least one soldier');
      const active = await Expedition.count({ where: { playerId: player.id, claimed: false } });
      if (active >= N.maxActive) throw httpError(409, `at most ${N.maxActive} armies can be out at the same time`);
      const castle = await Castle.findOne({ where: { playerId: player.id } });
      if (!castle) throw httpError(409, 'you have no castle yet');

      const dist = Math.hypot(camp.tileX - castle.tileX, camp.tileY - castle.tileY);
      const oneWay = Math.max(N.marchMinMs, Math.round(dist * N.marchMsPerTile));
      const now = Date.now();
      const left = { ...have };
      for (const [id, n] of Object.entries(sent)) { left[id] -= n; if (left[id] <= 0) delete left[id]; }
      const army = { ...(data.army || { troops: {}, queue: {} }) };
      army.troops = { ...(army.troops || {}), [row.culture]: left };
      const revision = await writeData(row, { ...data, army });
      const e = await Expedition.create({
        playerId: player.id, campKey: camp.key, campType: camp.type, campLevel: camp.level, troops: sent,
        fromX: castle.tileX, fromY: castle.tileY, toX: camp.tileX, toY: camp.tileY,
        arriveAt: now + oneWay, returnAt: now + 2 * oneWay, status: 'marching',
      });
      return { e, version: revision, troops: left };
    });
    return { now: Date.now(), expedition: expJson(out.e), save: { version: out.version, troops: out.troops } };
  }

  /** Lashkar-haye bargashte: zende-ha + ghanimat be save-ye server ezafe mishan. body: { baseVersion } */
  async function claim(player, body = {}) {
    await resolveDue();
    const out = await serial(async () => {
      const row = await GameSave.findOne({ where: { playerId: player.id } });
      if (!row.culture) throw httpError(409, 'choose a civilization first (POST /api/game/join)', { code: 'no_culture' });
      staleCheck(row, body.baseVersion, 'claim');
      const now = Date.now();
      const home = await Expedition.findAll({ where: { playerId: player.id, status: 'returning', claimed: false, returnAt: { [Op.lte]: now } }, order: [['id', 'ASC']] });
      const data = row.data || {};
      const army = { ...(data.army || { troops: {}, queue: {} }) };
      const troops = { ...(((army.troops || {})[row.culture]) || {}) };
      const resources = { food: 0, wood: 0, stone: 0, iron: 0, coin: 0, ...(((data.resources || {})[row.culture]) || {}) };
      const reports = [];
      for (const e of home) {
        const r = e.report || {};
        for (const [id, n] of Object.entries(r.survivors || {})) troops[id] = Math.min(1e9, (troops[id] || 0) + n);
        for (const [k, n] of Object.entries(r.loot || {})) if (k in resources) resources[k] = Math.min(1e12, resources[k] + n);
        reports.push({ id: e.id, campType: e.campType, campLevel: e.campLevel, sent: e.troops, ...r });
      }
      if (!home.length) return { version: row.revision, troops, resources, reports };
      army.troops = { ...(army.troops || {}), [row.culture]: troops };
      const revision = await writeData(row, { ...data, army, resources: { ...(data.resources || {}), [row.culture]: resources } });
      await Expedition.update({ claimed: true }, { where: { id: home.map((e) => e.id) } });
      return { version: revision, troops, resources, reports };
    });
    return { now: Date.now(), save: { version: out.version, troops: out.troops, resources: out.resources }, reports: out.reports };
  }

  return {
    rules, castleJson, campJson, syncWorld, syncCamps, joinWorld, dropPlayer, worldJson,
    resolveDue, startTicker, stopTicker, attack, claim, expeditionsOf,
  };
}
