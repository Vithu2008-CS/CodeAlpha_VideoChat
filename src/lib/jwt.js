// JWT helpers shared by the HTTP routes and the Socket.io handshake.
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * Build a signed token from a user record.
 * `sub` is the user id; we also embed username + displayName for convenience.
 */
export function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, displayName: user.displayName },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/** Verify a token and return its payload, or throw. */
export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}
