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
  let drag = null, lastTap = 0;
  el.addEventListener('pointerdown', e => {
    e.preventDefault(); el.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect(), resize = e.target.classList.contains('grip');
    drag = { id: e.pointerId, resize, x: e.clientX, y: e.clientY, l: r.left, t: r.top, w: r.width };
    const now = performance.now(); if (!resize && now - lastTap < 320) { state.shape = state.shape === 'circle' ? 'rounded' : 'circle'; place(); save(); } lastTap = now;
  });
  el.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (drag.resize) state.w = Math.min(.5, Math.max(.1, (drag.w + dx) / innerWidth));
    else { state.x = (drag.l + dx) / innerWidth; state.y = (drag.t + dy) / innerHeight; }
    place();
  });
  const end = e => { if (drag && e.pointerId === drag.id) { drag = null; save(); } };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}
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
