const PREFIX = 'pocket-partner-shell-';
const CACHE = PREFIX + (self.__POCKET_VERSION || 'dev');
const BASE = '/pocket-partner/';
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(self.__POCKET_PRECACHE || [BASE, BASE + 'icon.svg'])),
  );
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    !url.pathname.startsWith(BASE) ||
    url.pathname.startsWith(BASE + 'api/')
  )
    return;
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((c) => c.put(BASE, copy));
          }
          return response;
        })
        .catch(() => caches.match(BASE)),
    );
    return;
  }
  if (
    url.pathname.startsWith(BASE + 'assets/') ||
    url.pathname.startsWith(BASE + 'fonts/') ||
    url.pathname === BASE + 'icon.svg'
  )
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              void caches.open(CACHE).then((c) => c.put(request, copy));
            }
            return response;
          }),
      ),
    );
});
