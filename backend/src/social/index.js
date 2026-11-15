/** Alliances + rallies + individual events: one plug-in. createSocial(world) -> { router, rally }. */
import { Router } from 'express';
import { playerAuth } from '../auth.js';
import { sequelize } from '../models.js';
import * as alliance from './alliance.js';
import * as events from './events.js';
import { createRally } from './rally.js';
import { createElephant } from './elephant.js';
import { createConquest } from './conquest.js';

export function createSocial(world, { spawner } = {}) {
  const conquest = createConquest(world, { spawner: spawner || {} });
  const rally = createRally(world, { conquest });
  world.addTickHook(() => rally.tick());
  const elephant = createElephant(world);
  world.addTickHook(() => conquest.tick());
  world.addTickHook(() => elephant.tick()); // after the rallies: a rally launched at the last second still counts

  const r = Router();
  r.use(['/alliance', '/alliances', '/rally', '/events', '/conquest'], playerAuth);
  const ok = (fn) => async (req, res) => res.json({ ok: true, now: Date.now(), ...(await fn(req.player, req.body || {}, req)) });

  // ---- alliances ----
  r.get('/alliance', ok((p) => alliance.mine(p)));
  r.get('/alliances', ok((p, b, req) => alliance.list(p, req.query.q)));
  r.post('/alliance', ok((p, b) => alliance.create(p, b)));
  r.post('/alliance/join', ok((p, b) => alliance.join(p, b)));
  r.post('/alliance/cancel-request', ok((p, b) => alliance.cancelRequest(p, b)));
  r.post('/alliance/answer', ok((p, b) => alliance.answer(p, b)));
  r.post('/alliance/leave', ok((p) => alliance.leave(p)));
  r.post('/alliance/kick', ok((p, b) => alliance.kick(p, b)));
  r.post('/alliance/role', ok((p, b) => alliance.setRole(p, b)));
  r.post('/alliance/transfer', ok((p, b) => alliance.transfer(p, b)));
  r.post('/alliance/settings', ok((p, b) => alliance.settings(p, b)));
  r.post('/alliance/disband', ok((p) => alliance.disband(p)));

  // ---- rallies ----
  r.get('/alliance/rallies', ok((p) => rally.list(p)));
  r.get('/alliance/targets', ok((p) => rally.targets(p)));
  r.post('/rally', ok((p, b) => rally.create(p, b)));
  r.post('/rally/join', ok((p, b) => rally.join(p, b)));
  r.post('/rally/leave', ok((p, b) => rally.leave(p, b)));
  r.post('/rally/launch', ok((p, b) => rally.launch(p, b)));
  r.post('/rally/cancel', ok((p, b) => rally.cancel(p, b)));
  r.post('/rally/claim', ok((p, b) => rally.claim(p, b)));

  // ---- Province Conquest ----
  r.get('/conquest', ok((p) => conquest.status(p)));
  r.get('/conquest/map', ok(() => ({ map: conquest.map() })));

  // ---- War Elephant (alliance hunt) ----
  r.get('/alliance/elephant', ok((p) => elephant.status(p)));
  r.post('/alliance/elephant/start', ok((p, b) => elephant.start(p, b)));
  r.post('/alliance/elephant/cancel', ok((p) => elephant.cancel(p)));
  r.post('/alliance/elephant/donate', ok((p, b) => elephant.donate(p, b)));
  r.post('/alliance/elephant/claim', ok((p, b) => elephant.claim(p, b)));

  // ---- events ----
  r.get('/events', ok((p) => events.eventsFor(p)));
  r.post('/events/claim', ok((p, b) => events.claim(p, b)));

  return { router: r, rally, elephant, conquest, sequelize };
}
