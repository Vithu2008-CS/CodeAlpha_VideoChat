// Express middleware: require a valid `Authorization: Bearer <jwt>` header.
import { verifyToken } from '../lib/jwt.js';

export function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const payload = verifyToken(token);
    req.user = payload; // { sub, username, displayName, iat, exp }
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
