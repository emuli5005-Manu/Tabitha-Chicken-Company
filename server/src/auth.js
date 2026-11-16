import jwt from 'jsonwebtoken';
import { HttpError } from './lib/validate.js';

export const COOKIE_NAME = 'tcc_admin';
const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 16) {
  throw new Error('JWT_SECRET must be set to at least 16 characters');
}

export function issueSession(res, admin) {
  const token = jwt.sign(
    { sub: admin.id, email: admin.email, name: admin.name, role: admin.role },
    SECRET,
    { expiresIn: '12h' },
  );
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 12 * 60 * 60 * 1000,
    secure: false,
  });
}

export function endSession(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

/** Requires a valid admin session; attaches `req.admin`. */
export function requireAdmin(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return next(new HttpError(401, 'Sign in to continue.'));
  try {
    const payload = jwt.verify(token, SECRET);
    req.admin = { id: payload.sub, email: payload.email, name: payload.name, role: payload.role };
    return next();
  } catch {
    return next(new HttpError(401, 'Your session has expired. Sign in again.'));
  }
}

/** Role-based access control: only `admin` accounts may manage the catalogue. */
export function requireRole(role) {
  return (req, res, next) => {
    if (req.admin?.role !== role) {
      return next(new HttpError(403, 'You do not have permission to do that.'));
    }
    return next();
  };
}
