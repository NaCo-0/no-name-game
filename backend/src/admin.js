/**
 * Admin panel (AdminJS) at /admin.
 *   - logs in with the AdminUser table (first admin is created from ADMIN_EMAIL / ADMIN_PASSWORD;
 *     without ADMIN_PASSWORD a random one is generated and printed ONCE),
 *   - lets you see / edit players, their saves (buildings, resources, army ...), castles, territories,
 *   - "Ban" / "Unban" on a player (a ban also logs the player out everywhere),
 *   - "Reset save" wipes a player's progress but keeps the account and the civilization.
 * Password hashes and token hashes are never shown.
 */
import crypto from 'crypto';
import session from 'express-session';
import AdminJS from 'adminjs';
import AdminJSExpress from '@adminjs/express';
import * as AdminJSSequelize from '@adminjs/sequelize';
import { hashPassword, verifyPassword } from './auth.js';

AdminJS.registerAdapter({ Resource: AdminJSSequelize.Resource, Database: AdminJSSequelize.Database });

/**
 * Makes sure the admin from ADMIN_EMAIL / ADMIN_PASSWORD exists AND has that password
 * (so a wrong/old password in the database can never lock you out: restart with the env set).
 * Without ADMIN_PASSWORD: only when there is no admin at all, a random password is created and printed once.
 */
export async function ensureFirstAdmin({ models }, config) {
  if (config.adminPassword) {
    const row = await models.AdminUser.findOne({ where: { email: config.adminEmail } });
    if (!row) {
      await models.AdminUser.create({ email: config.adminEmail, passwordHash: await hashPassword(config.adminPassword) });
      console.log(`[admin] admin created: ${config.adminEmail}`);
    } else if (!(await verifyPassword(config.adminPassword, row.passwordHash))) {
      await row.update({ passwordHash: await hashPassword(config.adminPassword) });
      console.log(`[admin] password of ${config.adminEmail} was set from ADMIN_PASSWORD`);
    } else {
      console.log(`[admin] login with: ${config.adminEmail}`);
    }
    return config.adminEmail;
  }
  if ((await models.AdminUser.count()) > 0) {
    const list = (await models.AdminUser.findAll({ attributes: ['email'] })).map((a) => a.email).join(', ');
    console.log(`[admin] existing admin accounts: ${list}  (to reset a password: set ADMIN_EMAIL + ADMIN_PASSWORD and restart)`);
    return null;
  }
  const password = crypto.randomBytes(9).toString('base64url');
  await models.AdminUser.create({ email: config.adminEmail, passwordHash: await hashPassword(password) });
  console.log('\n  ==============================================================');
  console.log(`   First admin created:  ${config.adminEmail}  /  ${password}`);
  console.log('   Shown only this once. Change it in the panel (Admin accounts).');
  console.log('  ==============================================================\n');
  return config.adminEmail;
}

export async function buildAdmin({ db, config }) {
  const { models } = db;
  const hidden = { isVisible: false };
  const jsonProp = { type: 'mixed', isArray: false };

  // isVisible:false only hides a field in the UI; the JSON the browser receives still has it,
  // so secrets are removed from every response here.
  const strip = (...keys) => async (response) => {
    const clean = (r) => { if (r && r.params) for (const k of keys) delete r.params[k]; };
    clean(response.record);
    (response.records || []).forEach(clean);
    return response;
  };
  const stripActions = (...keys) => Object.fromEntries(['list', 'show', 'edit', 'new', 'search'].map((a) => [a, { after: strip(...keys) }]));

  // ---- readable columns: a player's resources, buildings and army shown as normal columns ----
  const num = (v) => (Number.isFinite(v) ? Math.round(v) : null);
  function summarize(save) {
    const c = save.culture;
    const res = (c && save.resources && save.resources[c]) || null;
    const b = (c && save.buildings && save.buildings[c]) || [];
    const troops = (c && save.army && save.army.troops && save.army.troops[c]) || {};
    const queue = (c && save.army && save.army.queue && save.army.queue[c]) || [];
    const trained = Object.entries(troops).filter(([, n]) => n > 0);
    return {
      civilization: c || '(not chosen yet)',
      food: res ? num(res.food) : null,
      wood: res ? num(res.wood) : null,
      stone: res ? num(res.stone) : null,
      iron: res ? num(res.iron) : null,
      coin: res ? num(res.coin) : null,
      buildingsSummary: b.length ? `${b.length} buildings (total level ${b.reduce((n, x) => n + (x.level || 0), 0)}): ` + b.map((x) => `${x.id} L${x.level}`).join(', ') : '-',
      troopsSummary: trained.length ? trained.map(([id, n]) => `${id} x${n}`).join(', ') : '-',
      queueSummary: queue.length ? `${queue.length} batch(es) in training` : '-',
    };
  }
  /** by = 'id' for the GameSaves list, 'userId' for the Users list */
  const enrich = (by) => async (response) => {
    const list = response.records ? response.records : response.record ? [response.record] : [];
    if (!list.length) return response;
    const ids = list.map((r) => Number(r.id)).filter(Number.isFinite);
    const saves = await models.GameSave.findAll({ where: by === 'id' ? { id: ids } : { userId: ids }, include: [models.User] });
    const byKey = new Map(saves.map((sv) => [by === 'id' ? sv.id : sv.userId, sv]));
    for (const r of list) {
      const sv = byKey.get(Number(r.id));
      Object.assign(r.params, sv ? summarize(sv) : summarize({}));
      if (by === 'id') r.params.player = sv && sv.User ? sv.User.username : '';
    }
    return response;
  };
  const virtual = (type = 'string') => ({ type, isVisible: { list: true, show: true, edit: false, filter: false }, isSortable: false });
  const virtualProps = {
    player: virtual(), civilization: virtual(),
    food: virtual('number'), wood: virtual('number'), stone: virtual('number'), iron: virtual('number'), coin: virtual('number'),
    buildingsSummary: virtual(), troopsSummary: virtual(), queueSummary: virtual(),
  };

  const afterAction = (message, record, response, type = 'success') => ({
    record: record.toJSON(),
    notice: { message, type },
    redirectUrl: response.redirectUrl,
  });

  const resources = [
    {
      resource: models.User,
      options: {
        navigation: { name: 'Players', icon: 'User' },
        listProperties: ['id', 'username', 'civilization', 'food', 'wood', 'stone', 'iron', 'coin', 'banned', 'lastLoginAt'],
        showProperties: ['id', 'username', 'civilization', 'food', 'wood', 'stone', 'iron', 'coin', 'buildingsSummary', 'troopsSummary', 'queueSummary', 'banned', 'banReason', 'lastLoginAt', 'createdAt'],
        editProperties: ['username', 'banned', 'banReason'],
        filterProperties: ['username', 'banned', 'createdAt'],
        properties: { passwordHash: hidden, usernameKey: hidden, ...virtualProps },
        actions: {
          ...stripActions('passwordHash'),
          list: { after: [strip('passwordHash'), enrich('userId')] },
          show: { after: [strip('passwordHash'), enrich('userId')] },
          search: { after: [strip('passwordHash'), enrich('userId')] },
          new: { isAccessible: false }, // players register in the game
          ban: {
            actionType: 'record', icon: 'Blocked', component: false, guard: 'Ban this player and log them out everywhere?',
            handler: async (request, response, context) => {
              const { record } = context;
              await record.update({ banned: true });
              await models.AuthToken.destroy({ where: { userId: record.id() } });
              return afterAction('Player banned and logged out', record, response);
            },
          },
          unban: {
            actionType: 'record', icon: 'Checkmark', component: false,
            handler: async (request, response, context) => {
              await context.record.update({ banned: false, banReason: null });
              return afterAction('Player unbanned', context.record, response);
            },
          },
          resetSave: {
            actionType: 'record', icon: 'Reset', component: false, guard: 'Wipe this player\'s buildings, resources and army? (account and civilization stay)',
            handler: async (request, response, context) => {
              const { record } = context;
              await models.GameSave.update(
                { buildings: null, resources: null, army: null, marches: null, version: db.sequelize.literal('version + 1') },
                { where: { userId: record.id() } }
              );
              return afterAction('Save wiped: the player starts fresh next time they log in', record, response);
            },
          },
        },
      },
    },
    {
      resource: models.GameSave,
      options: {
        navigation: { name: 'Players', icon: 'User' },
        listProperties: ['id', 'player', 'culture', 'food', 'wood', 'stone', 'iron', 'coin', 'buildingsSummary', 'troopsSummary', 'version', 'updatedAt'],
        showProperties: ['id', 'player', 'culture', 'version', 'food', 'wood', 'stone', 'iron', 'coin', 'buildingsSummary', 'troopsSummary', 'queueSummary', 'buildings', 'resources', 'army', 'marches', 'settings', 'updatedAt'],
        properties: { buildings: jsonProp, resources: jsonProp, army: jsonProp, marches: jsonProp, settings: jsonProp, ...virtualProps },
        actions: {
          new: { isAccessible: false },
          list: { after: [enrich('id')] },
          show: { after: [enrich('id')] },
          search: { after: [enrich('id')] },
        },
      },
    },
    {
      resource: models.Castle,
      options: { navigation: { name: 'World', icon: 'Home' }, listProperties: ['id', 'name', 'civId', 'tileX', 'tileY', 'isNpc', 'userId'] },
    },
    {
      resource: models.Territory,
      options: { navigation: { name: 'World', icon: 'Home' }, listProperties: ['id', 'civId', 'name', 'biome'] },
    },
    {
      resource: models.AuthToken,
      options: { navigation: { name: 'Security', icon: 'Locked' }, properties: { tokenHash: hidden }, listProperties: ['id', 'userId', 'expiresAt', 'createdAt'], actions: { ...stripActions('tokenHash'), new: { isAccessible: false }, edit: { isAccessible: false } } },
    },
    {
      resource: models.AdminUser,
      options: {
        navigation: { name: 'Security', icon: 'Locked' },
        listProperties: ['id', 'email', 'createdAt'],
        editProperties: ['email', 'password'],
        properties: {
          passwordHash: hidden,
          password: { type: 'password', isVisible: { list: false, show: false, filter: false, edit: true } },
        },
        actions: {
          list: { after: strip('passwordHash') },
          show: { after: strip('passwordHash') },
          search: { after: strip('passwordHash') },
          new: { before: hashPasswordHook(true), after: strip('passwordHash') },
          edit: { before: hashPasswordHook(false), after: strip('passwordHash') },
          delete: {
            before: async (request, context) => {
              if ((await models.AdminUser.count()) <= 1) throw new Error('You cannot delete the last admin account.');
              return request;
            },
          },
        },
      },
    },
  ];

  function hashPasswordHook(required) {
    return async (request) => {
      if (request.method !== 'post') return request;
      const { password, ...rest } = request.payload || {};
      if (rest.email !== undefined) {
        rest.email = String(rest.email).trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rest.email)) throw new Error('Enter a valid email address.');
      }
      if (password) return { ...request, payload: { ...rest, passwordHash: await hashPassword(password) } };
      if (required) throw new Error('A password is required.');
      return { ...request, payload: rest };
    };
  }

  const admin = new AdminJS({
    rootPath: '/admin',
    branding: { companyName: 'Kingdoms: Admin', withMadeWithLove: false },
    resources,
  });

  const store = new session.MemoryStore();
  const router = AdminJSExpress.buildAuthenticatedRouter(
    admin,
    {
      authenticate: async (email, password) => {
        const a = await models.AdminUser.findOne({ where: { email: String(email).trim().toLowerCase() } });
        if (!a || !(await verifyPassword(String(password), a.passwordHash))) return null;
        return { email: a.email, id: a.id };
      },
      cookieName: 'kingdoms_admin',
      cookiePassword: config.sessionSecret,
    },
    null,
    {
      store,
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      name: 'kingdoms_admin',
      cookie: { httpOnly: true, sameSite: 'lax', secure: config.prod, maxAge: 8 * 60 * 60 * 1000 },
    }
  );
  return { admin, router };
}
