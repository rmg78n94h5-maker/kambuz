const VERSION = '2.4.1-impa-visuals-0.3.6';
const CACHE = `kambuz-shell-${VERSION}`;
const SCOPE = self.registration.scope;
const url = path => new URL(path, SCOPE).href;

const CORE = [
  './','./index.html','./styles.css?v=1.2.6','./maritime-theme.css?v=0.7.1','./impa-catalog.css?v=0.3.5','./app.js?v=1.4.7','./config.js?v=1.2.4',
  './auth-addon.js?v=2.1.2','./merge-tombstone-addon.js?v=2.0.2','./local-ops-sanitizer.js?v=1.9.1',
  './classification-addon.js?v=1.8.0','./sync-resilience-addon.js?v=1.2.2','./impa-data.js?v=0.3.6','./impa-catalog-addon.js?v=0.3.5',
  './offline-receipt-addon.js?v=1.3.2','./inventory-addon.js?v=1.4.0',
  './duplicate-cleanup-addon.js?v=1.5.0','./bulk-writeoff-addon.js?v=1.6.0',
  './imo-report-addon.js?v=1.8.2','./item-card-addon.js?v=1.9.8',
  './food-cost-addon.js?v=2.3.1','./sync-queue-ui-addon.js?v=1.2.4',
  './version-addon.js?v=2.4.1','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'
].map(url);

const PDF_ASSETS = [
  'https://cdn.jsdelivr.net/npm/pdfmake@0.2.23/build/pdfmake.min.js',
  'https://cdn.jsdelivr.net/npm/pdfmake@0.2.23/build/vfs_fonts.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
];

async function fetchAndCache(cache, resource){
  const response = await fetch(new Request(resource,{cache:'reload'}));
  if(!response || !response.ok) throw new Error(`Failed to cache ${resource}: ${response?.status || 'network'}`);
  await cache.put(resource,response.clone());
}

self.addEventListener('install', event => {
  event.waitUntil((async()=>{
    const cache = await caches.open(CACHE);

    // Core shell is atomic: a new worker does not activate unless every
    // local app asset for this release is available.
    await Promise.all(CORE.map(resource=>fetchAndCache(cache,resource)));

    // PDF support is useful offline, but it must never block the app update.
    await Promise.allSettled(PDF_ASSETS.map(resource=>fetchAndCache(cache,resource)));

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async()=>{
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key=>key.startsWith('kambuz-shell-') && key!==CACHE)
      .map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if(event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

async function currentCached(request){
  const cache = await caches.open(CACHE);
  return (await cache.match(request)) || (await cache.match(request,{ignoreSearch:true})) || null;
}

function delay(ms){return new Promise(resolve=>setTimeout(()=>resolve(null),ms))}

self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;

  const u = new URL(event.request.url);
  const isLocal = u.origin === self.location.origin;
  const isPdfAsset = PDF_ASSETS.includes(u.href);
  if(!isLocal && !isPdfAsset) return;

  if(isLocal && event.request.mode === 'navigate'){
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

    event.waitUntil(network.then(()=>{}).catch(()=>{}));
    event.respondWith((async()=>{
      const fresh = await Promise.race([network,delay(7000)]);
      if(fresh) return fresh;

      const cached = await currentCached(url('./index.html'));
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
    const cached = await currentCached(event.request);
    if(cached) return cached;

    try{
      const fresh = await fetch(event.request,{cache:'no-store'});
      if(fresh?.ok){
        const cache = await caches.open(CACHE);
        await cache.put(event.request,fresh.clone());
      }
      return fresh;
    }catch{
      return new Response('',{status:503});
    }
  })());
});