// Offline cache: every file of the app is stored on the tablet. Bump VERSION when the app changes.
const VERSION = 'cswithsr-board-v14';
const FILES = [
  './',
  "app.css",
  "fonts/jetbrains-mono-latin-700-normal.woff2",
  "fonts/space-grotesk-latin-500-normal.woff2",
  "fonts/space-grotesk-latin-700-normal.woff2",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/logo.png",
  "icons/maskable-512.png",
  "index.html",
  "js/bg.js",
  "js/board.js",
  "js/cam.js",
  "js/drive.js",
  "js/export.js",
  "js/ide.js",
  "js/main.js",
  "js/pseudo.js",
  "js/pyworker.js",
  "js/rec.js",
  "js/store.js",
  "js/syllabus.js",
  "manifest.webmanifest",
  "vendor/jspdf.umd.min.js",
  "vendor/pdf.min.js",
  "vendor/pdf.worker.min.js",
];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== PYCACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// Python's input(): the code worker waits on /__stdin__ until the app sends what the user typed
const waiting = new Map(), early = new Map();
self.addEventListener('message', e => {
  const d = e.data || {}; if (d.t !== 'stdin') return;
  if (waiting.has(d.id)) { waiting.get(d.id)(d.text); waiting.delete(d.id); } else early.set(d.id, d.text);
});
const PYCACHE = 'cswithsr-python-0.26.4';
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin === location.origin && u.pathname.endsWith('/__stdin__')) {
    const id = u.searchParams.get('id');
    e.respondWith(new Promise(res => { const send = t => res(new Response(t, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } }));
      if (early.has(id)) { send(early.get(id)); early.delete(id); } else waiting.set(id, send); }));
    return;
  }
  if (u.origin === location.origin && u.pathname.includes('/vendor/pyodide/')) {
    // Python is 14 MB, so it is saved the first time it is used rather than at install
    e.respondWith(caches.open(PYCACHE).then(c => c.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res; }))));
    return;
  }
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).catch(() => e.request.mode === 'navigate' ? caches.match('./') : Response.error())));
});
