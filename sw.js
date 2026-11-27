// Service worker: guarda todos los archivos del juego para que funcione sin internet.
// Al cambiar cualquier archivo del juego, sube la versión para que las gafas descarguen la nueva.
const VERSION = 'bolas-ra-v10';
const FILES = ['./', 'index.html', 'main.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'vendor/three/three.module.js', 'vendor/three/addons/environments/RoomEnvironment.js'];
const NET_TIMEOUT = 2500;   // ms: si la red no contesta (wifi sin internet), se usa la copia guardada

self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())));

// Primero la red (para recibir actualizaciones); sin conexión o si tarda, la copia guardada.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cached = caches.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(r => {
      if (r.ok) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(e.request, cp)); }
      return r;
    });
    const timeout = new Promise(res => setTimeout(() => res(null), NET_TIMEOUT));
    try {
      const r = await Promise.race([net, timeout]);
      if (r) return r;
    } catch (err) { /* sin conexión */ }
    return (await cached) || net;   // copia guardada; si no la hay, se espera a la red
  })());
});
