// Floating camera window: drag to move, corner handle to resize, double-tap to switch shape.
import * as store from './store.js';
let el, video, stream = null, toast;
export const state = { on: false, x: .78, y: .66, w: .19, shape: 'rounded', mirror: true };
export const video$ = () => video;
export const isOn = () => state.on && !!stream;

export async function init(o) {
  toast = o.toast; el = o.el; video = el.querySelector('video');
  Object.assign(state, (await store.get('kv', 'cam')) || {}, { on: false });
  place();
  addEventListener('resize', place);
  // one finger/pen drags, the corner handle or two fingers resize, double-tap switches shape
  const pts = new Map(); let drag = null, lastTap = 0;
  el.addEventListener('pointerdown', e => {
    e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch (_) {} pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = el.getBoundingClientRect();
    if (pts.size === 2) { const [p1, p2] = [...pts.values()]; drag = { pinch: true, d0: Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1, w0: state.w, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; return; }
    const resize = e.target.classList.contains('grip');
    drag = { id: e.pointerId, resize, x: e.clientX, y: e.clientY, l: r.left, t: r.top, w: r.width };
    const now = performance.now(); if (!resize && now - lastTap < 320) { state.shape = state.shape === 'circle' ? 'rounded' : 'circle'; place(); save(); } lastTap = now;
  });
  el.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId) || !drag) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (drag.pinch) {
      if (pts.size < 2) return; const [p1, p2] = [...pts.values()]; const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      state.w = Math.min(.5, Math.max(.08, drag.w0 * d / drag.d0)); const w = state.w * innerWidth, h = state.shape === 'circle' ? w : w * 3 / 4;
      state.x = (drag.cx - w / 2) / innerWidth; state.y = (drag.cy - h / 2) / innerHeight; place(); return;
    }
    if (e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (drag.resize) state.w = Math.min(.5, Math.max(.08, (drag.w + dx) / innerWidth));
    else { state.x = (drag.l + dx) / innerWidth; state.y = (drag.t + dy) / innerHeight; }
    place();
  });
  const end = e => { pts.delete(e.pointerId); if (!pts.size && drag) { drag = null; save(); } else if (drag && drag.pinch && pts.size < 2) { drag = null; save(); } };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}
export function setSize(w) { state.w = w; place(); save(); }
function save() { store.put('kv', 'cam', { x: state.x, y: state.y, w: state.w, shape: state.shape, mirror: state.mirror }).catch(() => {}); }
export function setShape(s) { state.shape = s; place(); save(); }
export function setMirror(m) { state.mirror = m; place(); save(); }
function place() {
  const w = state.w * innerWidth, h = state.shape === 'circle' ? w : w * 3 / 4;
  state.x = Math.min(Math.max(state.x, 0), 1 - w / innerWidth); state.y = Math.min(Math.max(state.y, 0), 1 - h / innerHeight);
  Object.assign(el.style, { left: state.x * innerWidth + 'px', top: state.y * innerHeight + 'px', width: w + 'px', height: h + 'px' });
  el.classList.toggle('circle', state.shape === 'circle');
  video.style.transform = state.mirror ? 'scaleX(-1)' : 'none';
}
export async function toggle() {
  if (stream) { stop(); return false; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false });
    video.srcObject = stream; await video.play().catch(() => {});
    state.on = true; el.hidden = false; place(); return true;
  } catch (e) {
    toast(e.name === 'NotReadableError' ? 'The camera is busy. Turn the camera off in Zoom, then try again.' : 'Camera blocked. Allow camera access for this app in Android settings.');
    return false;
  }
}
export function stop() { if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; state.on = false; video.srcObject = null; el.hidden = true; }
