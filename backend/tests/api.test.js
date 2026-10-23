import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.js';

let t;
before(async () => { t = await boot(); });
after(async () => { await t.close(); });

const goodSave = () => ({
  buildings: { persian: [{ id: 'hall', level: 3, stored: 4.5, readyAt: 0, x: 10, y: 20, produces: 'food' }] },
  resources: { persian: { food: 10, wood: 20, stone: 30, iron: 40, coin: 50 } },
  army: { troops: { persian: { spear1: 5 } }, queue: { persian: [{ id: 'a_1', troopId: 'spear1', count: 2, endsAt: 1900000000000 }] } },
  marches: [{ id: 1, x: 1, y: 2, timeLeft: 5 }],
  settings: { sound: false },
});

const joinAs = async (name, civId = 'persia') => {
  const r = await t.register(name);
  await t.call('POST', '/api/game/join', { token: r.token, body: { civId } });
  return r;
};

// ---------- accounts ----------
test('register validates username and password', async () => {
  assert.equal((await t.call('POST', '/api/auth/register', { body: { username: 'a', password: 'password123' } })).status, 400);
  assert.equal((await t.call('POST', '/api/auth/register', { body: { username: 'bad name!', password: 'password123' } })).status, 400);
  assert.equal((await t.call('POST', '/api/auth/register', { body: { username: 'okname', password: 'short' } })).status, 400);
  assert.equal((await t.call('POST', '/api/auth/register', { body: {} })).status, 400);
});

test('register + login + me + logout', async () => {
  const r = await t.register('Hosein');
  assert.ok(r.token && r.user.username === 'Hosein');
  assert.equal((await t.call('GET', '/api/auth/me', { token: r.token })).json.culture, null);

  const l = await t.call('POST', '/api/auth/login', { body: { username: 'hosein', password: 'password123' } }); // case-insensitive
  assert.equal(l.status, 200);
  assert.equal((await t.call('POST', '/api/auth/logout', { token: l.json.token })).status, 200);
  assert.equal((await t.call('GET', '/api/auth/me', { token: l.json.token })).status, 401);
  assert.equal((await t.call('GET', '/api/auth/me', { token: r.token })).status, 200); // other session still alive
});

test('username is unique, case-insensitive', async () => {
  await t.register('Sara');
  const dup = await t.call('POST', '/api/auth/register', { body: { username: 'SARA', password: 'password123' } });
  assert.equal(dup.status, 409);
});

test('wrong password / unknown user give the same 401, and are rate limited', async () => {
  await t.register('Limited');
  const a = await t.call('POST', '/api/auth/login', { body: { username: 'Limited', password: 'nope-nope-nope' } });
  const b = await t.call('POST', '/api/auth/login', { body: { username: 'ghost', password: 'nope-nope-nope' } });
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.equal(a.json.error, b.json.error);
  for (let i = 0; i < 8; i++) await t.call('POST', '/api/auth/login', { body: { username: 'Limited', password: 'bad-bad-bad' } });
  assert.equal((await t.call('POST', '/api/auth/login', { body: { username: 'Limited', password: 'password123' } })).status, 429);
});

test('passwords and tokens are stored hashed', async () => {
  const r = await t.register('Hashy', 'my-secret-pass');
  const u = await t.db.models.User.findOne({ where: { usernameKey: 'hashy' } });
  assert.ok(u.passwordHash.startsWith('scrypt$'));
  assert.ok(!u.passwordHash.includes('my-secret-pass'));
  assert.equal(await t.db.models.AuthToken.count({ where: { tokenHash: r.token } }), 0);
});

test('protected endpoints need a token', async () => {
  for (const [m, p] of [['GET', '/api/game/save'], ['PUT', '/api/game/save'], ['POST', '/api/game/join'], ['GET', '/api/game/world']]) {
    assert.equal((await t.call(m, p, { body: m === 'GET' ? undefined : {} })).status, 401, `${m} ${p}`);
  }
  assert.equal((await t.call('GET', '/api/game/save', { token: 'x'.repeat(64) })).status, 401);
});

// ---------- civilization is chosen once ----------
test('join: civilization is chosen once and cannot be switched', async () => {
  const r = await t.register('Chooser');
  assert.equal((await t.call('POST', '/api/game/join', { token: r.token, body: {} })).status, 400);
  assert.equal((await t.call('POST', '/api/game/join', { token: r.token, body: { civId: 'atlantis' } })).status, 400);

  const j1 = await t.call('POST', '/api/game/join', { token: r.token, body: { civId: 'rome' } });
  assert.equal(j1.status, 200);
  assert.equal(j1.json.you.civId, 'rome');
  assert.equal(j1.json.returning, false);
  assert.equal(j1.json.save.culture, 'roman');

  const j2 = await t.call('POST', '/api/game/join', { token: r.token, body: { civId: 'viking' } }); // tries to switch
  assert.equal(j2.json.you.civId, 'rome');
  assert.equal(j2.json.returning, true);
  assert.equal(j2.json.you.tileX, j1.json.you.tileX);
  assert.equal(j2.json.save.culture, 'roman');
  assert.equal(await t.db.models.Castle.count({ where: { key: j1.json.you.id } }), 1);
});

test('join: two players never get the same spot; NPC castles are in the list', async () => {
  const a = await t.register('SpotA');
  const b = await t.register('SpotB');
  const ja = (await t.call('POST', '/api/game/join', { token: a.token, body: { civId: 'persia' } })).json;
  const jb = (await t.call('POST', '/api/game/join', { token: b.token, body: { civId: 'persia' } })).json;
  assert.notDeepEqual([ja.you.tileX, ja.you.tileY], [jb.you.tileX, jb.you.tileY]);
  assert.ok(jb.castles.some((c) => c.id.startsWith('npc_')));
  assert.ok(jb.castles.some((c) => c.id === ja.you.id));
});

test('join: concurrent joins are placed one by one (no duplicate spots)', async () => {
  const users = await Promise.all(Array.from({ length: 6 }, (_, i) => t.register('Conc' + i)));
  const res = await Promise.all(users.map((u) => t.call('POST', '/api/game/join', { token: u.token, body: { civId: 'mongol' } })));
  const spots = res.map((r) => `${r.json.you.tileX},${r.json.you.tileY}`);
  assert.equal(new Set(spots).size, 6);
});

// ---------- save ----------
test('save: cannot save before choosing a civilization', async () => {
  const r = await t.register('NoCiv');
  assert.equal((await t.call('PUT', '/api/game/save', { token: r.token, body: goodSave() })).status, 409);
});

test('save: everything round-trips (buildings, resources, army, marches, settings)', async () => {
  const r = await joinAs('Saver');
  const first = (await t.call('GET', '/api/game/save', { token: r.token })).json.save;
  assert.equal(first.buildings, null);
  assert.equal(first.version, 0);

  const put = await t.call('PUT', '/api/game/save', { token: r.token, body: { ...goodSave(), baseVersion: 0 } });
  assert.equal(put.status, 200);
  assert.equal(put.json.version, 1);

  const got = (await t.call('GET', '/api/game/save', { token: r.token })).json.save;
  assert.equal(got.version, 1);
  assert.equal(got.culture, 'persian');
  assert.deepEqual(got.buildings.persian[0], goodSave().buildings.persian[0]);
  assert.deepEqual(got.resources, goodSave().resources);
  assert.deepEqual(got.army, goodSave().army);
  assert.deepEqual(got.marches, goodSave().marches);
  assert.deepEqual(got.settings, { sound: false });

  // progress survives a new login (another device)
  const l = (await t.call('POST', '/api/auth/login', { body: { username: 'Saver', password: 'password123' } })).json;
  assert.deepEqual((await t.call('GET', '/api/game/save', { token: l.token })).json.save.resources, goodSave().resources);
});

test('save: a partial save only changes the parts that were sent', async () => {
  const r = await joinAs('Partial');
  await t.call('PUT', '/api/game/save', { token: r.token, body: goodSave() });
  await t.call('PUT', '/api/game/save', { token: r.token, body: { settings: { sound: true } } });
  const s = (await t.call('GET', '/api/game/save', { token: r.token })).json.save;
  assert.deepEqual(s.settings, { sound: true });
  assert.deepEqual(s.resources, goodSave().resources);
});

test('save: the client cannot change its civilization through a save', async () => {
  const r = await joinAs('Sneaky');
  await t.call('PUT', '/api/game/save', { token: r.token, body: { ...goodSave(), culture: 'viking' } });
  assert.equal((await t.call('GET', '/api/game/save', { token: r.token })).json.save.culture, 'persian');
});

test('save: a player can only save data for their own civilization', async () => {
  const r = await joinAs('OwnOnly', 'persia');
  const foreign = await t.call('PUT', '/api/game/save', { token: r.token, body: { resources: { roman: { food: 1, wood: 1, stone: 1, iron: 1, coin: 1 } } } });
  assert.equal(foreign.status, 403);
  const mixed = await t.call('PUT', '/api/game/save', { token: r.token, body: { ...goodSave(), army: { troops: { viking: { x: 1 } }, queue: {} } } });
  assert.equal(mixed.status, 403);
  assert.equal((await t.call('GET', '/api/game/save', { token: r.token })).json.save.version, 0);
});

test('save: an old tab cannot overwrite newer progress (version check)', async () => {
  const r = await joinAs('TwoTabs');
  assert.equal((await t.call('PUT', '/api/game/save', { token: r.token, body: { ...goodSave(), baseVersion: 0 } })).status, 200);
  const stale = await t.call('PUT', '/api/game/save', { token: r.token, body: { ...goodSave(), baseVersion: 0 } });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.code, 'stale');
  assert.equal(stale.json.version, 1);
});

test('save: accounts are separated (nobody reads another player\'s save)', async () => {
  const a = await joinAs('IsoA', 'persia');
  const b = await joinAs('IsoB', 'rome');
  await t.call('PUT', '/api/game/save', { token: a.token, body: goodSave() });
  const sb = (await t.call('GET', '/api/game/save', { token: b.token })).json.save;
  assert.equal(sb.resources, null);
  assert.equal(sb.culture, 'roman');
});

test('save: bad data is rejected and nothing is written', async () => {
  const r = await joinAs('Bad');
  const cases = {
    'negative resource': { resources: { persian: { food: -1, wood: 0, stone: 0, iron: 0, coin: 0 } } },
    'string resource': { resources: { persian: { food: '99', wood: 0, stone: 0, iron: 0, coin: 0 } } },
    'huge resource': { resources: { persian: { food: 1e15, wood: 0, stone: 0, iron: 0, coin: 0 } } },
    'unknown culture': { resources: { atlantis: { food: 1, wood: 1, stone: 1, iron: 1, coin: 1 } } },
    'level 0': { buildings: { persian: [{ id: 'hall', level: 0 }] } },
    'building without id': { buildings: { persian: [{ level: 1 }] } },
    'too many buildings': { buildings: { persian: Array.from({ length: 81 }, (_, i) => ({ id: 'b' + i, level: 1 })) } },
    'negative troop count': { army: { troops: { persian: { spear1: -3 } }, queue: {} } },
    'zero-count queue job': { army: { troops: {}, queue: { persian: [{ id: 'x', troopId: 'y', count: 0, endsAt: 1 }] } } },
    'marches not a list': { marches: { a: 1 } },
    'body is a list': [1, 2, 3],
  };
  for (const [name, body] of Object.entries(cases)) {
    const res = await t.call('PUT', '/api/game/save', { token: r.token, body });
    assert.equal(res.status, 400, name);
  }
  const s = (await t.call('GET', '/api/game/save', { token: r.token })).json.save;
  assert.equal(s.version, 0);
  assert.equal(s.resources, null);
});

test('save: nested junk inside a building is dropped, not stored', async () => {
  const r = await joinAs('Nested');
  await t.call('PUT', '/api/game/save', { token: r.token, body: { buildings: { persian: [{ id: 'hall', level: 2, evil: { deep: { x: 1 } }, list: [1, 2] }] } } });
  const b = (await t.call('GET', '/api/game/save', { token: r.token })).json.save.buildings.persian[0];
  assert.equal(b.evil, undefined);
  assert.equal(b.list, undefined);
  assert.equal(b.level, 2);
});

test('save: oversized and malformed bodies are refused', async () => {
  const r = await joinAs('Huge');
  assert.equal((await t.call('PUT', '/api/game/save', { token: r.token, body: {}, raw: '{"settings":' + ' '.repeat(600 * 1024) + '{}}' })).status, 413);
  assert.equal((await t.call('PUT', '/api/game/save', { token: r.token, body: {}, raw: '{not json' })).status, 400);
});

test('save: sendBeacon style (POST, text/plain, token in the query) works', async () => {
  const r = await joinAs('Beacon');
  const res = await fetch(`${t.base}/api/game/save?token=${r.token}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ settings: { sound: false } }) });
  assert.equal(res.status, 200);
  assert.deepEqual((await t.call('GET', '/api/game/save', { token: r.token })).json.save.settings, { sound: false });
  // a token in the query is NOT accepted on normal reads
  assert.equal((await fetch(`${t.base}/api/game/world?token=${r.token}`)).status, 401);
});

// ---------- ban ----------
test('banned players cannot log in or use an old token', async () => {
  const r = await t.register('Banned');
  await t.db.models.User.update({ banned: true, banReason: 'cheating' }, { where: { usernameKey: 'banned' } });
  assert.equal((await t.call('GET', '/api/auth/me', { token: r.token })).status, 401);
  const l = await t.call('POST', '/api/auth/login', { body: { username: 'Banned', password: 'password123' } });
  assert.equal(l.status, 403);
  assert.match(l.json.error, /cheating/);
});

// ---------- live events ----------
test('events: a new castle is pushed to other players, presence is sent', async () => {
  const watcher = await joinAs('Watcher');
  const ctl = new AbortController();
  const res = await fetch(`${t.base}/api/game/events?token=${watcher.token}`, { signal: ctl.signal });
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let text = '';
  const readUntil = async (needle) => {
    while (!text.includes(needle)) {
      const { value, done } = await reader.read();
      if (done) break;
      text += dec.decode(value);
    }
  };
  await readUntil('event: presence');
  await joinAs('Newcomer', 'rome');
  await readUntil('event: castle');
  assert.match(text, /"name":"Newcomer"/);
  ctl.abort();
  assert.equal((await fetch(`${t.base}/api/game/events`)).status, 401);
});

test('unknown api routes give JSON 404', async () => {
  const r = await t.call('GET', '/api/nothing-here');
  assert.equal(r.status, 404);
  assert.equal(r.json.ok, false);
});

test('join: a missing baked map gives a clear 503 message (not a vague "server error")', async () => {
  const noMap = await boot({
    spawner: {
      mapKey: () => null,
      pickSpot: () => { const e = new Error('No baked map found (public/map.json). Bake the map in the editor first.'); e.status = 503; throw e; },
      makeNpcs: () => [],
    },
  });
  try {
    const r = await noMap.register('NoMapGuy');
    const j = await noMap.call('POST', '/api/game/join', { token: r.token, body: { civId: 'persia' } });
    assert.equal(j.status, 503);
    assert.match(j.json.error, /baked map/);
    // and the civilization is NOT locked in by the failed attempt
    assert.equal((await noMap.call('GET', '/api/auth/me', { token: r.token })).json.culture, null);
  } finally {
    await noMap.close();
  }
});
