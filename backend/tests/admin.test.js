import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import express from 'express';
import { createDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { buildAdmin, ensureFirstAdmin } from '../src/admin.js';
import { fakeSpawner } from './helpers.js';

let server, base, db, cookie = '';

const config = { prod: false, tokenTtlDays: 30, sessionSecret: 'test-secret-test-secret-test-secret', adminEmail: 'boss@example.com', adminPassword: 'boss-password-1' };

async function api(method, path, { body, token, form } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(form).toString(); }
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(base + path, { method, headers, body: payload, redirect: 'manual' });
  const set = res.headers.getSetCookie?.() || [];
  if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text, headers: res.headers };
}

before(async () => {
  db = await createDb({ storage: ':memory:' });
  await ensureFirstAdmin(db, config);
  const { app: gameApi, syncWorld } = createApp({ db, config, spawner: fakeSpawner() });
  await syncWorld();
  const { router, admin } = await buildAdmin({ db, config });
  const app = express();
  app.use(admin.options.rootPath, router);
  app.use(gameApi);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
}, { timeout: 120000 });

after(async () => {
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
  await db.sequelize.close();
});

test('admin: not reachable without logging in', async () => {
  cookie = '';
  const r = await api('GET', '/admin/api/resources/Users/actions/list');
  assert.notEqual(r.status, 200);
  const page = await api('GET', '/admin');
  assert.ok([301, 302, 303].includes(page.status), 'redirects to the login page');
});

test('admin: wrong password is refused, right one lets you in', async () => {
  cookie = '';
  await api('GET', '/admin/login');
  const bad = await api('POST', '/admin/login', { form: { email: 'boss@example.com', password: 'wrong-wrong' } });
  assert.ok(!(bad.status === 302 && /\/admin\/?$/.test(bad.headers.get('location') || '')), 'bad login must not redirect into the panel');
  const list = await api('GET', '/admin/api/resources/Users/actions/list');
  assert.notEqual(list.status, 200);

  const ok = await api('POST', '/admin/login', { form: { email: 'boss@example.com', password: 'boss-password-1' } });
  assert.equal(ok.status, 302);
  const list2 = await api('GET', '/admin/api/resources/Users/actions/list');
  assert.equal(list2.status, 200);
});

test('admin: players and their saves are listed, password hash is not exposed', async () => {
  // a player plays
  const reg = (await api('POST', '/api/auth/register', { body: { username: 'Zara', password: 'password123' } })).json;
  await api('POST', '/api/game/join', { token: reg.token, body: { civId: 'japan' } });
  await api('PUT', '/api/game/save', { token: reg.token, body: {
    resources: { japanese: { food: 7, wood: 8, stone: 9, iron: 1, coin: 2 } },
  } });

  const users = await api('GET', '/admin/api/resources/Users/actions/list');
  assert.equal(users.status, 200);
  const zara = users.json.records.find((r) => r.params.username === 'Zara');
  assert.ok(zara);
  assert.equal(zara.params.passwordHash, undefined, 'hash must not be sent to the browser');

  // resources show up as plain columns, in the Users list and in the GameSaves list
  assert.equal(zara.params.civilization, 'japanese');
  assert.equal(zara.params.food, 7);
  assert.equal(zara.params.coin, 2);
  const gs = (await api('GET', '/admin/api/resources/GameSaves/actions/list')).json.records.find((r) => r.params.culture === 'japanese');
  assert.equal(gs.params.player, 'Zara');
  assert.equal(gs.params.stone, 9);
  assert.equal(gs.params.buildingsSummary, '-');
  assert.equal(gs.params.passwordHash, undefined);

  const saves = await api('GET', '/admin/api/resources/GameSaves/actions/list');
  const save = saves.json.records.find((r) => r.params.culture === 'japanese');
  assert.ok(save);
  const show = await api('GET', `/admin/api/resources/GameSaves/records/${save.id}/show`);
  assert.equal(show.status, 200);
  assert.equal(show.json.record.params["resources.japanese.food"], 7); // AdminJS shows JSON fields flattened

  const tokens = await api('GET', '/admin/api/resources/AuthTokens/actions/list');
  assert.ok(tokens.json.records.every((r) => r.params.tokenHash === undefined), 'token hashes must not be sent');
});

test('admin: ban logs the player out everywhere; unban lets them back in', async () => {
  const reg = (await api('POST', '/api/auth/register', { body: { username: 'Cheater', password: 'password123' } })).json;
  const user = await db.models.User.findOne({ where: { usernameKey: 'cheater' } });
  assert.equal((await api('GET', '/api/auth/me', { token: reg.token })).status, 200);

  const ban = await api('POST', `/admin/api/resources/Users/records/${user.id}/ban`);
  assert.equal(ban.status, 200);
  assert.equal(ban.json.notice.type, 'success');
  assert.equal((await api('GET', '/api/auth/me', { token: reg.token })).status, 401);
  assert.equal((await api('POST', '/api/auth/login', { body: { username: 'Cheater', password: 'password123' } })).status, 403);

  await api('POST', `/admin/api/resources/Users/records/${user.id}/unban`);
  assert.equal((await api('POST', '/api/auth/login', { body: { username: 'Cheater', password: 'password123' } })).status, 200);
});

test('admin: reset save wipes progress but keeps account and civilization', async () => {
  const reg = (await api('POST', '/api/auth/register', { body: { username: 'Wiped', password: 'password123' } })).json;
  await api('POST', '/api/game/join', { token: reg.token, body: { civId: 'viking' } });
  await api('PUT', '/api/game/save', { token: reg.token, body: { resources: { viking: { food: 5, wood: 5, stone: 5, iron: 5, coin: 5 } } } });
  const user = await db.models.User.findOne({ where: { usernameKey: 'wiped' } });

  const res = await api('POST', `/admin/api/resources/Users/records/${user.id}/resetSave`);
  assert.equal(res.status, 200);
  const s = (await api('GET', '/api/game/save', { token: reg.token })).json.save;
  assert.equal(s.resources, null);
  assert.equal(s.culture, 'viking');
  assert.ok(s.version >= 2);
});

test('admin: a new admin account gets a hashed password; the last admin cannot be deleted', async () => {
  const create = await api('POST', '/admin/api/resources/AdminUsers/actions/new', { body: { email: 'Second@Example.com', password: 'second-pass-9' } });
  assert.equal(create.status, 200);
  const row = await db.models.AdminUser.findOne({ where: { email: 'second@example.com' } });
  assert.ok(row, JSON.stringify(create.json).slice(0, 300));
  assert.ok(row.passwordHash.startsWith('scrypt$'));

  // delete both -> the second delete must fail
  const boss = await db.models.AdminUser.findOne({ where: { email: 'boss@example.com' } });
  const d1 = await api('POST', `/admin/api/resources/AdminUsers/records/${row.id}/delete`);
  assert.equal(d1.status, 200);
  await api('POST', `/admin/api/resources/AdminUsers/records/${boss.id}/delete`);
  assert.equal(await db.models.AdminUser.count(), 1);
});

test('admin: restarting with ADMIN_EMAIL + ADMIN_PASSWORD fixes a wrong/old password and never makes duplicates', async () => {
  const { verifyPassword } = await import('../src/auth.js');
  const email = 'boss@example.com';
  // the admin that is left from the previous test
  let boss = await db.models.AdminUser.findOne({ where: { email } });
  if (!boss) boss = await db.models.AdminUser.create({ email, passwordHash: 'scrypt$00$00' });
  await ensureFirstAdmin(db, { ...config, adminPassword: 'brand-new-pass-1' });
  boss = await db.models.AdminUser.findOne({ where: { email } });
  assert.ok(await verifyPassword('brand-new-pass-1', boss.passwordHash));
  assert.equal(await db.models.AdminUser.count({ where: { email } }), 1);
  // an old admin with another email stays untouched
  await db.models.AdminUser.create({ email: 'old@example.com', passwordHash: 'scrypt$00$00' });
  await ensureFirstAdmin(db, { ...config, adminPassword: 'brand-new-pass-1' });
  assert.equal(await db.models.AdminUser.count({ where: { email: 'old@example.com' } }), 1);
});

test('admin: buildings, troops and training queue are summarised in readable columns', async () => {
  const reg = (await api('POST', '/api/auth/register', { body: { username: 'Builder', password: 'password123' } })).json;
  await api('POST', '/api/game/join', { token: reg.token, body: { civId: 'rome' } });
  await api('PUT', '/api/game/save', { token: reg.token, body: {
    buildings: { roman: [{ id: 'forum', level: 3, stored: 0, readyAt: 0 }, { id: 'farm', level: 2, stored: 5, readyAt: 0 }] },
    resources: { roman: { food: 100, wood: 200, stone: 300, iron: 400, coin: 500 } },
    army: { troops: { roman: { legionary: 12, archer: 0 } }, queue: { roman: [{ id: 'j1', troopId: 'archer', count: 4, endsAt: 1900000000000 }] } },
  } });
  const user = await db.models.User.findOne({ where: { usernameKey: 'builder' } });
  const show = await api('GET', `/admin/api/resources/Users/records/${user.id}/show`);
  const p = show.json.record.params;
  assert.equal(p.civilization, 'roman');
  assert.equal(p.iron, 400);
  assert.equal(p.buildingsSummary, '2 buildings (total level 5): forum L3, farm L2');
  assert.equal(p.troopsSummary, 'legionary x12');
  assert.equal(p.queueSummary, '1 batch(es) in training');
  assert.equal(p.passwordHash, undefined);
});
