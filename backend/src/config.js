import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';

let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  if (isProd) throw new Error('JWT_SECRET bayad dar halat-e production set beshe');
  jwtSecret = 'dev-only-secret-change-me';
  console.warn('[config] JWT_SECRET set nashode; faghat baraye develop ok-e.');
}

export const config = {
  isProd,
  port: Number(process.env.PORT || 3000),
  jwtSecret,
  dbStorage: process.env.DB_STORAGE || path.join(here, '..', 'data', 'game.sqlite'),
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:5174')
    .split(',').map((s) => s.trim()).filter(Boolean),
  authLimit: Number(process.env.AUTH_RATE_LIMIT || 30), // tedad-e darkhast-e register / login-e na-movafagh dar 15 daghighe (har IP)
  projectRoot: path.resolve(process.env.PROJECT_ROOT || path.join(here, '..', '..')), // ja-ee ke public/map.json hast
  adminDist: path.join(here, '..', '..', 'admin-panel', 'dist'),
};
