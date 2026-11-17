import * as db from '../db.js';
import { bookStats, progressOf, isBook } from '../structure.js';
import { $, $$, esc, go, toast, sheet, confirmDlg } from '../ui.js';
import { openTranslate, statusHtml } from '../transui.js';
import { deleteMaterials } from '../matdelete.js';

export async function render(root, [id]) {
  const book = await db.materials.get(id);
  if (!book || !isBook(book)) { root.innerHTML = `<div class="empty"><p>找不到这本书。</p><a class="btn" href="#/library">回材料库</a></div>`; return; }
  const all = await db.materials.all(); const st = await bookStats(book, all);
  const last = st.chapters.find(c => c.id === book.progress?.lastChapter) || st.chapters.find(c => progressOf(c).pct < 100) || st.chapters[0];
  const lp = last?.progress?.last; const cont = last ? `#/lesson/${last.id}?lv=${lp?.lv || 'chapter'}&si=${lp?.si || 0}` : '#/library';
  const METHOD = { outline: '按 PDF 目录', headings: '按章节标题', pages: '按页数', manual: '手动' }[book.method] || '';
  root.innerHTML = `
  <header class="top"><a class="back" href="#/library" aria-label="返回">‹</a><h1>📖 ${esc(book.title)}</h1>
    <span class="muted">${st.chapters.length} 章 · ${st.total} 句 · 已学 ${st.pct}%${book.pages ? ' · ' + book.pages + ' 页' : ''}${METHOD ? ' · 切章：' + METHOD : ''}</span></header>
  <div class="bar"><i style="width:${st.pct}%"></i></div>
  ${await statusHtml(book.chapters, null)}
  ${last ? `<a class="btn primary big" id="cont" href="${cont}">${st.done ? '继续学习：' : '开始学习：'}${esc(last.title).slice(0, 28)}</a>` : ''}
  <p class="muted small">学习层级：书 → 章 → 段 → 句 → 词。进入一章后可在顶部切换「章/段/句/词」，进度自动记录。</p>
  <div class="list" id="chs">${st.chapters.map(c => { const p = progressOf(c); return `<a class="item chap" href="#/lesson/${c.id}"><div class="row"><b class="grow">第 ${c.chapterNo} 章　${esc(c.title)}</b>${p.pct >= 100 ? '<span class="tag okt">已学完</span>' : ''}</div>
      <div class="bar sm"><i style="width:${p.pct}%"></i></div><span class="muted small">${p.total} 句 · 已学 ${p.done} · ${p.pct}%${c.pageRange ? ' · ' + c.pageRange : ''}${c.progress?.quiz?.lesson != null ? ' · 测验 ' + c.progress.quiz.lesson + ' 分' : ''}</span></a>`; }).join('') || '<div class="empty"><p>这本书没有章节。</p></div>'}</div>
  <div class="grid2"><a class="btn" href="#/quiz/book:${book.id}">📝 整本书测验</a><button class="btn" id="rename">✏️ 改书名</button><button class="btn danger" id="del">🗑 删除整本书</button></div>`;
  $('#trBtn', root)?.addEventListener('click', () => openTranslate({ ids: book.chapters, title: book.title, onDone: () => { if (location.hash === '#/book/' + id) render(root, [id]); } }));
  $('#rename', root).onclick = () => {
    const sh = sheet(`<h3>书名</h3><div class="field"><input id="bn" value="${esc(book.title)}"></div><button class="btn primary" id="bs">保存</button>`, { cls: 'small' });
    $('#bs', sh.el).onclick = async () => { book.title = $('#bn', sh.el).value.trim() || book.title; await db.materials.save(book); sh.close(); render(root, [id]); };
  };
  $('#del', root).onclick = async () => {
    if (await deleteMaterials([book.id], { onChange: u => { if (u === 'undo') go('#/book/' + book.id); } })) go('#/library');
  };
}
