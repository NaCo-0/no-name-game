/**
 * BattleSheets
 * ------------
 * React UI for battles in game.html:
 *   - FormationSheet : formation + 4-slot battlefield (two troop types per slot), for ATTACK and castle DEFENSE
 *   - GuideSheet     : what slots, formations and troop types do (counter wheels, numbers from the server)
 *   - CastleSheet    : tap another player's castle on the world map
 *   - ReportView / ReportSheet : full battle report (camp or castle, attacker or defender view)
 *   - RaidSheet      : "your castle was attacked" notice
 *   - CampMatchup    : what your army does against a camp (formation counter, troop counters)
 *
 * The layout format is the server's (backend/src/battle.js):
 *   { formation, slots: { S1: {troopId: n}, S2: {}, S3: {}, S4: {} } }   up to TWO troop types (classes) per slot.
 * All numbers (caps, bonuses, counters) come from GET /api/game/battle-config; the pure helpers below
 * mirror backend/src/battle.js + battleConfig.js (autoLayout, layoutPower, analyze) so the preview matches the server.
 */

export const SLOTS = ['S1', 'S2', 'S3', 'S4'];
export const CLASS_ORDER = ['spear', 'sword', 'cav', 'archer'];

export const CLASS_INFO = {
  spear: { name: 'Spear', color: '#5aa9e6' },
  sword: { name: 'Sword', color: '#e5645a' },
  cav: { name: 'Cavalry', color: '#e6a84a' },
  archer: { name: 'Archer', color: '#6cc47c' },
};

export const SLOT_INFO = {
  S1: { name: 'Front line', short: 'front line', role: 'Meets the enemy first', hint: 'Takes the most fire. Spears hold it best (-15% damage taken); Swords hit hardest here (+10%). Archers and Cavalry are weak here.' },
  S2: { name: 'Left flank', short: 'left flank', role: 'Wraps around', hint: 'Hits the enemy right flank and rear. Cavalry charge here for +25% attack.' },
  S3: { name: 'Right flank', short: 'right flank', role: 'Wraps around', hint: 'Hits the enemy left flank and rear. Cavalry charge here for +25% attack.' },
  S4: { name: 'Rear', short: 'rear', role: 'Safest place', hint: 'Draws the least fire. Archers shoot +25% harder here and take 10% less damage.' },
};

export const FORM_INFO = {
  wedge: { name: 'Wedge' }, shield_wall: { name: 'Shield wall' }, flank: { name: 'Flank' }, scattered: { name: 'Scattered' }, crescent: { name: 'Crescent' },
};

const PREF = { spear: ['S1', 'S2', 'S3', 'S4'], sword: ['S1', 'S3', 'S2', 'S4'], cav: ['S2', 'S3', 'S1', 'S4'], archer: ['S4', 'S3', 'S2', 'S1'] };

const sumOf = (o) => Object.values(o || {}).reduce((a, n) => a + (n > 0 ? n : 0), 0);
const prettyId = (id) => String(id || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const cname = (c) => (CLASS_INFO[c] || {}).name || c;
export const fname = (id) => (FORM_INFO[id] || {}).name || prettyId(id);
const pctOf = (m) => { const v = Math.round((m - 1) * 100); return (v > 0 ? '+' : v < 0 ? '\u2212' : '') + Math.abs(v) + '%'; };

/** { S1: {}, S2: {}, S3: {}, S4: {} } */
export const emptySlots = () => Object.fromEntries(SLOTS.map((s) => [s, {}]));

/** Sum of all slots -> { troopId: n } */
export function layoutArmy(layout) {
  const out = {};
  for (const s of SLOTS) for (const [id, n] of Object.entries((layout && layout.slots && layout.slots[s]) || {})) if (n > 0) out[id] = (out[id] || 0) + n;
  return out;
}

const limitOf = (config) => config.slotClassLimit || 2;

/** Same algorithm as the server's autoLayout: preferred slots per class, caps respected when possible, two types per slot. */
export function autoLayout(army, formation, config) {
  const forms = config.formations;
  if (!forms[formation]) formation = forms.wedge ? 'wedge' : Object.keys(forms)[0];
  const f = forms[formation], limit = limitOf(config);
  const by = {};
  let total = 0;
  for (const [id, n] of Object.entries(army || {})) {
    const st = config.stats[id];
    const k = Math.floor(Number(n) || 0);
    if (!st || k <= 0) continue;
    (by[st.cls] ||= []).push([id, k, st.level]);
    total += k;
  }
  const slots = emptySlots();
  if (!total) return { formation, slots };
  const sum = (l) => l.reduce((a, q) => a + q[1], 0);
  const classes = Object.keys(by).sort((a, b) => sum(by[b]) - sum(by[a]) || (a < b ? -1 : 1));
  for (const c of classes) by[c].sort((a, b) => b[2] - a[2] || (a[0] < b[0] ? -1 : 1));
  const cap = (s) => Math.ceil(f.caps[s] * total);
  const size = { S1: 0, S2: 0, S3: 0, S4: 0 };
  const has = { S1: new Set(), S2: new Set(), S3: new Set(), S4: new Set() };
  const allowed = (s, c) => has[s].has(c) || has[s].size < limit;
  const put = (s, c, queue, lim) => {
    while (queue.length && size[s] < lim) {
      const q = queue[0], k = Math.min(q[1], lim - size[s]);
      slots[s][q[0]] = (slots[s][q[0]] || 0) + k; size[s] += k; q[1] -= k; has[s].add(c);
      if (!q[1]) queue.shift();
    }
  };
  for (const c of classes) {
    const queue = by[c].map((q) => [q[0], q[1]]);
    for (const s of PREF[c]) if (allowed(s, c)) put(s, c, queue, cap(s));
    if (queue.length) put(PREF[c].find((s) => allowed(s, c)) || 'S1', c, queue, Infinity);
  }
  return { formation, slots };
}

/** Size, caps, power and the first problem of a layout (the rules the server enforces). */
export function layoutStats(layout, config) {
  const f = config.formations[layout.formation] || Object.values(config.formations)[0];
  const size = {}, max = {}, kinds = {};
  let total = 0;
  for (const s of SLOTS) {
    const slot = (layout.slots && layout.slots[s]) || {};
    size[s] = sumOf(slot);
    kinds[s] = new Set(Object.entries(slot).filter(([id, n]) => n > 0 && config.stats[id]).map(([id]) => config.stats[id].cls)).size;
    total += size[s];
  }
  for (const s of SLOTS) max[s] = Math.ceil(f.caps[s] * total);
  const over = SLOTS.filter((s) => size[s] > max[s]);
  const tooMany = SLOTS.filter((s) => kinds[s] > limitOf(config));
  let error = '';
  if (!total) error = 'Place at least one soldier';
  else if (over.length) error = SLOT_INFO[over[0]].name + ' is over its limit. Move soldiers to another position or pick another formation';
  else if (tooMany.length) error = SLOT_INFO[tooMany[0]].name + ' can hold only ' + limitOf(config) + ' troop types';
  return { size, max, total, over, error, power: Math.round(layoutPower(layout, config)) };
}

export function bestAutoLayout(army, preferred, config) {
  const order = [preferred, ...Object.keys(config.formations).filter((f) => f !== preferred)].filter((f) => config.formations[f]);
  let first = null;
  for (const f of order) {
    const l = autoLayout(army, f, config);
    if (!first) first = l;
    if (!layoutStats(l, config).error) return l;
  }
  return first;
}

/** The formation that beats `vs` and fits this army (falls back to the best fitting one). */
export function pickCounterFormation(army, vs, config) {
  for (const f of Object.keys(config.formations).filter((x) => config.formations[x].beats.includes(vs))) if (!layoutStats(autoLayout(army, f, config), config).error) return f;
  return bestAutoLayout(army, 'wedge', config).formation;
}

const FLAT = { atk: 1, take: 1 };
function groupMods(slot, cls, formation, config) {
  const a = ((config.affinity || {})[slot] || {})[cls] || FLAT;
  const fm = (config.formationMods || {})[formation] || { atk: {}, take: {} };
  return { atk: a.atk * ((fm.atk || {})[slot] ?? 1), take: a.take * ((fm.take || {})[slot] ?? 1) };
}
function classShares(army, config) {
  const by = {};
  let total = 0;
  for (const [id, n] of Object.entries(army || {})) {
    const s = config.stats[id];
    if (!s || !(n > 0)) continue;
    const p = n * (config.power[id] || 0);
    by[s.cls] = (by[s.cls] || 0) + p; total += p;
  }
  for (const k of Object.keys(by)) by[k] /= total || 1;
  return by;
}

/** Power of a layout incl. slot + formation multipliers and, with `enemy` (a layout), the counters. Mirrors backend layoutPower. */
export function layoutPower(layout, config, enemy) {
  const share = enemy ? classShares(layoutArmy(enemy), config) : {};
  const beatsOf = (f) => (config.formations[f] && config.formations[f].beats) || [];
  const mine = enemy && beatsOf(layout.formation).includes(enemy.formation) ? 1 + config.formationBonus : 1;
  const theirs = enemy && beatsOf(enemy.formation).includes(layout.formation) ? 1 + config.formationBonus : 1;
  let power = 0;
  for (const s of SLOTS) {
    for (const [id, n] of Object.entries((layout.slots && layout.slots[s]) || {})) {
      const st = config.stats[id];
      if (!st || !(n > 0)) continue;
      const m = groupMods(s, st.cls, layout.formation, config);
      const strong = share[config.counters[st.cls]] || 0;
      const weak = Object.entries(config.counters).reduce((a, [c, beats]) => a + (beats === st.cls ? share[c] || 0 : 0), 0);
      power += n * (config.power[id] || 0) * Math.sqrt(m.atk / m.take) * (1 + config.counterBonus * strong - config.counterBonus * weak);
    }
  }
  return power * Math.sqrt(mine / theirs);
}

/** Traits of one layout that are in play (formation perk + class x slot bonuses/penalties). Same item shape as the server's. */
export function ownEffects(layout, config) {
  const items = [];
  const fm = (config.formationMods || {})[layout.formation];
  if (fm) items.push({ type: 'formation', formation: layout.formation, atk: fm.atk || {}, take: fm.take || {}, spread: fm.spread || 0 });
  for (const s of SLOTS) {
    const by = {};
    for (const [id, n] of Object.entries((layout.slots && layout.slots[s]) || {})) { const st = config.stats[id]; if (st && n > 0) by[st.cls] = (by[st.cls] || 0) + n; }
    for (const [cls, n] of Object.entries(by)) {
      const a = (((config.affinity || {})[s]) || {})[cls] || FLAT;
      if (a.atk !== 1 || a.take !== 1) items.push({ type: 'slot', slot: s, cls, atk: a.atk, take: a.take, n });
    }
  }
  return items;
}

/** Own traits + formation counter + class counters, for both sides. */
export function analyze(attLayout, defLayout, config) {
  const side = (me, foe) => {
    const out = ownEffects(me, config);
    const beats = (a, b) => ((config.formations[a] || {}).beats || []).includes(b);
    if (beats(me.formation, foe.formation)) out.push({ type: 'formation_counter', formation: me.formation, over: foe.formation, value: config.formationBonus });
    if (beats(foe.formation, me.formation)) out.push({ type: 'formation_weak', formation: me.formation, over: foe.formation, value: config.formationBonus });
    const a = classShares(layoutArmy(me), config), b = classShares(layoutArmy(foe), config);
    for (const c of Object.keys(a)) for (const e of Object.keys(b)) {
      if (config.counters[c] === e) out.push({ type: 'class_counter', cls: c, vs: e, value: config.counterBonus, share: a[c], vsShare: b[e] });
      if (config.counters[e] === c) out.push({ type: 'class_weak', cls: c, vs: e, value: config.counterBonus, share: a[c], vsShare: b[e] });
    }
    return out;
  };
  return { att: side(attLayout, defLayout), def: side(defLayout, attLayout) };
}

/** Text + tone ('good' | 'bad' | 'info') of one effect item. */
export function effectText(it) {
  const slotName = (s) => (SLOT_INFO[s] || {}).short || s;
  if (it.type === 'formation') {
    const parts = [];
    const group = (obj, word, down) => {
      const by = {};
      for (const [s, m] of Object.entries(obj || {})) (by[m] ||= []).push(slotName(s));
      for (const [m, ss] of Object.entries(by)) parts.push(ss.join(' & ') + ' ' + word + ' ' + pctOf(Number(m)));
    };
    group(it.atk, 'attack'); group(it.take, 'damage taken');
    if (it.spread) parts.push('enemy fire is spread thin');
    return { tone: 'info', text: fname(it.formation) + ': ' + (parts.join(', ') || 'no special perk') };
  }
  if (it.type === 'slot') {
    const parts = [];
    if (it.atk !== 1) parts.push('attack ' + pctOf(it.atk));
    if (it.take !== 1) parts.push('damage taken ' + pctOf(it.take));
    const good = (it.atk >= 1 && it.take <= 1);
    return { tone: good ? 'good' : 'bad', text: cname(it.cls) + ' in the ' + slotName(it.slot) + ': ' + parts.join(', ') };
  }
  if (it.type === 'formation_counter') return { tone: 'good', text: fname(it.formation) + ' beats ' + fname(it.over) + ': ' + pctOf(1 + it.value) + ' attack' };
  if (it.type === 'formation_weak') return { tone: 'bad', text: fname(it.over) + ' beats ' + fname(it.formation) + ': enemy ' + pctOf(1 + it.value) + ' attack' };
  if (it.type === 'class_counter') return { tone: 'good', text: cname(it.cls) + ' counter ' + cname(it.vs) + ': ' + pctOf(1 + it.value) + ' damage to them' };
  if (it.type === 'class_weak') return { tone: 'bad', text: cname(it.vs) + ' counter your ' + cname(it.cls) + ': ' + pctOf(1 - it.value) + ' damage to them' };
  return { tone: 'info', text: String(it.type) };
}

/** Editor state <-> layout. State keeps the selected troop types of every slot even while the slot is empty. */
export function stateFromLayout(layout, config) {
  const cls = {}, n = {};
  for (const s of SLOTS) {
    const slot = { ...((layout && layout.slots && layout.slots[s]) || {}) };
    for (const id of Object.keys(slot)) if (!(slot[id] > 0) || !config.stats[id]) delete slot[id];
    const set = new Set(Object.keys(slot).map((id) => config.stats[id].cls));
    cls[s] = CLASS_ORDER.filter((c) => set.has(c));
    n[s] = slot;
  }
  return { formation: layout.formation, cls, n };
}

export function layoutFromState(st, config) {
  const slots = {};
  for (const s of SLOTS) {
    const o = {};
    for (const [id, n] of Object.entries(st.n[s] || {})) if (n > 0 && config.stats[id] && (st.cls[s] || []).includes(config.stats[id].cls)) o[id] = Math.floor(n);
    slots[s] = o;
  }
  return { formation: st.formation, slots };
}

/** Formations that beat `id`, and the ones `id` beats. */
export function formationMatchups(id, config) {
  const f = config.formations;
  return { beats: f[id].beats.slice(), weak: Object.keys(f).filter((o) => o !== id && f[o].beats.includes(id)) };
}

/**
 * What your army does against a camp: the camp defends in its own formation, you automatically use a formation that counters it.
 * `troops` = the troops you send. Returns { attLayout, defLayout, myPower, foePower, effects } or null without a config.
 */
export function campPreview(troops, camp, config) {
  if (!config || !camp || !camp.army) return null;
  const defLayout = bestAutoLayout(camp.army, camp.formation || 'wedge', config);
  const sent = Object.fromEntries(Object.entries(troops || {}).filter(([, n]) => n > 0));
  if (!Object.keys(sent).length) return { attLayout: null, defLayout, myPower: 0, foePower: Math.round(layoutPower(defLayout, config)), effects: null };
  const attLayout = bestAutoLayout(sent, pickCounterFormation(sent, defLayout.formation, config), config);
  return {
    attLayout, defLayout,
    myPower: Math.round(layoutPower(attLayout, config, defLayout)), foePower: Math.round(layoutPower(defLayout, config, attLayout)),
    effects: analyze(attLayout, defLayout, config),
  };
}

/* ------------------------------------------------------------------------------------------ */

const CSS = `
.bt-sheet { padding-top: 16px; }
.bt-sub { color: var(--inksoft-color); font-size: 13px; line-height: 1.5; margin: 10px 0 14px; }
.bt-label { font-size: 10.5px; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; color: var(--inksoft-color); margin: 14px 0 7px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.bt-label button { background: none; border: none; color: var(--highlight-color); font-size: 11px; font-weight: 700; cursor: pointer; padding: 2px 0; text-transform: none; letter-spacing: 0; }

.bt-forms { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; padding: 2px 1px 6px; margin: 0 -2px; }
.bt-forms::-webkit-scrollbar { display: none; }
.bt-form { flex: 0 0 auto; min-width: 78px; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 9px 8px 8px; border-radius: 12px; cursor: pointer; background: var(--paneldeep-color); border: 1px solid var(--border-color); color: var(--inksoft-color); font-size: 11px; font-weight: 700; transition: transform .12s, border-color .15s, background .15s; }
.bt-form:active { transform: scale(.96); }
.bt-form[aria-pressed="true"] { color: var(--ink-color); border-color: var(--accent-color); background: color-mix(in srgb, var(--accent-color) 22%, var(--paneldeep-color)); box-shadow: 0 2px 10px rgba(0,0,0,.3); }
.bt-glyph { display: flex; align-items: flex-end; gap: 3px; height: 32px; }
.bt-glyph i { display: block; width: 7px; border-radius: 2px 2px 0 0; background: currentColor; opacity: .85; }
.bt-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.bt-chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; background: var(--paneldeep-color); border: 1px solid var(--border-color); color: var(--inksoft-color); }
.bt-chip.good { color: #7bd88f; border-color: color-mix(in srgb, #7bd88f 40%, transparent); background: color-mix(in srgb, #7bd88f 12%, transparent); }
.bt-chip.bad { color: #f08a80; border-color: color-mix(in srgb, #e8574a 40%, transparent); background: color-mix(in srgb, #e8574a 12%, transparent); }
.bt-chip .icon { width: 12px; height: 12px; }

.bt-axis { display: flex; align-items: center; gap: 8px; font-size: 10px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: var(--inksoft-color); opacity: .75; margin: 2px 0 8px; }
.bt-axis::before, .bt-axis::after { content: ""; flex: 1; height: 1px; background: var(--border-color); }
.bt-board { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.bt-slot { grid-column: span 1; background: var(--paneldeep-color); border: 1px solid var(--border-color); border-radius: 14px; padding: 11px 12px 12px; position: relative; overflow: hidden; transition: border-color .15s; }
.bt-slot.wide { grid-column: 1 / -1; }
.bt-slot::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--slot-color, var(--border-color)); opacity: .9; }
.bt-slot.over { border-color: #e8574a; animation: gm-shake .35s ease; }
.bt-slot-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.bt-slot-name { font-size: 13px; font-weight: 800; color: var(--ink-color); line-height: 1.2; }
.bt-slot-hint { font-size: 10.5px; color: var(--inksoft-color); margin-top: 2px; line-height: 1.3; }
.bt-count { font-size: 11px; font-weight: 800; font-variant-numeric: tabular-nums; color: var(--inksoft-color); white-space: nowrap; }
.bt-slot.over .bt-count { color: #f08a80; }
.bt-bar { height: 5px; border-radius: 3px; background: color-mix(in srgb, var(--ink-color) 12%, transparent); margin: 9px 0 10px; overflow: hidden; }
.bt-bar b { display: block; height: 100%; width: 0; border-radius: 3px; background: var(--slot-color, var(--accent-color)); transition: width .2s var(--gm-ease, ease); }
.bt-slot.over .bt-bar b { background: #e8574a; }

.bt-classes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; }
.bt-cls { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 6px 2px 5px; border-radius: 9px; cursor: pointer; background: transparent; border: 1px solid var(--border-color); color: var(--inksoft-color); font-size: 9.5px; font-weight: 700; transition: background .12s, border-color .12s, color .12s; }
.bt-cls .icon { width: 17px; height: 17px; }
.bt-cls[aria-pressed="true"] { color: var(--cls-color); border-color: var(--cls-color); background: color-mix(in srgb, var(--cls-color) 16%, transparent); }
.bt-cls:disabled { opacity: .3; cursor: default; }

.bt-troop { margin-top: 10px; }
.bt-troop-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; font-weight: 700; color: var(--ink-color); }
.bt-lv { font-size: 9.5px; font-weight: 800; padding: 1px 6px; border-radius: 999px; margin-left: 6px; color: var(--inksoft-color); border: 1px solid var(--border-color); vertical-align: 1px; }
.bt-have { font-size: 10.5px; font-weight: 600; color: var(--inksoft-color); }
.bt-ctl { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.bt-ctl input[type=range] { flex: 1; min-width: 0; accent-color: var(--slot-color, var(--accent-color)); height: 22px; }
.bt-num { width: 58px; padding: 6px 4px; text-align: center; border-radius: 8px; border: 1px solid var(--border-color); background: var(--panel-color); color: var(--ink-color); font-size: 13px; font-weight: 800; font-variant-numeric: tabular-nums; }
.bt-mini { flex: none; padding: 6px 9px; border-radius: 8px; border: 1px solid var(--border-color); background: transparent; color: var(--inksoft-color); font-size: 11px; font-weight: 800; cursor: pointer; }
.bt-mini:active { transform: scale(.95); }
.bt-empty { margin-top: 10px; font-size: 11.5px; color: var(--inksoft-color); opacity: .8; text-align: center; padding: 8px 0 2px; }
.bt-counters { font-size: 11px; line-height: 1.7; color: var(--inksoft-color); margin-top: 12px; }
.bt-counters b { color: var(--ink-color); font-weight: 700; }

.bt-foot { position: sticky; bottom: -18px; margin: 14px -20px -18px; padding: 12px 20px calc(14px + env(safe-area-inset-bottom, 0px)); background: linear-gradient(180deg, color-mix(in srgb, var(--panel-color) 0%, transparent), var(--panel-color) 22%); border-top: 1px solid var(--border-color); z-index: 2; }
.bt-totals { display: flex; gap: 18px; align-items: baseline; margin-bottom: 10px; }
.bt-total { font-size: 11px; font-weight: 700; color: var(--inksoft-color); }
.bt-total b { display: block; font-size: 19px; line-height: 1.1; color: var(--highlight-color); font-variant-numeric: tabular-nums; }
.bt-err { margin: -4px 0 10px; font-size: 12px; font-weight: 600; color: #f08a80; line-height: 1.4; }

.bt-banner { border-radius: 14px; padding: 18px 16px 16px; text-align: center; margin: 14px 0 12px; position: relative; overflow: hidden; border: 1px solid var(--bt-edge); background: radial-gradient(120% 140% at 50% 0%, color-mix(in srgb, var(--bt-tone) 34%, transparent), color-mix(in srgb, var(--bt-tone) 8%, var(--paneldeep-color))); }
.bt-banner.win { --bt-tone: #46b86a; --bt-edge: color-mix(in srgb, #46b86a 55%, transparent); }
.bt-banner.loss { --bt-tone: #e0503f; --bt-edge: color-mix(in srgb, #e0503f 55%, transparent); }
.bt-banner.raid { --bt-tone: #e0a23f; --bt-edge: color-mix(in srgb, #e0a23f 55%, transparent); }
.bt-banner h3 { margin: 0; font-size: 26px; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-color); text-shadow: 0 2px 12px color-mix(in srgb, var(--bt-tone) 60%, transparent); }
.bt-banner p { margin: 5px 0 0; font-size: 12.5px; color: var(--inksoft-color); }
.bt-vs { display: grid; grid-template-columns: 1fr auto 1fr; gap: 10px; align-items: end; }
.bt-side b { display: block; font-size: 22px; font-weight: 900; line-height: 1.1; font-variant-numeric: tabular-nums; }
.bt-side span { font-size: 11px; font-weight: 700; color: var(--inksoft-color); }
.bt-side.you b { color: #6bb7f0; }
.bt-side.foe { text-align: right; }
.bt-side.foe b { color: #f08a80; }
.bt-vs-mid { font-size: 11px; font-weight: 900; color: var(--inksoft-color); padding-bottom: 3px; }
.bt-split { display: flex; height: 8px; border-radius: 4px; overflow: hidden; margin-top: 8px; background: var(--paneldeep-color); }
.bt-split i { display: block; height: 100%; }
.bt-split i:first-child { background: #4a9fe0; }
.bt-split i:last-child { background: #e0614f; }
.bt-rounds { display: flex; align-items: stretch; gap: 7px; height: 96px; padding: 4px 2px 0; overflow-x: auto; scrollbar-width: none; }
.bt-round { flex: 1 1 0; min-width: 22px; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.bt-round div { flex: 1; width: 100%; display: flex; align-items: flex-end; justify-content: center; gap: 2px; min-height: 0; border-bottom: 1px solid var(--border-color); }
.bt-round i { display: block; width: 45%; max-width: 12px; border-radius: 3px 3px 0 0; min-height: 2px; transition: height .5s var(--gm-ease, ease); }
.bt-round i.you { background: #4a9fe0; }
.bt-round i.foe { background: #e0614f; }
.bt-round span { font-size: 9px; font-weight: 700; color: var(--inksoft-color); line-height: 1; }
.bt-legend { display: flex; gap: 14px; justify-content: center; margin-top: 10px; font-size: 10.5px; font-weight: 700; color: var(--inksoft-color); }
.bt-legend i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 5px; }
.bt-group { margin-top: 12px; padding: 11px 12px; border-radius: 12px; background: var(--paneldeep-color); border: 1px solid var(--border-color); }
.bt-group h4 { margin: 0 0 7px; font-size: 10.5px; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; color: var(--inksoft-color); }
.bt-line { display: flex; gap: 10px; align-items: baseline; justify-content: space-between; font-size: 12.5px; padding: 3px 0; }
.bt-line > span:first-child { color: var(--inksoft-color); flex: none; }
.bt-line > span:last-child { text-align: right; font-weight: 700; color: var(--ink-color); }
.bt-loot { display: flex; flex-wrap: wrap; gap: 8px; }
.bt-res { display: inline-flex; align-items: center; gap: 6px; padding: 6px 11px; border-radius: 10px; font-size: 14px; font-weight: 800; color: var(--highlight-color); background: color-mix(in srgb, var(--highlight-color) 12%, transparent); border: 1px solid color-mix(in srgb, var(--highlight-color) 35%, transparent); }
.bt-res .icon { width: 15px; height: 15px; }
.bt-res.neg { color: #f08a80; background: color-mix(in srgb, #e8574a 12%, transparent); border-color: color-mix(in srgb, #e8574a 35%, transparent); }
.bt-none { font-size: 12.5px; color: var(--inksoft-color); }
.bt-note { font-size: 11.5px; color: var(--inksoft-color); line-height: 1.5; margin-top: 10px; }
.bt-row-btn { width: 100%; display: flex; align-items: center; gap: 12px; text-align: left; padding: 12px 14px; margin-bottom: 12px; border-radius: 12px; cursor: pointer; background: var(--paneldeep-color); border: 1px solid var(--border-color); color: var(--ink-color); }
.bt-row-btn .ic { width: 38px; height: 38px; border-radius: 10px; flex: none; display: flex; align-items: center; justify-content: center; color: #fff; background: linear-gradient(155deg, var(--accent-color), var(--accent2-color)); }
.bt-row-btn .ic .icon { width: 19px; height: 19px; }
.bt-row-btn strong { display: block; font-size: 13.5px; }
.bt-row-btn small { display: block; font-size: 11.5px; color: var(--inksoft-color); margin-top: 2px; line-height: 1.35; }
.bt-row-btn:active { transform: scale(.985); }
@media (prefers-reduced-motion: reduce) { .bt-slot.over { animation: none; } .bt-bar b, .bt-round i { transition: none; } }

/* ===== v2 battle UX ===== */
.bt-sheet { padding-top: 22px; }
.bt-sub { font-size: 14px; line-height: 1.55; margin: 8px 2px 12px; }
.bt2-hero { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 6px 0 4px; }
.bt2-stat { padding: 12px 14px; border-radius: 14px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); display: flex; flex-direction: column; gap: 2px; }
.bt2-stat small { font-size: 12px; font-weight: 600; color: var(--inksoft-color); }
.bt2-stat b { font-size: 26px; font-weight: 800; line-height: 1.1; font-variant-numeric: tabular-nums; color: var(--ink-color); }
.bt2-stat:last-child b { color: var(--highlight-color); }
.bt2-sec { margin-top: 16px; }
.bt2-sec-h { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: 14px; font-weight: 700; color: var(--ink-color); margin-bottom: 8px; }
.bt2-sec-sub { font-size: 12px; font-weight: 500; color: var(--inksoft-color); }
.bt2-seg { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; padding: 4px; border-radius: 14px; background: rgba(0,0,0,.3); border: 1px solid rgba(255,255,255,.1); }
.bt2-seg button { min-height: 42px; border-radius: 10px; border: none; background: transparent; color: var(--inksoft-color); font-size: 15px; font-weight: 700; cursor: pointer; }
.bt2-seg button[aria-pressed="true"] { color: #fff; background: linear-gradient(155deg, var(--accent-color), var(--accent2-color)); box-shadow: 0 4px 12px rgba(0,0,0,.35); }
.bt2-custom { margin-top: 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border-radius: 12px; font-size: 13px; font-weight: 600; background: color-mix(in srgb, var(--highlight-color) 12%, transparent); border: 1px solid color-mix(in srgb, var(--highlight-color) 35%, transparent); color: var(--ink-color); }
.bt2-custom button { border: none; background: none; color: var(--highlight-color); font-size: 13px; font-weight: 700; cursor: pointer; padding: 6px 4px; min-height: 36px; }

.bt-forms { gap: 8px; }
.bt-form { min-width: 88px; font-size: 12.5px; font-weight: 600; min-height: 84px; }
.bt-form.nofit { opacity: .4; cursor: not-allowed; }
.bt-form small { font-size: 10.5px; color: #f08a80; margin-top: -3px; }
.bt-chip { font-size: 12px; padding: 5px 10px; }

.bt2-board { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.bt2-tile { grid-column: span 1; border-radius: 14px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); overflow: hidden; position: relative; transition: border-color .15s, background .15s; }
.bt2-tile.wide { grid-column: 1 / -1; }
.bt2-tile.open { grid-column: 1 / -1; border-color: var(--slot-color); background: color-mix(in srgb, var(--slot-color) 9%, rgba(255,255,255,.04)); }
.bt2-tile.empty:not(.open) { border-style: dashed; background: transparent; }
.bt2-tile.over { border-color: #e8574a; }
.bt2-tile::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--slot-color); }
.bt2-tile-btn { all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 10px; padding: 12px 12px 12px 14px; cursor: pointer; min-height: 56px; }
.bt2-tile-btn:focus-visible { outline: 2px solid var(--highlight-color); outline-offset: -2px; border-radius: 14px; }
.bt2-tile-ic { width: 34px; height: 34px; border-radius: 10px; flex: none; display: flex; align-items: center; justify-content: center; color: var(--slot-color); background: color-mix(in srgb, var(--slot-color) 16%, transparent); }
.bt2-tile-ic .icon { width: 19px; height: 19px; }
.bt2-tile-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.bt2-tile-txt b { font-size: 14px; font-weight: 700; color: var(--ink-color); }
.bt2-tile-txt small { font-size: 12px; color: var(--inksoft-color); line-height: 1.3; }
.bt2-chev { font-size: 20px; color: var(--inksoft-color); width: 18px; text-align: center; }
.bt2-tile .bt-bar { margin: 0 12px 12px 14px; }
.bt2-warn { margin: 0 12px 12px 14px; font-size: 12.5px; color: #f08a80; line-height: 1.4; }
.bt2-edit { padding: 2px 14px 14px; }
.bt2-edit-hint { font-size: 12.5px; color: var(--inksoft-color); margin-bottom: 10px; line-height: 1.4; }
.bt-cls { min-height: 54px; font-size: 11.5px; font-weight: 600; }
.bt-cls .icon { width: 19px; height: 19px; }
.bt-troop { margin-top: 12px; }
.bt-troop-row { font-size: 14px; }
.bt-have { font-size: 12px; }
.bt-lv { font-size: 10.5px; }
.bt-ctl { gap: 10px; margin-top: 6px; }
.bt-num { width: 64px; padding: 9px 4px; font-size: 15px; min-height: 40px; }
.bt-mini { min-height: 40px; padding: 0 12px; font-size: 12.5px; }
.bt-empty { font-size: 13px; }
.bt2-tools { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 10px; }
.bt2-tools button { border: none; background: none; color: var(--highlight-color); font-size: 13px; font-weight: 700; cursor: pointer; padding: 8px 0; min-height: 36px; }
.bt2-tools button:last-child { margin-left: auto; color: var(--inksoft-color); font-weight: 600; }
.bt2-help { margin-top: 6px; padding: 12px 14px; border-radius: 12px; font-size: 13px; line-height: 1.55; color: var(--inksoft-color); background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); }
.bt2-help p { margin: 0 0 8px; } .bt2-help p:last-child { margin: 0; } .bt2-help b { color: var(--ink-color); }
.bt-note { font-size: 12.5px; }
.bt-err { font-size: 13px; margin: 0 0 8px; }
.bt2-foot { position: sticky; bottom: calc(-18px - env(safe-area-inset-bottom, 0px)); margin: 18px -18px calc(-18px - env(safe-area-inset-bottom, 0px)); padding: 12px 18px calc(16px + env(safe-area-inset-bottom, 0px)); z-index: 3; background: linear-gradient(180deg, transparent, var(--panel-color) 24%); border-top: 1px solid rgba(255,255,255,.08); }
.bt2-foot .action-row { display: flex; gap: 10px; }
.bt2-go { flex: 1 1 auto; min-height: 54px; font-size: 16px; }
.bt2-foot .action-btn.secondary { flex: 0 0 auto; padding-left: 18px; padding-right: 18px; }

/* castle sheet / report / raid */
.bt-group { border-radius: 14px; padding: 12px 14px; background: rgba(255,255,255,.05); border-color: rgba(255,255,255,.1); }
.bt-group h4 { font-size: 12px; }
.bt-line { font-size: 14px; padding: 5px 0; }
.bt-banner h3 { font-size: 28px; }
.bt-banner p { font-size: 14px; }
.bt-row-btn { padding: 14px; border-radius: 14px; background: rgba(255,255,255,.06); border-color: rgba(255,255,255,.12); }
.bt-row-btn strong { font-size: 15px; } .bt-row-btn small { font-size: 12.5px; }
.bt-res { font-size: 15px; }

.bt2-formrow { all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 12px; padding: 10px 12px; min-height: 60px; border-radius: 14px; cursor: pointer; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); }
.bt2-formrow:focus-visible { outline: 2px solid var(--highlight-color); outline-offset: 2px; }
.bt2-formrow .bt-glyph { height: 34px; flex: none; color: var(--accent-color); }
.bt2-formtxt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.bt2-formtxt b { font-size: 15px; font-weight: 700; color: var(--ink-color); }
.bt2-formtxt em { font-style: normal; font-weight: 500; font-size: 12px; color: var(--inksoft-color); }
.bt2-formtxt small { font-size: 12px; color: var(--inksoft-color); line-height: 1.35; }
.bt2-change { flex: none; font-size: 13px; font-weight: 700; color: var(--highlight-color); padding: 6px 4px; }
.bt2-formpick { margin-top: 10px; }

.bt2-more { all: unset; box-sizing: border-box; display: block; width: 100%; text-align: center; margin-top: 12px; padding: 10px; min-height: 40px; font-size: 14px; font-weight: 700; color: var(--highlight-color); cursor: pointer; }
.bt2-stat small:last-child:not(:first-child) { font-size: 11.5px; }
.bt-loot { gap: 8px; }
.bt-res { padding: 7px 12px; border-radius: 10px; }
.bt-sheet .action-btn { white-space: nowrap; }

.bt2-mix { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 2px; }
.bt2-mix-chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 999px; font-size: 12.5px; font-weight: 600; color: var(--inksoft-color); background: color-mix(in srgb, var(--cls-color) 12%, transparent); border: 1px solid color-mix(in srgb, var(--cls-color) 35%, transparent); }
.bt2-mix-chip .icon { width: 15px; height: 15px; color: var(--cls-color); }
.bt2-mix-chip b { color: var(--ink-color); font-weight: 800; font-variant-numeric: tabular-nums; }
.bt2-adv { all: unset; box-sizing: border-box; width: 100%; margin-top: 16px; display: flex; align-items: center; gap: 10px; padding: 12px 14px; min-height: 56px; border-radius: 14px; cursor: pointer; background: transparent; border: 1px dashed rgba(255,255,255,.22); }
.bt2-adv.open { border-style: solid; background: rgba(255,255,255,.04); }
.bt2-adv:focus-visible { outline: 2px solid var(--highlight-color); outline-offset: 2px; }
.bt2-adv-txt { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.bt2-adv-txt b { font-size: 14px; font-weight: 700; color: var(--ink-color); }
.bt2-adv-txt small { font-size: 12px; color: var(--inksoft-color); }
.bt2-verdict { display: flex; align-items: center; gap: 12px; padding: 14px; border-radius: 14px; margin-top: 12px; border: 1px solid; }
.bt2-verdict .vi { width: 38px; height: 38px; flex: none; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 800; }
.bt2-verdict b { display: block; font-size: 16px; font-weight: 800; line-height: 1.2; }
.bt2-verdict small { display: block; margin-top: 2px; font-size: 12.5px; color: var(--inksoft-color); line-height: 1.35; }
.bt2-verdict.good { color: #7bd88f; background: color-mix(in srgb, #7bd88f 11%, transparent); border-color: color-mix(in srgb, #7bd88f 38%, transparent); }
.bt2-verdict.warn { color: #f0c05a; background: color-mix(in srgb, #f0c05a 11%, transparent); border-color: color-mix(in srgb, #f0c05a 38%, transparent); }
.bt2-verdict.bad  { color: #f08a80; background: color-mix(in srgb, #e8574a 12%, transparent); border-color: color-mix(in srgb, #e8574a 40%, transparent); }
.bt2-verdict.none { color: var(--inksoft-color); background: rgba(255,255,255,.04); border-color: rgba(255,255,255,.12); }
.bt2-verdict .vi { background: currentColor; }
.bt2-verdict .vi > span { color: #101820; }
.bt2-vs { display: flex; justify-content: space-between; align-items: baseline; font-size: 13px; color: var(--inksoft-color); margin: 14px 2px 6px; }
.bt2-vs b { font-size: 22px; font-weight: 800; color: var(--ink-color); font-variant-numeric: tabular-nums; }
.bt2-vs .foe b { color: var(--highlight-color); }
.bt2-vs .foe { text-align: right; }
.bt2-facts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
.bt2-fact { padding: 10px 12px; border-radius: 12px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); }
.bt2-fact small { display: block; font-size: 12px; color: var(--inksoft-color); }
.bt2-fact b { display: block; margin-top: 2px; font-size: 14px; font-weight: 700; color: var(--ink-color); line-height: 1.3; }
.bt2-timer { height: 6px; border-radius: 99px; background: rgba(255,255,255,.1); overflow: hidden; margin-top: 8px; }
.bt2-timer i { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--accent-color), var(--highlight-color)); }
.bt2-army { padding: 12px 14px; border-radius: 14px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); margin-bottom: 8px; }
.bt2-army-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.bt2-army-top b { font-size: 14px; font-weight: 700; color: var(--ink-color); }
.bt2-army-top small { display: block; font-size: 12px; color: var(--inksoft-color); font-weight: 500; margin-top: 2px; }
.bt2-army-top .t { font-size: 15px; font-weight: 800; color: var(--highlight-color); font-variant-numeric: tabular-nums; white-space: nowrap; }
.bt2-empty { text-align: center; padding: 20px 12px 8px; }
.bt2-empty .big { width: 56px; height: 56px; margin: 0 auto 10px; border-radius: 18px; display: flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--accent-color) 22%, transparent); color: var(--highlight-color); }
.bt2-empty .big .icon { width: 28px; height: 28px; }
.bt2-empty b { display: block; font-size: 16px; color: var(--ink-color); }
.bt2-empty p { margin: 6px 0 0; font-size: 13.5px; line-height: 1.55; color: var(--inksoft-color); }

/* ===== v3: formation view, effects, guide, reports ===== */
.bt-sheet { max-height: 92vh; overflow-y: auto; overscroll-behavior: contain; }
.bt3-help-btn { all: unset; cursor: pointer; font-size: 13px; font-weight: 700; color: var(--highlight-color); padding: 6px 2px; min-height: 32px; }
.bt3-forms { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; padding: 2px 1px 8px; margin: 0 -2px; scroll-snap-type: x proximity; }
.bt3-forms::-webkit-scrollbar { display: none; }
.bt3-form { all: unset; box-sizing: border-box; flex: 0 0 auto; width: 92px; display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 9px 6px 8px; border-radius: 13px; cursor: pointer; scroll-snap-align: start; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); color: var(--inksoft-color); font-size: 12.5px; font-weight: 700; text-align: center; transition: transform .12s, border-color .15s, background .15s; }
.bt3-form:focus-visible { outline: 2px solid var(--highlight-color); outline-offset: 2px; }
.bt3-form:active { transform: scale(.96); }
.bt3-form[aria-pressed="true"] { color: var(--ink-color); border-color: var(--accent-color); background: color-mix(in srgb, var(--accent-color) 24%, var(--paneldeep-color)); box-shadow: 0 3px 12px rgba(0,0,0,.35); }
.bt3-form.nofit { opacity: .42; }
.bt3-form small { font-size: 10.5px; font-weight: 600; color: #f08a80; line-height: 1.1; }
.bt3-shape { width: 52px; height: 44px; color: currentColor; }
.bt3-shape rect { fill: currentColor; opacity: .85; }
.bt3-shape rect.dim { opacity: .35; }
.bt3-trait { margin-top: 2px; padding: 10px 12px; border-radius: 12px; font-size: 13px; line-height: 1.5; color: var(--ink-color); background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); }
.bt3-trait b { font-weight: 800; }
.bt3-eff { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.bt3-chip { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 10px; font-size: 12.5px; font-weight: 600; line-height: 1.3; color: var(--inksoft-color); background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); }
.bt3-chip.good { color: #7bd88f; background: color-mix(in srgb, #7bd88f 11%, transparent); border-color: color-mix(in srgb, #7bd88f 38%, transparent); }
.bt3-chip.bad { color: #f08a80; background: color-mix(in srgb, #e8574a 12%, transparent); border-color: color-mix(in srgb, #e8574a 40%, transparent); }
.bt3-chip .side { font-size: 10px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; opacity: .8; }
.bt3-hint { font-size: 12.5px; color: var(--inksoft-color); line-height: 1.5; margin-top: 8px; }

.bt3-field { border-radius: 16px; padding: 10px; background: linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,.015)); border: 1px solid rgba(255,255,255,.1); }
.bt3-enemy { display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 11px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: #f08a80; margin: 0 0 8px; }
.bt3-enemy::before, .bt3-enemy::after { content: ""; flex: 1; height: 1px; background: color-mix(in srgb, #e8574a 40%, transparent); }
.bt3-own { text-align: center; font-size: 11px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: #6bb7f0; margin-top: 8px; }
.bt3-board { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.bt3-tile { grid-column: span 1; position: relative; overflow: hidden; border-radius: 13px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.12); transition: border-color .15s, background .15s; }
.bt3-tile.wide, .bt3-tile.open { grid-column: 1 / -1; }
.bt3-tile::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--slot-color); }
.bt3-tile.empty:not(.open) { border-style: dashed; background: transparent; }
.bt3-tile.open { border-color: var(--slot-color); background: color-mix(in srgb, var(--slot-color) 8%, rgba(255,255,255,.04)); }
.bt3-tile.over { border-color: #e8574a; }
.bt3-tile-btn { all: unset; box-sizing: border-box; width: 100%; display: block; padding: 10px 11px 10px 14px; cursor: pointer; }
.bt3-tile-btn:focus-visible { outline: 2px solid var(--highlight-color); outline-offset: -2px; border-radius: 13px; }
.bt3-tile-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.bt3-tile-top b { font-size: 13.5px; font-weight: 800; color: var(--ink-color); }
.bt3-tile-top small { font-size: 11px; color: var(--inksoft-color); font-weight: 600; white-space: nowrap; }
.bt3-role { font-size: 11px; color: var(--inksoft-color); margin-top: 1px; }
.bt3-lanes { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; min-height: 26px; align-items: center; }
.bt3-lane { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; border-radius: 999px; font-size: 12px; font-weight: 700; color: var(--ink-color); background: color-mix(in srgb, var(--cls-color) 16%, transparent); border: 1px solid color-mix(in srgb, var(--cls-color) 45%, transparent); }
.bt3-lane .icon { width: 14px; height: 14px; color: var(--cls-color); }
.bt3-lane b { font-variant-numeric: tabular-nums; }
.bt3-lane-empty { font-size: 12px; color: var(--inksoft-color); opacity: .8; }
.bt3-cap { margin-top: 8px; }
.bt3-cap-bar { height: 6px; border-radius: 3px; background: color-mix(in srgb, var(--ink-color) 12%, transparent); overflow: hidden; }
.bt3-cap-bar b { display: block; height: 100%; border-radius: 3px; background: var(--slot-color); transition: width .2s ease; }
.bt3-tile.over .bt3-cap-bar b { background: #e8574a; }
.bt3-cap-txt { display: flex; justify-content: space-between; gap: 6px; margin-top: 4px; font-size: 11px; font-weight: 600; color: var(--inksoft-color); font-variant-numeric: tabular-nums; }
.bt3-badges { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 7px; }
.bt3-badge { padding: 2px 7px; border-radius: 6px; font-size: 11px; font-weight: 800; }
.bt3-badge.good { color: #7bd88f; background: color-mix(in srgb, #7bd88f 14%, transparent); }
.bt3-badge.bad { color: #f08a80; background: color-mix(in srgb, #e8574a 15%, transparent); }
.bt3-edit { padding: 0 12px 14px 14px; }
.bt3-edit-hint { font-size: 12.5px; color: var(--inksoft-color); line-height: 1.45; margin: 0 0 10px; }
.bt3-edit-h { font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--inksoft-color); margin: 4px 0 6px; display: flex; justify-content: space-between; }
.bt3-group-h { margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,.08); font-size: 13px; font-weight: 800; color: var(--ink-color); display: flex; align-items: center; gap: 7px; }
.bt3-group-h .icon { width: 16px; height: 16px; }
.bt3-warn { margin: 0 12px 10px 14px; font-size: 12.5px; color: #f08a80; line-height: 1.4; }

/* guide */
.bt3-guide h3 { margin: 18px 0 8px; font-size: 14px; font-weight: 800; color: var(--ink-color); }
.bt3-guide p { margin: 0 0 8px; font-size: 13px; line-height: 1.55; color: var(--inksoft-color); }
.bt3-guide p b { color: var(--ink-color); }
.bt3-guide-slot { display: flex; gap: 10px; padding: 9px 11px; margin-bottom: 7px; border-radius: 12px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); font-size: 12.5px; line-height: 1.45; color: var(--inksoft-color); }
.bt3-guide-slot b { display: block; color: var(--ink-color); font-size: 13.5px; }
.bt3-guide-slot .pc { flex: none; min-width: 46px; text-align: center; font-size: 18px; font-weight: 800; color: var(--highlight-color); font-variant-numeric: tabular-nums; line-height: 1.1; }
.bt3-guide-slot .pc small { display: block; font-size: 10px; font-weight: 600; color: var(--inksoft-color); }
.bt3-wheel { display: block; width: 100%; max-width: 270px; margin: 4px auto 6px; }
.bt3-wheel text { fill: var(--ink-color); font-size: 11px; font-weight: 700; text-anchor: middle; }
.bt3-wheel .edge { stroke: var(--highlight-color); stroke-width: 1.4; opacity: .75; fill: none; }
.bt3-wheel .node { fill: var(--paneldeep-color); stroke: var(--border-color); stroke-width: 1.2; }
.bt3-wheel marker path { fill: var(--highlight-color); }
.bt3-tips { padding-left: 18px; margin: 0; font-size: 13px; line-height: 1.6; color: var(--inksoft-color); }
.bt3-tips b { color: var(--ink-color); }

/* report */
.bt3-why { display: flex; flex-direction: column; gap: 6px; }
.bt3-why .bt3-chip { border-radius: 11px; }
.bt3-sl { display: grid; grid-template-columns: 74px 1fr; gap: 4px 10px; align-items: center; font-size: 12px; color: var(--inksoft-color); margin: 7px 0; }
.bt3-sl b { color: var(--ink-color); font-weight: 700; }
.bt3-sl-bars { display: flex; flex-direction: column; gap: 3px; }
.bt3-sl-bar { position: relative; height: 9px; border-radius: 5px; background: color-mix(in srgb, var(--ink-color) 10%, transparent); overflow: hidden; }
.bt3-sl-bar i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 5px; }
.bt3-sl-bar.you i { background: #4a9fe0; }
.bt3-sl-bar.foe i { background: #e0614f; }
.bt3-sl-nums { display: flex; justify-content: space-between; font-size: 11px; font-variant-numeric: tabular-nums; }
.bt3-sl-empty { opacity: .45; }
.bt3-ev { font-size: 12.5px; color: #f0c05a; margin-top: 6px; }
.bt3-form-vs { display: flex; justify-content: space-between; gap: 8px; font-size: 12.5px; color: var(--inksoft-color); margin: 0 2px 4px; }
.bt3-form-vs b { color: var(--ink-color); }
.bt3-form-vs span:last-child { text-align: right; }
@media (prefers-reduced-motion: reduce) { .bt3-cap-bar b { transition: none; } .bt3-form { transition: none; } }
`;

export function injectBattleCss() {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('bt-css');
  if (!el) { el = document.createElement('style'); el.id = 'bt-css'; document.head.appendChild(el); }
  el.textContent = CSS;
}

/* ------------------------------------------------------------------------------------------ */

export function createBattleUI({ React, Icon, troopName }) {
  const { useState, useMemo } = React;
  const e = React.createElement;
  const name = troopName || prettyId;
  const num = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');

  const CLS_PATH = {
    spear: [e('path', { key: 1, d: 'M5 20L16 9' }), e('path', { key: 2, d: 'M13.5 5.5l5-.5-.5 5z' })],
    sword: [e('path', { key: 1, d: 'M15 3l6 6-10 10-4.5-1.5L5 16 3 21l5-2 .5-1.5L10 15' })],
    cav: [e('path', { key: 1, d: 'M5 19v-6a7 7 0 0 1 14 0v6' }), e('path', { key: 2, d: 'M5 19h3.5M15.5 19H19' })],
    archer: [e('path', { key: 1, d: 'M6 4c7 2 7 14 0 16' }), e('path', { key: 2, d: 'M6 12h13M16 9l3 3-3 3' })],
  };
  const ClsIcon = ({ cls }) => e('svg', { className: 'icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' }, CLS_PATH[cls] || null);

  /** Little picture of a formation: how wide each of the four positions may be. */
  const FormShape = ({ formation, config, dim }) => {
    const caps = config.formations[formation].caps;
    const w = (s) => Math.round(8 + caps[s] * 30);
    const bar = (s, x, y, key) => e('rect', { key, x: x - w(s) / 2, y, width: w(s), height: 8, rx: 2.5, className: dim ? 'dim' : undefined });
    return e('svg', { className: 'bt3-shape', viewBox: '0 0 52 44', 'aria-hidden': 'true' },
      bar('S1', 26, 2, 1), bar('S2', 13, 16, 2), bar('S3', 39, 16, 3), bar('S4', 26, 32, 4));
  };

  const Head = ({ icon, title, sub, onClose }) => e('div', { className: 'sheet-head' },
    e('div', { className: 'sheet-title' }, e('div', { className: 'icon-wrap' }, Icon(icon)),
      e('div', null, e('h2', null, title), sub && e('div', { className: 'level-row' }, e('span', { className: 'level-pill' }, sub)))),
    e('button', { className: 'close-btn', onClick: onClose, 'aria-label': 'Close' }, Icon('close')));

  const backdrop = (onClose) => (ev) => { if (ev.target === ev.currentTarget) onClose(); };
  const troopText = (t) => Object.entries(t || {}).filter(([, n]) => n > 0).map(([id, n]) => num(n) + '\u00d7 ' + name(id)).join(', ');
  const switchNote = (from, to) => (from !== to ? 'Switched to ' + fname(to) + ' because your troop mix does not fit the ' + fname(from) + ' limits.' : '');
  const Chip = ({ item, side }) => { const t = effectText(item); return e('span', { className: 'bt3-chip ' + t.tone }, side && e('span', { className: 'side' }, side), t.text); };

  /* ---------------- guide: what do positions, formations and troop types do ---------------- */
  function Wheel({ nodes, edges }) {
    const cx = 100, cy = 100, R = 66;
    const pos = {};
    nodes.forEach((n, i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / nodes.length; pos[n.id] = [cx + R * Math.cos(a), cy + R * Math.sin(a)]; });
    const short = (a, b, k) => { const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1; return [a[0] + (dx / d) * k, a[1] + (dy / d) * k, b[0] - (dx / d) * k, b[1] - (dy / d) * k]; };
    return e('svg', { className: 'bt3-wheel', viewBox: '0 0 200 200', role: 'img', 'aria-label': 'Who beats whom' },
      e('defs', null, e('marker', { id: 'bt3-arr', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, e('path', { d: 'M0 0L10 5L0 10z' }))),
      edges.map(([a, b], i) => { const [x1, y1, x2, y2] = short(pos[a], pos[b], 17); return e('line', { key: i, className: 'edge', x1, y1, x2, y2, markerEnd: 'url(#bt3-arr)' }); }),
      nodes.map((n) => e('g', { key: n.id }, e('circle', { className: 'node', cx: pos[n.id][0], cy: pos[n.id][1], r: 15, style: n.color ? { stroke: n.color } : undefined }),
        e('text', { x: pos[n.id][0], y: pos[n.id][1] + 3.5 }, n.label)))
    );
  }

  function GuideSheet({ config, onClose }) {
    const fIds = Object.keys(config.formations);
    const fEdges = [];
    for (const f of fIds) for (const b of config.formations[f].beats) fEdges.push([f, b]);
    const cEdges = Object.entries(config.counters);
    const fb = Math.round(config.formationBonus * 100), cb = Math.round(config.counterBonus * 100);
    const brk = Math.round((config.frontBreakTaken - 1) * 100);
    return e('div', { className: 'overlay open', style: { zIndex: 96 }, onClick: backdrop(onClose) },
      e('div', { className: 'sheet bt-sheet bt3-guide' },
        Head({ icon: 'scroll', title: 'Battle guide', sub: 'Positions, formations, troop types', onClose }),
        e('h3', null, '1. Positions'),
        e('p', null, 'Your army stands in four positions. Each enemy group shoots mostly at the position it faces, so ', e('b', null, 'where'), ' a troop type stands matters as much as how many you have. Every position holds up to ', e('b', null, config.slotClassLimit || 2), ' troop types.'),
        SLOTS.map((s) => e('div', { key: s, className: 'bt3-guide-slot' },
          e('div', { className: 'pc' }, Math.round(((config.exposure || {})[s] || 0) * 100) + '%', e('small', null, 'of enemy fire')),
          e('div', null, e('b', null, SLOT_INFO[s].name), SLOT_INFO[s].hint))),
        e('p', null, e('b', null, 'Line broken: '), 'when your whole front line (S1) is destroyed, everything else takes ' + brk + '% more damage. Keep the front alive, or break theirs first.'),
        e('h3', null, '2. Formations'),
        e('p', null, 'Each formation changes the shape of your army (how many may stand in each position) and gives a perk. They also counter each other: an arrow means "beats", worth ', e('b', null, '+' + fb + '% attack'), '.'),
        e(Wheel, { nodes: fIds.map((f) => ({ id: f, label: fname(f).slice(0, 5) })), edges: fEdges }),
        fIds.map((f) => e('div', { key: f, className: 'bt3-guide-slot' },
          e(FormShape, { formation: f, config }),
          e('div', null, e('b', null, fname(f)), effectText({ type: 'formation', formation: f, ...(config.formationMods[f] || {}) }).text.replace(fname(f) + ': ', ''),
            e('br'), 'Beats ' + config.formations[f].beats.map(fname).join(' & ')))),
        e('h3', null, '3. Troop types'),
        e('p', null, 'Troop types also counter each other: the winner deals ', e('b', null, '+' + cb + '% damage'), ' to the loser, and the loser deals ', e('b', null, cb + '% less'), ' back.'),
        e(Wheel, { nodes: Object.keys(CLASS_INFO).map((c) => ({ id: c, label: CLASS_INFO[c].name.slice(0, 4), color: CLASS_INFO[c].color })), edges: cEdges }),
        e('p', null, Object.entries(config.counters).map(([a, b]) => cname(a) + ' beats ' + cname(b)).join(' \u00b7 ')),
        e('h3', null, '4. Combinations that work'),
        e('ul', { className: 'bt3-tips' },
          e('li', null, e('b', null, 'Spears in front, Archers behind: '), 'the shield line takes 15% less damage while the rear shoots 25% harder.'),
          e('li', null, e('b', null, 'Cavalry on a flank: '), 'a 25% charge bonus, and Cavalry counter Archers.'),
          e('li', null, e('b', null, 'Wedge or Shield wall vs Flank: '), 'the cycle decides small fights. Pick a formation that beats theirs.'),
          e('li', null, e('b', null, 'Swords vs Spears, Spears vs Cavalry: '), 'bring the troop type that counters what you will meet.'),
          e('li', null, e('b', null, 'Camps tell you their formation and troops: '), 'the game picks a countering formation for you.')),
        e('div', { className: 'action-row', style: { marginTop: '16px' } }, e('button', { className: 'action-btn primary', type: 'button', onClick: onClose }, 'Got it'))));
  }

  /* ---------------- formation / defense editor ---------------- */
  const PCTS = [25, 50, 75, 100];

  function FormationSheet({ mode, title, subtitle, config, army, initial, busy, submitLabel, onClose, onSubmit }) {
    const isDef = mode === 'defense';
    const limit = limitOf(config);
    const owned = useMemo(() => {
      const o = {};
      for (const [id, n] of Object.entries(army || {})) if (n > 0 && config.stats[id]) o[id] = Math.floor(n);
      return o;
    }, [army, config]);
    const ids = Object.keys(owned).sort((a, b) => (config.stats[b].level - config.stats[a].level) || (a < b ? -1 : 1));
    const classesOwned = new Set(ids.map((id) => config.stats[id].cls));
    const forms = Object.keys(config.formations);

    const savedLayout = initial && config.formations[initial.formation] ? initial : null;
    const [pct, setPct] = useState(100);
    const [custom, setCustom] = useState(!!savedLayout);
    const [openSlot, setOpenSlot] = useState(null);
    const [guide, setGuide] = useState(false);
    const [note, setNote] = useState('');
    const [st, setSt] = useState(() => stateFromLayout(savedLayout || bestAutoLayout(owned, 'wedge', config), config));

    const scaled = (p) => {
      const o = {};
      for (const [id, n] of Object.entries(owned)) { const k = Math.min(n, Math.ceil(n * p / 100)); if (k > 0) o[id] = k; }
      return o;
    };
    const pool = custom || isDef ? owned : scaled(pct);
    const fits = useMemo(() => {
      const r = {};
      for (const f of forms) r[f] = !layoutStats(autoLayout(pool, f, config), config).error;
      return r;
    }, [pool, config]);

    const layout = layoutFromState(st, config);
    const stats = layoutStats(layout, config);
    const eff = ownEffects(layout, config);
    const used = (id, except) => SLOTS.reduce((a, s) => a + (s === except ? 0 : (st.n[s][id] || 0)), 0);
    const match = formationMatchups(st.formation, config);

    const applyAuto = (p, f) => {
      const l = bestAutoLayout(isDef ? owned : scaled(p), f, config);
      setNote(switchNote(f, l.formation));
      setSt(stateFromLayout(l, config));
    };
    const onPct = (p) => { setPct(p); setCustom(false); applyAuto(p, st.formation); };
    const onForm = (f) => {
      if (custom) { setNote(''); setSt((q) => ({ ...q, formation: f })); return; }
      if (!fits[f]) return;
      applyAuto(pct, f);
    };
    const resetAuto = () => { setCustom(false); setOpenSlot(null); applyAuto(isDef ? 100 : pct, st.formation); };
    const toCustom = () => { if (!custom) setCustom(true); };

    const toggleClass = (s, c) => {
      toCustom();
      const cur = st.cls[s] || [];
      if (cur.includes(c)) {
        setNote('');
        setSt((p) => {
          const n = { ...p.n[s] };
          for (const id of Object.keys(n)) if (config.stats[id].cls === c) delete n[id];
          return { ...p, cls: { ...p.cls, [s]: cur.filter((x) => x !== c) }, n: { ...p.n, [s]: n } };
        });
      } else if (cur.length >= limit) {
        setNote('A position holds at most ' + limit + ' troop types. Remove one first.');
      } else {
        setNote('');
        setSt((p) => ({ ...p, cls: { ...p.cls, [s]: CLASS_ORDER.filter((x) => x === c || cur.includes(x)) } }));
      }
    };
    const setCount = (s, id, v) => { toCustom(); setSt((p) => {
      const free = owned[id] - SLOTS.reduce((a, x) => a + (x === s ? 0 : (p.n[x][id] || 0)), 0);
      const k = Math.max(0, Math.min(free, Math.floor(Number(v) || 0)));
      return { ...p, n: { ...p.n, [s]: { ...p.n[s], [id]: k } } };
    }); };
    const clearAll = () => { setCustom(true); setNote(''); setSt((p) => ({ formation: p.formation, cls: Object.fromEntries(SLOTS.map((s) => [s, []])), n: emptySlots() })); };
    const submit = () => { if (!stats.error && !busy) onSubmit(layoutFromState(st, config)); };

    const slotColor = (s) => { const c = (st.cls[s] || [])[0]; return c ? CLASS_INFO[c].color : 'var(--border-color)'; };

    const tile = (s) => {
      const classes = st.cls[s] || [];
      const isOver = stats.over.includes(s);
      const isOpen = openSlot === s;
      const size = stats.size[s], max = stats.max[s];
      const fill = max > 0 ? Math.min(100, (size / max) * 100) : 0;
      const capPct = Math.round(config.formations[st.formation].caps[s] * 100);
      const badges = eff.filter((x) => x.type === 'slot' && x.slot === s);
      const lanes = classes.map((c) => ({ c, n: Object.entries(st.n[s]).filter(([id]) => config.stats[id].cls === c).reduce((a, [, k]) => a + (k > 0 ? k : 0), 0) })).filter((l) => l.n > 0);
      return e('div', { key: s, className: 'bt3-tile' + (s === 'S1' || s === 'S4' ? ' wide' : '') + (isOver ? ' over' : '') + (isOpen ? ' open' : '') + (size ? '' : ' empty'), style: { '--slot-color': slotColor(s) } },
        e('button', { type: 'button', className: 'bt3-tile-btn', 'aria-expanded': String(isOpen), onClick: () => setOpenSlot(isOpen ? null : s) },
          e('div', { className: 'bt3-tile-top' }, e('b', null, SLOT_INFO[s].name), e('small', null, '\u2248' + Math.round(((config.exposure || {})[s] || 0) * 100) + '% of enemy fire')),
          e('div', { className: 'bt3-role' }, SLOT_INFO[s].role),
          e('div', { className: 'bt3-lanes' }, lanes.length ? lanes.map((l) => e('span', { key: l.c, className: 'bt3-lane', style: { '--cls-color': CLASS_INFO[l.c].color } }, e(ClsIcon, { cls: l.c }), cname(l.c), e('b', null, num(l.n))))
            : e('span', { className: 'bt3-lane-empty' }, 'Empty. Tap to add troops')),
          e('div', { className: 'bt3-cap' },
            e('div', { className: 'bt3-cap-bar' }, e('b', { style: { width: fill + '%' } })),
            e('div', { className: 'bt3-cap-txt' }, e('span', null, num(size) + ' / ' + num(max) + ' max'), e('span', null, 'up to ' + capPct + '% of army'))),
          badges.length > 0 && e('div', { className: 'bt3-badges' }, badges.map((b, i) => { const t = effectText(b); return e('span', { key: i, className: 'bt3-badge ' + t.tone }, t.text.split(': ')[0].replace(' in the ' + SLOT_INFO[s].short, '') + ' ' + [b.atk !== 1 ? 'ATK ' + pctOf(b.atk) : '', b.take !== 1 ? 'DMG ' + pctOf(b.take) : ''].filter(Boolean).join(' ')); }))),
        isOver && e('div', { className: 'bt3-warn' }, 'Too many here (limit ' + num(max) + '). Remove some or tap \u201cAuto-arrange\u201d.'),
        isOpen && e('div', { className: 'bt3-edit' },
          e('p', { className: 'bt3-edit-hint' }, SLOT_INFO[s].hint),
          e('div', { className: 'bt3-edit-h' }, e('span', null, 'Troop types here'), e('span', null, classes.length + ' / ' + limit)),
          e('div', { className: 'bt-classes' }, CLASS_ORDER.map((c) =>
            e('button', { key: c, type: 'button', className: 'bt-cls', 'aria-pressed': String(classes.includes(c)), disabled: !classesOwned.has(c) || (!classes.includes(c) && classes.length >= limit), style: { '--cls-color': CLASS_INFO[c].color }, onClick: () => toggleClass(s, c) },
              e(ClsIcon, { cls: c }), CLASS_INFO[c].name))),
          !classes.length ? e('div', { className: 'bt-empty' }, 'Pick one or two troop types for this position')
            : classes.map((c) => e('div', { key: c },
              e('div', { className: 'bt3-group-h', style: { color: CLASS_INFO[c].color } }, e(ClsIcon, { cls: c }), CLASS_INFO[c].name),
              ids.filter((id) => config.stats[id].cls === c).map((id) => {
                const free = owned[id] - used(id, s), cur = st.n[s][id] || 0;
                return e('div', { key: id, className: 'bt-troop' },
                  e('div', { className: 'bt-troop-row' },
                    e('span', null, name(id), e('span', { className: 'bt-lv' }, 'Lv ' + config.stats[id].level)),
                    e('span', { className: 'bt-have' }, num(free) + ' free')),
                  e('div', { className: 'bt-ctl' },
                    e('input', { type: 'range', min: 0, max: Math.max(free, 0), step: 1, value: Math.min(cur, free), disabled: free <= 0 && cur === 0, onChange: (ev) => setCount(s, id, ev.target.value), 'aria-label': name(id) + ' count' }),
                    e('input', { className: 'bt-num', type: 'number', inputMode: 'numeric', min: 0, max: free, value: cur, onChange: (ev) => setCount(s, id, ev.target.value), 'aria-label': name(id) + ' number' }),
                    e('button', { type: 'button', className: 'bt-mini', onClick: () => setCount(s, id, free) }, 'Max')));
              }))),
          e('button', { type: 'button', className: 'bt2-more', onClick: () => setOpenSlot(null) }, 'Done')));
    };

    const mix = {};
    for (const [id, n] of Object.entries(layoutArmy(layout))) { const c = config.stats[id] && config.stats[id].cls; if (c) mix[c] = (mix[c] || 0) + n; }
    const mixList = CLASS_ORDER.filter((c) => mix[c] > 0);
    const verb = isDef ? 'Save defense' : (submitLabel || 'Attack');
    const traits = eff.filter((x) => x.type === 'formation');
    const slotFx = eff.filter((x) => x.type === 'slot');
    const fb = Math.round((config.formationBonus || 0) * 100);

    return e('div', { className: 'overlay open', onClick: backdrop(onClose) },
      e('div', { className: 'sheet bt-sheet' },
        Head({ icon: isDef ? 'shield' : 'sword', title, sub: isDef ? 'Used when you are attacked' : 'Instant battle', onClose }),
        subtitle && e('p', { className: 'bt-sub' }, subtitle),
        ids.length === 0 ? e('div', { className: 'bt-empty', style: { padding: '26px 0' } }, 'You have no troops. Train some in the Barracks first.') : e(React.Fragment, null,

          e('div', { className: 'bt2-hero' },
            e('div', { className: 'bt2-stat' }, e('small', null, isDef ? 'Defenders' : 'Soldiers sent'), e('b', null, num(stats.total))),
            e('div', { className: 'bt2-stat' }, e('small', null, 'Power (with bonuses)'), e('b', null, num(stats.power)))),

          mixList.length > 0 && e('div', { className: 'bt2-mix', 'aria-label': 'Troop types' }, mixList.map((c) =>
            e('span', { key: c, className: 'bt2-mix-chip', style: { '--cls-color': CLASS_INFO[c].color } }, e(ClsIcon, { cls: c }), CLASS_INFO[c].name, e('b', null, num(mix[c]))))),

          !isDef && !custom && e('div', { className: 'bt2-sec' },
            e('div', { className: 'bt2-sec-h' }, 'How many to send'),
            e('div', { className: 'bt2-seg', role: 'group', 'aria-label': 'Share of your army' }, PCTS.map((p) =>
              e('button', { key: p, type: 'button', 'aria-pressed': String(pct === p), onClick: () => onPct(p) }, p === 100 ? 'All' : p + '%')))),

          custom && e('div', { className: 'bt2-custom' }, e('span', null, 'Custom arrangement'), e('button', { type: 'button', onClick: resetAuto }, 'Reset to auto')),

          /* formation: always visible */
          e('div', { className: 'bt2-sec' },
            e('div', { className: 'bt2-sec-h' }, 'Formation', e('button', { type: 'button', className: 'bt3-help-btn', onClick: () => setGuide(true) }, 'Battle guide')),
            e('div', { className: 'bt3-forms', role: 'group', 'aria-label': 'Formation' }, forms.map((f) => {
              const ok = custom || fits[f];
              return e('button', { key: f, type: 'button', className: 'bt3-form' + (ok ? '' : ' nofit'), 'aria-pressed': String(f === st.formation), 'aria-disabled': String(!ok), onClick: () => onForm(f) },
                e(FormShape, { formation: f, config }), fname(f), !ok && e('small', null, 'Doesn\u2019t fit'));
            })),
            e('div', { className: 'bt3-trait' }, traits.length ? effectText(traits[0]).text : fname(st.formation)),
            e('div', { className: 'bt3-eff' },
              e('span', { className: 'bt3-chip good' }, 'Beats ' + match.beats.map(fname).join(' & ') + ' (+' + fb + '% attack)'),
              match.weak.length > 0 && e('span', { className: 'bt3-chip bad' }, 'Loses to ' + match.weak.map(fname).join(' & ')))),

          /* the battlefield: all four positions, always visible */
          e('div', { className: 'bt2-sec' },
            e('div', { className: 'bt2-sec-h' }, 'Your positions', e('span', { className: 'bt2-sec-sub' }, 'Tap one to change it')),
            e('div', { className: 'bt3-field' },
              e('div', { className: 'bt3-enemy' }, 'Enemy'),
              e('div', { className: 'bt3-board' }, SLOTS.map(tile)),
              e('div', { className: 'bt3-own' }, 'Your army')),
            note && e('div', { className: 'bt-note', role: 'status' }, note),
            e('div', { className: 'bt2-tools' },
              e('button', { type: 'button', onClick: resetAuto }, 'Auto-arrange'),
              e('button', { type: 'button', onClick: clearAll }, 'Clear all'))),

          /* bonuses in play */
          e('div', { className: 'bt2-sec' },
            e('div', { className: 'bt2-sec-h' }, 'Bonuses in play'),
            slotFx.length ? e('div', { className: 'bt3-eff', style: { marginTop: 0 } }, slotFx.map((x, i) => e(Chip, { key: i, item: x })))
              : e('div', { className: 'bt3-hint', style: { marginTop: 0 } }, 'None yet. Try Cavalry on a flank, Archers at the rear or Spears in front.'),
            e('div', { className: 'bt3-hint' }, 'Enemy counters (their formation and troops) show up in the battle report.'))),

        e('div', { className: 'bt2-foot' },
          stats.error && stats.total > 0 && e('div', { className: 'bt-err', role: 'alert' }, stats.error),
          e('div', { className: 'action-row' },
            e('button', { className: 'action-btn primary bt2-go', type: 'button', disabled: !!stats.error || !!busy || ids.length === 0, onClick: submit },
              Icon(isDef ? 'shield' : 'sword'), busy ? 'Working\u2026' : (verb + (stats.total ? ' \u00b7 ' + num(stats.total) + (isDef ? '' : ' soldiers') : ''))),
            e('button', { className: 'action-btn secondary', type: 'button', onClick: onClose }, 'Cancel')))),
      guide && e(GuideSheet, { config, onClose: () => setGuide(false) }));
  }

  /* ---------------- camp matchup: what your army does against a camp ---------------- */
  function CampMatchup({ preview }) {
    if (!preview || !preview.attLayout) return null;
    const mine = preview.effects.att.filter((x) => x.type !== 'formation');
    const theirs = preview.effects.def.filter((x) => x.type === 'slot' || x.type === 'class_counter' || x.type === 'class_weak');
    const foeCounters = theirs.filter((x) => x.type !== 'slot');
    return e('div', { className: 'bt2-sec' },
      e('div', { className: 'bt2-sec-h' }, 'Matchup'),
      e('div', { className: 'bt3-form-vs' }, e('span', null, 'You: ', e('b', null, fname(preview.attLayout.formation))), e('span', null, 'Camp: ', e('b', null, fname(preview.defLayout.formation)))),
      e('div', { className: 'bt3-eff', style: { marginTop: 4 } },
        mine.length ? mine.map((x, i) => e(Chip, { key: i, item: x })) : e('span', { className: 'bt3-chip' }, 'No special counters either way'),
        foeCounters.length > 0 && e('span', { className: 'bt3-hint', style: { width: '100%', margin: 0 } }, 'Their counters are already included above (they work both ways).')));
  }

  /* ---------------- tapping another player's castle ---------------- */
  function CastleSheet({ castle, civName, onClose, onAttack }) {
    if (!castle) return null;
    const npc = String(castle.id).startsWith('npc_');
    return e('div', { className: 'overlay open', onClick: backdrop(onClose) },
      e('div', { className: 'sheet bt-sheet' },
        Head({ icon: 'hall', title: castle.name, sub: civName || castle.civId, onClose }),
        e('p', { className: 'bt-sub' }, npc
          ? 'A castle of the old world. Nobody lives here, and it cannot be attacked yet. Look for the camps on the map if you want a fight.'
          : 'Another player\u2019s castle. You attack, their saved defense answers, and the result is instant.'),
        !npc && e('div', { className: 'bt-group' },
          e('div', { className: 'bt-line' }, e('span', null, 'Battle'), e('span', null, 'Instant, no march')),
          e('div', { className: 'bt-line' }, e('span', null, 'Their defense'), e('span', null, 'Secret until the fight')),
          e('div', { className: 'bt-line' }, e('span', null, 'If you win'), e('span', null, 'Loot from their storage')),
          e('div', { className: 'bt-line' }, e('span', null, 'New players'), e('span', null, 'Protected from attacks'))),
        !npc && e('p', { className: 'bt3-hint' }, 'Tip: you do not know their formation. A balanced army with a strong front line is the safest guess, and the report will show what they used.'),
        e('div', { className: 'action-row', style: { marginTop: '14px' } },
          !npc && e('button', { className: 'action-btn primary', type: 'button', onClick: () => onAttack(castle) }, Icon('sword'), 'Attack'),
          e('button', { className: 'action-btn secondary', type: 'button', onClick: onClose }, 'Close'))));
  }

  /* ---------------- battle report ---------------- */
  const RES = { food: 'wheat', wood: 'wood', stone: 'stone', iron: 'iron', coin: 'coin' };
  const loseList = (o) => troopText(o) || 'None';

  /** Turns the server report into "you" and "foe" (role = 'attacker' | 'defender'). */
  function sides(r, role) {
    const att = role !== 'defender';
    const A = { formation: r.attackerFormation, power: r.attackerPower, sent: r.sent, losses: r.losses, survivors: r.survivors, wounded: r.wounded, slots: (r.slots || {}).att, effects: (r.effects || {}).att, broke: (r.events || []).find((x) => x.side === 'att') };
    const D = { formation: r.defenderFormation, power: r.defenderPower, sent: r.defenderSent, losses: r.defenderLosses, survivors: r.defenderSurvivors, wounded: r.defenderWounded, slots: (r.slots || {}).def, effects: (r.effects || {}).def, broke: (r.events || []).find((x) => x.side === 'def') };
    return { you: att ? A : D, foe: att ? D : A, att, youWon: att ? !!r.win : !r.win };
  }
  const total = (o) => Object.values(o || {}).reduce((a, n) => a + n, 0);

  function ReportView({ report, role, title }) {
    const [more, setMore] = useState(false);
    if (!report) return null;
    const r = report;
    if (r.gone) return e('div', { className: 'bt-banner raid' }, e('h3', null, 'Too late'), e('p', null, (title || 'The camp') + ' was already destroyed. Your army comes home.'));
    const S = sides(r, role);
    const log = r.log || [];
    const scale = Math.max(1, ...log.map((l) => Math.max(l.attackerAlive, l.defenderAlive)), total(S.you.sent), total(S.foe.sent));
    const pw = (S.you.power || 0) + (S.foe.power || 0) || 1;
    const loot = Object.entries(r.loot || {}).filter(([, n]) => n > 0);
    const lost = total(S.you.losses), hurt = total(S.you.wounded), killed = total(S.foe.losses);
    const toneWord = S.att ? (r.win ? 'Victory' : 'Defeat') : (S.youWon ? 'Held' : 'Raided');
    const fx = [];
    const take = (list, side) => (list || []).filter((x) => x.type !== 'formation').forEach((x) => fx.push({ x, side }));
    take(S.you.effects, 'You'); take(S.foe.effects, 'Enemy');
    // matchup items first (they exist on both sides, show each once from each point of view)
    const matchup = fx.filter((f) => /counter|weak/.test(f.x.type) && f.side === 'You');
    const traits = fx.filter((f) => !/counter|weak/.test(f.x.type));
    const rows = SLOTS.map((s) => ({ s, y: (S.you.slots || {})[s] || { sent: 0, left: 0 }, f: (S.foe.slots || {})[s] || { sent: 0, left: 0 } }));
    const bar = (v, max, cls) => e('div', { className: 'bt3-sl-bar ' + cls }, e('i', { style: { width: (max > 0 ? Math.min(100, (v.left / max) * 100) : 0) + '%' } }));
    const slotMax = Math.max(1, ...rows.map((x) => Math.max(x.y.sent, x.f.sent)));
    return e(React.Fragment, null,
      e('div', { className: 'bt-banner ' + (S.att ? (r.win ? 'win' : 'loss') : (S.youWon ? 'win' : 'raid')) },
        e('h3', null, toneWord),
        e('p', null, (S.att ? (r.win ? 'You broke ' : 'You could not break ') : (S.youWon ? 'Your defense held against ' : 'You were overrun by ')) + (title || 'the enemy') + ' in ' + (r.ticks || log.length) + ' rounds')),
      e('div', { className: 'bt-group' },
        e('h4', null, S.att ? (r.win ? 'You looted' : 'Loot') : 'Stolen from you'),
        loot.length ? e('div', { className: 'bt-loot' }, loot.map(([k, n]) => e('span', { key: k, className: 'bt-res' + (S.att ? '' : ' neg') }, Icon(RES[k] || 'coin'), (S.att ? '+' : '\u2212') + num(n))))
          : e('div', { className: 'bt-none' }, S.att ? (r.win ? 'Their storage was empty or your army could not carry any.' : 'Nothing, because you did not win.') : 'Nothing was taken.')),
      e('div', { className: 'bt2-hero', style: { marginTop: '12px' } },
        e('div', { className: 'bt2-stat' }, e('small', null, 'You lost'), e('b', null, num(lost)), hurt > 0 && e('small', null, num(hurt) + ' wounded, they heal')),
        e('div', { className: 'bt2-stat' }, e('small', null, 'Enemy lost'), e('b', null, num(killed)))),

      /* why it went this way */
      (matchup.length > 0 || traits.length > 0 || S.you.broke || S.foe.broke) && e('div', { className: 'bt-group' },
        e('h4', null, 'What decided the battle'),
        e('div', { className: 'bt3-form-vs' }, e('span', null, 'You: ', e('b', null, fname(S.you.formation))), e('span', null, 'Enemy: ', e('b', null, fname(S.foe.formation)))),
        e('div', { className: 'bt3-why' },
          matchup.map((f, i) => e(Chip, { key: 'm' + i, item: f.x })),
          traits.map((f, i) => e(Chip, { key: 't' + i, item: f.x, side: f.side }))),
        S.you.broke && e('div', { className: 'bt3-ev' }, 'Your front line broke in round ' + S.you.broke.tick + ': you took 20% more damage after that.'),
        S.foe.broke && e('div', { className: 'bt3-ev', style: { color: '#7bd88f' } }, 'You broke their front line in round ' + S.foe.broke.tick + '.')),

      /* positions */
      S.you.slots && S.foe.slots && e('div', { className: 'bt-group' },
        e('h4', null, 'Positions, soldiers left'),
        rows.map(({ s, y, f }) => e('div', { key: s, className: 'bt3-sl' + (y.sent + f.sent ? '' : ' bt3-sl-empty') },
          e('b', null, SLOT_INFO[s].name),
          e('div', { className: 'bt3-sl-bars' },
            bar(y, slotMax, 'you'), bar(f, slotMax, 'foe'),
            e('div', { className: 'bt3-sl-nums' }, e('span', null, y.left + ' / ' + y.sent), e('span', null, f.left + ' / ' + f.sent)))))),

      e('button', { type: 'button', className: 'bt2-more', 'aria-expanded': String(more), onClick: () => setMore((v) => !v) }, more ? 'Hide details' : 'Show details'),
      more && e(React.Fragment, null,
        e('div', { className: 'bt-vs' },
          e('div', { className: 'bt-side you' }, e('span', null, 'You \u00b7 ' + fname(S.you.formation)), e('b', null, num(S.you.power))),
          e('div', { className: 'bt-vs-mid' }, 'VS'),
          e('div', { className: 'bt-side foe' }, e('span', null, fname(S.foe.formation) + ' \u00b7 Enemy'), e('b', null, num(S.foe.power)))),
        e('div', { className: 'bt-split' }, e('i', { style: { width: ((S.you.power || 0) / pw * 100) + '%' } }), e('i', { style: { width: ((S.foe.power || 0) / pw * 100) + '%' } })),
        log.length > 0 && e('div', { className: 'bt-group' },
          e('h4', null, 'Soldiers standing, round by round'),
          e('div', { className: 'bt-rounds' }, log.map((l) => {
            const yv = S.att ? l.attackerAlive : l.defenderAlive, fv = S.att ? l.defenderAlive : l.attackerAlive;
            return e('div', { key: l.tick, className: 'bt-round', title: 'Round ' + l.tick + ': ' + num(yv) + ' vs ' + num(fv) },
              e('div', null, e('i', { className: 'you', style: { height: (yv / scale * 100) + '%' } }), e('i', { className: 'foe', style: { height: (fv / scale * 100) + '%' } })), e('span', null, l.tick));
          })),
          e('div', { className: 'bt-legend' }, e('span', null, e('i', { style: { background: '#4a9fe0' } }), 'You'), e('span', null, e('i', { style: { background: '#e0614f' } }), 'Enemy'))),
        e('div', { className: 'bt-group' },
          e('h4', null, 'Your army'),
          e('div', { className: 'bt-line' }, e('span', null, S.att ? 'Sent' : 'Defended with'), e('span', null, troopText(S.you.sent) || 'None')),
          e('div', { className: 'bt-line' }, e('span', null, 'Lost'), e('span', null, loseList(S.you.losses))),
          e('div', { className: 'bt-line' }, e('span', null, 'Wounded'), e('span', null, loseList(S.you.wounded)))),
        e('div', { className: 'bt-group' },
          e('h4', null, 'Enemy army'),
          e('div', { className: 'bt-line' }, e('span', null, 'Fielded'), e('span', null, troopText(S.foe.sent) || 'Unknown')),
          e('div', { className: 'bt-line' }, e('span', null, 'Lost'), e('span', null, loseList(S.foe.losses))))));
  }

  function ReportSheet({ report, role, title, onClose }) {
    if (!report) return null;
    return e('div', { className: 'overlay open', onClick: backdrop(onClose) },
      e('div', { className: 'sheet bt-sheet' },
        Head({ icon: 'scroll', title: 'Battle report', sub: title, onClose }),
        e(ReportView, { report, role, title }),
        e('div', { className: 'action-row', style: { marginTop: '14px' } }, e('button', { className: 'action-btn primary', type: 'button', onClick: onClose }, 'Done'))));
  }

  /* ---------------- "your castle was attacked" ---------------- */
  function RaidSheet({ raid, onClose, onOpenDefense, onOpenReport }) {
    if (!raid) return null;
    const lootLost = Object.entries(raid.loot || {}).filter(([, n]) => n > 0);
    const held = !!raid.win;
    return e('div', { className: 'overlay open', onClick: backdrop(onClose) },
      e('div', { className: 'sheet bt-sheet' },
        Head({ icon: 'shield', title: 'Your castle was attacked', sub: raid.by ? 'by ' + raid.by : undefined, onClose }),
        e('div', { className: 'bt-banner ' + (held ? 'win' : 'raid') },
          e('h3', null, held ? 'Held' : 'Raided'),
          e('p', null, held ? 'Your defense held. The attackers were beaten back.' : 'The attackers broke through your defense.')),
        e('div', { className: 'bt-group' },
          e('h4', null, 'What it cost you'),
          e('div', { className: 'bt-line' }, e('span', null, 'Fallen'), e('span', null, loseList(raid.losses))),
          e('div', { className: 'bt-line' }, e('span', null, 'Wounded, still with you'), e('span', null, loseList(raid.wounded)))),
        e('div', { className: 'bt-group' },
          e('h4', null, 'Stolen'),
          lootLost.length ? e('div', { className: 'bt-loot' }, lootLost.map(([k, n]) => e('span', { key: k, className: 'bt-res neg' }, Icon(RES[k] || 'coin'), '\u2212' + num(n)))) : e('div', { className: 'bt-none' }, 'Nothing was taken.')),
        e('div', { className: 'action-row', style: { marginTop: '14px' } },
          onOpenReport && e('button', { className: 'action-btn primary', type: 'button', onClick: () => onOpenReport(raid) }, Icon('scroll'), 'Full report'),
          onOpenDefense && e('button', { className: 'action-btn secondary', type: 'button', onClick: onOpenDefense }, Icon('shield'), 'Change defense'),
          e('button', { className: 'action-btn secondary', type: 'button', onClick: onClose }, 'Close'))));
  }

  /** A button row for the War Room sheet: opens the defense editor. */
  function DefenseRow({ onClick }) {
    return e('button', { type: 'button', className: 'bt-row-btn', onClick },
      e('span', { className: 'ic' }, Icon('shield')),
      e('span', null, e('strong', null, 'Castle defense'), e('small', null, 'Choose how your troops stand when someone attacks your castle. Without a saved formation they arrange themselves.')));
  }

  return { FormationSheet, GuideSheet, CastleSheet, ReportView, ReportSheet, RaidSheet, DefenseRow, CampMatchup, ClsIcon, FormShape };
}
