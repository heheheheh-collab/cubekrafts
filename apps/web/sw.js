// Cold Trail service worker.
// Goal: make the app installable (PWA / Play Store TWA) and let the shell load
// instantly, WITHOUT ever interfering with live gameplay. All /api traffic —
// including the SSE event stream — bypasses the worker entirely and goes
// straight to the network, so real-time multiplayer is never cached or stalled.

const CACHE = 'coldtrail-shell-v1';
const SHELL = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/main.js',
  '/js/api.js',
  '/js/util.js',
  '/js/views/auth.js',
  '/js/views/home.js',
  '/js/views/lobby.js',
  '/js/views/game.js',
  '/js/views/tutorial.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never touch the API or anything cross-origin — let the network handle it.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (request.method !== 'GET') return;

  // App navigations: try network first (fresh HTML), fall back to cached shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html')),
    );
    return;
  }

  // Static assets: serve from cache, fall back to network and cache the result.
  event.respondWith(
    caches.match(request).then((hit) => hit || fetch(request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(request, copy)); }
      return res;
    })),
  );
});
