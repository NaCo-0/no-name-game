/** Small helpers to read / change a player's server-side save (same pattern as world.js attack/claim and pvp.js). */
import { GameSave } from '../models.js';
import { httpError } from '../httpError.js';

export const RES = ['food', 'wood', 'stone', 'iron', 'coin'];

export async function loadRow(playerId) {
  const row = await GameSave.findOne({ where: { playerId } });
  if (!row?.culture) throw httpError(409, 'choose a civilization first (POST /api/game/join)', { code: 'no_culture' });
  return row;
}
export const troopsOf = (row) => ({ ...((((row.data || {}).army || {}).troops || {})[row.culture] || {}) });
export const resOf = (row) => ({ food: 0, wood: 0, stone: 0, iron: 0, coin: 0, ...((((row.data || {}).resources || {})[row.culture]) || {}) });

/** New `data` with the troops (and optionally the resources) of the row's culture replaced. */
export function withState(row, troops, resources) {
  const data = row.data || {};
  const army = { ...(data.army || { troops: {}, queue: {} }) };
  if (troops) army.troops = { ...(army.troops || {}), [row.culture]: troops };
  const out = { ...data, army };
  if (resources) out.resources = { ...(data.resources || {}), [row.culture]: resources };
  return out;
}

/** Revision-guarded write: if somebody saved in between, 409 "stale". Returns the new revision. */
export async function writeRow(row, data, transaction) {
  const [n] = await GameSave.update({ data, revision: row.revision + 1 }, { where: { id: row.id, revision: row.revision }, transaction });
  if (!n) throw httpError(409, 'stale save: try again', { code: 'stale', version: row.revision });
  return row.revision + 1;
}

export function staleCheck(row, baseVersion, what) {
  if (Number.isInteger(baseVersion) && baseVersion !== row.revision) {
    throw httpError(409, `stale save: save first, then ${what}`, { code: 'stale', version: row.revision });
  }
}

/** Retry a read-modify-write that another save can interrupt (used for players who are NOT the caller, e.g. a rally defender). */
export async function retryStale(fn, tries = 4) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (err) { if (err?.extra?.code !== 'stale' || i >= tries - 1) throw err; }
  }
}

export const addTroops = (have, add) => {
  const out = { ...have };
  for (const [id, n] of Object.entries(add || {})) if (n > 0) out[id] = Math.min(1e9, (out[id] || 0) + n);
  return out;
};
export const addRes = (have, add) => {
  const out = { ...have };
  for (const [k, n] of Object.entries(add || {})) if (RES.includes(k) && n > 0) out[k] = Math.min(1e12, (out[k] || 0) + n);
  return out;
};
