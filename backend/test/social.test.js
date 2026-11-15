import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, sleep } from './helpers.js';

let t, M, clock, RallyM;
before(async () => {
  process.env.SERVER_START_AT = '';
  t = await boot({ npc: { marchMinMs: 30, marchMsPerTile: 0, respawnMs: 60000 } });
  M = await import('../src/models.js');
  clock = await import('../src/social/clock.js');
  RallyM = await import('../src/social/models.js');
});
after(async () => { await t.close(); });

const api = (method, path, token, body) => t.call(method, path, { token, body });
// the server save: set troops directly (keeps the revision high enough to leave beginner protection)
async function setSave(p, { troops = {}, res = {}, buildings } = {}) {
  const row = await M.GameSave.findOne({ where: { playerId: p.id } });
  const data = { ...(row.data || {}), army: { troops: { persian: troops }, queue: {} }, resources: { persian: { food: 0, wood: 0, stone: 0, iron: 0, coin: 0, ...res } } };
  if (buildings) data.buildings = { persian: buildings };
  await row.update({ data, revision: Math.max(10, row.revision) });
  return (await row.reload()).revision;
}
const ver = async (p) => (await M.GameSave.findOne({ where: { playerId: p.id } })).revision;
const troopsNow = async (p) => (await M.GameSave.findOne({ where: { playerId: p.id } })).data.army.troops.persian;

test('alliance: create, validate names, join (open + request), roles, kick, leave, transfer, disband', async () => {
  const a = await t.player('AllyLead'), b = await t.player('AllyB'), c = await t.player('AllyC'), d = await t.player('AllyD');
  assert.equal((await api('POST', '/api/alliance', a.token, { name: 'x', tag: 'W' })).status, 400);
  assert.equal((await api('POST', '/api/alliance', a.token, { name: 'Wolves', tag: 'toolong' })).status, 400);
  const made = await api('POST', '/api/alliance', a.token, { name: 'Wolves', tag: 'wlf', description: 'hi' });
  assert.equal(made.status, 200);
  assert.equal(made.json.alliance.members[0].role, 'leader');
  assert.equal(made.json.alliance.tag, 'WLF'); // tags are stored in capitals
  assert.equal((await api('POST', '/api/alliance', b.token, { name: 'wolves', tag: 'ZZ' })).json.error, 'name_taken');
  assert.equal((await api('POST', '/api/alliance', b.token, { name: 'Other', tag: 'WLF' })).json.error, 'tag_taken');
  assert.equal((await api('POST', '/api/alliance', a.token, { name: 'Again', tag: 'AG' })).json.error, 'already_in');
  const id = made.json.alliance.id;

  // open join
  const j = await api('POST', '/api/alliance/join', b.token, { allianceId: id });
  assert.equal(j.json.joined, true);
  assert.equal(j.json.alliance.memberCount, 2);
  assert.equal((await api('POST', '/api/alliance/join', b.token, { allianceId: id })).json.error, 'already_in');
  // search shows it, for every civilization
  assert.equal((await api('GET', '/api/alliances?q=wol', c.token)).json.alliances[0].name, 'Wolves');
  const roman = await t.player('RomanGuy', 'rome');
  assert.equal((await api('GET', '/api/alliances', roman.token)).json.alliances.length, 1);
  assert.equal((await api('POST', '/api/alliance/join', roman.token, { allianceId: id })).json.joined, true);
  await api('POST', '/api/alliance/leave', roman.token, {});

  // request mode
  assert.equal((await api('POST', '/api/alliance/settings', b.token, { joinMode: 'request' })).json.error, 'not_allowed');
  assert.equal((await api('POST', '/api/alliance/settings', a.token, { joinMode: 'request' })).json.alliance.joinMode, 'request');
  const req = await api('POST', '/api/alliance/join', c.token, { allianceId: id });
  assert.equal(req.json.alliance, null);
  assert.deepEqual(req.json.requested, [id]);
  assert.equal((await api('GET', '/api/alliance', b.token)).json.alliance.requests, undefined); // plain members do not see requests
  assert.equal((await api('POST', '/api/alliance/answer', b.token, { playerId: c.id, accept: true })).json.error, 'not_allowed');
  assert.equal((await api('GET', '/api/alliance', a.token)).json.alliance.requests.length, 1);
  assert.equal((await api('POST', '/api/alliance/answer', a.token, { playerId: c.id, accept: true })).json.alliance.memberCount, 3);

  // roles
  assert.equal((await api('POST', '/api/alliance/role', a.token, { playerId: b.id, role: 'officer' })).status, 200);
  assert.equal((await api('POST', '/api/alliance/kick', b.token, { playerId: a.id })).json.error, 'not_allowed'); // cannot kick the leader
  assert.equal((await api('POST', '/api/alliance/leave', a.token)).json.error, 'leader_cannot_leave');
  assert.equal((await api('POST', '/api/alliance/kick', b.token, { playerId: c.id })).status, 200); // officer kicks member
  assert.equal((await api('GET', '/api/alliance', c.token)).json.alliance, null);
  // transfer, then the old leader (now officer) can leave
  assert.equal((await api('POST', '/api/alliance/transfer', a.token, { playerId: b.id })).status, 200);
  assert.equal((await api('GET', '/api/alliance', b.token)).json.alliance.you.role, 'leader');
  assert.equal((await api('POST', '/api/alliance/leave', a.token)).status, 200);
  assert.equal((await api('POST', '/api/alliance/disband', a.token)).json.error, 'no_alliance');
  assert.equal((await api('POST', '/api/alliance/disband', b.token)).status, 200);
  assert.equal(await RallyM.Alliance.count(), 0);
  void d;
});

test('alliance is full at MAX_MEMBERS', async () => {
  const { MAX_MEMBERS } = await import('../src/social/alliance.js');
  assert.ok(MAX_MEMBERS >= 2);
});

async function makeAlliance(names) {
  const ps = [];
  for (const n of names) ps.push(await t.player(n));
  const made = await api('POST', '/api/alliance', ps[0].token, { name: names[0] + ' Clan', tag: names[0].slice(0, 3) });
  assert.equal(made.status, 200);
  for (const p of ps.slice(1)) assert.equal((await api('POST', '/api/alliance/join', p.token, { allianceId: made.json.alliance.id })).status, 200);
  return { ps, id: made.json.alliance.id };
}

test('rally on a camp: donations leave the save, one combined battle, loot split by power, claim returns survivors', async () => {
  const { ps: [a, b, c] } = await makeAlliance(['RcA', 'RcB', 'RcC']);
  const out = await t.player('RcOut');
  await setSave(a, { troops: { guard: 300, elite_archer: 100 } });
  await setSave(b, { troops: { guard: 100 } });
  await setSave(c, { troops: { guard: 10 } });
  const camp = (await api('GET', '/api/alliance/targets', a.token)).json.camps[0];
  assert.ok(camp);

  // not in an alliance: nothing
  assert.equal((await api('POST', '/api/rally', out.token, { targetType: 'camp', targetId: camp.id, troops: { guard: 1 } })).json.error, 'no_alliance');
  // validation
  assert.equal((await api('POST', '/api/rally', a.token, { targetType: 'camp', targetId: camp.id, troops: { guard: 999 }, baseVersion: await ver(a) })).json.error, 'not_enough');
  assert.equal((await api('POST', '/api/rally', a.token, { targetType: 'camp', targetId: 'camp_nope', troops: { guard: 1 } })).json.error, 'no_camp');

  const r1 = await api('POST', '/api/rally', a.token, { targetType: 'camp', targetId: camp.id, troops: { guard: 300, elite_archer: 100 }, minutes: 30, baseVersion: await ver(a) });
  assert.equal(r1.status, 200, JSON.stringify(r1.json));
  assert.deepEqual(r1.json.save.troops, {}); // host's troops are in escrow
  assert.deepEqual(await troopsNow(a), {});
  const rallyId = r1.json.rally.id;
  assert.equal(r1.json.rally.status, 'gathering');
  assert.equal(r1.json.rally.donors, 1);
  // second rally by the same host / on the same target is refused
  assert.equal((await api('POST', '/api/rally', a.token, { targetType: 'camp', targetId: camp.id, troops: { guard: 1 } })).json.error, 'already_hosting');

  // b joins, c joins then withdraws
  const j = await api('POST', '/api/rally/join', b.token, { rallyId, troops: { guard: 100 }, baseVersion: await ver(b) });
  assert.equal(j.status, 200);
  assert.equal(j.json.rally.donors, 2);
  const jc = await api('POST', '/api/rally/join', c.token, { rallyId, troops: { guard: 10 }, baseVersion: await ver(c) });
  assert.equal(jc.json.rally.donors, 3);
  const lc = await api('POST', '/api/rally/leave', c.token, { rallyId, baseVersion: await ver(c) });
  assert.equal(lc.json.rally.donors, 2);
  assert.deepEqual(await troopsNow(c), { guard: 10 }); // got them back immediately
  // outsiders and the host cannot misuse it
  assert.equal((await api('POST', '/api/rally/join', out.token, { rallyId, troops: { guard: 1 } })).json.error, 'no_alliance');
  assert.equal((await api('POST', '/api/rally/leave', a.token, { rallyId })).json.error, 'host_cannot_leave');
  assert.equal((await api('POST', '/api/rally/launch', b.token, { rallyId })).json.error, 'not_allowed'); // plain member cannot launch

  const ws = t.socket(b.token); await ws.opened;
  const l = await api('POST', '/api/rally/launch', a.token, { rallyId });
  assert.equal(l.status, 200);
  assert.equal(l.json.rally.status, 'done');
  assert.equal(l.json.rally.report.win, true);
  await ws.waitFor((m) => m.type === 'rally' && m.phase === 'done');
  ws.close();

  // the camp is gone for everybody
  assert.ok(!(await api('GET', '/api/game/world', a.token)).json.camps.some((x) => x.id === camp.id));
  // claim: survivors + loot share
  const ca = await api('POST', '/api/rally/claim', a.token, { baseVersion: await ver(a) });
  const cb = await api('POST', '/api/rally/claim', b.token, { baseVersion: await ver(b) });
  assert.equal(ca.status, 200);
  assert.equal(ca.json.reports.length, 1);
  assert.equal(ca.json.reports[0].win, true);
  const lootA = Object.values(ca.json.reports[0].loot).reduce((x, y) => x + y, 0);
  const lootB = Object.values(cb.json.reports[0].loot).reduce((x, y) => x + y, 0);
  assert.ok(lootA > 0 && lootB > 0 && lootA > lootB, 'bigger contribution, bigger share');
  assert.equal(lootA + lootB, Object.values(camp.loot).reduce((x, y) => x + y, 0)); // nothing lost, nothing invented
  assert.ok(Object.values(ca.json.save.troops).reduce((x, y) => x + y, 0) > 0);
  assert.deepEqual((await api('POST', '/api/rally/claim', a.token, { baseVersion: ca.json.save.version })).json.reports, []); // only once
  // no double counting: survivors in the save == what the report says
  assert.deepEqual(await troopsNow(a), ca.json.reports[0].returned);

  // the rally is in everybody's battle reports (letters), with the whole fight and their own numbers
  for (const who of [a, b]) {
    const mails = (await api('GET', '/api/game/mail?kind=report', who.token)).json.mails;
    const m = mails.find((x) => x.data && x.data.source === 'rally');
    assert.ok(m, 'rally report mail');
    assert.equal(m.data.role, 'attacker');
    assert.equal(m.data.report.win, true);
    assert.ok(Array.isArray(m.data.report.log) && m.data.report.log.length > 0);
    assert.equal(m.data.report.rally.participants, 2);
  }
});

test('rally on a castle: attackers fight the real defender, defender loses troops/loot, allies and beginners are protected', async () => {
  const { ps: [a, b] } = await makeAlliance(['RkA', 'RkB']);
  const victim = await t.player('RkVictim');
  const ally = await t.player('RkAlly');
  const rookie = await t.player('RkRookie');
  await setSave(a, { troops: { guard: 300, cataphract: 40 } });
  await setSave(b, { troops: { guard: 300 } });
  await setSave(victim, { troops: { spearman: 30 }, res: { food: 10000, wood: 10000, coin: 10000 } });
  await setSave(ally, { troops: { guard: 5 } });
  const targets = (await api('GET', '/api/alliance/targets', a.token)).json;
  const vId = `u_${victim.id}`;
  assert.ok(targets.castles.some((c) => c.id === vId));
  assert.ok(!targets.castles.some((c) => c.id === `u_${a.id}` || c.id === `u_${b.id}`)); // never your own alliance
  assert.equal(targets.castles.find((c) => c.id === `u_${rookie.id}`).protected, true);

  assert.equal((await api('POST', '/api/rally', a.token, { targetType: 'castle', targetId: `u_${rookie.id}`, troops: { guard: 10 } })).json.error, 'protected');
  assert.equal((await api('POST', '/api/rally', a.token, { targetType: 'castle', targetId: `u_${b.id}`, troops: { guard: 10 } })).json.error, 'ally_castle');
  const r = await api('POST', '/api/rally', a.token, { targetType: 'castle', targetId: vId, troops: { guard: 300, cataphract: 40 }, baseVersion: await ver(a) });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  await api('POST', '/api/rally/join', b.token, { rallyId: r.json.rally.id, troops: { guard: 300 }, baseVersion: await ver(b) });

  const ws = t.socket(victim.token); await ws.opened;
  const l = await api('POST', '/api/rally/launch', a.token, { rallyId: r.json.rally.id });
  assert.equal(l.json.rally.status, 'done');
  assert.equal(l.json.rally.report.win, true);
  const hit = await ws.waitFor((m) => m.type === 'attacked');
  assert.equal(hit.win, false);
  ws.close();
  const vs = (await M.GameSave.findOne({ where: { playerId: victim.id } })).data;
  assert.ok(vs.resources.persian.food < 10000, 'victim was looted');
  assert.equal(vs.resources.persian.coin, 10000 - (l.json.rally.report.loot.coin || 0));
  const ca = await api('POST', '/api/rally/claim', a.token, { baseVersion: await ver(a) });
  const cb = await api('POST', '/api/rally/claim', b.token, { baseVersion: await ver(b) });
  const total = (o) => Object.values(o).reduce((x, y) => x + y, 0);
  assert.equal(total(ca.json.reports[0].loot) + total(cb.json.reports[0].loot), total(l.json.rally.report.loot));
  assert.ok(total(ca.json.reports[0].returned) + total(cb.json.reports[0].returned) + total(l.json.rally.report.dead) === 300 + 40 + 300);
});

test('rally: timer launches it by itself (ticker); cancel / leaving the alliance refund troops', async () => {
  const { ps: [a, b] } = await makeAlliance(['RtA', 'RtB']);
  await setSave(a, { troops: { guard: 50 } });
  await setSave(b, { troops: { guard: 50 } });
  const camp = (await api('GET', '/api/alliance/targets', a.token)).json.camps[1];
  const r = await api('POST', '/api/rally', a.token, { targetType: 'camp', targetId: camp.id, troops: { guard: 50 }, baseVersion: await ver(a) });
  const rallyId = r.json.rally.id;
  await api('POST', '/api/rally/join', b.token, { rallyId, troops: { guard: 20 }, baseVersion: await ver(b) });
  // b quits the alliance while gathering -> their 20 guards come back through claim, and are NOT in the army
  assert.equal((await api('POST', '/api/alliance/leave', b.token)).status, 200);
  assert.equal((await api('GET', '/api/alliance/rallies', a.token)).json.rallies[0].donors, 1);
  const cb = await api('POST', '/api/rally/claim', b.token, { baseVersion: await ver(b) });
  assert.equal(cb.json.reports[0].reason, 'left_alliance');
  assert.deepEqual(await troopsNow(b), { guard: 50 });

  // timer: make it due and let the 1s ticker (or an explicit tick) resolve it
  await RallyM.Rally.update({ launchAt: Date.now() - 1 }, { where: { id: rallyId } });
  t.world.startTicker(50);
  await sleep(400);
  assert.equal((await RallyM.Rally.findByPk(rallyId)).status, 'done');

  // cancel refunds everybody
  await api('POST', '/api/rally/claim', a.token, { baseVersion: await ver(a) });
  await setSave(a, { troops: { guard: 50 } }); // the random camp may have killed the guards: the test is about refunds, not about this fight
  const c2 = await api('POST', '/api/rally', a.token, { targetType: 'camp', targetId: (await api('GET', '/api/alliance/targets', a.token)).json.camps[2].id, troops: { guard: 5 }, baseVersion: await ver(a) });
  assert.equal(c2.status, 200);
  const x = await api('POST', '/api/rally/cancel', a.token, { rallyId: c2.json.rally.id });
  assert.equal(x.json.rally.status, 'cancelled');
  const cl = await api('POST', '/api/rally/claim', a.token, { baseVersion: await ver(a) });
  assert.ok(cl.json.reports.some((q) => q.cancelled !== false && q.refund));
});

test('events: builder on day 2, hunter on day 3 (admin can move the clock), camp wins and building levels score, tiers pay out once, leaderboard', async () => {
  const p = await t.player('EvHero'), q = await t.player('EvOther');
  const H = 3600 * 1000;
  // server day 1: both events are still to come
  await clock.setServerStart(Date.now() - 1000);
  await clock.setTimeOffset(0);
  const e0 = (await api('GET', '/api/events', p.token)).json;
  assert.equal(e0.serverDay, 1);
  assert.equal(e0.events.length, 2);
  assert.ok(e0.events.every((e) => e.state === 'upcoming'));
  assert.equal(e0.events.find((e) => e.id === 'grand_builder').startsAt - e0.events.find((e) => e.id === 'grand_builder').endsAt, -24 * H);
  assert.equal((await api('POST', '/api/events/claim', p.token, { eventId: 'grand_builder', tier: 0 })).json.error, 'not_started');

  // 24h after the server start: Grand Builder is live, Bandit Hunter waits for the next day
  await clock.setTimeOffset(24 * H);
  const e0b = (await api('GET', '/api/events', p.token)).json;
  assert.equal(e0b.serverDay, 2);
  assert.equal(e0b.events.find((e) => e.id === 'grand_builder').state, 'active');
  assert.equal(e0b.events.find((e) => e.id === 'bandit_hunter').state, 'upcoming');

  // Grand Builder: baseline first, then +3 levels = 75 points
  await setSave(p, { buildings: [{ id: 'hq', level: 2 }, { id: 'farm', level: 1 }] });
  await api('GET', '/api/events', p.token);
  await setSave(p, { buildings: [{ id: 'hq', level: 4 }, { id: 'farm', level: 2 }] });
  const e1 = (await api('GET', '/api/events', p.token)).json.events.find((e) => e.id === 'grand_builder');
  assert.equal(e1.points, 75);

  // next day: Grand Builder is over, Bandit Hunter starts
  await clock.setTimeOffset(48 * H + 1000);
  const eb = (await api('GET', '/api/events', p.token)).json.events;
  assert.equal(eb.find((e) => e.id === 'grand_builder').state, 'ended');
  assert.equal(eb.find((e) => e.id === 'bandit_hunter').state, 'active');
  assert.equal(eb.find((e) => e.id === 'grand_builder').points, 75);

  // Bandit Hunter: win a camp through a normal expedition
  const world = (await api('GET', '/api/game/world', p.token)).json;
  const camp = world.camps.find((c) => c.level === 1) || world.camps[0];
  const v = await setSave(p, { troops: { guard: 400, elite_archer: 200 } });
  const at = await api('POST', '/api/game/attack', p.token, { campId: camp.id, troops: { guard: 400, elite_archer: 200 }, baseVersion: v });
  assert.equal(at.status, 201);
  await sleep(300);
  await api('POST', '/api/game/expeditions/claim', p.token, { baseVersion: at.json.save.version });
  const e2 = (await api('GET', '/api/events', p.token)).json.events.find((e) => e.id === 'bandit_hunter');
  assert.ok(e2.points >= 10, `points ${e2.points}`);
  assert.ok(e2.rank >= 1);
  assert.ok(e2.top.some((u) => u.username === 'EvHero' && u.you));
  assert.ok(e2.top.every((u, i) => i === 0 || e2.top[i - 1].points >= u.points)); // sorted
  assert.equal((await api('GET', '/api/events', q.token)).json.events[0].rank, null);

  // claim a tier: needs the points, pays once, goes into the save
  const tier = e2.tiers.findIndex((x) => x.points <= e2.points);
  if (tier >= 0) {
    const before = (await M.GameSave.findOne({ where: { playerId: p.id } }));
    const c = await api('POST', '/api/events/claim', p.token, { eventId: 'bandit_hunter', tier, baseVersion: before.revision });
    assert.equal(c.status, 200, JSON.stringify(c.json));
    assert.ok(Object.keys(c.json.reward).length > 0);
    assert.equal((await api('POST', '/api/events/claim', p.token, { eventId: 'bandit_hunter', tier, baseVersion: c.json.save.version })).json.error, 'claimed');
  }
  assert.equal((await api('POST', '/api/events/claim', p.token, { eventId: 'bandit_hunter', tier: 3 })).json.error, 'not_reached');
  assert.equal((await api('POST', '/api/events/claim', p.token, { eventId: 'nope', tier: 0 })).status, 404);

  // after day 3 the event is over: no more points
  await clock.setTimeOffset(72 * H + 1000);
  const e3 = (await api('GET', '/api/events', p.token)).json;
  assert.equal(e3.serverDay, 4);
  assert.ok(e3.events.every((e) => e.state === 'ended'));
  const pts = e3.events.find((e) => e.id === 'bandit_hunter').points;
  const events = await import('../src/social/events.js');
  await events.record(p.id, 'camp_win', { level: 3 });
  assert.equal((await api('GET', '/api/events', p.token)).json.events.find((e) => e.id === 'bandit_hunter').points, pts);
  await clock.setTimeOffset(0);
});

test('war elephant: opens on day 5, one hunt per 4-day cycle, enhance, rally damage without losses, rewards after 30 minutes', async () => {
  const H = 3600 * 1000;
  const a = await t.player('EleLead'), b = await t.player('EleB'), c = await t.player('EleOut');
  const al = (await api('POST', '/api/alliance', a.token, { name: 'Elephants', tag: 'ELE' })).json.alliance;
  await api('POST', '/api/alliance/join', b.token, { allianceId: al.id });
  await setSave(a, { troops: { spearman: 300, archer: 100, cavalry: 100 }, res: { wood: 5000, iron: 2000 } });
  await setSave(b, { troops: { spearman: 200 } });
  await clock.setServerStart(Date.now() - 1000);

  // before day 5: locked
  await clock.setTimeOffset(0);
  let s = (await api('GET', '/api/alliance/elephant', a.token)).json.elephant;
  assert.equal(s.state, 'locked');
  assert.equal((await api('POST', '/api/alliance/elephant/start', a.token, { minutes: 0 })).json.error, 'locked');
  assert.equal((await api('GET', '/api/alliance/elephant', c.token)).json.elephant.available, false); // no alliance

  // server day 5 (hour 96): open
  await clock.setTimeOffset(96 * H);
  s = (await api('GET', '/api/alliance/elephant', a.token)).json.elephant;
  assert.equal(s.state, 'idle');
  assert.equal(s.cycle.number, 1);
  assert.equal(s.canManage, true);
  assert.equal((await api('GET', '/api/alliance/elephant', b.token)).json.elephant.canManage, false);
  assert.equal((await api('POST', '/api/alliance/elephant/start', b.token, { minutes: 0 })).json.error, 'not_allowed');

  // enhance the trap: resources leave the save, points count (iron counts double)
  assert.equal((await api('POST', '/api/alliance/elephant/donate', a.token, { resources: { wood: 99999 }, baseVersion: await ver(a) })).json.error, 'not_enough');
  const d = await api('POST', '/api/alliance/elephant/donate', a.token, { resources: { wood: 1000, iron: 250 }, baseVersion: await ver(a) });
  assert.equal(d.status, 200);
  assert.equal(d.json.elephant.hunt.trap.points, 1500);
  assert.equal(d.json.elephant.hunt.trap.level, 1); // 1500 points = level 1 for a small alliance
  assert.equal(d.json.save.resources.wood, 4000);

  // no rally before the hunt is on
  assert.equal((await api('POST', '/api/rally', a.token, { targetType: 'elephant', troops: { spearman: 10 }, minutes: 1, baseVersion: await ver(a) })).json.error, 'no_hunt');

  // activate now
  const st = await api('POST', '/api/alliance/elephant/start', a.token, { minutes: 0 });
  assert.equal(st.json.elephant.state, 'active');
  assert.ok(st.json.elephant.hunt.msLeft > 29 * 60000);
  assert.ok(st.json.elephant.hunt.pool >= 4000);
  assert.equal((await api('POST', '/api/alliance/elephant/start', a.token, { minutes: 0 })).json.error, 'already_used');
  assert.equal((await api('POST', '/api/alliance/elephant/donate', a.token, { resources: { wood: 10 }, baseVersion: await ver(a) })).json.error, 'trap_busy');

  // rally on the elephant: two members, one battle-free hit, nobody loses a soldier
  const rl = await api('POST', '/api/rally', a.token, { targetType: 'elephant', troops: { spearman: 300, archer: 100 }, minutes: 5, baseVersion: await ver(a) });
  assert.equal(rl.status, 200);
  assert.equal(rl.json.rally.target.type, 'elephant');
  assert.equal((await api('POST', '/api/rally/join', b.token, { rallyId: rl.json.rally.id, troops: { spearman: 200 }, baseVersion: await ver(b) })).status, 200);
  const lch = await api('POST', '/api/rally/launch', a.token, { rallyId: rl.json.rally.id });
  assert.equal(lch.status, 200);
  assert.equal(lch.json.rally.status, 'done');
  const e1 = lch.json.rally.report.elephant;
  assert.ok(e1.total > 0);
  assert.equal(e1.rallyBonus, 4);  // 2 members: +4%
  assert.equal(e1.trapBonus, 5);   // trap level 1: +5%
  assert.ok(e1.byClass.spear > 0 && e1.byClass.archer > 0);

  const ca = await api('POST', '/api/rally/claim', a.token, { baseVersion: await ver(a) });
  assert.equal(ca.status, 200);
  assert.equal(ca.json.save.troops.spearman, 300); // everyone gets everything back
  assert.equal(ca.json.save.troops.archer, 100);
  await api('POST', '/api/rally/claim', b.token, { baseVersion: await ver(b) });
  assert.equal((await troopsNow(b)).spearman, 200);

  // spears hit harder than horses (per power)
  const pu = (await import('../src/battleConfig.js')).unitPower;
  const el = await import('../src/social/elephant.js');
  assert.ok(el.troopDamage({ spearman: 10 }) / (10 * pu('spearman')) > el.troopDamage({ cavalry: 10 }) / (10 * pu('cavalry')));

  // the rally is in both battle reports
  for (const who of [a, b]) {
    const mails = (await api('GET', '/api/game/mail?kind=report', who.token)).json.mails;
    const m = mails.find((x) => x.data && x.data.target === 'elephant');
    assert.ok(m, 'elephant report');
    assert.ok(m.data.report.elephant.damage > 0);
  }

  // standings
  s = (await api('GET', '/api/alliance/elephant', b.token)).json.elephant;
  assert.equal(s.hunt.damage, e1.total);
  assert.equal(s.hunt.top.length, 2);
  assert.equal(s.hunt.top[0].username, 'EleLead');
  assert.equal(s.hunt.me.hits, 1);
  assert.ok([1, 2, 3].includes(s.hunt.phase));

  // time is up: rewards are computed and can be claimed once
  const hunt = await RallyM.ElephantHunt.findByPk(s.hunt.id);
  await hunt.update({ endsAt: Date.now() - 10 });
  await sleep(2200);
  s = (await api('GET', '/api/alliance/elephant', a.token)).json.elephant;
  assert.equal(s.state, 'ended');
  assert.ok(s.hunt.me.reward && s.hunt.me.reward.total.wood > 0);
  assert.ok(s.pending.count >= 1);
  const before = (await M.GameSave.findOne({ where: { playerId: a.id } })).data.resources.persian;
  const cl = await api('POST', '/api/alliance/elephant/claim', a.token, { baseVersion: await ver(a) });
  assert.equal(cl.status, 200);
  assert.ok(cl.json.save.resources.wood > before.wood);
  assert.equal((await api('POST', '/api/alliance/elephant/claim', a.token, { baseVersion: await ver(a) })).json.rewards.length, 0);
  assert.equal((await api('GET', '/api/alliance/elephant', a.token)).json.elephant.pending.count, 0);

  // same cycle: no second hunt. 4 days later (cycle 2): available again, can be scheduled and cancelled
  assert.equal((await api('POST', '/api/alliance/elephant/start', a.token, { minutes: 0 })).json.error, 'already_used');
  await clock.setTimeOffset(200 * H); // hour 192 starts cycle 2
  s = (await api('GET', '/api/alliance/elephant', a.token)).json.elephant;
  assert.equal(s.cycle.number, 2);
  assert.equal(s.state, 'idle');
  const sc = await api('POST', '/api/alliance/elephant/start', a.token, { minutes: 30 });
  assert.equal(sc.json.elephant.state, 'scheduled');
  assert.ok(sc.json.elephant.hunt.msToStart > 29 * 60000);
  assert.equal((await api('POST', '/api/alliance/elephant/cancel', a.token)).json.elephant.state, 'idle');

  // after day 31 the season is over
  await clock.setTimeOffset(31 * 24 * H + 1000);
  assert.equal((await api('GET', '/api/alliance/elephant', a.token)).json.elephant.state, 'over');
  await clock.setTimeOffset(0);
});

test('province conquest: opens day 7 08:00, two adjacent provinces every 30 min for 1 hour, rallies take and swap the tower, most points wins', async () => {
  const H = 3600 * 1000, MIN = 60000;
  const Q = await import('../src/social/conquest.js');
  // pairing: every pair is adjacent on the lattice, all 15 are covered once, 7 pairs + 1 alone
  const provs = Array.from({ length: 15 }, (_, i) => { const row = Math.floor(i / 5), col = i % 5, nb = []; if (col > 0) nb.push(i - 1); if (col < 4) nb.push(i + 1); if (row > 0) nb.push(i - 5); if (row < 2) nb.push(i + 5); return { id: i, local: i, neighbors: nb }; });
  const groups = Q.groupsFor(provs);
  assert.equal(groups.length, 8);
  assert.deepEqual(groups.flat().sort((a, b) => a - b), provs.map((p) => p.id));
  assert.equal(groups.filter((g) => g.length === 2).length, 7);
  for (const g of groups.filter((x) => x.length === 2)) assert.ok(provs[g[0]].neighbors.includes(g[1]), 'pair touches');

  const a = await t.player('ConqA'), b = await t.player('ConqB');
  const alA = (await api('POST', '/api/alliance', a.token, { name: 'Alpha Conq', tag: 'AAA' })).json.alliance;
  await api('POST', '/api/alliance', b.token, { name: 'Beta Conq', tag: 'BBB' });
  const troops = { spearman: 1500, archer: 800 };
  await setSave(a, { troops }); await setSave(b, { troops });
  await clock.setServerStart(Date.now() - 1000);
  const hit = async (who, id) => {
    await setSave(who, { troops }); // fresh army for every hit (the garrison kills some)
    const rl = await api('POST', '/api/rally', who.token, { targetType: 'province', targetId: id, troops, minutes: 1, baseVersion: await ver(who) });
    if (rl.status !== 200) return rl;
    const lch = await api('POST', '/api/rally/launch', who.token, { rallyId: rl.json.rally.id });
    await api('POST', '/api/rally/claim', who.token, { baseVersion: await ver(who) });
    return lch;
  };
  const conquest = async (who = a) => (await api('GET', '/api/conquest', who.token)).json.conquest;

  // before the event
  await clock.setTimeOffset(0);
  let c = await conquest();
  assert.equal(c.event.state, 'upcoming');
  assert.equal(c.provinces.length, 15);
  assert.ok(c.provinces.every((p) => p.state === 'closed'));
  assert.equal((await hit(a, 0)).json.error, 'not_open');

  // server day 7, 08:00 (hour 152): the first pair of the biome is open
  await clock.setTimeOffset(152 * H + 1000);
  c = await conquest();
  assert.equal(c.event.state, 'live');
  const open = c.provinces.filter((p) => p.state === 'open');
  assert.equal(open.length, 2);
  assert.equal(open[0].partner, open[1].id);
  assert.equal(open[0].slot, 0);
  const tower = open[0].id, later = c.provinces.find((p) => p.slot === 1).id;
  assert.equal((await hit(a, later)).json.error, 'not_open'); // the next pair opens half an hour later

  // A takes the tower, B takes it from A, A takes it back; nobody can rally a tower they already hold
  const w1 = await hit(a, tower);
  assert.equal(w1.status, 200);
  assert.equal(w1.json.rally.report.win, true);
  assert.equal(w1.json.rally.report.province.captured, true);
  c = await conquest();
  assert.equal(c.provinces.find((p) => p.id === tower).holder.tag, 'AAA');
  assert.equal((await hit(a, tower)).json.error, 'already_holder');
  await sleep(1200);
  assert.equal((await hit(b, tower)).status, 200);
  assert.equal((await conquest()).provinces.find((p) => p.id === tower).holder.tag, 'BBB');
  await sleep(1200);
  assert.equal((await hit(a, tower)).status, 200);
  c = await conquest();
  const T = c.provinces.find((p) => p.id === tower);
  assert.equal(T.holder.tag, 'AAA');
  assert.equal(T.captures, 3);
  assert.equal(T.top[0].tag, 'AAA'); // 2 captures + holding time
  assert.ok(T.top[0].points >= 600 && T.top[1].points >= 300 && T.top[1].points < 600);
  assert.equal(T.myPoints, T.top[0].points);

  // the rally is in the battle reports, like any rally
  const mails = (await api('GET', '/api/game/mail?kind=report', a.token)).json.mails;
  assert.ok(mails.some((x) => x.data && x.data.source === 'rally' && x.data.castleName === `Prov ${tower} tower`));

  // 30 minutes later the next pair opens too (two windows overlap)
  await clock.setTimeOffset(152 * H + 31 * MIN);
  c = await conquest();
  assert.equal(c.provinces.filter((p) => p.state === 'open').length, 4);

  // the hour is over: the province goes to the alliance with the most points of that tower
  await clock.setTimeOffset(152 * H + 61 * MIN);
  await sleep(2200);
  c = await conquest();
  const done = c.provinces.find((p) => p.id === tower);
  assert.equal(done.state, 'done');
  assert.equal(done.owner.tag, 'AAA');
  assert.equal(done.owner.allianceId, alA.id);
  assert.equal(c.provinces.filter((p) => p.state === 'open').length, 4); // slots 1 and 2 are open (a new pair every 30 minutes)
  assert.equal((await hit(b, tower)).json.error, 'closed');
  // untouched provinces just stay NPC
  assert.equal(c.provinces.find((p) => p.id === open[1].id).owner, null);

  // the whole event: 8 slots, the last one ends at 12:30
  await clock.setTimeOffset(152 * H + 5 * H);
  assert.equal((await conquest()).event.state, 'over');
  await clock.setTimeOffset(0);
});
