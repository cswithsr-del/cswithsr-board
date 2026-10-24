// Animated navy tech background (same look as the YouTube template). Draws into #bg; the recorder copies this canvas.
const rnd = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
let bg, b, W = 0, H = 0, dpr = 1, last = 0, getWin;
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const canvas = () => bg;
function size() { dpr = Math.min(devicePixelRatio || 1, 1.5); W = innerWidth; H = innerHeight; bg.width = W * dpr; bg.height = H * dpr; frame(performance.now(), true); }
export function init(el, winFn) { bg = el; b = bg.getContext('2d'); getWin = winFn; addEventListener('resize', size); size(); requestAnimationFrame(loop); }
function loop(now) { requestAnimationFrame(loop); if (now - last < 45 || document.hidden) return; last = now; if (!still) frame(now); }
function frame(now) {
  const t = now / 1000, ph = t / 20 * Math.PI * 2;
  b.setTransform(dpr, 0, 0, dpr, 0, 0);
  const g0 = b.createRadialGradient(W / 2, H * .4, 0, W / 2, H * .4, Math.max(W, H) * .75);
  g0.addColorStop(0, '#0d0838'); g0.addColorStop(.55, '#070321'); g0.addColorStop(1, '#03010f'); b.fillStyle = g0; b.fillRect(0, 0, W, H);
  [[.12, .25, '242,181,58', .32], [.88, .7, '92,225,255', .38], [.5, 1.05, '122,92,255', .45]].forEach(([x, y, c, s], i) => {
    const R = Math.max(W, H) * s / 1.6, cx = x * W + Math.sin(ph + i * 2) * 40, cy = y * H + Math.cos(ph + i * 2) * 28;
    const g = b.createRadialGradient(cx, cy, 0, cx, cy, R); g.addColorStop(0, `rgba(${c},.2)`); g.addColorStop(1, `rgba(${c},0)`); b.fillStyle = g; b.fillRect(cx - R, cy - R, R * 2, R * 2);
  });
  const off = (t / 20 * 48) % 48; b.strokeStyle = 'rgba(92,225,255,.05)'; b.lineWidth = 1; b.beginPath();
  for (let x = off; x < W; x += 48) { b.moveTo(x, 0); b.lineTo(x, H); } for (let y = off; y < H; y += 48) { b.moveTo(0, y); b.lineTo(W, y); } b.stroke();
  const win = getWin(); if (!win || !win.width) return; const ml = win.left, mr = W - win.right;
  for (let i = 0; i < 10; i++) {
    const left = i < 5, k = i % 5, span = win.height / 5, y0 = win.top + span * (k + .5) + (rnd(i) - .5) * 30, mw = left ? ml : mr;
    const xa = left ? 0 : W, xb = left ? mw * .62 : W - mw * .62, xc = left ? ml - 8 : win.right + 8, yb = y0 + (rnd(i + 5) - .5) * span * .5;
    const pts = [[xa, y0], [xb + (left ? -18 : 18), y0], [xb, yb], [xc, yb]];
    b.strokeStyle = 'rgba(92,225,255,.14)'; b.lineWidth = 2; b.beginPath(); b.moveTo(...pts[0]); pts.slice(1).forEach(p => b.lineTo(...p)); b.stroke();
    b.fillStyle = 'rgba(242,181,58,.6)'; b.beginPath(); b.arc(xc, yb, 3.5, 0, 7); b.fill();
    const segs = []; let tot = 0; for (let j = 1; j < pts.length; j++) { const l = Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]); segs.push(l); tot += l; }
    const p = ((t / 20) * (1 + i % 3) + rnd(i + 9)) % 1 * (tot + 120) - 60;
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
  for (let i = 0; i < 14; i++) {
    const left = i % 2 === 0, mw = left ? ml : mr, x = left ? 8 + rnd(i) * Math.max(10, mw - 30) : W - mw + 8 + rnd(i) * Math.max(10, mw - 30);
    const y = H - (((rnd(i + 3) + t / 20) % 1) * (H + 120) - 60); b.fillStyle = i % 3 ? 'rgba(92,225,255,.22)' : 'rgba(242,181,58,.3)';
    (rnd(i * 7) > .5 ? '1011' : '0100').split('').forEach((ch, j) => b.fillText(ch, x, y + j * 15));
  }
}
