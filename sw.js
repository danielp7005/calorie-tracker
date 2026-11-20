// Service worker: keeps the app itself available offline.
// Your food log is NOT stored here — it lives in the browser's storage (see js/store.js).
//
// Update strategy: when online, every app file is fetched fresh from GitHub
// (bypassing the browser's short-term cache), so new versions show up on the next
// launch. The saved copies are only used when you're offline or the network is very slow.
// Keep VERSION in step with APP_VERSION in js/app.js.
const VERSION = 'v1.2.1';
const CACHE = 'calorie-tracker-' + VERSION;
const APP_FILES = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/store.js',
  './js/foods.js',
  './js/voice.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './vendor/zxing.min.js'
];
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(APP_FILES.map((u) =>
        fetch(new Request(u, { cache: 'reload' }))
          .then((res) => (res.ok ? c.put(u, res) : null))
          .catch(() => null) // one missing file must not block the update
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('calorie-tracker-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

function networkFirst(request, cacheKey) {
  const fresh = new Request(request, { cache: 'no-cache' });
  const network = fetch(fresh).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(cacheKey || request, copy)); }
    return res;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS));
  return Promise.race([network, timeout.then(() => caches.match(cacheKey || request))])
    .then((res) => res || network)
    .catch(() => caches.match(cacheKey || request, { ignoreSearch: true }));
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Only handle our own files; food searches go straight to the network.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event.request, './index.html'));
  } else {
    event.respondWith(networkFirst(event.request));
  }
});
