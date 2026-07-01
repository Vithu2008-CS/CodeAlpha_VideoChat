// Socket.io signaling + collaboration server.
//
// Responsibilities:
//   - Authenticate every socket via the JWT passed in the handshake.
//   - Relay WebRTC offers/answers/ICE candidates between peers (mesh topology).
//   - Broadcast chat messages, shared-file notifications and whiteboard events.
//
// No media ever flows through this server — only signaling metadata. The actual
// audio/video travels peer-to-peer over DTLS-SRTP encrypted WebRTC connections.
import { verifyToken } from './lib/jwt.js';

export function initSignaling(io) {
  // In-memory cache for room messages: roomCode -> Array of messages (limit 50)
  const roomMessages = new Map();
  // --- Handshake authentication ---
  io.use((socket, next) => {
    const auth = socket.handshake.auth || {};
    const token = auth.token;
    if (!token) return next(new Error('Authentication required'));

    try {
      const payload = verifyToken(token);
      socket.data.userId = payload.sub;
      // The lobby lets users pick a display name; fall back to the token's.
      const requested = typeof auth.displayName === 'string' ? auth.displayName.trim() : '';
      socket.data.displayName = (requested || payload.displayName || payload.username || 'Guest').slice(0, 40);
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    // --- Join a room ---
    socket.on('join-room', async ({ roomCode } = {}) => {
      if (!roomCode || typeof roomCode !== 'string') return;
      const code = roomCode.toUpperCase();

      socket.join(code);
      socket.data.roomCode = code;

      // Tell the newcomer who is already here so it can open peer connections.
      const peers = await io.in(code).fetchSockets();
      const participants = peers
        .filter((s) => s.id !== socket.id)
        .map((s) => ({
          socketId: s.id,
          displayName: s.data.displayName,
          userId: s.data.userId,
        }));

      const recentMessages = roomMessages.get(code) || [];

      socket.emit('existing-participants', { participants, recentMessages });

      // Tell everyone else that a new peer arrived.
      socket.to(code).emit('user-joined', {
        socketId: socket.id,
        displayName: socket.data.displayName,
        userId: socket.data.userId,
      });
    });

    // --- WebRTC signaling relay (targeted by socketId) ---
    socket.on('offer', ({ target, sdp } = {}) => {
      if (!target) return;
      io.to(target).emit('offer', {
        from: socket.id,
        sdp,
        displayName: socket.data.displayName,
      });
    });

    socket.on('answer', ({ target, sdp } = {}) => {
      if (!target) return;
      io.to(target).emit('answer', { from: socket.id, sdp });
    });

    socket.on('ice-candidate', ({ target, candidate } = {}) => {
      if (!target) return;
      io.to(target).emit('ice-candidate', { from: socket.id, candidate });
    });

    // --- Chat ---
    socket.on('chat-message', ({ text } = {}) => {
      const room = socket.data.roomCode;
      if (!room || typeof text !== 'string') return;
      const clean = text.trim().slice(0, 2000);
      if (!clean) return;

      const payload = {
        from: socket.id,
        displayName: socket.data.displayName,
        text: clean,
        ts: Date.now(),
      };

      if (!roomMessages.has(room)) {
        roomMessages.set(room, []);
      }
      const history = roomMessages.get(room);
      history.push(payload);
      if (history.length > 50) {
        history.shift();
      }

      io.to(room).emit('chat-message', payload);
    });

    // --- File sharing notification (file itself uploaded over HTTP) ---
    socket.on('file-shared', ({ filename, url } = {}) => {
      const room = socket.data.roomCode;
      if (!room || !filename || !url) return;
      io.to(room).emit('file-shared', {
        from: socket.id,
        displayName: socket.data.displayName,
        filename: String(filename).slice(0, 260),
        url: String(url).slice(0, 1024),
        ts: Date.now(),
      });
    });

    // --- Whiteboard ---
    socket.on('whiteboard-draw', (data = {}) => {
      const room = socket.data.roomCode;
      if (!room) return;
      // Relay to everyone else in the room (not back to the sender).
      socket.to(room).emit('whiteboard-draw', data);
    });

    socket.on('whiteboard-clear', () => {
      const room = socket.data.roomCode;
      if (!room) return;
      socket.to(room).emit('whiteboard-clear');
    });

    // --- Explicit leave + disconnect ---
    function leave() {
      const room = socket.data.roomCode;
      if (room) {
        socket.to(room).emit('user-left', { socketId: socket.id });
        socket.leave(room);
        socket.data.roomCode = null;
      }
    }

    socket.on('leave-room', leave);
    socket.on('disconnect', leave);
  });
}
