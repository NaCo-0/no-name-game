import express from 'express';
import { Op } from 'sequelize';
import { hashPassword, verifyPassword, newToken, hashToken, createLimiter } from './auth.js';
import { CIV_TO_CULTURE, CIV_IDS, USERNAME_RE, PASSWORD_MIN, PASSWORD_MAX } from './constants.js';
import { sanitizeSave, assertOnlyCulture, publicSave } from './save.js';
import { httpError } from './httpError.js';

const DAY = 24 * 60 * 60 * 1000;

/**
 * @param {object} o
 * @param {{models:object}} o.db
 * @param {object} o.config
 * @param {{mapKey():string|null, pickSpot(civId:string, placed:object[]):{tileX:number,tileY:number}|null, makeNpcs():object[]}} o.spawner
 */
export function createApp({ db, config, spawner }) {
  const { User, GameSave, Castle, AuthToken, Meta } = db.models;
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

  const castleJson = (c) => ({ id: c.key, name: c.name, civId: c.civId, tileX: c.tileX, tileY: c.tileY });
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
    res.json({ ok: true, token: req.token, returning: out.returning, you: castleJson(out.castle), castles: castles.map(castleJson), save: publicSave(save) });
  }));

  game.get('/world', requireAuth(), wrap(async (_req, res) => {
    res.json({ ok: true, castles: (await Castle.findAll()).map(castleJson) });
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
    syncWorld,
    closeStreams() { for (const res of streams.keys()) res.end(); streams.clear(); clearTimeout(presenceTimer); },
  };
}
