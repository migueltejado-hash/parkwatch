/* ParkWatch Service Worker – App-Shell offline; OCR-Dateien werden im Hintergrund nachgeladen. */
const VERSION = 'pw-v2.10.1';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'data.js', 'manifest.webmanifest',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/leaflet/images/marker-icon.png', 'vendor/leaflet/images/marker-shadow.png',
  'vendor/exifr.js', 'vendor/jspdf.min.js', 'vendor/fa/all.min.css', 'vendor/fa/webfonts/fa-solid-900.woff2', 'vendor/fa/webfonts/fa-brands-400.woff2',
  'icons/icon-192.png', 'icons/apple-touch-icon.png'];
const OCR = ['vendor/tess/tesseract.min.js', 'vendor/tess/worker.min.js', 'vendor/tess/tesseract-core-simd-lstm.wasm.js', 'vendor/tess/tesseract-core-lstm.wasm.js', 'vendor/tess/lang/deu.traineddata.gz'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    // cache:'reload' umgeht den HTTP-Cache des Browsers (GitHub Pages: max-age=600) – sonst landen alte Dateien unter der neuen Version im Cache
    await Promise.all(SHELL.map(async (u) => { const r = await fetch(new Request(u, { cache: 'reload' })); if (!r.ok) throw new Error(u + ' ' + r.status); await c.put(u, r); }));
    self.skipWaiting();
    // OCR im Hintergrund (Fehler egal – wird bei Bedarf online nachgeladen)
    OCR.forEach((u) => fetch(new Request(u, { cache: 'reload' })).then((r) => r.ok && c.put(u, r)).catch(() => {}));
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => { for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k); await self.clients.claim(); })());
});
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;                 // Karten-Kacheln, Nominatim, Anthropic: nie cachen
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req.url, { cache: 'no-cache' }).then((r) => { if (r && r.ok) cache.put(req, r.clone()); return r; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }                  // stale-while-revalidate
    return (await net) || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
  })());
});
