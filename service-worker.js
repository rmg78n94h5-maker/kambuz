const VERSION = '1.2.4';
const CACHE = `kambuz-shell-${VERSION}`;
const SCOPE = self.registration.scope;
const url = path => new URL(path, SCOPE).href;

const SHELL = [
  './',
  './index.html',
  './styles.css?v=1.2.4',
  './app.js?v=1.2.4',
  './config.js?v=1.2.4',
  './sync-resilience-addon.js?v=1.2.2',
  './offline-receipt-addon.js?v=1.2.1',
  './sync-queue-ui-addon.js?v=1.2.4',
  './version-addon.js?v=1.2.4',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
].map(url);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const results = await Promise.allSettled(
      SHELL.map(async resource => {
        const response = await fetch(new Request(resource, { cache: 'reload' }));
        if (!response.ok) throw new Error(`${response.status} ${resource}`);
        await cache.put(resource, response.clone());
      })
    );

    const required = [
      url('./index.html'),
      url('./styles.css?v=1.2.4'),
      url('./app.js?v=1.2.4'),
      url('./config.js?v=1.2.4'),
      url('./offline-receipt-addon.js?v=1.2.1'),
      url('./sync-queue-ui-addon.js?v=1.2.4'),
      url('./version-addon.js?v=1.2.4')
    ];

    for (const resource of required) {
      if (!(await cache.match(resource))) {
        const failed = results.filter(r => r.status === 'rejected').map(r => r.reason?.message).join('; ');
        throw new Error(`Не удалось создать офлайн-кэш: ${resource}. ${failed}`);
      }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function cachedShell(path) {
  const cache = await caches.open(CACHE);
  return (await cache.match(url(path))) || (await cache.match(url(path), { ignoreSearch: true }));
}

async function fetchWithTimeout(request, ms = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(request, { cache: 'no-store', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const fresh = await fetchWithTimeout(event.request, 2500);
        if (fresh && fresh.ok) {
          await cache.put(url('./index.html'), fresh.clone());
          return fresh;
        }
      } catch (_) {}

      const cached = await cachedShell('./index.html');
      if (cached) return cached;

      return new Response(
        '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;padding:32px"><h1>Камбуз</h1><p>Офлайн-кэш ещё не установлен. Один раз открой приложение с интернетом.</p></body></html>',
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = (await cache.match(event.request)) || (await cache.match(event.request, { ignoreSearch: true }));
    if (cached) return cached;

    try {
      const fresh = await fetch(event.request);
      if (fresh.ok) await cache.put(event.request, fresh.clone());
      return fresh;
    } catch (_) {
      return new Response('', { status: 503, statusText: 'Offline' });
    }
  })());
});