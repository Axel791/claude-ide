// claude-ide service worker: the shell and CDN assets from cache, the API always from the network.
const CACHE = 'claude-ide-v1';
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  const isShell = url.origin === location.origin;
  const isCdn = /cdnjs\.cloudflare\.com|unpkg\.com|fonts\.(googleapis|gstatic)\.com/.test(url.host);
  if (!isShell && !isCdn) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (isShell) {
      // network first for our own files, so an update shows at once; cache when offline
      try { const r = await fetch(e.request); if (r.ok) cache.put(e.request, r.clone()); return r; }
      catch { return (await cache.match(e.request)) || Response.error(); }
    }
    const hit = await cache.match(e.request);
    if (hit) return hit;
    const r = await fetch(e.request); if (r.ok) cache.put(e.request, r.clone()); return r;
  })());
});
