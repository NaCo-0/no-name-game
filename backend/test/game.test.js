import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, sleep } from './helpers.js';
import { GameSave, Player, Castle } from '../src/models.js';

let t;
before(async () => { t = await boot(); });
after(async () => { await t.close(); });

test('register validates username and password', async () => {
  let r = await t.call('POST', '/api/auth/register', { body: { username: 'ab', password: 'password123' } });
  assert.equal(r.status, 400); assert.equal(r.json.error, 'bad_username');
  r = await t.call('POST', '/api/auth/register', { body: { username: 'Sara', password: 'short' } });
  assert.equal(r.status, 400); assert.equal(r.json.error, 'bad_password');
  r = await t.call('POST', '/api/auth/register', { body: { username: 'bad name!', password: 'password123' } });
  assert.equal(r.status, 400);
});

test('register + login + me + logout; username is unique case-insensitively', async () => {
  const r = await t.call('POST', '/api/auth/register', { body: { username: 'Sara', password: 'password123' } });
  assert.equal(r.status, 201);
  assert.equal(r.json.user.username, 'Sara');
  assert.equal((await t.call('POST', '/api/auth/register', { body: { username: 'sara', password: 'password123' } })).status, 409);
  const login = await t.call('POST', '/api/auth/login', { body: { username: 'SARA', password: 'password123' } });
  assert.equal(login.status, 200);
  const me = await t.call('GET', '/api/auth/me', { token: login.json.token });
  assert.equal(me.json.user.username, 'Sara');
  assert.equal(me.json.culture, null);
  assert.equal((await t.call('POST', '/api/auth/logout', { token: login.json.token })).status, 200);
});

test('wrong password and unknown user give the same 401; passwords are stored hashed', async () => {
  await t.register('Hashy');
  const a = await t.call('POST', '/api/auth/login', { body: { username: 'Hashy', password: 'wrong-password' } });
  const b = await t.call('POST', '/api/auth/login', { body: { username: 'Nobody', password: 'wrong-password' } });
  assert.equal(a.status, 401); assert.equal(b.status, 401);
  assert.deepEqual(a.json, b.json);
  const row = await Player.findOne({ where: { usernameKey: 'hashy' } });
  assert.ok(row.passwordHash.startsWith('$2'));
  assert.ok(!row.passwordHash.includes('password123'));
});

test('protected endpoints need a token', async () => {
  for (const [m, p] of [['GET', '/api/game/save'], ['POST', '/api/game/join'], ['GET', '/api/game/world'], ['POST', '/api/game/attack'], ['GET', '/api/game/chat'], ['POST', '/api/game/chat']]) {
    assert.equal((await t.call(m, p, { body: m === 'POST' ? {} : undefined })).status, 401, `${m} ${p}`);
  }
  assert.equal((await t.call('GET', '/api/game/save', { token: 'garbage' })).status, 401);
  assert.equal((await t.call('GET', '/api/game/status')).status, 200);
});

test('join: civilization is chosen once and cannot be switched; the castle is placed', async () => {
  const { token } = await t.register('Joiner');
  const a = await t.call('POST', '/api/game/join', { token, body: { civId: 'japan' } });
  assert.equal(a.status, 200);
  assert.equal(a.json.returning, false);
  assert.equal(a.json.you.civId, 'japan');
  assert.ok(a.json.castles.some((c) => c.id === a.json.you.id));
  assert.ok(a.json.castles.some((c) => c.id.startsWith('npc_')));
  assert.equal(a.json.save.culture, 'japanese');
  const b = await t.call('POST', '/api/game/join', { token, body: { civId: 'rome' } });
  assert.equal(b.json.returning, true);
  assert.equal(b.json.you.civId, 'japan');
  assert.equal(b.json.you.tileX, a.json.you.tileX);
  // the other contract: choose-culture is locked too
  const c = await t.call('POST', '/api/game/choose-culture', { token, body: { culture: 'roman' } });
  assert.equal(c.status, 409); assert.equal(c.json.error, 'culture_locked');
  assert.equal((await t.call('GET', '/api/game/save', { token })).json.culture, 'japanese');
});

test('join: unknown civilization is refused, choose-culture works once', async () => {
  const { token } = await t.register('Chooser');
  assert.equal((await t.call('POST', '/api/game/join', { token, body: { civId: 'atlantis' } })).status, 400);
  assert.equal((await t.call('POST', '/api/game/choose-culture', { token, body: { culture: 'nope' } })).status, 400);
  const ok = await t.call('POST', '/api/game/choose-culture', { token, body: { culture: 'viking' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.culture, 'viking');
  assert.equal((await Castle.findOne({ where: { civId: 'viking', isNpc: false } })) !== null, true);
});

test('join: concurrent joins never share a spot', async () => {
  const toks = [];
  for (let i = 0; i < 4; i++) toks.push((await t.register(`Race${i}`)).token);
  const rs = await Promise.all(toks.map((token) => t.call('POST', '/api/game/join', { token, body: { civId: 'persia' } })));
  const spots = rs.map((r) => `${r.json.you.tileX},${r.json.you.tileY}`);
  assert.equal(new Set(spots).size, 4);
});

test('save: cannot save before choosing a civilization', async () => {
  const { token } = await t.register('Early');
  const r = await t.call('PUT', '/api/game/save', { token, body: { data: { settings: { sound: true } }, revision: 0 } });
  assert.equal(r.status, 409); assert.equal(r.json.error, 'no_culture');
});

test('save: everything round-trips; partial saves keep the rest; extra (admin) keys survive', async () => {
  const p = await t.player('Saver', 'japan');
  const v0 = (await t.call('GET', '/api/game/save', { token: p.token })).json;
  assert.equal(v0.culture, 'japanese');
  const full = {
    buildings: { japanese: [{ id: 'dojo', level: 2, stored: 1.5, readyAt: 0 }] },
    resources: { japanese: { food: 1, wood: 2, stone: 3, iron: 4, coin: 5 } },
    army: { troops: { japanese: { samurai: 3 } }, queue: { japanese: [] } },
    marches: [], settings: { sound: true },
  };
  const r1 = await t.call('PUT', '/api/game/save', { token: p.token, body: { data: full, revision: v0.revision } });
  assert.equal(r1.status, 200);
  assert.equal(r1.json.revision, v0.revision + 1);
  await GameSave.update({ data: { ...full, adminNote: 'vip' } }, { where: { playerId: p.id } }); // an admin added a key
  const r2 = await t.call('PUT', '/api/game/save', { token: p.token, body: { data: { settings: { sound: false } }, revision: r1.json.revision } });
  assert.equal(r2.status, 200);
  const back = (await t.call('GET', '/api/game/save', { token: p.token })).json;
  assert.deepEqual(back.data.settings, { sound: false });
  assert.deepEqual(back.data.resources.japanese, full.resources.japanese);
  assert.equal(back.data.adminNote, 'vip');
});

test('save: players cannot write unknown keys or other civilizations', async () => {
  const p = await t.player('Cheater', 'rome');
  const rev = (await t.call('GET', '/api/game/save', { token: p.token })).json.revision;
  const r = await t.call('PUT', '/api/game/save', { token: p.token, body: { data: { resources: { viking: { food: 1, wood: 1, stone: 1, iron: 1, coin: 1 } } }, revision: rev } });
  assert.equal(r.status, 403);
  const ok = await t.call('PUT', '/api/game/save', { token: p.token, body: { data: { evil: { huge: 'x' }, settings: { sound: true } }, revision: rev } });
  assert.equal(ok.status, 200);
  const data = (await t.call('GET', '/api/game/save', { token: p.token })).json.data;
  assert.equal(data.evil, undefined);
});

test('save: an old tab cannot overwrite newer progress (revision check)', async () => {
  const p = await t.player('Stale', 'arab');
  const rev = (await t.call('GET', '/api/game/save', { token: p.token })).json.revision;
  assert.equal((await t.call('PUT', '/api/game/save', { token: p.token, body: { data: { settings: { sound: true } }, revision: rev } })).status, 200);
  const old = await t.call('PUT', '/api/game/save', { token: p.token, body: { data: { settings: { sound: false } }, revision: rev } });
  assert.equal(old.status, 409);
  assert.equal(old.json.error, 'revision_conflict');
  assert.equal(old.json.revision, rev + 1);
  const noRev = await t.call('PUT', '/api/game/save', { token: p.token, body: { data: { settings: { sound: false } } } });
  assert.equal(noRev.status, 409);
});

test('save: accounts are separated', async () => {
  const a = await t.player('Alice1', 'persia');
  const b = await t.player('Bobby1', 'mongol');
  const rev = (await t.call('GET', '/api/game/save', { token: a.token })).json.revision;
  await t.call('PUT', '/api/game/save', { token: a.token, body: { data: { settings: { sound: false } }, revision: rev } });
  const bs = (await t.call('GET', '/api/game/save', { token: b.token })).json;
  assert.equal(bs.culture, 'mongol');
  assert.deepEqual(bs.data, {});
});

test('save: bad data is rejected and nothing is written', async () => {
  const p = await t.player('Junk', 'persia');
  let rev = (await t.call('GET', '/api/game/save', { token: p.token })).json.revision;
  const put = (data) => t.call('PUT', '/api/game/save', { token: p.token, body: { data, revision: rev } });
  for (const bad of [
    { resources: { persian: { food: -5, wood: 0, stone: 0, iron: 0, coin: 0 } } },
    { resources: { persian: { food: 'lots', wood: 0, stone: 0, iron: 0, coin: 0 } } },
    { resources: { persian: { food: 1e15, wood: 0, stone: 0, iron: 0, coin: 0 } } },
    { buildings: { persian: [{ id: 'x', level: 9999 }] } },
    { buildings: { atlantis: [] } },
    { army: { troops: { persian: { guard: -1 } } } },
    { marches: 'nope' },
  ]) {
    const r = await put(bad);
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.json.error, 'invalid_save');
  }
  assert.equal((await put([1, 2])).status, 400);
  assert.equal((await put(undefined)).status, 400);
  assert.deepEqual((await t.call('GET', '/api/game/save', { token: p.token })).json.data, {});
  assert.equal((await t.call('GET', '/api/game/save', { token: p.token })).json.revision, rev);
});

test('save: nested junk inside a building is dropped', async () => {
  const p = await t.player('Nested', 'persia');
  const rev = (await t.call('GET', '/api/game/save', { token: p.token })).json.revision;
  await t.call('PUT', '/api/game/save', { token: p.token, body: { data: { buildings: { persian: [{ id: 'hall', level: 1, stored: 0, readyAt: 0, evil: { deep: [1, 2, 3] } }] } }, revision: rev } });
  const b = (await t.call('GET', '/api/game/save', { token: p.token })).json.data.buildings.persian[0];
  assert.equal(b.evil, undefined);
});

test('save: oversized and malformed bodies are refused', async () => {
  const p = await t.player('Big', 'persia');
  const big = await t.call('PUT', '/api/game/save', { token: p.token, headers: { 'Content-Type': 'application/json' }, raw: JSON.stringify({ data: { settings: { lang: 'x'.repeat(2e6) } }, revision: 0 }) });
  assert.equal(big.status, 413);
  const bad = await t.call('PUT', '/api/game/save', { token: p.token, headers: { 'Content-Type': 'application/json' }, raw: '{nope' });
  assert.equal(bad.status, 400);
});

test('save: sendBeacon style (POST, text/plain, token in the query) works', async () => {
  const p = await t.player('Beacon', 'viking');
  const rev = (await t.call('GET', '/api/game/save', { token: p.token })).json.revision;
  const r = await fetch(`${t.base}/api/game/save?token=${encodeURIComponent(p.token)}`, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ data: { settings: { sound: false } }, revision: rev }),
  });
  assert.equal(r.status, 200);
  assert.deepEqual((await t.call('GET', '/api/game/save', { token: p.token })).json.data.settings, { sound: false });
  const noTok = await fetch(`${t.base}/api/game/save`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(noTok.status, 401);
});

test('banned players cannot log in or use an old token', async () => {
  const p = await t.player('Banme', 'persia');
  await Player.update({ banned: true, banReason: 'spam' }, { where: { id: p.id } });
  assert.equal((await t.call('GET', '/api/game/save', { token: p.token })).status, 403);
  const login = await t.call('POST', '/api/auth/login', { body: { username: 'Banme', password: 'password123' } });
  assert.equal(login.status, 403);
  assert.match(login.json.message, /spam/);
});

test('unknown api routes give JSON 404', async () => {
  const r = await t.call('GET', '/api/nope');
  assert.equal(r.status, 404);
  assert.equal(r.json.error, 'unknown_endpoint');
});

// ---------------- chat ----------------
test('chat: messages are stored, global and civilization channels are separated', async () => {
  const a = await t.player('Chatty1', 'persia');
  const b = await t.player('Chatty2', 'persia');
  const c = await t.player('Chatty3', 'mongol');
  const g = await t.call('POST', '/api/game/chat', { token: a.token, body: { channel: 'global', text: '  salam   donya  ' } });
  assert.equal(g.status, 201);
  assert.equal(g.json.message.text, 'salam donya');
  await sleep(750);
  assert.equal((await t.call('POST', '/api/game/chat', { token: a.token, body: { channel: 'civ', text: 'faghat irani-ha' } })).status, 201);
  const gl = (await t.call('GET', '/api/game/chat?channel=global', { token: c.token })).json.messages;
  assert.ok(gl.some((m) => m.text === 'salam donya' && m.username === 'Chatty1'));
  assert.ok(!gl.some((m) => m.text === 'faghat irani-ha'));
  const civB = (await t.call('GET', '/api/game/chat?channel=civ', { token: b.token })).json.messages;
  assert.ok(civB.some((m) => m.text === 'faghat irani-ha'));
  const civC = (await t.call('GET', '/api/game/chat?channel=civ', { token: c.token })).json.messages;
  assert.ok(!civC.some((m) => m.text === 'faghat irani-ha'));
});

test('chat: validation, flood limit and no chat before choosing a civilization', async () => {
  const p = await t.player('Flooder', 'persia');
  const send = (text) => t.call('POST', '/api/game/chat', { token: p.token, body: { channel: 'global', text } });
  assert.equal((await send('   ')).json.error, 'empty');
  assert.equal((await send('x'.repeat(301))).json.error, 'too_long');
  assert.equal((await send('one')).status, 201);
  assert.equal((await send('two')).status, 429); // too fast
  const { token } = await t.register('NoCiv');
  assert.equal((await t.call('POST', '/api/game/chat', { token, body: { channel: 'global', text: 'hi' } })).status, 409);
});

// ---------------- live (websocket) ----------------
test('ws: needs a valid token; hello + presence; a second tab replaces the first', async () => {
  const p = await t.player('Wsguy', 'persia');
  const bad = t.socket('garbage');
  assert.equal(await bad.closed, 4001);
  const s1 = t.socket(p.token);
  await s1.waitFor((m) => m.type === 'hello');
  const pres = await s1.waitFor((m) => m.type === 'presence' && m.ids.includes(`u_${p.id}`));
  assert.ok(pres);
  const s2 = t.socket(p.token);
  await s2.waitFor((m) => m.type === 'hello');
  assert.equal(await s1.closed, 4002);
  s2.close();
});

test('ws: a new castle and chat messages are pushed live', async () => {
  const a = await t.player('Live1', 'persia');
  const sa = t.socket(a.token);
  await sa.waitFor((m) => m.type === 'hello');
  const b = await t.player('Live2', 'persia');
  const ev = await sa.waitFor((m) => m.type === 'castle' && m.castle.id === `u_${b.id}`);
  assert.equal(ev.castle.civId, 'persia');
  await sleep(750);
  await t.call('POST', '/api/game/chat', { token: b.token, body: { channel: 'global', text: 'live hello' } });
  const chat = await sa.waitFor((m) => m.type === 'chat' && m.message.text === 'live hello');
  assert.equal(chat.message.username, 'Live2');
  sa.close();
});
