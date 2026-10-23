import crypto from 'crypto';

const scrypt = (pw, salt) =>
  new Promise((resolve, reject) => crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? reject(e) : resolve(k))));

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [kind, saltHex, keyHex] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export const newToken = () => crypto.randomBytes(32).toString('hex');
export const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

/** Tiny in-memory limiter: max `limit` failures per `windowMs` for one key. */
export function createLimiter({ limit = 8, windowMs = 15 * 60 * 1000 } = {}) {
  const hits = new Map();
  const fresh = (key) => {
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length) hits.set(key, list); else hits.delete(key);
    return list;
  };
  return {
    blocked: (key) => fresh(key).length >= limit,
    fail: (key) => { const l = fresh(key); l.push(Date.now()); hits.set(key, l); },
    reset: (key) => hits.delete(key),
  };
}
