/**
 * sw.js — Service Worker Domestik CI
 * · Pages HTML      : réseau d'abord → repli cache → page hors-ligne
 * · Assets (CSS/JS/icônes) : cache d'abord (rapide même en 2G/3G)
 */
const VERSION = 'v1.1.0';
const STATIC_CACHE = `domestik-static-${VERSION}`;
const PAGE_CACHE = `domestik-pages-${VERSION}`;

const STATIC_ASSETS = [
  '/css/style.css',
  '/js/main.js',
  '/offline.html',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !k.endsWith(VERSION)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;                       // paiements & formulaires : toujours en ligne
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;                 // pas de cache cross-origin (WhatsApp…)

  // Navigations (pages HTML)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(PAGE_CACHE).then(c => c.put(request, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(request)) || caches.match('/offline.html'))
    );
    return;
  }

  // Assets statiques : cache-first puis réseau (et mise à jour du cache)
  event.respondWith(
    caches.match(request).then(hit => hit || fetch(request).then(res => {
      if (res.ok && (url.pathname.startsWith('/css') || url.pathname.startsWith('/js') || url.pathname.startsWith('/icons'))) {
        const copy = res.clone();
        caches.open(STATIC_CACHE).then(c => c.put(request, copy));
      }
      return res;
    }))
  );
});
