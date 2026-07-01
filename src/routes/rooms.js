// Room routes: create a room, look one up, and upload / list its shared files.
import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import prisma from '../lib/prisma.js';
import { authRequired } from '../middleware/auth.js';
import { uploadsDir } from '../lib/paths.js';

const router = Router();

// ---- Room code generation -------------------------------------------------
// Unambiguous alphabet (no 0/O/1/I) so codes are easy to read & share aloud.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(len = 6) {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

async function uniqueRoomCode() {
  // Retry on the very unlikely chance of a collision.
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = randomCode();
    const existing = await prisma.room.findUnique({ where: { code } });
    if (!existing) return code;
  }
  throw new Error('Could not generate a unique room code');
}

// ---- Multer (file uploads) ------------------------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname).slice(0, 12); // keep extension sane
    cb(null, `${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

// ---- Routes ---------------------------------------------------------------

// POST /api/rooms  -> create a room, returns its short code
router.post('/', authRequired, async (req, res) => {
  try {
    let { name } = req.body || {};
    name = typeof name === 'string' && name.trim() ? name.trim().slice(0, 60) : 'Untitled room';

    const code = await uniqueRoomCode();
    const room = await prisma.room.create({
      data: { code, name, hostId: req.user.sub },
    });

    return res.status(201).json({
      id: room.id,
      code: room.code,
      name: room.name,
      hostId: room.hostId,
      createdAt: room.createdAt,
    });
  } catch (err) {
    console.error('create room error:', err);
    return res.status(500).json({ error: 'Could not create room' });
  }
});

// GET /api/rooms/:code  -> room existence / info
router.get('/:code', authRequired, async (req, res) => {
  try {
    const code = String(req.params.code || '').toUpperCase();
    const room = await prisma.room.findUnique({
      where: { code },
      include: { host: { select: { displayName: true, username: true } } },
    });
    if (!room) return res.status(404).json({ error: 'Room not found' });

    return res.json({
      id: room.id,
      code: room.code,
      name: room.name,
      host: room.host?.displayName || room.host?.username || null,
      createdAt: room.createdAt,
    });
  } catch (err) {
    console.error('get room error:', err);
    return res.status(500).json({ error: 'Could not load room' });
  }
});

// POST /api/rooms/:code/files  -> upload a file, returns { filename, url }
router.post('/:code/files', authRequired, upload.single('file'), async (req, res) => {
  try {
    const code = String(req.params.code || '').toUpperCase();
    const room = await prisma.room.findUnique({ where: { code } });
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const url = `/uploads/${req.file.filename}`;
    const filename = req.file.originalname;

    const record = await prisma.sharedFile.create({
      data: {
        roomId: room.id,
        filename,
        url,
        uploadedById: req.user.sub,
      },
    });

    return res.status(201).json({
      id: record.id,
      filename: record.filename,
      url: record.url,
      createdAt: record.createdAt,
    });
  } catch (err) {
    console.error('upload error:', err);
    return res.status(500).json({ error: 'Could not upload file' });
  }
});

// GET /api/rooms/:code/files  -> list shared files for the room
router.get('/:code/files', authRequired, async (req, res) => {
  try {
    const code = String(req.params.code || '').toUpperCase();
    const room = await prisma.room.findUnique({ where: { code } });
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const files = await prisma.sharedFile.findMany({
      where: { roomId: room.id },
      orderBy: { createdAt: 'asc' },
      include: { uploadedBy: { select: { displayName: true } } },
    });

    return res.json({
      files: files.map((f) => ({
        id: f.id,
        filename: f.filename,
        url: f.url,
        uploadedBy: f.uploadedBy?.displayName || 'Unknown',
        createdAt: f.createdAt,
      })),
    });
  } catch (err) {
    console.error('list files error:', err);
    return res.status(500).json({ error: 'Could not load files' });
  }
});

export default router;
