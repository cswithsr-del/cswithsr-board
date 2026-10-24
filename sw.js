// Offline cache: every file of the app is stored on the tablet. Bump VERSION when the app changes.
const VERSION = 'cswithsr-board-v9';
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
  "js/main.js",
  "js/rec.js",
  "js/store.js",
  "js/syllabus.js",
  "manifest.webmanifest",
  "vendor/jspdf.umd.min.js",
  "vendor/pdf.min.js",
  "vendor/pdf.worker.min.js",
];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).catch(() => e.request.mode === 'navigate' ? caches.match('./') : Response.error())));
});
