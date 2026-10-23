import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));

export function loadConfig(env = process.env) {
  const prod = env.NODE_ENV === 'production';
  if (prod && !env.SESSION_SECRET) throw new Error('SESSION_SECRET is required in production');
  return {
    prod,
    port: Number(env.PORT) || 3000,
    projectRoot: path.resolve(env.PROJECT_ROOT || path.join(here, '..', '..')),
    dbFile: env.DB_FILE || path.resolve(here, '..', 'data', 'game.sqlite'),
    sessionSecret: env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    adminEmail: (env.ADMIN_EMAIL || 'admin@example.com').trim().toLowerCase(),
    adminPassword: (env.ADMIN_PASSWORD || '').trim(), // trimmed: cmd's `set X=abc && ...` puts a stray space at the end
    // empty = a random one is generated on the first start (when there is no admin yet) and printed once
    tokenTtlDays: Number(env.TOKEN_TTL_DAYS) || 30,
  };
}
