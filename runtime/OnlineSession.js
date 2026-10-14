/**
 * OnlineSession
 * -------------
 * Same job as PlayerSession.js (join screen -> castles on the map), but the
 * castles come from the game server (server/gameServer.js) and other players'
 * castles appear live.
 *
 *   if (await probeOnline()) {
 *     this.session = await startOnlineSession(this, this.map, { assetBase, ui: false });
 *   } else {
 *     this.session = await startPlayerSession(this, this.map, { ... });   // offline
 *   }
 *
 * Returns the same shape as startPlayerSession, plus { online: true, close() }.
 */
import { civById } from './civilizations.js';
import { CastleLayer } from './CastleLayer.js';
import { showJoinScreen } from './JoinScreen.js';
import { showLoading } from './ui/LoadingScreen.js';
import { t } from './ui/i18n.js';
import { hex } from './ui/dom.js';

const isNpc = (c) => String(c.id).startsWith('npc_');

/** True when a game server answers on this origin (false on plain static hosting). */
export async function probeOnline(timeoutMs = 1500) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch('/api/game/status', { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) return false;
    const j = await r.json(); // throws on an HTML page -> not a game server
    return !!(j && j.ok);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function postJoin(choice) {
  const res = await fetch('/api/game/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: choice.name, civId: choice.civId }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.token) throw new Error((data && data.error) || `join failed (${res.status})`);
  return data;
}

/**
 * @param {Phaser.Scene} scene
 * @param {import('./BakedMapLoader.js').BakedMap} map
 * @param {object} [opts]
 * @param {string} [opts.assetBase='assets/objects/castles/']
 * @param {{civId:string, name:string}} [opts.choice] skip the join screen
 * @param {(message:string) => void} [opts.onNotice] called for things like "Sara joined the world"
 */
export async function startOnlineSession(scene, map, opts = {}) {
  const assetBase = opts.assetBase ?? 'assets/objects/castles/';
  const choice = opts.choice ?? (await showJoinScreen({ assetBase }));

  let joined = await postJoin(choice);
  const civ = civById(joined.you.civId); // the server's civilization wins for a returning account
  const loading = showLoading({ title: t('loading.castle'), accent: hex(civ.color) });

  const layer = new CastleLayer(scene, map, { assetBase });
  await layer.loadTextures();

  const byId = new Map(); // castle id -> castle data (with worldX / worldY)
  const addCastle = (c) => {
    if (byId.has(c.id)) return null;
    const data = { id: c.id, name: c.name, civId: c.civId, tileX: c.tileX, tileY: c.tileY, isPlayer: c.id === joined.you.id };
    layer.addCastle(data);
    byId.set(c.id, data);
    return data;
  };
  for (const c of joined.castles) addCastle(c);
  const player = byId.get(joined.you.id);
  loading.setProgress(1);

  // ---- live updates ------------------------------------------------------------
  let closed = false;
  let es = null;

  const applyPresence = (ids) => {
    const online = new Set(ids);
    for (const entry of layer.castles) {
      const c = entry.data;
      if (isNpc(c) || c.isPlayer) continue;
      entry.label.setAlpha(online.has(c.id) ? 1 : 0.5); // offline players: dimmed name plate
    }
  };

  const watch = (token) => {
    es = new EventSource(`/api/game/events?token=${encodeURIComponent(token)}`);
    es.addEventListener('castle', (ev) => {
      const added = addCastle(JSON.parse(ev.data));
      if (added && opts.onNotice) opts.onNotice(`${added.name} joined the world`);
    });
    es.addEventListener('presence', (ev) => applyPresence(JSON.parse(ev.data)));
    es.onerror = () => {
      // EventSource retries by itself while the server is just restarting; once it gives up
      // (the old token is unknown after a restart) we join again with the same account.
      if (!closed && es.readyState === EventSource.CLOSED) {
        es.close();
        setTimeout(rejoin, 2000);
      }
    };
  };

  const rejoin = async () => {
    if (closed) return;
    try {
      joined = await postJoin({ name: player.name, civId: player.civId });
      for (const c of joined.castles) addCastle(c);
      watch(joined.token);
    } catch {
      setTimeout(rejoin, 3000);
    }
  };

  watch(joined.token);
  await loading.hide();

  return {
    player,
    npcs: [...byId.values()].filter(isNpc),
    layer,
    civ,
    ui: null,
    online: true,
    close() {
      closed = true;
      if (es) es.close();
    },
  };
}
