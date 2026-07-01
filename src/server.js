import 'dotenv/config';
import http from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import app from './app.js';
import { initSignaling } from './signaling.js';

const server = http.createServer(app);

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

export { server, io };
