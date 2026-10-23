/**
 * Create an admin or reset its password, WITHOUT environment variables (works in cmd, PowerShell, anything):
 *
 *   npm run admin -- you@example.com MyStrongPass123
 *
 * The server does not need to be restarted: it reads the database on every login.
 */
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { hashPassword } from './auth.js';

const [emailArg, passwordArg] = process.argv.slice(2);
const email = String(emailArg || '').trim().toLowerCase();
const password = String(passwordArg || '').trim();

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) {
  console.log('Usage:  npm run admin -- you@example.com MyStrongPass123');
  console.log('(a valid email, and a password of at least 8 characters; avoid & ^ % in cmd)');
  process.exit(1);
}

const config = loadConfig();
const db = await createDb({ storage: config.dbFile });
const hash = await hashPassword(password);
const row = await db.models.AdminUser.findOne({ where: { email } });
if (row) await row.update({ passwordHash: hash }); else await db.models.AdminUser.create({ email, passwordHash: hash });
const all = (await db.models.AdminUser.findAll()).map((a) => a.email).join(', ');
console.log(`${row ? 'Password updated' : 'Admin created'}: ${email}`);
console.log(`Database: ${config.dbFile}`);
console.log(`All admin accounts: ${all}`);
console.log('Now log in at http://localhost:5173/admin with this email and password.');
await db.sequelize.close();
