// Ink board: pages, S Pen strokes, PDFs, scroll/zoom, eraser, laser, undo.
import * as store from './store.js';

const DOCW = 1000, GAP = 28, A4 = 1414;
export const SIZES = [2.0, 3.2, 5.6];
export const tool = { t: 'pen', c: '#ffffff', sz: 1 };
const PAGE = { dark: { bg: '#0f0f13', ln: '#34343e' }, white: { bg: '#ffffff', ln: '#c8d6ea' }, grid: { bg: '#0f0f13', ln: '#26262f', grid: 1 }, plain: { bg: '#0f0f13' }, pdf: { bg: '#ffffff' } };

let cv, ctx, boardEl, opts;
let pages = [], tops = [], docH = 0, topic = null;
const view = { z: 1, sx: 0, sy: -GAP, W: 1, H: 1, dpr: 1 };
let live = null, laser = [], undo = [], redo = [];
const touches = new Map(); let pinch = null, penDown = false, inertia = null, lastPenUp = 0;
export let curPage = 0;
const pdfDocs = [];
let pdfReady = null;

export const canvas = () => cv;
export const pageCount = () => pages.length;
const sc = () => view.W / DOCW * view.z;

export function init(o) {
  opts = o; boardEl = o.el; cv = o.canvas; ctx = cv.getContext('2d');
  new ResizeObserver(resize).observe(boardEl);
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('pointerdown', down);
  cv.addEventListener('pointermove', move);
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', wheel, { passive: false });
}

function newPage(kind) { return { k: kind || opts.style(), h: A4, s: [] }; }
function layout() { tops = []; let y = 0; pages.forEach(p => { tops.push(y); y += p.h + GAP; }); docH = y - GAP; }
function resize() {
  const r = boardEl.getBoundingClientRect();
  view.dpr = Math.min(window.devicePixelRatio || 1, 2.5); view.W = Math.max(1, r.width); view.H = Math.max(1, r.height);
  cv.width = Math.round(view.W * view.dpr); cv.height = Math.round(view.H * view.dpr);
  clampView(); req();
}
function clampView() {
  const s = sc(), vw = view.W / s, vh = view.H / s;
  if (vw >= DOCW) view.sx = -(vw - DOCW) / 2; else view.sx = Math.min(Math.max(view.sx, 0), DOCW - vw);
  view.sy = Math.min(Math.max(view.sy, -GAP), Math.max(-GAP, docH + GAP - vh));
}

/* ---- load / save per topic ---- */
export async function load(t) {
  topic = t; undo = []; redo = []; pdfDocs.length = 0; live = null;
  const doc = await store.get('topics', t.id);
  if (doc && doc.pages && doc.pages.length) {
    pages = doc.pages.map(p => { const q = { k: p.k, h: p.h, d: p.d, n: p.n, s: p.s || [] }; q.s.forEach(build); return q; });
    view.z = 1; view.sy = doc.sy ?? -GAP;
  } else { pages = [newPage()]; view.z = 1; view.sy = -GAP; }
  layout(); resize();
  const n = doc ? (doc.pdfs || 0) : 0;
  for (let d = 0; d < n; d++) {
    const buf = await store.get('blobs', 'pdf:' + t.id + ':' + d);
    if (buf) { try { pdfDocs[d] = await openPdf(buf); } catch (e) { console.warn(e); } }
  }
  req();
  return pages.some(p => p.s.length || p.k === 'pdf');
}
let saveT = 0;
function save() {
  if (!topic) return; clearTimeout(saveT);
  saveT = setTimeout(() => { saveT = 0; saveNow().catch(e => opts.toast('Could not save notes: ' + e.message)); }, 900);
}
export async function flush() { if (saveT) { clearTimeout(saveT); saveT = 0; await saveNow(); } }
function saveNow() {
  if (!topic) return Promise.resolve();
  const strokes = pages.reduce((a, p) => a + p.s.length, 0);
  store.put('kv', 'm:' + topic.id, { pages: pages.length, strokes, updated: Date.now() }).catch(() => {});
  return store.put('topics', topic.id, { id: topic.id, pdfs: pdfDocs.length, sy: view.sy, updated: Date.now(), strokes,
    pages: pages.map(p => ({ k: p.k, h: p.h, d: p.d, n: p.n, s: p.s.map(st => ({ t: st.t, c: st.c, w: st.w, p: st.p })) })) });
}

/* ---- geometry ---- */
function wAt(st, p) { return st.t === 'hl' ? st.w : st.w * (0.45 + 1.1 * p); }
function build(st) {
  const P = st.p, n = P.length / 3, out = []; let cur = null, lx, ly;
  const add = (w, fn) => { const q = Math.round(w * 4) / 4; if (!cur || cur.w !== q) { cur = { w: q, p: new Path2D() }; out.push(cur); cur.p.moveTo(lx, ly); } fn(cur.p); };
  let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
  for (let i = 0; i < n; i++) { const x = P[i * 3], y = P[i * 3 + 1]; if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y; }
  st.bb = [a, b, c, d];
  lx = P[0]; ly = P[1];
  if (n === 1) { add(wAt(st, P[2]), p => p.lineTo(P[0] + .01, P[1])); st.g = out; return; }
  const mx = i => (P[i * 3] + P[i * 3 + 3]) / 2, my = i => (P[i * 3 + 1] + P[i * 3 + 4]) / 2;
  add(wAt(st, P[2]), p => p.lineTo(mx(0), my(0))); lx = mx(0); ly = my(0);
  for (let i = 1; i < n - 1; i++) { const ex = mx(i), ey = my(i); add(wAt(st, P[i * 3 + 2]), p => p.quadraticCurveTo(P[i * 3], P[i * 3 + 1], ex, ey)); lx = ex; ly = ey; }
  add(wAt(st, P[n * 3 - 1]), p => p.lineTo(P[n * 3 - 3], P[n * 3 - 2]));
  st.g = out;
}

/* ---- render ---- */
let raf = 0;
export function req() { if (!raf) raf = requestAnimationFrame(draw); }
function drawPageBg(p, top) {
  const d = PAGE[p.k] || PAGE.dark; ctx.fillStyle = d.bg; ctx.fillRect(0, top, DOCW, p.h);
  if (p.k === 'pdf') { if (p.img) ctx.drawImage(p.img, 0, top, DOCW, p.h); else queuePdf(p); return; }
  if (d.ln) {
    ctx.strokeStyle = d.ln; ctx.lineWidth = 1.3; ctx.beginPath(); const step = d.grid ? 40 : 46;
    for (let y = d.grid ? step : 110; y < p.h; y += step) { ctx.moveTo(0, top + y); ctx.lineTo(DOCW, top + y); }
    if (d.grid) for (let x = step; x < DOCW; x += step) { ctx.moveTo(x, top); ctx.lineTo(x, top + p.h); }
    ctx.stroke();
  }
}
function drawStroke(st) { ctx.strokeStyle = st.c; ctx.globalAlpha = st.t === 'hl' ? .38 : 1; for (const g of st.g) { ctx.lineWidth = g.w; ctx.stroke(g.p); } ctx.globalAlpha = 1; }
function draw() {
  raf = 0; const s = sc(), k = view.dpr * s;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#1d1c22'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.setTransform(k, 0, 0, k, -view.sx * k, -view.sy * k); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const y0 = view.sy, y1 = view.sy + view.H / s;
  pages.forEach((p, i) => {
    const t = tops[i]; if (t > y1 || t + p.h < y0) return;
    drawPageBg(p, t); ctx.save(); ctx.beginPath(); ctx.rect(0, t, DOCW, p.h); ctx.clip(); ctx.translate(0, t);
    for (const st of p.s) drawStroke(st);
    if (live && live.pg === i && live.st) drawStroke(live.st);
    ctx.restore();
  });
  if (laser.length) {
    const now = performance.now(); laser = laser.filter(q => now - q.t < 900);
    ctx.save(); ctx.shadowColor = '#ff3b3b'; ctx.shadowBlur = 14; ctx.lineCap = 'round';
    for (let i = 1; i < laser.length; i++) {
      const a = laser[i - 1], b = laser[i]; if (b.t - a.t > 120) continue;
      ctx.strokeStyle = `rgba(255,70,70,${1 - (now - b.t) / 900})`; ctx.lineWidth = 7 / view.z; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    const L = laser[laser.length - 1]; if (L) { ctx.fillStyle = '#ff4d4d'; ctx.beginPath(); ctx.arc(L.x, L.y, 6 / view.z, 0, 7); ctx.fill(); }
    ctx.restore(); if (laser.length) req();
  }
  const mid = view.sy + view.H / s / 2; let c = 0; for (let i = 0; i < tops.length; i++) if (tops[i] <= mid) c = i;
  curPage = c; opts.page(c + 1, pages.length);
}

/* ---- PDF ---- */
async function pdfLib() {
  if (!pdfReady) pdfReady = new Promise((ok, no) => {
    if (window.pdfjsLib) return ok(window.pdfjsLib);
    const s = document.createElement('script'); s.src = 'vendor/pdf.min.js';
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js'; ok(window.pdfjsLib); };
    s.onerror = () => no(new Error('pdf.js missing')); document.head.appendChild(s);
  });
  return pdfReady;
}
async function openPdf(buf) { const lib = await pdfLib(); return lib.getDocument({ data: new Uint8Array(buf.slice(0)), isEvalSupported: false }).promise; }
const busy = new Set(), lru = [];
function queuePdf(p) {
  if (busy.has(p) || !pdfDocs[p.d]) return; busy.add(p);
  (async () => {
    try {
      const pg = await pdfDocs[p.d].getPage(p.n); const v1 = pg.getViewport({ scale: 1 });
      const W = Math.min(2400, Math.max(1200, view.W * view.dpr * Math.min(view.z, 1.8)));
      const vp = pg.getViewport({ scale: W / v1.width }); const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise; p.img = c; lru.push(p);
      while (lru.length > 10) { const o = lru.shift(); if (o !== p) o.img = null; }
    } catch (e) { console.warn(e); } finally { busy.delete(p); req(); }
  })();
}
export async function importPdf(file) {
  opts.toast('Opening ' + file.name + '…');
  try {
    const buf = await file.arrayBuffer(); const doc = await openPdf(buf); const d = pdfDocs.length; pdfDocs.push(doc);
    await store.put('blobs', 'pdf:' + topic.id + ':' + d, buf);
    const fresh = pages.length === 1 && pages[0].s.length === 0 && pages[0].k !== 'pdf';
    const add = [];
    for (let n = 1; n <= doc.numPages; n++) { const pg = await doc.getPage(n); const v = pg.getViewport({ scale: 1 }); add.push({ k: 'pdf', d, n, h: Math.round(DOCW * v.height / v.width), s: [] }); }
    let at; if (fresh) { pages = add; at = 0; } else { at = curPage + 1; pages.splice(at, 0, ...add); }
    layout(); view.sy = tops[at] - GAP; view.z = 1; clampView(); req(); save(); opts.hint(false);
    opts.toast(doc.numPages + ' pages added');
  } catch (e) { console.warn(e); opts.toast('Could not open this PDF.'); }
}

/* ---- input ---- */
function toDoc(e) { const r = cv.getBoundingClientRect(), s = sc(); return [(e.clientX - r.left) / s + view.sx, (e.clientY - r.top) / s + view.sy]; }
function pageAt(y) { for (let i = pages.length - 1; i >= 0; i--) if (y >= tops[i]) return y <= tops[i] + pages[i].h ? i : -1; return -1; }
const drawsWith = e => e.pointerType === 'pen' || e.pointerType === 'mouse' || (e.pointerType === 'touch' && opts.finger());
function modeFor(e) {
  if (e.pointerType === 'pen' && ((e.buttons & 32) || (e.buttons & 2))) return 'erase';
  if (e.pointerType === 'mouse' && e.button === 2) return 'erase';
  return tool.t;
}
const hlColor = () => (tool.c === '#ffffff' || tool.c === '#111111') ? '#F2B53A' : tool.c;
function down(e) {
  stopInertia(); opts.closePop && opts.closePop();
  if (drawsWith(e) && !(e.pointerType === 'touch' && pinch)) {
    if (e.pointerType === 'touch' && penDown) return;
    cv.setPointerCapture(e.pointerId); penDown = true; touches.clear(); pinch = null;
    const m = modeFor(e), [x, y] = toDoc(e);
    if (m === 'laser') { live = { mode: 'laser', id: e.pointerId }; laser.push({ x, y, t: performance.now() }); req(); return; }
    if (m === 'erase') { live = { mode: 'erase', id: e.pointerId, hits: [] }; eraseAt(x, y); return; }
    const pg = pageAt(y); if (pg < 0) return;
    const st = { t: m === 'hl' ? 'hl' : 'pen', c: m === 'hl' ? hlColor() : tool.c, w: m === 'hl' ? SIZES[tool.sz] * 4.2 : SIZES[tool.sz], p: [] };
    const pr = e.pointerType === 'pen' ? (e.pressure || .5) : .5;
    live = { mode: 'draw', id: e.pointerId, pg, st, pp: pr };
    st.p.push(+x.toFixed(2), +(y - tops[pg]).toFixed(2), +pr.toFixed(3)); build(st); opts.hint(false); req(); return;
  }
  if (e.pointerType === 'touch') {
    if (penDown || performance.now() - lastPenUp < 250) return;
    if ((e.width || 0) > 45 && (e.height || 0) > 45) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), vx: 0, vy: 0 });
    if (touches.size === 2) {
      const [a, b] = [...touches.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y) || 1; const r = cv.getBoundingClientRect();
      pinch = { d0: d, z0: view.z, dx: ((a.x + b.x) / 2 - r.left) / sc() + view.sx, dy: ((a.y + b.y) / 2 - r.top) / sc() + view.sy };
    }
  }
}
function move(e) {
  if (live && e.pointerId === live.id) {
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ev of (evs.length ? evs : [e])) {
      const [x, y] = toDoc(ev);
      if (live.mode === 'laser') { laser.push({ x, y, t: performance.now() }); continue; }
      if (live.mode === 'erase') { eraseAt(x, y); continue; }
      const P = live.st.p, ly = y - tops[live.pg], n = P.length, dx = x - P[n - 3], dy = ly - P[n - 2];
      if (dx * dx + dy * dy < (0.35 / view.z) ** 2) continue;
      let pr = ev.pointerType === 'pen' ? (ev.pressure || live.pp) : .5; pr = live.pp * .55 + pr * .45; live.pp = pr;
      P.push(+x.toFixed(2), +ly.toFixed(2), +pr.toFixed(3));
    }
    if (live.mode === 'draw') build(live.st); req(); return;
  }
  const t = touches.get(e.pointerId); if (!t) return;
  const now = performance.now(), dxs = e.clientX - t.x, dys = e.clientY - t.y, dt = Math.max(1, now - t.t);
  t.vx = t.vx * .6 + (dxs / dt) * .4; t.vy = t.vy * .6 + (dys / dt) * .4; t.x = e.clientX; t.y = e.clientY; t.t = now;
  if (touches.size === 1 && !pinch) { view.sx -= dxs / sc(); view.sy -= dys / sc(); clampView(); req(); }
  else if (touches.size >= 2 && pinch) {
    const [a, b] = [...touches.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y) || 1; const r = cv.getBoundingClientRect();
    view.z = Math.min(4, Math.max(.5, pinch.z0 * d / pinch.d0)); const s = sc();
    view.sx = pinch.dx - ((a.x + b.x) / 2 - r.left) / s; view.sy = pinch.dy - ((a.y + b.y) / 2 - r.top) / s; clampView(); req();
  }
}
function up(e) {
  if (live && e.pointerId === live.id) {
    if (live.mode === 'draw' && live.st.p.length) { pages[live.pg].s.push(live.st); undo.push({ t: 'add', pg: live.pg, st: live.st }); redo = []; save(); }
    if (live.mode === 'erase' && live.hits.length) { undo.push({ t: 'erase', items: live.hits }); redo = []; save(); }
    live = null; penDown = false; lastPenUp = performance.now(); req(); return;
  }
  const t = touches.get(e.pointerId); if (!t) return; touches.delete(e.pointerId);
  if (pinch && touches.size < 2) { pinch = null; if (touches.size === 1) { const o = [...touches.values()][0]; o.vx = o.vy = 0; } refreshPdfRes(); return; }
  if (touches.size === 0 && e.type === 'pointerup' && performance.now() - t.t < 80) startInertia(t.vx, t.vy);
  save();
}
function wheel(e) {
  e.preventDefault();
  if (e.ctrlKey) {
    const r = cv.getBoundingClientRect(), s0 = sc(), dx = (e.clientX - r.left) / s0 + view.sx, dy = (e.clientY - r.top) / s0 + view.sy;
    view.z = Math.min(4, Math.max(.5, view.z * Math.exp(-e.deltaY / 300))); const s = sc(); view.sx = dx - (e.clientX - r.left) / s; view.sy = dy - (e.clientY - r.top) / s;
  } else { view.sx += e.deltaX / sc(); view.sy += e.deltaY / sc(); }
  clampView(); req();
}
function startInertia(vx, vy) {
  let last = performance.now();
  const step = now => { const dt = now - last; last = now; vx *= Math.pow(.94, dt / 16); vy *= Math.pow(.94, dt / 16);
    view.sx -= vx * dt / sc(); view.sy -= vy * dt / sc(); clampView(); req();
    inertia = Math.hypot(vx, vy) > .02 ? requestAnimationFrame(step) : null; };
  inertia = requestAnimationFrame(step);
}
function stopInertia() { if (inertia) { cancelAnimationFrame(inertia); inertia = null; } }
let resT = 0;
function refreshPdfRes() { clearTimeout(resT); resT = setTimeout(() => { if (view.z > 1.3) pages.forEach(p => { if (p.k === 'pdf' && p.img && p.img.width < view.W * view.dpr * view.z * .9) p.img = null; }); req(); }, 400); }
function eraseAt(x, y) {
  const pg = pageAt(y); if (pg < 0) return; const ly = y - tops[pg], r = 10 / view.z, S = pages[pg].s; let hit = false;
  for (let i = S.length - 1; i >= 0; i--) {
    const st = S[i], b = st.bb, pad = r + st.w * 1.2;
    if (x < b[0] - pad || x > b[2] + pad || ly < b[1] - pad || ly > b[3] + pad) continue;
    const P = st.p, n = P.length / 3; let near = false;
    for (let j = 0; j < n && !near; j++) {
      const ax = P[j * 3], ay = P[j * 3 + 1], bx = j + 1 < n ? P[j * 3 + 3] : ax, by = j + 1 < n ? P[j * 3 + 4] : ay;
      const vx = bx - ax, vy = by - ay, l = vx * vx + vy * vy; let t = l ? ((x - ax) * vx + (ly - ay) * vy) / l : 0; t = Math.max(0, Math.min(1, t));
      if (Math.hypot(ax + t * vx - x, ay + t * vy - ly) < pad) near = true;
    }
    if (near) { S.splice(i, 1); live.hits.push({ pg, st, i }); hit = true; }
  }
  if (hit) req();
}

/* ---- actions ---- */
export function doUndo() {
  const a = undo.pop(); if (!a) return;
  if (a.t === 'add') { const S = pages[a.pg].s; const i = S.lastIndexOf(a.st); if (i >= 0) S.splice(i, 1); }
  else if (a.t === 'erase') { for (let k = a.items.length - 1; k >= 0; k--) { const h = a.items[k]; pages[h.pg].s.splice(Math.min(h.i, pages[h.pg].s.length), 0, h.st); } }
  else if (a.t === 'clear') pages[a.pg].s = a.old;
  redo.push(a); req(); save();
}
export function doRedo() {
  const a = redo.pop(); if (!a) return;
  if (a.t === 'add') pages[a.pg].s.push(a.st);
  else if (a.t === 'erase') { for (const h of a.items) { const S = pages[h.pg].s; const i = S.indexOf(h.st); if (i >= 0) S.splice(i, 1); } }
  else if (a.t === 'clear') pages[a.pg].s = [];
  undo.push(a); req(); save();
}
export function addPage(kind) { const at = curPage + 1; pages.splice(at, 0, newPage(kind)); layout(); view.sy = tops[at] - GAP; clampView(); req(); save(); }
export function clearPage() { const p = pages[curPage]; if (!p.s.length) return false; undo.push({ t: 'clear', pg: curPage, old: p.s }); p.s = []; redo = []; req(); save(); return true; }
export function fit() { view.z = 1; clampView(); req(); }
export function goPage(i) { if (!pages[i]) return; view.sy = tops[i] - GAP; clampView(); req(); }
