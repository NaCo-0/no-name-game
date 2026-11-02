import fs from 'node:fs';
import path from 'node:path';
import 'express-async-errors';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config.js';
import gameRoutes from './routes/game.js';
import adminRoutes from './routes/admin.js';
import { createWorld } from './world.js';
import { createMapSpawner } from './spawn.js';

/**
 * @param {object} [o]
 * @param {object} [o.spawner]  jay-e ghale / ordogah ro naghshe (baraye test ye spawner-e saghte mishe)
 * @param {object} [o.npc]      adad-e NPC (zaman-e raah, ...) baraye test
 * @returns express app; `app.locals.world` = donya-ye bazi (syncWorld, syncCamps, startTicker, ...)
 */
export function createApp({ spawner, npc } = {}) {
  const world = createWorld({ spawner: spawner || createMapSpawner({ root: config.projectRoot }), npc });
  const app = express();
  app.locals.world = world;
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false })); // CSP ro bad az deploy-e nahayi tanzim kon
  app.use(cors({ origin: config.corsOrigins }));
  // text/plain ham: navigator.sendBeacon (zakhire ba baste shodan-e tab) nemitune header-e JSON bede
  app.use(express.json({ limit: '1mb', type: ['application/json', 'text/plain'] }));
  app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/admin', adminRoutes(world));
  app.use('/api', gameRoutes(world));
  app.use('/api', (req, res) => res.status(404).json({ error: 'unknown_endpoint', message: 'unknown endpoint' }));

  // Panel-e build shode ro roo-ye /admin serve mikone
  if (fs.existsSync(config.adminDist)) {
    app.use('/admin', express.static(config.adminDist));
    app.get('/admin/*', (req, res) => res.sendFile(path.join(config.adminDist, 'index.html')));
  }

  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large', message: 'request too large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json', message: 'invalid JSON' });
    if (err.status && err.extra) { // httpError(...): message baraye bazikon-e
      return res.status(err.status).json({ error: err.extra.code || 'error', message: err.message, ...err.extra });
    }
    console.error('[khata]', err);
    res.status(500).json({ error: 'server_error', message: 'server error' });
  });
  return app;
}
