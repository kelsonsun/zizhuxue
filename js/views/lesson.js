import * as db from '../db.js';
import * as S from '../sense.js';
import { deleteMaterials } from '../matdelete.js';
import * as ai from '../ai.js';
import * as tts from '../tts.js';
import * as dict from '../dict.js';
import { parseBilingual } from '../textproc.js';
import { settings, saveSettings, session, aiBtn, makeCard, CARD_TYPE } from '../state.js';
import { $, $$, esc, go, toast, sheet, confirmDlg, wordsHtml, tokensOf } from '../ui.js';
import { familyTag } from '../roots.js';
import * as V from '../vocab.js';
import { onLeave } from '../app.js';
import { paragraphs, paraIndexOf, progressOf, markDone, touchLast, isBook } from '../structure.js';
import { openWordSheet, openPractice, toggleStar } from '../tools.js';
import { openTranslate, statusHtml } from '../transui.js';
import { SHORT } from '../translate.js';
import * as TR from '../translate.js';
import * as SE from '../sentedit.js';

const LEVELS = [['chapter', '章'], ['para', '段'], ['sent', '句'], ['word', '词']];

export async function render(root, [id], params = {}) {
  let m = await db.materials.get(id);
  if (!m) { root.innerHTML = `<div class="empty"><p>找不到这份材料。</p><a class="btn" href="#/library">回材料库</a></div>`; return; }
  if (isBook(m)) { go('#/book/' + m.id); return; }
  const book = m.bookId ? await db.materials.get(m.bookId) : null;
  const audioId = m.audioId || (m.source === 'audio' ? m.id : null);
  let audioUrl = null;
  if (audioId) { const b = await db.blobs.get('audio:' + audioId); if (b) audioUrl = URL.createObjectURL(b.blob); }
  const N = m.sentences.length;
  const lv = LEVELS.some(l => l[0] === params.lv) && N ? params.lv : 'chapter';
  const si = Math.min(Math.max(+params.si || 0, 0), Math.max(N - 1, 0));
  const groups = paragraphs(m); const pi = paraIndexOf(m, si); const grp = groups[pi] || { start: 0, end: N - 1 };
  const range = lv === 'sent' || lv === 'word' ? [si, si] : lv === 'para' ? [grp.start, grp.end] : [0, N - 1];
  const st = { edit: null, busy: false, rate: settings.rate, loopOne: false, loopAll: false, showZh: settings.showZh, orig: false, tok: 0, cur: -1 };
  const ctx = { m, rate: () => st.rate, refresh: () => draw(), hasOrig: s => hasOrig(s), playOrig: (s, rate) => { st.tok++; tts.cancel(); return playOrig(s, rate ?? st.rate); } };
  const cards = () => db.cards.all().then(a => a.filter(c => c.materialId === m.id));
  let au = null;
  onLeave(() => { st.tok++; tts.cancel(); if (au) au.pause(); if (audioUrl) URL.revokeObjectURL(audioUrl); });
  const hasSeg = () => audioUrl && m.sentences.some(s => s.t0 != null);
  const hasOrig = s => !!(audioUrl && s && s.t0 != null);
  const url = (l, i) => `#/lesson/${m.id}?lv=${l}&si=${i}`;
  if (N && (m.progress?.last?.lv !== lv || m.progress?.last?.si !== si)) touchLast(m, { lv, si });

  const levelBar = () => N ? `<nav class="levels" aria-label="学习层级">
    ${book ? `<a class="lvl" href="#/book/${book.id}" data-lvl="book">书</a>` : '<span class="lvl dis" title="这份材料不属于某本书">书</span>'}
    ${LEVELS.map(([k, t]) => `<a class="lvl ${lv === k ? 'on' : ''}" data-lvl="${k}" href="${url(k, si)}">${t}</a>`).join('')}</nav>
    <div class="crumb muted small">${book ? `《${esc(book.title)}》 › ` : ''}${esc(m.title)}${lv !== 'chapter' ? ` › 第 ${pi + 1}/${groups.length} 段` : ''}${lv === 'sent' || lv === 'word' ? ` › 第 ${si + 1}/${N} 句` : ''}</div>` : '';

  // v1.9.3 已保存的教材随时可改：逐句 ✏️ / 逐段「编辑本段」；改完旁边出现「重新翻译」（只有点了才翻译）
  const editing = i => st.edit && (st.edit.kind === 's' ? st.edit.i === i : i >= groups[st.edit.gi].start && i <= groups[st.edit.gi].end);
  const EDW = { en: '英文', zh: '中文', both: '中英文' };
  const editHtml = (s, i, solo = st.edit?.kind === 's') => `<div class="sedit" role="group" aria-label="编辑第${i + 1}句">
      <label class="small muted" for="ee${i}">英文</label><textarea id="ee${i}" data-ef="en" rows="2" lang="en" aria-label="第${i + 1}句英文">${esc(s.en || '')}</textarea>
      <label class="small muted" for="ez${i}">中文</label><textarea id="ez${i}" data-ef="zh" rows="2" lang="zh" aria-label="第${i + 1}句中文">${esc(s.zh || '')}</textarea>
      ${solo ? `<div class="row gap"><button class="btn" data-ecancel>取消</button><button class="btn primary grow" data-esave>保存修改</button></div>` : ''}</div>`;
  const retrHtml = s => s.edited && !(st.edit && editing(m.sentences.indexOf(s))) ? `<div class="retr-row"><button class="mini retr" data-retrans aria-label="重新翻译这一句">${st.busy === s.id ? '翻译中…' : '🔄 重新翻译'}</button><span class="muted small">改过${EDW[s.edited] || ''}，${SE.retransDir(s) === 'en2zh' ? '中文' : '英文'}译文没有自动改；只是改错别字就不用点</span></div>` : '';
  const pEditBar = gi => st.edit?.kind === 'p' && st.edit.gi === gi ? `<div class="row gap pedit-bar"><button class="btn" data-pcancel>取消</button><button class="btn primary grow" data-psave>保存本段修改</button></div>` : '';
  const pTools = gi => { const g = groups[gi]; const ed = m.sentences.slice(g.start, g.end + 1).filter(s => s.edited).length;
    return st.edit ? '' : `<button class="mini" data-pedit="${gi}" aria-label="编辑第${gi + 1}段">✏️ 编辑本段</button>${ed > 1 ? `<button class="mini retr" data-pretrans="${gi}">${st.busy === 'p' + gi ? '翻译中…' : `🔄 重新翻译本段（${ed} 句）`}</button>` : ''}`; };
  const rowHtml = (s, i, starred) => `
      <div class="sent ${m.progress?.done?.[s.id] ? 'done' : ''} ${editing(i) ? 'editing' : ''}" data-i="${i}">
        <button class="pbtn" data-play aria-label="播放第${i + 1}句">▶</button>
        <div class="sbody">${s.speaker ? `<span class="spk-tag">${esc(s.speaker)}</span>` : ''}${editing(i) ? editHtml(s, i) : `<div class="en">${s.en ? wordsHtml(s.en) : '<span class="muted">（缺英文，请编辑补上）</span>'}</div>
          <div class="zh ${st.showZh ? '' : 'hide'}">${esc(s.zh) || '<span class="muted">（缺中文）</span>'}</div>${s.tr ? `<div class="trtag">${s.orig === 'zh' ? '中文原文 · 英文为' : ''}${esc(SHORT[s.tr] || '机器翻译')}，可编辑</div>` : ''}${retrHtml(s)}`}</div>
        <div class="sact">${st.edit ? '' : `<button class="mini" data-edit aria-label="编辑第${i + 1}句">✏️</button>`}${hasOrig(s) ? '<button class="mini orig" data-orig aria-label="播放原声">🎧 原声</button>' : ''}<button class="mini ${starred.has(s.id) ? 'on' : ''}" data-star aria-label="收藏句子">${starred.has(s.id) ? '★' : '☆'}</button><button class="mini" data-practice>练习</button></div>
      </div>`;
  const loopLabel = lv === 'chapter' ? '🔁 整篇循环' : lv === 'para' ? '🔁 循环本段' : '🔁 循环';
  const playLabel = lv === 'chapter' ? '▶ 整篇朗读' : lv === 'para' ? '▶ 朗读本段' : '▶ 听这句';
  const playerHtml = () => `
    <section class="player">
      <div class="row gap wrap">
        <button class="btn primary" id="playAll">${playLabel}</button><button class="btn" id="stop">■ 停止</button>
        ${lv !== 'sent' && lv !== 'word' ? `<button class="btn tog ${st.loopOne ? 'on' : ''}" id="loopOne" aria-pressed="${st.loopOne}">🔂 单句循环</button>` : ''}
        <button class="btn tog ${st.loopAll ? 'on' : ''}" id="loopAll" aria-pressed="${st.loopAll}">${lv === 'sent' || lv === 'word' ? '🔂 单句循环' : loopLabel}</button>
        <button class="btn tog ${st.showZh ? 'on' : ''}" id="showZh" aria-pressed="${st.showZh}">中文</button>
        <button class="btn tog ${settings.hlKnown !== false ? 'on' : ''}" id="hlKnown" aria-pressed="${settings.hlKnown !== false}" title="生词本里的词再次出现时标出来">学过的词</button>
      </div>
      <div class="muted small kwinfo" id="kwInfo" role="status"></div>
      <div class="rates" role="group" aria-label="语速">语速 ${[0.6, 0.8, 1, 1.2].map(r => `<button class="chip ${st.rate === r ? 'on' : ''}" data-rate="${r}">${r}×</button>`).join('')}
        ${hasSeg() ? `<button class="chip ${st.orig ? 'on' : ''}" id="orig">${st.orig ? '原录音' : '合成语音'}</button>` : ''}</div>
    </section>`;
  const pager = (kind) => {
    const prev = kind === 'para' ? (pi > 0 ? url('para', groups[pi - 1].start) : '') : (si > 0 ? url(lv, si - 1) : '');
    const next = kind === 'para' ? (pi < groups.length - 1 ? url('para', groups[pi + 1].start) : '') : (si < N - 1 ? url(lv, si + 1) : '');
    return `<div class="pager"><a class="btn ${prev ? '' : 'dis'}" ${prev ? `href="${prev}"` : ''} id="prev">‹ 上一${kind === 'para' ? '段' : '句'}</a><a class="btn ${next ? '' : 'dis'}" ${next ? `href="${next}"` : ''} id="next">下一${kind === 'para' ? '段' : '句'} ›</a></div>`;
  };

  const draw = async () => {
    const cs = await cards(); const starred = new Set(cs.filter(c => c.type === 'sentence').map(c => c.sentenceId));
    const pr = progressOf(m);
    let body = '';
    if (!N) body = audioUrl ? '' : '<div class="empty"><p>这份材料还没有句子。</p></div>';
    else if (lv === 'chapter') {
      body = playerHtml() + `<div class="progline"><div class="bar"><i style="width:${pr.pct}%"></i></div><span class="muted small">已学 ${pr.done}/${pr.total} 句（${pr.pct}%）${m.progress?.quiz?.['lesson'] != null ? ' · 测验最好 ' + m.progress.quiz['lesson'] + ' 分' : ''}</span></div>
        <div id="sents">${groups.map((g, gi) => (groups.length > 1 ? `<div class="phead" data-pi="${gi}"><b>第 ${gi + 1} 段</b><span class="muted small">${g.end - g.start + 1} 句${m.progress?.quiz?.['para' + gi] != null ? ' · 测验 ' + m.progress.quiz['para' + gi] + ' 分' : ''}</span><span class="grow"></span><button class="mini" data-pplay="${gi}">▶ 朗读</button><a class="mini" href="${url('para', g.start)}">学习本段 ›</a>${pTools(gi)}</div>` : '') + m.sentences.slice(g.start, g.end + 1).map((s, k) => rowHtml(s, g.start + k, starred)).join('') + pEditBar(gi)).join('')}</div>`;
    } else if (lv === 'para') {
      const done = m.sentences.slice(grp.start, grp.end + 1).every(s => m.progress?.done?.[s.id]);
      body = playerHtml() + `<div class="progline"><div class="bar"><i style="width:${pr.pct}%"></i></div><span class="muted small">本章已学 ${pr.done}/${pr.total} 句${m.progress?.quiz?.['para' + pi] != null ? ' · 本段测验 ' + m.progress.quiz['para' + pi] + ' 分' : ''}</span></div>
        <div id="sents"><div class="phead ptools"><b>第 ${pi + 1} 段</b><span class="grow"></span>${pTools(pi)}</div>${m.sentences.slice(grp.start, grp.end + 1).map((s, k) => rowHtml(s, grp.start + k, starred)).join('')}${pEditBar(pi)}</div>
        <div class="row gap wrap"><a class="btn" href="#/quiz/para:${m.id}:${pi}">📝 本段测验</a><button class="btn ${done ? '' : 'primary'} grow" id="paraDone">${done ? '✓ 已学完（再点取消）' : '✓ 本段学完'}</button></div>` + pager('para');
    } else if (lv === 'sent') {
      const s = m.sentences[si]; const done = !!m.progress?.done?.[s.id];
      body = playerHtml() + `<div class="bigsent" id="sents"><div class="sent solo ${done ? 'done' : ''} ${editing(si) ? 'editing' : ''}" data-i="${si}">
          <div class="sbody">${s.speaker ? `<span class="spk-tag">${esc(s.speaker)}</span>` : ''}${editing(si) ? editHtml(s, si) : `<div class="en big">${s.en ? wordsHtml(s.en) : '<span class="muted">（缺英文）</span>'}</div><div class="zh ${st.showZh ? '' : 'hide'}">${esc(s.zh) || '<span class="muted">（缺中文）</span>'}</div>${retrHtml(s)}`}</div>
          <div class="sact">${st.edit ? '' : `<button class="mini" data-edit aria-label="编辑这一句">✏️</button>`}<button class="mini ${starred.has(s.id) ? 'on' : ''}" data-star aria-label="收藏句子">${starred.has(s.id) ? '★' : '☆'}</button></div></div></div>
        ${hasOrig(s) ? `<div class="row gap"><button class="btn grow" id="origSent">🎧 听原声（录音里这一句）</button></div>` : ''}
        <div class="grid2"><button class="btn primary" id="pract">🎙 跟读与练习</button><button class="btn" id="anaBtn">📖 语法与翻译方法</button>
          <a class="btn" href="#/quiz/sent:${m.id}:${si}">📝 本句测验</a><a class="btn" href="${url('word', si)}">🔤 逐词学习 ›</a></div>
        <div class="row gap"><button class="btn ${done ? '' : 'primary'} grow" id="sentDone">${done ? '✓ 已学会' : '✓ 学会了，下一句'}</button></div>` + pager('sent');
    } else {
      const s = m.sentences[si];
      body = `<div class="bigsent" id="sents"><div class="sent solo" data-i="${si}"><div class="sbody"><div class="en big">${wordsHtml(s.en || '')}</div><div class="zh ${st.showZh ? '' : 'hide'}">${esc(s.zh)}</div></div></div></div>
        <p class="muted small">点句中任何一个词，查看它的不同义项、本句用法、你材料里的其他例句。</p>
        <h3>这句里值得学的词</h3><div class="chips" id="wchips"><span class="muted small">分析中…</span></div>
        <h3>本章已收藏的词 / 短语（${cs.filter(c => c.type === 'word' || c.type === 'phrase').length}）</h3>
        <div class="list">${cs.filter(c => c.type === 'word' || c.type === 'phrase').slice(0, 30).map(c => `<div class="item"><b>${esc(c.term)}</b><span class="muted small">${c.sense ? esc(`${c.sense.pos} ${c.sense.zh}`.trim()) + (c.sense.by === 'ai' ? '（AI判断本句义项）' : '') : esc(c.zh)}</span></div>`).join('') || '<p class="muted small">还没有收藏词。</p>'}</div>
        <div class="grid2"><a class="btn" href="#/quiz/lesson:${m.id}?m=mcq">📝 词义测验</a><a class="btn" href="${url('sent', si)}">‹ 回到这一句</a></div>` + pager('sent');
    }
    root.innerHTML = `
    <header class="top"><a class="back" href="${book ? '#/book/' + book.id : '#/library'}" aria-label="返回">‹</a><h1>${esc(m.title)}</h1>
      <span class="muted">${N} 句 · ${cs.length} 张卡${m.tags?.length ? ' · ' + esc(m.tags.join(' / ')) : ''}</span></header>
    ${levelBar()}${lv === 'chapter' && !book ? await statusHtml([m.id], m) : ''}${audioUrl ? audioPanel() : ''}${body}
    ${lv === 'chapter' ? `<h2>本课工具</h2><div class="grid2">
      <a class="btn" href="#/quiz/lesson:${m.id}">📝 测验</a><button class="btn" id="autoWords">🔎 自动选生词（离线词典）</button>${aiBtn('aiCards', '生成词卡')}
      <button class="btn" id="editSents">✏️ 编辑句子</button><button class="btn" id="info">🏷 名称 / 标签 / 删除</button><a class="btn" href="#/roots?m=${m.id}">🌳 本课词根网络</a><a class="btn" href="#/bilingual/${m.id}" id="toBi">📑 双语对照 / 导出</a></div>` : ''}`;
    bind(); markRoots(); markKnownWords();
    if (lv === 'word') wordChips();
  };

  const audioPanel = () => lv !== 'chapter' ? '' : `
    <section class="player audio">
      <audio id="au" controls src="${audioUrl}" preload="metadata"></audio>
      <div class="rates">变速 ${[0.5, 0.75, 1, 1.25, 1.5].map(r => `<button class="chip ${r === 1 ? 'on' : ''}" data-arate="${r}">${r}×</button>`).join('')}</div>
      <div class="row gap wrap"><button class="btn" id="setA">设为 A 点</button><button class="btn" id="setB">设为 B 点</button><button class="btn tog" id="abLoop">AB 循环：关</button><button class="btn" id="abClear">清除</button></div>
      <div class="muted small" id="abInfo">A / B 未设置。播放到想反复听的位置，点「设为 A/B 点」。</div>
      ${m.sentences.length ? '' : typer()}
    </section>`;
  const typer = () => `
    <div class="row gap"><a class="btn primary grow" id="toAsr" href="#/asr/${m.id}">🤖 自动转成文字</a></div>
    <h3>或者：边听边打</h3><p class="muted small">按「⏱ 插入时间点」在光标处记下当前播放时间，然后打这一句：<code>[00:12] English | 中文</code>（中文可省略）。写完点保存，就会生成带原录音时间段的句子。</p>
    <textarea id="typed" rows="8" placeholder="[00:03] Hello, how can I help you? | 你好，需要什么帮助？"></textarea>
    <div class="row gap"><button class="btn" id="stamp">⏱ 插入时间点</button><button class="btn primary grow" id="saveTyped">保存为句子</button></div>`;

  const mark = (i) => {
    st.cur = i; $$('.sent', root).forEach(e => e.classList.toggle('active', +e.dataset.i === i));
    $(`.sent[data-i="${i}"]`, root)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  /** 播放这句的原声（录音/视频里的那一段）。再次调用会打断上一次。 */
  let origTok = 0;
  const playOrig = async (s, rate = st.rate) => {
    const my = ++origTok; const a = au || (au = new Audio(audioUrl)); a.pause(); a.playbackRate = rate; a.preservesPitch = true; a.currentTime = s.t0; await a.play();
    await new Promise(res => { const fn = () => { if (my !== origTok || (s.t1 != null && a.currentTime >= s.t1) || a.ended || a.paused) { if (my === origTok) a.pause(); a.removeEventListener('timeupdate', fn); a.removeEventListener('pause', fn); res(); } }; a.addEventListener('timeupdate', fn); a.addEventListener('pause', fn); });
  };
  const say = async (s, rate = st.rate) => {
    if (st.orig && hasOrig(s)) return playOrig(s, rate);
    return tts.speak(s.en, { rate });
  };
  /** 在 [ra, rb] 范围内播放；all=false 只播 start 这一句。 */
  const run = async (start, all, [ra, rb] = range) => {
    if (!tts.supported() && !st.orig) return toast('本设备/浏览器不支持语音朗读');
    const my = ++st.tok; tts.cancel(); let i = start; root.classList.add('playing');
    const singleLevel = lv === 'sent' || lv === 'word';
    try {
      while (my === st.tok) {
        const s = m.sentences[i];
        if (s?.en) {
          mark(i); const r = await say(s); if (my !== st.tok) return;
          if (r === 'interrupted') return;
          if (st.loopOne || (singleLevel && st.loopAll)) { await new Promise(r => setTimeout(r, 300)); continue; }
        } else if (!all) { toast('这句没有英文'); break; }
        if (!all) break;
        i++; if (i > rb) { if (st.loopAll && !singleLevel) i = ra; else break; }
        await new Promise(r => setTimeout(r, 250));
      }
    } catch (e) { toast(e.message); }
    if (my === st.tok) { root.classList.remove('playing'); $$('.sent', root).forEach(e => e.classList.remove('active')); }
  };
  const stopAll = () => { st.tok++; tts.cancel(); au?.pause(); root.classList.remove('playing'); $$('.sent', root).forEach(e => e.classList.remove('active')); };
  const toggleBtn = (id, key, label) => $(id, root)?.addEventListener('click', e => { st[key] = !st[key]; e.currentTarget.classList.toggle('on', st[key]); e.currentTarget.setAttribute('aria-pressed', st[key]); toast(`${label}：${st[key] ? '开' : '关'}${st[key] ? '（点“停止”结束）' : ''}`); });

  // v1.5：属于内置词根家族的词，加一条细虚线（点词时下方自动给出拆解和家族）
  const markRoots = () => $$('.w[data-w]', root).forEach(el => { const r = familyTag(el.textContent); if (r) { el.classList.add('rw'); el.dataset.root = r; } });
  // v1.7：学过的生词（生词本里的词 / 短语，按原形匹配）再次出现时高亮；在收藏它的那句以外出现的加深
  const markKnownWords = async () => {
    $$('.w.kw', root).forEach(el => { el.classList.remove('kw', 'again'); el.removeAttribute('data-kw'); el.removeAttribute('title'); });
    const info = $('#kwInfo', root); if (settings.hlKnown === false) { if (info) info.textContent = ''; return; }
    await dict.ready().catch(() => { }); const idx = V.knownIndex(await db.cards.all(), dict.lemmaSync); if (!idx.size) { if (info) info.textContent = ''; return; }
    let n = 0, again = 0;
    for (const en of $$('.sent .en', root)) {
      const sentEl = en.closest('.sent'); const s = m.sentences[+sentEl?.dataset.i]; const sp = $$('.w[data-w]', en);
      for (const h of V.markKnown(sp.map(x => x.textContent), idx, dict.lemmaSync)) {
        const ag = h.card.sentenceId !== s?.id; n++; if (ag) again++;
        for (let j = h.k; j < h.k + h.len; j++) { const el = sp[j]; el.classList.add('kw'); if (ag) el.classList.add('again'); el.dataset.kw = h.card.term; el.title = `生词本：${h.card.term}${h.card.zh ? ' — ' + S.briefAll(h.card.zh).text : ''}`; }
      }
    }
    if (info) info.textContent = n ? `学过的生词在这里出现 ${n} 处（绿色底纹）${again ? `，其中 ${again} 处是在别的句子里再次遇到（加深）` : ''}` : '';
  };
  const wordChips = async () => {
    const s = m.sentences[si]; const toks = tokensOf(s.en || ''); const seen = new Set(); const items = [];
    for (let k = 0; k < toks.length; k++) { const w = toks[k].toLowerCase(); if (seen.has(w) || w.length < 2) continue; seen.add(w); const d = await dict.lookup(w).catch(() => null); items.push({ w: toks[k], k, rank: d?.rank ?? 99999, d }); }
    const hard = items.filter(x => x.rank > 300 || !x.d); const list = hard.length ? hard : items;
    const box = $('#wchips', root); if (!box) return;
    box.innerHTML = list.map(x => `<button class="chip wchip${familyTag(x.w) ? ' rw' : ''}" data-k="${x.k}">${familyTag(x.w) ? '🌳' : ''}${esc(x.w)}${x.d ? `<small>${esc(S.brief(x.d.senses.find(y => S.posKey(y.pos) !== 'dom') || x.d.senses[0], 2).text)}</small>` : ''}</button>`).join('') + `<button class="chip" id="allw">${hard.length ? '显示全部词' : ''}</button>`;
    $$('.wchip', box).forEach(b => b.onclick = () => openWordSheet(ctx, s, +b.dataset.k));
    $('#allw', box).onclick = () => { box.innerHTML = items.map(x => `<button class="chip wchip" data-k="${x.k}">${esc(x.w)}</button>`).join(''); $$('.wchip', box).forEach(b => b.onclick = () => openWordSheet(ctx, s, +b.dataset.k)); };
  };

  const bind = () => {
    $('#trBtn', root)?.addEventListener('click', () => openTranslate({ ids: [m.id], title: m.title, onDone: async () => { m = await db.materials.get(m.id); draw(); } }));
    au = null;
    $('#playAll', root)?.addEventListener('click', () => run(lv === 'chapter' || lv === 'para' ? range[0] : si, lv === 'chapter' || lv === 'para'));
    $('#stop', root)?.addEventListener('click', stopAll);
    toggleBtn('#loopOne', 'loopOne', '单句循环'); toggleBtn('#loopAll', 'loopAll', lv === 'sent' || lv === 'word' ? '单句循环' : '范围循环');
    $('#hlKnown', root)?.addEventListener('click', e => { const on = settings.hlKnown === false; saveSettings({ hlKnown: on }); e.currentTarget.classList.toggle('on', on); e.currentTarget.setAttribute('aria-pressed', on); markKnownWords(); });
    $('#showZh', root)?.addEventListener('click', e => { st.showZh = !st.showZh; saveSettings({ showZh: st.showZh }); e.currentTarget.classList.toggle('on', st.showZh); $$('.zh', root).forEach(z => z.classList.toggle('hide', !st.showZh)); });
    $$('[data-rate]', root).forEach(b => b.onclick = () => { st.rate = +b.dataset.rate; saveSettings({ rate: st.rate }); $$('[data-rate]', root).forEach(x => x.classList.toggle('on', x === b)); });
    $('#orig', root)?.addEventListener('click', e => { st.orig = !st.orig; e.currentTarget.textContent = st.orig ? '原录音' : '合成语音'; e.currentTarget.classList.toggle('on', st.orig); });
    $$('[data-pplay]', root).forEach(b => b.onclick = () => { const g = groups[+b.dataset.pplay]; run(g.start, true, [g.start, g.end]); });
    $('#sents', root)?.addEventListener('click', e => {
      const pe = e.target.closest('[data-pedit]'); if (pe) { stopAll(); st.edit = { kind: 'p', gi: +pe.dataset.pedit }; return draw().then(() => $('.sent.editing textarea', root)?.focus({ preventScroll: true })); }
      const pr = e.target.closest('[data-pretrans]'); if (pr) { const g = groups[+pr.dataset.pretrans]; return retrans(m.sentences.slice(g.start, g.end + 1).filter(s => s.edited), 'p' + pr.dataset.pretrans); }
      if (e.target.closest('[data-pcancel]')) { st.edit = null; return draw(); }
      if (e.target.closest('[data-psave]')) return saveEdits();
      const row = e.target.closest('.sent'); if (!row) return; const i = +row.dataset.i, s = m.sentences[i];
      if (e.target.closest('[data-edit]')) { stopAll(); st.edit = { kind: 's', i }; draw().then(() => $(`.sent[data-i="${i}"] textarea`, root)?.focus({ preventScroll: true })); }
      else if (e.target.closest('[data-ecancel]')) { st.edit = null; draw(); }
      else if (e.target.closest('[data-esave]')) saveEdits();
      else if (e.target.closest('[data-retrans]')) retrans([s], s.id);
      else if (row.classList.contains('editing')) return;
      else if (e.target.closest('[data-play]')) { if (root.classList.contains('playing') && st.cur === i && !st.loopOne) stopAll(); else run(i, false); }
      else if (e.target.closest('[data-practice]')) openPractice(ctx, s);
      else if (e.target.closest('[data-orig]')) { const my = ++st.tok; tts.cancel(); mark(i); root.classList.add('playing'); playOrig(s).catch(err => toast('原声无法播放：' + err.message)).finally(() => { if (my === st.tok) { root.classList.remove('playing'); $$('.sent', root).forEach(x => x.classList.remove('active')); } }); }
      else if (e.target.closest('[data-star]')) { const btn = e.target.closest('[data-star]'); toggleStar(ctx, s).then(on => { btn.textContent = on ? '★' : '☆'; btn.classList.toggle('on', on); }); }
      else if (e.target.closest('[data-w]')) openWordSheet(ctx, s, +e.target.closest('[data-w]').dataset.k);
    });
    // 句级
    $('#pract', root)?.addEventListener('click', () => openPractice(ctx, m.sentences[si]));
    $('#origSent', root)?.addEventListener('click', () => { st.tok++; tts.cancel(); playOrig(m.sentences[si]).catch(err => toast('原声无法播放：' + err.message)); });
    $('#anaBtn', root)?.addEventListener('click', () => openPractice(ctx, m.sentences[si], { focus: 'analysis' }));
    $('#sentDone', root)?.addEventListener('click', async () => {
      const s = m.sentences[si]; const done = !!m.progress?.done?.[s.id];
      if (done) { delete m.progress.done[s.id]; await db.materials.save(m); return draw(); }
      await markDone(m, [s.id], { lv: 'sent', si: Math.min(si + 1, N - 1) }); toast('已记录进度'); import('../progress.js').then(P => P.grant({ kind: 'sent', key: 'sent:' + s.id, label: '学完一句' })).catch(() => { }); go(si < N - 1 ? url('sent', si + 1) : url('sent', si));
    });
    $('#paraDone', root)?.addEventListener('click', async () => {
      const ids = m.sentences.slice(grp.start, grp.end + 1).map(s => s.id); const all = ids.every(x => m.progress?.done?.[x]);
      if (all) { ids.forEach(x => delete m.progress.done[x]); await db.materials.save(m); return draw(); }
      await markDone(m, ids, { lv: 'para', si: groups[Math.min(pi + 1, groups.length - 1)].start }); toast('本段已学完');
      import('../celebrate.js').then(C => C.sessionDone({ kind: 'unit', key: `unit:${m.id}:${m.sentences[grp.start].id}`, title: '本段学完了！', lines: [`《${m.title}》第 ${pi + 1} 段`, `${ids.length} 句`] })).catch(e => console.warn(e)); go(pi < groups.length - 1 ? url('para', groups[pi + 1].start) : url('para', grp.start));
    });
    // 录音播放器
    const a = $('#au', root);
    if (a) {
      let A = null, B = null, loop = false; const info = () => { $('#abInfo', root).textContent = (A == null && B == null) ? 'A / B 未设置。播放到想反复听的位置，点「设为 A/B 点」。' : `A=${A?.toFixed(1) ?? '—'}s  B=${B?.toFixed(1) ?? '—'}s`; };
      $$('[data-arate]', root).forEach(b => b.onclick = () => { a.playbackRate = +b.dataset.arate; $$('[data-arate]', root).forEach(x => x.classList.toggle('on', x === b)); });
      $('#setA', root).onclick = () => { A = a.currentTime; if (B != null && B <= A) B = null; info(); };
      $('#setB', root).onclick = () => { B = a.currentTime; if (A == null || B <= A) { toast('B 点要在 A 点之后'); B = null; } info(); };
      $('#abLoop', root).onclick = e => { if (A == null || B == null) return toast('请先设置 A 和 B 点'); loop = !loop; e.currentTarget.textContent = 'AB 循环：' + (loop ? '开' : '关'); e.currentTarget.classList.toggle('on', loop); if (loop) { a.currentTime = A; a.play(); } };
      $('#abClear', root).onclick = () => { A = B = null; loop = false; $('#abLoop', root).textContent = 'AB 循环：关'; $('#abLoop', root).classList.remove('on'); info(); };
      a.addEventListener('timeupdate', () => { if (loop && B != null && a.currentTime >= B) a.currentTime = A; });
      const fmt = t => `[${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}] `;
      $('#stamp', root)?.addEventListener('click', () => { const t = $('#typed', root); const pos = t.selectionStart; const pre = t.value.slice(0, pos); const nl = pre && !pre.endsWith('\n') ? '\n' : ''; t.setRangeText(nl + fmt(a.currentTime), pos, t.selectionEnd, 'end'); t.focus(); });
      $('#saveTyped', root)?.addEventListener('click', async () => {
        const lines = $('#typed', root).value.split('\n').map(s => s.trim()).filter(Boolean);
        const rows = lines.map(l => { const mm = l.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/); const t0 = mm ? +mm[1] * 60 + +mm[2] : null; const rest = mm ? mm[3] : l; const p = parseBilingual(rest)[0] || { en: rest, zh: '' }; return { speaker: p.speaker || '', en: p.en, zh: p.zh, t0 }; }).filter(r => r.en || r.zh);
        if (!rows.length) return toast('还没有内容');
        rows.forEach((r, i) => { r.t1 = rows[i + 1]?.t0 ?? null; });
        m.audioId = audioId; m.sentences = rows.map(r => ({ id: db.newId(), speaker: r.speaker, en: r.en, zh: r.zh, ...(r.t0 != null ? { t0: r.t0, t1: r.t1 } : {}) }));
        await db.materials.save(m); toast('已保存，可以逐句听读了'); render(root, [id], params);
      });
    }
    $('#autoWords', root)?.addEventListener('click', autoWords);
    $('#aiCards', root)?.addEventListener('click', aiCards);
    $('#editSents', root)?.addEventListener('click', () => { session.draft = { title: m.title, tags: [...(m.tags || [])], source: m.source, editId: m.id, audioId, ...(m.pauses ? { pauses: m.pauses } : {}), rows: m.sentences.map(s => ({ ...s })) }; go('#/draft'); });
    $('#info', root)?.addEventListener('click', infoSheet);
  };

  /** 保存正在编辑的句子（一句或一段）：只存，不翻译。生词卡 / 句子卡的原句跟着更新，复习进度不动。 */
  async function saveEdits() {
    let n = 0; const all = await db.cards.all();
    for (const row of $$('.sent.editing', root)) {
      const s = m.sentences[+row.dataset.i]; const en = $('[data-ef="en"]', row).value, zh = $('[data-ef="zh"]', row).value;
      if (!en.trim() && !zh.trim()) { toast('第 ' + (+row.dataset.i + 1) + ' 句中英文不能都空着（不要的句子可在「编辑句子」里删除）'); return; }
      const ch = SE.applyEdit(s, { en, zh }); if (!ch.en && !ch.zh) continue; n++;
      for (const c of SE.syncCards(all, s)) await db.cards.save(c);
    }
    st.edit = null;
    if (n) { await db.materials.save(m); toast(`已保存 ${n} 句修改。译文没有自动改，需要时点旁边的「重新翻译」`, 4000); } else toast('没有改动');
    draw();
  }
  /** 重新翻译（用户点了才做）：AI 已配置用 AI；电脑 Chrome 有端侧翻译用端侧；否则用 MyMemory（先征得同意）。失败不动原译文。 */
  async function retrans(list, key) {
    if (st.busy || !list.length) return;
    const dirs = [...new Set(list.map(SE.retransDir))];
    let prov = ai.isConfigured() ? 'ai' : null;
    if (!prov) { const cs = await Promise.all(dirs.map(TR.chromeStatus)); if (cs.every(x => x === 'available')) { try { for (const d of dirs) await TR.chromePrepare(d); prov = 'chrome'; } catch { } } }
    if (!prov) {
      if (!session.mmOk && !(await confirmDlg('要重新翻译的句子会发送到第三方公共翻译服务 MyMemory（免费、匿名额度约 5000 字/天）。涉及隐私的内容不要用。继续吗？', { ok: '继续翻译' }))) return;
      session.mmOk = true; prov = 'mymemory';
    }
    st.busy = key; draw();
    try {
      const n = await SE.retranslate(list, { provider: prov, translate: TR.translateTexts });
      const all = await db.cards.all(); for (const s of list) for (const c of SE.syncCards(all, s)) await db.cards.save(c);
      await db.materials.save(m); toast(`已重新翻译 ${n} 句（${SHORT[SE.retranslate.via || prov]}，可再改）`);
    } catch (e) { toast('重新翻译失败：' + e.message + '。原来的译文没有改动，可以稍后再点「重新翻译」', 6000); }
    st.busy = false; draw();
  }
  async function autoWords() {
    const btn = $('#autoWords', root); btn.disabled = true; btn.textContent = '分析中…';
    let cand; try { cand = await dict.candidates(m.sentences); } catch (e) { toast(e.message); btn.disabled = false; return; }
    btn.disabled = false; btn.textContent = '🔎 自动选生词（离线词典）';
    const have = new Set((await cards()).map(c => c.term.toLowerCase()));
    cand = cand.filter(c => !have.has(c.term.toLowerCase()));
    if (!cand.length) return toast('没有找到需要收藏的生词（常见词已过滤，或已全部收藏）');
    const sh = sheet(`<h3>离线选出的生词</h3><p class="muted small">按“不属于最常见 1500 词”筛选，释义来自离线词典 ECDICT（通用义项）。勾选要加入生词本的词，原句会一并保存。</p>
      <div class="pick">${cand.map((c, n) => `<label class="pickrow"><input type="checkbox" data-n="${n}" checked><span><b>${esc(c.term)}</b> <span class="muted">${esc(c.e?.phonetic ? '/' + c.e.phonetic + '/' : '')}</span><br><span class="small">${esc(c.e?.zh || '（词典没有，保存后手填）')}</span><br><span class="muted small">${esc(m.sentences[c.si].en)}</span></span></label>`).join('')}</div>
      <button class="btn primary" id="addPick">加入生词本</button>`);
    $('#addPick', sh.el).onclick = async () => {
      let n = 0; for (const cb of $$('input:checked', sh.el)) { const c = cand[+cb.dataset.n], s = m.sentences[c.si];
        await db.cards.save(makeCard({ type: 'word', term: c.term, zh: c.e?.zh || '', phonetic: c.e?.phonetic || '', sentence: { en: s.en, zh: s.zh }, material: m.id, sentenceId: s.id, source: c.e ? 'dict' : 'manual' })); n++; }
      toast(`已加入 ${n} 个生词`); sh.close(); draw();
    };
  }
  async function aiCards() {
    const b = $('#aiCards', root); b.disabled = true; b.textContent = '✨ AI 生成中…';
    try {
      const withEn = m.sentences.filter(s => s.en).slice(0, 60);
      const res = await ai.generateCards(withEn.map(s => ({ en: s.en, zh: s.zh })));
      const have = new Set((await cards()).map(c => c.term.toLowerCase())); const list = res.filter(r => !have.has(r.term.toLowerCase()));
      if (!list.length) { toast('AI 给出的词都已经在生词本里了'); return; }
      const sh = sheet(`<h3>AI 挑选的词卡</h3><p class="muted small">释义由 AI 生成，请自行判断。原句来自你的材料。</p><div class="pick">${list.map((c, n) => `<label class="pickrow"><input type="checkbox" data-n="${n}" checked><span><b>${esc(c.term)}</b> <span class="muted">${esc(c.phonetic ? '/' + c.phonetic + '/' : '')}</span> <span class="tag">${CARD_TYPE[c.type]}</span><br><span class="small">${esc(c.zh)}</span><br><span class="muted small">${esc(withEn[c.i].en)}</span></span></label>`).join('')}</div><button class="btn primary" id="addPick">加入生词本</button>`);
      $('#addPick', sh.el).onclick = async () => { let n = 0; for (const cb of $$('input:checked', sh.el)) { const c = list[+cb.dataset.n], s = withEn[c.i]; await db.cards.save(makeCard({ type: c.type, term: c.term, zh: c.zh, phonetic: c.phonetic, sentence: { en: s.en, zh: s.zh }, material: m.id, sentenceId: s.id, source: 'ai' })); n++; } toast(`已加入 ${n} 张词卡`); sh.close(); draw(); };
    } catch (e) { toast(e.message, 6000); }
    finally { const bb = $('#aiCards', root); if (bb) { bb.disabled = false; bb.textContent = '✨ 生成词卡'; } }
  }
  function infoSheet() {
    const sh = sheet(`<h3>材料信息</h3><div class="field"><label for="it">名称</label><input id="it" value="${esc(m.title)}"></div>
      <div class="field"><label for="itg">标签 / 场景（逗号分隔）</label><input id="itg" value="${esc((m.tags || []).join('，'))}"></div>
      <div class="row gap"><button class="btn danger" id="idel">删除${book ? '这一章' : '这份材料'}</button><button class="btn primary grow" id="isave">保存</button></div>`, { cls: 'small' });
    $('#isave', sh.el).onclick = async () => { m.title = $('#it', sh.el).value.trim() || m.title; m.tags = $('#itg', sh.el).value.split(/[,，、]+/).map(s => s.trim()).filter(Boolean); await db.materials.save(m); sh.close(); draw(); };
    $('#idel', sh.el).onclick = async () => { sh.close(); const back = book ? '#/book/' + book.id : '#/library';
      if (await deleteMaterials([m.id], { onChange: u => { if (u === 'undo') go('#/lesson/' + m.id); } })) go(back); };
  }

  await draw();
}
