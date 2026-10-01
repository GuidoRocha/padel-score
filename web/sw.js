// Offline support. The app is cached as one versioned bundle so the ES modules always come from the
// same release (mixing versions breaks module linking). Bump VERSION on every deploy: the new worker
// downloads the whole bundle in the background and the next launch uses it.
const VERSION = 'padel-v7';
const ASSETS = [
  './',
  'index.html',
  'css/styles.css',
  'js/app.js',
  'js/scoring.js',
  'js/storage.js',
  'js/watch.js',
  'js/feedback.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];
// On the development machine always go to the network so edits show up immediately.
const DEV = ['localhost', '127.0.0.1'].includes(self.location.hostname);

self.addEventListener('install', (event) => {
  // cache: 'reload' skips the HTTP cache so a stale file never ends up in the new bundle.
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })))),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (DEV || request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached =
        request.mode === 'navigate'
          ? await cache.match('index.html')
          : await cache.match(request, { ignoreSearch: true });
      return cached ?? fetch(request);
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((wins) => wins[0]?.focus() ?? self.clients.openWindow('./#/partido')),
  );
});
