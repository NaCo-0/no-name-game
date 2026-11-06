/** Letters between players + battle reports. One row per recipient, newest first, capped per player and kind. */
import { Op } from 'sequelize';
import { Mail, Player } from './models.js';
import { httpError } from './httpError.js';
import * as live from './live.js';

export const KEEP = { letter: 100, report: 60 };
const LAST = new Map(); // playerId -> [timestamps] (letter rate limit)

export const mailJson = (m) => ({
  id: m.id, kind: m.kind, fromId: m.fromId, fromName: m.fromName, subject: m.subject, body: m.body,
  data: m.data, read: m.isRead, createdAt: m.createdAt,
});

/** Creates one mail for `playerId`, trims old ones and tells the player if they are online. */
export async function deliver({ playerId, kind, fromId = null, fromName = null, subject, body = null, data = null, read = false }) {
  const m = await Mail.create({ playerId, kind, fromId, fromName, subject: String(subject).slice(0, 120), body, data, isRead: read });
  const old = await Mail.findAll({ where: { playerId, kind }, order: [['id', 'DESC']], offset: KEEP[kind] || 60, attributes: ['id'] });
  if (old.length) await Mail.destroy({ where: { id: old.map((o) => o.id) } });
  if (!read) live.send(playerId, { type: 'mail', mail: mailJson(m) });
  return m;
}

export async function unread(playerId) {
  const out = { letter: 0, report: 0 };
  for (const k of Object.keys(out)) out[k] = await Mail.count({ where: { playerId, kind: k, isRead: false } });
  return out;
}

export async function list(player, { kind, limit } = {}) {
  const where = { playerId: player.id };
  if (kind === 'letter' || kind === 'report') where.kind = kind;
  const rows = await Mail.findAll({ where, order: [['id', 'DESC']], limit: Math.min(100, Math.max(1, parseInt(limit) || 50)) });
  return { mails: rows.map(mailJson), unread: await unread(player.id) };
}

export async function send(player, body = {}) {
  if (player.muted) throw httpError(403, 'you are muted', { code: 'muted' });
  const to = String(body.to ?? '').trim();
  const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, n);
  const text = clean(body.text, 1000);
  const subject = clean(body.subject, 80).replace(/\s+/g, ' ') || 'Letter';
  if (!to) throw httpError(400, 'who is the letter for?', { code: 'no_recipient' });
  if (!text) throw httpError(400, 'the letter is empty', { code: 'empty' });
  const target = await Player.findOne({ where: { usernameKey: to.toLowerCase() } });
  if (!target || target.banned) throw httpError(404, 'there is no player with that name', { code: 'no_player' });
  if (target.id === player.id) throw httpError(400, 'you cannot write to yourself', { code: 'self' });
  const now = Date.now();
  const recent = (LAST.get(player.id) || []).filter((t) => now - t < 60000);
  if (recent.length >= 6) throw httpError(429, 'you are sending letters too fast', { code: 'slow_down' });
  recent.push(now); LAST.set(player.id, recent);
  const m = await deliver({ playerId: target.id, kind: 'letter', fromId: player.id, fromName: player.username, subject, body: text });
  return { mail: mailJson(m), to: target.username };
}

/** body: { ids?: number[], kind?: 'letter'|'report' } -> marks them (or all of the kind / everything) as read. */
export async function markRead(player, body = {}) {
  const where = { playerId: player.id, isRead: false };
  if (Array.isArray(body.ids)) where.id = { [Op.in]: body.ids.filter(Number.isInteger).slice(0, 200) };
  else if (body.kind === 'letter' || body.kind === 'report') where.kind = body.kind;
  await Mail.update({ isRead: true }, { where });
  return { unread: await unread(player.id) };
}

export async function remove(player, id) {
  await Mail.destroy({ where: { id: Number(id) || 0, playerId: player.id } });
  return { unread: await unread(player.id) };
}
