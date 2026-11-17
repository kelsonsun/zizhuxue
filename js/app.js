import * as db from './db.js';
import * as ai from './ai.js';
import * as tts from './tts.js';
import { $, $$, esc, toast, sheet, go } from './ui.js';
import { loadSettings, seedIfFirstRun, session, isNativeApp } from './state.js';

import * as tour from './tour.js';
import * as cloud from './cloud.js';
import { mountPill } from './transui.js';
import { job } from './translate.js';
import { APP_VERSION } from './version.js';
const routes = {
  '': () => import('./views/home.js'),
  import: () => import('./views/import.js'),
  draft: () => import('./views/draft.js'),
  library: () => import('./views/library.js'),
  lesson: () => import('./views/lesson.js'),
  book: () => import('./views/book.js'),
  review: () => import('./views/review.js'),
  quiz: () => import('./views/quiz.js'),
  me: () => import('./views/settings.js'),
};
const TABS = [['', '今日', '🏠'], ['import', '导入', '➕'], ['library', '材料库', '📚'], ['review', '复习', '🔁'], ['me', '我的', '👤']];
let cleanup = null, navSeq = 0;
export const onLeave = fn => { cleanup = fn; };

// 路由渲染串行化：快速连续跳转时，旧页面较慢的异步渲染不会覆盖新页面
let chain = Promise.resolve();
// 换页时关掉上一页留下的弹层（否则会挡住新页面）
const closeSheets = () => { document.querySelectorAll('.backdrop').forEach(b => b.remove()); document.body.classList.remove('noscroll'); };
function render() { closeSheets(); const seq = ++navSeq; chain = chain.then(() => doRender(seq)).catch(() => { }); return chain; }
async function doRender(seq) {
  if (seq !== navSeq) return; // 已有更新的跳转，跳过中间态
  const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
  const [name, ...args] = path.split('/');
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  tts.cancel();
  const root = $('#app');
  const loader = routes[name] ?? routes[''];
  const tab = { '': '', import: 'import', draft: 'import', library: 'library', lesson: 'library', book: 'library', quiz: 'library', review: 'review', me: 'me' }[name] ?? '';
  $$('#tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  root.scrollTop = 0; window.scrollTo(0, 0);
  try {
    const mod = await loader();
    if (seq !== navSeq) return;
    root.dataset.view = name || 'home';
    await mod.render(root, args.map(decodeURIComponent), params);
  } catch (e) {
    console.error(e);
    root.innerHTML = `<div class="empty"><p>页面出错了：${esc(e.message)}</p><a class="btn" href="#/">回到首页</a></div>`;
  }
}

function shell() {
  document.body.innerHTML = `<main id="app" tabindex="-1"></main>
  <nav id="tabbar" aria-label="主导航">${TABS.map(([h, t, i]) => `<a href="#/${h}" data-tab="${h}"><span class="ti">${i}</span><span>${t}</span></a>`).join('')}</nav>`;
}

// 全局：未配置AI的按钮——拦截点击（捕获阶段），只提示，不发请求
document.addEventListener('click', e => {
  const b = e.target.closest('.ai-off'); if (!b) return;
  e.stopImmediatePropagation(); e.preventDefault();
  const s = sheet(`<h3>未配置AI，无法生成</h3><p class="muted">AI 功能需要你在「我的 → AI 设置」填入兼容 OpenAI 的接口地址、密钥和模型。<br>没有配置时，本软件不会给出任何假的生成结果；不用 AI 的功能（拆句、离线词典查词、朗读、测验、复习）不受影响。</p><div class="row gap"><button class="btn" data-close>知道了</button><a class="btn primary" href="#/me" data-close>去配置</a></div>`, { cls: 'small' });
}, true);

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); session.install = e; window.dispatchEvent(new Event('installready')); });
window.addEventListener('appinstalled', () => { session.install = null; toast('已安装到主屏幕/桌面，以后点图标就能打开'); });

// 更新完成后告诉用户：已是新版本（版本号来自 package.json，经 tools/build.js 写入 version.js）
function announceVersion() {
  try {
    const prev = localStorage.getItem('zzx.appVersion'); localStorage.setItem('zzx.appVersion', APP_VERSION);
    if (prev && prev !== APP_VERSION) setTimeout(() => toast(`已更新到 v${APP_VERSION}，你的材料和进度都在`, 5000), 600);
  } catch { }
}

// 返回键（安卓客户端由原生层调用；返回 true 表示网页已处理，false 表示可以退出应用）：
// 先关弹层/引导 → 再回上一页 → 在首页时“再按一次退出”。
let backArmed = 0;
window.__zzxBack = () => {
  const sheets = document.querySelectorAll('.backdrop');
  if (sheets.length) { const top = sheets[sheets.length - 1]; (top.querySelector('[data-close]') || top).click(); if (document.body.contains(top)) top.remove(); return true; }
  const tourBtn = document.querySelector('#tSkip, #tourSkip, #tOfferNo, #tDone'); if (tourBtn) { tourBtn.click(); return true; }
  const h = location.hash.replace(/^#\/?/, '');
  if (h && h !== '_') { if (history.length > 1) history.back(); else location.hash = '#/'; backArmed = 0; return true; }
  if (Date.now() - backArmed < 2000) return false;
  backArmed = Date.now(); toast('再按一次返回键退出'); return true;
};

// 自动更新：新版本的 Service Worker 装好后接管页面（不动 IndexedDB 里的数据）。
// 没有在做事（录音、翻译、编辑、复习作答、输入）时自动刷新到新版本；否则在顶部提示，用户点一下再刷新。
function busy() {
  return job.running || !!document.querySelector('.recording, .backdrop, #tour, .tour-modal') || /^#\/(draft|review|import)/.test(location.hash) || !!document.activeElement?.matches?.('input, textarea');
}
function showUpdateBar() {
  if (document.getElementById('updbar')) return;
  const b = document.createElement('div'); b.id = 'updbar'; b.className = 'updbar'; b.innerHTML = '✨ 新版本已就绪（你的数据不受影响）<button class="btn primary mini2" id="updNow">现在刷新</button>';
  document.body.appendChild(b); b.querySelector('#updNow').onclick = () => location.reload();
}
function setupUpdates() {
  // 第一次安装时（页面原本没有 SW 控制）不刷新；之后同一页面里再来的新版本照常更新。
  // （v1.3 修复：以前只看页面打开那一刻有没有 SW，第一次打开后一直不关的页面永远收不到更新）
  let had = !!navigator.serviceWorker.controller, reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!had) { had = true; return; }
    if (reloading) return;
    const apply = () => { if (busy()) { showUpdateBar(); return; } reloading = true; location.reload(); };
    apply();
  });
  navigator.serviceWorker.register('sw.js').then(reg => {
    const check = () => reg.update().catch(() => { });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 30 * 60 * 1000);
  }).catch(e => console.warn('SW', e));
}

async function boot() {
  shell();
  await loadSettings(); await ai.loadConfig(); await seedIfFirstRun();
  window.addEventListener('hashchange', render);
  if ('serviceWorker' in navigator && !isNativeApp()) setupUpdates();
  mountPill();
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  if (db.storageMode === 'memory') toast('提示：此浏览器禁用了本地存储，关闭页面后数据会丢失', 6000);
  await render();
  document.documentElement.dataset.ready = '1';
  announceVersion();
  tour.boot().catch(e => console.warn('tour', e));
  watchKeyboard(); warmOfflineParts();
  // 云同步：未绑定时什么都不做；已绑定则后台自动同步，收到别的设备的改动后刷新当前页（正在做事时不打断）
  cloud.boot().catch(e => console.warn('sync', e));
  addEventListener('zzx-synced', () => { if (!busy() && !location.hash.startsWith('#/me')) render(); });
}
// 手机键盘弹出时（文本框获得焦点）隐藏底部导航栏，避免它被顶到键盘上方挡住输入框
function watchKeyboard() {
  const isText = el => el?.matches?.('textarea, input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]):not([type=button]), [contenteditable=true]');
  document.addEventListener('focusin', e => { if (isText(e.target)) document.body.classList.add('kbd'); });
  document.addEventListener('focusout', () => setTimeout(() => { if (!isText(document.activeElement)) document.body.classList.remove('kbd'); }, 50));
}
// 联网时在后台悄悄缓存 PDF / Word 组件（约 1.8MB），装到主屏后断网也能导入 PDF/Word；
// 截图识别组件较大（约 11MB），不自动下载，首次使用或在「我的 → 离线使用」里手动缓存。省流量模式下不自动下载。
function warmOfflineParts() {
  if (!('serviceWorker' in navigator) || isNativeApp() || navigator.onLine === false || navigator.connection?.saveData) return;
  const run = async () => {
    try {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise(r => { navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }); setTimeout(r, 5000); });
      for (const f of ['vendor/pdfjs/pdf.min.js', 'vendor/pdfjs/pdf.worker.min.js', 'vendor/mammoth/mammoth.browser.min.js']) { const r = await fetch(f); await r.arrayBuffer(); }
      document.documentElement.dataset.warm = '1';
    } catch { }
  };
  (window.requestIdleCallback || (f => setTimeout(f, 3000)))(run, { timeout: 8000 });
}
boot();
