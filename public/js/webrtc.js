// webrtc.js — WebRTC mesh: local media, peer connections, screen share.
//
// Topology: full mesh. The peer that *joins* opens an RTCPeerConnection and
// sends an offer to every peer already in the room. Existing peers answer.
// That clear "newcomer initiates" rule avoids offer/answer glare.
//
// Media is end-to-end encrypted by WebRTC's mandatory DTLS-SRTP — it never
// passes through our server; only signaling metadata is relayed by Socket.io.

const RTC_CONFIG = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

export function createWebRTC({ socket, displayName, onParticipants, onStatus, toast }) {
  // DOM
  const grid = document.getElementById('videoGrid');
  const localTile = document.getElementById('localTile');
  const localVideo = document.getElementById('localVideo');
  const localNameEl = document.getElementById('localName');

  // State
  let localStream = null;
  let screenStream = null;
  let isSharing = false;
  let micEnabled = true;
  let camEnabled = true;

  // socketId -> { pc, displayName, pendingCandidates: [], remoteSet: bool }
  const peers = new Map();
  // socketId -> displayName (everyone we know about, for the participants list)
  const names = new Map();

  // Active Speaker audio context state
  let audioCtx = null;
  const analyzers = new Map(); // socketId or 'local' -> { analyser, dataArray, source }
  let speakerInterval = null;

  function setupStreamAnalyzer(id, stream) {
    if (!stream || stream.getAudioTracks().length === 0) return;
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state === 'suspended') {
        const resume = () => {
          audioCtx.resume();
          window.removeEventListener('click', resume);
        };
        window.addEventListener('click', resume, { passive: true });
      }
      
      cleanupStreamAnalyzer(id);
      
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64; // small fft size is sufficient for volume checks
      source.connect(analyser);
      
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      analyzers.set(id, { analyser, dataArray, source });
    } catch (e) {
      console.warn('Failed to setup audio analyzer:', e);
    }
  }

  function cleanupStreamAnalyzer(id) {
    const data = analyzers.get(id);
    if (data) {
      try { data.source.disconnect(); } catch {}
      analyzers.delete(id);
    }
  }

  function startSpeakerDetection() {
    if (speakerInterval) clearInterval(speakerInterval);
    speakerInterval = setInterval(() => {
      let maxVal = 0;
      let activeId = null;

      if (!audioCtx || audioCtx.state === 'suspended') return;

      analyzers.forEach((data, id) => {
        if (id === 'local' && !micEnabled) return;
        
        data.analyser.getByteFrequencyData(data.dataArray);
        
        let sum = 0;
        for (let i = 0; i < data.dataArray.length; i++) {
          sum += data.dataArray[i];
        }
        const avg = sum / data.dataArray.length;

        if (avg > 15 && avg > maxVal) {
          maxVal = avg;
          activeId = id;
        }
      });

      const localTileEl = document.getElementById('localTile');
      if (activeId === 'local') {
        localTileEl?.classList.add('active-speaker');
        ensureSpeakerIndicator(localTileEl);
      } else {
        localTileEl?.classList.remove('active-speaker');
        removeSpeakerIndicator(localTileEl);
      }

      peers.forEach((entry, socketId) => {
        const tile = document.getElementById(`tile-${socketId}`);
        if (tile) {
          if (socketId === activeId) {
            tile.classList.add('active-speaker');
            ensureSpeakerIndicator(tile);
          } else {
            tile.classList.remove('active-speaker');
            removeSpeakerIndicator(tile);
          }
        }
      });
    }, 200);
  }

  function ensureSpeakerIndicator(tile) {
    const nameEl = tile.querySelector('.name');
    if (nameEl && !nameEl.querySelector('.speaking-indicator')) {
      const indicator = document.createElement('div');
      indicator.className = 'speaking-indicator';
      indicator.innerHTML = '<span></span><span></span><span></span>';
      nameEl.appendChild(indicator);
    }
  }

  function removeSpeakerIndicator(tile) {
    const nameEl = tile.querySelector('.name');
    if (nameEl) {
      nameEl.querySelector('.speaking-indicator')?.remove();
    }
  }

  // ---- Participants helpers ----
  function publishParticipants() {
    onParticipants?.(new Map(names));
    updateGridDensity();
  }
  function updateGridDensity() {
    const total = grid.querySelectorAll('.tile').length;
    grid.classList.toggle('few', total <= 2);
  }

  // ---- Video tiles ----
  function initialOf(name) {
    return (name || '?').trim().charAt(0).toUpperCase() || '?';
  }

  function ensureTile(socketId, name) {
    let tile = document.getElementById(`tile-${socketId}`);
    if (tile) return tile;

    tile = document.createElement('div');
    tile.className = 'tile';
    tile.id = `tile-${socketId}`;
    tile.dataset.initial = initialOf(name);
    tile.innerHTML = `
      <video autoplay playsinline></video>
      <div class="badges">
        <div class="badge mic">🔇</div>
        <div class="badge cam">📷</div>
      </div>
      <div class="name"><span class="who">${escapeHtml(name || 'Guest')}</span></div>`;
    grid.appendChild(tile);
    updateGridDensity();
    return tile;
  }

  function attachRemoteStream(socketId, name, stream) {
    const tile = ensureTile(socketId, name);
    const video = tile.querySelector('video');
    if (video.srcObject !== stream) video.srcObject = stream;
  }

  function removeTile(socketId) {
    document.getElementById(`tile-${socketId}`)?.remove();
    updateGridDensity();
  }

  // ---- Peer connection lifecycle ----
  function activeVideoTrack() {
    if (isSharing && screenStream) return screenStream.getVideoTracks()[0];
    return localStream?.getVideoTracks()[0] || null;
  }

  function buildPeer(socketId, name) {
    if (peers.has(socketId)) return peers.get(socketId).pc;

    const pc = new RTCPeerConnection(RTC_CONFIG);
    const entry = { pc, displayName: name, pendingCandidates: [], remoteSet: false };
    peers.set(socketId, entry);
    names.set(socketId, name);

    // Send local audio + the currently-active video track (camera or screen).
    localStream.getAudioTracks().forEach((t) => pc.addTrack(t, localStream));
    const vTrack = activeVideoTrack();
    if (vTrack) pc.addTrack(vTrack, localStream);

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('ice-candidate', { target: socketId, candidate: e.candidate });
    };

    pc.ontrack = (e) => {
      const stream = e.streams[0];
      attachRemoteStream(socketId, entry.displayName, stream);
      setupStreamAnalyzer(socketId, stream);
      onStatus?.('connected');
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        // A failed connection won't recover on its own in this simple demo.
        removePeer(socketId);
      }
    };

    publishParticipants();
    return pc;
  }

  async function flushCandidates(socketId) {
    const entry = peers.get(socketId);
    if (!entry) return;
    entry.remoteSet = true;
    for (const c of entry.pendingCandidates) {
      try { await entry.pc.addIceCandidate(c); } catch (err) { console.warn('addIceCandidate failed', err); }
    }
    entry.pendingCandidates = [];
  }

  function removePeer(socketId) {
    const entry = peers.get(socketId);
    if (entry) {
      try { entry.pc.close(); } catch {}
      peers.delete(socketId);
    }
    cleanupStreamAnalyzer(socketId);
    names.delete(socketId);
    removeTile(socketId);
    publishParticipants();
  }

  // Newcomer -> existing peer: create and send an offer.
  async function callPeer(socketId, name) {
    try {
      const pc = buildPeer(socketId, name);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('offer', { target: socketId, sdp: pc.localDescription });
    } catch (err) {
      console.error('callPeer error', err);
    }
  }

  // ---- Socket wiring ----
  function wireSocket() {
    socket.on('existing-participants', async ({ participants }) => {
      onStatus?.('connected');
      for (const p of participants) {
        names.set(p.socketId, p.displayName);
        await callPeer(p.socketId, p.displayName);
      }
      publishParticipants();
    });

    socket.on('user-joined', ({ socketId, displayName: name }) => {
      // They will send us an offer; just remember their name for now.
      names.set(socketId, name);
      publishParticipants();
      toast?.(`${name} joined`);
    });

    socket.on('offer', async ({ from, sdp, displayName: name }) => {
      try {
        const pc = buildPeer(from, name || names.get(from) || 'Guest');
        const entry = peers.get(from);
        if (name) entry.displayName = name;
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        await flushCandidates(from);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('answer', { target: from, sdp: pc.localDescription });
      } catch (err) {
        console.error('handle offer error', err);
      }
    });

    socket.on('answer', async ({ from, sdp }) => {
      const entry = peers.get(from);
      if (!entry) return;
      try {
        await entry.pc.setRemoteDescription(new RTCSessionDescription(sdp));
        await flushCandidates(from);
      } catch (err) {
        console.error('handle answer error', err);
      }
    });

    socket.on('ice-candidate', async ({ from, candidate }) => {
      const entry = peers.get(from);
      if (!entry || !candidate) return;
      const ice = new RTCIceCandidate(candidate);
      if (entry.remoteSet) {
        try { await entry.pc.addIceCandidate(ice); } catch (err) { console.warn('addIceCandidate', err); }
      } else {
        entry.pendingCandidates.push(ice);
      }
    });

    socket.on('user-left', ({ socketId }) => {
      const name = names.get(socketId);
      removePeer(socketId);
      if (name) toast?.(`${name} left`);
    });
  }

  // ---- Public controls ----
  async function start(roomCode, { initialMic = true, initialCam = true } = {}) {
    localNameEl.textContent = displayName;
    localTile.dataset.initial = initialOf(displayName);

    try {
      // Capture both audio and video so we have the tracks ready for in-call toggles
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      
      micEnabled = initialMic;
      camEnabled = initialCam;
      
      localStream.getAudioTracks().forEach(t => t.enabled = micEnabled);
      localStream.getVideoTracks().forEach(t => t.enabled = camEnabled);
    } catch (err) {
      console.warn('getUserMedia both tracks failed, trying fallback...', err);
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        micEnabled = false;
        camEnabled = initialCam;
        localStream.getVideoTracks().forEach(t => t.enabled = camEnabled);
      } catch (err2) {
        try {
          localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
          micEnabled = initialMic;
          camEnabled = false;
          localStream.getAudioTracks().forEach(t => t.enabled = micEnabled);
        } catch (err3) {
          toast?.('Camera/microphone unavailable — joining without media', 'error');
          localStream = new MediaStream();
          micEnabled = false;
          camEnabled = false;
        }
      }
    }
    
    localVideo.srcObject = localStream;
    localTile.classList.toggle('muted', !micEnabled);
    localTile.classList.toggle('cam-off', !camEnabled);

    // Sync button states on the control bar
    const micBtn = document.getElementById('micBtn');
    const camBtn = document.getElementById('camBtn');
    if (micBtn) {
      micBtn.className = `ctrl ${micEnabled ? 'active' : 'off'}`;
      micBtn.textContent = micEnabled ? '🎙️' : '🔇';
      micBtn.title = micEnabled ? 'Mute microphone' : 'Unmute microphone';
    }
    if (camBtn) {
      camBtn.className = `ctrl ${camEnabled ? 'active' : 'off'}`;
      camBtn.textContent = camEnabled ? '📷' : '🚫';
      camBtn.title = camEnabled ? 'Turn camera off' : 'Turn camera on';
    }

    setupStreamAnalyzer('local', localStream);

    wireSocket();
    socket.emit('join-room', { roomCode });
    publishParticipants();

    startSpeakerDetection();
  }

  function toggleMic() {
    const tracks = localStream.getAudioTracks();
    if (!tracks.length) { toast?.('No microphone available', 'error'); return micEnabled; }
    micEnabled = !micEnabled;
    tracks.forEach((t) => (t.enabled = micEnabled));
    localTile.classList.toggle('muted', !micEnabled);
    return micEnabled;
  }

  function toggleCam() {
    const tracks = localStream.getVideoTracks();
    if (!tracks.length) { toast?.('No camera available', 'error'); return camEnabled; }
    camEnabled = !camEnabled;
    tracks.forEach((t) => (t.enabled = camEnabled));
    localTile.classList.toggle('cam-off', !camEnabled);
    return camEnabled;
  }

  async function toggleScreen() {
    if (isSharing) {
      stopScreen();
      return false;
    }
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    } catch {
      return false; // user cancelled the picker
    }
    const screenTrack = screenStream.getVideoTracks()[0];
    isSharing = true;

    // Swap the outgoing video track on every peer connection.
    peers.forEach(({ pc }) => {
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
      if (sender) sender.replaceTrack(screenTrack);
    });

    // Update local preview (keep our audio).
    localVideo.srcObject = new MediaStream([screenTrack, ...localStream.getAudioTracks()]);
    localTile.classList.add('screen');
    localTile.classList.remove('cam-off');

    // Browser "Stop sharing" button.
    screenTrack.onended = () => stopScreen();
    return true;
  }

  function stopScreen() {
    if (!isSharing) return;
    isSharing = false;
    const camTrack = localStream.getVideoTracks()[0] || null;

    peers.forEach(({ pc }) => {
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
      if (sender && camTrack) sender.replaceTrack(camTrack);
    });

    if (screenStream) {
      screenStream.getTracks().forEach((t) => t.stop());
      screenStream = null;
    }
    localVideo.srcObject = localStream;
    localTile.classList.remove('screen');
    localTile.classList.toggle('cam-off', !camEnabled);
  }

  function leave() {
    if (speakerInterval) {
      clearInterval(speakerInterval);
      speakerInterval = null;
    }
    analyzers.forEach((v, k) => cleanupStreamAnalyzer(k));
    analyzers.clear();
    if (audioCtx) {
      try { audioCtx.close(); } catch {}
      audioCtx = null;
    }

    try { socket.emit('leave-room'); } catch {}
    peers.forEach(({ pc }) => { try { pc.close(); } catch {} });
    peers.clear();
    if (localStream) localStream.getTracks().forEach((t) => t.stop());
    if (screenStream) screenStream.getTracks().forEach((t) => t.stop());
    try { socket.disconnect(); } catch {}
  }

  return {
    start,
    toggleMic,
    toggleCam,
    toggleScreen,
    leave,
    isSharing: () => isSharing,
  };
}

// Small HTML escaper for names rendered into tiles.
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
