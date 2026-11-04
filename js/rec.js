// Records exactly what students see (background, branded window, board, camera) plus the microphone.
// Video is composited into an off-screen canvas; chunks are written to IndexedDB every 3 s so a crash loses at most a few seconds.
import * as store from './store.js';
import * as cam from './cam.js';

let rec = null, opts;
const $ = s => document.querySelector(s);
export const isRecording = () => !!rec;
export const isPaused = () => rec && rec.paused;

export async function init(o) {
  opts = o;
  for (const [k, m] of await store.all('recs')) if (m.status === 'recording') { m.status = 'done'; m.note = 'Saved after the app closed unexpectedly'; await store.put('recs', k, m); }
}
function pickMime() {
  const c = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return c.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
}
// layout: 'normal' = what is on the screen; 'premium' = 16:9 frame with the board on the left and an empty green camera box on the right
// slot = the phone video at exactly 70% in a 1080p CapCut project (a portrait clip fills the height at 100%), centred vertically
export const PREMIUM = { ref: [1920, 1080], slot: { x: 1431, y: 162, w: 426, h: 756 }, scale: 70, pos: [684, 0] };
export async function start(topic, o = {}) {
  if (rec) return;
  const layout = o.layout === 'premium' ? 'premium' : 'normal';
  let outW = Math.min(1600, Math.round(innerWidth * Math.min(devicePixelRatio || 1, 2))) & ~1;
  let outH = Math.round(outW * innerHeight / innerWidth) & ~1;
  if (layout === 'premium') { outW = o.width === 1600 ? 1600 : 1920; outH = Math.round(outW * 9 / 16) & ~1; }
  const cv = document.createElement('canvas'); cv.width = outW; cv.height = outH; const ctx = cv.getContext('2d');
  let mic = null;
  const dev = (await store.get('kv', 'dev')) || {};
  const ac0 = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }; if (dev.mic) ac0.deviceId = { exact: dev.mic };
  try { mic = await navigator.mediaDevices.getUserMedia({ audio: ac0 }); }
  catch (e0) { if (dev.mic) { delete ac0.deviceId; try { mic = await navigator.mediaDevices.getUserMedia({ audio: ac0 }); opts.toast('The chosen microphone is not connected, so the tablet microphone is used.'); } catch (e) {} } }
  if (!mic) try { mic = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { opts.toast('Microphone not available, so this recording has no sound.'); }
  const vs = cv.captureStream(24);
  const tracks = [...vs.getVideoTracks(), ...(mic ? mic.getAudioTracks() : [])];
  const mime = pickMime();
  const mr = new MediaRecorder(new MediaStream(tracks), { mimeType: mime || undefined, videoBitsPerSecond: layout === 'premium' ? 8_000_000 : 5_000_000, audioBitsPerSecond: 128_000 });
  const id = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + Math.random().toString(36).slice(2, 5);
  const meta = { id, topicObj: JSON.parse(JSON.stringify(topic)), topicId: topic.id, topic: topic.name, chapter: topic.chapterName || '', level: topic.levelName || '', started: Date.now(), dur: 0, size: 0, chunks: 0, mime: mr.mimeType || mime || 'video/webm', status: 'recording', w: outW, h: outH, layout, ...(layout === 'premium' ? { slot: PREMIUM.slot, ref: PREMIUM.ref, capcut: { scale: PREMIUM.scale, pos: PREMIUM.pos } } : {}) };
  await store.put('recs', id, meta);
  rec = { layout, mr, cv, ctx, mic, meta, paused: false, acc: 0, since: performance.now(), timer: 0, analyser: null, silentFor: 0 };
  let writing = Promise.resolve();
  mr.ondataavailable = e => {
    if (!e.data || !e.data.size) return; const n = meta.chunks++;
    meta.size += e.data.size; meta.dur = elapsed();
    writing = writing.then(() => store.put('blobs', 'rec:' + id + ':' + String(n).padStart(6, '0'), e.data)).then(() => store.put('recs', id, meta))
      .catch(err => opts.toast('Storage full? Recording could not be saved: ' + err.message));
  };
  rec.done = new Promise(r => { mr.onstop = () => writing.then(r); });
  if (mic) {
    try { const ac = new AudioContext(); const an = ac.createAnalyser(); an.fftSize = 512; ac.createMediaStreamSource(mic).connect(an); rec.analyser = an; rec.ac = ac; rec.buf = new Float32Array(an.fftSize); } catch (e) {}
  }
  mr.start(3000);
  rec.timer = setInterval(tick, 42);
  tick();
}
function elapsed() { return rec ? Math.round((rec.acc + (rec.paused ? 0 : performance.now() - rec.since)) / 1000) : 0; }
let lastUi = 0;
function tick() {
  if (!rec) return;
  if (!rec.paused) compose(rec.ctx, rec.cv.width, rec.cv.height, rec.layout);
  const now = performance.now();
  if (now - lastUi > 250) {
    lastUi = now; let lvl = 0;
    if (rec.analyser) { rec.analyser.getFloatTimeDomainData(rec.buf); let s = 0; for (const v of rec.buf) s += v * v; lvl = Math.min(1, Math.sqrt(s / rec.buf.length) * 6); }
    if (!rec.paused && rec.analyser) { rec.silentFor = lvl < .01 ? rec.silentFor + .25 : 0; if (Math.abs(rec.silentFor - 20) < .2) opts.toast('No sound is reaching the recording. Another app (like Zoom) is holding the microphone. Google Meet works with recording.'); }
    opts.status({ t: elapsed(), level: lvl, paused: rec.paused });
  }
}
export function pause() { if (!rec) return; if (rec.paused) { rec.mr.resume(); rec.paused = false; rec.since = performance.now(); } else { rec.mr.pause(); rec.paused = true; rec.acc += performance.now() - rec.since; } tick(); }
export async function stop() {
  if (!rec) return null; const r = rec; clearInterval(r.timer);
  r.meta.dur = elapsed(); r.mr.stop(); await r.done;
  r.meta.status = 'done'; await store.put('recs', r.meta.id, r.meta);
  if (r.mic) r.mic.getTracks().forEach(t => t.stop()); if (r.ac) r.ac.close();
  rec = null; opts.status(null); return r.meta;
}
export async function blobFor(id) {
  const m = await store.get('recs', id); const parts = (await store.getPrefix('blobs', 'rec:' + id + ':')).map(([, v]) => v);
  return new Blob(parts, { type: (m && m.mime || 'video/webm').split(';')[0] });
}
export async function remove(id) { await store.delPrefix('blobs', 'rec:' + id + ':'); await store.del('recs', id); }

/* ---- draw the student view into the recording canvas ---- */
// positions and styles are measured a few times a second, not on every frame
let mCache = new Map(), mAt = 0;
const R = el => { const now = performance.now(); if (now - mAt > 300) { mCache = new Map(); mAt = now; } let v = mCache.get(el); if (!v) { v = { r: el.getBoundingClientRect() }; mCache.set(el, v); } return v.r; };
const getComputedStyleC = el => { R(el); const v = mCache.get(el); if (!v.s) { const s = getComputedStyle(el); v.s = { color: s.color, fontSize: s.fontSize, letterSpacing: s.letterSpacing, backgroundColor: s.backgroundColor }; } return v.s; };
function rr(ctx, r, rad) { ctx.beginPath(); ctx.roundRect(r.left, r.top, r.width, r.height, rad); }
// the branded window: frame, title bar, title, page number and the board / code / second window (drawn in screen units)
function drawWindow(ctx) {
  const win = R($('#win')), bar = R($('.bar'));
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 20; ctx.fillStyle = '#120d36'; rr(ctx, win, 16); ctx.fill(); ctx.restore();
  ctx.save(); ctx.shadowColor = 'rgba(92,225,255,.25)'; ctx.shadowBlur = 40; ctx.strokeStyle = 'rgba(242,181,58,.45)'; ctx.lineWidth = 2; rr(ctx, { left: win.left - 1, top: win.top - 1, width: win.width + 2, height: win.height + 2 }, 17); ctx.stroke(); ctx.restore();
  const g = ctx.createLinearGradient(0, bar.top, 0, bar.bottom); g.addColorStop(0, '#1a1446'); g.addColorStop(1, '#120d36'); ctx.fillStyle = g; rr(ctx, bar, [16, 16, 0, 0]); ctx.fill();
  for (const i of document.querySelectorAll('.bar i')) { const r = R(i); ctx.fillStyle = getComputedStyleC(i).backgroundColor; ctx.beginPath(); ctx.arc(r.left + r.width / 2, r.top + r.height / 2, r.width / 2, 0, 7); ctx.fill(); }
  ctx.textBaseline = 'middle';
  const tt = $('#title'), tr = R(tt), tcs = getComputedStyleC(tt); ctx.fillStyle = '#F5F1EA'; ctx.font = `700 ${tcs.fontSize} "Space Grotesk", sans-serif`; ctx.textAlign = 'center';
  ctx.fillText(tt.textContent, tr.left + tr.width / 2, tr.top + tr.height / 2, tr.width);
  const pg = $('#pg'), pr = R(pg); ctx.fillStyle = '#b9b0d6'; ctx.font = '700 12px "JetBrains Mono", monospace'; ctx.textAlign = 'right'; ctx.fillText(pg.textContent, pr.right, pr.top + pr.height / 2);
  opts.drawContent(ctx);
}
function drawChips(ctx) {
  ctx.textBaseline = 'middle';
  for (const s of document.querySelectorAll('#chips span')) {
    const r = R(s), cs = getComputedStyleC(s); ctx.strokeStyle = cs.color; ctx.lineWidth = 2; rr(ctx, r, r.height / 2); ctx.stroke();
    ctx.fillStyle = cs.color; ctx.font = `700 ${cs.fontSize} "JetBrains Mono", monospace`; ctx.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
    ctx.textAlign = 'center'; ctx.fillText(s.textContent, r.left + r.width / 2 + 1, r.top + r.height / 2 + 1);
  }
  ctx.letterSpacing = '0px';
}
function drawFooter(ctx) {
  const f = $('footer'), fr = R(f); ctx.textBaseline = 'middle'; ctx.fillStyle = 'rgba(245,241,234,.55)'; ctx.font = `700 ${getComputedStyleC(f).fontSize} "JetBrains Mono", monospace`; ctx.letterSpacing = '2px'; ctx.textAlign = 'right'; ctx.fillText(f.textContent.trim(), fr.right, fr.top + fr.height / 2); ctx.letterSpacing = '0px';
}
export function compose(ctx, W, H, layout = 'normal') {
  if (layout === 'premium') return composePremium(ctx, W, H);
  const k = W / innerWidth;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(opts.bgCanvas(), 0, 0, W, H);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  const logo = $('header img'); if (logo && logo.complete) { const r = R(logo); ctx.save(); ctx.shadowColor = 'rgba(242,181,58,.25)'; ctx.shadowBlur = 10; ctx.drawImage(logo, r.left, r.top, r.width, r.height); ctx.restore(); }
  drawChips(ctx);
  drawWindow(ctx);
  drawFooter(ctx);
  if (cam.isOn()) {
    const v = cam.video$(), ce = $('#cam'), r = R(ce), circ = ce.classList.contains('circle'), rad = circ ? r.width / 2 : 18;
    ctx.save(); ctx.shadowColor = 'rgba(242,181,58,.45)'; ctx.shadowBlur = 24; ctx.fillStyle = '#000'; rr(ctx, r, rad); ctx.fill(); ctx.restore();
    if (v.videoWidth) {
      ctx.save(); rr(ctx, r, rad); ctx.clip();
      const vr = v.videoWidth / v.videoHeight, br = r.width / r.height; let sw = v.videoWidth, sh = v.videoHeight, sx = 0, sy = 0;
      if (vr > br) { sw = sh * br; sx = (v.videoWidth - sw) / 2; } else { sh = sw / br; sy = (v.videoHeight - sh) / 2; }
      if (cam.state.mirror) { ctx.translate(r.left + r.width, r.top); ctx.scale(-1, 1); ctx.drawImage(v, sx, sy, sw, sh, 0, 0, r.width, r.height); }
      else ctx.drawImage(v, sx, sy, sw, sh, r.left, r.top, r.width, r.height);
      ctx.restore();
    }
    ctx.strokeStyle = '#F2B53A'; ctx.lineWidth = 3; rr(ctx, r, rad); ctx.stroke();
  }
}

// Premium layout, drawn on a 1920x1080 grid: the whole board window is scaled to fit on the left, and the right side
// holds a sharp-cornered portrait box (pure green) exactly the size of the phone video. The editor lays the phone
// video on top at 70%; the frame and corner marks sit outside the box, so no keying is needed and no green can show.
const WIN_AREA = { x: 40, y: 104, w: 1335, h: 872 }, U = 1.35;
const box = (x, y, w, h) => ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h });
function composePremium(ctx, W, H) {
  const k = W / PREMIUM.ref[0], S = PREMIUM.slot, t = performance.now() / 1000;
  const win = R($('#win')), s = Math.min(WIN_AREA.w / win.width, WIN_AREA.h / win.height);
  const ww = win.width * s, wh = win.height * s, wx = WIN_AREA.x + (WIN_AREA.w - ww) / 2, wy = WIN_AREA.y + (WIN_AREA.h - wh) / 2;
  const F = 12; // camera frame thickness
  // background drawn natively for this layout, traces running into the board and the camera box
  ctx.setTransform(k * U, 0, 0, k * U, 0, 0);
  if (opts.paintBg) opts.paintBg(ctx, PREMIUM.ref[0] / U, PREMIUM.ref[1] / U, [box(wx / U, wy / U, ww / U, wh / U), box((S.x - F) / U, (S.y - F) / U, (S.w + 2 * F) / U, (S.h + 2 * F) / U)], t);
  else { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(opts.bgCanvas(), 0, 0, W, H); }
  ctx.setTransform(k, 0, 0, k, 0, 0);
  const logo = $('header img'); if (logo && logo.complete && logo.naturalWidth) { const h = 70, w = h * logo.naturalWidth / logo.naturalHeight; ctx.save(); ctx.shadowColor = 'rgba(242,181,58,.25)'; ctx.shadowBlur = 12; ctx.drawImage(logo, wx, 18, w, h); ctx.restore(); }
  const chips = [...document.querySelectorAll('#chips span')];
  if (chips.length) {
    const rs = chips.map(R), right = Math.max(...rs.map(x => x.right)), top = Math.min(...rs.map(x => x.top)), bot = Math.max(...rs.map(x => x.bottom)), cs = 1.35;
    ctx.save(); ctx.translate(S.x + S.w + F - right * cs, 54 - (top + bot) / 2 * cs); ctx.scale(cs, cs); drawChips(ctx); ctx.restore();
  }
  ctx.save(); ctx.translate(wx, wy); ctx.scale(s, s); ctx.translate(-win.left, -win.top); drawWindow(ctx); ctx.restore();
  // camera frame: glow, dark ring, gold edge, a light running round it, corner marks on the ring
  const fx = S.x - F, fy = S.y - F, fw = S.w + 2 * F, fh = S.h + 2 * F;
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 20; ctx.fillStyle = '#120d36'; ctx.beginPath(); ctx.roundRect(fx, fy, fw, fh, 18); ctx.fill(); ctx.restore();
  ctx.save(); ctx.shadowColor = 'rgba(92,225,255,.3)'; ctx.shadowBlur = 40; ctx.strokeStyle = 'rgba(242,181,58,.55)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(fx - 1, fy - 1, fw + 2, fh + 2, 19); ctx.stroke(); ctx.restore();
  const per = 2 * (fw + fh), run = (t / 6 % 1) * per;
  ctx.save(); ctx.beginPath(); ctx.roundRect(fx - 1, fy - 1, fw + 2, fh + 2, 19); ctx.setLineDash([140, per - 140]); ctx.lineDashOffset = -run; ctx.strokeStyle = '#5CE1FF'; ctx.lineWidth = 3; ctx.shadowColor = '#5CE1FF'; ctx.shadowBlur = 14; ctx.stroke();
  ctx.lineDashOffset = -run - per / 2; ctx.strokeStyle = '#F2B53A'; ctx.shadowColor = '#F2B53A'; ctx.stroke(); ctx.restore();
  ctx.fillStyle = '#0a0720'; ctx.fillRect(S.x, S.y, S.w, S.h);
  ctx.fillStyle = '#00FF00'; ctx.fillRect(S.x + 2, S.y + 2, S.w - 4, S.h - 4); // inset 2px: the phone video always covers it fully
  ctx.strokeStyle = '#F2B53A'; ctx.lineWidth = 4; ctx.lineCap = 'square'; const m = F / 2, L = 40;
  for (const [cx, cy, dx, dy] of [[S.x - m, S.y - m, 1, 1], [S.x + S.w + m, S.y - m, -1, 1], [S.x - m, S.y + S.h + m, 1, -1], [S.x + S.w + m, S.y + S.h + m, -1, -1]]) { ctx.beginPath(); ctx.moveTo(cx + dx * L, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy * L); ctx.stroke(); }
  ctx.lineCap = 'butt';
  const f = $('footer'); ctx.save(); ctx.textBaseline = 'middle'; ctx.fillStyle = 'rgba(245,241,234,.55)'; ctx.font = '700 18px "JetBrains Mono", monospace'; ctx.letterSpacing = '2px'; ctx.textAlign = 'right'; ctx.fillText(f.textContent.trim(), S.x + S.w + F, 1013); ctx.restore();
}
