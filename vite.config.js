import { defineConfig } from 'vite';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Bake server (dev + preview only)
 * --------------------------------
 * The editor's "Bake map" button streams the baked map to these endpoints:
 *
 *   GET  /api/bake-check            -> { supported: true } (editor then bakes "directly")
 *   POST /api/bake-clear            -> empties the staging folder
 *   POST /api/bake-file?path=...    -> writes ONE file into the staging folder
 *   POST /api/bake-commit           -> verifies the bake is complete, then applies it
 *
 * Why staging + commit: files used to be written straight into the live
 * folders, so a cancelled / failed bake left a half-deleted map behind.
 * Now nothing live is touched until every file has arrived and the manifest
 * (map.json) checks out; a failed bake changes nothing.
 *
 * Where a finished bake goes:
 *   public/  <- the SOURCE OF TRUTH. `npm run game` (dev server) serves
 *               public/ at the site root, and `vite build` copies it into
 *               dist/. game.html loads /map.json, /terrain/..., /objects/...
 *   dist/    <- mirrored too, so an existing build is updated right away
 *               without re-running `npm run build`.
 *   $BAKE_MIRROR_DIR (optional env var) <- one extra copy, e.g. a game
 *               folder somewhere else. Off by default.
 */

const ROOT = __dirname;
const STAGING = path.resolve(ROOT, '.bake-staging');
const TARGETS = [path.resolve(ROOT, 'public'), path.resolve(ROOT, 'dist')];
const MIRROR_DIR = process.env.BAKE_MIRROR_DIR || '';

// The ONLY things a bake may write. Anything else is rejected.
const BAKE_DIRS = ['terrain', 'objects', 'data'];
const BAKE_FILES = ['map.json', 'minimap.png'];

/** Returns a clean relative path inside the allowed bake set, or null. */
function safeRelPath(raw) {
  if (!raw || raw.includes('\0')) return null;
  const norm = path.posix.normalize(String(raw).replace(/\\/g, '/'));
  if (norm.startsWith('/') || norm.startsWith('..') || /^[a-zA-Z]:/.test(norm)) return null;
  const parts = norm.split('/');
  if (parts.length === 1) return BAKE_FILES.includes(norm) ? norm : null;
  if (!BAKE_DIRS.includes(parts[0]) || parts.includes('..') || parts.includes('')) return null;
  return norm;
}

// The dev server listens on the whole network (`host: true`, so a phone can
// open the game), but the endpoints that WRITE FILES must only accept
// requests from this machine and from this site (not from other websites).
const OWN_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
for (const list of Object.values(os.networkInterfaces())) {
  for (const i of list || []) OWN_ADDRESSES.add(i.address);
}
function isTrustedRequest(req) {
  const addr = req.socket && req.socket.remoteAddress;
  if (!addr || !OWN_ADDRESSES.has(addr)) return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) return false;
    } catch (e) {
      return false;
    }
  }
  return true;
}

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Every file the manifest points at must be in staging. Returns missing ones. */
function findMissingFiles(manifest) {
  const wanted = [];
  for (const t of (manifest.terrain && manifest.terrain.tiles) || []) wanted.push(t.file);
  for (const o of manifest.objectTypes || []) wanted.push(o.image);
  if (manifest.shadowTexture) wanted.push(manifest.shadowTexture);
  if (manifest.terrain && manifest.terrain.minimap) wanted.push(manifest.terrain.minimap.file);
  for (const d of Object.values(manifest.data || {})) wanted.push(d.file);
  return wanted.filter((f) => !fs.existsSync(path.join(STAGING, f)));
}

function applyStagingTo(targetRoot) {
  fs.mkdirSync(targetRoot, { recursive: true });
  // Replace whole folders so no stale tiles from an older bake survive.
  for (const dir of BAKE_DIRS) {
    const src = path.join(STAGING, dir);
    const dst = path.join(targetRoot, dir);
    fs.rmSync(dst, { recursive: true, force: true });
    if (fs.existsSync(src)) fs.cpSync(src, dst, { recursive: true });
  }
  // map.json goes last: a reader never sees a manifest whose tiles aren't there yet.
  for (const file of ['minimap.png', 'map.json']) {
    const src = path.join(STAGING, file);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(targetRoot, file));
  }
}

async function bakeMiddleware(req, res, next) {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/bake-')) return next();

  if (!isTrustedRequest(req)) {
    return sendJson(res, 403, { ok: false, error: 'bake endpoints only accept requests from this machine' });
  }

  try {
    if (url.pathname === '/api/bake-check') {
      return sendJson(res, 200, { supported: true, target: 'public/ + dist/' });
    }

    if (url.pathname === '/api/bake-clear' && req.method === 'POST') {
      fs.rmSync(STAGING, { recursive: true, force: true });
      fs.mkdirSync(STAGING, { recursive: true });
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === '/api/bake-file' && req.method === 'POST') {
      const rel = safeRelPath(url.searchParams.get('path'));
      if (!rel) return sendJson(res, 400, { ok: false, error: 'bad or disallowed ?path=' });
      const dest = path.resolve(STAGING, rel);
      if (!dest.startsWith(STAGING + path.sep)) return sendJson(res, 400, { ok: false, error: 'bad path' });
      const buffer = await readBody(req);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buffer);
      return sendJson(res, 200, { ok: true, path: rel, size: buffer.length });
    }

    if (url.pathname === '/api/bake-commit' && req.method === 'POST') {
      const manifestPath = path.join(STAGING, 'map.json');
      if (!fs.existsSync(manifestPath)) {
        return sendJson(res, 409, { ok: false, error: 'incomplete bake: map.json was never received' });
      }
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const missing = findMissingFiles(manifest);
      if (missing.length) {
        return sendJson(res, 409, {
          ok: false,
          error: `incomplete bake: ${missing.length} file(s) missing, e.g. ${missing.slice(0, 5).join(', ')}`,
        });
      }

      const applied = [];
      for (const t of TARGETS) {
        applyStagingTo(t);
        applied.push(path.relative(ROOT, t) || '.');
      }
      if (MIRROR_DIR) {
        applyStagingTo(path.resolve(MIRROR_DIR));
        applied.push(MIRROR_DIR);
      }
      fs.rmSync(STAGING, { recursive: true, force: true });
      return sendJson(res, 200, {
        ok: true,
        applied,
        tiles: manifest.terrain.tiles.length,
        objects: (manifest.objects || []).length,
      });
    }

    return sendJson(res, 404, { ok: false, error: 'unknown bake endpoint' });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: String((err && err.message) || err) });
  }
}

function bakeServerPlugin() {
  return {
    name: 'bake-server-plugin',
    configureServer(server) {
      server.middlewares.use(bakeMiddleware);
    },
    // Same endpoints under `npm run preview`, so baking works there too.
    configurePreviewServer(server) {
      server.middlewares.use(bakeMiddleware);
    },
  };
}

export default defineConfig({
  plugins: [bakeServerPlugin()],
  server: {
    port: 5173,
    host: true,
    watch: {
      // NOTE: do NOT ignore public/terrain, public/objects or public/data
      // here. Vite learns which files exist in public/ from this watcher;
      // if it can't see freshly baked files it answers requests for them
      // with the index page (HTTP 200, text/html) instead of the image.
      ignored: ['**/.bake-staging/**', '**/dist/**'],
    },
  },
  build: {
    rollupOptions: {
      // Build the game page too (not just the editor) so dist/ is a runnable game.
      input: {
        main: path.resolve(ROOT, 'index.html'),
        game: path.resolve(ROOT, 'game.html'),
      },
    },
  },
});