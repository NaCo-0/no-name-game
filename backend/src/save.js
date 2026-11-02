/**
 * Validation of the save the game client (and the admin panel) sends. The client is still the one that
 * calculates production, costs and training (see README "Server-authoritative later"),
 * so here we only make sure the data has the right SHAPE and sane limits: nothing
 * nested weirdly, no NaN / negative numbers, no huge payloads, only known cultures.
 */
import { CULTURES, RESOURCE_KEYS } from './constants.js';
import { httpError } from './httpError.js';

const bad = (what) => httpError(400, `invalid save: ${what}`, { code: 'invalid_save' });
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const num = (v, min, max, what) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw bad(what);
  return v;
};
const int = (v, min, max, what) => Math.trunc(num(v, min, max, what));
const str = (v, max, what) => {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) throw bad(what);
  return v;
};

/** Keeps only flat values (string / number / boolean / null) of a small object. */
function flat(o, what) {
  if (!isObj(o)) throw bad(what);
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (k.length > 40 || k === '__proto__') continue;
    if (typeof v === 'string') out[k] = v.slice(0, 120);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean' || v === null) out[k] = v;
  }
  return out;
}

function byCulture(v, what, fn) {
  if (!isObj(v)) throw bad(what);
  const out = {};
  for (const [c, val] of Object.entries(v)) {
    if (!CULTURES.includes(c)) throw bad(`${what}: unknown culture "${c}"`);
    out[c] = fn(val, `${what}.${c}`);
  }
  return out;
}

function buildings(list, what) {
  if (!Array.isArray(list) || list.length > 80) throw bad(what);
  return list.map((b, i) => {
    const o = flat(b, `${what}[${i}]`);
    str(o.id, 40, `${what}[${i}].id`);
    o.level = int(o.level ?? 1, 1, 200, `${what}[${i}].level`);
    o.stored = num(o.stored ?? 0, 0, 1e9, `${what}[${i}].stored`);
    o.readyAt = num(o.readyAt ?? 0, 0, 4e12, `${what}[${i}].readyAt`);
    return o;
  });
}

function resources(r, what) {
  if (!isObj(r)) throw bad(what);
  const out = {};
  for (const k of RESOURCE_KEYS) out[k] = num(r[k] ?? 0, 0, 1e12, `${what}.${k}`);
  return out;
}

function army(a) {
  if (!isObj(a)) throw bad('army');
  const troops = byCulture(a.troops ?? {}, 'army.troops', (m, w) => {
    if (!isObj(m) || Object.keys(m).length > 60) throw bad(w);
    const out = {};
    for (const [id, n] of Object.entries(m)) out[str(id, 40, w)] = int(n, 0, 1e9, w);
    return out;
  });
  const queue = byCulture(a.queue ?? {}, 'army.queue', (q, w) => {
    if (!Array.isArray(q) || q.length > 100) throw bad(w);
    return q.map((j, i) => ({
      id: str(j && j.id, 60, `${w}[${i}].id`),
      troopId: str(j.troopId, 40, `${w}[${i}].troopId`),
      count: int(j.count, 1, 1e6, `${w}[${i}].count`),
      endsAt: num(j.endsAt, 0, 4e12, `${w}[${i}].endsAt`),
    }));
  });
  return { troops, queue };
}

function marches(list) {
  if (!Array.isArray(list) || list.length > 50) throw bad('marches');
  return list.map((m, i) => flat(m, `marches[${i}]`));
}

function settings(s) {
  if (!isObj(s)) throw bad('settings');
  const out = {};
  if ('sound' in s) out.sound = !!s.sound;
  if ('lang' in s) out.lang = str(s.lang, 8, 'settings.lang');
  return out;
}

/** Every culture key in a save must be the player's own civilization (nobody writes data for other civilizations). */
export function assertOnlyCulture(clean, culture) {
  const keys = [
    ...Object.keys(clean.buildings || {}),
    ...Object.keys(clean.resources || {}),
    ...Object.keys((clean.army && clean.army.troops) || {}),
    ...Object.keys((clean.army && clean.army.queue) || {}),
  ];
  const foreign = keys.find((k) => k !== culture);
  if (foreign) throw httpError(403, `invalid save: data for "${foreign}" is not allowed (your civilization is "${culture}")`, { code: 'wrong_culture' });
}

/** Returns only the parts the client actually sent, cleaned. */
export function sanitizeSave(body) {
  if (!isObj(body)) throw bad('body must be an object');
  const out = {};
  if ('buildings' in body) out.buildings = byCulture(body.buildings, 'buildings', buildings);
  if ('resources' in body) out.resources = byCulture(body.resources, 'resources', resources);
  if ('army' in body) out.army = army(body.army);
  if ('marches' in body) out.marches = marches(body.marches);
  if ('settings' in body) out.settings = settings(body.settings);
  return out;
}


/** Keys of `data` that the game itself writes. Anything else in `data` (e.g. added by an admin) is kept untouched. */
export const GAME_KEYS = ['buildings', 'resources', 'army', 'marches', 'settings'];

/** New data = old data + the cleaned parts the client sent (a partial save only changes what it carries). */
export const mergeSave = (oldData, clean) => ({ ...(oldData || {}), ...clean });

/** The shape game.html works with (`version` = the row's revision). */
export function publicSave(row) {
  const d = row.data || {};
  return {
    culture: row.culture,
    version: row.revision,
    buildings: d.buildings ?? null, // null = never saved: the client builds its starting state
    resources: d.resources ?? null,
    army: d.army ?? null,
    marches: d.marches ?? [],
    settings: d.settings ?? {},
    savedAt: row.updatedAt,
  };
}
