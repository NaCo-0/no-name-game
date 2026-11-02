import http from 'node:http';
import { config } from './config.js';
import { initDb } from './models.js';
import { createApp } from './app.js';
import { attachLive } from './live.js';

await initDb();
const app = createApp();
const { world } = app.locals;
try { await world.syncWorld(); await world.syncCamps(); } catch (err) { console.warn('[game] world not ready yet:', err.message); }
world.startTicker();

const server = http.createServer(app);
attachLive(server);
server.listen(config.port, () => {
  console.log(`[server] roo-ye http://localhost:${config.port} ejra shod`);
  console.log(`[server] panel-e admin: http://localhost:${config.port}/admin (ba "npm run build" dar admin-panel) ya http://localhost:5174/admin/ (npm run dev)`);
});
