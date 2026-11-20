import * as db from '../db.js';
import * as ai from '../ai.js';
import { session, aiBtn } from '../state.js';
import { $, $$, esc, go, toast, confirmDlg } from '../ui.js';
import { needOf } from '../translate.js';
import { openTranslate } from '../transui.js';
import { onLeave } from '../app.js';
import { undoBar } from '../matdelete.js';
import * as SP from '../splitrow.js';
import * as TR from '../translate.js';

const TAGS = ['诊所', '日常', '工作', '旅行', '购物', '社交'];

export async function render(root) {
  const d = session.draft;
  if (!d) { root.innerHTML = `<div class="empty"><p>没有正在编辑的材料。</p><a class="btn primary" href="#/import">去导入</a></div>`; return; }
  // 转写结果：每句可回放原声核对
  let au = null, auUrl = null, auTok = 0, auBlob = null;
  if (d.audioId) { const b = await db.blobs.get('audio:' + d.audioId).catch(() => null); if (b) { auBlob = b.blob; auUrl = URL.createObjectURL(b.blob); } }
  // v1.5.1 拆分：切点由用户点选；undo 栈同时记录拆分与合并
  let splitI = null, cuts = new Set(), pauseJob = null, sf = 'en'; const undo = [];
  // v1.6 译文跟着拆：zcuts 用户在预览里点过的译文切点（null=自动对齐）；zov AI 微调/重新翻译后的各段译文；zsrc 切点来源
  let zcuts = null, zov = null, zsrc = null, aiTok = 0, aiBusy = false, aiErr = '', aiTimer = null, mtBusy = '';
  const resetOther = () => { zcuts = null; zov = null; zsrc = null; aiErr = ''; aiTok++; aiBusy = false; clearTimeout(aiTimer); };
  const snap = () => d.rows.map(r => ({ ...r }));
  const pushUndo = (what) => { undo.push({ what, rows: snap() }); if (undo.length > 30) undo.shift(); };
  const doUndo = () => { const u = undo.pop(); if (!u) return; sync(); d.rows = u.rows; splitI = null; cuts = new Set(); resetOther(); draw(); toast('已撤销' + u.what); };
  const pauses = () => (d.pauses || []).map(p => Array.isArray(p) ? { a: p[0], b: p[1] } : p);
  // 已保存的旧材料没有停顿数据：第一次拆分时从录音里测一次（只用于微调时间）
  const ensurePauses = () => {
    if (d.pauses || !auBlob || pauseJob) return pauseJob;
    pauseJob = (async () => { try { const T = await import('../transcribe.js'); const r = await T.readAudio(auBlob); d.pauses = T.findPauses(r.pcm).map(p => [p.a, p.b]); } catch { d.pauses = []; } if (splitI != null) drawSplit(); })();
    return pauseJob;
  };
  onLeave(() => { au?.pause(); if (auUrl) URL.revokeObjectURL(auUrl); });
  const playSeg = async (r, btn) => {
    if (!auUrl || r.t0 == null) return; const my = ++auTok; au = au || new Audio(auUrl); au.pause(); au.currentTime = r.t0;
    $$('[data-seg]', root).forEach(x => x.classList.remove('on')); btn?.classList.add('on');
    try { await au.play(); } catch (e) { btn?.classList.remove('on'); return toast('无法播放：' + e.message); }
    const fn = () => { if (my !== auTok || au.currentTime >= (r.t1 ?? Infinity) || au.ended) { au.removeEventListener('timeupdate', fn); if (my === auTok) { au.pause(); btn?.classList.remove('on'); } } }; au.addEventListener('timeupdate', fn);
  };
  const tfmt = t => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
  const tfmt1 = t => Math.floor(t / 60) + ':' + (t % 60).toFixed(1).padStart(4, '0');
  const HOW = { word: '原声按逐词时间切开', pause: '原声切点已对齐到附近的停顿', est: '原声切点按字数比例估算（附近没测到停顿），请试听核对' };
  const OHOW = { auto: '按标点和长度比例自动对齐，请核对', user: '你调整过', ai: 'AI 按原文分段对齐（只切开原译文，没改字）', 'ai-adj': 'AI 对齐时微调了措辞，请核对', 'mt:ai': 'AI 各段重新翻译，请核对', 'mt:mymemory': 'MyMemory 各段重新翻译，请核对', short: '译文太短分不开，先留在第 1 句' };
  const curPlan = (i = splitI) => SP.planSplit(d.rows[i], [...cuts], { pauses: pauses(), field: sf });
  /** 译文怎么分；mismatch：用户点的译文切点个数和原文对不上 */
  const curOther = (plan, i = splitI) => {
    const r = d.rows[i]; const need = plan.pieces.length - 1;
    if (zov && zov.texts.length === plan.pieces.length) return { ...SP.planOther(r, plan, { texts: zov.texts, how: zov.how }), zcutsShown: null };
    if (zcuts && zcuts.size !== need) { const o = SP.planOther(r, plan); return { ...o, mismatch: need - zcuts.size, zcutsShown: [...zcuts] }; }
    const o = SP.planOther(r, plan, { cuts: zcuts ? [...zcuts] : null }); if (zsrc === 'ai' && o.how === 'user') o.how = 'ai';
    return { ...o, zcutsShown: o.cuts };
  };
  const splitHtml = (i) => {
    const r = d.rows[i]; const plan = curPlan(i); const toks = plan.toks;
    const hows = [...new Set(plan.pieces.slice(0, -1).map(p => p.how).filter(Boolean))];
    const oth = curOther(plan, i), OL = oth.field === 'zh' ? '中文' : '英文', hasO = oth.how !== 'none', zs = new Set(oth.zcutsShown || []);
    return `<div class="splitbox" role="group" aria-label="拆分第${i + 1}句">
      ${SP.splitFields(r).length > 1 ? `<div class="row gap sfield" role="group" aria-label="从哪种文字拆"><button type="button" class="btn tog ${plan.field === 'en' ? 'on' : ''}" data-sf="en" aria-pressed="${plan.field === 'en'}">从英文拆</button><button type="button" class="btn tog ${plan.field === 'zh' ? 'on' : ''}" data-sf="zh" aria-pressed="${plan.field === 'zh'}">从中文拆</button></div>` : ''}
      <p class="small"><b>✂ 拆分：</b>点两个${plan.field === 'zh' ? '字' : '词'}之间的竖线，就从那里断开；可以点多处，再点一次取消。${hasO ? `${OL}会自动切成对应的段，逐段对齐显示（可再微调）。` : ''}</p>
      <div class="splitwords" lang="${plan.field === 'zh' ? 'zh' : 'en'}">${toks.map((t, j) => `<span class="sw">${esc(t.s)}</span>${j < toks.length - 1 ? `<button type="button" class="cutgap ${cuts.has(j) ? 'on' : ''}" data-cut="${j}" aria-pressed="${cuts.has(j)}" aria-label="在“${esc(t.s)}”后面断开"><i></i></button>` : ''}`).join('')}</div>
      ${cuts.size ? `<div class="splitprev" aria-live="polite"><div class="muted small">切开后（${plan.pieces.length} 句）${auUrl && r.t0 != null ? '，每段可先试听：' : '：'}</div>${plan.pieces.map((p, k) => `<div class="sp"><span class="idx">${i + k + 1}</span>${auUrl && p.t0 != null ? `<button type="button" class="mini" data-try="${k}" aria-label="试听第${k + 1}段">▶ <small>${tfmt1(p.t0)}–${tfmt1(p.t1)}</small></button>` : ''}<span class="sptext">${esc(p.text)}${hasO ? `<span class="spzh" data-zp="${k}">${oth.mismatch ? '<span class="muted">（' + OL + '断开处还没对齐）</span>' : esc(oth.texts[k]) || '<span class="muted">（这段没有' + OL + '）</span>'}</span>` : ''}</span></div>`).join('')}
        ${hows.length ? `<div class="muted small">${hows.map(h => HOW[h]).join('；')}。</div>` : ''}${pauseJob && !d.pauses ? '<div class="muted small">正在从录音里测停顿，用来微调切点时间…</div>' : ''}
        ${hasO ? `<div class="zhadj"><div class="small"><b>${OL}对应的断开处</b>（<span class="ohow">${aiBusy ? 'AI 正在对齐…先显示自动对齐' : OHOW[oth.how] || ''}</span>）${oth.zcutsShown ? `：点${oth.field === 'zh' ? '字与字' : '词与词'}之间调整` : ''}</div>
          ${oth.zcutsShown ? `<div class="splitwords zhwords" lang="${oth.field === 'zh' ? 'zh' : 'en'}">${oth.toks.map((t, j) => `<span class="sw">${esc(t.s)}</span>${j < oth.toks.length - 1 ? `<button type="button" class="cutgap ${zs.has(j) ? 'on' : ''}" data-zcut="${j}" aria-pressed="${zs.has(j)}" aria-label="${OL}在“${esc(t.s)}”后面断开"><i></i></button>` : ''}`).join('')}</div>` : `<p class="muted small">现在用的是${zov?.how?.startsWith('mt:') ? '重新翻译' : 'AI 微调'}后的${OL}。<button type="button" class="mini" data-zreset>改回按原译文切开</button></p>`}
          ${oth.mismatch ? `<div class="note small warnz">${OL}断开处${oth.mismatch > 0 ? '还差 ' + oth.mismatch : '多了 ' + -oth.mismatch} 个：再点一处${oth.mismatch > 0 ? '' : '已选的取消'}，让每段原文都有对应的${OL}。</div>` : ''}
          ${aiErr ? `<div class="muted small">AI 对齐没成功（${esc(aiErr)}），已用自动对齐。</div>` : ''}
          <div class="row gap wrap retr">${ai.isConfigured() ? `<button type="button" class="mini" data-realign>🤖 AI 重新对齐</button>` : ''}<span class="muted small">或各段重新翻译：</span>${ai.isConfigured() ? `<button type="button" class="mini" data-retr="ai">${mtBusy === 'ai' ? '翻译中…' : 'AI 翻译'}</button>` : ''}<button type="button" class="mini" data-retr="mymemory">${mtBusy === 'mymemory' ? '翻译中…' : 'MyMemory 翻译'}</button>${zcuts || zov ? '<button type="button" class="mini" data-zauto>恢复自动对齐</button>' : ''}</div></div>` : ''}</div>`
      : '<p class="muted small">还没选切点。</p>'}
      <div class="row gap"><button type="button" class="btn" data-splitcancel>取消</button><button type="button" class="btn primary grow" data-splitok ${cuts.size && !oth.mismatch && !mtBusy ? '' : 'disabled'}>✂ 拆成 ${plan.pieces.length} 句</button></div></div>`;
  };
  const drawSplit = () => { const card = $(`.rowcard[data-i="${splitI}"]`, root); if (!card) return; const box = $('.splitbox', card); box.outerHTML = splitHtml(splitI); bindSplit(card); };
  /** 有 AI：原文切点定下来后（停 0.6 秒），让 AI 把原译文按段对齐切开 */
  const scheduleAi = (now = false) => {
    clearTimeout(aiTimer); const i = splitI; const r = d.rows[i]; if (i == null || !cuts.size || !ai.isConfigured()) return;
    const plan = curPlan(i); const of = plan.field === 'en' ? 'zh' : 'en'; const other = (r[of] || '').trim(); if (!other) return;
    const tok = ++aiTok; aiBusy = true; aiErr = '';
    aiTimer = setTimeout(async () => {
      try {
        const res = await ai.alignSplit(plan.pieces.map(p => p.text), other, plan.field === 'en' ? 'en2zh' : 'zh2en'); if (tok !== aiTok || splitI !== i) return;
        const toks = SP.tokenize(other, of === 'zh'); const cs = !res.changed && SP.cutsFromTexts(other, toks, res.t);
        if (cs) { zcuts = new Set(cs); zov = null; zsrc = 'ai'; } else { zov = { texts: res.t, how: 'ai-adj' }; zcuts = null; zsrc = 'ai'; }
      } catch (e) { if (tok !== aiTok) return; aiErr = e.message; }
      aiBusy = false; if (splitI === i) drawSplit();
    }, now ? 0 : 600);
  };
  const bindSplit = (card) => {
    $$('[data-sf]', card).forEach(b => b.onclick = () => { if (sf === b.dataset.sf) return; sf = b.dataset.sf; cuts = new Set(); resetOther(); drawSplit(); $(`[data-sf="${sf}"]`, card)?.focus({ preventScroll: true }); });
    $$('[data-cut]', card).forEach(b => b.onclick = () => { const j = +b.dataset.cut; cuts.has(j) ? cuts.delete(j) : cuts.add(j); resetOther(); scheduleAi(); drawSplit(); $(`[data-cut="${j}"]`, card)?.focus({ preventScroll: true }); });
    // 译文切点：点已选的 → 取消；还差 → 加上；个数够了 → 把最近的那个挪过来（一次点击就能微调）
    $$('[data-zcut]', card).forEach(b => b.onclick = () => {
      const j = +b.dataset.zcut; const plan = curPlan(); const need = plan.pieces.length - 1; const o = curOther(plan);
      const z = new Set(zcuts || o.zcutsShown || []); aiTok++; aiBusy = false; clearTimeout(aiTimer); zov = null; zsrc = 'user';
      if (z.has(j)) z.delete(j); else if (z.size < need) z.add(j); else { let best = null; for (const x of z) if (best == null || Math.abs(x - j) < Math.abs(best - j)) best = x; z.delete(best); z.add(j); }
      zcuts = z; drawSplit(); $(`[data-zcut="${j}"]`, card)?.focus({ preventScroll: true });
    });
    $('[data-zreset]', card)?.addEventListener('click', () => { zov = null; drawSplit(); });
    $('[data-zauto]', card)?.addEventListener('click', () => { resetOther(); drawSplit(); });
    $('[data-realign]', card)?.addEventListener('click', () => { resetOther(); scheduleAi(true); drawSplit(); });
    $$('[data-retr]', card).forEach(b => b.onclick = async () => {
      const prov = b.dataset.retr; if (mtBusy) return; const plan = curPlan(); const dir = plan.field === 'en' ? 'en2zh' : 'zh2en';
      if (prov === 'mymemory' && !session.mmOk && !(await confirmDlg('各段原文会逐段发送到第三方公共翻译服务 MyMemory（免费、匿名额度约 5000 字/天）。继续吗？', { ok: '继续翻译' }))) return;
      if (prov === 'mymemory') session.mmOk = true;
      mtBusy = prov; drawSplit();
      try {
        const src = plan.pieces.map(p => p.text); const out = await TR.translateTexts(prov, src, dir);
        if (out.some((t, k) => !TR.plausible(src[k], t, dir))) throw new Error('有的段没有翻译出来');
        aiTok++; aiBusy = false; zov = { texts: out, how: 'mt:' + prov }; zcuts = null; toast(`已重新翻译 ${out.length} 段（${TR.SHORT[prov]}，请核对）`);
      } catch (e) { toast((TR.SHORT[prov] || prov) + '失败：' + e.message, 5000); }
      mtBusy = ''; drawSplit();
    });
    $$('[data-try]', card).forEach(b => b.onclick = () => { const p = curPlan().pieces[+b.dataset.try]; playSeg(p, b); });
    $('[data-splitcancel]', card).onclick = () => { au?.pause(); splitI = null; cuts = new Set(); resetOther(); draw(); };
    $('[data-splitok]', card).onclick = () => {
      const i = splitI, r = d.rows[i]; const plan = curPlan(); if (plan.pieces.length < 2) return; const o = curOther(plan); if (o.mismatch) return;
      au?.pause(); pushUndo('拆分'); d.rows.splice(i, 1, ...SP.applySplit(r, plan, o)); splitI = null; cuts = new Set(); resetOther(); draw();
      $(`.rowcard[data-i="${i}"]`, root)?.scrollIntoView({ block: 'nearest' });
      undoBar(`已把第 ${i + 1} 句拆成 ${plan.pieces.length} 句${o.how !== 'none' && o.how !== 'short' ? '，译文也已对应拆开' : ''}`, () => doUndo());
    };
  };
  const draw = () => {
    const missZh = d.rows.filter(r => r.en && !r.zh).length, missEn = d.rows.filter(r => !r.en && r.zh).length;
    root.innerHTML = `
    <header class="top"><h1>${d.fresh ? '核对转写结果' : d.editId ? '编辑句子' : '拆句预览'}</h1><span class="muted">共 ${d.rows.length} 句，可逐句修改、拆分、合并、删除</span></header>
    ${d.fresh ? `<div class="note" id="asrNote">自动转写可能有错字、断句不准：点每句的 <b>▶ 原声</b> 听一遍核对，直接改文字；太长的句子可以 <b>✂拆分</b>（你点哪两个词之间就从哪里断，译文跟着分段），太碎的可以合并，没用的删除。改好后保存，就会生成句子、生词和练习。${d.asrInfo ? `<div class="muted small">${esc(d.asrInfo)}</div>` : ''}</div>` : ''}
    <div class="field"><label for="t">材料名称</label><input id="t" value="${esc(d.title)}" placeholder="例如：疼痛接诊对话"></div>
    <div class="field"><label for="tg">标签 / 场景（逗号分隔）</label><input id="tg" value="${esc(d.tags.join('，'))}" placeholder="诊所，接待">
      <div class="chips">${TAGS.map(t => `<button class="chip" data-tag="${t}">${t}</button>`).join('')}</div></div>
    ${(missZh || missEn) ? `<div class="note">${missZh ? `有 ${missZh} 句缺中文翻译` : ''}${missZh && missEn ? '，' : ''}${missEn ? `有 ${missEn} 句缺英文` : ''}。可以手填，也可以用 AI 补齐。</div>
      <div class="row gap wrap">${aiBtn('aiFill', '补齐缺失的翻译')}${(!d.editId || d.fresh) && (missZh === d.rows.length || missEn === d.rows.length) ? `<button class="btn primary" id="saveTr">🌐 保存并配上${missZh ? '中文翻译' : '英文译文'}</button>` : ''}</div>
      ${missEn && !missZh ? '<p class="muted small">这是中文材料：配上英文译文后，英文就是你要学的内容（听读、跟读、测验、复习都用英文）。</p>' : ''}` : ''}
    <div id="rows">${d.rows.map((r, i) => `
      <div class="rowcard" data-i="${i}">
        <div class="rc-h"><span class="idx">${i + 1}</span><input class="spk" data-f="speaker" value="${esc(r.speaker)}" placeholder="说话人（可空）" aria-label="说话人">
          ${auUrl && r.t0 != null ? `<button class="mini segplay" data-seg aria-label="播放第${i + 1}句原声">▶ 原声 <small>${tfmt(r.t0)}</small></button>` : ''}<span class="grow"></span><button class="mini" data-split title="拆成两句以上" ${!SP.canSplit(r) || (splitI != null && splitI !== i) ? 'disabled' : ''}>✂拆分</button><button class="mini" data-merge title="与下一句合并" ${i === d.rows.length - 1 ? 'disabled' : ''}>⤓合并</button><button class="mini" data-del title="删除这句">🗑</button></div>
        ${splitI === i ? splitHtml(i) : `<textarea data-f="en" rows="2" placeholder="英文" aria-label="第${i + 1}句英文">${esc(r.en)}</textarea>
        <textarea data-f="zh" rows="2" placeholder="中文" aria-label="第${i + 1}句中文">${esc(r.zh)}</textarea>`}
      </div>`).join('')}</div>
    <div class="row gap"><button class="btn" id="add">＋ 加一句</button></div>
    <div class="stickybar"><button class="btn" id="cancel">放弃</button>${undo.length ? `<button class="btn" id="undoStep" title="撤销上一次拆分/合并">↶ 撤销</button>` : ''}<button class="btn primary grow" id="save">${d.editId && !d.fresh ? '保存修改' : '保存为课程'}</button></div>`;
    bind();
  };
  const sync = () => {
    d.title = $('#t', root).value; d.tags = $('#tg', root).value.split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean);
    $$('.rowcard', root).forEach(c => { const r = d.rows[+c.dataset.i]; $$('[data-f]', c).forEach(el => { if ((el.dataset.f === 'zh' || el.dataset.f === 'en') && r[el.dataset.f] !== el.value) { delete r.trNew; delete r._sp; } r[el.dataset.f] = el.value; }); });
  };
  const bind = () => {
    $$('[data-tag]', root).forEach(b => b.onclick = () => { sync(); if (!d.tags.includes(b.dataset.tag)) d.tags.push(b.dataset.tag); draw(); });
    $$('[data-del]', root).forEach(b => b.onclick = () => { sync(); if (splitI != null) { splitI = null; cuts = new Set(); resetOther(); } d.rows.splice(+b.closest('.rowcard').dataset.i, 1); draw(); });
    $$('[data-merge]', root).forEach(b => b.onclick = () => {
      sync(); const i = +b.closest('.rowcard').dataset.i; pushUndo('合并'); if (splitI != null) { splitI = null; cuts = new Set(); resetOther(); }
      d.rows.splice(i, 2, SP.mergeRows(d.rows[i], d.rows[i + 1])); draw();
    });
    $$('[data-split]', root).forEach(b => b.onclick = () => { sync(); const i = +b.closest('.rowcard').dataset.i; resetOther(); if (splitI === i) { splitI = null; cuts = new Set(); draw(); return; } splitI = i; sf = SP.defaultField(d.rows[i]); cuts = new Set(); draw(); ensurePauses(); $(`.rowcard[data-i="${i}"]`, root)?.scrollIntoView({ block: 'nearest' }); });
    if (splitI != null) { const card = $(`.rowcard[data-i="${splitI}"]`, root); if (card) bindSplit(card); }
    $('#undoStep', root)?.addEventListener('click', () => doUndo());
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
      const out = { ...base, id: r.id || db.newId(), speaker: r.speaker, en: r.en, zh: r.zh, ...(r.t0 != null ? { t0: r.t0, t1: r.t1 } : {}) };
      if (r.wt) out.wt = r.wt; else delete out.wt; // 逐词时间（以后再拆分用）
      if (r.trNew) out.tr = r.trNew; delete out.trNew; delete out._sp; // 拆分时各段重新翻译的：标“机器翻译，可改”
      // v1.9.3 已保存教材里改过的句子：课程页这句旁边出现「重新翻译」（不自动翻译）
      if (o && !r.trNew && !r._sp && (o.en !== r.en || o.zh !== r.zh)) { const pe = o.edited || '', e1 = o.en !== r.en || pe === 'en' || pe === 'both', z1 = o.zh !== r.zh || pe === 'zh' || pe === 'both'; out.edited = e1 && z1 ? 'both' : e1 ? 'en' : 'zh'; }
      return out;
    });
    if (d.audioId) m.audioId = d.audioId;
    if (d.pauses) m.pauses = d.pauses;
    await db.materials.save(m);
    if (!d.editId) import('../progress.js').then(P => P.grant({ kind: 'import', key: 'import:' + m.id, label: '导入材料「' + m.title + '」' })).catch(() => { }); // v1.7：导入新材料给星星钻石（每份一次、每天最多 3 份）
    session.draft = null; toast('已保存'); go('#/lesson/' + m.id);
    if (translate) setTimeout(() => openTranslate({ ids: [m.id], title: m.title, onDone: () => { if (location.hash.startsWith('#/lesson/' + m.id)) window.dispatchEvent(new HashChangeEvent('hashchange')); } }), 300);
  };
  draw();
}
