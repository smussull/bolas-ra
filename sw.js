// Service worker: guarda todos los archivos del juego para que funcione sin internet.
// Al cambiar cualquier archivo del juego, sube la versión para que las gafas descarguen la nueva.
const VERSION = 'bolas-ra-v6';
const FILES = ['./', 'index.html', 'main.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'vendor/three/three.module.js', 'vendor/three/addons/environments/RoomEnvironment.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())));
// primero la red (para recibir actualizaciones) y, sin conexión, la copia guardada
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok && new URL(e.request.url).origin === location.origin) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(e.request, cp)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
