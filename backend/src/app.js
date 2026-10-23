import express from 'express';
import { Op } from 'sequelize';
import { hashPassword, verifyPassword, newToken, hashToken, createLimiter } from './auth.js';
import { CIV_TO_CULTURE, CIV_IDS, USERNAME_RE, PASSWORD_MIN, PASSWORD_MAX } from './constants.js';
import { sanitizeSave, assertOnlyCulture, publicSave } from './save.js';
import { httpError } from './httpError.js';
import { troopFor } from './troops.js';
import { fight, armyPower } from './battle.js';
import { rollLevel, makeCampArmy, makeCampLoot, newCampKey } from './camps.js';
import * as NPC from './npcConfig.js';

const DAY = 24 * 60 * 60 * 1000;

/**
 * @param {object} o
 * @param {{models:object}} o.db
 * @param {object} o.config
 * @param {{mapKey():string|null, pickSpot(civId:string, placed:object[]):{tileX:number,tileY:number}|null, makeNpcs():object[]}} o.spawner
 */
export function createApp({ db, config, spawner, npc = {} }) {
  const { User, GameSave, Castle, NpcCamp, Expedition, AuthToken, Meta } = db.models;
  const N = { campsPerType: NPC.CAMPS_PER_TYPE, respawnMs: NPC.RESPAWN_MS, marchMsPerTile: NPC.MARCH_MS_PER_TILE, marchMinMs: NPC.MARCH_MIN_MS, maxActive: NPC.MAX_ACTIVE_EXPEDITIONS, ...npc };
  const app = express();
  app.disable('x-powered-by');

  const loginLimiter = createLimiter({ limit: 8 });
  const streams = new Map(); // res -> userId (open event streams)
  let presenceTimer = null;

  // One thing at a time for everything that picks castle spots, so two players never get the same one.
  let chain = Promise.resolve();
  const serial = (fn) => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };

  const npcRules = { marchMsPerTile: N.marchMsPerTile, marchMinMs: N.marchMinMs, maxActive: N.maxActive, unitPower: NPC.UNIT_POWER };
  const campJson = (c) => ({
    id: c.key, type: c.type, name: NPC.CAMP_TYPES[c.type].name, level: c.level, tileX: c.tileX, tileY: c.tileY,
    army: c.army, power: Math.round(armyPower(c.army, {})), loot: c.loot,
  });
  const expJson = (e, now = Date.now()) => ({
    id: e.id, campId: e.campKey, campType: e.campType, campLevel: e.campLevel, troops: e.troops,
    from: { tileX: e.fromX, tileY: e.fromY }, to: { tileX: e.toX, tileY: e.toY },
    arriveAt: e.arriveAt, returnAt: e.returnAt, status: e.status, claimed: e.claimed,
    report: now >= e.arriveAt ? e.report : null, // the result stays secret until the army arrives
  });
  const castleJson = (c) => ({ id: c.key, name: c.name, civId: c.civId, tileX: c.tileX, tileY: c.tileY });
  const sendToUser = (userId, event, data) => { for (const [res, id] of streams) if (id === userId) send(res, event, data); };
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ---- events ---------------------------------------------------------------------
  const send = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const broadcast = (event, data) => { for (const res of streams.keys()) send(res, event, data); };
  const broadcastPresence = () => broadcast('presence', [...new Set([...streams.values()].map((id) => 'u_' + id))]);

  // ---- world (castles) -------------------------------------------------------------
  /** Makes sure the NPC castles exist and match the currently baked map. */
  async function syncWorld() {
    const key = spawner.mapKey();
    if (!key) return;
    const saved = await Meta.findByPk('mapKey');
    if (saved && saved.value === key && (await Castle.count({ where: { isNpc: true } })) > 0) return;
    await Castle.destroy({ where: { isNpc: true } });
    for (const n of spawner.makeNpcs()) await Castle.create({ ...n, isNpc: true });
    // Baked again: old player spots may be invalid now, so give players new ones (their saves stay).
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


  // ---- NPC camps --------------------------------------------------------------------
  const rand = Math.random;
  const respawnTimers = new Set();
  const notifiedHome = new Set(); // expedition ids already announced as "home" (in memory is enough: the game also asks on start)

  async function spawnCamp(type) {
    const placed = [...(await Castle.findAll()), ...(await NpcCamp.findAll())];
    const spot = spawner.pickAnySpot(placed);
    if (!spot) return null;
    const level = rollLevel(rand);
    const camp = await NpcCamp.create({
      key: newCampKey(type, rand), type, level, tileX: spot.tileX, tileY: spot.tileY,
      army: makeCampArmy(type, level, rand), loot: makeCampLoot(type, level),
    });
    broadcast('camp', campJson(camp));
    return camp;
  }

  /** Called at every server start: all camps are thrown away and spread again, randomly. */
  async function syncCamps() {
    if (!spawner.mapKey()) return;
    await NpcCamp.destroy({ where: {} });
    for (const type of Object.keys(NPC.CAMP_TYPES)) {
      for (let i = 0; i < N.campsPerType; i++) await spawnCamp(type);
    }
    console.log(`[game] ${await NpcCamp.count()} NPC camps placed`);
  }

  // ---- expeditions (attacks on camps) -------------------------------------------------
  /**
   * Moves expeditions forward: arrived armies fight (oldest arrival first), and the result is stored.
   * Run by the 1 s ticker and before every attack / claim, always one at a time.
   */
  function resolveDue(now = Date.now()) {
    return serial(async () => {
      const arrived = await Expedition.findAll({ where: { status: 'marching', arriveAt: { [Op.lte]: now } }, order: [['arriveAt', 'ASC']] });
      for (const e of arrived) {
        const camp = await NpcCamp.findOne({ where: { key: e.campKey } });
        let report;
        if (!camp) {
          report = { gone: true, win: false, survivors: e.troops, losses: {}, loot: {} }; // somebody else was faster
        } else {
          const r = fight(e.troops, camp.army);
          report = { gone: false, win: r.win, attackerPower: r.attackerPower, defenderPower: r.defenderPower, survivors: r.attackerSurvivors, losses: r.attackerLosses, loot: r.win ? camp.loot : {} };
          if (r.win) {
            await camp.destroy();
            broadcast('campGone', { id: camp.key });
            const t = setTimeout(() => { respawnTimers.delete(t); serial(() => spawnCamp(camp.type)).catch(() => {}); }, N.respawnMs);
            t.unref?.();
            respawnTimers.add(t);
          }
        }
        await e.update({ status: 'returning', report });
        sendToUser(e.userId, 'expedition', { id: e.id, phase: 'arrived' });
      }
      const home = await Expedition.findAll({ where: { status: 'returning', claimed: false, returnAt: { [Op.lte]: now } } });
      for (const e of home) if (!notifiedHome.has(e.id)) { notifiedHome.add(e.id); sendToUser(e.userId, 'expedition', { id: e.id, phase: 'home' }); }
    });
  }

  const tickTimer = { id: null };
  const startTicker = (ms = 1000) => { if (!tickTimer.id) { tickTimer.id = setInterval(() => resolveDue().catch((err) => console.error('[tick]', err)), ms); tickTimer.id.unref?.(); } };
  const stopTicker = () => { clearInterval(tickTimer.id); tickTimer.id = null; for (const t of respawnTimers) clearTimeout(t); respawnTimers.clear(); };

  // ---- auth --------------------------------------------------------------------------
  async function issueToken(userId) {
    const token = newToken();
    await AuthToken.create({ tokenHash: hashToken(token), userId, expiresAt: new Date(Date.now() + config.tokenTtlDays * DAY) });
    // keep the table small: forget this user's expired tokens
    await AuthToken.destroy({ where: { userId, expiresAt: { [Op.lt]: new Date() } } });
    return token;
  }

  const userJson = (u) => ({ id: u.id, username: u.username });

  async function authenticate(token) {
    if (!token) return null;
    const row = await AuthToken.findOne({ where: { tokenHash: hashToken(token) } });
    if (!row || row.expiresAt < new Date()) return null;
    const user = await User.findByPk(row.userId);
    if (!user || user.banned) return null;
    return user;
  }

  const requireAuth = ({ allowQuery = false } = {}) => wrap(async (req, _res, next) => {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : allowQuery ? String(req.query.token || '') : '';
    const user = await authenticate(token);
    if (!user) throw httpError(401, 'not logged in');
    req.user = user;
    req.token = token;
    next();
  });

  // ---- middleware -----------------------------------------------------------------
  // text/plain too: navigator.sendBeacon (save when the tab closes) can't send JSON headers.
  app.use(express.json({ limit: '512kb', type: ['application/json', 'text/plain'] }));
  app.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  // ---- /api/auth ---------------------------------------------------------------------
  const auth = express.Router();

  auth.post('/register', wrap(async (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) throw httpError(400, 'username: 3-16 letters, digits or _');
    if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      throw httpError(400, `password: ${PASSWORD_MIN}-${PASSWORD_MAX} characters`);
    }
    let user;
    try {
      user = await User.create({ username, usernameKey: username.toLowerCase(), passwordHash: await hashPassword(password), lastLoginAt: new Date() });
    } catch (err) {
      if (err.name === 'SequelizeUniqueConstraintError') throw httpError(409, 'this username is taken');
      throw err;
    }
    await GameSave.create({ userId: user.id, culture: null });
    res.status(201).json({ ok: true, token: await issueToken(user.id), user: userJson(user) });
  }));

  auth.post('/login', wrap(async (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') throw httpError(400, 'username and password are required');
    const limitKey = `${req.ip}|${username.toLowerCase()}`;
    if (loginLimiter.blocked(limitKey)) throw httpError(429, 'too many failed attempts: try again in a few minutes');
    const user = await User.findOne({ where: { usernameKey: username.toLowerCase() } });
    // always run a hash check, so a wrong name and a wrong password take the same time
    const ok = await verifyPassword(password, user ? user.passwordHash : 'scrypt$00$00');
    if (!user || !ok) { loginLimiter.fail(limitKey); throw httpError(401, 'wrong username or password'); }
    if (user.banned) throw httpError(403, user.banReason ? `account banned: ${user.banReason}` : 'account banned');
    loginLimiter.reset(limitKey);
    await user.update({ lastLoginAt: new Date() });
    res.json({ ok: true, token: await issueToken(user.id), user: userJson(user) });
  }));

  auth.post('/logout', requireAuth(), wrap(async (req, res) => {
    await AuthToken.destroy({ where: { tokenHash: hashToken(req.token) } });
    res.json({ ok: true });
  }));

  auth.get('/me', requireAuth(), wrap(async (req, res) => {
    const save = await GameSave.findOne({ where: { userId: req.user.id } });
    res.json({ ok: true, user: userJson(req.user), culture: save ? save.culture : null });
  }));

  app.use('/api/auth', auth);

  // ---- /api/game ---------------------------------------------------------------------
  const game = express.Router();

  game.get('/status', (_req, res) => res.json({ ok: true, mode: 'online', auth: true }));

  // Enter the world. First time: the civilization is chosen here, ONCE. After that the
  // server's civilization always wins (a different civId in the request is ignored).
  game.post('/join', requireAuth(), wrap(async (req, res) => {
    const out = await serial(async () => {
      await syncWorld();
      const save = await GameSave.findOne({ where: { userId: req.user.id } });
      let castle = await Castle.findOne({ where: { userId: req.user.id } });
      let civId = castle ? castle.civId : null;
      const returning = !!castle;
      if (!castle) {
        civId = req.body && req.body.civId;
        if (!CIV_IDS.includes(civId)) throw httpError(400, 'choose a civilization');
        const placed = await Castle.findAll();
        const spot = spawner.pickSpot(civId, placed);
        if (!spot) throw httpError(503, 'no free spot found for a new castle');
        castle = await Castle.create({
          key: 'u_' + req.user.id, name: req.user.username, civId, tileX: spot.tileX, tileY: spot.tileY, isNpc: false, userId: req.user.id,
        });
        await GameSave.update({ culture: CIV_TO_CULTURE[civId] }, { where: { id: save.id, culture: null } });
        broadcast('castle', castleJson(castle));
        console.log(`[game] new player "${req.user.username}" (${civId}) at tile ${spot.tileX},${spot.tileY}`);
      }
      return { returning, castle };
    });
    const castles = await Castle.findAll();
    const save = await GameSave.findOne({ where: { userId: req.user.id } });
    const camps = await NpcCamp.findAll();
    res.json({ ok: true, token: req.token, returning: out.returning, you: castleJson(out.castle), castles: castles.map(castleJson), camps: camps.map(campJson), rules: npcRules, save: publicSave(save), now: Date.now() });
  }));

  game.get('/world', requireAuth(), wrap(async (_req, res) => {
    res.json({ ok: true, castles: (await Castle.findAll()).map(castleJson), camps: (await NpcCamp.findAll()).map(campJson), rules: npcRules });
  }));

  game.get('/save', requireAuth(), wrap(async (req, res) => {
    const save = await GameSave.findOne({ where: { userId: req.user.id } });
    res.json({ ok: true, save: publicSave(save) });
  }));

  // PUT = normal save, POST = same thing for sendBeacon (token in ?token=)
  const saveHandler = wrap(async (req, res) => {
    const body = req.body || {};
    const clean = sanitizeSave(body);
    const row = await GameSave.findOne({ where: { userId: req.user.id } });
    if (!row.culture) throw httpError(409, 'choose a civilization first (POST /api/game/join)');
    assertOnlyCulture(clean, row.culture);
    if (Number.isInteger(body.baseVersion) && body.baseVersion !== row.version) {
      throw httpError(409, 'stale save: this account was saved from another tab/device in the meantime', { version: row.version, code: 'stale' });
    }
    const [changed] = await GameSave.update({ ...clean, version: row.version + 1 }, { where: { id: row.id, version: row.version } });
    if (!changed) throw httpError(409, 'stale save: try again', { version: row.version, code: 'stale' });
    res.json({ ok: true, version: row.version + 1 });
  });
  game.put('/save', requireAuth(), saveHandler);
  game.post('/save', requireAuth({ allowQuery: true }), saveHandler);


  // ---- attacks on NPC camps ---------------------------------------------------------------
  const expeditionsOf = async (userId) => {
    const now = Date.now();
    const list = await Expedition.findAll({ where: { userId, claimed: false }, order: [['id', 'ASC']] });
    return { now, expeditions: list.map((e) => expJson(e, now)) };
  };

  game.get('/expeditions', requireAuth(), wrap(async (req, res) => {
    await resolveDue();
    res.json({ ok: true, ...(await expeditionsOf(req.user.id)) });
  }));

  /**
   * Send troops against a camp. The troops are taken from the SAVED army on the server (so the game must
   * have saved first and sends `baseVersion`), and the server answers with the new troops + version.
   * body: { campId, troops: { troopId: count }, baseVersion }
   */
  game.post('/attack', requireAuth(), wrap(async (req, res) => {
    await resolveDue();
    const body = req.body || {};
    const out = await serial(async () => {
      const row = await GameSave.findOne({ where: { userId: req.user.id } });
      if (!row.culture) throw httpError(409, 'choose a civilization first (POST /api/game/join)');
      if (Number.isInteger(body.baseVersion) && body.baseVersion !== row.version) {
        throw httpError(409, 'stale save: save first, then attack', { version: row.version, code: 'stale' });
      }
      const camp = await NpcCamp.findOne({ where: { key: String(body.campId || '') } });
      if (!camp) throw httpError(404, 'this camp does not exist (any more)');
      if (!body.troops || typeof body.troops !== 'object' || Array.isArray(body.troops)) throw httpError(400, 'troops: choose the troops to send');
      const have = ((row.army || {}).troops || {})[row.culture] || {};
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
      const active = await Expedition.count({ where: { userId: req.user.id, claimed: false } });
      if (active >= N.maxActive) throw httpError(409, `at most ${N.maxActive} armies can be out at the same time`);
      const castle = await Castle.findOne({ where: { userId: req.user.id } });
      if (!castle) throw httpError(409, 'you have no castle yet');

      const dist = Math.hypot(camp.tileX - castle.tileX, camp.tileY - castle.tileY);
      const oneWay = Math.max(N.marchMinMs, Math.round(dist * N.marchMsPerTile));
      const now = Date.now();
      const left = { ...have };
      for (const [id, n] of Object.entries(sent)) { left[id] -= n; if (left[id] <= 0) delete left[id]; }
      const army = { ...(row.army || { troops: {}, queue: {} }) };
      army.troops = { ...(army.troops || {}), [row.culture]: left };
      const [changed] = await GameSave.update({ army, version: row.version + 1 }, { where: { id: row.id, version: row.version } });
      if (!changed) throw httpError(409, 'stale save: try again', { version: row.version, code: 'stale' });
      const e = await Expedition.create({
        userId: req.user.id, campKey: camp.key, campType: camp.type, campLevel: camp.level, troops: sent,
        fromX: castle.tileX, fromY: castle.tileY, toX: camp.tileX, toY: camp.tileY,
        arriveAt: now + oneWay, returnAt: now + 2 * oneWay, status: 'marching',
      });
      return { e, version: row.version + 1, troops: left };
    });
    res.status(201).json({ ok: true, now: Date.now(), expedition: expJson(out.e), save: { version: out.version, troops: out.troops } });
  }));

  /**
   * Armies that are back home hand over survivors and loot. They are added to the SAVED data on the server;
   * the game must save first (baseVersion) and then uses the returned troops/resources/version.
   * body: { baseVersion }
   */
  game.post('/expeditions/claim', requireAuth(), wrap(async (req, res) => {
    await resolveDue();
    const body = req.body || {};
    const out = await serial(async () => {
      const row = await GameSave.findOne({ where: { userId: req.user.id } });
      if (!row.culture) throw httpError(409, 'choose a civilization first (POST /api/game/join)');
      if (Number.isInteger(body.baseVersion) && body.baseVersion !== row.version) {
        throw httpError(409, 'stale save: save first, then claim', { version: row.version, code: 'stale' });
      }
      const now = Date.now();
      const home = await Expedition.findAll({ where: { userId: req.user.id, status: 'returning', claimed: false, returnAt: { [Op.lte]: now } }, order: [['id', 'ASC']] });
      const army = { ...(row.army || { troops: {}, queue: {} }) };
      const troops = { ...(((army.troops || {})[row.culture]) || {}) };
      const resources = { food: 0, wood: 0, stone: 0, iron: 0, coin: 0, ...(((row.resources || {})[row.culture]) || {}) };
      const reports = [];
      for (const e of home) {
        const r = e.report || {};
        for (const [id, n] of Object.entries(r.survivors || {})) troops[id] = Math.min(1e9, (troops[id] || 0) + n);
        for (const [k, n] of Object.entries(r.loot || {})) if (k in resources) resources[k] = Math.min(1e12, resources[k] + n);
        reports.push({ id: e.id, campType: e.campType, campLevel: e.campLevel, sent: e.troops, ...r });
      }
      if (!home.length) return { version: row.version, troops, resources, reports };
      army.troops = { ...(army.troops || {}), [row.culture]: troops };
      const [changed] = await GameSave.update({ army, resources: { ...(row.resources || {}), [row.culture]: resources }, version: row.version + 1 }, { where: { id: row.id, version: row.version } });
      if (!changed) throw httpError(409, 'stale save: try again', { version: row.version, code: 'stale' });
      await Expedition.update({ claimed: true }, { where: { id: home.map((e) => e.id) } });
      return { version: row.version + 1, troops, resources, reports };
    });
    res.json({ ok: true, now: Date.now(), save: { version: out.version, troops: out.troops, resources: out.resources }, reports: out.reports });
  }));

  game.get('/events', requireAuth({ allowQuery: true }), (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    streams.set(res, req.user.id);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => {
      clearInterval(heartbeat);
      streams.delete(res);
      clearTimeout(presenceTimer);
      presenceTimer = setTimeout(broadcastPresence, 1500); // a quick reload shouldn't flicker the player offline
    });
    broadcastPresence();
  });

  app.use('/api/game', game);

  app.use('/api', (_req, res) => res.status(404).json({ ok: false, error: 'unknown endpoint' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.too.large') err = httpError(413, 'request too large');
    else if (err.type === 'entity.parse.failed') err = httpError(400, 'invalid JSON');
    const expected = !!err.status; // our own httpError(...): its message is meant for the player (e.g. "no baked map")
    const status = err.status || 500;
    if (!expected) console.error('[api]', err);
    res.status(status).json({ ok: false, error: expected ? err.message : 'server error', ...(err.extra || {}) });
  });

  return {
    app,
    syncWorld, syncCamps, resolveDue, startTicker, stopTicker,
    closeStreams() { stopTicker(); for (const res of streams.keys()) res.end(); streams.clear(); clearTimeout(presenceTimer); },
  };
}
