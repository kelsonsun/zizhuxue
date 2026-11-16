import * as db from '../db.js';
import { dailyQueue, dayNumber } from '../sm2.js';
import { settings, session } from '../state.js';
import { $, esc, fmtDate, go, toast, sheet } from '../ui.js';

const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;

export async function render(root) {
  const [mats, cards, revs] = await Promise.all([db.materials.all(), db.cards.all(), db.reviews.all()]);
  const q = dailyQueue(cards, { newLimit: settings.newLimit });
  const days = new Set(revs.map(r => r.day)).size;
  const real = mats.filter(m => !m.sample && !m.bookId);
  mats.sort((a, b) => b.updatedAt - a.updatedAt); const top = mats.filter(m => !m.bookId);
  const todayDone = revs.filter(r => r.day === dayNumber()).length;
  root.innerHTML = `
  <header class="top"><h1>自主学</h1><span class="muted">用你自己的真实内容学英语</span></header>
  <section class="card hero">
    <div class="hero-n">${q.all.length}</div>
    <div class="hero-t">${q.all.length ? `今日待复习（到期 ${q.due.length} · 新卡 ${q.fresh.length}）` : (cards.length ? '今天的复习已经完成 🎉' : '还没有生词卡，先去学一段材料')}</div>
    ${q.all.length ? '<a class="btn primary big" href="#/review" id="startReview">开始复习</a>' : ''}
    <div class="muted small">今日已复习 ${todayDone} 次 · 累计学习 ${days} 天 · 卡片 ${cards.length} 张</div>
  </section>
  <h2>把真实内容变成教材</h2>
  <div class="quick">
    <a class="qbtn" href="#/import?m=paste"><b>📋 粘贴对话 / 字幕</b><span>中英文本、srt、vtt、txt、docx、pdf</span></a>
    <a class="qbtn" href="#/import?m=ocr"><b>📷 截图识别</b><span>手机截图里的英文，本地识别</span></a>
    <a class="qbtn" href="#/import?m=ai"><b>💬 描述实际情景</b><span>用中文说，生成英文对话（需AI）</span></a>
  </div>
  ${!real.length ? `<div class="note">你还没有自己的材料。上面任选一种导入，3 步就能开始：导入 → 拆句预览 → 听读。示例材料可在材料库里删除。</div>` : ''}
  <h2>最近的材料</h2>
  <div class="list">${top.slice(0, 4).map(m => `<a class="item" href="${m.kind === 'book' ? '#/book/' : '#/lesson/'}${m.id}"><b>${m.kind === 'book' ? '📖 ' : ''}${esc(m.title)}</b><span class="muted">${m.kind === 'book' ? mats.filter(x => x.bookId === m.id).length + ' 章' : m.sentences.length + ' 句'} · ${fmtDate(m.updatedAt)}${m.sample ? ' · 示例' : ''}</span></a>`).join('') || '<p class="muted">暂无材料</p>'}</div>
  <div id="installBox"></div>
  <p class="muted small privacy">🔒 你的内容只保存在这台设备的浏览器里，不上传到任何服务器。</p>`;
  const box = $('#installBox', root);
  const draw = () => {
    if (isStandalone()) { box.innerHTML = ''; return; }
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    box.innerHTML = `<div class="card install"><b>📲 加到主屏幕，打开即用</b>
      <p class="muted">${ios ? '在 Safari 点底部「分享」按钮 → 「添加到主屏幕」。之后像 App 一样直接打开，无需登录，离线也能用。' : '安装后会像 App 一样出现在桌面/主屏幕，无需登录，离线也能用。'}</p>
      ${session.install ? '<button class="btn primary" id="doInstall">一键安装</button>' : ''}</div>`;
    $('#doInstall', box)?.addEventListener('click', async () => { session.install.prompt(); await session.install.userChoice; session.install = null; draw(); });
  };
  draw(); window.addEventListener('installready', draw, { once: true });
}
