import http from 'http';
import express from 'express';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { createApp } from './app.js';
import { createMapSpawner } from './spawn.js';
import { buildAdmin, ensureFirstAdmin } from './admin.js';
import { CIV_IDS } from './constants.js';

const NAMES = { persia: 'The Persian Empire', mongol: 'The Mongol Horde', arab: 'The Arabian Caliphate', japan: 'The Japanese Shogunate', rome: 'The Roman Republic', viking: 'The Viking Clans' };

export async function start(config = loadConfig()) {
  const db = await createDb({ storage: config.dbFile });
  for (const civId of CIV_IDS) await db.models.Territory.findOrCreate({ where: { civId }, defaults: { name: NAMES[civId] } });
  await ensureFirstAdmin(db, config);

  const spawner = createMapSpawner({ root: config.projectRoot });
  const { app: api, syncWorld, syncCamps, startTicker } = createApp({ db, config, spawner });
  try { await syncWorld(); await syncCamps(); } catch (err) { console.warn('[game] world not ready yet:', err.message); }
  startTicker();

  const { router: adminRouter, admin } = await buildAdmin({ db, config });
  const app = express();
  app.use(admin.options.rootPath, adminRouter); // before body parsers
  app.use(api);

  const server = http.createServer(app);
  await new Promise((r) => server.listen(config.port, r));
  console.log(`[game] API    http://localhost:${config.port}/api/game/status`);
  console.log(`[game] Admin  http://localhost:${config.port}/admin`);
  return { server, db };
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('index.js')) {
  start().catch((err) => { console.error(err); process.exit(1); });
}
