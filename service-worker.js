const CACHE='kambuz-v0.4.4';
const CORE=[
  './',
  './index.html',
  './styles.css?v=0.4.4',
  './app.js?v=0.4.4',
  './config.js?v=0.4.4',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    // Один временно недоступный файл не должен ломать установку PWA целиком.
    await Promise.allSettled(CORE.map(url=>cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;

  if(event.request.mode==='navigate'){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE);
      const cached=await cache.match('./index.html') || await cache.match('./');
      if(cached)return cached;
      try{
        const response=await fetch(event.request);
        if(response.ok)await cache.put('./index.html',response.clone());
        return response;
      }catch{
        return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;padding:32px"><h2>Камбуз</h2><p>Первый запуск нужно один раз выполнить с интернетом.</p></body>',{headers:{'Content-Type':'text/html; charset=utf-8'}});
      }
    })());
    return;
  }

  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const cached=await cache.match(event.request);
    if(cached)return cached;
    try{
      const response=await fetch(event.request);
      if(response.ok)await cache.put(event.request,response.clone());
      return response;
    }catch{
      return new Response('',{status:503,statusText:'Offline'});
    }
  })());
});
