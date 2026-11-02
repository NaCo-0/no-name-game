import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { Player, AdminUser } from './models.js';

const RANK = { viewer: 1, moderator: 2, superadmin: 3 };
const DUMMY = bcrypt.hashSync('dummy-password-for-timing', 10);

export const hashPassword = (p) => bcrypt.hash(p, 10);
export const verifyPassword = async (p, h) => bcrypt.compare(String(p ?? ''), h || DUMMY).then((ok) => ok && !!h);
export const signPlayer = (p) => jwt.sign({ sub: p.id, typ: 'player', v: p.tokenVersion ?? 0 }, config.jwtSecret, { expiresIn: '30d' });
export const signAdmin = (a) => jwt.sign({ sub: a.id, typ: 'admin' }, config.jwtSecret, { expiresIn: '12h' });

export function verifyToken(token, expectedTyp) {
  if (!token) return null;
  try {
    const p = jwt.verify(String(token), config.jwtSecret);
    return p.typ === expectedTyp ? p : null;
  } catch { return null; }
}

export function readToken(header, expectedTyp) {
  const m = /^Bearer (.+)$/.exec(header || '');
  return m ? verifyToken(m[1], expectedTyp) : null;
}

// Token ba tokenVersion-e hesab check mishe: ba taghir-e ramz hame-ye token-haye ghadimi bi-etebar mishan.
export const playerFromToken = async (tok) => {
  if (!tok) return null;
  const player = await Player.findByPk(tok.sub);
  if (!player || (tok.v ?? 0) !== player.tokenVersion) return null;
  return player;
};

export function validPassword(p) { return typeof p === 'string' && p.length >= 8 && p.length <= 72; }
export function validUsername(u) { return typeof u === 'string' && /^[A-Za-z0-9_\u0600-\u06FF]{3,24}$/.test(u); }

async function authPlayer(req, res, next, tok) {
  const player = await playerFromToken(tok);
  if (!player) return res.status(401).json({ error: 'unauthorized', message: 'not logged in' });
  if (player.banned) return res.status(403).json({ error: 'banned', reason: player.banReason, message: player.banReason ? `account banned: ${player.banReason}` : 'account banned' });
  req.player = player;
  next();
}
export const playerAuth = (req, res, next) => authPlayer(req, res, next, readToken(req.headers.authorization, 'player'));
// navigator.sendBeacon (zakhire ba baste shodan-e tab) nemitune header bede -> token dar ?token=
export const playerAuthQuery = (req, res, next) => authPlayer(req, res, next, readToken(req.headers.authorization, 'player') || verifyToken(req.query.token, 'player'));

export const adminAuth = (minRole = 'viewer') => async (req, res, next) => {
  const tok = readToken(req.headers.authorization, 'admin');
  if (!tok) return res.status(401).json({ error: 'unauthorized' });
  const admin = await AdminUser.findByPk(tok.sub);
  if (!admin || admin.disabled) return res.status(401).json({ error: 'unauthorized' });
  if (RANK[admin.role] < RANK[minRole]) return res.status(403).json({ error: 'forbidden', need: minRole });
  req.admin = admin;
  next();
};
