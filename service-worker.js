const VERSION = '1.0.0';
const CACHE = `kambuz-shell-${VERSION}`;
const SCOPE = self.registration.scope;
const url = path => new URL(path, SCOPE).href;

const SHELL = [
  './',
  './index.html',
  './styles.css?v=1.0.0',
  './app.js?v=1.0.0',
  './config.js?v=1.0.0',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
].map(url);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Кэшируем каждый файл отдельно: временная ошибка одного ресурса
    // не должна ломать установку всего офлайн-режима.
    const results = await Promise.allSettled(
      SHELL.map(async resource => {
        const response = await fetch(new Request(resource, { cache: 'reload' }));
        if (!response.ok) throw new Error(`${response.status} ${resource}`);
        await cache.put(resource, response.clone());
      })
    );

    // Без этих файлов приложение не сможет стартовать офлайн.
    const required = [url('./index.html'), url('./styles.css?v=1.0.0'), url('./app.js?v=1.0.0'), url('./config.js?v=1.0.0')];
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

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  // Для переходов всегда сначала отдаём локальный app shell.
  // Это важно для iOS PWA: сетевой fetch в авиарежиме может долго висеть,
  // из-за чего пользователь видит пустой белый экран.
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      const cached = await cachedShell('./index.html');
      if (cached) {
        event.waitUntil((async () => {
          try {
            const fresh = await fetch(event.request);
            if (fresh.ok) {
              const cache = await caches.open(CACHE);
              await cache.put(url('./index.html'), fresh.clone());
            }
          } catch (_) {}
        })());
        return cached;
      }

      try {
        return await fetch(event.request);
      } catch (_) {
        return new Response(
          '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;padding:32px"><h1>Камбуз</h1><p>Офлайн-кэш ещё не установлен. Один раз открой приложение с интернетом.</p></body></html>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  // Статические файлы — cache first, сеть только для обновления/промаха.
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
