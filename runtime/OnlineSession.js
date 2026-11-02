/**
 * OnlineSession
 * -------------
 * Same job as PlayerSession.js (castles on the map), but the player is a logged-in
 * account: the castles come from the backend (backend/src) and other players'
 * castles appear live (WebSocket). The civilization was chosen once at the first login and the
 * server's choice always wins.
 *
 *   this.session = await startOnlineSession(this, this.map, { civId: 'persia', assetBase, ui: false });
 *
 * Returns the same shape as startPlayerSession, plus { online: true, close() }.
 */
import { civById } from './civilizations.js';
import { CastleLayer } from './CastleLayer.js';
import { CampLayer } from './CampLayer.js';
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

  // NPC camps (attackable). Missing images only give placeholders, never an error.
  const campLayer = new CampLayer(scene, map, { assetBase: opts.campAssetBase ?? '/assets/npcs/' });
  await campLayer.loadTextures();
  const syncCamps = (list) => {
    const ids = new Set((list || []).map((c) => c.id));
    for (const c of campLayer.getCamps()) if (!ids.has(c.id)) campLayer.removeCamp(c.id);
    for (const c of list || []) campLayer.addCamp({ ...c });
  };
  syncCamps(joined.camps);

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

  // ---- live updates (WebSocket) --------------------------------------------------------
  let closed = false;
  let ws = null;

  const applyPresence = (ids) => {
    const online = new Set(ids);
    for (const entry of layer.castles) {
      const c = entry.data;
      if (isNpc(c) || c.isPlayer) continue;
      entry.label.setAlpha(online.has(c.id) ? 1 : 0.5); // offline players: dimmed name plate
    }
  };
  // chat, admin messages, "your save was changed", "kicked" ... are handled by the game page
  const toGame = (detail) => window.dispatchEvent(new CustomEvent('kingdoms:server', { detail }));

  const onMessage = (msg) => {
    switch (msg.type) {
      case 'castle': {
        const added = addCastle(msg.castle);
        if (added && opts.onNotice) opts.onNotice(`${added.name} joined the world`);
        break;
      }
      case 'camp': campLayer.addCamp(msg.camp); break;
      case 'campGone': campLayer.removeCamp(msg.id); break;
      case 'presence': applyPresence(msg.ids || []); break;
      // the game (React side) listens to this: an army arrived or is back home
      case 'expedition': window.dispatchEvent(new CustomEvent('kingdoms:expedition', { detail: msg })); break;
      case 'kicked': closed = true; if (opts.onAuthLost) opts.onAuthLost(); break;
      default: toGame(msg);
    }
  };

  const watch = () => {
    ws = new WebSocket(api.socketUrl());
    ws.onmessage = (ev) => { try { onMessage(JSON.parse(ev.data)); } catch { /* ignore a broken message */ } };
    ws.onclose = (ev) => {
      if (closed) return;
      if (ev.code === 4001) { if (opts.onAuthLost) opts.onAuthLost(); return; }       // login no longer valid / banned
      if (ev.code === 4002) { closed = true; toGame({ type: 'replaced' }); return; }   // the account was opened in another tab
      setTimeout(rejoin, 2000); // server restarting or network hiccup: join again with the same account
    };
  };

  const rejoin = async () => {
    if (closed) return;
    try {
      joined = await api.join(player.civId);
      for (const c of joined.castles) addCastle(c);
      syncCamps(joined.camps);
      window.dispatchEvent(new CustomEvent('kingdoms:expedition', { detail: { phase: 'rejoined' } }));
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
    campLayer,
    rules: joined.rules || { marchMsPerTile: 400, marchMinMs: 5000, maxActive: 3, unitPower: { 1: 10, 2: 22, 3: 45, 4: 90 } },
    civ,
    ui: null,
    online: true,
    close() {
      closed = true;
      if (ws) ws.close();
    },
  };
}
