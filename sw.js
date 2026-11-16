// Service Worker：预缓存应用外壳 + 离线词典；识别/PDF/Word 组件首次使用时缓存（或在“我的”里一键预缓存）。
const VERSION = '829f49dcc2';
const CACHE = 'zizhuxue-' + VERSION;
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const list = await (await fetch('precache.json', { cache: 'no-store' })).json();
    const c = await caches.open(CACHE);
    await c.addAll(list.files.map(f => new Request(f, { cache: 'reload' })));
    self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('zizhuxue-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', e => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    if (req.mode === 'navigate') { const idx = await c.match('index.html'); if (idx) return idx; }
    try {
      const res = await fetch(req);
      if (res.ok && res.status === 200) c.put(req, res.clone());
      return res;
    } catch (err) {
      if (req.mode === 'navigate') { const idx = await c.match('index.html'); if (idx) return idx; }
      throw err;
    }
  })());
});
