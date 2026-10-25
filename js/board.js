// Ink board: pages, S Pen strokes, shapes, lasso select/move/resize, PDFs, scroll/zoom, eraser, laser, undo.
import * as store from './store.js';

const DOCW = 1000, GAP = 28, A4 = 1414;
export const SIZES = [2.0, 3.2, 5.6];
export const tool = { t: 'pen', c: '#ffffff', sz: 1, shape: 'line', auto: false, er: 'stroke', erSz: 1 };
export const ER_SIZES = [8, 18, 36];
export const PAGE_COLORS = [
  ['#0f0f13', 'Board black'], ['#0b0726', 'CSwithSR navy'], ['#101a3a', 'Deep blue'], ['#12301f', 'Chalk green'],
  ['#22252c', 'Slate'], ['#ffffff', 'White'], ['#f5f1ea', 'Cream'], ['#e8f4ff', 'Sky']
];
export const PATTERNS = [['lined', 'Lined'], ['grid', 'Grid'], ['dots', 'Dots'], ['plain', 'Plain']];
const LEGACY = { dark: ['#0f0f13', 'lined'], white: ['#ffffff', 'lined'], grid: ['#0f0f13', 'grid'], plain: ['#0f0f13', 'plain'] };

let cv, ctx, boardEl, opts;
let pages = [], tops = [], docH = 0, topic = null;
const view = { z: 1, sx: 0, sy: -GAP, W: 1, H: 1, dpr: 1 };
let live = null, laser = [], undo = [], redo = [], sel = null;
let touched = new Set();
const touches = new Map(); let pinch = null, penDown = false, inertia = null, lastPenUp = 0, pull = 0, atEnd = false; const PULL = 150;
export let curPage = 0;
const pdfDocs = [];
let pdfReady = null;

export const canvas = () => cv;
export const pageCount = () => pages.length;
const sc = () => view.W / DOCW * view.z;
export const currentPage = () => pages[curPage];

export function init(o) {
  opts = o; boardEl = o.el; cv = o.canvas; ctx = cv.getContext('2d');
  new ResizeObserver(resize).observe(boardEl);
  // Samsung tablets report the S Pen side button in different ways: as a right/eraser button on pointer events,
  // as a context-menu event, or as a key press. Any of them switches the pen to the eraser while the button is held.
  cv.addEventListener('contextmenu', e => { e.preventDefault(); if (performance.now() - lastPenSeen < 1500 || e.pointerType === 'pen') { btnFlag = true; btnFrom = 'menu'; convertToErase(); } });
  addEventListener('keydown', e => { if (isPenKey(e)) { e.preventDefault(); btnFlag = true; btnFrom = 'key'; convertToErase(); } }, true);
  addEventListener('keyup', e => { if (isPenKey(e) && btnFrom === 'key') { btnFlag = false; endHoverErase(); } }, true);
  cv.addEventListener('pointerdown', down);
  cv.addEventListener('pointermove', move);
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', wheel, { passive: false });
  cv.addEventListener('pointerleave', e => { if (e.pointerType === 'pen' && btnFrom === 'menu') { btnFlag = false; btnFrom = ''; } if (live && live.hover && e.pointerId === live.id) { finishErase(live); live = null; req(); } });
}

const pid = () => Math.random().toString(36).slice(2, 10);
const dayStr = () => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
function newPage(style) {
  const base = style || (() => { for (let i = curPage; i >= 0; i--) if (pages[i] && pages[i].k !== 'pdf') return { bg: pages[i].bg, pat: pages[i].pat }; return opts.style(); })();
  return { id: pid(), k: 'note', bg: base.bg, pat: base.pat, h: A4, s: [], im: [] };
}
function normPage(p) {
  const q = { id: p.id || pid(), k: p.k, bg: p.bg, pat: p.pat, h: p.h, d: p.d, n: p.n, s: p.s || [], im: (p.im || []).map(o => ({ ...o })) };
  if (LEGACY[q.k]) { q.bg = LEGACY[q.k][0]; q.pat = LEGACY[q.k][1]; q.k = 'note'; }
  if (q.k !== 'pdf') { q.k = 'note'; q.bg = q.bg || '#0f0f13'; q.pat = q.pat || 'lined'; }
  return q;
}
function layout() { tops = []; let y = 0; pages.forEach(p => { tops.push(y); y += p.h + GAP; }); docH = y - GAP; }
function resize() {
  const r = boardEl.getBoundingClientRect();
  view.dpr = Math.min(window.devicePixelRatio || 1, 2.5); view.W = Math.max(1, r.width); view.H = Math.max(1, r.height);
  cv.width = Math.round(view.W * view.dpr); cv.height = Math.round(view.H * view.dpr);
  clampView(); req();
}
const maxSy = () => Math.max(-GAP, docH + GAP - view.H / sc());
function clampView() {
  const s = sc(), vw = view.W / s;
  if (vw >= DOCW) view.sx = -(vw - DOCW) / 2; else view.sx = Math.min(Math.max(view.sx, 0), DOCW - vw);
  view.sy = Math.min(Math.max(view.sy, -GAP), maxSy());
}

/* ---- load / save per topic ---- */
export async function load(t) {
  topic = t; undo = []; redo = []; pdfDocs.length = 0; live = null; touched = new Set(); setSel(null);
  const doc = await store.get('topics', t.id);
  if (doc && doc.pages && doc.pages.length) {
    pages = doc.pages.map(normPage); pages.forEach(p => p.s.forEach(build));
    view.z = 1; view.sy = doc.sy ?? -GAP;
    if (doc.today && doc.today.day === dayStr()) touched = new Set(doc.today.ids);
  } else { pages = [newPage(opts.style())]; view.z = 1; view.sy = -GAP; }
  layout(); resize();
  const used = new Set(pages.filter(p => p.k === 'pdf').map(p => p.d));
  const n = doc ? (doc.pdfs || 0) : 0;
  for (let d = 0; d < n; d++) {
    const key = 'pdf:' + t.id + ':' + d;
    if (!used.has(d)) { store.del('blobs', key).catch(() => {}); pdfDocs[d] = null; continue; }
    const buf = await store.get('blobs', key);
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
  return store.put('topics', topic.id, { id: topic.id, pdfs: pdfDocs.length, sy: view.sy, updated: Date.now(), strokes, today: { day: dayStr(), ids: [...touched] },
    pages: pages.map(p => ({ id: p.id, k: p.k, bg: p.bg, pat: p.pat, h: p.h, d: p.d, n: p.n, s: p.s.map(st => ({ t: st.t, c: st.c, w: st.w, p: st.p, sh: st.sh || 0, gid: st.gid })), im: (p.im || []).map(o => ({ id: o.id, key: o.key, x: o.x, y: o.y, w: o.w, h: o.h })) })) });
}

/* ---- geometry ---- */
function wAt(st, p) { return st.t === 'hl' || st.sh ? st.w : st.w * (0.45 + 1.1 * p); }
function bbox(st) {
  const P = st.p; let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
  for (let i = 0; i < P.length; i += 3) { const x = P[i], y = P[i + 1]; if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y; }
  st.bb = [a, b, c, d];
}
function build(st) {
  const P = st.p, n = P.length / 3, out = []; let cur = null, lx, ly;
  bbox(st);
  if (st.sh) { const p = new Path2D(); p.moveTo(P[0], P[1]); for (let i = 1; i < n; i++) p.lineTo(P[i * 3], P[i * 3 + 1]); if (n === 1) p.lineTo(P[0] + .01, P[1]); st.g = [{ w: st.w, p }]; return; }
  const add = (w, fn) => { const q = Math.round(w * 4) / 4; if (!cur || cur.w !== q) { cur = { w: q, p: new Path2D() }; out.push(cur); cur.p.moveTo(lx, ly); } fn(cur.p); };
  lx = P[0]; ly = P[1];
  if (n === 1) { add(wAt(st, P[2]), p => p.lineTo(P[0] + .01, P[1])); st.g = out; return; }
  const mx = i => (P[i * 3] + P[i * 3 + 3]) / 2, my = i => (P[i * 3 + 1] + P[i * 3 + 4]) / 2;
  add(wAt(st, P[2]), p => p.lineTo(mx(0), my(0))); lx = mx(0); ly = my(0);
  for (let i = 1; i < n - 1; i++) { const ex = mx(i), ey = my(i); add(wAt(st, P[i * 3 + 2]), p => p.quadraticCurveTo(P[i * 3], P[i * 3 + 1], ex, ey)); lx = ex; ly = ey; }
  add(wAt(st, P[n * 3 - 1]), p => p.lineTo(P[n * 3 - 3], P[n * 3 - 2]));
  st.g = out;
}

/* ---- shapes ---- */
const flat = pts => { const o = []; for (const [x, y] of pts) o.push(+x.toFixed(2), +y.toFixed(2), .5); return o; };
function ellipsePts(cx, cy, rx, ry) { const o = []; for (let i = 0; i <= 72; i++) { const a = i / 72 * Math.PI * 2; o.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); } return o; }
export function shapePts(kind, x0, y0, x1, y1) {
  if (kind === 'line') return [[x0, y0], [x1, y1]];
  if (kind === 'arrow') {
    const L = Math.hypot(x1 - x0, y1 - y0) || 1, a = Math.atan2(y1 - y0, x1 - x0), h = Math.min(40, Math.max(14, L * .22));
    return [[x0, y0], [x1, y1], [x1 - h * Math.cos(a - .45), y1 - h * Math.sin(a - .45)], [x1, y1], [x1 - h * Math.cos(a + .45), y1 - h * Math.sin(a + .45)]];
  }
  if (kind === 'rect') return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
  if (kind === 'tri') return [[(x0 + x1) / 2, y0], [x1, y1], [x0, y1], [(x0 + x1) / 2, y0]];
  return ellipsePts((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2);
}
const quad = (a, c, b, n = 18) => { const o = []; for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; o.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]); } return o; };
const circ = (cx, cy, r) => { const o = []; for (let i = 0; i <= 28; i++) { const a = i / 28 * Math.PI * 2; o.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return o; };
// Logic gates drawn inside the box you drag (inputs on the left, output on the right)
function gateParts(kind, x0, y0, x1, y1) {
  const L = Math.min(x0, x1), T = Math.min(y0, y1), w = Math.abs(x1 - x0) || 1, h = Math.abs(y1 - y0) || 1;
  const X = f => L + f * w, Y = f => T + f * h, r = Math.max(3, Math.min(w, h) * .07), parts = [];
  const bubble = tx => { parts.push(circ(X(tx) + r, Y(.5), r)); parts.push([[X(tx) + 2 * r, Y(.5)], [X(1), Y(.5)]]); };
  if (kind === 'not') {
    parts.push([[X(.22), Y(.1)], [X(.22), Y(.9)], [X(.75), Y(.5)], [X(.22), Y(.1)]]); parts.push([[X(0), Y(.5)], [X(.22), Y(.5)]]); bubble(.75); return parts;
  }
  if (kind === 'and' || kind === 'nand') {
    const body = [[X(.5), Y(0)], [X(.2), Y(0)], [X(.2), Y(1)], [X(.5), Y(1)]];
    for (let i = 0; i <= 24; i++) { const a = Math.PI / 2 - i / 24 * Math.PI; body.push([X(.5) + .32 * w * Math.cos(a), Y(.5) + .5 * h * Math.sin(a)]); }
    parts.push(body); parts.push([[X(0), Y(.28)], [X(.2), Y(.28)]], [[X(0), Y(.72)], [X(.2), Y(.72)]]);
    if (kind === 'nand') bubble(.82); else parts.push([[X(.82), Y(.5)], [X(1), Y(.5)]]);
    return parts;
  }
  // or, nor, xor
  const top = quad([X(.15), Y(0)], [X(.6), Y(0)], [X(.85), Y(.5)]), bot = quad([X(.15), Y(1)], [X(.6), Y(1)], [X(.85), Y(.5)]), back = quad([X(.15), Y(1)], [X(.32), Y(.5)], [X(.15), Y(0)]);
  parts.push([...top, ...bot.reverse(), ...back]);
  const inX = kind === 'xor' ? .14 : .22; parts.push([[X(0), Y(.28)], [X(inX), Y(.28)]], [[X(0), Y(.72)], [X(inX), Y(.72)]]);
  if (kind === 'xor') parts.push(quad([X(.07), Y(0)], [X(.24), Y(.5)], [X(.07), Y(1)]));
  if (kind === 'nor') bubble(.85); else parts.push([[X(.85), Y(.5)], [X(1), Y(.5)]]);
  return parts;
}
export function shapeParts(kind, x0, y0, x1, y1) { return ['and', 'nand', 'or', 'nor', 'xor', 'not'].includes(kind) ? gateParts(kind, x0, y0, x1, y1) : [shapePts(kind, x0, y0, x1, y1)]; }
function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const [a, b] = [pts[0], pts[pts.length - 1]]; let dmax = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i], vx = b[0] - a[0], vy = b[1] - a[1], L = Math.hypot(vx, vy) || 1e-9;
    const d = L < 1e-6 ? Math.hypot(p[0] - a[0], p[1] - a[1]) : Math.abs(vy * p[0] - vx * p[1] + b[0] * a[1] - b[1] * a[0]) / L;
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax > eps) return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
  return [a, b];
}
// Turns a hand-drawn stroke into a clean line, triangle, rectangle or ellipse when it is close enough to one.
function recognise(st) {
  const P = st.p, n = P.length / 3; if (n < 5) return false;
  const pts = []; for (let i = 0; i < n; i++) pts.push([P[i * 3], P[i * 3 + 1]]);
  let len = 0; for (let i = 1; i < n; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const [a, b, c, d] = st.bb, diag = Math.hypot(c - a, d - b); if (len < 20) return false;
  const first = pts[0], last = pts[n - 1], chord = Math.hypot(last[0] - first[0], last[1] - first[1]);
  let out = null;
  if (chord / len > .92) {
    let [x0, y0] = first, [x1, y1] = last; const ang = Math.atan2(y1 - y0, x1 - x0) * 180 / Math.PI;
    if (Math.abs(((ang + 180) % 90 + 90) % 90 - 45) > 39) { if (Math.abs(Math.sin(ang * Math.PI / 180)) < .2) y1 = y0; else x1 = x0; }
    out = [[x0, y0], [x1, y1]];
  } else if (chord < .25 * diag && diag > 30) {
    const cx = pts.reduce((s, p) => s + p[0], 0) / n, cy = pts.reduce((s, p) => s + p[1], 0) / n;
    const rx = (c - a) / 2 || 1, ry = (d - b) / 2 || 1;
    const er = pts.map(p => Math.hypot((p[0] - cx) / rx, (p[1] - cy) / ry)); const m = er.reduce((s, v) => s + v, 0) / n;
    const cvv = Math.sqrt(er.reduce((s, v) => s + (v - m) ** 2, 0) / n) / m;
    const closed = [...pts, first]; let poly = rdp(closed, .08 * diag);
    if (poly.length > 2 && Math.hypot(poly[0][0] - poly[poly.length - 1][0], poly[0][1] - poly[poly.length - 1][1]) < .2 * diag) poly = poly.slice(0, -1);
    const k = poly.length;
    if (cvv < .1 && k >= 4) out = ellipsePts((a + c) / 2, (b + d) / 2, rx, ry);
    else if (k === 3) out = [...poly, poly[0]];
    else if (k === 4) {
      const axis = poly.every((p, i) => { const q = poly[(i + 1) % 4], an = Math.abs(Math.atan2(q[1] - p[1], q[0] - p[0]) * 180 / Math.PI) % 90; return an < 15 || an > 75; });
      out = axis ? [[a, b], [c, b], [c, d], [a, d], [a, b]] : [...poly, poly[0]];
    } else if (cvv < .2) out = ellipsePts((a + c) / 2, (b + d) / 2, rx, ry);
  }
  if (!out) return false;
  st.p = flat(out); st.sh = 1; build(st); return true;
}

/* ---- render ---- */
let raf = 0;
export function req() { if (!raf) raf = requestAnimationFrame(draw); }
function lum(hex) { const v = parseInt(hex.slice(1), 16); return ((v >> 16 & 255) * .299 + (v >> 8 & 255) * .587 + (v & 255) * .114) / 255; }
function drawPageBg(p, top, c = ctx, live = true) {
  if (p.k === 'pdf') { c.fillStyle = '#fff'; c.fillRect(0, top, DOCW, p.h); if (p.img) c.drawImage(p.img, 0, top, DOCW, p.h); else if (live) queuePdf(p); return; }
  c.fillStyle = p.bg; c.fillRect(0, top, DOCW, p.h);
  const light = lum(p.bg) > .55; const ln = light ? 'rgba(70,100,150,.28)' : 'rgba(255,255,255,.14)';
  if (p.pat === 'lined' || p.pat === 'grid') {
    c.strokeStyle = ln; c.lineWidth = p.pat === 'grid' ? 1 : 1.3; c.beginPath(); const step = p.pat === 'grid' ? 40 : 46;
    for (let y = p.pat === 'grid' ? step : 110; y < p.h; y += step) { c.moveTo(0, top + y); c.lineTo(DOCW, top + y); }
    if (p.pat === 'grid') for (let x = step; x < DOCW; x += step) { c.moveTo(x, top); c.lineTo(x, top + p.h); }
    c.stroke();
  } else if (p.pat === 'dots') {
    c.fillStyle = light ? 'rgba(70,100,150,.4)' : 'rgba(255,255,255,.22)';
    for (let y = 40; y < p.h; y += 40) for (let x = 40; x < DOCW; x += 40) c.fillRect(x - 1.2, top + y - 1.2, 2.4, 2.4);
  }
}
const imgCache = new Map();
function loadImg(key) {
  if (imgCache.has(key)) return imgCache.get(key);
  const p = store.get('blobs', 'img:' + key).then(blob => new Promise(ok => { if (!blob) return ok(null); const im = new Image(); im.onload = () => { p.img = im; ok(im); req(); }; im.onerror = () => ok(null); im.src = URL.createObjectURL(blob); }));
  imgCache.set(key, p); return p;
}
function drawImages(p, c) {
  for (const o of p.im || []) { const pr = loadImg(o.key); if (pr.img) c.drawImage(pr.img, o.x, o.y, o.w, o.h); else { c.fillStyle = 'rgba(255,255,255,.06)'; c.fillRect(o.x, o.y, o.w, o.h); } }
}
function drawStroke(st, c = ctx) { c.strokeStyle = st.c; c.globalAlpha = st.t === 'hl' ? .38 : 1; for (const g of st.g) { c.lineWidth = g.w; c.stroke(g.p); } c.globalAlpha = 1; }
function selBox() { const s = sel, pad = 10; return [s.bb[0] - pad, s.bb[1] - pad + tops[pages.indexOf(s.page)], s.bb[2] + pad, s.bb[3] + pad + tops[pages.indexOf(s.page)]]; }
function draw() {
  raf = 0; const s = sc(), k = view.dpr * s;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#1d1c22'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.setTransform(k, 0, 0, k, -view.sx * k, -view.sy * k); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const y0 = view.sy, y1 = view.sy + view.H / s;
  pages.forEach((p, i) => {
    const t = tops[i]; if (t > y1 || t + p.h < y0) return;
    drawPageBg(p, t); ctx.save(); ctx.beginPath(); ctx.rect(0, t, DOCW, p.h); ctx.clip(); ctx.translate(0, t);
    drawImages(p, ctx);
    for (const st of p.s) drawStroke(st);
    if (live && live.page === p && live.st) drawStroke(live.st);
    if (live && live.page === p && live.sts) live.sts.forEach(s => drawStroke(s));
    ctx.restore();
  });
  if (live && live.mode === 'lasso' && live.path.length > 1) {
    ctx.save(); ctx.setLineDash([8 / s, 6 / s]); ctx.strokeStyle = '#5CE1FF'; ctx.lineWidth = 1.6 / s; ctx.beginPath();
    live.path.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); ctx.restore();
  }
  if (live && live.mode === 'erase' && live.cx != null && tool.er === 'area') { ctx.save(); ctx.strokeStyle = 'rgba(92,225,255,.8)'; ctx.lineWidth = 1.5 / s; ctx.beginPath(); ctx.arc(live.cx, live.cy, ER_SIZES[tool.erSz] / Math.sqrt(view.z), 0, 7); ctx.stroke(); ctx.restore(); }
  if (sel && pages.includes(sel.page)) {
    const [a, b, c, d] = selBox(); ctx.save(); ctx.setLineDash([8 / s, 6 / s]); ctx.strokeStyle = '#5CE1FF'; ctx.lineWidth = 1.6 / s; ctx.strokeRect(a, b, c - a, d - b); ctx.setLineDash([]);
    const h = 9 / s; ctx.fillStyle = '#F2B53A'; ctx.strokeStyle = '#07021f';
    for (const [x, y] of [[a, b], [c, b], [a, d], [c, d]]) { ctx.beginPath(); ctx.arc(x, y, h, 0, 7); ctx.fill(); ctx.stroke(); }
    ctx.restore();
  }
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
  if (sel) reportSel();
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
    for (let n = 1; n <= doc.numPages; n++) { const pg = await doc.getPage(n); const v = pg.getViewport({ scale: 1 }); add.push({ id: pid(), im: [], k: 'pdf', d, n, h: Math.round(DOCW * v.height / v.width), s: [] }); }
    let at; if (fresh) { pages = add; at = 0; } else { at = curPage + 1; pages.splice(at, 0, ...add); }
    layout(); view.sy = tops[at] - GAP; view.z = 1; clampView(); req(); save(); opts.hint(false);
    opts.toast(doc.numPages + ' pages added'); return d;
  } catch (e) { console.warn(e); opts.toast('Could not open this PDF.'); return -1; }
}

/* ---- selection ---- */
function setSel(s) { sel = s; reportSel(); req(); }
function reportSel() {
  if (!opts) return;
  if (!sel || !pages.includes(sel.page)) { sel = null; opts.selection && opts.selection(null); return; }
  const [a, b, c, d] = selBox(), r = cv.getBoundingClientRect(), s = sc();
  opts.selection && opts.selection({ left: r.left + (a - view.sx) * s, top: r.top + (b - view.sy) * s, right: r.left + (c - view.sx) * s, bottom: r.top + (d - view.sy) * s, count: sel.items.length + (sel.imgs || []).length });
}
function selBB() { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const st of sel.items) { a = Math.min(a, st.bb[0] - st.w / 2); b = Math.min(b, st.bb[1] - st.w / 2); c = Math.max(c, st.bb[2] + st.w / 2); d = Math.max(d, st.bb[3] + st.w / 2); }
  for (const o of sel.imgs || []) { a = Math.min(a, o.x); b = Math.min(b, o.y); c = Math.max(c, o.x + o.w); d = Math.max(d, o.y + o.h); } sel.bb = [a, b, c, d]; }
function inPoly(x, y, poly) { let ins = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi) ins = !ins; } return ins; }
function finishLasso(path, page) {
  const top = tops[pages.indexOf(page)], poly = path.map(([x, y]) => [x, y - top]); const items = [];
  if (poly.length > 2) for (const st of page.s) { const P = st.p, n = P.length / 3; let inside = 0; for (let i = 0; i < n; i++) if (inPoly(P[i * 3], P[i * 3 + 1], poly)) inside++; if (inside / n >= .6) items.push(st); }
  const imgs = poly.length > 2 ? (page.im || []).filter(o => inPoly(o.x + o.w / 2, o.y + o.h / 2, poly)) : [];
  if (!items.length && !imgs.length) { setSel(null); return; }
  sel = { page, items, imgs }; selBB(); setSel(sel);
}
function hitSel(x, y) {
  if (!sel || !pages.includes(sel.page)) return null; const [a, b, c, d] = selBox(), h = 22 / sc();
  const corners = [[a, b, c, d], [c, b, a, d], [a, d, c, b], [c, d, a, b]];
  for (const [cx, cy, ox, oy] of corners) if (Math.hypot(x - cx, y - cy) < h) return { kind: 'scale', ox, oy: oy - tops[pages.indexOf(sel.page)], cx, cy: cy - tops[pages.indexOf(sel.page)] };
  if (x >= a && x <= c && y >= b && y <= d) return { kind: 'move' };
  return null;
}
function snapUndo(page, fn) { const s0 = page.s.slice(), i0 = (page.im || []).slice(); fn(); undo.push({ t: 'snap', page, s0, i0, s1: page.s.slice(), i1: (page.im || []).slice() }); redo = []; touched.add(page.id); save(); }
export function selDelete() { if (!sel) return; const S = sel; snapUndo(S.page, () => { S.page.s = S.page.s.filter(st => !S.items.includes(st)); S.page.im = (S.page.im || []).filter(o => !(S.imgs || []).includes(o)); }); setSel(null); }
export function selDuplicate() {
  if (!sel) return; const page = sel.page; let copies, ic;
  snapUndo(page, () => {
    copies = sel.items.map(st => { const n = { t: st.t, c: st.c, w: st.w, sh: st.sh, p: st.p.map((v, i) => i % 3 === 2 ? v : +(v + 24).toFixed(2)) }; build(n); return n; });
    ic = (sel.imgs || []).map(o => ({ ...o, id: pid(), x: o.x + 24, y: o.y + 24 }));
    page.s.push(...copies); page.im = [...(page.im || []), ...ic];
  });
  sel = { page, items: copies, imgs: ic }; selBB(); setSel(sel);
}
export function selRecolor(c) { if (!sel) return false; const before = sel.items.map(st => st.c); sel.items.forEach(st => st.c = c); undo.push({ t: 'color', items: sel.items.slice(), before, after: sel.items.map(() => c) }); redo = []; req(); save(); return true; }
export function clearSel() { setSel(null); }
export const hasSel = () => !!sel;

/* ---- input ---- */
function toDoc(e) { const r = cv.getBoundingClientRect(), s = sc(); return [(e.clientX - r.left) / s + view.sx, (e.clientY - r.top) / s + view.sy]; }
function pageAt(y) { for (let i = pages.length - 1; i >= 0; i--) if (y >= tops[i]) return y <= tops[i] + pages[i].h ? i : -1; return -1; }
const drawsWith = e => e.pointerType === 'pen' || e.pointerType === 'mouse' || (e.buttons & 34) || e.button === 2 || e.button === 5 || (e.pointerType === 'touch' && opts.finger());
let btnFlag = false, btnFrom = '', lastPenSeen = -1e9;
const isPenKey = e => performance.now() - lastPenSeen < 3000 && (/stylus|pen/i.test(e.code + e.key) || (e.key === 'Unidentified' && !e.ctrlKey && !e.altKey));
const penButton = e => (e.pointerType === 'pen' || ((e.buttons & 34) || e.button === 2 || e.button === 5)) && (btnFlag || e.button === 2 || e.button === 5 || e.button === 1 || (e.buttons & 2) || (e.buttons & 4) || (e.buttons & 32));
function convertToErase() { if (live && live.mode === 'draw') { live = { mode: 'erase', id: live.id, hits: [], snap: new Map() }; req(); } }
function endHoverErase() { if (live && live.hover) { finishErase(live); live = null; req(); } }
export let lastPen = '';
function modeFor(e) {
  if (penButton(e)) return 'erase';
  if (e.pointerType === 'mouse' && e.button === 2) return 'erase';
  return tool.t;
}
const hlColor = () => (tool.c === '#ffffff' || tool.c === '#111111') ? '#F2B53A' : tool.c;
function down(e) {
  if (e.pointerType === 'pen') lastPenSeen = performance.now();
  stopInertia(); opts.closePop && opts.closePop();
  if (e.pointerType === 'pen') { lastPen = `type pen · button ${e.button} · buttons ${e.buttons}`; opts.penInfo && opts.penInfo(lastPen); }
  if (drawsWith(e) && !(e.pointerType === 'touch' && pinch)) {
    if (e.pointerType === 'touch' && penDown) return;
    try { cv.setPointerCapture(e.pointerId); } catch (_) {} penDown = true; touches.clear(); pinch = null;
    const m = modeFor(e), [x, y] = toDoc(e);
    if (m === 'laser') { live = { mode: 'laser', id: e.pointerId }; laser.push({ x, y, t: performance.now() }); req(); return; }
    if (m === 'erase') { live = { mode: 'erase', id: e.pointerId, hits: [], snap: new Map() }; eraseAt(x, y); return; }
    if (m === 'lasso') {
      const h = hitSel(x, y);
      if (h) { live = { mode: 'xform', id: e.pointerId, h, x0: x, y0: y, orig: sel.items.map(st => ({ st, p: st.p.slice(), w: st.w })), oimg: (sel.imgs || []).map(o => ({ o, r: [o.x, o.y, o.w, o.h] })) }; return; }
      const pg = pageAt(y); if (pg < 0) { setSel(null); return; }
      setSel(null); live = { mode: 'lasso', id: e.pointerId, page: pages[pg], path: [[x, y]] }; req(); return;
    }
    if (sel) { const h = hitSel(x, y); if (h && h.kind === 'scale') { startXform(e.pointerId, x, y, h); return; } setSel(null); }
    const pg = pageAt(y); if (pg < 0) return;
    const page = pages[pg], ly = y - tops[pg];
    if (m === 'shape') { live = { mode: 'shape', id: e.pointerId, page, sts: [], x0: x, y0: ly, x1: x, y1: ly }; opts.hint(false); req(); return; }
    const st = { t: m === 'hl' ? 'hl' : 'pen', c: m === 'hl' ? hlColor() : tool.c, w: m === 'hl' ? SIZES[tool.sz] * 4.2 : SIZES[tool.sz], p: [] };
    const pr = e.pointerType === 'pen' ? (e.pressure || .5) : .5;
    live = { mode: 'draw', id: e.pointerId, page, st, pp: pr, still: true, sx: x, sy: y };
    const me = live;
    me.hold = setTimeout(() => { if (live !== me || !me.still) return; const o = hitObject(x, y); if (!o) return; sel = o; selBB(); setSel(sel); startXform(e.pointerId, x, y, { kind: 'move' }); navigator.vibrate && navigator.vibrate(15); req(); }, 550);
    st.p.push(+x.toFixed(2), +ly.toFixed(2), +pr.toFixed(3)); build(st); opts.hint(false); req(); return;
  }
  if (e.pointerType === 'touch') {
    if (penDown || performance.now() - lastPenUp < 250) return;
    if ((e.width || 0) > 45 && (e.height || 0) > 45) return;
    if (sel && !touches.size) { const [x, y] = toDoc(e); const h = hitSel(x, y); if (h) { try { cv.setPointerCapture(e.pointerId); } catch (_) {} startXform(e.pointerId, x, y, h); return; } }
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t0: performance.now(), t: performance.now(), vx: 0, vy: 0 }); pull = 0; atEnd = view.sy >= maxSy() - 2;
    if (touches.size === 2) {
      const [a, b] = [...touches.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y) || 1; const r = cv.getBoundingClientRect();
      pinch = { d0: d, z0: view.z, dx: ((a.x + b.x) / 2 - r.left) / sc() + view.sx, dy: ((a.y + b.y) / 2 - r.top) / sc() + view.sy };
    }
  }
}
function finishErase(L) {
  if (L.snap && L.snap.size) { const items = [...L.snap].map(([page, before]) => ({ page, before, after: page.s.slice() })); items.forEach(it => touched.add(it.page.id)); undo.push({ t: 'strokes', items }); redo = []; save(); }
  else if (L.hits.length) { L.hits.forEach(h => touched.add(h.page.id)); undo.push({ t: 'erase', items: L.hits }); redo = []; save(); }
}
function move(e) {
  // S Pen side button held while hovering: erase without touching the screen
  if (e.pointerType === 'pen' || (e.buttons & 34)) {
    lastPenSeen = performance.now();
    if (!live && penButton(e)) { live = { mode: 'erase', id: e.pointerId, hits: [], snap: new Map(), hover: true }; }
    else if (live && live.hover && live.id === e.pointerId && !penButton(e)) { finishErase(live); live = null; req(); return; }
  }
  if (live && e.pointerId === live.id) {
    // pen button pressed just after touching down: switch this stroke to the eraser
    if (live.mode === 'draw' && penButton(e) && live.st.p.length <= 30) { live = { mode: 'erase', id: e.pointerId, hits: [], snap: new Map() }; }
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ev of (evs.length ? evs : [e])) {
      const [x, y] = toDoc(ev);
      if (live.mode === 'laser') { laser.push({ x, y, t: performance.now() }); continue; }
      if (live.mode === 'erase') { eraseAt(x, y); continue; }
      if (live.mode === 'lasso') { live.path.push([x, y]); continue; }
      if (live.mode === 'xform') { xform(x, y); continue; }
      const ly = y - tops[pages.indexOf(live.page)];
      if (live.mode === 'shape') { let x1 = x, y1 = ly; if (tool.shape === 'line' || tool.shape === 'arrow') { const ang = Math.atan2(y1 - live.y0, x1 - live.x0); const sn = Math.round(ang / (Math.PI / 4)) * Math.PI / 4; if (Math.abs(ang - sn) < .06) { const L = Math.hypot(x1 - live.x0, y1 - live.y0); x1 = live.x0 + L * Math.cos(sn); y1 = live.y0 + L * Math.sin(sn); } }
        live.x1 = x1; live.y1 = y1; live.sts = shapeParts(tool.shape, live.x0, live.y0, x1, y1).map(pts => { const st = { t: 'pen', c: tool.c, w: SIZES[tool.sz], sh: 1, p: flat(pts) }; build(st); return st; }); continue; }
      if (live.still && Math.hypot(x - live.sx, y - live.sy) > 4 / view.z) { live.still = false; clearTimeout(live.hold); }
      const P = live.st.p, n = P.length, dx = x - P[n - 3], dy = ly - P[n - 2];
      if (dx * dx + dy * dy < (0.35 / view.z) ** 2) continue;
      let pr = ev.pointerType === 'pen' ? (ev.pressure || live.pp) : .5; pr = live.pp * .55 + pr * .45; live.pp = pr;
      P.push(+x.toFixed(2), +ly.toFixed(2), +pr.toFixed(3));
    }
    if (live.mode === 'draw') build(live.st);
    req(); return;
  }
  const t = touches.get(e.pointerId); if (!t) return;
  const now = performance.now(), dxs = e.clientX - t.x, dys = e.clientY - t.y, dt = Math.max(1, now - t.t);
  t.vx = t.vx * .6 + (dxs / dt) * .4; t.vy = t.vy * .6 + (dys / dt) * .4; t.x = e.clientX; t.y = e.clientY; t.t = now;
  if (touches.size === 1 && !pinch) {
    const before = view.sy; view.sx -= dxs / sc(); view.sy -= dys / sc(); clampView(); req();
    // pulling up past the last page adds a new page (like Samsung Notes)
    if (atEnd && view.sy >= maxSy() - .5) { pull = Math.max(0, pull - dys); opts.pullHint && opts.pullHint(pull > PULL ? 2 : pull > 30 ? 1 : 0); }
    else { if (pull) opts.pullHint && opts.pullHint(0); pull = 0; atEnd = false; }
  } else if (touches.size >= 2 && pinch) {
    const [a, b] = [...touches.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y) || 1; const r = cv.getBoundingClientRect();
    view.z = Math.min(4, Math.max(.5, pinch.z0 * d / pinch.d0)); const s = sc();
    view.sx = pinch.dx - ((a.x + b.x) / 2 - r.left) / s; view.sy = pinch.dy - ((a.y + b.y) / 2 - r.top) / s; clampView(); req();
  }
}
function xform(x, y) {
  const L = live, page = sel.page;
  if (L.h.kind === 'move') {
    const dx = x - L.x0, dy = y - L.y0;
    for (const o of L.orig) { o.st.p = o.p.map((v, i) => i % 3 === 0 ? +(v + dx).toFixed(2) : i % 3 === 1 ? +(v + dy).toFixed(2) : v); build(o.st); }
    for (const q of L.oimg || []) { q.o.x = q.r[0] + dx; q.o.y = q.r[1] + dy; }
  } else {
    const top = tops[pages.indexOf(page)], { ox, oy, cx, cy } = L.h, ly = y - top;
    const d0 = Math.hypot(cx - ox, cy - oy) || 1, d1 = Math.hypot(x - ox, ly - oy); const k = Math.max(.1, Math.min(8, d1 / d0));
    for (const o of L.orig) { o.st.p = o.p.map((v, i) => i % 3 === 0 ? +(ox + (v - ox) * k).toFixed(2) : i % 3 === 1 ? +(oy + (v - oy) * k).toFixed(2) : v); o.st.w = +(o.w * Math.sqrt(k)).toFixed(2); build(o.st); }
    for (const q of L.oimg || []) { q.o.x = ox + (q.r[0] - ox) * k; q.o.y = oy + (q.r[1] - oy) * k; q.o.w = q.r[2] * k; q.o.h = q.r[3] * k; }
  }
  selBB();
}
function up(e) {
  if (e.pointerType === 'pen' && btnFrom === 'menu') { btnFlag = false; btnFrom = ''; }
  if (live && e.pointerId === live.id) {
    const L = live; clearTimeout(L.hold);
    if (L.mode === 'draw' && L.st.p.length) {
      if (tool.auto && L.st.t === 'pen') recognise(L.st);
      touched.add(L.page.id); L.page.s.push(L.st); undo.push({ t: 'add', page: L.page, st: L.st }); redo = []; save();
    }
    if (L.mode === 'shape' && L.sts.length && Math.hypot(L.x1 - L.x0, L.y1 - L.y0) > 4) { const gid = pid(); L.sts.forEach(s => { s.gid = gid; }); touched.add(L.page.id); L.page.s.push(...L.sts); undo.push({ t: 'addmany', page: L.page, sts: L.sts }); redo = []; save(); }
    if (L.mode === 'erase') finishErase(L);
    if (L.mode === 'lasso') finishLasso(L.path, L.page);
    if (L.mode === 'xform') { undo.push({ t: 'xform', items: L.orig.map(o => ({ st: o.st, before: [o.p, o.w], after: [o.st.p, o.st.w] })), imgs: (L.oimg || []).map(q => ({ o: q.o, before: q.r, after: [q.o.x, q.o.y, q.o.w, q.o.h] })) }); redo = []; touched.add(sel.page.id); save(); reportSel(); }
    live = null; penDown = false; lastPenUp = performance.now(); req(); return;
  }
  const t = touches.get(e.pointerId); if (!t) return; touches.delete(e.pointerId);
  // a quick tap (no scrolling) on a picture or shape selects it; a tap elsewhere clears the selection
  if (!pinch && !touches.size && e.type === 'pointerup' && Math.hypot(e.clientX - t.sx, e.clientY - t.sy) < 10 && performance.now() - t.t0 < 400) {
    const [x, y] = toDoc(e), o = hitObject(x, y); if (o) { sel = o; selBB(); setSel(sel); return; } if (sel) { setSel(null); return; }
  }
  if (pinch && touches.size < 2) { pull = 0; opts.pullHint && opts.pullHint(0); pinch = null; if (touches.size === 1) { const o = [...touches.values()][0]; o.vx = o.vy = 0; } refreshPdfRes(); return; }
  if (pull) { opts.pullHint && opts.pullHint(0); const add = pull > PULL && atEnd && e.type === 'pointerup'; pull = 0; atEnd = false; if (add) { addPageEnd(); return; } }
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
  const pg = pageAt(y); live.cx = x; live.cy = y; req(); if (pg < 0) return;
  const page = pages[pg], ly = y - tops[pg], S = page.s;
  if (tool.er === 'area') return areaErase(page, x, ly, ER_SIZES[tool.erSz] / Math.sqrt(view.z));
  const r = 10 / view.z; let hit = false;
  for (let i = S.length - 1; i >= 0; i--) {
    const st = S[i], b = st.bb, pad = r + st.w * 1.2;
    if (x < b[0] - pad || x > b[2] + pad || ly < b[1] - pad || ly > b[3] + pad) continue;
    const P = st.p, n = P.length / 3; let near = false;
    for (let j = 0; j < n && !near; j++) {
      const ax = P[j * 3], ay = P[j * 3 + 1], bx = j + 1 < n ? P[j * 3 + 3] : ax, by = j + 1 < n ? P[j * 3 + 4] : ay;
      const vx = bx - ax, vy = by - ay, l = vx * vx + vy * vy; let t = l ? ((x - ax) * vx + (ly - ay) * vy) / l : 0; t = Math.max(0, Math.min(1, t));
      if (Math.hypot(ax + t * vx - x, ay + t * vy - ly) < pad) near = true;
    }
    if (near) { S.splice(i, 1); live.hits.push({ page, st, i }); hit = true; }
  }
  if (hit) req();
}
// Area eraser: cuts away only the part of each stroke under the eraser circle.
function densify(P, step) {
  const o = []; const n = P.length / 3;
  for (let i = 0; i < n; i++) {
    if (i) { const ax = P[i * 3 - 3], ay = P[i * 3 - 2], ap = P[i * 3 - 1], bx = P[i * 3], by = P[i * 3 + 1], bp = P[i * 3 + 2], L = Math.hypot(bx - ax, by - ay), k = Math.floor(L / step);
      for (let j = 1; j < k; j++) { const t = j / k; o.push(ax + (bx - ax) * t, ay + (by - ay) * t, ap + (bp - ap) * t); } }
    o.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
  }
  return o;
}
function areaErase(page, x, y, r) {
  let changed = false; const out = [];
  for (const st of page.s) {
    const b = st.bb, pad = r + st.w;
    if (x < b[0] - pad || x > b[2] + pad || y < b[1] - pad || y > b[3] + pad) { out.push(st); continue; }
    const P = densify(st.p, Math.max(1.5, r / 3)), n = P.length / 3, keep = []; let cur = [], any = false;
    for (let i = 0; i < n; i++) {
      if (Math.hypot(P[i * 3] - x, P[i * 3 + 1] - y) < r + st.w / 2) { any = true; if (cur.length) { keep.push(cur); cur = []; } }
      else cur.push(+P[i * 3].toFixed(2), +P[i * 3 + 1].toFixed(2), P[i * 3 + 2]);
    }
    if (cur.length) keep.push(cur);
    if (!any) { out.push(st); continue; }
    changed = true; if (!live.snap.has(page)) live.snap.set(page, page.s.slice());
    for (const pts of keep) if (pts.length >= 6) { const n2 = { t: st.t, c: st.c, w: st.w, sh: st.sh, p: pts }; build(n2); out.push(n2); }
  }
  if (changed) { page.s = out; req(); }
}

/* ---- actions ---- */
function apply(a, dir) {
  const fwd = dir > 0;
  if (a.t === 'add') { if (fwd) a.page.s.push(a.st); else { const i = a.page.s.lastIndexOf(a.st); if (i >= 0) a.page.s.splice(i, 1); } }
  else if (a.t === 'addmany') { if (fwd) a.page.s.push(...a.sts); else a.page.s = a.page.s.filter(st => !a.sts.includes(st)); }
  else if (a.t === 'erase') {
    if (fwd) for (const h of a.items) { const i = h.page.s.indexOf(h.st); if (i >= 0) h.page.s.splice(i, 1); }
    else for (let k = a.items.length - 1; k >= 0; k--) { const h = a.items[k]; h.page.s.splice(Math.min(h.i, h.page.s.length), 0, h.st); }
  }
  else if (a.t === 'clear') a.page.s = fwd ? [] : a.old;
  else if (a.t === 'strokes') a.items.forEach(it => it.page.s = (fwd ? it.after : it.before).slice());
  else if (a.t === 'xform') { for (const it of a.items) { const [p, w] = fwd ? it.after : it.before; it.st.p = p; it.st.w = w; build(it.st); } for (const it of a.imgs || []) { const r = fwd ? it.after : it.before; Object.assign(it.o, { x: r[0], y: r[1], w: r[2], h: r[3] }); } }
  else if (a.t === 'snap') { a.page.s = (fwd ? a.s1 : a.s0).slice(); a.page.im = (fwd ? a.i1 : a.i0).slice(); }
  else if (a.t === 'color') a.items.forEach((st, i) => st.c = fwd ? a.after[i] : a.before[i]);
  else if (a.t === 'pages') { pages = fwd ? a.after.slice() : a.before.slice(); layout(); clampView(); }
  else if (a.t === 'style') a.items.forEach((it, i) => { const v = fwd ? a.after : it; it.page.bg = v.bg; it.page.pat = v.pat; });
}
export function doUndo() { const a = undo.pop(); if (!a) return; apply(a, -1); redo.push(a); setSel(null); save(); }
export function doRedo() { const a = redo.pop(); if (!a) return; apply(a, 1); undo.push(a); setSel(null); save(); }
function pagesChange(fn) { const before = pages.slice(); fn(); undo.push({ t: 'pages', before, after: pages.slice() }); redo = []; layout(); clampView(); req(); save(); }
export function addPage(style) { const at = curPage + 1; pagesChange(() => pages.splice(at, 0, newPage(style))); view.sy = tops[at] - GAP; clampView(); req(); }
export function addPageEnd() {
  let base = null; for (let i = pages.length - 1; i >= 0; i--) if (pages[i].k !== 'pdf') { base = { bg: pages[i].bg, pat: pages[i].pat }; break; }
  pagesChange(() => pages.push(newPage(base || opts.style()))); view.sy = tops[pages.length - 1] - GAP; clampView(); req(); opts.toast('New page added');
}
export function deletePages(ix) {
  const del = new Set(ix.map(i => pages[i]).filter(Boolean)); if (!del.size) return;
  pagesChange(() => { pages = pages.filter(p => !del.has(p)); if (!pages.length) pages.push(newPage(opts.style())); });
  opts.toast(del.size + (del.size > 1 ? ' pages deleted' : ' page deleted') + '. Undo brings them back.');
}
export function insertPage(at, style) { pagesChange(() => pages.splice(Math.max(0, Math.min(at, pages.length)), 0, newPage(style))); }
export function movePage(from, to) { if (from === to || !pages[from]) return; pagesChange(() => { const [p] = pages.splice(from, 1); pages.splice(to, 0, p); }); }
export function deletePage() {
  const p = pages[curPage]; if (!p) return;
  pagesChange(() => { pages.splice(curPage, 1); if (!pages.length) pages.push(newPage(opts.style())); });
  opts.toast('Page deleted. Undo brings it back.');
}
export function removePdf() {
  const p = pages[curPage]; if (!p || p.k !== 'pdf') return false; const d = p.d;
  pagesChange(() => { pages = pages.filter(q => !(q.k === 'pdf' && q.d === d)); if (!pages.length) pages.push(newPage(opts.style())); });
  opts.toast('PDF removed. Undo brings it back.'); return true;
}
export function setPageStyle(style, all) {
  const list = (all ? pages : [pages[curPage]]).filter(p => p && p.k !== 'pdf'); if (!list.length) { opts.toast('PDF pages keep their own look'); return; }
  undo.push({ t: 'style', items: list.map(p => ({ page: p, bg: p.bg, pat: p.pat })), after: style }); redo = [];
  apply(undo[undo.length - 1], 1); req(); save();
}
export function clearPage() { const p = pages[curPage]; if (!p.s.length) return false; undo.push({ t: 'clear', page: p, old: p.s }); p.s = []; redo = []; req(); save(); return true; }
export function fit() { view.z = 1; clampView(); req(); }
export function goPage(i) { if (!pages[i]) return; view.sy = tops[i] - GAP; clampView(); req(); }

/* ---- export helpers ---- */
export const topicNow = () => topic;
export function pageInfo() { return pages.map((p, i) => ({ i, kind: p.k, strokes: p.s.length, touched: touched.has(p.id) })); }
export async function renderPage(i, W) {
  const p = pages[i]; const c = document.createElement('canvas'); c.width = Math.round(W); c.height = Math.round(W * p.h / DOCW);
  const x = c.getContext('2d'); const k = W / DOCW;
  if (p.k === 'pdf' && pdfDocs[p.d]) {
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    const pg = await pdfDocs[p.d].getPage(p.n); const v1 = pg.getViewport({ scale: 1 });
    await pg.render({ canvasContext: x, viewport: pg.getViewport({ scale: c.width / v1.width }) }).promise;
    x.setTransform(k, 0, 0, k, 0, 0);
  } else { x.setTransform(k, 0, 0, k, 0, 0); drawPageBg(p, 0, x, false); }
  x.lineCap = 'round'; x.lineJoin = 'round';
  for (const o of p.im || []) { const im = await loadImg(o.key); if (im) x.drawImage(im, o.x, o.y, o.w, o.h); }
  for (const st of p.s) drawStroke(st, x);
  return c;
}

export const hasPdf = d => pages.some(p => p.k === 'pdf' && p.d === d);
// Swap one PDF's pages for a new version and carry the writing across.
// remap(oldIndex, stroke) -> { page, dy } says where each stroke belongs on the new pages (dy in page units).
export async function replacePdf(file, oldD, remap) {
  const buf = await file.arrayBuffer(); const doc = await openPdf(buf); const d = pdfDocs.length; pdfDocs.push(doc);
  await store.put('blobs', 'pdf:' + topic.id + ':' + d, buf);
  const fresh = []; for (let n = 1; n <= doc.numPages; n++) { const pg = await doc.getPage(n); const v = pg.getViewport({ scale: 1 }); fresh.push({ id: pid(), im: [], k: 'pdf', d, n, h: Math.round(DOCW * v.height / v.width), s: [] }); }
  const old = pages.filter(p => p.k === 'pdf' && p.d === oldD); const at = old.length ? pages.indexOf(old[0]) : pages.length;
  old.forEach((op, oi) => op.s.forEach(st => {
    const r = remap(oi, st) || { page: oi, dy: 0 }; const tgt = fresh[Math.max(0, Math.min(r.page, fresh.length - 1))];
    if (r.dy) { st.p = st.p.map((v, i) => i % 3 === 1 ? +(v + r.dy).toFixed(2) : v); build(st); }
    tgt.s.push(st);
  }));
  fresh.forEach(p => { if (old.some(o => touched.has(o.id))) touched.add(p.id); });
  pages = pages.filter(p => !old.includes(p)); pages.splice(at, 0, ...fresh);
  undo = []; redo = []; setSel(null); layout(); view.sy = tops[at] - GAP; clampView(); req(); save();
  return d;
}
export const pageUnits = () => DOCW;

// Insert a picture (a question, a diagram, a screenshot) on the current page. Move or resize it with the lasso.
export async function insertImage(file) {
  const page = pages[curPage]; if (!page) return;
  const key = pid() + pid(); await store.put('blobs', 'img:' + key, file);
  const im = await new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = URL.createObjectURL(file); });
  if (!im) { opts.toast('This picture could not be opened.'); return; }
  const pr = Promise.resolve(im); pr.img = im; imgCache.set(key, pr);
  let w = Math.min(DOCW * .8, im.naturalWidth), h = w * im.naturalHeight / im.naturalWidth;
  if (h > page.h * .8) { h = page.h * .8; w = h * im.naturalWidth / im.naturalHeight; }
  const midY = view.sy + view.H / sc() / 2 - tops[curPage];
  const o = { id: pid(), key, x: (DOCW - w) / 2, y: Math.max(20, Math.min(page.h - h - 20, midY - h / 2)), w, h };
  page.im = page.im || []; snapUndo(page, () => page.im.push(o));
  tool.t = 'lasso'; opts.toolChanged && opts.toolChanged();
  sel = { page, items: [], imgs: [o] }; selBB(); setSel(sel); opts.hint(false);
  opts.toast('Picture added. Drag it to move, drag a gold corner to resize.');
}
export const pageCountNow = () => pages.length;
export const _view = () => ({ ...view });

function startXform(id, x, y, h) {
  live = { mode: 'xform', id, h, x0: x, y0: y, orig: sel.items.map(st => ({ st, p: st.p.slice(), w: st.w })), oimg: (sel.imgs || []).map(o => ({ o, r: [o.x, o.y, o.w, o.h] })) };
}
// the picture or drawn shape (a whole gate counts as one) under a point
function hitObject(x, y) {
  const pg = pageAt(y); if (pg < 0) return null; const page = pages[pg], ly = y - tops[pg];
  for (let i = (page.im || []).length - 1; i >= 0; i--) { const o = page.im[i]; if (x >= o.x && x <= o.x + o.w && ly >= o.y && ly <= o.y + o.h) return { page, items: [], imgs: [o] }; }
  const r = 12 / view.z;
  for (let i = page.s.length - 1; i >= 0; i--) {
    const st = page.s[i]; if (!st.sh) continue; const b = st.bb, pad = r + st.w; if (x < b[0] - pad || x > b[2] + pad || ly < b[1] - pad || ly > b[3] + pad) continue;
    // anywhere inside a shape (or a whole gate) picks it up
    return { page, items: st.gid ? page.s.filter(s => s.gid === st.gid) : [st], imgs: [] };
  }
  return null;
}
// render one page of a PDF to a picture (to place it on a page instead of adding it as pages)
export async function pdfPageImage(file, n) {
  const doc = await openPdf(await file.arrayBuffer()); const pg = await doc.getPage(Math.max(1, Math.min(n, doc.numPages)));
  const v1 = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: 1600 / v1.width }); const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); await pg.render({ canvasContext: x, viewport: vp }).promise;
  return new Promise(ok => c.toBlob(bl => ok(new File([bl], 'page.png', { type: 'image/png' })), 'image/png'));
}
export async function pdfPages(file) { const doc = await openPdf(await file.arrayBuffer()); return doc.numPages; }
