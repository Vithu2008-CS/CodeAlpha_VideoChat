// chat.js — room chat plus file sharing.
//
// Chat text is relayed over Socket.io. Files are uploaded over HTTP (Multer),
// then a small "file-shared" event broadcasts the download link to everyone.
import { api } from './api.js';

export function initChat({ socket, roomCode, toast }) {
  const log = document.getElementById('chatLog');
  const empty = document.getElementById('chatEmpty');
  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  const fileBtn = document.getElementById('fileBtn');
  const fileInput = document.getElementById('fileInput');
  const chatTab = document.querySelector('.tab[data-tab="chat"]');

  let unread = 0;

  function hideEmpty() {
    if (empty) empty.style.display = 'none';
  }

  function bumpUnread() {
    // If the chat tab isn't active, show a small unread counter.
    const active = document.querySelector('.tab-body.active')?.dataset.tab === 'chat';
    if (active) return;
    unread += 1;
    chatTab.innerHTML = `Chat <span class="count">(${unread})</span>`;
  }

  document.addEventListener('tab-changed', (e) => {
    if (e.detail?.name === 'chat') {
      unread = 0;
      chatTab.innerHTML = 'Chat';
      input?.focus();
    }
  });

  function scrollDown() {
    log.scrollTop = log.scrollHeight;
  }

  function addMessage({ text, displayName, mine, ts }) {
    hideEmpty();
    const wrap = document.createElement('div');
    wrap.className = `msg ${mine ? 'mine' : ''}`.trim();
    wrap.innerHTML = `
      <div class="meta">${escapeHtml(mine ? 'You' : displayName)} · ${time(ts)}</div>
      <div class="bubble">${linkify(escapeHtml(text))}</div>`;
    log.appendChild(wrap);
    scrollDown();
    if (!mine && !ts) bumpUnread();
  }

  function addSystem(text) {
    hideEmpty();
    const wrap = document.createElement('div');
    wrap.className = 'msg system';
    wrap.innerHTML = `<div class="bubble">${escapeHtml(text)}</div>`;
    log.appendChild(wrap);
    scrollDown();
  }

  function addFile({ filename, url, displayName, mine, historical }) {
    hideEmpty();
    const wrap = document.createElement('div');
    wrap.className = `msg file ${mine ? 'mine' : ''}`.trim();
    const who = mine ? 'You' : displayName;
    wrap.innerHTML = `
      <div class="meta">${escapeHtml(who)} shared a file${historical ? '' : ' · ' + time()}</div>
      <div class="bubble">
        <span class="file-icon">📄</span>
        <a href="${encodeURI(url)}" target="_blank" rel="noopener" download>${escapeHtml(filename)}</a>
      </div>`;
    log.appendChild(wrap);
    scrollDown();
    if (!mine && !historical) bumpUnread();
  }

  // ---- Sending ----
  function sendMessage() {
    const text = input.value.trim();
    if (!text) return;
    socket.emit('chat-message', { text });
    addMessage({ text, mine: true });
    input.value = '';
    input.focus();
  }

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendMessage(); }
  });

  fileBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    fileBtn.disabled = true;
    fileBtn.textContent = '⏳';
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api(`/api/rooms/${encodeURIComponent(roomCode)}/files`, {
        method: 'POST',
        body: form,
        raw: true,
      });
      // Tell the room, and show it locally.
      socket.emit('file-shared', { filename: res.filename, url: res.url });
      addFile({ filename: res.filename, url: res.url, mine: true });
      toast?.('File shared');
    } catch (err) {
      toast?.(err.message || 'Upload failed', 'error');
    } finally {
      fileBtn.disabled = false;
      fileBtn.textContent = '📎';
      fileInput.value = '';
    }
  });

  // ---- Receiving ----
  socket.on('existing-participants', ({ recentMessages } = {}) => {
    if (!recentMessages) return;
    recentMessages.forEach((msg) => {
      addMessage({
        text: msg.text,
        displayName: msg.displayName,
        mine: msg.from === socket.id,
        ts: msg.ts,
      });
    });
  });

  socket.on('chat-message', ({ from, displayName, text }) => {
    if (from === socket.id) return; // we already rendered our own
    addMessage({ text, displayName, mine: false });
  });

  socket.on('file-shared', ({ from, displayName, filename, url }) => {
    if (from === socket.id) return;
    addFile({ filename, url, displayName, mine: false });
  });

  // ---- Load files shared before we joined ----
  (async () => {
    try {
      const data = await api(`/api/rooms/${encodeURIComponent(roomCode)}/files`);
      for (const f of data.files || []) {
        addFile({ filename: f.filename, url: f.url, displayName: f.uploadedBy, mine: false, historical: true });
      }
    } catch { /* non-fatal */ }
  })();

  return { addSystem };
}

// ---- helpers ----
function time(ts) {
  const d = ts ? new Date(ts) : new Date();
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
// Turn bare URLs in already-escaped text into clickable links.
function linkify(escaped) {
  return escaped.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}
