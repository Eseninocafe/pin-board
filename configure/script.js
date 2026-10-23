// Pin board editor. OBS holds the board (obs-websocket persistent data); every save also pushes it
// to the overlay browser source through obs-browser's emit_event. Nothing leaves this machine.

const W = 1920, H = 1080;   // scene
const BW = 596, BH = 601;   // board, as in board.css
const MAX_IMG = 1200;       // longest side kept when pinning an image
const MIN_W = 128;          // narrowest note, as .card in board.css
const TIP = 34;             // pin centre → pin tip, the point notes turn around (transform-origin in board.css)
const OBS_URL = 'ws://localhost:4455';
const SLOT = { realm: 'OBS_WEBSOCKET_DATA_REALM_GLOBAL', slotName: 'eseninocafe-pinboard' };
const PASSWORD_KEY = 'pinboard.obsPassword';

const $ = id => document.getElementById(id);
const view = $('view'), stage = $('stage'), scene = $('scene'), board = $('board');
const panel = $('panel'), form = $('connect'), pass = $('pass'), status = $('status');
const menu = $('menu'), file = $('file');
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sleep = ms => new Promise(r => setTimeout(r, ms));

let notes = [];

/* ---------- Zoom: 1:1 by default, never further out than the scene's height, left edge pinned ---------- */

let z = 1;
function zoom(next, cx = 0, cy = 0) {
  const sx = (view.scrollLeft + cx) / z, sy = (view.scrollTop + cy) / z;
  z = clamp(next, view.clientHeight / H, 4);
  stage.style.width = W * z + 'px';
  stage.style.height = H * z + 'px';
  scene.style.transform = `scale(${z})`;
  view.scrollLeft = sx * z - cx;
  view.scrollTop = sy * z - cy;
}
view.addEventListener('wheel', e => {
  if (!e.ctrlKey && !e.metaKey) return; // trackpad pinch arrives as ctrl+wheel
  e.preventDefault();
  zoom(z * Math.exp(-clamp(e.deltaY, -25, 25) / 100), e.clientX, e.clientY);
}, { passive: false });
addEventListener('resize', () => zoom(z));
zoom(1);

const toBoard = e => {
  const r = board.getBoundingClientRect();
  return { x: (e.clientX - r.left) / z, y: (e.clientY - r.top) / z };
};

/* ---------- Notes ---------- */

function decorate(n) {
  const el = noteEl(n);
  el.note = n;
  el.querySelector('.pin').title = 'Drag to move, click to unpin';
  for (const side of ['l', 'r']) {
    el.firstChild.insertAdjacentHTML('beforeend', `<i class="h ${side}" data-h="rotate"></i>` +
      (n.type === 'image' ? `<i class="h size ${side}" data-h="resize"></i>` : ''));
  }
  const txt = el.querySelector('.txt');
  if (txt) Object.assign(txt, { contentEditable: 'plaintext-only', spellcheck: false });
  return el;
}

const render = () => board.replaceChildren(...notes.map(decorate));

function add(n) {
  n.id ||= crypto.randomUUID(); // lets the overlay tell new and removed notes from moved ones
  notes.push(n);
  const el = decorate(n);
  board.append(el);
  keepInside(el, n);
  pinIn(el);
  return el;
}

function remove(el) {
  notes.splice(notes.indexOf(el.note), 1);
  pinOut(el);
}

// Everything a note shows, relative to its pin centre: the upright pin, plus the card (with the outer half
// of its stroke) turned around the pin tip.
function extent(el, n) {
  const size = getComputedStyle(el.firstChild), w = parseFloat(size.width), h = parseFloat(size.height); // unrounded, unrotated
  const t = n.rot * Math.PI / 180, cos = Math.cos(t), sin = Math.sin(t);
  const xs = [-23, 23], ys = [-23, 34];
  for (const [x, y] of [[-w / 2 - 4, -2], [w / 2 + 4, -2], [-w / 2 - 4, h + 6], [w / 2 + 4, h + 6]]) {
    xs.push(x * cos - (y - TIP) * sin);
    ys.push(x * sin + (y - TIP) * cos + TIP);
  }
  return { l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), b: Math.max(...ys) };
}

// Puts the note at (x, y), or as close as keeps all of it on the board, so nothing gets cut off on stream.
// Returns false when the note is bigger than the board.
function keepInside(el, n, x = n.x, y = n.y) {
  placeNote(el, n);
  const e = extent(el, n), fitsX = e.r - e.l <= BW, fitsY = e.b - e.t <= BH;
  n.x = fitsX ? clamp(x, -e.l, BW - e.r) : x;
  n.y = fitsY ? clamp(y, -e.t, BH - e.b) : y;
  placeNote(el, n);
  return fitsX && fitsY;
}

// ponytail: images are re-encoded (≤1200px WebP) so the whole board fits in every save; animated GIFs come out still.
async function readImage(f) {
  const url = URL.createObjectURL(f), img = new Image();
  img.src = url;
  await img.decode();
  const s = Math.min(1, MAX_IMG / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s);
  c.height = Math.round(img.naturalHeight * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  return c.toDataURL('image/webp', 0.92);
}

async function addImages(files, at) {
  let i = 0;
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    const src = await readImage(f).catch(() => null);
    if (!src) continue;
    const el = add({ type: 'image', x: at.x + 24 * i, y: at.y + 24 * i, rot: 0, w: 191, src });
    const img = el.querySelector('img');
    await img.decode();
    // a very tall image starts narrower so it fits the board's height (pin and stroke take 29px)
    el.note.w = clamp((BH - 29) * img.naturalWidth / img.naturalHeight, MIN_W, 191);
    keepInside(el, el.note);
    i++;
  }
  if (i) save();
}

/* ---------- Pin: drag to move, click to unpin. Bottom corners: on the stroke resizes (images), just outside rotates. ---------- */

let unpinned = null; // last unpinned note, back with Ctrl/Cmd+Z

// Corner cursors turn with the note, like Figma's. rotate.svg is drawn for the bottom-right corner and
// resize.svg for the bottom-left, both 112×112 around their centre; the other corner is a quarter turn on.
const cursorSvg = {};
for (const name of ['rotate', 'resize']) {
  fetch(`assets/icons/${name}.svg`).then(r => r.text()).then(svg => {
    const open = svg.indexOf('>') + 1; // keep the file's own <svg …> tag (its fill="none" matters), drawn at 32×32
    cursorSvg[name] = [svg.slice(0, open).replace(/width="\d+"/, 'width="32"').replace(/height="\d+"/, 'height="32"'),
      svg.slice(open, svg.lastIndexOf('</svg>'))];
  });
}
function handleCursor(h, n) {
  const role = h.dataset.h;
  if (!cursorSvg[role]) return ''; // not loaded yet: the CSS fallback shows
  const [open, shapes] = cursorSvg[role];
  const deg = n.rot + ((role === 'rotate') === h.classList.contains('l') ? 90 : 0);
  const svg = `${open}<g transform="rotate(${deg} 56 56)">${shapes}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 16 16, auto`;
}
board.addEventListener('pointerover', e => {
  if (e.target.dataset.h) e.target.style.cursor = handleCursor(e.target, e.target.closest('.note').note);
});

board.addEventListener('pointerdown', e => {
  const el = e.target.closest('.note');
  const role = e.target.classList.contains('pin') ? 'move' : e.target.dataset.h;
  if (!el || !role || e.button !== 0) return;
  e.preventDefault();

  const n = el.note, start = { ...n }, p0 = toBoard(e), handle = e.target;
  const img = el.querySelector('.card img');
  const aspect = img && img.naturalHeight / img.naturalWidth;
  // Both measured from where the pin started, so nudging the note back onto the board doesn't make them jump.
  const angleAt = p => Math.atan2(p.y - start.y - TIP, p.x - start.x) * 180 / Math.PI;
  // Width whose bottom corner (±w/2, 2 + w·aspect − TIP from the tip) best fits the pointer, in the card's unrotated frame.
  const widthAt = p => {
    const t = start.rot * Math.PI / 180, dx = p.x - start.x, dy = p.y - start.y - TIP;
    const lx = Math.abs(dx * Math.cos(t) + dy * Math.sin(t)), ly = dy * Math.cos(t) - dx * Math.sin(t);
    return (lx / 2 + aspect * (ly + TIP - 2)) / (0.25 + aspect * aspect);
  };

  document.activeElement.blur(); // finish any text being typed first (an empty note goes away)
  if (!notes.includes(n)) return;
  notes.push(notes.splice(notes.indexOf(n), 1)[0]); // bring to front
  board.append(el);
  handle.setPointerCapture(e.pointerId);
  const root = document.documentElement; // closed hand while holding a pin, the handle's own cursor otherwise
  root.style.cursor = role === 'move' ? 'grabbing' : getComputedStyle(handle).cursor; // set on pointerover
  root.classList.add('dragging');
  let moved = false;

  handle.onpointermove = ev => {
    const p = toBoard(ev);
    if (!moved && Math.hypot(p.x - p0.x, p.y - p0.y) * z < 3) return;
    moved = true;
    if (role === 'move') keepInside(el, n, start.x + p.x - p0.x, start.y + p.y - p0.y);
    // Rotating or growing near an edge nudges the note back on; a change that can't fit at all is ignored.
    if (role === 'rotate') {
      const rot = n.rot;
      n.rot = start.rot + angleAt(p) - angleAt(p0);
      if (!keepInside(el, n, start.x, start.y)) {
        n.rot = rot;
        keepInside(el, n, start.x, start.y);
      }
      root.style.cursor = handleCursor(handle, n) || root.style.cursor; // cursor turns along with the note
    }
    if (role === 'resize') { // the size asked for, or the biggest one on the way there that still fits
      let lo = n.w, hi = clamp(start.w + widthAt(p) - widthAt(p0), MIN_W, BW);
      n.w = hi;
      if (!keepInside(el, n, start.x, start.y)) {
        for (let i = 0; i < 10; i++) {
          n.w = (lo + hi) / 2;
          if (keepInside(el, n, start.x, start.y)) lo = n.w;
          else hi = n.w;
        }
        n.w = lo;
        keepInside(el, n, start.x, start.y);
      }
    }
  };
  handle.onpointerup = handle.onpointercancel = ev => {
    handle.onpointermove = handle.onpointerup = handle.onpointercancel = null;
    root.classList.remove('dragging');
    root.style.cursor = '';
    if (role === 'rotate') handle.style.cursor = handleCursor(handle, n);
    if (moved) save(); // pushed on drop, never while moving
    else if (role === 'move' && ev.type === 'pointerup') {
      unpinned = n;
      remove(el);
      save();
    }
  };
});

addEventListener('keydown', e => {
  if (e.key === 'z' && (e.metaKey || e.ctrlKey) && unpinned && connected && !e.target.closest('input, .txt')) {
    add(unpinned);
    unpinned = null;
    save();
  }
});

/* ---------- Text: Enter is a new line; goes to OBS when you click away (or Escape), never per keystroke. ---------- */

board.addEventListener('keydown', e => {
  if (e.target.matches('.txt') && e.key === 'Escape') e.target.blur();
});

board.addEventListener('input', e => { // a note growing while you type stays on the board
  const el = e.target.closest('.note');
  if (el) keepInside(el, el.note);
});

board.addEventListener('focusout', e => {
  if (!e.target.matches('.txt')) return;
  const el = e.target.closest('.note'), n = el.note, text = e.target.innerText.trim();
  if (!text) {
    remove(el);
    if (n.text) save();
  } else if (text !== n.text) {
    n.text = text;
    save();
  }
});

/* ---------- New pins: right-click menu, dropped images, pasted images or text ---------- */

let menuAt;
board.addEventListener('contextmenu', e => {
  e.preventDefault();
  menuAt = toBoard(e);
  // centred under the mouse, 14px below it (4px margin keeps the outside half of the stroke on screen)
  menu.style.left = clamp(e.clientX - 102, 4, innerWidth - 208) + 'px';
  menu.style.top = Math.min(e.clientY + 14, innerHeight - 100) + 'px';
  menu.hidden = false;
});
addEventListener('pointerdown', e => { if (!menu.contains(e.target)) menu.hidden = true; });
addEventListener('keydown', e => { if (e.key === 'Escape') menu.hidden = true; });
view.addEventListener('scroll', () => { menu.hidden = true; });

$('pinImage').onclick = () => {
  menu.hidden = true;
  file.click();
};
$('pinText').onclick = () => {
  menu.hidden = true;
  add({ type: 'text', x: menuAt.x, y: menuAt.y, rot: 0, text: '' }).querySelector('.txt').focus();
};
file.onchange = () => {
  const files = [...file.files];
  file.value = '';
  addImages(files, menuAt);
};

addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => {
  e.preventDefault(); // never let the browser open the dropped file
  if (connected && board.contains(e.target)) addImages(e.dataTransfer.files, toBoard(e));
});

let pointer = { x: BW / 2, y: BH / 3 }; // pasted pins land where the mouse last was on the board
board.addEventListener('pointermove', e => { pointer = toBoard(e); });
addEventListener('paste', e => {
  if (!connected || e.target.closest('input, .txt')) return;
  const files = [...e.clipboardData.files];
  const text = e.clipboardData.getData('text/plain').trim();
  if (files.length) addImages(files, pointer);
  else if (text) {
    add({ type: 'text', x: pointer.x, y: pointer.y, rot: 0, text });
    save();
  }
});

/* ---------- OBS WebSocket v5 ---------- */

let ws = null, connected = false, nextId = 0;
const pending = new Map();
const sha256 = async s => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))));

function open(password) {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(OBS_URL);
    sock.onmessage = async ({ data }) => {
      const { op, d } = JSON.parse(data);
      if (op === 0) { // Hello → Identify
        const auth = d.authentication, identify = { rpcVersion: 1, eventSubscriptions: 0 };
        if (auth) identify.authentication = await sha256(await sha256(password + auth.salt) + auth.challenge);
        sock.send(JSON.stringify({ op: 1, d: identify }));
      }
      if (op === 2) { // Identified
        ws = sock;
        resolve();
      }
      if (op === 7) { // RequestResponse
        const p = pending.get(d.requestId);
        pending.delete(d.requestId);
        if (d.requestStatus.result) p.resolve(d.responseData || {});
        else p.reject(new Error(d.requestStatus.comment));
      }
    };
    sock.onclose = () => { // wrong password, OBS closed, server off…
      reject(new Error('closed'));
      pending.forEach(p => p.reject(new Error('closed')));
      pending.clear();
      if (ws === sock) {
        ws = null;
        setConnected(false);
      }
    };
  });
}

function call(requestType, requestData) {
  return new Promise((resolve, reject) => {
    const requestId = String(++nextId);
    pending.set(requestId, { resolve, reject });
    ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
  });
}

// Hand the board to every browser source; the overlay listens for the 'pinboard' event.
const push = () => call('CallVendorRequest', {
  vendorName: 'obs-browser', requestType: 'emit_event',
  requestData: { event_name: 'pinboard', event_data: { notes } },
});

// One save in flight at a time (OBS may answer out of order); changes made meanwhile ride the next one.
// ponytail: sends the whole board each time; send changed notes only if boards get big enough to lag.
let saving = false, dirty = false;
async function save() {
  dirty = true;
  if (saving || !ws) return;
  saving = true;
  while (dirty && ws) {
    dirty = false;
    try {
      await call('SetPersistentData', { ...SLOT, slotValue: { notes } });
      await push();
      status.textContent = 'SAVED';
    } catch {
      dirty = true; // goes out again after reconnecting
      break;
    }
  }
  saving = false;
}

function setConnected(on) {
  connected = on;
  document.body.classList.toggle('offline', !on);
  panel.classList.toggle('connected', on);
  status.textContent = 'CONNECTED';
}

form.onsubmit = async e => {
  e.preventDefault();
  if (pass.readOnly) return;
  const code = pass.value;
  pass.readOnly = true;
  pass.value = 'Connecting...';
  try {
    await open(code);
    localStorage.setItem(PASSWORD_KEY, code);
    if (!dirty) { // OBS's board, unless a change here never made it there
      notes = (await call('GetPersistentData', SLOT)).slotValue?.notes || [];
      render();
    }
    setConnected(true);
    if (dirty) save();
    else push().catch(() => {}); // bring the overlay up to date
  } catch {
    ws?.close();
    pass.value = 'Failed';
    await sleep(1500);
  }
  pass.value = code;
  pass.readOnly = false;
};

if (location.search === '?play') { // try the board without OBS; nothing is saved
  setConnected(true);
  status.textContent = 'PLAY MODE';
} else {
  pass.value = localStorage.getItem(PASSWORD_KEY) || '';
  if (pass.value) form.requestSubmit();
}
