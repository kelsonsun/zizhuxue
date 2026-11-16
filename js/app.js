import * as db from './db.js';
import * as ai from './ai.js';
import * as tts from './tts.js';
import { $, $$, esc, toast, sheet, go } from './ui.js';
import { loadSettings, seedIfFirstRun, session } from './state.js';

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
function render() { const seq = ++navSeq; chain = chain.then(() => doRender(seq)).catch(() => { }); return chain; }
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

async function boot() {
  shell();
  await loadSettings(); await ai.loadConfig(); await seedIfFirstRun();
  window.addEventListener('hashchange', render);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  if (db.storageMode === 'memory') toast('提示：此浏览器禁用了本地存储，关闭页面后数据会丢失', 6000);
  await render();
  document.documentElement.dataset.ready = '1';
}
boot();
