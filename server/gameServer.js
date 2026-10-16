/**
 * gameServer.js  —  tiny LOCAL online mode (runs inside the Vite dev server)
 * ---------------------------------------------------------------------------
 * Several browser tabs (or phones on the same Wi-Fi) share one world:
 *
 *   GET  /api/game/status           -> { ok: true }               ("is there a server?")
 *   POST /api/game/join             -> { token, you, castles }     body: { name, civId }
 *   GET  /api/game/events?token=... -> Server-Sent Events stream:
 *                                        "castle"   a new player's castle appeared
 *                                        "presence" ids of the players who are online now
 *
 * The SERVER decides where a new castle goes (same SpawnPlanner the game uses),
 * so nobody can pick a spot or overlap someone else.
 *
 * An account is just its name (case-insensitive): joining again with the same
 * name gives the same castle back. Everything is saved in .game-data/world.json
 * (delete that file to start a fresh world; it is also reset automatically when
 * the map is baked again, because castle spots may no longer be valid).
 *
 * This is a development stand-in. When the real Node backend exists, replace
 * these 3 endpoints there; the game client (runtime/OnlineSession.js) only
 * talks to this small API.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { SpawnPlanner, makeRng } from '../runtime/SpawnPlanner.js';
import { buildProvinces, blockCapitalFootprints } from '../runtime/ProvinceMap.js';
import { PROVINCE_CONFIG, PROVINCES_PER_CIV } from '../runtime/provinces.js';
import { CIVILIZATIONS as PROVINCE_CIVS } from '../runtime/civilizations.js';
import { CIVILIZATIONS, civById, randomName } from '../runtime/civilizations.js';

const API = '/api/game/';
const NAME_MIN = 2;
const NAME_MAX = 16;
const MAX_PLAYERS = 500;
const MAX_SESSIONS = 5000;

/** Same rules as runtime/JoinScreen.js sanitizeName (that file needs a browser). */
function sanitizeName(raw) {
  const cleaned = String(raw ?? '')
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(cleaned).slice(0, NAME_MAX).join('').trim();
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

function readJson(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(httpError(413, 'request too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(httpError(400, 'invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** Browsers on other websites must not be able to use this API. Same-site and LAN pages are fine. */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.root        project folder (where public/ and .game-data/ live)
 * @param {string} [opts.publicDir='public']
 * @param {string} [opts.dataDir='.game-data']
 * @param {number} [opts.seed=1337]       seed for the computer castles
 * @param {number} [opts.npcPerCiv=3]
 */
export function createGameServer({ root, publicDir = 'public', dataDir = '.game-data', seed = 1337, npcPerCiv = 3 } = {}) {
  const PUBLIC = path.resolve(root, publicDir);
  const DATA_FILE = path.resolve(root, dataDir, 'world.json');

  let mapCache = null; // { mtime, planner, key }
  let world = null; // { mapKey, players: { [accountKey]: castle }, npcs: castle[] }
  const sessions = new Map(); // token -> accountKey
  const streams = new Map(); // response -> accountKey (open event streams)
  let presenceTimer = null;

  // ---- map -------------------------------------------------------------------

  function loadMap() {
    const manifestPath = path.join(PUBLIC, 'map.json');
    let st;
    try {
      st = fs.statSync(manifestPath);
    } catch {
      throw httpError(503, 'No baked map found (public/map.json). Bake the map in the editor first.');
    }
    if (mapCache && mapCache.mtime === st.mtimeMs) return mapCache;

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const bin = (d) => new Uint8Array(fs.readFileSync(path.join(PUBLIC, d.file)));
    // Province capitals block their ground, exactly like on the client, so
    // new castles never land on top of one.
    const gw = manifest.grid.width;
    const gh = manifest.grid.height;
    const collision = bin(manifest.data.collision);
    const territory = bin(manifest.data.territory);
    const { provinces } = buildProvinces(
      { width: gw, height: gh, territory, collision, objects: manifest.objects ?? [] },
      { civCount: PROVINCE_CIVS.length, perCiv: PROVINCES_PER_CIV, sectionCount: 6, startAngleDeg: 0, config: PROVINCE_CONFIG }
    );
    blockCapitalFootprints(collision, gw, gh, provinces, PROVINCE_CONFIG.capitalFootprintRadiusTiles);
    const planner = new SpawnPlanner({
      width: gw,
      height: gh,
      collision,
      territory,
      objects: manifest.objects ?? [],
    });
    mapCache = { mtime: st.mtimeMs, planner, key: String(st.mtimeMs) };
    return mapCache;
  }

  // ---- world (saved on disk) ---------------------------------------------------

  function makeNpcs(planner) {
    const rand = makeRng(seed);
    const placed = [];
    const taken = new Set();
    const npcs = [];
    for (const civ of CIVILIZATIONS) {
      for (let i = 0; i < npcPerCiv; i++) {
        const spot = planner.pickSpot(civ.territory, rand, placed);
        if (!spot) break;
        const name = randomName(civ.id, rand, taken);
        taken.add(name.toLowerCase());
        const npc = { id: `npc_${civ.id}_${i}`, name, civId: civ.id, tileX: spot.tileX, tileY: spot.tileY };
        placed.push(npc);
        npcs.push(npc);
      }
    }
    return npcs;
  }

  function saveWorld() {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(world, null, 1));
    fs.renameSync(tmp, DATA_FILE);
  }

  function loadWorld(map) {
    if (world && world.mapKey === map.key) return world;
    let saved = null;
    try {
      saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch {
      /* first run */
    }
    if (saved && saved.mapKey === map.key && saved.players && Array.isArray(saved.npcs)) {
      world = saved;
      return world;
    }
    if (saved) console.log('[game] the map was baked again since the last run: starting a fresh world');
    world = { mapKey: map.key, players: {}, npcs: makeNpcs(map.planner) };
    saveWorld();
    return world;
  }

  const allCastles = () => [...world.npcs, ...Object.values(world.players)];

  // ---- live events ---------------------------------------------------------------

  function send(res, event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function broadcast(event, data) {
    for (const res of streams.keys()) send(res, event, data);
  }

  function onlineIds() {
    const ids = new Set();
    for (const key of streams.values()) {
      const p = world && world.players[key];
      if (p) ids.add(p.id);
    }
    return [...ids];
  }

  function broadcastPresence() {
    broadcast('presence', onlineIds());
  }

  // ---- endpoints -------------------------------------------------------------------

  function join(body) {
    const name = sanitizeName(body.name);
    const nameLen = Array.from(name).length;
    if (nameLen < NAME_MIN || nameLen > NAME_MAX) throw httpError(400, `name must be ${NAME_MIN}-${NAME_MAX} characters`);
    const civ = civById(body.civId);
    if (!civ) throw httpError(400, 'unknown civilization');

    const map = loadMap();
    const w = loadWorld(map);
    const key = name.normalize('NFC').toLowerCase();

    let player = w.players[key];
    const returning = !!player;
    if (!player) {
      if (Object.keys(w.players).length >= MAX_PLAYERS) throw httpError(503, 'world is full');
      const placed = allCastles();
      const spot = map.planner.pickSpot(civ.territory, Math.random, placed) ?? map.planner.pickSpot(null, Math.random, placed);
      if (!spot) throw httpError(503, 'no free spot found for a new castle');
      player = { id: 'u_' + key, name, civId: civ.id, tileX: spot.tileX, tileY: spot.tileY };
      w.players[key] = player;
      saveWorld();
      broadcast('castle', player);
      console.log(`[game] new player "${name}" (${civ.id}) at tile ${spot.tileX},${spot.tileY}`);
    }

    if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
    const token = crypto.randomBytes(16).toString('hex');
    sessions.set(token, key);
    return { ok: true, token, returning, you: player, castles: allCastles() };
  }

  function openStream(req, res, url) {
    const key = sessions.get(url.searchParams.get('token') || '');
    if (!key || !world || !world.players[key]) throw httpError(401, 'unknown session: join again');

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    streams.set(res, key);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => {
      clearInterval(heartbeat);
      streams.delete(res);
      // Short delay so a quick page reload doesn't flicker the player offline.
      clearTimeout(presenceTimer);
      presenceTimer = setTimeout(broadcastPresence, 1500);
    });
    broadcastPresence();
  }

  async function middleware(req, res, next) {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith(API)) return next();
    if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'bad origin' });

    try {
      const route = url.pathname.slice(API.length);
      if (route === 'status' && req.method === 'GET') return sendJson(res, 200, { ok: true, mode: 'online' });
      if (route === 'join' && req.method === 'POST') return sendJson(res, 200, join(await readJson(req)));
      if (route === 'events' && req.method === 'GET') return openStream(req, res, url);
      return sendJson(res, 404, { ok: false, error: 'unknown endpoint' });
    } catch (err) {
      return sendJson(res, err.status || 500, { ok: false, error: String((err && err.message) || err) });
    }
  }

  return { middleware };
}
