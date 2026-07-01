// ui.js — chrome around the call: toasts, tab switching, control bar,
// participants list, connection state and the copyable room code.

export function toast(message, type = '') {
  const stack = document.getElementById('toastStack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`.trim();
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .25s';
    setTimeout(() => el.remove(), 250);
  }, 3000);
}

export function setupTabs() {
  const tabs = document.querySelectorAll('.tab');
  const bodies = document.querySelectorAll('.tab-body');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const name = tab.dataset.tab;
      tabs.forEach((t) => t.classList.toggle('active', t === tab));
      bodies.forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
      // Let listeners know (the whiteboard needs to resize when revealed).
      document.dispatchEvent(new CustomEvent('tab-changed', { detail: { name } }));
    });
  });
}

export function setConnState(text) {
  const el = document.getElementById('connState');
  if (el) el.textContent = text;
}

export function setupCodePill(code) {
  const pill = document.getElementById('codePill');
  if (!pill) return;
  pill.textContent = code;
  pill.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast('Room code copied');
    } catch {
      toast('Copy failed — code is ' + code, 'error');
    }
  });
}

export function setupControls({ onMic, onCam, onScreen, onLeave }) {
  const micBtn = document.getElementById('micBtn');
  const camBtn = document.getElementById('camBtn');
  const screenBtn = document.getElementById('screenBtn');
  const leaveBtn = document.getElementById('leaveBtn');

  micBtn.addEventListener('click', () => {
    const on = onMic();
    micBtn.classList.toggle('active', on);
    micBtn.classList.toggle('off', !on);
    micBtn.textContent = on ? '🎙️' : '🔇';
    micBtn.title = on ? 'Mute microphone' : 'Unmute microphone';
  });

  camBtn.addEventListener('click', () => {
    const on = onCam();
    camBtn.classList.toggle('active', on);
    camBtn.classList.toggle('off', !on);
    camBtn.textContent = on ? '📷' : '🚫';
    camBtn.title = on ? 'Turn camera off' : 'Turn camera on';
  });

  screenBtn.addEventListener('click', async () => {
    screenBtn.disabled = true;
    try {
      const sharing = await onScreen();
      screenBtn.classList.toggle('active', sharing);
      screenBtn.title = sharing ? 'Stop sharing your screen' : 'Share your screen';
    } finally {
      screenBtn.disabled = false;
    }
  });

  leaveBtn.addEventListener('click', onLeave);
}

// Render the participants list. `selfName` is shown first (you);
// `others` is a Map of socketId -> displayName.
export function renderParticipants(selfName, others) {
  const list = document.getElementById('participantList');
  const count = document.getElementById('pCount');
  if (!list) return;

  const people = [{ name: selfName, you: true }];
  for (const [, name] of others) people.push({ name, you: false });

  count.textContent = `(${people.length})`;
  list.innerHTML = people
    .map((p) => {
      const initial = (p.name || '?').charAt(0).toUpperCase();
      return `
        <li>
          <div class="avatar">${initial}</div>
          <div class="who">
            <span>${escapeHtml(p.name)}${p.you ? ' <small>(you)</small>' : ''}</span>
            <small>${p.you ? 'Host of your view' : 'Connected'}</small>
          </div>
        </li>`;
    })
    .join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
