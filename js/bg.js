// Animated navy tech background (same look as the YouTube template). Draws into #bg; the recorder copies this canvas.
const rnd = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
let bg, b, W = 0, H = 0, dpr = 1, last = 0, getWin;
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const canvas = () => bg;
function size() { dpr = 1; W = innerWidth; H = innerHeight; bg.width = W * dpr; bg.height = H * dpr; frame(performance.now(), true); }
export function init(el, winFn) { bg = el; b = bg.getContext('2d'); getWin = winFn; addEventListener('resize', size); size(); requestAnimationFrame(loop); }
// about 12 frames a second keeps the background moving but leaves the tablet free for writing and screen sharing
function loop(now) { requestAnimationFrame(loop); if (now - last < 80 || document.hidden) return; last = now; if (!still) frame(now); }
function frame(now) {
  b.setTransform(dpr, 0, 0, dpr, 0, 0);
  const win = getWin(); paint(b, W, H, now / 1000, win && win.width ? [win] : []);
}
// Paints the background at any size. rects = the windows on it (left to right); circuit traces run from the
// edges into them and between neighbours, and binary rain falls in the gaps. The recorder calls this too.
export function paintInto(ctx, w, h, rects, t = performance.now() / 1000) { paint(ctx, w, h, still ? 0 : t, rects); }
function paint(b, W, H, t, rects) {
  const ph = t / 20 * Math.PI * 2;
  const g0 = b.createRadialGradient(W / 2, H * .4, 0, W / 2, H * .4, Math.max(W, H) * .75);
  g0.addColorStop(0, '#0d0838'); g0.addColorStop(.55, '#070321'); g0.addColorStop(1, '#03010f'); b.fillStyle = g0; b.fillRect(0, 0, W, H);
  [[.12, .25, '242,181,58', .32], [.88, .7, '92,225,255', .38], [.5, 1.05, '122,92,255', .45]].forEach(([x, y, c, s], i) => {
    const R = Math.max(W, H) * s / 1.6, cx = x * W + Math.sin(ph + i * 2) * 40, cy = y * H + Math.cos(ph + i * 2) * 28;
    const g = b.createRadialGradient(cx, cy, 0, cx, cy, R); g.addColorStop(0, `rgba(${c},.2)`); g.addColorStop(1, `rgba(${c},0)`); b.fillStyle = g; b.fillRect(cx - R, cy - R, R * 2, R * 2);
  });
  const off = (t / 20 * 48) % 48; b.strokeStyle = 'rgba(92,225,255,.05)'; b.lineWidth = 1; b.beginPath();
  for (let x = off; x < W; x += 48) { b.moveTo(x, 0); b.lineTo(x, H); } for (let y = off; y < H; y += 48) { b.moveTo(0, y); b.lineTo(W, y); } b.stroke();
  if (!rects.length) return;
  rects = [...rects].sort((a, c) => a.left - c.left);
  // gaps: [left neighbour or edge, right neighbour or edge]
  const gaps = []; for (let i = 0; i <= rects.length; i++) gaps.push([rects[i - 1] || null, rects[i] || null]);
  let n = 0;
  gaps.forEach(([A, B], gi) => {
    const x0 = A ? A.right : 0, x1 = B ? B.left : W, mw = x1 - x0; if (mw < 12) return;
    const ref = B || A, span = ref.height / 5;
    for (let k = 0; k < 5; k++, n++) {
      const i = n, y0 = ref.top + span * (k + .5) + (rnd(i) - .5) * 30, yb = y0 + (rnd(i + 5) - .5) * span * .5;
      let pts;
      if (!A) { const xb = mw * .62; pts = [[0, y0], [xb - 18, y0], [xb, yb], [x1 - 8, yb]]; }
      else if (!B) { const xb = W - mw * .62; pts = [[W, y0], [xb + 18, y0], [xb, yb], [x0 + 8, yb]]; }
      else { const xm = x0 + mw * (.35 + rnd(i + 2) * .3), ya = A.top + A.height / 5 * (k + .5) + (rnd(i) - .5) * 20; pts = [[x0 + 8, ya], [xm - 10, ya], [xm + 10, yb], [x1 - 8, yb]]; }
      b.strokeStyle = 'rgba(92,225,255,.14)'; b.lineWidth = 2; b.beginPath(); b.moveTo(...pts[0]); pts.slice(1).forEach(p => b.lineTo(...p)); b.stroke();
      b.fillStyle = 'rgba(242,181,58,.6)'; const end = pts[pts.length - 1]; b.beginPath(); b.arc(end[0], end[1], 3.5, 0, 7); b.fill();
      if (A && B) { b.beginPath(); b.arc(pts[0][0], pts[0][1], 3.5, 0, 7); b.fill(); }
      const segs = []; let tot = 0; for (let j = 1; j < pts.length; j++) { const l = Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]); segs.push(l); tot += l; }
      let p = ((t / 20) * (1 + i % 3) + rnd(i + 9)) % 1 * (tot + 120) - 60; if (A && B && k % 2) p = tot - p;
      b.strokeStyle = i % 2 ? '#5CE1FF' : '#F2B53A'; b.lineWidth = 3; b.lineCap = 'round'; b.beginPath();
      let acc = 0, started = false;
      for (let j = 1; j < pts.length; j++) {
        const l = segs[j - 1], a = Math.max(p - 30, acc), e = Math.min(p + 30, acc + l);
        if (e > a) { const f0 = (a - acc) / l, f1 = (e - acc) / l, P0 = pts[j - 1], P1 = pts[j];
          const ax = P0[0] + (P1[0] - P0[0]) * f0, ay = P0[1] + (P1[1] - P0[1]) * f0;
          if (!started) { b.moveTo(ax, ay); started = true; } else b.lineTo(ax, ay);
          b.lineTo(P0[0] + (P1[0] - P0[0]) * f1, P0[1] + (P1[1] - P0[1]) * f1); }
        acc += l;
      }
      b.globalAlpha = .85; b.stroke(); b.globalAlpha = 1;
    }
    b.font = '700 13px "JetBrains Mono", monospace';
    for (let j = 0; j < 7; j++) {
      const i = gi * 7 + j, x = x0 + 8 + rnd(i * 2 + (A ? 1 : 0)) * Math.max(10, mw - 30);
      const y = H - (((rnd(i + 3) + t / 20) % 1) * (H + 120) - 60); b.fillStyle = i % 3 ? 'rgba(92,225,255,.22)' : 'rgba(242,181,58,.3)';
      (rnd(i * 7) > .5 ? '1011' : '0100').split('').forEach((ch, q) => b.fillText(ch, x, y + q * 15));
    }
  });
}
