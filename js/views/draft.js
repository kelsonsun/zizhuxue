import * as db from '../db.js';
import * as ai from '../ai.js';
import { session, aiBtn } from '../state.js';
import { $, $$, esc, go, toast, confirmDlg } from '../ui.js';
import { needOf } from '../translate.js';
import { openTranslate } from '../transui.js';
import { onLeave } from '../app.js';

const TAGS = ['诊所', '日常', '工作', '旅行', '购物', '社交'];

export async function render(root) {
  const d = session.draft;
  if (!d) { root.innerHTML = `<div class="empty"><p>没有正在编辑的材料。</p><a class="btn primary" href="#/import">去导入</a></div>`; return; }
  // 转写结果：每句可回放原声核对
  let au = null, auUrl = null, auTok = 0;
  if (d.audioId) { const b = await db.blobs.get('audio:' + d.audioId).catch(() => null); if (b) auUrl = URL.createObjectURL(b.blob); }
  onLeave(() => { au?.pause(); if (auUrl) URL.revokeObjectURL(auUrl); });
  const playSeg = async (r, btn) => {
    if (!auUrl || r.t0 == null) return; const my = ++auTok; au = au || new Audio(auUrl); au.pause(); au.currentTime = r.t0;
    $$('[data-seg]', root).forEach(x => x.classList.remove('on')); btn?.classList.add('on');
    try { await au.play(); } catch (e) { btn?.classList.remove('on'); return toast('无法播放：' + e.message); }
    const fn = () => { if (my !== auTok || au.currentTime >= (r.t1 ?? Infinity) || au.ended) { au.removeEventListener('timeupdate', fn); if (my === auTok) { au.pause(); btn?.classList.remove('on'); } } }; au.addEventListener('timeupdate', fn);
  };
  const tfmt = t => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
  const draw = () => {
    const missZh = d.rows.filter(r => r.en && !r.zh).length, missEn = d.rows.filter(r => !r.en && r.zh).length;
    root.innerHTML = `
    <header class="top"><h1>${d.fresh ? '核对转写结果' : d.editId ? '编辑句子' : '拆句预览'}</h1><span class="muted">共 ${d.rows.length} 句，可逐句修改、合并、删除</span></header>
    ${d.fresh ? `<div class="note" id="asrNote">自动转写可能有错字、断句不准：点每句的 <b>▶ 原声</b> 听一遍核对，直接改文字；不对的句子可合并或删除。改好后保存，就会生成句子、生词和练习。${d.asrInfo ? `<div class="muted small">${esc(d.asrInfo)}</div>` : ''}</div>` : ''}
    <div class="field"><label for="t">材料名称</label><input id="t" value="${esc(d.title)}" placeholder="例如：疼痛接诊对话"></div>
    <div class="field"><label for="tg">标签 / 场景（逗号分隔）</label><input id="tg" value="${esc(d.tags.join('，'))}" placeholder="诊所，接待">
      <div class="chips">${TAGS.map(t => `<button class="chip" data-tag="${t}">${t}</button>`).join('')}</div></div>
    ${(missZh || missEn) ? `<div class="note">${missZh ? `有 ${missZh} 句缺中文翻译` : ''}${missZh && missEn ? '，' : ''}${missEn ? `有 ${missEn} 句缺英文` : ''}。可以手填，也可以用 AI 补齐。</div>
      <div class="row gap wrap">${aiBtn('aiFill', '补齐缺失的翻译')}${(!d.editId || d.fresh) && (missZh === d.rows.length || missEn === d.rows.length) ? `<button class="btn primary" id="saveTr">🌐 保存并配上${missZh ? '中文翻译' : '英文译文'}</button>` : ''}</div>
      ${missEn && !missZh ? '<p class="muted small">这是中文材料：配上英文译文后，英文就是你要学的内容（听读、跟读、测验、复习都用英文）。</p>' : ''}` : ''}
    <div id="rows">${d.rows.map((r, i) => `
      <div class="rowcard" data-i="${i}">
        <div class="rc-h"><span class="idx">${i + 1}</span><input class="spk" data-f="speaker" value="${esc(r.speaker)}" placeholder="说话人（可空）" aria-label="说话人">
          ${auUrl && r.t0 != null ? `<button class="mini segplay" data-seg aria-label="播放第${i + 1}句原声">▶ 原声 <small>${tfmt(r.t0)}</small></button>` : ''}<span class="grow"></span><button class="mini" data-merge title="与下一句合并" ${i === d.rows.length - 1 ? 'disabled' : ''}>⤓合并</button><button class="mini" data-del title="删除这句">🗑</button></div>
        <textarea data-f="en" rows="2" placeholder="英文" aria-label="第${i + 1}句英文">${esc(r.en)}</textarea>
        <textarea data-f="zh" rows="2" placeholder="中文" aria-label="第${i + 1}句中文">${esc(r.zh)}</textarea>
      </div>`).join('')}</div>
    <div class="row gap"><button class="btn" id="add">＋ 加一句</button></div>
    <div class="stickybar"><button class="btn" id="cancel">放弃</button><button class="btn primary grow" id="save">${d.editId && !d.fresh ? '保存修改' : '保存为课程'}</button></div>`;
    bind();
  };
  const sync = () => {
    d.title = $('#t', root).value; d.tags = $('#tg', root).value.split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean);
    $$('.rowcard', root).forEach(c => { const r = d.rows[+c.dataset.i]; $$('[data-f]', c).forEach(el => { r[el.dataset.f] = el.value; }); });
  };
  const bind = () => {
    $$('[data-tag]', root).forEach(b => b.onclick = () => { sync(); if (!d.tags.includes(b.dataset.tag)) d.tags.push(b.dataset.tag); draw(); });
    $$('[data-del]', root).forEach(b => b.onclick = () => { sync(); d.rows.splice(+b.closest('.rowcard').dataset.i, 1); draw(); });
    $$('[data-merge]', root).forEach(b => b.onclick = () => {
      sync(); const i = +b.closest('.rowcard').dataset.i, a = d.rows[i], n = d.rows[i + 1];
      a.en = (a.en + ' ' + n.en).trim(); a.zh = (a.zh + (a.zh && n.zh ? ' ' : '') + n.zh).trim(); a.t1 = n.t1 ?? a.t1; d.rows.splice(i + 1, 1); draw();
    });
    $$('[data-seg]', root).forEach(b => b.onclick = () => { sync(); playSeg(d.rows[+b.closest('.rowcard').dataset.i], b); });
    $('#add', root).onclick = () => { sync(); d.rows.push({ speaker: '', en: '', zh: '' }); draw(); };
    $('#cancel', root).onclick = async () => { if (await confirmDlg(d.fresh ? '放弃这次转写结果？录音已保存在材料库，以后可以再转写或自己边听边打。' : '放弃这份材料？未保存的内容会丢失。', { ok: '放弃', danger: true })) { const back = d.editId; session.draft = null; go(back ? '#/lesson/' + back : '#/import'); } };
    $('#aiFill', root)?.addEventListener('click', async (e) => {
      sync(); const b = e.currentTarget; b.disabled = true; b.textContent = '正在补齐…';
      try { const res = await ai.fillTranslations(d.rows); for (const x of res) { const r = d.rows[x.i]; if (!r.zh && x.zh) r.zh = x.zh; if (!r.en && x.en) r.en = x.en; } toast(`已补齐 ${res.length} 句（AI 生成，请核对）`); }
      catch (err) { toast(err.message, 5000); }
      draw();
    });
    $('#save', root).onclick = () => save();
    $('#saveTr', root)?.addEventListener('click', () => save({ translate: true }));
  };
  const save = async ({ translate = false } = {}) => {
    sync();
    const rows = d.rows.map(r => ({ ...r, en: r.en.trim(), zh: r.zh.trim() })).filter(r => r.en || r.zh);
    if (!rows.length) return toast('至少要有一句');
    const title = d.title.trim() || (rows[0].en || rows[0].zh).slice(0, 24);
    const keep = d.editId ? await db.materials.get(d.editId) : null;
    if (d.fresh) delete d.fresh;
    const old = new Map((keep?.sentences || []).map(s => [s.id, s]));
    const m = keep || { id: db.newId(), source: d.source, sentences: [] };
    m.title = title; m.tags = d.tags;
    m.sentences = rows.map((r, i) => {
      const o = r.id ? old.get(r.id) : null; const base = o ? { ...o } : {};
      // 保留解析/义项/翻译标记等缓存；改过的文字不再标“机器翻译”，原文改了则缓存的解析作废
      if (o && (o.en !== r.en || o.zh !== r.zh)) { delete base.tr; if (o.en !== r.en) { delete base.analysis; delete base.notes; } }
      return { ...base, id: r.id || db.newId(), speaker: r.speaker, en: r.en, zh: r.zh, ...(r.t0 != null ? { t0: r.t0, t1: r.t1 } : {}) };
    });
    if (d.audioId) m.audioId = d.audioId;
    await db.materials.save(m);
    session.draft = null; toast('已保存'); go('#/lesson/' + m.id);
    if (translate) setTimeout(() => openTranslate({ ids: [m.id], title: m.title, onDone: () => { if (location.hash.startsWith('#/lesson/' + m.id)) window.dispatchEvent(new HashChangeEvent('hashchange')); } }), 300);
  };
  draw();
}
