/**
 * Individual events on a timetable (hours since the server started). Both are personal (no alliance needed):
 *   bandit_hunter  - points for every NPC camp you (or your rally) defeat; bigger camps give more
 *   grand_builder  - points for every building level you gain during the event
 * Points are saved per player; milestone tiers give rewards (claimed one by one); the leaderboard shows the best players.
 */
import { Op } from 'sequelize';
import { EventScore, EventClaim } from './models.js';
import { Player, GameSave, sequelize } from '../models.js';
import { httpError } from '../httpError.js';
import * as live from '../live.js';
import { serverStart, serverDay, serverNow, DAY_MS, HOUR_MS } from './clock.js';
import { loadRow, resOf, addRes, withState, writeRow, staleCheck, troopsOf } from './saves.js';

export const CAMP_POINTS = { 1: 10, 2: 25, 3: 60 };
export const BUILD_POINTS_PER_LEVEL = 25;
export const CLAIM_GRACE_DAYS = 7; // rewards can be taken until this many days after the event ends

// Timetable, in hours after the server started: Grand Builder runs on server day 2, Bandit Hunter on day 3 (the next day).
export const SCHEDULE = { grand_builder: { startHour: 24, endHour: 48 }, bandit_hunter: { startHour: 48, endHour: 72 } };

export const EVENTS = [
  {
    id: 'grand_builder', name: 'Grand Builder', unit: 'points', ...SCHEDULE.grand_builder,
    desc: 'Raise your buildings. Every level you gain while the event runs scores points.',
    how: ['Each building level gained: 25 points', 'Counts from the moment you first take part'],
    tiers: [
      { points: 100, reward: { wood: 800, stone: 500 } },
      { points: 300, reward: { coin: 600, iron: 300 } },
      { points: 600, reward: { coin: 1500, wood: 2000, stone: 1500 } },
      { points: 1000, reward: { coin: 4000, iron: 1200 } },
    ],
  },
  {
    id: 'bandit_hunter', name: 'Bandit Hunter', unit: 'points', ...SCHEDULE.bandit_hunter,
    desc: 'Send your troops against NPC camps. Every victory scores points; stronger camps score more.',
    how: ['Level 1 camp: 10 points', 'Level 2 camp: 25 points', 'Level 3 camp: 60 points', 'Rally wins count for everyone who joined'],
    tiers: [
      { points: 30, reward: { food: 600, wood: 600 } },
      { points: 100, reward: { coin: 500, stone: 800 } },
      { points: 250, reward: { coin: 1200, iron: 500 } },
      { points: 500, reward: { coin: 3000, iron: 1000, food: 2000 } },
    ],
  },
];
const byId = new Map(EVENTS.map((e) => [e.id, e]));

async function windowOf(def, now = null) {
  now ??= await serverNow();
  const start = await serverStart();
  const startsAt = start + def.startHour * HOUR_MS, endsAt = start + def.endHour * HOUR_MS;
  const state = now < startsAt ? 'upcoming' : now < endsAt ? 'active' : 'ended';
  return { startsAt, endsAt, state };
}

/** For the admin panel: the timetable as the event clock sees it right now. */
export async function eventWindows(now = null) {
  now ??= await serverNow();
  return Promise.all(EVENTS.map(async (def) => ({ id: def.id, name: def.name, startHour: def.startHour, endHour: def.endHour, ...(await windowOf(def, now)) })));
}

async function usernameOf(playerId) { return (await Player.findByPk(playerId, { attributes: ['username'] }))?.username || '?'; }

async function scoreRow(playerId, eventId, create = true) {
  let row = await EventScore.findOne({ where: { playerId, eventId } });
  if (!row && create) {
    try { row = await EventScore.create({ playerId, eventId, username: await usernameOf(playerId), points: 0 }); }
    catch { row = await EventScore.findOne({ where: { playerId, eventId } }); }
  }
  return row;
}

async function addPoints(playerId, eventId, pts) {
  const row = await scoreRow(playerId, eventId);
  await row.increment('points', { by: pts });
  live.send(playerId, { type: 'event', eventId, points: row.points + pts });
}

/** Game happenings call this. kind: 'camp_win' { level } */
export async function record(playerId, kind, info = {}) {
  try {
    if (kind === 'camp_win') {
      const def = byId.get('bandit_hunter');
      if ((await windowOf(def)).state !== 'active') return;
      const pts = CAMP_POINTS[info.level] || 10;
      await addPoints(playerId, def.id, pts);
    }
  } catch (err) { console.error('[events] record failed', err.message); }
}

const levelSum = (row) => ((((row.data || {}).buildings || {})[row.culture]) || []).reduce((s, b) => s + (Number(b.level) || 0), 0);

/** Growth events are measured from the save: call after a save / when the player opens the events screen. */
export async function observeSave(playerId, row = null) {
  try {
    const def = byId.get('grand_builder');
    if ((await windowOf(def)).state !== 'active') return;
    row ||= await GameSave.findOne({ where: { playerId } });
    if (!row?.culture || !Array.isArray(((row.data || {}).buildings || {})[row.culture])) return;
    const sum = levelSum(row);
    const s = await scoreRow(playerId, def.id);
    if (s.baseline == null) { await s.update({ baseline: sum }); return; }
    const pts = Math.max(0, sum - s.baseline) * BUILD_POINTS_PER_LEVEL;
    if (pts > s.points) { await s.update({ points: pts }); live.send(playerId, { type: 'event', eventId: def.id, points: pts }); }
  } catch (err) { console.error('[events] observe failed', err.message); }
}

/** GET /events */
export async function eventsFor(player, now = null) {
  now ??= await serverNow();
  await observeSave(player.id);
  const claims = await EventClaim.findAll({ where: { playerId: player.id } });
  const out = [];
  for (const def of EVENTS) {
    const w = await windowOf(def, now);
    const mine = await scoreRow(player.id, def.id, false);
    const points = mine?.points || 0;
    const top = await EventScore.findAll({ where: { eventId: def.id, points: { [Op.gt]: 0 } }, order: [['points', 'DESC'], ['id', 'ASC']], limit: 10 });
    const rank = points > 0 ? 1 + (await EventScore.count({ where: { eventId: def.id, points: { [Op.gt]: points } } })) : null;
    const claimable = w.state !== 'upcoming' && now < w.endsAt + CLAIM_GRACE_DAYS * DAY_MS;
    out.push({
      id: def.id, name: def.name, desc: def.desc, how: def.how, unit: def.unit, state: w.state, startsAt: w.startsAt, endsAt: w.endsAt,
      points, rank, players: await EventScore.count({ where: { eventId: def.id, points: { [Op.gt]: 0 } } }),
      tiers: def.tiers.map((t, i) => ({
        index: i, points: t.points, reward: t.reward, reached: points >= t.points,
        claimed: claims.some((c) => c.eventId === def.id && c.tier === i), claimable,
      })),
      top: top.map((r, i) => ({ rank: i + 1, username: r.username, points: r.points, you: r.playerId === player.id })),
    });
  }
  return { now, serverDay: await serverDay(now), events: out };
}

/** POST /events/claim { eventId, tier, baseVersion } -> reward goes into the save. */
export async function claim(player, body = {}) {
  const def = byId.get(String(body.eventId || ''));
  if (!def) throw httpError(404, 'unknown event', { code: 'no_event' });
  const tier = Number(body.tier);
  const t = def.tiers[tier];
  if (!Number.isInteger(tier) || !t) throw httpError(400, 'unknown reward tier', { code: 'bad_tier' });
  const now = await serverNow(), w = await windowOf(def, now);
  if (w.state === 'upcoming') throw httpError(409, 'this event has not started', { code: 'not_started' });
  if (now >= w.endsAt + CLAIM_GRACE_DAYS * DAY_MS) throw httpError(409, 'the rewards of this event expired', { code: 'expired' });
  await observeSave(player.id);
  const mine = await scoreRow(player.id, def.id, false);
  if (!mine || mine.points < t.points) throw httpError(409, `you need ${t.points} points for this reward`, { code: 'not_reached' });
  const row = await loadRow(player.id);
  staleCheck(row, body.baseVersion, 'claim');
  const res = addRes(resOf(row), t.reward);
  const version = await sequelize.transaction(async (tx) => {
    try { await EventClaim.create({ playerId: player.id, eventId: def.id, tier }, { transaction: tx }); }
    catch { throw httpError(409, 'you already took this reward', { code: 'claimed' }); }
    return writeRow(row, withState(row, null, res), tx);
  });
  return { reward: t.reward, save: { version, troops: troopsOf(row), resources: res } };
}
