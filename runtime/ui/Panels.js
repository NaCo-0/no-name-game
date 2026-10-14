/**
 * Panels
 * ------
 * Pure view builders: each function returns a DOM element and takes callbacks.
 * GameUI decides when to show them. Keeping them dumb makes them easy to
 * restyle or replace.
 */
import { h, hex } from './dom.js';
import { icon } from './icons.js';
import { t, num, civText, getLang, setLang, LANGS } from './i18n.js';
import { settings } from './Settings.js';
import { civById } from '../civilizations.js';

const initial = (name) => Array.from(name.trim())[0]?.toUpperCase() ?? '?';

function closeButton(onClose) {
  return h('button', { class: 'ui-x', type: 'button', 'aria-label': t('hud.close'), onClick: onClose }, icon('close', 20));
}

/** Shared modal frame (settings, big map). */
export function modal({ title, body, onClose, wide = false }) {
  const panel = h(
    'div',
    { class: `ui-modal ui-glass ui-z${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'ui-modal-head' }, h('h2', {}, title), closeButton(onClose)),
    body
  );
  const backdrop = h('div', { class: 'ui-backdrop', onClick: (e) => e.target === backdrop && onClose() }, panel);
  return backdrop;
}

/** Info card for one castle. */
export function castleCard({ castle, distance, onClose, onCenter, onCopy }) {
  const civ = civById(castle.civId);
  const info = civText(castle.civId);
  const rows = [
    h('dt', {}, t('castle.civ')),
    h('dd', {}, info.name),
    h('dt', {}, t('castle.location')),
    h('dd', {}, `X ${num(castle.tileX)} · Y ${num(castle.tileY)}`),
  ];
  if (!castle.isPlayer) rows.push(h('dt', {}, t('castle.distance')), h('dd', {}, t('castle.tiles', { n: num(distance) })));

  const head = h(
    'div',
    { class: 'ui-card-head' },
    h('div', { class: 'ui-avatar', style: { background: hex(civ.color) } }, initial(castle.name)),
    h(
      'div',
      { class: 'ui-card-title' },
      h('b', { dir: 'auto' }, castle.name),
      h('span', { class: 'ui-chip', style: { '--chip': hex(civ.color) } }, h('i'), castle.isPlayer ? t('castle.yours') : info.tagline)
    ),
    closeButton(onClose)
  );
  return h(
    'div',
    { class: 'ui-card ui-glass ui-z', role: 'dialog', 'aria-label': castle.name },
    head,
    h('dl', { class: 'ui-rows' }, rows),
    h(
      'div',
      { class: 'ui-card-actions' },
      h('button', { class: 'ui-btn primary', type: 'button', onClick: onCenter }, icon('target', 18), t('castle.center')),
      h('button', { class: 'ui-btn', type: 'button', onClick: onCopy }, icon('copy', 18), t('castle.copy'))
    )
  );
}

/** Side drawer (bottom sheet on phones) listing every castle, nearest first. */
export function kingdomsDrawer({ castles, playerId, distanceTo, onPick, onClose }) {
  const sorted = [...castles].sort((a, b) => (a.id === playerId ? -1 : b.id === playerId ? 1 : distanceTo(a) - distanceTo(b)));
  const rows = sorted.map((c) => {
    const civ = civById(c.civId);
    const me = c.id === playerId;
    return h(
      'button',
      { class: `ui-row${me ? ' me' : ''}`, type: 'button', style: { '--chip': hex(civ.color) }, onClick: () => onPick(c) },
      h('span', { class: 'dot' }, initial(c.name)),
      h('span', { class: 'txt' }, h('b', { dir: 'auto' }, c.name), h('span', {}, civText(c.civId).name)),
      h('span', { class: 'dist' }, me ? t('hud.you') : t('castle.tiles', { n: num(distanceTo(c)) }))
    );
  });
  return h(
    'section',
    { class: 'ui-drawer ui-glass', role: 'dialog', 'aria-label': t('kingdoms.title') },
    h(
      'div',
      { class: 'ui-drawer-head' },
      h('h2', {}, t('kingdoms.title')),
      h('small', {}, t('kingdoms.count', { n: num(castles.length) })),
      closeButton(onClose)
    ),
    h('div', { class: 'ui-list' }, rows)
  );
}

function segmented(options, current, onPick) {
  const wrap = h('div', { class: 'ui-seg', role: 'group' });
  for (const [value, label] of options) {
    wrap.appendChild(
      h('button', { type: 'button', 'aria-pressed': String(value === current), onClick: () => onPick(value) }, label)
    );
  }
  return wrap;
}

function toggle(checked, label, onChange) {
  const sw = h('button', { class: 'ui-switch', type: 'button', role: 'switch', 'aria-checked': String(checked), 'aria-label': label });
  sw.addEventListener('click', () => {
    const next = sw.getAttribute('aria-checked') !== 'true';
    sw.setAttribute('aria-checked', String(next));
    onChange(next);
  });
  return sw;
}

/** Settings dialog. Changes apply immediately and are saved. */
export function settingsModal({ onClose, onChangeCiv }) {
  const lang = getLang();
  const body = h(
    'div',
    { class: 'ui-set' },
    h(
      'div',
      { class: 'ui-field' },
      h('span', { class: 'l' }, t('settings.language')),
      segmented(LANGS.map((l) => [l, l === 'fa' ? 'فارسی' : 'English']), lang, (l) => setLang(l))
    ),
    h('div', { class: 'ui-field' }, h('span', { class: 'l' }, t('settings.showNames')), toggle(settings.get('showNames'), t('settings.showNames'), (v) => settings.set('showNames', v))),
    h(
      'div',
      { class: 'ui-field' },
      h('span', { class: 'l' }, t('settings.nameSize')),
      h('input', {
        class: 'ui-range',
        type: 'range',
        min: '0.7',
        max: '1.5',
        step: '0.1',
        value: String(settings.get('nameScale')),
        'aria-label': t('settings.nameSize'),
        onInput: (e) => settings.set('nameScale', Number(e.target.value)),
      })
    ),
    h(
      'div',
      { class: 'ui-field' },
      h('span', { class: 'l' }, t('settings.uiSize')),
      segmented(
        [
          [0.85, t('settings.small')],
          [1, t('settings.medium')],
          [1.2, t('settings.large')],
        ],
        settings.get('uiScale'),
        (v) => settings.set('uiScale', v)
      )
    ),
    h('div', { class: 'ui-field' }, h('span', { class: 'l' }, t('settings.minimap')), toggle(settings.get('minimap'), t('settings.minimap'), (v) => settings.set('minimap', v))),
    h('button', { class: 'ui-btn danger', type: 'button', onClick: onChangeCiv }, t('settings.changeCiv')),
    h('p', { class: 'ui-hint' }, t('settings.changeCivHint'))
  );
  return modal({ title: t('settings.title'), body, onClose });
}
