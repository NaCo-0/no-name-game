/** Server clock: "day 1" starts when the server cycle starts (Meta key serverStartAt, set on first boot; SERVER_START_AT env overrides). */
import { Meta } from '../models.js';

export const DAY_MS = 24 * 3600 * 1000;
let cached = null;

export async function serverStart() {
  if (cached) return cached;
  const env = Number(process.env.SERVER_START_AT);
  if (Number.isFinite(env) && env > 0) return (cached = env);
  const m = await Meta.findByPk('serverStartAt');
  let v = m ? Number(m.value) : NaN;
  if (!Number.isFinite(v)) { v = Date.now(); await Meta.upsert({ key: 'serverStartAt', value: String(v) }); }
  return (cached = v);
}

/** Admin / tests: move the start of the cycle. */
export async function setServerStart(ms) {
  cached = ms;
  await Meta.upsert({ key: 'serverStartAt', value: String(ms) });
}
export const resetClockCache = () => { cached = null; };

/** 1 on the first day of the cycle. */
export async function serverDay(now = Date.now()) {
  return Math.max(1, Math.floor((now - (await serverStart())) / DAY_MS) + 1);
}
