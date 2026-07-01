// room.js — orchestrates the room page: auth, socket, WebRTC, chat, whiteboard.
import { api, requireAuth, getToken, getDisplayName } from './api.js';
import {
  toast,
  setupTabs,
  setupCodePill,
  setupControls,
  setConnState,
  renderParticipants,
} from './ui.js';
import { createWebRTC } from './webrtc.js';
import { initChat } from './chat.js';
import { initWhiteboard } from './whiteboard.js';

requireAuth();

const params = new URLSearchParams(location.search);
const roomCode = (params.get('code') || '').toUpperCase();
const displayName = getDisplayName();

if (!roomCode) {
  location.href = '/lobby.html';
}

async function main() {
  // Confirm the room exists and show its details.
  let room;
  try {
    room = await api(`/api/rooms/${encodeURIComponent(roomCode)}`);
  } catch (err) {
    toast(err.status === 404 ? 'That room no longer exists' : 'Could not load room', 'error');
    setTimeout(() => (location.href = '/lobby.html'), 1200);
    return;
  }

  document.getElementById('roomName').textContent = room.name || 'Room';
  document.title = `${room.name || 'Room'} · CodeAlpha VideoChat`;
  setupCodePill(room.code);
  setupTabs();

  // --- Connect the signaling socket (JWT-authenticated handshake) ---
  // `io` is the global from /socket.io/socket.io.js
  const socket = io({
    auth: { token: getToken(), displayName },
    transports: ['websocket', 'polling'],
  });

  socket.on('connect_error', (err) => {
    console.error('socket connect_error:', err.message);
    if (/auth/i.test(err.message)) {
      toast('Session expired — please sign in again', 'error');
      setTimeout(() => (location.href = '/login.html'), 1200);
    } else {
      setConnState('Reconnecting…');
    }
  });

  socket.on('connect', () => setConnState('In call'));
  socket.on('disconnect', () => setConnState('Disconnected'));

  // --- WebRTC mesh ---
  const rtc = createWebRTC({
    socket,
    displayName,
    toast,
    onStatus: () => setConnState('In call'),
    onParticipants: (others) => renderParticipants(displayName, others),
  });

  // --- Side panel features ---
  initChat({ socket, roomCode, toast });
  initWhiteboard({ socket });

  // --- Control bar ---
  setupControls({
    onMic: () => rtc.toggleMic(),
    onCam: () => rtc.toggleCam(),
    onScreen: () => rtc.toggleScreen(),
    onLeave: () => {
      rtc.leave();
      location.href = '/lobby.html';
    },
  });

  // Render the initial participants list (just you).
  renderParticipants(displayName, new Map());

  // Acquire media + join using lobby preference states.
  const initialMic = localStorage.getItem('lobby_mic_enabled') !== 'false';
  const initialCam = localStorage.getItem('lobby_cam_enabled') !== 'false';
  await rtc.start(roomCode, { initialMic, initialCam });

  // Notify peers if the tab is closed.
  window.addEventListener('beforeunload', () => rtc.leave());
}

main();
