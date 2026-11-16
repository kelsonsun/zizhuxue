import * as db from '../db.js';
import * as tts from '../tts.js';
import { CARD_TYPE } from '../state.js';
import { $, $$, esc, fmtDate, toast, sheet, confirmDlg, hilite } from '../ui.js';
import { isDue, isNew, dayNumber } from '../sm2.js';
import { progressOf } from '../structure.js';

const bookPct = chs => { let d = 0, t = 0; for (const c of chs) { const p = progressOf(c); d += p.done; t += p.total; } return t ? Math.round(100 * d / t) : 0; };
let tab = 'mat', q = '', tag = '', ctype = '';
export async function render(root) {
  const draw = async () => {
    const [mats, cards] = await Promise.all([db.materials.all(), db.cards.all()]);
    mats.sort((a, b) => b.updatedAt - a.updatedAt); const byId = new Map(mats.map(m => [m.id, m]));
    const tags = [...new Set(mats.filter(m => !m.bookId).flatMap(m => m.tags || []))];
    root.innerHTML = `
    <header class="top"><h1>个人材料库</h1><span class="muted">${mats.filter(m => !m.bookId).length} 份材料/书 · ${cards.length} 张卡片</span></header>
    <div class="seg"><a href="#" data-tab="mat" class="${tab === 'mat' ? 'on' : ''}">材料</a><a href="#" data-tab="card" class="${tab === 'card' ? 'on' : ''}">生词本 / 卡片</a></div>
    <input id="q" type="search" placeholder="搜索${tab === 'mat' ? '标题、句子' : '词、释义、原句'}" value="${esc(q)}" aria-label="搜索">
    ${tab === 'mat' ? `
      <div class="chips"><button class="chip ${!tag ? 'on' : ''}" data-t="">全部</button>${tags.map(t => `<button class="chip ${tag === t ? 'on' : ''}" data-t="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <div class="list">${mats.filter(m => (!m.bookId || q || tag) && (!tag || (m.tags || []).includes(tag)) && (!q || (m.title + (m.sentences || []).map(s => s.en + s.zh).join(' ')).toLowerCase().includes(q.toLowerCase()))).map(m => {
        const book = m.kind === 'book'; const parent = m.bookId ? byId.get(m.bookId) : null; const chs = book ? mats.filter(x => x.bookId === m.id) : [];
        const pct = book ? bookPct(chs) : 0;
        return `<a class="item" href="${book ? '#/book/' + m.id : '#/lesson/' + m.id}"><b>${book ? '📖 ' : ''}${esc(m.title)}</b><span class="muted">${book ? `${chs.length} 章 · ${chs.reduce((a, c) => a + c.sentences.length, 0)} 句 · 已学 ${pct}% · ${m.pages || '?'} 页` : `${parent ? '《' + esc(parent.title) + '》第 ' + m.chapterNo + ' 章 · ' : ''}${m.sentences.length} 句`} · ${fmtDate(m.updatedAt)} · ${{ paste: '粘贴', subtitle: '字幕', ocr: '截图', ai: 'AI情景', sample: '示例', audio: '录音', docx: 'Word', pdf: 'PDF', txt: '文本' }[m.source] || m.source}</span>
        <span class="tags">${(m.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</span></a>`; }).join('') || '<div class="empty"><p>没有符合的材料。</p><a class="btn primary" href="#/import">导入第一份材料</a></div>'}</div>` : `
      <div class="chips"><button class="chip ${!ctype ? 'on' : ''}" data-ct="">全部</button>${Object.entries(CARD_TYPE).map(([k, v]) => `<button class="chip ${ctype === k ? 'on' : ''}" data-ct="${k}">${v}</button>`).join('')}</div>
      <div class="list">${cards.filter(c => (!ctype || c.type === ctype) && (!q || (c.term + c.zh + (c.sentence?.en || '')).toLowerCase().includes(q.toLowerCase()))).sort((a, b) => b.created - a.created).map(c => `
        <div class="item card-item" data-c="${c.id}"><div class="row"><b class="grow">${esc(c.term)}</b><span class="tag">${CARD_TYPE[c.type]}</span><button class="mini" data-say aria-label="朗读">🔊</button></div>
          ${c.phonetic ? `<span class="muted">/${esc(c.phonetic)}/</span>` : ''}
          <div class="zhline">${esc(c.zh) || '<span class="warn">（释义为空，点这里补充）</span>'}</div>
          ${c.sentence?.en && c.type !== 'sentence' ? `<div class="muted small">原句：${hilite(c.sentence.en, c.term)}</div>` : ''}
          <div class="muted small">${isNew(c) ? '新卡' : isDue(c) ? '今天到期' : '下次复习 ' + (c.sch.due - dayNumber()) + ' 天后'}</div></div>`).join('') || '<div class="empty"><p>还没有卡片。在材料里点一个词，或点 ☆ 收藏句子。</p></div>'}</div>`}`;
    bind(cards);
  };
  const bind = (cards) => {
    $$('[data-tab]', root).forEach(a => a.onclick = e => { e.preventDefault(); tab = a.dataset.tab; q = ''; draw(); });
    $('#q', root).oninput = e => { q = e.target.value; const pos = e.target.selectionStart; draw().then(() => { const el = $('#q', root); el.focus(); el.setSelectionRange(pos, pos); }); };
    $$('[data-t]', root).forEach(b => b.onclick = () => { tag = b.dataset.t; draw(); });
    $$('[data-ct]', root).forEach(b => b.onclick = () => { ctype = b.dataset.ct; draw(); });
    $$('.card-item', root).forEach(el => el.onclick = (e) => {
      const c = cards.find(x => x.id === el.dataset.c);
      if (e.target.closest('[data-say]')) return tts.speak(c.type === 'sentence' ? c.term : c.term).catch(x => toast(x.message));
      const sh = sheet(`<h3>${esc(c.term)}</h3>
        <div class="field"><label for="ez">中文释义</label><textarea id="ez" rows="2">${esc(c.zh)}</textarea></div>
        <div class="field"><label for="ep">音标</label><input id="ep" value="${esc(c.phonetic || '')}"></div>
        <div class="field"><label for="en">备注</label><input id="en" value="${esc(c.note || '')}"></div>
        ${c.sentence?.en ? `<div class="muted small">原句：${hilite(c.sentence.en, c.term)}${c.sentence.zh ? '<br>' + esc(c.sentence.zh) : ''}</div>` : ''}
        <div class="row gap"><button class="btn danger" id="edel">删除</button><button class="btn primary grow" id="esave">保存</button></div>`, { cls: 'small' });
      $('#esave', sh.el).onclick = async () => { c.zh = $('#ez', sh.el).value.trim(); c.phonetic = $('#ep', sh.el).value.trim(); c.note = $('#en', sh.el).value.trim(); await db.cards.save(c); sh.close(); draw(); };
      $('#edel', sh.el).onclick = async () => { sh.close(); if (await confirmDlg('删除这张卡片？', { ok: '删除', danger: true })) { await db.cards.remove(c.id); draw(); } };
    });
  };
  await draw();
}
