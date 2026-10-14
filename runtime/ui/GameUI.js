/**
 * GameUI
 * ------
 * The in-game interface that sits on top of the Phaser canvas:
 *
 *   top-left      player card (avatar, name, civilization)
 *   top-right     minimap (click / drag to move) + camera coordinates
 *   right         zoom buttons
 *   bottom        action bar: My castle (H) · Kingdoms (K) · World map (M) · Settings
 *   bottom-left   go-to coordinates (press /)
 *   floating      castle info card, kingdoms list, settings, big map, toasts
 *
 * It works through a few plain calls on the scene, the map and the
 * CastleLayer, so it does not care how the rest of the game is organised.
 * The root element ignores pointer events itself; only the controls catch
 * them, so dragging the map under the HUD keeps working.
 */
import { h, hex, inkFor, clamp } from './dom.js';
import { icon } from './icons.js';
import { installStyles } from './styles.js';
import { t, getDir, num, civText, onLangChange } from './i18n.js';
import { settings } from './Settings.js';
import { Toasts } from './Toasts.js';
import { Minimap } from './Minimap.js';
import { castleCard, kingdomsDrawer, settingsModal, modal } from './Panels.js';
import { civById } from '../civilizations.js';

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2;
const toLatinDigits = (s) => s.replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x06f0).replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x0660);

/**
 * @param {object} o
 * @param {Phaser.Scene} o.scene
 * @param {import('../BakedMapLoader.js').BakedMap} o.map
 * @param {import('../CastleLayer.js').CastleLayer} o.layer
 * @param {object} o.player   the player's castle data ({id,name,civId,tileX,tileY,...})
 * @param {() => void} [o.onChangeCiv] called when the player asks to pick a new civilization
 */
export function createGameUI({ scene, map, layer, player, onChangeCiv }) {
  installStyles();
  const cam = scene.cameras.main;
  const civ = civById(player.civId);
  const toasts = new Toasts();
  const root = h('div', { class: 'ui-root' });
  document.body.appendChild(root);

  const ui = { panel: null, panelEl: null, minimap: null, goMsgTimer: null, bar: {} };
  const castles = () => layer.getCastles();
  const distanceTo = (c) => Math.hypot(c.tileX - player.tileX, c.tileY - player.tileY);

  // ---------- camera helpers ----------
  // Aim a little above the castle's ground point so the castle sits above the info card.
  const flyTo = (wx, wy, ms = 450) => cam.pan(wx, wy - 40, ms, 'Sine.easeInOut', true);
  const flyToTile = (tx, ty) => {
    const w = map.tileToWorld(tx, ty);
    flyTo(w.x, w.y);
  };
  const zoomBy = (f) => cam.zoomTo(clamp(cam.zoom * f, MIN_ZOOM, MAX_ZOOM), 200);

  // ---------- panels ----------
  function closePanel() {
    if (ui.panel === 'castle') layer.setSelected(null);
    ui.panelEl?.remove();
    ui.panelEl = null;
    ui.panel = null;
    syncBar();
  }

  function openPanel(kind, data) {
    if (ui.panel) {
      if (ui.panel === 'castle') layer.setSelected(null);
      ui.panelEl?.remove();
    }
    ui.panel = kind;
    let el;
    if (kind === 'castle') {
      layer.setSelected(data.id);
      el = castleCard({
        castle: data,
        distance: distanceTo(data),
        onClose: closePanel,
        onCenter: () => flyTo(data.worldX, data.worldY),
        onCopy: () => copyCoords(data),
      });
    } else if (kind === 'kingdoms') {
      el = kingdomsDrawer({
        castles: castles(),
        playerId: player.id,
        distanceTo,
        onClose: closePanel,
        onPick: (c) => {
          flyTo(c.worldX, c.worldY);
          openPanel('castle', c);
        },
      });
    } else if (kind === 'settings') {
      el = settingsModal({
        onClose: closePanel,
        onChangeCiv: () => {
          closePanel();
          onChangeCiv?.();
        },
      });
    } else if (kind === 'map') {
      el = bigMap();
    }
    ui.panelEl = el;
    root.appendChild(el);
    syncBar();
  }

  function togglePanel(kind) {
    if (ui.panel === kind) closePanel();
    else openPanel(kind);
  }

  function bigMap() {
    const width = Math.min(window.innerWidth - 60, 860);
    const mm = new Minimap({
      map,
      width,
      onNavigate: (wx, wy) => {
        closePanel();
        flyTo(wx, wy);
      },
    });
    mm.setCastles(castles());
    mm.setView(cam.worldView);
    setTimeout(() => mm.draw(), 60);
    mm.draw();
    const legend = h(
      'div',
      { class: 'ui-legend' },
      ...['persia', 'mongol', 'arab', 'japan', 'rome', 'viking'].map((id) =>
        h('span', { class: 'ui-chip', style: { '--chip': hex(civById(id).color) } }, h('i'), civText(id).name)
      ),
      h('span', { class: 'ui-chip', style: { '--chip': '#ffd34d' } }, h('i'), t('map.legend'))
    );
    return modal({ title: t('map.title'), wide: true, onClose: closePanel, body: h('div', { class: 'ui-bigmap' }, mm.canvas, legend) });
  }

  async function copyCoords(c) {
    const text = `${Math.round(c.tileX)}, ${Math.round(c.tileY)}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        /* ignore */
      }
      ta.remove();
    }
    toasts.show(t('castle.copied'), 1800);
  }

  // ---------- HUD ----------
  function actionButton(name, labelKey, key, onClick, panelKind) {
    const btn = h(
      'button',
      { class: 'ui-act', type: 'button', 'aria-label': t(labelKey), title: key ? `${t(labelKey)} (${key})` : t(labelKey), onClick },
      key ? h('kbd', {}, key) : null,
      icon(name, 24),
      h('span', {}, t(labelKey))
    );
    if (panelKind) ui.bar[panelKind] = btn;
    return btn;
  }

  function syncBar() {
    for (const [kind, btn] of Object.entries(ui.bar)) btn.setAttribute('aria-pressed', String(ui.panel === kind));
  }

  function goTo(value) {
    const nums = toLatinDigits(value).split(/[\s,،;]+/).filter(Boolean).map(Number);
    const { width, height } = map.manifest.grid;
    if (nums.length !== 2 || nums.some((n) => !Number.isFinite(n)) || nums[0] < 0 || nums[1] < 0 || nums[0] >= width || nums[1] >= height) {
      return false;
    }
    flyToTile(nums[0], nums[1]);
    return true;
  }

  function build() {
    root.replaceChildren();
    ui.bar = {};
    root.setAttribute('dir', getDir());
    root.style.setProperty('--accent', hex(civ.color));
    root.style.setProperty('--accent-ink', inkFor(civ.color));
    root.style.setProperty('--ui-scale', String(settings.get('uiScale')));

    // player card
    root.appendChild(
      h(
        'div',
        { class: 'ui-player ui-glass ui-z' },
        h('div', { class: 'ui-avatar' }, Array.from(player.name)[0]?.toUpperCase() ?? '?'),
        h('div', { class: 'ui-player-meta' }, h('div', { class: 'ui-player-name', dir: 'auto' }, player.name), h('div', { class: 'ui-player-civ' }, civText(civ.id).name))
      )
    );

    // minimap + coordinates
    const small = window.innerWidth <= 720;
    ui.minimap = new Minimap({ map, width: small ? 150 : 240, onNavigate: (wx, wy) => cam.centerOn(wx, wy) });
    ui.minimap.setCastles(castles());
    ui.coords = h('div', { class: 'ui-coords', 'aria-live': 'off' }, 'X 0 · Y 0');
    const topRight = h('div', { class: 'ui-topright ui-z' });
    if (settings.get('minimap')) {
      topRight.appendChild(h('div', { class: 'ui-minimap ui-glass', role: 'group', 'aria-label': t('hud.minimap') }, ui.minimap.canvas));
    }
    topRight.appendChild(ui.coords);
    root.appendChild(topRight);

    // zoom
    root.appendChild(
      h(
        'div',
        { class: 'ui-zoom ui-z' },
        h('button', { class: 'ui-btn ui-glass', type: 'button', 'aria-label': t('hud.zoomIn'), title: t('hud.zoomIn'), onClick: () => zoomBy(1.25) }, icon('plus')),
        h('button', { class: 'ui-btn ui-glass', type: 'button', 'aria-label': t('hud.zoomOut'), title: t('hud.zoomOut'), onClick: () => zoomBy(0.8) }, icon('minus'))
      )
    );

    // action bar
    root.appendChild(
      h(
        'div',
        { class: 'ui-bar' },
        h(
          'div',
          { class: 'ui-bar-inner ui-glass ui-z' },
          actionButton('home', 'hud.home', 'H', goHome),
          actionButton('crown', 'hud.kingdoms', 'K', () => togglePanel('kingdoms'), 'kingdoms'),
          actionButton('map', 'hud.map', 'M', () => togglePanel('map'), 'map'),
          actionButton('gear', 'hud.settings', '', () => togglePanel('settings'), 'settings')
        )
      )
    );

    // go to coordinates
    const input = h('input', { class: 'ui-input', type: 'text', inputmode: 'text', placeholder: t('hud.goPlaceholder'), 'aria-label': t('hud.goTo'), autocomplete: 'off' });
    const msg = h('div', { class: 'ui-goto-msg', hidden: true }, t('hud.goBad'));
    const submit = () => {
      if (goTo(input.value)) {
        input.value = '';
        input.blur();
      } else {
        msg.hidden = false;
        clearTimeout(ui.goMsgTimer);
        ui.goMsgTimer = setTimeout(() => (msg.hidden = true), 2600);
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') input.blur();
    });
    ui.goInput = input;
    root.appendChild(
      h('div', { class: 'ui-goto ui-glass ui-z' }, msg, input, h('button', { class: 'ui-btn primary', type: 'button', onClick: submit }, icon('search', 18), t('hud.goTo')))
    );

    root.appendChild(toasts.el);
    if (ui.panel) {
      const kind = ui.panel;
      ui.panel = null;
      ui.panelEl = null;
      const current = ui.selected;
      if (kind === 'castle' && current) openPanel('castle', current);
      else if (kind !== 'castle') openPanel(kind);
    }
    syncBar();
  }

  function goHome() {
    flyTo(player.worldX, player.worldY);
    ui.selected = player;
    openPanel('castle', player);
  }

  function selectCastle(c) {
    ui.selected = c;
    openPanel('castle', c);
  }

  // ---------- keyboard ----------
  function onKey(e) {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key) {
      case 'h':
      case 'H':
        goHome();
        break;
      case 'k':
      case 'K':
        togglePanel('kingdoms');
        break;
      case 'm':
      case 'M':
        togglePanel('map');
        break;
      case '+':
      case '=':
        zoomBy(1.25);
        break;
      case '-':
      case '_':
        zoomBy(0.8);
        break;
      case '/':
        e.preventDefault();
        ui.goInput?.focus();
        break;
      case 'Escape':
        if (ui.panel) closePanel();
        break;
      default:
    }
  }
  window.addEventListener('keydown', onKey);

  // ---------- per-frame refresh (10 Hz) ----------
  let acc = 0;
  const onUpdate = (_time, delta) => {
    acc += delta;
    if (acc < 100) return;
    acc = 0;
    const mid = cam.midPoint;
    const tile = map.worldToTile(mid.x, mid.y);
    if (ui.coords) ui.coords.textContent = `X ${Math.round(tile.x)} · Y ${Math.round(tile.y)}`;
    if (ui.minimap) {
      ui.minimap.setView(cam.worldView);
      ui.minimap.draw();
    }
  };
  scene.events.on('update', onUpdate);

  // ---------- reactions ----------
  layer.events.on('select', selectCastle);
  const offSettings = settings.onChange((k, v) => {
    if (k === 'showNames') layer.setNamesVisible(v);
    else if (k === 'nameScale') layer.setNameScale(v);
    else if (k === 'uiScale') root.style.setProperty('--ui-scale', String(v));
    else if (k === 'minimap') build();
  });
  const offLang = onLangChange(() => build());

  layer.setNamesVisible(settings.get('showNames'));
  layer.setNameScale(settings.get('nameScale'));
  build();
  toasts.show(t('welcome', { name: player.name, civ: civText(civ.id).name }), 4200);

  return {
    root,
    toast: (text, ms) => toasts.show(text, ms),
    flyToTile,
    openPanel,
    closePanel,
    destroy() {
      window.removeEventListener('keydown', onKey);
      scene.events.off('update', onUpdate);
      layer.events.off('select', selectCastle);
      offSettings();
      offLang();
      layer.setSelected(null);
      root.remove();
    },
  };
}
