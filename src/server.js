// Application entry point.
// Express serves the API + static frontend; Socket.io shares the same HTTP
// server and acts as the WebRTC signaling + collaboration channel.
import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { Server as SocketIOServer } from 'socket.io';

import { publicDir, uploadsDir } from './lib/paths.js';
import authRoutes from './routes/auth.js';
import roomRoutes from './routes/rooms.js';
import { initSignaling } from './signaling.js';

const app = express();
const server = http.createServer(app);

// --- Core middleware ---
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// --- API routes ---
app.use('/api/auth', authRoutes);
app.use('/api/rooms', roomRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now() }));

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

// --- Socket.io ---
const io = new SocketIOServer(server, {
  cors: { origin: true, credentials: true },
});
initSignaling(io);

const PORT = process.env.PORT || 3000;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ✖ Port ${PORT} is already in use.`);
    console.error(`    Stop the other process or start on a different port, e.g.:`);
    console.error(`      PORT=3001 npm run dev   (PowerShell: $env:PORT=3001; npm run dev)\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`\n  CodeAlpha VideoChat running`);
  console.log(`  ➜  Local:   http://localhost:${PORT}`);
  console.log(`  ➜  Express + Socket.io signaling server ready.\n`);
});

export { app, server, io };
