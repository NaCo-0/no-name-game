/**
 * OnlineSession
 * -------------
 * Same job as PlayerSession.js (castles on the map), but the player is a logged-in
 * account: the castles come from the backend (backend/src) and other players'
 * castles appear live. The civilization was chosen once at the first login and the
 * server's choice always wins.
 *
 *   this.session = await startOnlineSession(this, this.map, { civId: 'persia', assetBase, ui: false });
 *
 * Returns the same shape as startPlayerSession, plus { online: true, close() }.
 */
import { civById } from './civilizations.js';
import { CastleLayer } from './CastleLayer.js';
import * as api from '../src/api.js';
import { showLoading } from './ui/LoadingScreen.js';
import { t } from './ui/i18n.js';
import { hex } from './ui/dom.js';

const isNpc = (c) => String(c.id).startsWith('npc_');

/**
 * @param {Phaser.Scene} scene
 * @param {import('./BakedMapLoader.js').BakedMap} map
 * @param {object} [opts]
 * @param {string} [opts.assetBase='assets/objects/castles/']
 * @param {string} opts.civId the account's civilization (the server decides if it differs)
 * @param {(message:string) => void} [opts.onNotice] called for things like "Sara joined the world"
 * @param {() => void} [opts.onAuthLost] the login is no longer valid (expired, banned, logged out elsewhere)
 */
export async function startOnlineSession(scene, map, opts = {}) {
  const assetBase = opts.assetBase ?? 'assets/objects/castles/';
  let joined = await api.join(opts.civId);
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

  const watch = () => {
    es = new EventSource(api.eventsUrl());
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
      joined = await api.join(player.civId);
      for (const c of joined.castles) addCastle(c);
      watch();
    } catch (err) {
      if (err && err.status === 401) { if (opts.onAuthLost) opts.onAuthLost(); return; }
      setTimeout(rejoin, 3000);
    }
  };

  watch();
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
