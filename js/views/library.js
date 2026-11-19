import * as db from '../db.js';
import * as tts from '../tts.js';
import { CARD_TYPE, settings, saveSettings } from '../state.js';
import { deleteMaterials } from '../matdelete.js';
import { $, $$, esc, fmtDate, toast, sheet, confirmDlg, hilite } from '../ui.js';
import { isDue, isNew, dayNumber } from '../sm2.js';
import { isMastered, restorePractice } from '../practice.js';
import { mountRootBox } from '../rootbox.js';
import { progressOf } from '../structure.js';

const bookPct = chs => { let d = 0, t = 0; for (const c of chs) { const p = progressOf(c); d += p.done; t += p.total; } return t ? Math.round(100 * d / t) : 0; };
let tab = 'mat', q = '', tag = '', ctype = '', selMode = false; const picked = new Set();
// 排序：选择记在设置里；“手动”顺序是材料 id 的列表（新导入、还没排过的放最前）
export const SORTS = { recent: '最近学习', created: '导入时间', title: '标题', progress: '学习进度', manual: '手动排序' };
export function sortMats(list, key, { pct = () => 0, order = [] } = {}) {
  const a = [...list]; const rec = m => m.updatedAt || m.created || 0;
  if (key === 'created') return a.sort((x, y) => (y.created || 0) - (x.created || 0));
  if (key === 'title') return a.sort((x, y) => String(x.title).localeCompare(String(y.title), 'zh-Hans-CN', { numeric: true }));
  if (key === 'progress') return a.sort((x, y) => pct(y) - pct(x) || rec(y) - rec(x));
  if (key === 'manual') { const pos = new Map(order.map((id, i) => [id, i])); return a.sort((x, y) => (pos.has(x.id) ? pos.get(x.id) : -1) - (pos.has(y.id) ? pos.get(y.id) : -1) || (y.created || 0) - (x.created || 0)); }
  return a.sort((x, y) => rec(y) - rec(x) || (y.created || 0) - (x.created || 0)); // 同一毫秒保存的：按导入时间，顺序稳定
}
/** 把“可见列表的新顺序”写回完整顺序：可见项占用的位置不变，只在这些位置之间重排 */
export function mergeOrder(full, visibleNew) {
  const vis = new Set(visibleNew); const slots = full.map((id, i) => vis.has(id) ? i : -1).filter(i => i >= 0); const out = [...full];
  slots.forEach((slot, k) => { out[slot] = visibleNew[k]; }); return out;
}
export async function render(root) {
  const draw = async () => {
    const [mats, cards] = await Promise.all([db.materials.all(), db.cards.all()]);
    const byId = new Map(mats.map(m => [m.id, m]));
    const tags = [...new Set(mats.filter(m => !m.bookId).flatMap(m => m.tags || []))];
    const sortKey = SORTS[settings.libSort] ? settings.libSort : 'recent';
    const pctOf = m => m.kind === 'book' ? bookPct(mats.filter(x => x.bookId === m.id)) : progressOf(m).pct;
    const shown = mats.filter(m => (!m.bookId || q || tag) && (!tag || (m.tags || []).includes(tag)) && (!q || (m.title + (m.sentences || []).map(s => s.en + s.zh).join(' ')).toLowerCase().includes(q.toLowerCase())));
    const fullOrder = sortMats(mats.filter(m => !m.bookId), 'manual', { order: settings.libOrder || [] }).map(m => m.id);
    const vis = sortMats(shown, sortKey, { pct: pctOf, order: fullOrder });
    for (const id of [...picked]) if (!byId.has(id)) picked.delete(id);
    root.innerHTML = `
    <header class="top"><h1>个人材料库</h1><a class="btn" href="#/roots" id="toRoots">🌳 词根地图</a><span class="muted">${mats.filter(m => !m.bookId).length} 份材料/书 · ${cards.length} 张卡片</span></header>
    <div class="seg"><a href="#" data-tab="mat" class="${tab === 'mat' ? 'on' : ''}">材料</a><a href="#" data-tab="card" class="${tab === 'card' ? 'on' : ''}">生词本 / 卡片</a></div>
    <input id="q" type="search" placeholder="搜索${tab === 'mat' ? '标题、句子' : '词、释义、原句'}" value="${esc(q)}" aria-label="搜索">
    ${tab === 'mat' ? `
      <div class="chips"><button class="chip ${!tag ? 'on' : ''}" data-t="">全部</button>${tags.map(t => `<button class="chip ${tag === t ? 'on' : ''}" data-t="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <div class="row gap wrap libbar"><label class="sortsel"><span>排序</span><select id="msort" aria-label="材料排序">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}" ${sortKey === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <button class="btn" id="msel" aria-pressed="${selMode}">${selMode ? '完成' : '🗑 选择 / 删除'}</button></div>
      ${sortKey === 'manual' && !selMode ? '<p class="muted small">按住右边 ≡ 拖动，或点 ↑ ↓ 调整顺序，会自动记住。</p>' : ''}
      <div class="list" id="mlist">${vis.map(m => {
        const book = m.kind === 'book'; const parent = m.bookId ? byId.get(m.bookId) : null; const chs = book ? mats.filter(x => x.bookId === m.id) : [];
        const pct = pctOf(m);
        return `<div class="mrow ${picked.has(m.id) ? 'picked' : ''}" data-id="${m.id}">${selMode ? `<label class="check mpick"><input type="checkbox" data-pick="${m.id}" ${picked.has(m.id) ? 'checked' : ''} aria-label="选择「${esc(m.title)}」"></label>` : ''}<a class="item grow" href="${book ? '#/book/' + m.id : '#/lesson/' + m.id}"><b>${book ? '📖 ' : ''}${esc(m.title)}</b><span class="muted">${book ? `${chs.length} 章 · ${chs.reduce((a, c) => a + c.sentences.length, 0)} 句 · 已学 ${pct}% · ${m.pages || '?'} 页` : `${parent ? '《' + esc(parent.title) + '》第 ' + m.chapterNo + ' 章 · ' : ''}${m.sentences.length} 句 · 已学 ${pct}%`} · ${fmtDate(m.created)}</span>
        <span class="tags">${(m.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</span></a>${selMode ? `<button class="btn danger mdel1" data-del="${m.id}" aria-label="删除「${esc(m.title)}」">🗑</button>` : sortKey === 'manual' ? `<div class="mctl"><button class="btn mv" data-up="${m.id}" aria-label="上移">↑</button><button class="btn mv" data-down="${m.id}" aria-label="下移">↓</button></div><span class="drag" data-drag role="button" aria-label="拖动排序" tabindex="-1">≡</span>` : ''}</div>`; }).join('') || '<div class="empty"><p>没有符合的材料。</p><a class="btn primary" href="#/import">导入第一份材料</a></div>'}</div>
      ${selMode ? `<div class="selbar"><button class="btn" id="mall">${vis.length && vis.every(m => picked.has(m.id)) ? '全不选' : '全选'}</button><span class="grow muted">已选 ${[...picked].filter(id => byId.has(id)).length} 份</span><button class="btn danger" id="mdel" ${picked.size ? '' : 'disabled'}>删除所选</button></div>` : ''}` : `
      <div class="chips"><button class="chip ${!ctype ? 'on' : ''}" data-ct="">全部</button>${Object.entries(CARD_TYPE).map(([k, v]) => `<button class="chip ${ctype === k ? 'on' : ''}" data-ct="${k}">${v}</button>`).join('')}${cards.some(isMastered) ? `<button class="chip ${ctype === 'mastered' ? 'on' : ''}" data-ct="mastered">⭐ 已熟练 ${cards.filter(isMastered).length}</button>` : ''}</div>
      <div class="list">${cards.filter(c => (!ctype || (ctype === 'mastered' ? isMastered(c) : c.type === ctype)) && (!q || (c.term + c.zh + (c.sentence?.en || '')).toLowerCase().includes(q.toLowerCase()))).sort((a, b) => b.created - a.created).map(c => `
        <div class="item card-item" data-c="${c.id}"><div class="row"><b class="grow">${esc(c.term)}</b><span class="tag">${(CARD_TYPE[c.type] || '词')}</span><button class="mini" data-say aria-label="朗读">🔊</button></div>
          ${c.phonetic ? `<span class="muted">/${esc(c.phonetic)}/</span>` : ''}
          <div class="zhline">${esc(c.zh) || '<span class="warn">（释义为空，点这里补充）</span>'}</div>
          ${c.sentence?.en && c.type !== 'sentence' ? `<div class="muted small">原句：${hilite(c.sentence.en, c.term)}</div>` : ''}
          ${isMastered(c) ? `<div class="row gap mrow2"><span class="tag mastered">⭐ 已熟练 · 不再出现</span><button class="btn restore" data-restore="${c.id}">↩︎ 恢复练习</button></div>` : `<div class="muted small">${isNew(c) ? '新卡' : isDue(c) ? '今天到期' : '下次复习 ' + (c.sch.due - dayNumber()) + ' 天后'}</div>`}</div>`).join('') || '<div class="empty"><p>还没有卡片。在材料里点一个词，或点 ☆ 收藏句子。</p></div>'}</div>`}`;
    bind(cards, vis, fullOrder);
  };
  const bind = (cards, vis, fullOrder) => {
    const saveOrder = visIds => saveSettings({ libOrder: mergeOrder(fullOrder, visIds.filter(id => fullOrder.includes(id))) });
    $('#msort', root)?.addEventListener('change', async e => { await saveSettings({ libSort: e.target.value }); if (e.target.value === 'manual' && !(settings.libOrder || []).length) { const cur = vis.filter(m => !m.bookId).map(m => m.id); await saveSettings({ libOrder: [...cur, ...fullOrder.filter(id => !cur.includes(id))] }); } draw(); });
    $('#msel', root)?.addEventListener('click', () => { selMode = !selMode; picked.clear(); draw(); });
    const updSel = () => { const n = vis.filter(m => picked.has(m.id)).length; const sb = $('.selbar', root); if (!sb) return; sb.querySelector('span').textContent = `已选 ${n} 份`; $('#mdel', root).disabled = !n; $('#mall', root).textContent = vis.length && n === vis.length ? '全不选' : '全选'; };
    $$('[data-pick]', root).forEach(cb => cb.onchange = () => { cb.checked ? picked.add(cb.dataset.pick) : picked.delete(cb.dataset.pick); cb.closest('.mrow').classList.toggle('picked', cb.checked); updSel(); });
    $('#mall', root)?.addEventListener('click', () => { const all = vis.every(m => picked.has(m.id)); vis.forEach(m => all ? picked.delete(m.id) : picked.add(m.id)); draw(); });
    const del = async ids => { if (await deleteMaterials(ids, { onChange: () => { ids.forEach(id => picked.delete(id)); return draw(); } })) { if (!picked.size) selMode = false; draw(); } };
    $('#mdel', root)?.addEventListener('click', () => del([...picked]));
    $$('[data-del]', root).forEach(b => b.onclick = () => del([b.dataset.del]));
    // 手动排序：↑ ↓
    const ids = vis.map(m => m.id);
    $$('[data-up],[data-down]', root).forEach(b => b.onclick = async () => {
      const id = b.dataset.up || b.dataset.down; const i = ids.indexOf(id); const j = b.dataset.up ? i - 1 : i + 1; if (j < 0 || j >= ids.length) return;
      const n = [...ids]; [n[i], n[j]] = [n[j], n[i]]; await saveOrder(n); await draw(); $(`[data-id="${id}"] [data-${b.dataset.up ? 'up' : 'down'}]`, root)?.focus();
    });
    // 手动排序：按住 ≡ 拖动（手机触摸 / 鼠标都可以）
    $$('[data-drag]', root).forEach(h => h.onpointerdown = e => {
      e.preventDefault(); const row = h.closest('.mrow'), list = $('#mlist', root); h.setPointerCapture?.(e.pointerId); row.classList.add('dragging');
      const move = ev => { const y = ev.clientY; const rows = $$('.mrow:not(.dragging)', list); const after = rows.find(r => { const bb = r.getBoundingClientRect(); return y < bb.top + bb.height / 2; }); list.insertBefore(row, after || null);
        if (y < 80) scrollBy(0, -12); else if (y > innerHeight - 120) scrollBy(0, 12); };
      const up = async () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); row.classList.remove('dragging');
        const n = $$('.mrow', list).map(r => r.dataset.id); if (n.join() !== ids.join()) { await saveOrder(n); toast('顺序已保存'); } draw(); };
      addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
    });
    $$('[data-tab]', root).forEach(a => a.onclick = e => { e.preventDefault(); tab = a.dataset.tab; q = ''; draw(); });
    $('#q', root).oninput = e => { q = e.target.value; const pos = e.target.selectionStart; draw().then(() => { const el = $('#q', root); el.focus(); el.setSelectionRange(pos, pos); }); };
    $$('[data-t]', root).forEach(b => b.onclick = () => { tag = b.dataset.t; draw(); });
    $$('[data-ct]', root).forEach(b => b.onclick = () => { ctype = b.dataset.ct; draw(); });
    $$('.card-item', root).forEach(el => el.onclick = (e) => {
      const c = cards.find(x => x.id === el.dataset.c);
      if (e.target.closest('[data-restore]')) { c.sch = restorePractice(c.sch); return db.cards.save(c).then(() => { toast('已恢复练习，今天就会出现在复习里'); draw(); }); }
      if (e.target.closest('[data-say]')) return tts.speak(c.type === 'sentence' ? c.term : c.term).catch(x => toast(x.message));
      const sh = sheet(`<h3>${esc(c.term)}</h3>
        <div class="field"><label for="ez">中文释义</label><textarea id="ez" rows="2">${esc(c.zh)}</textarea></div>
        ${c.type !== 'sentence' && !/\s/.test(c.term.trim()) ? '<div id="eroot"></div>' : ''}
        <div class="field"><label for="ep">音标</label><input id="ep" value="${esc(c.phonetic || '')}"></div>
        <div class="field"><label for="en">备注</label><input id="en" value="${esc(c.note || '')}"></div>
        ${c.sentence?.en ? `<div class="muted small">原句：${hilite(c.sentence.en, c.term)}${c.sentence.zh ? '<br>' + esc(c.sentence.zh) : ''}</div>` : ''}
        <div class="row gap"><button class="btn danger" id="edel">删除</button><button class="btn primary grow" id="esave">保存</button></div>`, { cls: 'small' });
      if ($('#eroot', sh.el)) mountRootBox($('#eroot', sh.el), c.term.trim(), { onSaved: () => draw() });
      $('#esave', sh.el).onclick = async () => { c.zh = $('#ez', sh.el).value.trim(); c.phonetic = $('#ep', sh.el).value.trim(); c.note = $('#en', sh.el).value.trim(); await db.cards.save(c); sh.close(); draw(); };
      $('#edel', sh.el).onclick = async () => { sh.close(); if (await confirmDlg('删除这张卡片？', { ok: '删除', danger: true })) { await db.cards.remove(c.id); draw(); } };
    });
  };
  await draw();
}
