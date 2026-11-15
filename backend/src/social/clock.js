/** Server clock: "day 1" starts when the server cycle starts (Meta key serverStartAt, set on first boot; SERVER_START_AT env overrides). */
import { Meta } from '../models.js';

export const HOUR_MS = 3600 * 1000;
export const DAY_MS = 24 * HOUR_MS;
let cached = null;
let offsetCached = null;

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
export const resetClockCache = () => { cached = null; offsetCached = null; };

/**
 * Event clock = real time + admin offset (Meta key serverTimeOffset, in ms). Only the EVENTS use it (windows, claims):
 * building timers, marches and rallies keep running on real time. The admin panel moves it forward / back for testing.
 */
export async function timeOffset() {
  if (offsetCached != null) return offsetCached;
  const m = await Meta.findByPk('serverTimeOffset');
  const v = m ? Number(m.value) : 0;
  return (offsetCached = Number.isFinite(v) ? v : 0);
}
export async function setTimeOffset(ms) {
  offsetCached = Math.round(Number(ms) || 0);
  await Meta.upsert({ key: 'serverTimeOffset', value: String(offsetCached) });
  return offsetCached;
}
export async function serverNow() { return Date.now() + (await timeOffset()); }

/** 1 on the first day of the cycle. */
export async function serverDay(now = null) {
  now ??= await serverNow();
  return Math.max(1, Math.floor((now - (await serverStart())) / DAY_MS) + 1);
}
