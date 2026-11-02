/** Battle report modal (camp or castle). */
import { h } from './dom.js';
import { num, getLang } from './i18n.js';
import { modal } from './Panels.js';
import { bt } from './battleI18n.js';

const list = (o, label = (k) => k) => {
  const e = Object.entries(o || {}).filter(([, n]) => n > 0);
  return e.length ? e.map(([k, n]) => `${label(k)} ×${num(n)}`).join(getLang() === 'fa' ? '، ' : ', ') : bt('none');
};

export function battleReport({ report, onClose }) {
  const r = report || {};
  const rows = [];
  const row = (k, v) => rows.push(h('dt', {}, k), h('dd', {}, v));
  if (r.gone) row(bt('title.report'), bt('gone'));
  else {
    row(`${bt('power')} (${bt('you')})`, num(r.attackerPower || 0));
    row(`${bt('power')} (${bt('enemy')})`, num(r.defenderPower || 0));
    row(bt('survivors'), list(r.survivors));
    row(bt('losses'), list(r.losses));
    if (r.castle) { row(`${bt('dead')} (${bt('enemy')})`, list(r.dead)); row(`${bt('wounded')} (${bt('enemy')})`, list(r.wounded)); }
    row(bt('loot'), list(r.loot, (k) => bt(`res.${k}`)));
  }
  const log = (r.log || []).map((l) => h('li', {}, `${bt('tick', { n: num(l.tick) })}: ${bt('alive', { a: num(l.attackerAlive), d: num(l.defenderAlive) })}`));
  const body = h('div', { class: 'ui-set' },
    h('span', { class: 'ui-chip', style: { '--chip': r.win ? '#3fb950' : '#e5534b' } }, h('i'), r.win ? bt('win') : bt('loss')),
    r.ticks ? h('p', { class: 'ui-hint' }, bt('ticks', { n: num(r.ticks) })) : null,
    h('dl', { class: 'ui-rows' }, rows),
    log.length ? h('div', {}, h('b', {}, bt('log')), h('ol', { class: 'ui-hint' }, log)) : null,
    h('button', { class: 'ui-btn primary', type: 'button', onClick: onClose }, 'OK'));
  return modal({ title: bt('title.report'), body, onClose });
}
