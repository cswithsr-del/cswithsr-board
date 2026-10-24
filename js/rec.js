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
export async function start(topic) {
  if (rec) return;
  const outW = Math.min(1920, Math.round(innerWidth * Math.min(devicePixelRatio || 1, 2))) & ~1;
  const outH = Math.round(outW * innerHeight / innerWidth) & ~1;
  const cv = document.createElement('canvas'); cv.width = outW; cv.height = outH; const ctx = cv.getContext('2d');
  let mic = null;
  try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch (e) { opts.toast('Microphone not available, so this recording has no sound.'); }
  const vs = cv.captureStream(25);
  const tracks = [...vs.getVideoTracks(), ...(mic ? mic.getAudioTracks() : [])];
  const mime = pickMime();
  const mr = new MediaRecorder(new MediaStream(tracks), { mimeType: mime || undefined, videoBitsPerSecond: 5_000_000, audioBitsPerSecond: 128_000 });
  const id = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + Math.random().toString(36).slice(2, 5);
  const meta = { id, topicId: topic.id, topic: topic.name, chapter: topic.chapterName || '', level: topic.levelName || '', started: Date.now(), dur: 0, size: 0, chunks: 0, mime: mr.mimeType || mime || 'video/webm', status: 'recording', w: outW, h: outH };
  await store.put('recs', id, meta);
  rec = { mr, cv, ctx, mic, meta, paused: false, acc: 0, since: performance.now(), timer: 0, analyser: null, silentFor: 0 };
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
  rec.timer = setInterval(tick, 40);
  tick();
}
function elapsed() { return rec ? Math.round((rec.acc + (rec.paused ? 0 : performance.now() - rec.since)) / 1000) : 0; }
let lastUi = 0;
function tick() {
  if (!rec) return;
  if (!rec.paused) compose(rec.ctx, rec.cv.width, rec.cv.height);
  const now = performance.now();
  if (now - lastUi > 250) {
    lastUi = now; let lvl = 0;
    if (rec.analyser) { rec.analyser.getFloatTimeDomainData(rec.buf); let s = 0; for (const v of rec.buf) s += v * v; lvl = Math.min(1, Math.sqrt(s / rec.buf.length) * 6); }
    if (!rec.paused && rec.analyser) { rec.silentFor = lvl < .01 ? rec.silentFor + .25 : 0; if (Math.abs(rec.silentFor - 20) < .2) opts.toast('No sound is reaching the recording. Zoom is holding the microphone: use your phone for Zoom audio and tap Disconnect audio in Zoom on this tablet.'); }
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
const R = el => el.getBoundingClientRect();
function rr(ctx, r, rad) { ctx.beginPath(); ctx.roundRect(r.left, r.top, r.width, r.height, rad); }
export function compose(ctx, W, H) {
  const k = W / innerWidth;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(opts.bgCanvas(), 0, 0, W, H);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  const logo = $('header img'); if (logo && logo.complete) { const r = R(logo); ctx.save(); ctx.shadowColor = 'rgba(242,181,58,.25)'; ctx.shadowBlur = 10; ctx.drawImage(logo, r.left, r.top, r.width, r.height); ctx.restore(); }
  ctx.textBaseline = 'middle';
  for (const s of document.querySelectorAll('#chips span')) {
    const r = R(s), cs = getComputedStyle(s); ctx.strokeStyle = cs.color; ctx.lineWidth = 2; rr(ctx, r, r.height / 2); ctx.stroke();
    ctx.fillStyle = cs.color; ctx.font = `700 ${cs.fontSize} "JetBrains Mono", monospace`; ctx.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
    ctx.textAlign = 'center'; ctx.fillText(s.textContent, r.left + r.width / 2 + 1, r.top + r.height / 2 + 1);
  }
  ctx.letterSpacing = '0px';
  const win = R($('#win')), bar = R($('.bar')), board = R($('#board'));
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 20; ctx.fillStyle = '#120d36'; rr(ctx, win, 16); ctx.fill(); ctx.restore();
  ctx.save(); ctx.shadowColor = 'rgba(92,225,255,.25)'; ctx.shadowBlur = 40; ctx.strokeStyle = 'rgba(242,181,58,.45)'; ctx.lineWidth = 2; rr(ctx, { left: win.left - 1, top: win.top - 1, width: win.width + 2, height: win.height + 2 }, 17); ctx.stroke(); ctx.restore();
  const g = ctx.createLinearGradient(0, bar.top, 0, bar.bottom); g.addColorStop(0, '#1a1446'); g.addColorStop(1, '#120d36'); ctx.fillStyle = g; rr(ctx, bar, [16, 16, 0, 0]); ctx.fill();
  for (const i of document.querySelectorAll('.bar i')) { const r = R(i); ctx.fillStyle = getComputedStyle(i).backgroundColor; ctx.beginPath(); ctx.arc(r.left + r.width / 2, r.top + r.height / 2, r.width / 2, 0, 7); ctx.fill(); }
  const tt = $('#title'), tr = R(tt), tcs = getComputedStyle(tt); ctx.fillStyle = '#F5F1EA'; ctx.font = `700 ${tcs.fontSize} "Space Grotesk", sans-serif`; ctx.textAlign = 'center';
  ctx.fillText(tt.textContent, tr.left + tr.width / 2, tr.top + tr.height / 2, tr.width);
  const pg = $('#pg'), pr = R(pg); ctx.fillStyle = '#b9b0d6'; ctx.font = '700 12px "JetBrains Mono", monospace'; ctx.textAlign = 'right'; ctx.fillText(pg.textContent, pr.right, pr.top + pr.height / 2);
  ctx.save(); rr(ctx, board, [0, 0, 16, 16]); ctx.clip(); ctx.drawImage(opts.boardCanvas(), board.left, board.top, board.width, board.height); ctx.restore();
  const f = $('footer'), fr = R(f); ctx.fillStyle = 'rgba(245,241,234,.55)'; ctx.font = `700 ${getComputedStyle(f).fontSize} "JetBrains Mono", monospace`; ctx.letterSpacing = '2px'; ctx.textAlign = 'right'; ctx.fillText(f.textContent.trim(), fr.right, fr.top + fr.height / 2); ctx.letterSpacing = '0px';
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
