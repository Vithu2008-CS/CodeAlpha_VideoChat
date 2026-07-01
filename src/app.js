import express from 'express';
import { publicDir, uploadsDir } from './lib/paths.js';
import authRoutes from './routes/auth.js';
import roomRoutes from './routes/rooms.js';

const app = express();

// --- Core middleware ---
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// --- API routes ---
app.use('/api/auth', authRoutes);
app.use('/api/rooms', roomRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now() }));
app.get('/api/config', (req, res) => {
  res.json({
    signalingUrl: process.env.SIGNALING_SERVER_URL || ''
  });
});

// --- Static: uploaded files + frontend ---
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(publicDir));

// Friendly root redirect to the login page.
app.get('/', (req, res) => res.redirect('/login.html'));

// JSON 404 for unknown API routes (HTML pages fall through to static above).
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Centralised error handler (e.g. Multer file-size errors).
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error('Unhandled error:', err);
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  res.status(status).json({ error: err.message || 'Server error' });
});

export default app;
