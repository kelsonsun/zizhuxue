// Service Worker：预缓存应用外壳 + 离线词典；识别/PDF/Word 组件首次使用时缓存（或在“我的”里一键预缓存）。
const VERSION = '13515e9989';
const CACHE = 'zizhuxue-' + VERSION;
// 识别/PDF/Word 组件（vendor/ 下按需加载的大文件）放在不随版本变化的缓存里：应用更新后仍可离线使用，不必重新下载 15MB。
const VENDOR = 'zizhuxue-vendor-1';
const isVendor = u => /\/vendor\/(tesseract|pdfjs|mammoth|amrnb)\//.test(u.pathname);
// 本机转写的运行库（jsDelivr 上固定版本的 transformers.js 与 WASM）：首次用时缓存，之后离线可用。模型文件由 transformers.js 自己存进「transformers-cache」。
const ASR = 'zizhuxue-asr-1';
const isAsrLib = u => u.hostname === 'cdn.jsdelivr.net' && /^\/npm\/@huggingface\/transformers@\d/.test(u.pathname);
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const res = await fetch('precache.json', { cache: 'no-store' }); const list = await res.clone().json();
    const c = await caches.open(CACHE);
    await c.addAll(list.files.map(f => new Request(f, { cache: 'reload' })));
    await c.put('precache.json', res); // 离线时「我的 → 关于」也能显示版本号
    self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('zizhuxue-') && k !== CACHE && k !== VENDOR && k !== ASR) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', e => {
  const req = e.request; const url = new URL(req.url);
  if (req.method === 'GET' && isAsrLib(url)) {
    e.respondWith((async () => { const c = await caches.open(ASR); const hit = await c.match(req.url); if (hit) return hit; const res = await fetch(req); if (res.ok) c.put(req.url, res.clone()); return res; })());
    return;
  }
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(isVendor(url) ? VENDOR : CACHE);
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
