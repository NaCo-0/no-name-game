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
  // search shows it, only for the same civ
  assert.equal((await api('GET', '/api/alliances?q=wol', c.token)).json.alliances[0].name, 'Wolves');
  const roman = await t.player('RomanGuy', 'rome');
  assert.equal((await api('GET', '/api/alliances', roman.token)).json.alliances.length, 0);
  assert.equal((await api('POST', '/api/alliance/join', roman.token, { allianceId: id })).json.error, 'other_culture');

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
  const c2 = await api('POST', '/api/rally', a.token, { targetType: 'camp', targetId: (await api('GET', '/api/alliance/targets', a.token)).json.camps[2].id, troops: { guard: 5 }, baseVersion: await ver(a) });
  assert.equal(c2.status, 200);
  const x = await api('POST', '/api/rally/cancel', a.token, { rallyId: c2.json.rally.id });
  assert.equal(x.json.rally.status, 'cancelled');
  const cl = await api('POST', '/api/rally/claim', a.token, { baseVersion: await ver(a) });
  assert.ok(cl.json.reports.some((q) => q.cancelled !== false && q.refund));
});

test('events: window = server days 1-3, camp wins and building levels score, tiers pay out once, leaderboard', async () => {
  const p = await t.player('EvHero'), q = await t.player('EvOther');
  // server day 1
  await clock.setServerStart(Date.now() - 1000);
  const e0 = (await api('GET', '/api/events', p.token)).json;
  assert.equal(e0.serverDay, 1);
  assert.equal(e0.events.length, 2);
  assert.ok(e0.events.every((e) => e.state === 'active'));

  // Grand Builder: baseline first, then +3 levels = 75 points
  await setSave(p, { buildings: [{ id: 'hq', level: 2 }, { id: 'farm', level: 1 }] });
  await api('GET', '/api/events', p.token);
  await setSave(p, { buildings: [{ id: 'hq', level: 4 }, { id: 'farm', level: 2 }] });
  const e1 = (await api('GET', '/api/events', p.token)).json.events.find((e) => e.id === 'grand_builder');
  assert.equal(e1.points, 75);

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
  await clock.setServerStart(Date.now() - 3 * 86400000 - 1000);
  const e3 = (await api('GET', '/api/events', p.token)).json;
  assert.equal(e3.serverDay, 4);
  assert.ok(e3.events.every((e) => e.state === 'ended'));
  const pts = e3.events.find((e) => e.id === 'bandit_hunter').points;
  const events = await import('../src/social/events.js');
  await events.record(p.id, 'camp_win', { level: 3 });
  assert.equal((await api('GET', '/api/events', p.token)).json.events.find((e) => e.id === 'bandit_hunter').points, pts);
});
