import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { Player, GameSave, ChatMessage, sequelize } from '../models.js';
import { hashPassword, verifyPassword, signPlayer, playerAuth, playerAuthQuery, validPassword, validUsername } from '../auth.js';
import { sanitizeSave, assertOnlyCulture, mergeSave, publicSave, GAME_KEYS } from '../save.js';
import { CULTURE_TO_CIV } from '../constants.js';
import { httpError } from '../httpError.js';
import { config } from '../config.js';
import * as live from '../live.js';
import { publicConfig } from '../battleConfig.js';
import * as pvp from '../pvp.js';


const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const userJson = (p) => ({ id: p.id, username: p.username });
const chatJson = (m) => ({ id: m.id, playerId: m.playerId, username: m.username, culture: m.culture, channel: m.channel, text: m.text, createdAt: m.createdAt });

export default function gameRoutes(world) {
  const r = Router();
  // Faghat talash-e na-movafagh-e login shomorde mishe; register hamishe.
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.authLimit, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false, message: { error: 'too_many_requests', message: 'too many failed attempts: try again in a few minutes' } });
  const registerLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.authLimit, standardHeaders: true, legacyHeaders: false, message: { error: 'too_many_requests', message: 'too many accounts from this address: try again later' } });

  // ---------- auth ----------
  r.post('/auth/register', registerLimiter, async (req, res) => {
    const { username, password, email } = req.body || {};
    if (!validUsername(username)) return res.status(400).json({ error: 'bad_username', message: 'username: 3-24 letters, digits or _' });
    if (!validPassword(password)) return res.status(400).json({ error: 'bad_password', message: 'password: 8-72 characters' });
    if (await Player.findOne({ where: { usernameKey: username.toLowerCase() } })) return res.status(409).json({ error: 'username_taken', message: 'this username is taken' });
    let player;
    try {
      player = await sequelize.transaction(async (t) => {
        const p = await Player.create({
          username, email: typeof email === 'string' && email.length < 200 ? email : null,
          passwordHash: await hashPassword(password), lastLoginAt: new Date(),
        }, { transaction: t });
        await GameSave.create({ playerId: p.id, culture: null, data: {}, revision: 0 }, { transaction: t });
        return p;
      });
    } catch (err) {
      if (err.name === 'SequelizeUniqueConstraintError') return res.status(409).json({ error: 'username_taken', message: 'this username is taken' });
      throw err;
    }
    res.status(201).json({ token: signPlayer(player), user: userJson(player), player: userJson(player) });
  });

  r.post('/auth/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body || {};
    const p = await Player.findOne({ where: { usernameKey: String(username ?? '').toLowerCase() } });
    if (!(await verifyPassword(password, p?.passwordHash))) return res.status(401).json({ error: 'bad_credentials', message: 'wrong username or password' });
    if (p.banned) return res.status(403).json({ error: 'banned', reason: p.banReason, message: p.banReason ? `account banned: ${p.banReason}` : 'account banned' });
    p.lastLoginAt = new Date();
    await p.save();
    res.json({ token: signPlayer(p), user: userJson(p), player: userJson(p) });
  });

  // Token bi-vaziat-e (JWT): kharej shodan = pak kardan-e token dar client. Ramz-e jadid hame-ye token-ha ro bi-etebar mikone.
  r.post('/auth/logout', playerAuth, (req, res) => res.json({ ok: true }));
  r.get('/auth/me', playerAuth, async (req, res) => {
    const s = await GameSave.findOne({ where: { playerId: req.player.id }, attributes: ['culture'] });
    res.json({ user: userJson(req.player), culture: s?.culture ?? null });
  });

  r.get('/game/status', (req, res) => res.json({ ok: true, mode: 'online', auth: true }));

  // ---------- save (sendBeacon: POST + text/plain + ?token=) ----------
  async function saveHandler(req, res) {
    const { data, revision } = req.body || {};
    if (!isObj(data)) return res.status(400).json({ error: 'bad_data', message: 'data must be an object' });
    const game = Object.fromEntries(GAME_KEYS.filter((k) => k in data).map((k) => [k, data[k]])); // faghat kelid-haye bazi
    const clean = sanitizeSave(game);
    const out = await sequelize.transaction(async (t) => {
      const s = await GameSave.findOne({ where: { playerId: req.player.id }, transaction: t });
      if (!s.culture) return { status: 409, body: { error: 'no_culture', message: 'choose a civilization first (POST /api/game/join)' } };
      assertOnlyCulture(clean, s.culture);
      if (!Number.isInteger(revision) || revision !== s.revision) {
        return { status: 409, body: { error: 'revision_conflict', message: 'stale save: this account was saved from another tab/device in the meantime', revision: s.revision, data: s.data } };
      }
      s.data = mergeSave(s.data, clean); s.revision += 1;
      await s.save({ transaction: t });
      return { status: 200, body: { revision: s.revision, version: s.revision } };
    });
    res.status(out.status).json(out.body);
  }
  r.post('/game/save', playerAuthQuery, saveHandler);

  r.use('/game', playerAuth);

  r.get('/game/save', async (req, res) => {
    const s = await GameSave.findOne({ where: { playerId: req.player.id } });
    res.json({ culture: s.culture, data: s.data, revision: s.revision });
  });
  r.put('/game/save', saveHandler);

  // ---------- donya ----------
  // Vorood: avvalin bar tamaddon va ghale entekhab mishe (yek bar). Bad az on tamaddon-e server hamishe bar-e.
  r.post('/game/join', async (req, res) => {
    const out = await world.joinWorld(req.player, req.body?.civId);
    const w = await world.worldJson();
    res.json({ ok: true, returning: out.returning, you: world.castleJson(out.castle), castles: w.castles, camps: w.camps, rules: w.rules, save: publicSave(out.save), now: Date.now() });
  });

  // Hamin kar ba nam-e tamaddon (persian, mongol, ...): faghat yek bar.
  r.post('/game/choose-culture', async (req, res) => {
    const civId = CULTURE_TO_CIV[req.body?.culture];
    if (!civId) return res.status(400).json({ error: 'bad_culture', message: 'unknown civilization' });
    const s = await GameSave.findOne({ where: { playerId: req.player.id }, attributes: ['culture'] });
    if (s.culture) return res.status(409).json({ error: 'culture_locked', message: 'the civilization can only be chosen once' });
    const out = await world.joinWorld(req.player, civId);
    res.json({ culture: out.save.culture, revision: out.save.revision });
  });

  r.get('/game/world', async (req, res) => res.json({ ok: true, ...(await world.worldJson()) }));

  r.get('/game/expeditions', async (req, res) => {
    await world.resolveDue();
    res.json({ ok: true, ...(await world.expeditionsOf(req.player.id)) });
  });
  r.post('/game/attack', async (req, res) => res.status(201).json({ ok: true, ...(await world.attack(req.player, req.body)) }));
  r.post('/game/expeditions/claim', async (req, res) => res.json({ ok: true, ...(await world.claim(req.player, req.body)) }));
    // ---------- nabard (PvP) ----------
  r.get('/game/battle-config', (req, res) => res.json({ ok: true, ...publicConfig() }));
  r.get('/game/defense', async (req, res) => res.json({ ok: true, ...(await pvp.getDefense(req.player)) }));
  r.put('/game/defense', async (req, res) => res.json({ ok: true, ...(await pvp.setDefense(req.player, req.body)) }));
  r.post('/game/attack-castle', async (req, res) => res.status(201).json({ ok: true, now: Date.now(), ...(await pvp.attackCastle(req.player, req.body)) }));

  // ---------- chat (hame-ye payam-ha dar ChatMessage sabt mishan; admin mitune bebine) ----------
  const lastMsgs = new Map(); // playerId -> [timestamps]
  const CHAT_MAX_LEN = 300;

  r.get('/game/chat', async (req, res) => {
    const s = await GameSave.findOne({ where: { playerId: req.player.id }, attributes: ['culture'] });
    const channel = req.query.channel === 'civ' ? 'civ' : 'global';
    if (channel === 'civ' && !s.culture) return res.json({ messages: [] });
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const where = channel === 'civ' ? { channel, culture: s.culture } : { channel };
    const rows = await ChatMessage.findAll({ where, order: [['id', 'DESC']], limit });
    res.json({ messages: rows.reverse().map(chatJson) });
  });

  r.post('/game/chat', async (req, res) => {
    const s = await GameSave.findOne({ where: { playerId: req.player.id }, attributes: ['culture'] });
    if (!s.culture) throw httpError(409, 'choose a civilization first', { code: 'no_culture' });
    if (req.player.muted) throw httpError(403, 'you are muted', { code: 'muted' });
    const channel = req.body?.channel === 'civ' ? 'civ' : 'global';
    // eslint-disable-next-line no-control-regex
    const text = String(req.body?.text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) throw httpError(400, 'message is empty', { code: 'empty' });
    if (text.length > CHAT_MAX_LEN) throw httpError(400, `message is too long (max ${CHAT_MAX_LEN})`, { code: 'too_long' });
    const now = Date.now();
    const recent = (lastMsgs.get(req.player.id) || []).filter((t) => now - t < 60000);
    if ((recent.length && now - recent[recent.length - 1] < 700) || recent.length >= 20) throw httpError(429, 'you are sending messages too fast', { code: 'slow_down' });
    recent.push(now);
    lastMsgs.set(req.player.id, recent);
    const m = await ChatMessage.create({ playerId: req.player.id, username: req.player.username, culture: s.culture, channel, text, ip: req.ip });
    const msg = { type: 'chat', message: chatJson(m) };
    if (channel === 'civ') live.sendToCulture(s.culture, msg); else live.broadcast(msg);
    res.status(201).json({ message: chatJson(m) });
  });

  return r;
}
