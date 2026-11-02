/** Formation picker (attack or defense): formation, 4 slots, live cap check and power. */
import { h } from './dom.js';
import { num, onLangChange } from './i18n.js';
import { modal } from './Panels.js';
import { bt } from './battleI18n.js';

/**
 * @param {object} o
 * @param {'attack'|'defense'} o.mode
 * @param {Object<string,number>} o.army   troops the player owns { troopId: n }
 * @param {object} o.config                 GET /api/game/battle-config
 * @param {(layout:object) => void} o.onSubmit
 * @param {() => void} o.onClose
 */
export function formationPanel({ mode, army, config, onSubmit, onClose }) {
  const slots = config.slots || ['S1', 'S2', 'S3', 'S4'];
  const ids = Object.keys(army || {}).filter((id) => army[id] > 0 && config.stats[id]);
  const state = { formation: Object.keys(config.formations)[0], cls: {}, n: {} };
  for (const s of slots) { state.cls[s] = ''; state.n[s] = {}; }
  // start: each class in its own slot, as many troops as the caps allow
  const classes = [...new Set(ids.map((id) => config.stats[id].cls))];
  classes.slice(0, slots.length).forEach((c, i) => { state.cls[slots[i]] = c; });

  const wrap = h('div', { class: 'ui-set' });
  let offLang = null;

  const used = (id, except) => slots.reduce((a, s) => a + (s === except ? 0 : state.n[s][id] || 0), 0);
  const layout = () => {
    const out = {};
    for (const s of slots) {
      const o = {};
      for (const [id, n] of Object.entries(state.n[s])) if (n > 0 && config.stats[id]?.cls === state.cls[s]) o[id] = n;
      out[s] = o;
    }
    return { formation: state.formation, slots: out };
  };
  const check = () => {
    const l = layout();
    const size = Object.fromEntries(slots.map((s) => [s, Object.values(l.slots[s]).reduce((a, b) => a + b, 0)]));
    const total = Object.values(size).reduce((a, b) => a + b, 0);
    const caps = config.formations[state.formation].caps;
    const max = Object.fromEntries(slots.map((s) => [s, Math.ceil(caps[s] * total)]));
    const over = slots.find((s) => size[s] > max[s]);
    let power = 0;
    for (const s of slots) for (const [id, n] of Object.entries(l.slots[s])) power += n * (config.power[id] || 0);
    return { l, size, total, max, over, power, error: !total ? bt('empty') : over ? bt('overCap', { slot: bt(`slot.${over}`) }) : '' };
  };

  function slotCard(s, c) {
    const sel = h('select', { class: 'ui-input', 'aria-label': bt(`slot.${s}`), onChange: (e) => { state.cls[s] = e.target.value; state.n[s] = {}; render(); } },
      h('option', { value: '' }, bt('cls.none')),
      ...classes.map((k) => { const o = h('option', { value: k }, bt(`cls.${k}`)); if (k === state.cls[s]) o.selected = true; return o; }));
    const inputs = ids.filter((id) => config.stats[id].cls === state.cls[s]).map((id) => {
      const free = army[id] - used(id, s);
      const inp = h('input', { class: 'ui-input', type: 'number', min: '0', max: String(free), step: '1', value: String(state.n[s][id] || 0), 'aria-label': id });
      inp.addEventListener('change', () => {
        const v = Math.max(0, Math.min(free, Math.floor(Number(inp.value) || 0)));
        state.n[s][id] = v; render();
      });
      return h('label', { class: 'ui-field' }, h('span', { class: 'l' }, `${id} (${bt('owned', { n: num(army[id]) })})`), inp);
    });
    const bad = c.size[s] > c.max[s];
    return h('div', { class: 'ui-card-section', style: { border: `1px solid ${bad ? '#e5534b' : 'rgba(255,255,255,.15)'}`, borderRadius: '10px', padding: '8px', marginBottom: '8px' } },
      h('div', { class: 'ui-field' }, h('b', {}, bt(`slot.${s}`)), h('span', { class: 'ui-chip' }, bt('cap', { n: num(c.size[s]), max: num(c.max[s]) }))),
      sel, ...inputs);
  }

  function render() {
    const c = check();
    const f = config.formations[state.formation];
    const seg = h('div', { class: 'ui-seg', role: 'group' },
      ...Object.keys(config.formations).map((id) => h('button', { type: 'button', 'aria-pressed': String(id === state.formation), onClick: () => { state.formation = id; render(); } }, bt(`f.${id}`))));
    wrap.replaceChildren(
      h('div', { class: 'ui-field' }, h('span', { class: 'l' }, bt('formation')), seg),
      h('p', { class: 'ui-hint' }, bt('beats', { list: f.beats.map((b) => bt(`f.${b}`)).join(', ') })),
      ...slots.map((s) => slotCard(s, c)),
      h('dl', { class: 'ui-rows' }, h('dt', {}, bt('total')), h('dd', {}, num(c.total)), h('dt', {}, bt('power')), h('dd', {}, num(c.power))),
      c.error ? h('p', { class: 'ui-hint', role: 'alert', style: { color: '#e5534b' } }, c.error) : null,
      h('div', { class: 'ui-card-actions' },
        h('button', { class: 'ui-btn primary', type: 'button', disabled: !!c.error, onClick: () => { if (!check().error) onSubmit(check().l); } }, mode === 'defense' ? bt('save') : bt('submit')),
        h('button', { class: 'ui-btn', type: 'button', onClick: close }, bt('cancel'))));
  }

  // fill the starting layout up to the caps
  const allTotal = ids.reduce((a, id) => a + army[id], 0);
  for (const s of slots) {
    let room = Math.ceil(config.formations[state.formation].caps[s] * allTotal);
    for (const id of ids) if (config.stats[id].cls === state.cls[s] && room > 0) { const k = Math.min(room, army[id] - used(id)); if (k > 0) { state.n[s][id] = k; room -= k; } }
  }

  function close() { offLang?.(); onClose?.(); }
  render();
  offLang = onLangChange(() => render());
  return modal({ title: mode === 'defense' ? bt('title.defense') : bt('title.attack'), body: wrap, onClose: close, wide: true });
}
