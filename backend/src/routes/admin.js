import { Router } from 'express';
import { Op } from 'sequelize';
import rateLimit from 'express-rate-limit';
import {
  AdminUser, Player, GameSave, Castle, Territory, AuditLog, ChatMessage, CULTURES, ROLES, sequelize,
} from '../models.js';
import { sanitizeSave, assertOnlyCulture, GAME_KEYS } from '../save.js';
import { CULTURE_TO_CIV } from '../constants.js';
import { hashPassword, verifyPassword, signAdmin, adminAuth, validPassword, validUsername } from '../auth.js';
import { audit, shallowDiff } from '../audit.js';
import * as live from '../live.js';

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: Number(process.env.ADMIN_LOGIN_LIMIT || 15), standardHeaders: true, legacyHeaders: false });
const viewer = adminAuth('viewer'), mod = adminAuth('moderator'), root = adminAuth('superadmin');
const pageOf = (q, def = 20) => {
  const page = Math.max(1, parseInt(q.page) || 1);
  const size = Math.min(100, Math.max(5, parseInt(q.pageSize) || def));
  return { page, size, offset: (page - 1) * size };
};
const pubAdmin = (a) => ({ id: a.id, username: a.username, role: a.role, disabled: a.disabled, lastLoginAt: a.lastLoginAt, createdAt: a.createdAt });
const pubPlayer = (p) => ({
  id: p.id, username: p.username, email: p.email, banned: p.banned, banReason: p.banReason, muted: p.muted,
  lastLoginAt: p.lastLoginAt, createdAt: p.createdAt, culture: p.gameSave?.culture ?? null,
  revision: p.gameSave?.revision ?? 0, saveUpdatedAt: p.gameSave?.updatedAt ?? null, online: live.isOnline(p.id),
});
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export default function adminRoutes(world) {
const r = Router();

// ---------- auth ----------
r.post('/auth/login', loginLimiter, wrap(async (req, res) => {
  const { username, password } = req.body || {};
  const a = await AdminUser.findOne({ where: { username: String(username ?? '') } });
  const ok = await verifyPassword(password, a?.passwordHash);
  if (!ok || a.disabled) return res.status(401).json({ error: 'bad_credentials' });
  a.lastLoginAt = new Date(); await a.save();
  req.admin = a;
  await audit(req, 'admin.login', 'admin', a.id);
  res.json({ token: signAdmin(a), admin: pubAdmin(a) });
}));

r.get('/auth/me', viewer, (req, res) => res.json({ admin: pubAdmin(req.admin) }));

// ---------- dashboard ----------
r.get('/stats', viewer, wrap(async (req, res) => {
  const since = new Date(Date.now() - 14 * 86400000);
  const [total, banned, castles, perCulture, recentSignups, recentPlayers, recentAudit] = await Promise.all([
    Player.count(), Player.count({ where: { banned: true } }), Castle.count({ where: { isNpc: false } }),
    GameSave.findAll({ attributes: ['culture', [sequelize.fn('COUNT', sequelize.col('id')), 'n']], group: ['culture'], raw: true }),
    Player.findAll({ attributes: ['createdAt'], where: { createdAt: { [Op.gte]: since } }, raw: true }),
    Player.findAll({ order: [['createdAt', 'DESC']], limit: 6, include: [{ model: GameSave, as: 'gameSave', attributes: ['culture', 'revision', 'updatedAt'] }] }),
    AuditLog.findAll({ order: [['createdAt', 'DESC']], limit: 8 }),
  ]);
  const days = {};
  for (let i = 13; i >= 0; i--) days[new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)] = 0;
  for (const p of recentSignups) { const d = new Date(p.createdAt).toISOString().slice(0, 10); if (d in days) days[d]++; }
  const territories = await Territory.findAll({ order: [['id', 'ASC']] });
  const onlineByCulture = {};
  const onlineIds = live.onlineIds();
  if (onlineIds.length) {
    const saves = await GameSave.findAll({ where: { playerId: onlineIds }, attributes: ['culture'], raw: true });
    for (const s of saves) onlineByCulture[s.culture ?? 'none'] = (onlineByCulture[s.culture ?? 'none'] || 0) + 1;
  }
  res.json({
    totals: { players: total, online: onlineIds.length, banned, castles, signups14d: recentSignups.length },
    cultures: territories.map((t) => ({
      culture: t.culture, color: t.color, biome: t.biome,
      players: Number(perCulture.find((c) => c.culture === t.culture)?.n || 0),
      online: onlineByCulture[t.culture] || 0,
    })),
    undecided: Number(perCulture.find((c) => c.culture == null)?.n || 0),
    signups: Object.entries(days).map(([date, count]) => ({ date, count })),
    recentPlayers: recentPlayers.map(pubPlayer),
    recentAudit,
  });
}));

// ---------- players ----------
r.get('/players', viewer, wrap(async (req, res) => {
  const { page, size, offset } = pageOf(req.query);
  const { q, culture, banned, online, sort, dir } = req.query;
  const where = {};
  if (q) where[Op.or] = [{ username: { [Op.like]: `%${q}%` } }, { email: { [Op.like]: `%${q}%` } }];
  if (banned === '1') where.banned = true;
  if (banned === '0') where.banned = false;
  if (online === '1') where.id = live.onlineIds();
  const direction = dir === 'asc' ? 'ASC' : 'DESC';
  const order = sort === 'culture' ? [[{ model: GameSave, as: 'gameSave' }, 'culture', direction]]
    : [[['username', 'lastLoginAt', 'createdAt'].includes(sort) ? sort : 'createdAt', direction]];
  const saveWhere = culture === 'none' ? { culture: null } : CULTURES.includes(culture) ? { culture } : undefined;
  const { rows, count } = await Player.findAndCountAll({
    where, order, limit: size, offset, distinct: true,
    include: [{ model: GameSave, as: 'gameSave', attributes: ['culture', 'revision', 'updatedAt'], where: saveWhere, required: !!saveWhere }],
  });
  res.json({ items: rows.map(pubPlayer), total: count, page, pageSize: size });
}));

const loadPlayer = (id) => Player.findByPk(id, { include: [{ model: GameSave, as: 'gameSave' }, { model: Castle, as: 'castles' }, Territory] });

r.get('/players/:id', viewer, wrap(async (req, res) => {
  const p = await loadPlayer(req.params.id);
  if (!p) return res.status(404).json({ error: 'not_found' });
  res.json({ player: pubPlayer(p), save: p.gameSave, castles: p.castles, territory: p.Territory });
}));

r.patch('/players/:id', mod, wrap(async (req, res) => {
  const p = await Player.findByPk(req.params.id, { include: [{ model: GameSave, as: 'gameSave' }] });
  if (!p) return res.status(404).json({ error: 'not_found' });
  const before = { email: p.email, banned: p.banned, banReason: p.banReason, muted: p.muted };
  const { email, banned, banReason, muted } = req.body || {};
  if (email !== undefined) p.email = email ? String(email).slice(0, 200) : null;
  if (banned !== undefined) p.banned = !!banned;
  if (banReason !== undefined) p.banReason = banReason ? String(banReason).slice(0, 200) : null;
  if (muted !== undefined) p.muted = !!muted;
  if (!p.banned) p.banReason = null;
  await p.save();
  const after = { email: p.email, banned: p.banned, banReason: p.banReason, muted: p.muted };
  const diff = shallowDiff(before, after);
  if (p.banned && !before.banned) live.kick(p.id, 'banned');
  if (Object.keys(diff).length) await audit(req, before.banned !== p.banned ? (p.banned ? 'player.ban' : 'player.unban') : (before.muted !== p.muted && Object.keys(diff).length === 1 ? (p.muted ? 'player.mute' : 'player.unmute') : 'player.update'), 'player', p.id, diff);
  res.json({ player: pubPlayer(p) });
}));

r.post('/players/:id/reset-password', root, wrap(async (req, res) => {
  const p = await Player.findByPk(req.params.id);
  if (!p) return res.status(404).json({ error: 'not_found' });
  if (!validPassword(req.body?.password)) return res.status(400).json({ error: 'bad_password' });
  p.passwordHash = await hashPassword(req.body.password);
  p.tokenVersion += 1; // token-haye ghadimi bi-etebar mishan
  await p.save();
  live.kick(p.id, 'password_reset');
  await audit(req, 'player.reset_password', 'player', p.id);
  res.json({ ok: true });
}));

r.put('/players/:id/save', mod, wrap(async (req, res) => {
  const { data, revision } = req.body || {};
  if (!data || typeof data !== 'object' || Array.isArray(data)) return res.status(400).json({ error: 'bad_data' });
  // Kelid-haye bazi (buildings, resources, army, marches, settings) ba hamoon ghavanin-e save-e bazikon check mishan,
  // ta ya'ni admin nemitune daadeye kharab beneviseh ke bazi ro az kar biandaze. Kelid-haye digar azad-and.
  const clean = sanitizeSave(Object.fromEntries(GAME_KEYS.filter((k) => k in data).map((k) => [k, data[k]])));
  const out = await sequelize.transaction(async (t) => {
    const s = await GameSave.findOne({ where: { playerId: req.params.id }, transaction: t });
    if (!s) return { status: 404, body: { error: 'not_found' } };
    if (s.culture) assertOnlyCulture(clean, s.culture);
    if (revision !== s.revision) return { status: 409, body: { error: 'revision_conflict', revision: s.revision, data: s.data } };
    const before = s.data;
    s.data = { ...data, ...clean }; s.revision += 1;
    await s.save({ transaction: t });
    return { status: 200, body: { revision: s.revision, save: s }, before };
  });
  if (out.status === 200) {
    live.send(req.params.id, { type: 'save_changed', revision: out.body.revision });
    await audit(req, 'player.edit_save', 'player', req.params.id, shallowDiff(out.before, out.body.save.data));
  }
  res.status(out.status).json(out.body);
}));

// culture=null yani reset (data ham pak mishe). Faghat superadmin.
r.post('/players/:id/culture', root, wrap(async (req, res) => {
  const { culture } = req.body || {};
  if (culture !== null && !CULTURES.includes(culture)) return res.status(400).json({ error: 'bad_culture' });
  const p = await Player.findByPk(req.params.id, { include: [{ model: GameSave, as: 'gameSave' }] });
  if (!p) return res.status(404).json({ error: 'not_found' });
  const before = p.gameSave.culture;
  await sequelize.transaction(async (t) => {
    const terr = culture ? await Territory.findOne({ where: { culture }, transaction: t }) : null;
    p.gameSave.culture = culture; p.gameSave.revision += 1;
    if (!culture || culture !== before) p.gameSave.data = {};
    await p.gameSave.save({ transaction: t });
    await p.update({ territoryId: terr?.id ?? null }, { transaction: t });
    if (!culture || culture !== before) await world.dropPlayer(p.id, t); // ghale-ye ghadimi va hamle-ha pak mishan
  });
  live.kick(p.id, 'culture_changed');
  let castle = null;
  if (culture && culture !== before) { // ghale-ye jadid dar tamaddon-e jadid (agar naghshe baked nabashe, bazikon dar vorood-e badi ghale migire)
    try { castle = (await world.joinWorld(p, CULTURE_TO_CIV[culture])).castle.key; } catch (err) { console.warn('[admin] castle not placed now:', err.message); }
  }
  await audit(req, 'player.set_culture', 'player', p.id, { culture: { before, after: culture } });
  res.json({ player: pubPlayer(p), castle });
}));

r.post('/players/:id/kick', mod, wrap(async (req, res) => {
  const ok = live.kick(req.params.id, 'kicked_by_admin');
  await audit(req, 'player.kick', 'player', req.params.id);
  res.json({ ok });
}));

r.delete('/players/:id', root, wrap(async (req, res) => {
  const p = await Player.findByPk(req.params.id);
  if (!p) return res.status(404).json({ error: 'not_found' });
  live.kick(p.id, 'deleted');
  await world.dropPlayer(p.id);
  await p.destroy();
  await audit(req, 'player.delete', 'player', p.id, { username: p.username });
  res.json({ ok: true });
}));

// ---------- online + broadcast ----------
r.get('/online', viewer, (req, res) => res.json({ items: live.onlineList() }));

r.post('/broadcast', mod, wrap(async (req, res) => {
  const text = String(req.body?.text ?? '').trim().slice(0, 500);
  if (!text) return res.status(400).json({ error: 'empty' });
  const pid = req.body?.playerId;
  const delivered = pid ? (live.send(pid, { type: 'admin_message', text }) ? 1 : 0) : live.broadcast({ type: 'admin_message', text });
  await audit(req, pid ? 'message.player' : 'message.broadcast', pid ? 'player' : null, pid ?? null, { text, delivered });
  res.json({ delivered });
}));

// ---------- territories ----------
r.get('/territories', viewer, wrap(async (req, res) => {
  const list = await Territory.findAll({ order: [['id', 'ASC']] });
  const counts = await Player.findAll({ attributes: ['territoryId', [sequelize.fn('COUNT', sequelize.col('id')), 'n']], group: ['territoryId'], raw: true });
  res.json({ items: list.map((t) => ({ ...t.toJSON(), players: Number(counts.find((c) => c.territoryId === t.id)?.n || 0) })) });
}));

r.patch('/territories/:id', root, wrap(async (req, res) => {
  const t = await Territory.findByPk(req.params.id);
  if (!t) return res.status(404).json({ error: 'not_found' });
  const before = { biome: t.biome, color: t.color, note: t.note };
  const { biome, color, note } = req.body || {};
  if (typeof biome === 'string' && biome.trim()) t.biome = biome.trim().slice(0, 60);
  if (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) t.color = color;
  if (note !== undefined) t.note = note ? String(note).slice(0, 1000) : null;
  await t.save();
  await audit(req, 'territory.update', 'territory', t.id, shallowDiff(before, { biome: t.biome, color: t.color, note: t.note }));
  res.json({ territory: t });
}));

// ---------- chat ----------
r.get('/chat', viewer, wrap(async (req, res) => {
  const { page, size, offset } = pageOf(req.query, 40);
  const { q, channel, culture, player } = req.query;
  const where = {};
  if (q) where.text = { [Op.like]: `%${q}%` };
  if (channel === 'global' || channel === 'civ') where.channel = channel;
  if (CULTURES.includes(culture)) where.culture = culture;
  if (player) where[Op.and] = [{ [Op.or]: [{ username: { [Op.like]: `%${player}%` } }, { playerId: Number(player) || -1 }] }];
  const { rows, count } = await ChatMessage.findAndCountAll({ where, order: [['id', 'DESC']], limit: size, offset });
  res.json({ items: rows, total: count, page, pageSize: size });
}));

r.delete('/chat/:id', mod, wrap(async (req, res) => {
  const m = await ChatMessage.findByPk(req.params.id);
  if (!m) return res.status(404).json({ error: 'not_found' });
  await m.destroy();
  live.broadcast({ type: 'chat_deleted', id: m.id });
  await audit(req, 'chat.delete', 'chat', m.id, { username: m.username, channel: m.channel, text: m.text });
  res.json({ ok: true });
}));

// ---------- audit ----------
r.get('/audit', viewer, wrap(async (req, res) => {
  const { page, size, offset } = pageOf(req.query, 30);
  const where = {};
  if (req.query.q) where.action = { [Op.like]: `%${req.query.q}%` };
  if (req.query.admin) where.adminName = req.query.admin;
  if (req.query.targetType) where.targetType = String(req.query.targetType);
  if (req.query.targetId) where.targetId = String(req.query.targetId);
  const { rows, count } = await AuditLog.findAndCountAll({ where, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: size, offset });
  res.json({ items: rows, total: count, page, pageSize: size });
}));

// ---------- admins ----------
async function otherActiveRoots(exceptId) {
  return AdminUser.count({ where: { role: 'superadmin', disabled: false, id: { [Op.ne]: exceptId } } });
}
r.get('/admins', root, wrap(async (req, res) => {
  res.json({ items: (await AdminUser.findAll({ order: [['id', 'ASC']] })).map(pubAdmin) });
}));
r.post('/admins', root, wrap(async (req, res) => {
  const { username, password, role } = req.body || {};
  if (!validUsername(username)) return res.status(400).json({ error: 'bad_username' });
  if (!validPassword(password)) return res.status(400).json({ error: 'bad_password' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'bad_role' });
  if (await AdminUser.findOne({ where: { username } })) return res.status(409).json({ error: 'username_taken' });
  const a = await AdminUser.create({ username, role, passwordHash: await hashPassword(password) });
  await audit(req, 'admin.create', 'admin', a.id, { username, role });
  res.status(201).json({ admin: pubAdmin(a) });
}));
r.patch('/admins/:id', root, wrap(async (req, res) => {
  const a = await AdminUser.findByPk(req.params.id);
  if (!a) return res.status(404).json({ error: 'not_found' });
  const { role, disabled, password } = req.body || {};
  const demoting = (role !== undefined && role !== 'superadmin') || disabled === true;
  if (demoting && a.role === 'superadmin' && !(await otherActiveRoots(a.id))) return res.status(400).json({ error: 'last_superadmin' });
  const before = { role: a.role, disabled: a.disabled };
  if (role !== undefined) { if (!ROLES.includes(role)) return res.status(400).json({ error: 'bad_role' }); a.role = role; }
  if (disabled !== undefined) a.disabled = !!disabled;
  if (password !== undefined) { if (!validPassword(password)) return res.status(400).json({ error: 'bad_password' }); a.passwordHash = await hashPassword(password); }
  await a.save();
  await audit(req, 'admin.update', 'admin', a.id, { ...shallowDiff(before, { role: a.role, disabled: a.disabled }), ...(password ? { password: 'changed' } : {}) });
  res.json({ admin: pubAdmin(a) });
}));
r.delete('/admins/:id', root, wrap(async (req, res) => {
  const a = await AdminUser.findByPk(req.params.id);
  if (!a) return res.status(404).json({ error: 'not_found' });
  if (a.role === 'superadmin' && !(await otherActiveRoots(a.id))) return res.status(400).json({ error: 'last_superadmin' });
  await a.destroy();
  await audit(req, 'admin.delete', 'admin', a.id, { username: a.username });
  res.json({ ok: true });
}));

return r;
}
