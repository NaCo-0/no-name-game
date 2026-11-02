import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, sleep } from './helpers.js';
import { Castle, GameSave, Player, AdminUser } from '../src/models.js';

let t, root, mod, view;
before(async () => {
  t = await boot();
  root = await t.adminToken('root', 'RootPass123');
  mod = await t.adminToken('mod', 'ModPass1234');
  view = await t.adminToken('watcher', 'WatchPass123');
});
after(async () => { await t.close(); });
const A = (method, path, token, body) => t.call(method, `/api/admin${path}`, { token, body });

test('admin: not reachable without logging in, wrong password refused', async () => {
  assert.equal((await A('GET', '/players')).status, 401);
  assert.equal((await A('GET', '/players', 'garbage')).status, 401);
  assert.equal((await t.call('POST', '/api/admin/auth/login', { body: { username: 'root', password: 'nope-nope-nope' } })).status, 401);
  // a PLAYER token is not an admin token
  const { token } = await t.register('JustAPlayer');
  assert.equal((await A('GET', '/players', token)).status, 401);
});

test('admin: players are listed with their civilization; password hash is not exposed', async () => {
  const p = await t.player('Listed1', 'japan');
  const r = await A('GET', '/players?q=Listed1', view);
  assert.equal(r.status, 200);
  assert.equal(r.json.items[0].culture, 'japanese');
  assert.ok(!JSON.stringify(r.json).includes('passwordHash'));
  const d = await A('GET', `/players/${p.id}`, view);
  assert.equal(d.json.castles.length, 1);
  assert.equal(d.json.castles[0].civId, 'japan');
  assert.ok(!JSON.stringify(d.json).includes('passwordHash'));
  assert.equal(d.json.territory.culture, 'japanese');
});

test('admin: roles - viewer cannot edit, moderator cannot do root things', async () => {
  const p = await t.player('Roles1', 'persia');
  const save = (await A('GET', `/players/${p.id}`, view)).json.save;
  assert.equal((await A('PUT', `/players/${p.id}/save`, view, { data: {}, revision: save.revision })).status, 403);
  assert.equal((await A('PATCH', `/players/${p.id}`, view, { banned: true })).status, 403);
  assert.equal((await A('POST', `/players/${p.id}/culture`, mod, { culture: 'roman' })).status, 403);
  assert.equal((await A('POST', `/players/${p.id}/reset-password`, mod, { password: 'newpassword1' })).status, 403);
  assert.equal((await A('DELETE', `/players/${p.id}`, mod)).status, 403);
  assert.equal((await A('GET', '/admins', mod)).status, 403);
  assert.equal((await A('PATCH', `/players/${p.id}`, mod, { email: 'a@b.co' })).status, 200);
});

test('admin: editing a save checks the game rules, bumps the revision, tells the online player and is logged', async () => {
  const p = await t.player('Edited1', 'persia');
  const sock = t.socket(p.token);
  await sock.waitFor((m) => m.type === 'hello');
  const cur = (await A('GET', `/players/${p.id}`, mod)).json.save;
  const good = { resources: { persian: { food: 5, wood: 6, stone: 7, iron: 8, coin: 9 } }, vipNote: 'free text is fine' };
  // broken game data is refused
  let r = await A('PUT', `/players/${p.id}/save`, mod, { data: { resources: { persian: { food: -1, wood: 0, stone: 0, iron: 0, coin: 0 } } }, revision: cur.revision });
  assert.equal(r.status, 400); assert.equal(r.json.error, 'invalid_save');
  r = await A('PUT', `/players/${p.id}/save`, mod, { data: { resources: { viking: { food: 1, wood: 1, stone: 1, iron: 1, coin: 1 } } }, revision: cur.revision });
  assert.equal(r.status, 403);
  // stale revision
  r = await A('PUT', `/players/${p.id}/save`, mod, { data: good, revision: cur.revision + 5 });
  assert.equal(r.status, 409); assert.equal(r.json.error, 'revision_conflict');
  // good one
  r = await A('PUT', `/players/${p.id}/save`, mod, { data: good, revision: cur.revision });
  assert.equal(r.status, 200);
  const msg = await sock.waitFor((m) => m.type === 'save_changed');
  assert.equal(msg.revision, cur.revision + 1);
  // the PLAYER'S old tab is now stale: its autosave cannot wipe the admin's edit
  const stale = await t.call('PUT', '/api/game/save', { token: p.token, body: { data: { settings: { sound: false } }, revision: cur.revision } });
  assert.equal(stale.status, 409);
  const mine = (await t.call('GET', '/api/game/save', { token: p.token })).json;
  assert.equal(mine.data.resources.persian.food, 5);
  assert.equal(mine.data.vipNote, 'free text is fine');
  const log = await A('GET', `/audit?targetType=player&targetId=${p.id}`, view);
  assert.ok(log.json.items.some((i) => i.action === 'player.edit_save' && i.adminName === 'mod'));
  sock.close();
});

test('admin: ban logs the player out (even online), unban lets them back', async () => {
  const p = await t.player('Banned1', 'persia');
  const sock = t.socket(p.token);
  await sock.waitFor((m) => m.type === 'hello');
  assert.equal((await A('PATCH', `/players/${p.id}`, mod, { banned: true, banReason: 'cheating' })).status, 200);
  await sock.waitFor((m) => m.type === 'kicked');
  assert.equal((await t.call('GET', '/api/game/save', { token: p.token })).status, 403);
  assert.equal((await t.call('POST', '/api/auth/login', { body: { username: 'Banned1', password: 'password123' } })).status, 403);
  await A('PATCH', `/players/${p.id}`, mod, { banned: false });
  assert.equal((await t.call('POST', '/api/auth/login', { body: { username: 'Banned1', password: 'password123' } })).status, 200);
});

test('admin: resetting a password invalidates every old token', async () => {
  const p = await t.player('Pwreset1', 'persia');
  assert.equal((await t.call('GET', '/api/game/save', { token: p.token })).status, 200);
  assert.equal((await A('POST', `/players/${p.id}/reset-password`, root, { password: 'brand-new-pass1' })).status, 200);
  assert.equal((await t.call('GET', '/api/game/save', { token: p.token })).status, 401); // old token dead
  const login = await t.call('POST', '/api/auth/login', { body: { username: 'Pwreset1', password: 'brand-new-pass1' } });
  assert.equal(login.status, 200);
  assert.equal((await t.call('GET', '/api/game/save', { token: login.json.token })).status, 200);
});

test('admin: changing the civilization wipes the old data, moves the castle and kicks the player', async () => {
  const p = await t.player('Convert1', 'persia');
  const oldCastle = p.join.you;
  const sock = t.socket(p.token);
  await sock.waitFor((m) => m.type === 'hello');
  const r = await A('POST', `/players/${p.id}/culture`, root, { culture: 'roman' });
  assert.equal(r.status, 200);
  assert.equal(r.json.player.culture, 'roman');
  assert.equal(await sock.closed, 4000);
  const castles = await Castle.findAll({ where: { playerId: p.id } });
  assert.equal(castles.length, 1);
  assert.equal(castles[0].civId, 'rome');
  const save = await GameSave.findOne({ where: { playerId: p.id } });
  assert.equal(save.culture, 'roman');
  assert.deepEqual(save.data, {});
  // on the next login the server's (new) civilization wins, whatever the client asks
  const j = await t.call('POST', '/api/game/join', { token: p.token, body: { civId: 'viking' } });
  assert.equal(j.json.you.civId, 'rome');
  assert.notEqual(j.json.you.id, undefined);
  assert.equal(j.json.you.id, castles[0].key);
  void oldCastle;
});

test('admin: resetting the civilization (null) lets the player choose again', async () => {
  const p = await t.player('Reset1', 'persia');
  assert.equal((await A('POST', `/players/${p.id}/culture`, root, { culture: null })).status, 200);
  assert.equal(await Castle.count({ where: { playerId: p.id } }), 0);
  const j = await t.call('POST', '/api/game/join', { token: p.token, body: { civId: 'mongol' } });
  assert.equal(j.json.you.civId, 'mongol');
  assert.equal((await A('POST', `/players/${p.id}/culture`, root, { culture: 'atlantis' })).status, 400);
});

test('admin: deleting a player removes castle and save, and others are told the castle is gone', async () => {
  const watcher = await t.player('Watcher1', 'persia');
  const victim = await t.player('Victim1', 'persia');
  const sock = t.socket(watcher.token);
  await sock.waitFor((m) => m.type === 'hello');
  assert.equal((await A('DELETE', `/players/${victim.id}`, root)).status, 200);
  const gone = await sock.waitFor((m) => m.type === 'castleGone');
  assert.equal(gone.id, `u_${victim.id}`);
  assert.equal(await Castle.count({ where: { playerId: victim.id } }), 0);
  assert.equal(await Player.count({ where: { id: victim.id } }), 0);
  assert.equal((await t.call('GET', '/api/game/save', { token: victim.token })).status, 401);
  sock.close();
});

test('admin: messages reach online players; offline ones get 0 deliveries', async () => {
  const p = await t.player('Msg1', 'persia');
  const sock = t.socket(p.token);
  await sock.waitFor((m) => m.type === 'hello');
  const r = await A('POST', '/broadcast', mod, { text: 'server restarts in 5 minutes' });
  assert.ok(r.json.delivered >= 1);
  const m = await sock.waitFor((x) => x.type === 'admin_message');
  assert.equal(m.text, 'server restarts in 5 minutes');
  assert.equal((await A('POST', '/broadcast', mod, { text: '   ' })).status, 400);
  assert.equal((await A('POST', '/broadcast', view, { text: 'hi' })).status, 403);
  sock.close();
});

test('admin: chat is fully recorded, searchable, moderators can mute players and delete messages', async () => {
  const a = await t.player('Talker1', 'persia');
  const b = await t.player('Talker2', 'mongol');
  const sb = t.socket(b.token);
  await sb.waitFor((m) => m.type === 'hello');
  const say = (p, channel, text) => t.call('POST', '/api/game/chat', { token: p.token, body: { channel, text } });
  const m1 = await say(a, 'global', 'hello everybody');
  await sleep(750);
  await say(a, 'civ', 'secret persian plan');
  await sleep(750);
  await say(b, 'civ', 'mongol only');
  // admin sees EVERYTHING, including civilization channels
  let r = await A('GET', '/chat?player=Talker1', view);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.items.map((m) => m.text).sort(), ['hello everybody', 'secret persian plan']);
  assert.ok(r.json.items.every((m) => m.username === 'Talker1' && m.ip));
  r = await A('GET', '/chat?q=plan&channel=civ&culture=persian', view);
  assert.equal(r.json.total, 1);
  assert.equal((await A('GET', '/chat?channel=global&q=hello', view)).json.total >= 1, true);
  // mute
  assert.equal((await A('PATCH', `/players/${a.id}`, view, { muted: true })).status, 403);
  assert.equal((await A('PATCH', `/players/${a.id}`, mod, { muted: true })).status, 200);
  await sleep(750);
  const blocked = await say(a, 'global', 'still talking');
  assert.equal(blocked.status, 403); assert.equal(blocked.json.error, 'muted');
  assert.equal((await A('PATCH', `/players/${a.id}`, mod, { muted: false })).status, 200);
  await sleep(750);
  assert.equal((await say(a, 'global', 'back again')).status, 201);
  // delete a message: gone for everybody, live clients are told, the action is logged
  assert.equal((await A('DELETE', `/chat/${m1.json.message.id}`, view)).status, 403);
  assert.equal((await A('DELETE', `/chat/${m1.json.message.id}`, mod)).status, 200);
  const ev = await sb.waitFor((m) => m.type === 'chat_deleted');
  assert.equal(ev.id, m1.json.message.id);
  assert.ok(!(await t.call('GET', '/api/game/chat?channel=global', { token: b.token })).json.messages.some((m) => m.id === m1.json.message.id));
  const log = await A('GET', '/audit?q=chat.delete', view);
  assert.ok(log.json.items.length >= 1);
  const muteLog = await A('GET', '/audit?q=player.mute', view);
  assert.ok(muteLog.json.items.length >= 1);
  sb.close();
});

test('admin: stats count only real players\' castles; territories can be edited by root only', async () => {
  const s = await A('GET', '/stats', view);
  assert.equal(s.status, 200);
  assert.equal(s.json.totals.castles, await Castle.count({ where: { isNpc: false } }));
  const terr = (await A('GET', '/territories', view)).json.items[0];
  assert.equal((await A('PATCH', `/territories/${terr.id}`, mod, { biome: 'desert' })).status, 403);
  const ok = await A('PATCH', `/territories/${terr.id}`, root, { biome: 'steppe_x' });
  assert.equal(ok.json.territory.biome, 'steppe_x');
});

test('admin: new admin accounts, and the last superadmin is protected', async () => {
  const c = await A('POST', '/admins', root, { username: 'newmod', password: 'NewModPass12', role: 'moderator' });
  assert.equal(c.status, 201);
  const row = await AdminUser.findOne({ where: { username: 'newmod' } });
  assert.ok(row.passwordHash.startsWith('$2'));
  assert.equal((await A('POST', '/admins', root, { username: 'newmod', password: 'NewModPass12', role: 'moderator' })).status, 409);
  const rootRow = await AdminUser.findOne({ where: { username: 'root' } });
  assert.equal((await A('DELETE', `/admins/${rootRow.id}`, root)).json.error, 'last_superadmin');
  assert.equal((await A('PATCH', `/admins/${rootRow.id}`, root, { role: 'viewer' })).json.error, 'last_superadmin');
});
