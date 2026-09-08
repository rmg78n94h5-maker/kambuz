const VERSION = '2.1.5';
const CACHE = `kambuz-shell-${VERSION}`;
const SCOPE = self.registration.scope;
const url = path => new URL(path, SCOPE).href;
const SHELL = [
  './','./index.html','./styles.css?v=1.2.6','./app.js?v=1.2.7','./config.js?v=1.2.4',
  './auth-addon.js?v=2.1.1','./merge-tombstone-addon.js?v=2.0.2','./local-ops-sanitizer.js?v=1.9.1',
  './classification-addon.js?v=1.8.0','./sync-resilience-addon.js?v=1.2.2',
  './offline-receipt-addon.js?v=1.3.2','./inventory-addon.js?v=1.4.0',
  './duplicate-cleanup-addon.js?v=1.5.0','./bulk-writeoff-addon.js?v=1.6.0',
  './imo-report-addon.js?v=1.8.0','./item-card-addon.js?v=1.9.5',
  './average-consumption-addon.js?v=1.9.4','./food-cost-addon.js?v=2.1.4',
  './sync-queue-ui-addon.js?v=1.2.4','./version-addon.js?v=2.1.5',
  './manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'
].map(url);

self.addEventListener('install', event => {
  event.waitUntil((async()=>{
    const cache = await caches.open(CACHE);
    await Promise.allSettled(SHELL.map(async resource => {
      const response = await fetch(new Request(resource,{cache:'reload'}));
      if(response?.ok) await cache.put(resource,response.clone());
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async()=>{
    // Старые кэши не удаляем сразу: на слабой связи они служат запасным офлайн-слоем,
    // пока новый кэш дозаполняется в фоне.
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if(event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

async function currentCached(request){
  const cache = await caches.open(CACHE);
  return (await cache.match(request)) || null;
}

async function newestFallback(request){
  const keys = (await caches.keys()).filter(k=>k.startsWith('kambuz-shell-')).reverse();
  for(const key of keys){
    const cache = await caches.open(key);
    const hit = (await cache.match(request)) || (await cache.match(request,{ignoreSearch:true}));
    if(hit) return hit;
  }
  return null;
}

function delay(ms){return new Promise(resolve=>setTimeout(()=>resolve(null),ms))}

self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  const u = new URL(event.request.url);
  if(u.origin !== self.location.origin) return;

  if(event.request.mode === 'navigate'){
    const network = (async()=>{
      try{
        const fresh = await fetch(event.request,{cache:'no-store'});
        if(fresh?.ok){
          const cache = await caches.open(CACHE);
          await cache.put(url('./index.html'),fresh.clone());
          return fresh;
        }
      }catch{}
      return null;
    })();

    // Даже если связь медленная, не обрываем загрузку: она обновит кэш в фоне.
    event.waitUntil(network.then(()=>{}).catch(()=>{}));
    event.respondWith((async()=>{
      const fresh = await Promise.race([network,delay(7000)]);
      if(fresh) return fresh;

      const cached = await currentCached(url('./index.html')) || await newestFallback(url('./index.html'));
      if(cached) return cached;

      const late = await network;
      if(late) return late;

      return new Response('<h1>Камбуз</h1><p>Один раз открой приложение с интернетом.</p>',{
        headers:{'Content-Type':'text/html; charset=utf-8'}
      });
    })());
    return;
  }

  event.respondWith((async()=>{
    const exact = await currentCached(event.request);
    if(exact) return exact;

    const network = (async()=>{
      try{
        const fresh = await fetch(event.request,{cache:'no-store'});
        if(fresh?.ok){
          const cache = await caches.open(CACHE);
          await cache.put(event.request,fresh.clone());
          return fresh;
        }
      }catch{}
      return null;
    })();

    const fallback = await newestFallback(event.request);
    if(fallback){
      event.waitUntil(network.then(()=>{}).catch(()=>{}));
      return fallback;
    }

    const fresh = await network;
    return fresh || new Response('',{status:503});
  })());
});
