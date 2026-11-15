/**
 * Alliances: create, join (open / by request), roles (leader > officer > member), kick, leave, transfer, disband.
 * Rules: one alliance per player; members can be of ANY civilization; max MAX_MEMBERS.
 * Rally cleanup when somebody leaves is done through `hooks` (set by rally.js).
 */
import { Op } from 'sequelize';
import { Alliance, AllianceMember, AllianceRequest } from './models.js';
import { Player, GameSave, sequelize } from '../models.js';
import { httpError } from '../httpError.js';
import * as live from '../live.js';

export const MAX_MEMBERS = Number(process.env.ALLIANCE_MAX_MEMBERS || 30);
export const hooks = { onMemberGone: async () => {}, onDisband: async () => {} }; // filled by rally.js

const RANK = { leader: 3, officer: 2, member: 1 };
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _-]{1,18}[\p{L}\p{N}]$/u;
const TAG_RE = /^[A-Za-z0-9]{2,4}$/;
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const err = (status, code, msg) => httpError(status, msg, { code });

async function cultureOf(playerId) {
  const s = await GameSave.findOne({ where: { playerId }, attributes: ['culture'] });
  if (!s?.culture) throw err(409, 'no_culture', 'choose a civilization first');
  return s.culture;
}
export const membershipOf = (playerId) => AllianceMember.findOne({ where: { playerId } });

async function mustBeIn(player, minRole = 'member') {
  const m = await membershipOf(player.id);
  if (!m) throw err(409, 'no_alliance', 'you are not in an alliance');
  if (RANK[m.role] < RANK[minRole]) throw err(403, 'not_allowed', minRole === 'leader' ? 'only the leader can do this' : 'only officers and the leader can do this');
  const a = await Alliance.findByPk(m.allianceId);
  return { m, a };
}

export async function memberIds(allianceId) { return (await AllianceMember.findAll({ where: { allianceId }, attributes: ['playerId'] })).map((x) => x.playerId); }
export async function notify(allianceId, msg, exceptId = null) {
  for (const id of await memberIds(allianceId)) if (id !== exceptId) live.send(id, msg);
}
const ping = (allianceId, why, exceptId) => notify(allianceId, { type: 'alliance', why }, exceptId);

const summary = async (a) => {
  const count = await AllianceMember.count({ where: { allianceId: a.id } });
  const leader = await Player.findByPk(a.leaderId, { attributes: ['username'] });
  return { id: a.id, name: a.name, tag: a.tag, culture: a.culture, description: a.description, joinMode: a.joinMode, memberCount: count, maxMembers: MAX_MEMBERS, leader: leader?.username || '?' };
};

async function detail(a, me) {
  const rows = await AllianceMember.findAll({ where: { allianceId: a.id } });
  const players = await Player.findAll({ where: { id: rows.map((r) => r.playerId) }, attributes: ['id', 'username'] });
  const name = new Map(players.map((p) => [p.id, p.username]));
  const members = rows
    .map((r) => ({ id: r.playerId, username: name.get(r.playerId) || '?', role: r.role, online: live.isOnline(r.playerId) }))
    .sort((x, y) => RANK[y.role] - RANK[x.role] || x.username.localeCompare(y.username));
  const out = { ...(await summary(a)), members, you: { id: me.playerId, role: me.role } };
  if (RANK[me.role] >= RANK.officer) {
    const reqs = await AllianceRequest.findAll({ where: { allianceId: a.id }, order: [['id', 'ASC']] });
    const names = new Map((await Player.findAll({ where: { id: reqs.map((r) => r.playerId) }, attributes: ['id', 'username'] })).map((p) => [p.id, p.username]));
    out.requests = reqs.map((r) => ({ playerId: r.playerId, username: names.get(r.playerId) || '?', at: r.createdAt }));
  }
  return out;
}

/** GET /alliance -> { alliance: null | detail, requested: [allianceId...] } */
export async function mine(player) {
  const m = await membershipOf(player.id);
  const requested = (await AllianceRequest.findAll({ where: { playerId: player.id } })).map((r) => r.allianceId);
  if (!m) return { alliance: null, requested };
  return { alliance: await detail(await Alliance.findByPk(m.allianceId), m), requested };
}

/** GET /alliances?q= : alliances you could join (any civilization). */
export async function list(player, q = '') {
  await cultureOf(player.id);
  const where = {};
  const s = clean(q, 20).toLowerCase();
  if (s) where[Op.or] = [{ nameKey: { [Op.like]: `%${s.replace(/[%_]/g, '')}%` } }, { tagKey: { [Op.like]: `%${s.replace(/[%_]/g, '').toUpperCase()}%` } }];
  const rows = await Alliance.findAll({ where, limit: 60 });
  const list = await Promise.all(rows.map(summary));
  list.sort((a, b) => b.memberCount - a.memberCount || a.name.localeCompare(b.name));
  return { alliances: list.slice(0, 30), requested: (await AllianceRequest.findAll({ where: { playerId: player.id } })).map((r) => r.allianceId) };
}

/** POST /alliance { name, tag, description?, joinMode? } */
export async function create(player, body = {}) {
  const culture = await cultureOf(player.id);
  if (await membershipOf(player.id)) throw err(409, 'already_in', 'you are already in an alliance: leave it first');
  const name = clean(body.name, 60), tag = clean(body.tag, 40).toUpperCase(); // not cut to size: too long = rejected
  if (!NAME_RE.test(name)) throw err(400, 'bad_name', 'alliance name: 3-20 letters, digits, spaces, _ or -');
  if (!TAG_RE.test(tag)) throw err(400, 'bad_tag', 'tag: 2-4 letters or digits');
  const joinMode = body.joinMode === 'request' ? 'request' : 'open';
  let a;
  try {
    a = await sequelize.transaction(async (t) => {
      const al = await Alliance.create({ name, nameKey: name.toLowerCase(), tag, tagKey: tag.toUpperCase(), culture, description: clean(body.description, 200), joinMode, leaderId: player.id }, { transaction: t });
      await AllianceMember.create({ allianceId: al.id, playerId: player.id, role: 'leader' }, { transaction: t });
      await AllianceRequest.destroy({ where: { playerId: player.id }, transaction: t });
      return al;
    });
  } catch (e) {
    if (e.name === 'SequelizeUniqueConstraintError') {
      const tagTaken = await Alliance.findOne({ where: { tagKey: tag.toUpperCase() } });
      throw err(409, tagTaken ? 'tag_taken' : 'name_taken', tagTaken ? 'this tag is taken' : 'this alliance name is taken');
    }
    throw e;
  }
  return mine(player).then((r) => ({ ...r, created: true, id: a.id }));
}

async function addMember(a, playerId, t) {
  await AllianceMember.create({ allianceId: a.id, playerId, role: 'member' }, { transaction: t });
  await AllianceRequest.destroy({ where: { playerId }, transaction: t });
}
async function assertRoom(a) {
  if ((await AllianceMember.count({ where: { allianceId: a.id } })) >= MAX_MEMBERS) throw err(409, 'full', 'this alliance is full');
}

/** POST /alliance/join { allianceId } : open -> you are in; request -> a request is sent to the officers. */
export async function join(player, body = {}) {
  await cultureOf(player.id);
  if (await membershipOf(player.id)) throw err(409, 'already_in', 'you are already in an alliance: leave it first');
  const a = await Alliance.findByPk(Number(body.allianceId));
  if (!a) throw err(404, 'no_alliance', 'this alliance does not exist');
  await assertRoom(a);
  if (a.joinMode === 'open') {
    try { await sequelize.transaction((t) => addMember(a, player.id, t)); } catch (e) { if (e.name === 'SequelizeUniqueConstraintError') throw err(409, 'already_in', 'you are already in an alliance'); throw e; }
    ping(a.id, 'joined', player.id);
    return { ...(await mine(player)), joined: true };
  }
  await AllianceRequest.findOrCreate({ where: { allianceId: a.id, playerId: player.id } });
  ping(a.id, 'request');
  return { ...(await mine(player)), requestedTo: a.id };
}

/** POST /alliance/cancel-request { allianceId } */
export async function cancelRequest(player, body = {}) {
  await AllianceRequest.destroy({ where: { allianceId: Number(body.allianceId), playerId: player.id } });
  return mine(player);
}

/** POST /alliance/answer { playerId, accept } (officer+) */
export async function answer(player, body = {}) {
  const { a } = await mustBeIn(player, 'officer');
  const req = await AllianceRequest.findOne({ where: { allianceId: a.id, playerId: Number(body.playerId) } });
  if (!req) throw err(404, 'no_request', 'this request does not exist (any more)');
  if (body.accept) {
    if (await membershipOf(req.playerId)) { await req.destroy(); throw err(409, 'already_in', 'this player joined another alliance'); }
    await assertRoom(a);
    await sequelize.transaction((t) => addMember(a, req.playerId, t));
    live.send(req.playerId, { type: 'alliance', why: 'accepted' });
    ping(a.id, 'joined', player.id);
  } else {
    await req.destroy();
    live.send(req.playerId, { type: 'alliance', why: 'declined' });
  }
  return mine(player);
}

async function removeMember(a, playerId, why) {
  await hooks.onMemberGone(playerId, a.id);
  await AllianceMember.destroy({ where: { playerId } });
  live.send(playerId, { type: 'alliance', why });
  ping(a.id, why === 'kicked' ? 'kick' : 'left');
}

/** POST /alliance/leave : the leader must hand over leadership first (or disband when alone). */
export async function leave(player) {
  const { m, a } = await mustBeIn(player);
  if (m.role === 'leader') {
    const others = await AllianceMember.count({ where: { allianceId: a.id, playerId: { [Op.ne]: player.id } } });
    if (others > 0) throw err(409, 'leader_cannot_leave', 'give leadership to another member first');
    return disband(player);
  }
  await removeMember(a, player.id, 'left');
  return { alliance: null, requested: [] };
}

/** POST /alliance/kick { playerId } : officers can remove members, the leader can remove anyone. */
export async function kick(player, body = {}) {
  const { m, a } = await mustBeIn(player, 'officer');
  const target = await AllianceMember.findOne({ where: { allianceId: a.id, playerId: Number(body.playerId) } });
  if (!target) throw err(404, 'no_member', 'this player is not in your alliance');
  if (target.playerId === player.id) throw err(400, 'self', 'use "leave" to leave');
  if (RANK[target.role] >= RANK[m.role]) throw err(403, 'not_allowed', 'you cannot remove a member of the same or higher rank');
  await removeMember(a, target.playerId, 'kicked');
  return mine(player);
}

/** POST /alliance/role { playerId, role: 'officer' | 'member' } (leader) */
export async function setRole(player, body = {}) {
  const { a } = await mustBeIn(player, 'leader');
  if (!['officer', 'member'].includes(body.role)) throw err(400, 'bad_role', 'role must be officer or member');
  const target = await AllianceMember.findOne({ where: { allianceId: a.id, playerId: Number(body.playerId) } });
  if (!target || target.role === 'leader') throw err(404, 'no_member', 'this member cannot be changed');
  await target.update({ role: body.role });
  live.send(target.playerId, { type: 'alliance', why: 'role' });
  ping(a.id, 'role');
  return mine(player);
}

/** POST /alliance/transfer { playerId } (leader) : the leader becomes an officer. */
export async function transfer(player, body = {}) {
  const { m, a } = await mustBeIn(player, 'leader');
  const target = await AllianceMember.findOne({ where: { allianceId: a.id, playerId: Number(body.playerId) } });
  if (!target || target.playerId === player.id) throw err(404, 'no_member', 'choose another member of your alliance');
  await sequelize.transaction(async (t) => {
    await target.update({ role: 'leader' }, { transaction: t });
    await m.update({ role: 'officer' }, { transaction: t });
    await a.update({ leaderId: target.playerId }, { transaction: t });
  });
  ping(a.id, 'leader');
  return mine(player);
}

/** POST /alliance/settings { description?, joinMode? } (leader) */
export async function settings(player, body = {}) {
  const { a } = await mustBeIn(player, 'leader');
  const patch = {};
  if (body.description !== undefined) patch.description = clean(body.description, 200);
  if (body.joinMode !== undefined) {
    if (!['open', 'request'].includes(body.joinMode)) throw err(400, 'bad_mode', 'joinMode must be open or request');
    patch.joinMode = body.joinMode;
  }
  await a.update(patch);
  ping(a.id, 'settings', player.id);
  return mine(player);
}

/** POST /alliance/disband (leader) */
export async function disband(player) {
  const { a } = await mustBeIn(player, 'leader');
  const ids = await memberIds(a.id);
  await hooks.onDisband(a.id);
  await sequelize.transaction(async (t) => {
    await AllianceMember.destroy({ where: { allianceId: a.id }, transaction: t });
    await AllianceRequest.destroy({ where: { allianceId: a.id }, transaction: t });
    await a.destroy({ transaction: t });
  });
  for (const id of ids) if (id !== player.id) live.send(id, { type: 'alliance', why: 'disbanded' });
  return { alliance: null, requested: [] };
}

/** Admin reset / civilization change / account delete: the player disappears from alliances and rallies (troops are refunded by the rally hooks). */
export async function onPlayerDropped(playerId) {
  await AllianceRequest.destroy({ where: { playerId } });
  const m = await membershipOf(playerId);
  if (!m) return;
  const a = await Alliance.findByPk(m.allianceId);
  if (!a) { await m.destroy(); return; }
  if (m.role === 'leader') {
    const rest = await AllianceMember.findAll({ where: { allianceId: a.id, playerId: { [Op.ne]: playerId } }, order: [['id', 'ASC']] });
    const next = rest.find((x) => x.role === 'officer') || rest[0];
    if (!next) {
      await hooks.onDisband(a.id);
      await sequelize.transaction(async (t) => { await AllianceMember.destroy({ where: { allianceId: a.id }, transaction: t }); await a.destroy({ transaction: t }); });
      return;
    }
    await sequelize.transaction(async (t) => { await next.update({ role: 'leader' }, { transaction: t }); await a.update({ leaderId: next.playerId }, { transaction: t }); });
  }
  await removeMember(a, playerId, 'removed');
}
