// 新手引导：带高亮指向的分步交互引导，带用户真做一遍：导入一段 → 学一句 → 收藏生词 → 做一题复习 → 装到主屏。
// 进度存本机（meta.tour），刷新后接着走；随时可跳过；「我的」里可重新观看。
import * as db from './db.js';
import { session, isNativeApp } from './state.js';
import { $, esc } from './ui.js';

const H = () => location.hash || '#/';
const vis = el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
const firstWord = () => [...document.querySelectorAll('#sents .sent .en .w')].find(w => w.textContent.length >= 5) || $('#sents .sent .en .w');
export const STEPS = [
  { id: 'import-tab', part: '① 导入一段', target: () => $('#tabbar a[data-tab="import"]'), text: '先把你自己的内容放进来。点下面的「导入」。', done: () => H().startsWith('#/import') },
  { id: 'example', part: '① 导入一段', route: /^#\/import/, target: () => $('#ex') || $('.seg a[href="#/import?m=paste"]'), text: '可以粘贴你自己遇到的英文或中英对话、字幕，也能传文件、截图。这次先点「填入示例」试试。', done: () => !!$('#txt')?.value.trim() },
  { id: 'split', part: '① 导入一段', route: /^#\/import/, target: () => $('#go'), text: '点「拆句预览」：自动拆成一句一句，中英配好对。', done: () => H().startsWith('#/draft') },
  { id: 'save', part: '① 导入一段', route: /^#\/draft/, target: () => $('#save'), text: '每一句都可以改、合并、删除。没问题就点「保存为课程」。', done: () => H().startsWith('#/lesson/') },
  { id: 'play', part: '② 学一句', route: /^#\/lesson\//, target: () => $('#sents .sent [data-play]'), text: '点 ▶ 听这一句的发音（顶部还能调语速、循环；「练习」里可以跟读打分）。', click: true },
  { id: 'word', part: '③ 收藏生词', route: /^#\/lesson\//, target: firstWord, text: '点句子里的任意一个词，看它的音标、多个词义和你原句里的用法。', done: () => vis($('#wsave')) },
  { id: 'star', part: '③ 收藏生词', target: () => $('#wsave'), text: '点「收藏」：这个词会带着你的原句进入复习。', click: true },
  { id: 'review-tab', part: '④ 做一题复习', target: () => $('#tabbar a[data-tab="review"]'), text: '去「复习」。复习就是练习：按遗忘曲线挑内容，由易到难出题。', done: () => H().startsWith('#/review') },
  { id: 'review-go', part: '④ 做一题复习', route: /^#\/review/, target: () => $('#go'), text: '这是今天的练习顺序（易→难，最难的在最后）。点「开始练习」。', done: () => !!$('.ansmode') },
  { id: 'answer', part: '④ 做一题复习', route: /^#\/review/, place: 'top', target: () => [$('.ansmode'), $('#ansbox'), $('#show')], text: '每题都可以「说出来」（录音+识别）或「写出来」。答一下；不会就点「不会，看答案」。', done: () => !!$('.rates4') },
  { id: 'rate', part: '④ 做一题复习', route: /^#\/review/, place: 'top', target: () => [$('.rates4'), $('#next')], text: '看判分，然后点一个评分（或「下一题」）。评分会决定这题下次什么时候再出现。', done: () => !$('.rates4') },
];
let state = null, timer = null, overlay = null, clickBound = null;

export async function shouldAutoStart() {
  if (localStorage.getItem('zzx.noAutoTour') === '1') return false; // 自动化测试用：不自动弹出
  const t = await db.meta.get('tour', null); if (t) return t.status === 'active' ? 'resume' : false;
  const mats = await db.materials.all(); const cards = await db.cards.all();
  return (!mats.some(m => !m.sample) && !cards.length) ? 'new' : 'offer';
}
const save = () => db.meta.set('tour', state);

export async function boot() {
  const a = await shouldAutoStart();
  if (a === 'new') welcome();
  else if (a === 'resume') { state = await db.meta.get('tour'); run(); }
  else if (a === 'offer') offer();
}
function offer() {
  const bar = document.createElement('div'); bar.className = 'tour-offer'; bar.innerHTML = `<span>👋 新增「新手引导」：2 分钟带你走一遍导入→学习→复习。</span><button class="btn primary mini2" id="tOfferGo">看看</button><button class="mini" id="tOfferNo">不用了</button>`;
  document.body.appendChild(bar);
  bar.querySelector('#tOfferGo').onclick = () => { bar.remove(); start(); };
  bar.querySelector('#tOfferNo').onclick = async () => { bar.remove(); await db.meta.set('tour', { status: 'skipped', step: 0 }); };
}
function modal(html, buttons) {
  stop(false);
  const m = document.createElement('div'); m.className = 'tour-modal'; m.id = 'tourModal';
  m.innerHTML = `<div class="tour-card" role="dialog" aria-modal="true">${html}<div class="row gap">${buttons.map(([id, t, cls]) => `<button class="btn ${cls || ''}" id="${id}">${t}</button>`).join('')}</div></div>`;
  document.body.appendChild(m); return m;
}
function welcome() {
  const m = modal(`<div class="big-emoji">👋</div><h3>欢迎使用「自主学」</h3><p>用<b>你自己</b>需要的、喜欢的、真实遇到的内容学英语。</p>
    <p class="muted">接下来带你<b>真做一遍</b>（约 2 分钟）：<br>① 导入一段 → ② 学一句 → ③ 收藏生词 → ④ 做一题复习${isNativeApp() ? '' : ' → ⑤ 装到主屏'}。</p><p class="muted small">随时可以跳过；以后在「我的」里可以重新观看。</p>`,
    [['tSkip', '跳过'], ['tStart', '开始引导', 'primary grow']]);
  m.querySelector('#tStart').onclick = () => { m.remove(); start(); };
  m.querySelector('#tSkip').onclick = async () => { m.remove(); await db.meta.set('tour', { status: 'skipped', step: 0 }); };
}
export async function start() { document.querySelector('.tour-offer')?.remove(); state = { status: 'active', step: 0 }; await save(); location.hash = '#/'; run(); }
export async function skip() { stop(); state = { status: 'skipped', step: state?.step || 0 }; await save(); }
function stop(clear = true) { clearInterval(timer); timer = null; overlay?.remove(); overlay = null; if (clickBound) document.removeEventListener('click', clickBound, true); clickBound = null; if (clear) document.getElementById('tourModal')?.remove(); }

function run() {
  stop();
  overlay = document.createElement('div'); overlay.id = 'tour'; overlay.innerHTML = `<div class="tour-hole"></div><div class="tour-tip" role="dialog" aria-live="polite"></div>`; document.body.appendChild(overlay);
  const hole = overlay.querySelector('.tour-hole'), tip = overlay.querySelector('.tour-tip'); let lastStep = -1, scrolled = false;
  clickBound = (e) => { const s = STEPS[state.step]; if (!s?.click) return; const t = s.target(); if (t && (t === e.target || t.contains(e.target))) setTimeout(next, 50); };
  document.addEventListener('click', clickBound, true);
  const tick = () => {
    const s = STEPS[state.step]; if (!s) return finish();
    if (s.done?.()) return next();
    if (state.step !== lastStep) { lastStep = state.step; scrolled = false;
      tip.innerHTML = `<div class="tour-part">${esc(s.part)} · 第 ${state.step + 1}/${STEPS.length} 步</div><p>${esc(s.text)}</p><div class="row gap"><button class="mini" id="tourSkip">跳过引导</button><span class="grow"></span>${s.id === 'answer' || s.id === 'rate' ? '' : ''}</div>`;
      tip.querySelector('#tourSkip').onclick = skip; }
    const routeOk = !s.route || s.route.test(H()); const raw = routeOk ? s.target() : null; const els = (Array.isArray(raw) ? raw : [raw]).filter(vis); const t = els[0];
    if (!vis(t)) { hole.style.display = 'none'; tip.classList.add('float'); tip.style.top = ''; tip.style.left = ''; if (!routeOk) tip.querySelector('p').textContent = s.text + '（请先回到对应页面）'; return; }
    tip.querySelector('p').textContent = s.text; tip.classList.remove('float');
    if (!scrolled) { t.scrollIntoView({ block: 'center' }); scrolled = true; }
    const rs = els.map(e => e.getBoundingClientRect()); const r = { left: Math.min(...rs.map(x => x.left)), top: Math.min(...rs.map(x => x.top)), right: Math.max(...rs.map(x => x.right)), bottom: Math.max(...rs.map(x => x.bottom)) }; r.width = r.right - r.left; r.height = r.bottom - r.top; const pad = 6;
    Object.assign(hole.style, { display: 'block', left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    const tw = Math.min(340, innerWidth - 24);
    if (s.place === 'top') { Object.assign(tip.style, { width: tw + 'px', left: (innerWidth - tw) / 2 + 'px', top: '8px', bottom: '' }); tip.classList.add('compact'); return; } // 不挡住作答区
    tip.classList.remove('compact'); const below = r.bottom + 170 < innerHeight || r.top < 190;
    Object.assign(tip.style, { width: tw + 'px', left: Math.max(12, Math.min(innerWidth - tw - 12, r.left + r.width / 2 - tw / 2)) + 'px', top: below ? (r.bottom + 14) + 'px' : '', bottom: below ? '' : (innerHeight - r.top + 14) + 'px' });
    tip.classList.toggle('above', !below);
  };
  timer = setInterval(tick, 200); tick();
}
async function next() { state.step++; await save(); }
async function finish() {
  stop(); state = { status: 'done', step: STEPS.length }; await save();
  const standalone = matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true || isNativeApp();
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const how = standalone ? '你已经是从主屏幕打开的，不用再装了。' : ios ? '在 Safari 里点底部的「分享」按钮（方框加向上箭头）→ 往下找「添加到主屏幕」→「添加」。之后像 App 一样从主屏打开，无需登录，离线也能用。'
    : session.install ? '点下面的「安装到桌面/主屏」。' : '在浏览器菜单里选「安装应用」或「添加到主屏幕」。';
  const m = modal(`<div class="big-emoji">🎉</div><h3>${isNativeApp() ? '完成！每天打开练一练' : '⑤ 装到主屏，每天打开练一练'}</h3><p>${esc(how)}</p><p class="muted small">你已经走完：导入 → 学一句 → 收藏生词 → 复习一题。想再看一遍：「我的 → 重新观看新手引导」。</p>`,
    [...(session.install && !standalone ? [['tInstall', '安装到桌面/主屏', 'primary']] : []), ['tDone', '完成', 'primary grow']]);
  m.querySelector('#tInstall')?.addEventListener('click', async () => { session.install.prompt(); await session.install.userChoice; session.install = null; m.querySelector('#tInstall').remove(); });
  m.querySelector('#tDone').onclick = () => { m.remove(); location.hash = '#/'; };
}
