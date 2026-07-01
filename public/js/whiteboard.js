// whiteboard.js — shared HTML5 canvas.
//
// Every stroke segment is broadcast over Socket.io using *normalised* (0–1)
// coordinates, so the drawing stays in sync even when participants have
// different canvas sizes. Tools: pen, eraser, colour, brush size, clear.

export function initWhiteboard({ socket }) {
  const canvas = document.getElementById('whiteboard');
  const ctx = canvas.getContext('2d');

  const penBtn = document.getElementById('wbPen');
  const eraserBtn = document.getElementById('wbEraser');
  const colorInput = document.getElementById('wbColor');
  const sizeInput = document.getElementById('wbSize');
  const clearBtn = document.getElementById('wbClear');

  let tool = 'pen';
  let drawing = false;
  let last = null;

  // ---- Sizing (preserve drawing across resizes) ----
  function fit() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    if (canvas.width === w && canvas.height === h) return;

    const tmp = document.createElement('canvas');
    tmp.width = canvas.width;
    tmp.height = canvas.height;
    tmp.getContext('2d').drawImage(canvas, 0, 0);

    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, 0, 0, w, h);
  }

  // Canvas starts hidden (its tab is inactive); fit when it becomes visible.
  document.addEventListener('tab-changed', (e) => {
    if (e.detail?.name === 'whiteboard') fit();
  });
  window.addEventListener('resize', fit);
  if (window.ResizeObserver) new ResizeObserver(fit).observe(canvas);

  // ---- Drawing primitive (operates in backing-store pixels) ----
  function stroke(x0, y0, x1, y1, color, size, withTool) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = size;
    if (withTool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = color;
    }
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  function clearLocal() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  // ---- Pointer input ----
  function pointFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * sx,
      y: (e.clientY - rect.top) * sy,
    };
  }

  function emit(x0, y0, x1, y1) {
    socket.emit('whiteboard-draw', {
      x0: x0 / canvas.width,
      y0: y0 / canvas.height,
      x1: x1 / canvas.width,
      y1: y1 / canvas.height,
      color: colorInput.value,
      size: Number(sizeInput.value) / canvas.width, // normalise to width
      tool,
    });
  }

  canvas.addEventListener('pointerdown', (e) => {
    drawing = true;
    last = pointFromEvent(e);
    canvas.setPointerCapture(e.pointerId);
    // A dot for a single click.
    const size = Number(sizeInput.value);
    stroke(last.x, last.y, last.x + 0.01, last.y + 0.01, colorInput.value, size, tool);
    emit(last.x, last.y, last.x + 0.01, last.y + 0.01);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = pointFromEvent(e);
    const size = Number(sizeInput.value);
    stroke(last.x, last.y, p.x, p.y, colorInput.value, size, tool);
    emit(last.x, last.y, p.x, p.y);
    last = p;
  });

  function endStroke() { drawing = false; last = null; }
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  canvas.addEventListener('pointerleave', endStroke);

  // ---- Toolbar ----
  function selectTool(t) {
    tool = t;
    penBtn.classList.toggle('active', t === 'pen');
    eraserBtn.classList.toggle('active', t === 'eraser');
  }
  penBtn.addEventListener('click', () => selectTool('pen'));
  eraserBtn.addEventListener('click', () => selectTool('eraser'));
  clearBtn.addEventListener('click', () => {
    clearLocal();
    socket.emit('whiteboard-clear');
  });

  // ---- Remote events ----
  socket.on('whiteboard-draw', (d) => {
    stroke(
      d.x0 * canvas.width,
      d.y0 * canvas.height,
      d.x1 * canvas.width,
      d.y1 * canvas.height,
      d.color,
      (d.size || 0.005) * canvas.width,
      d.tool
    );
  });
  socket.on('whiteboard-clear', clearLocal);

  // Initial fit attempt (in case the tab is already visible).
  fit();
}
