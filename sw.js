// Service Worker：预缓存应用外壳 + 离线词典；识别/PDF/Word 组件首次使用时缓存（或在“我的”里一键预缓存）。
const VERSION = '8df4701d30';
const CACHE = 'zizhuxue-' + VERSION;
// 识别/PDF/Word 组件（vendor/ 下按需加载的大文件）放在不随版本变化的缓存里：应用更新后仍可离线使用，不必重新下载 15MB。
const VENDOR = 'zizhuxue-vendor-1';
const isVendor = u => /\/vendor\/(tesseract|pdfjs|mammoth|amrnb)\//.test(u.pathname);
// 本机转写的运行库（jsDelivr 上固定版本的 transformers.js 与 WASM）：首次用时缓存，之后离线可用。模型文件由 transformers.js 自己存进「transformers-cache」。
const ASR = 'zizhuxue-asr-1';
const isAsrLib = u => u.hostname === 'cdn.jsdelivr.net' && /^\/npm\/@huggingface\/transformers@\d/.test(u.pathname);
// 「离线使用」关闭时注册的是 sw.js?online=1：只走网络（每次向服务器确认最新版），不缓存软件代码；没网时显示 offline.html
const ONLINE = new URL(self.location.href).searchParams.has('online');
const OFFPAGE = 'zizhuxue-offpage-1';
self.addEventListener('install', e => {
  if (ONLINE) { e.waitUntil((async () => { const c = await caches.open(OFFPAGE); await c.add(new Request('offline.html', { cache: 'reload' })); self.skipWaiting(); })()); return; }
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
    // 只删本软件的代码缓存（zizhuxue-*）。IndexedDB（材料、卡片）和 transformers-cache（Whisper 模型）从不动
    for (const k of await caches.keys()) if (k.startsWith('zizhuxue-') && (ONLINE ? k !== OFFPAGE : (k !== CACHE && k !== VENDOR && k !== ASR))) await caches.delete(k);
    await self.clients.claim();
  })());
});
// v1.8「分享到自主学」（manifest 的 share_target）：安卓上从别的 App 分享文字 / 链接 / 图片 / 文件过来，浏览器把它 POST 到 ./share-target。
// 收下来放进 zzx-share 缓存（不以 zizhuxue- 开头，更新版本时不会被清掉），然后跳到 #/shared 让用户选怎么用。
const SHARE = 'zzx-share';
async function takeShare(req) {
  try {
    const fd = await req.formData(); const c = await caches.open(SHARE);
    for (const k of await c.keys()) await c.delete(k); // 只保留最新一次分享
    const files = fd.getAll('files').filter(f => f && typeof f === 'object' && f.size > 0).slice(0, 10);
    const meta = { title: String(fd.get('title') || ''), text: String(fd.get('text') || ''), url: String(fd.get('url') || ''), ts: Date.now(), files: files.map((f, i) => ({ i, name: f.name || 'file' + i, type: f.type || '', size: f.size })) };
    await Promise.all(files.map((f, i) => c.put('share/file/' + i, new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream' } }))));
    await c.put('share/meta', new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
    return Response.redirect(new URL('./#/shared', self.registration.scope).href, 303);
  } catch (err) { return Response.redirect(new URL('./#/shared?err=' + encodeURIComponent(err.message || 'x'), self.registration.scope).href, 303); }
}
self.addEventListener('fetch', e => {
  const req = e.request; const url = new URL(req.url);
  if (req.method === 'POST' && url.origin === location.origin && url.pathname === new URL('./share-target', self.registration.scope).pathname) { e.respondWith(takeShare(req)); return; }
  if (ONLINE) {
    if (req.method !== 'GET' || url.origin !== location.origin) return;
    e.respondWith((async () => {
      try { return req.mode === 'navigate' ? await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : await fetch(new Request(req, { cache: 'no-cache' })); }
      catch (err) { if (req.mode === 'navigate') { const p = await caches.match('offline.html', { cacheName: OFFPAGE }); if (p) return p; } throw err; }
    })());
    return;
  }
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

// ———— v1.8 学习提醒：服务器推送 / 通知点击 / 定期后台同步 ————
const ICON = 'icons/icon-192.png';
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data?.text() || '' }; }
  // iOS / Chrome 要求每条推送都显示通知（userVisibleOnly）
  e.waitUntil(self.registration.showNotification(d.title || '自主学', { body: d.body || '来学一会儿英语吧', tag: d.tag || 'zzx-remind', renotify: true, icon: ICON, badge: ICON, data: { url: d.url || './#/' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './#/', self.registration.scope).href;
  e.waitUntil((async () => {
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const c = cs.find(x => x.url.startsWith(self.registration.scope));
    if (c) { await c.focus(); try { await c.navigate(url); } catch { } return; }
    await self.clients.openWindow(url);
  })());
});
// 没有推送服务器时（安卓 Chrome 安装版）：浏览器定期把 SW 叫醒，看看网页排好的提醒有没有到点还没弹的
const idbMeta = (k, v) => new Promise(res => {
  const r = indexedDB.open('zizhuxue'); r.onerror = () => res(null);
  r.onsuccess = () => { try { const db = r.result; const t = db.transaction('meta', v === undefined ? 'readonly' : 'readwrite'); const st = t.objectStore('meta');
    if (v === undefined) { const g = st.get(k); g.onsuccess = () => res(g.result?.value ?? null); g.onerror = () => res(null); } else { st.put({ key: k, value: v }); t.oncomplete = () => res(true); t.onerror = () => res(null); } } catch { res(null); } };
});
async function remindFromPlan(now = Date.now()) {
  const plan = await idbMeta('remindPlan'); if (!plan?.items) return 0;
  const due = plan.items.filter(x => x.at <= now && x.at > now - 2 * 3600e3 && !plan.shown?.[x.date + ':' + x.kind]); if (!due.length) return 0;
  const x = due[due.length - 1];
  await self.registration.showNotification(x.title || '自主学 · 学习提醒', { body: x.body, tag: 'zzx-remind', renotify: true, icon: ICON, badge: ICON, data: { url: './#/' } });
  plan.shown = { ...(plan.shown || {}) }; for (const y of due) plan.shown[y.date + ':' + y.kind] = now; await idbMeta('remindPlan', plan);
  return due.length;
}
self.addEventListener('periodicsync', e => { if (e.tag === 'zzx-remind') e.waitUntil(remindFromPlan()); });
self.addEventListener('message', e => { if (e.data?.type === 'zzx-remind-check') e.waitUntil(remindFromPlan(e.data.now).then(n => e.source?.postMessage({ type: 'zzx-remind-checked', n }))); }); // 测试 / 手动检查用
