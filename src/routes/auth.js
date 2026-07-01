// Authentication routes: register, login, me.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma.js';
import { signToken } from '../lib/jwt.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

// Strip sensitive fields before returning a user to the client.
function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    displayName: u.displayName,
    createdAt: u.createdAt,
  };
}

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    let { username, email, password, displayName } = req.body || {};

    username = typeof username === 'string' ? username.trim() : '';
    email = typeof email === 'string' ? email.trim().toLowerCase() : '';
    displayName = typeof displayName === 'string' ? displayName.trim() : '';

    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({ error: 'Username must be 3–20 letters, numbers or underscores' });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'A valid email is required' });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (!displayName) displayName = username;
    if (displayName.length > 40) {
      return res.status(400).json({ error: 'Display name is too long' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: { username, email, passwordHash, displayName },
    });

    const token = signToken(user);
    return res.status(201).json({ token, user: publicUser(user) });
  } catch (err) {
    // Prisma unique-constraint violation
    if (err && err.code === 'P2002') {
      const field = Array.isArray(err.meta?.target) ? err.meta.target[0] : 'account';
      return res.status(409).json({ error: `That ${field} is already taken` });
    }
    console.error('register error:', err);
    return res.status(500).json({ error: 'Could not create account' });
  }
});

// POST /api/auth/login  — identifier may be username OR email
router.post('/login', async (req, res) => {
  try {
    let { username, email, identifier, password } = req.body || {};
    const id = (identifier || username || email || '').toString().trim().toLowerCase();

    if (!id || typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'Username/email and password are required' });
    }

    const user = await prisma.user.findFirst({
      where: { OR: [{ username: id }, { email: id }] },
    });

    // Same generic message whether the user exists or not.
    const ok = user && (await bcrypt.compare(password, user.passwordHash));
    if (!ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signToken(user);
    return res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ error: 'Could not log in' });
  }
});

// GET /api/auth/me
router.get('/me', authRequired, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({ user: publicUser(user) });
  } catch (err) {
    console.error('me error:', err);
    return res.status(500).json({ error: 'Could not load profile' });
  }
});

export default router;
