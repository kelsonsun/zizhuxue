import * as db from '../db.js';
import * as tts from '../tts.js';
import * as S from '../sense.js';
import { compareWords } from '../textproc.js';
import { settings, makeCard } from '../state.js';
import * as P from '../practice.js';
import { undoBar } from '../matdelete.js';
import { dayNumber } from '../sm2.js';
import { paragraphs } from '../structure.js';
import { $, $$, esc, toast, hilite, go } from '../ui.js';

const MODES = [['zh2en', '看中文写英文', '给中文，你写英文，逐词判分'], ['dict', '听写', '听一句，把听到的写下来，逐词判分'], ['mcq', '词义选择', '看生词在你原句里的样子，选中文意思']];
// v1.6 以听、读、说、译为主（默写为辅）：每题自己选作答方式 选/说/译/写
const DRILLS = [['mix', '🎯 听说读译综合（推荐）', '听 35% · 读 20% · 说 20% · 译 15% · 写 10%；每题自己选：选 / 说 / 译 / 写'],
  ['listen', '🎧 听力', '听原声或朗读：选意思、选听到的英文，或复述'], ['read', '📖 阅读理解', '单句认读 + 篇章理解（材料里连续 2–4 句出理解题）：选意思/答问题，或大声读出来'],
  ['speak', '🗣️ 口说跟读', '先听再跟读 / 看中文说英文，语音识别后模糊判分'], ['trans', '🔁 翻译', '英译中为主（也可中译英），说或写；有 AI 用 AI 判分']];
const DRILL_NAME = Object.fromEntries(DRILLS.map(([k, t]) => [k, t.replace(/^\S+\s/, '').replace('（推荐）', '')]));
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
// 释义只在词义边界精简（不截断字、不留尾逗号），完整释义可展开
const shortZh = z => S.briefAll(z).text;
const POSZH = { v: '动词', n: '名词', a: '形容词', adv: '副词', prep: '介词', pron: '代词', conj: '连词', num: '数词', int: '感叹词' };

export async function render(root, [scope = 'all'], params) {
  const [mats, cards] = await Promise.all([db.materials.all(), db.cards.all()]);
  const [kind, sid, sx] = scope.split(':'); const lessonId = kind === 'lesson' || kind === 'para' || kind === 'sent' ? sid : null;
  let pool, cpool, title, backHref = '#/library', progKey = null;
  // 「熟练」的词/句不再出现在测验里（生词本里可恢复）
  const masteredSent = new Set(cards.filter(c => c.type === 'sentence' && P.isMastered(c)).map(c => c.sentenceId));
  const sentsOf = ms => ms.flatMap(m => m.sentences.map(s => ({ ...s, materialId: m.id }))).filter(s => s.en && !masteredSent.has(s.id));
  const okCards = c => (c.type === 'word' || c.type === 'phrase') && c.zh && !P.isMastered(c);
  if (kind === 'book') { const chs = mats.filter(m => m.bookId === sid); pool = chs; const ids = new Set(chs.map(c => c.id)); cpool = cards.filter(c => okCards(c) && ids.has(c.materialId)); title = '整本书：' + (mats.find(m => m.id === sid)?.title || ''); backHref = '#/book/' + sid; }
  else if (kind === 'para' || kind === 'sent') {
    const m = mats.find(x => x.id === sid); pool = m ? [m] : []; const g = m ? paragraphs(m) : [];
    const idxs = kind === 'sent' ? [+sx] : (g[+sx] ? Array.from({ length: g[+sx].end - g[+sx].start + 1 }, (_, i) => g[+sx].start + i) : []);
    const ids = new Set(idxs.map(i => m?.sentences[i]?.id)); if (m) pool = [{ ...m, sentences: m.sentences.filter(s => ids.has(s.id)) }];
    cpool = cards.filter(c => okCards(c) && ids.has(c.sentenceId)); title = (m?.title || '') + (kind === 'sent' ? ` · 第 ${+sx + 1} 句` : ` · 第 ${+sx + 1} 段`);
    backHref = `#/lesson/${sid}?lv=${kind}&si=${kind === 'sent' ? sx : g[+sx]?.start || 0}`; progKey = kind === 'para' ? 'para' + sx : null;
  } else if (kind === 'lesson') { pool = mats.filter(m => m.id === sid); cpool = cards.filter(c => okCards(c) && c.materialId === sid); title = pool[0]?.title || ''; backHref = '#/lesson/' + sid; progKey = 'lesson'; }
  else { pool = mats; cpool = cards.filter(okCards); title = '全部材料'; }
  const sents = sentsOf(pool), sentsAll = sents; const cpoolAll = cpool;
  const menu = () => {
    root.innerHTML = `<header class="top"><a class="back" href="${backHref}">‹</a><h1>测验</h1><span class="muted">范围：${esc(title)}</span></header>
      <p class="muted small qintro">成年人学英语，先要<b>听得懂、看得懂、认得出</b>，再<b>说得出</b>：这里以听、读、说、译为主，拼写默写只占少量。每题先选<b>不会 / 模糊 / 会 / 熟练</b>，再用你选的方式作答。</p>
      <div class="list">${DRILLS.map(([k, t, d], x) => { const n = k === 'trans' ? sents.filter(s => s.zh).length + cpool.length : sents.length + cpool.length;
        return `<button class="item modeb ${x === 0 ? 'primary-item' : ''}" data-m="${k}" ${n ? '' : 'disabled'}><b>${t}</b><span class="muted">${d} · 可用 ${n} 题</span></button>`; }).join('')}</div>
      <h3 class="qsub">默写 / 单项（辅）</h3>
      <div class="list">${MODES.map(([k, t, d]) => {
        const n = k === 'zh2en' ? sents.filter(s => s.zh).length : k === 'dict' ? sents.length : cpool.length;
        return `<button class="item modeb" data-m="${k}" ${n ? '' : 'disabled'}><b>${t}</b><span class="muted">${d} · 可用 ${n} 题</span></button>`; }).join('')}</div>
      ${(!sents.length) ? '<div class="note">这个范围里还没有句子。</div>' : ''}
      ${(!cpool.length) ? '<div class="note">“词义选择”需要先收藏带释义的生词。</div>' : ''}`;
    $$('.modeb', root).forEach(b => b.onclick = () => start(b.dataset.m));
  };
  async function start(mode) {
    if (DRILL_NAME[mode]) return startDrill(mode);
    let qs; const sentMastered = id => P.isMastered(cards.find(c => c.type === 'sentence' && c.sentenceId === id));
    const sents = sentsAll.filter(s => !sentMastered(s.id)), cpool = cpoolAll.filter(c => !P.isMastered(c)); // 本轮/上一轮标成熟练的不再出
    if (mode === 'zh2en') qs = shuffle(sents.filter(s => s.zh)).slice(0, 10).map(s => ({ s }));
    else if (mode === 'dict') qs = shuffle(sents).slice(0, 10).map(s => ({ s }));
    else {
      qs = shuffle(cpool).slice(0, 10);
      qs = await Promise.all(qs.map(async c => {
        // 题目释义：优先取与原句中该词词性一致的义项（如 “When did the pain start?” 里 start 是动词）
        const sense = await S.contextSense(c);
        const others = shuffle(cards.filter(x => x.id !== c.id && x.term.toLowerCase() !== c.term.toLowerCase()).map(x => x.zh).filter(Boolean));
        const dis = await S.distractors(sense, others, 3);
        // vi./vt. 在选项里统一显示为 v.，避免词性标记本身成为答案线索
        const optText = x => S.briefText({ ...x, pos: S.posKey(x.pos) === 'v' ? 'v.' : x.pos }, 4);
        const opts = shuffle([{ t: optText(sense), ok: true }, ...dis.map(d => ({ t: optText(d), ok: false }))]);
        return { c, opts, sense };
      }));
    }
    let i = 0; const res = [];
    const next = () => { i++; i >= qs.length ? summary() : ask(); };
    const head = () => `<header class="top"><h1>${MODES.find(m => m[0] === mode)[1]}</h1><span class="muted">第 ${i + 1} / ${qs.length} 题</span></header><div class="bar"><i style="width:${Math.round(100 * i / qs.length)}%"></i></div>`;
    const choicesHtml = () => `<div class="choices" role="group" aria-label="先选：你会吗？">${P.CHOICES.map(([k, t]) => `<button class="btn ch ch-${k}" data-ch="${k}">${{ dunno: '🙈', fuzzy: '🤔', know: '🙂', master: '⭐' }[k]} ${t}</button>`).join('')}</div>
      <p class="muted small chnote">先选再答：<b>不会</b>直接看答案（明天再练）·<b>模糊</b>先给提示再答·<b>会</b>直接答·<b>熟练</b>以后不再出（可撤销）</p>`;
    const dayLabel = d => d <= 0 ? '今天' : d === 1 ? '明天' : d + '天后';
    const nextHtml = days => `<p class="muted small nextdue">下次复习：<b>${dayLabel(days)}</b></p><button class="btn primary big" id="nx">${i + 1 >= qs.length ? '看结果' : '下一题'}</button>`;
    const bindNx = () => { $('#nx', root).onclick = next; $('#nx', root).focus({ preventScroll: true }); $('#fb', root).scrollIntoView({ block: 'nearest' }); };
    // 每个选择都写回这道题对应的卡（句子还没有卡就自动建一张，进入复习）：不会 1 天；模糊 对 9/错 3；会 对 12/错 1；熟练 不再出现
    async function ensureCard(q) {
      if (q.c) return q.c; const s = q.s; let c = cards.find(x => x.type === 'sentence' && x.sentenceId === s.id);
      if (!c) { c = makeCard({ type: 'sentence', term: s.en, zh: s.zh, sentence: { en: s.en, zh: s.zh }, material: s.materialId, sentenceId: s.id, source: 'quiz' }); cards.push(c); }
      return q.c = c;
    }
    async function schedule(q, choice, ok, score = null) {
      const c = await ensureCard(q); const prev = c.sch; const r = P.scheduleChoice(c.sch, choice, ok); c.sch = r.sch; await db.cards.save(c);
      await db.reviews.add({ cardId: c.id, q: r.q, choice, correct: choice === 'master' ? null : !!ok, days: r.days, ts: Date.now(), day: dayNumber(), mode: 'quiz', qtype: mode, score });
      return { days: r.days, c, prev };
    }
    function keepVisible(input, row) {
      const fit = () => { if (document.activeElement === input && row.isConnected) row.scrollIntoView({ block: 'nearest' }); };
      input.addEventListener('focus', () => setTimeout(fit, 250)); window.visualViewport?.addEventListener('resize', fit); window.addEventListener('resize', fit);
    }
    async function master(q) {
      const { c, prev } = await schedule(q, 'master', true); res.push({ q, choice: 'master' }); const at = i;
      undoBar(`「${c.term.length > 24 ? c.term.slice(0, 23) + '…' : c.term}」已标为熟练，以后不再出现`, async () => {
        c.sch = prev; await db.cards.save(c); await db.reviews.add({ cardId: c.id, q: null, choice: 'restore', ts: Date.now(), day: dayNumber(), mode: 'undo' });
        const k = res.findIndex(r => r.q === q && r.choice === 'master'); if (k >= 0) res.splice(k, 1);
        if (root.isConnected && i === at + 1 && !$('#nx', root)) { i = at; ask(); } toast('已撤销，恢复练习');
      }, 10000);
      next();
    }
    function ask() {
      const q = qs[i]; let choice = null;
      const choose = ch => { if (choice) return; choice = ch; if (ch === 'master') return master(q); $('.choices', root).outerHTML = `<div class="chosen muted small">你选了：<b>${P.CHOICE_ZH[ch]}</b>${ch === 'fuzzy' ? '（对了 9 天后再练，错了 3 天后）' : ch === 'know' ? '（对了 12 天后再练，错了 1 天后）' : '（明天再练）'}</div>`; $('.chnote', root)?.remove(); (mode === 'mcq' ? mcqArea : textArea)(ch); };
      if (mode === 'mcq') {
        root.innerHTML = head() + `<section class="rvcard"><div class="rv-term">${esc(q.c.term)}</div><button class="btn" id="say">🔊 听</button><div class="rv-sent">${hilite(q.c.sentence?.en || '', q.c.term)}</div></section>
          ${choicesHtml()}<div id="area"></div><div id="fb"></div>`;
        $('#say', root).onclick = () => tts.speak(q.c.term).catch(e => toast(e.message));
      } else {
        const s = q.s;
        root.innerHTML = head() + `<section class="rvcard">${mode === 'zh2en' ? `<div class="rv-zh">${esc(s.zh)}</div>` : `<div class="muted">听一句，写下你听到的</div><div class="row gap center"><button class="btn primary" id="say">🔊 播放</button><button class="btn" id="slow">🐢 慢速</button></div>`}</section>
          ${choicesHtml()}<div id="area"></div><div id="fb"></div>`;
        if (mode === 'dict') { const sp = r => tts.speak(s.en, { rate: r }).catch(e => toast(e.message)); $('#say', root).onclick = () => sp(settings.rate); $('#slow', root).onclick = () => sp(0.6); setTimeout(() => sp(settings.rate), 300); }
      }
      $$('[data-ch]', root).forEach(b => b.onclick = () => choose(b.dataset.ch));
      const senseInfo = () => `${q.sense.ctxPos && POSZH[q.sense.ctxPos] ? `<div class="muted small">按原句里的词性（${POSZH[q.sense.ctxPos]}，本地标注，仅供参考）选取的义项</div>` : ''}`;
      async function mcqArea(ch) {
        if (ch === 'dunno') {
          res.push({ q, choice: ch, ok: false, score: 0 }); const { days } = await schedule(q, 'dunno', false);
          $('#area', root).innerHTML = `<div class="opts" role="group" aria-label="选项">${q.opts.map((o, k) => `<button class="btn opt ${o.ok ? 'right' : ''}" data-k="${k}"${o.ok ? ' data-ok' : ''} disabled>${esc(o.t)}</button>`).join('')}</div>`;
          $('#fb', root).innerHTML = `<div class="fb low dunnofb">🙈 没关系。正确答案：<span class="ans">${esc(S.briefText(q.sense, 6))}</span>
            <div class="rv-en">${esc(q.c.term)} <button class="mini" id="hear2" aria-label="听发音">🔊</button></div>${q.c.sentence?.zh ? `<div class="muted small">原句：${esc(q.c.sentence.zh)}</div>` : ''}${senseInfo()}</div>
            ${q.sense.all ? `<details class="allsense"><summary>展开全部释义</summary>${S.fullHtml(q.sense.all)}</details>` : ''}${nextHtml(days)}`;
          $('#hear2', root).onclick = () => tts.speak(q.c.term).catch(e => toast(e.message)); return bindNx();
        }
        const keep = ch === 'fuzzy' ? new Set(P.eliminate(q.opts)) : null;
        $('#area', root).innerHTML = `${keep ? `<div class="hintbox" id="hintbox">💡 提示：已去掉 ${q.opts.length - keep.size} 个干扰项</div>` : ''}<div class="opts" role="group" aria-label="选项">${q.opts.map((o, k) => `<button class="btn opt ${keep && !keep.has(k) ? 'elim' : ''}" data-k="${k}"${o.ok ? ' data-ok' : ''}${keep && !keep.has(k) ? ' disabled aria-disabled="true"' : ''}>${esc(o.t)}</button>`).join('')}</div>`;
        $$('.opt', root).forEach(b => b.onclick = async () => {
          if ($('#nx', root) || b.disabled) return; const o = q.opts[+b.dataset.k];
          $$('.opt', root).forEach((x, k) => { x.disabled = true; if (q.opts[k].ok) x.classList.add('right'); else if (x === b) x.classList.add('bad'); });
          res.push({ q, choice: ch, ok: o.ok, score: o.ok ? 100 : 0 }); const { days } = await schedule(q, ch, o.ok, o.ok ? 100 : 0);
          $('#fb', root).innerHTML = `<div class="fb ${o.ok ? 'good' : 'low'}">${o.ok ? '✓ 答对了' : '✗ 正确答案：<span class="ans">' + esc(S.briefText(q.sense, 6)) + '</span>'}${senseInfo()}</div>
            ${q.sense.all ? `<details class="allsense"><summary>展开全部释义</summary>${S.fullHtml(q.sense.all)}</details>` : ''}${nextHtml(days)}`;
          bindNx();
        });
      }
      async function textArea(ch) {
        const s = q.s;
        if (ch === 'dunno') {
          tts.cancel(); res.push({ q, choice: ch, ok: false, score: 0 }); const { days } = await schedule(q, 'dunno', false);
          $('#fb', root).innerHTML = `<div class="fb low dunnofb">🙈 没关系。参考答案：
            <div class="rv-en">${esc(s.en)} <button class="mini" id="hear2" aria-label="听发音">🔊</button></div>${s.zh ? `<div class="muted">${esc(s.zh)}</div>` : ''}<div class="muted small">已加入复习，明天再练。</div></div>${nextHtml(days)}`;
          $('#hear2', root).onclick = () => tts.speak(s.en).catch(e => toast(e.message)); return bindNx();
        }
        const h = P.hintText(s.en);
        $('#area', root).innerHTML = `${ch === 'fuzzy' ? `<div class="hintbox" id="hintbox">💡 提示：<b class="hintl">${esc(h.letters)}</b>（${h.count} 个词）</div>` : ''}
          <textarea id="ans" rows="3" placeholder="在这里写英文……" aria-label="你的答案" autocapitalize="sentences" spellcheck="false"></textarea>
          <div class="row gap ansrow"><button class="btn primary grow" id="sub">提交判分</button>${mode === 'zh2en' ? '<button class="btn" id="hear">🔊 听答案</button>' : ''}</div>`;
        keepVisible($('#ans', root), $('.ansrow', root)); setTimeout(() => $('#ans', root)?.focus(), 50);
        $('#hear', root)?.addEventListener('click', () => tts.speak(s.en).catch(e => toast(e.message)));
        $('#sub', root).onclick = async (e) => {
          const ans = $('#ans', root).value.trim(); if (!ans) return toast('先写一点再提交');
          const btn = e.currentTarget; btn.disabled = true; $('#ans', root).readOnly = true;
          const r = compareWords(s.en, ans); const ok = P.isCorrect(r.score); res.push({ q, choice: ch, ok, score: r.score });
          const { days } = await schedule(q, ch, ok, r.score);
          $('#fb', root).innerHTML = `<div class="score ${r.score >= 80 ? 'good' : r.score >= 50 ? 'mid' : 'low'}"><b>${r.score}</b> 分 · ${ok ? '✓ 算答对' : '✗ 没答对'}</div>
            <div class="diff">${r.tokens.map(t => `<span class="${t.status}" ${t.heard ? `title="你写的：${esc(t.heard)}"` : ''}>${esc(t.w)}</span>`).join(' ')}</div>
            <div class="muted small">参考答案：${esc(s.en)} <button class="mini" id="hear2" aria-label="听发音">🔊</button>${s.zh ? '<br>' + esc(s.zh) : ''}${r.extra.length ? '<br>多写的词：' + esc(r.extra.join(' ')) : ''}</div>
            <div class="muted small">逐词比对，80 分及以上算答对；不同但自然的说法也可能是对的；大小写和标点不扣分。</div>${nextHtml(days)}`;
          $('#hear2', root).onclick = () => tts.speak(s.en).catch(e => toast(e.message)); bindNx();
        };
      }
    }
    function summary() {
      // 「熟练」跳过的不计分；「不会」算 0 分
      const first = res.filter(r => r.choice !== 'master'); const avg = first.length ? Math.round(first.reduce((a, r) => a + r.score, 0) / first.length) : 0, wrong = first.filter(r => !r.ok);
      const cnt = k => res.filter(r => r.choice === k).length; const nGave = cnt('dunno');
      if (progKey && pool[0]) db.materials.get(sid).then(mm => { if (!mm) return; mm.progress = mm.progress || { done: {}, last: null, quiz: {} }; mm.progress.quiz = mm.progress.quiz || {}; mm.progress.quiz[progKey] = Math.max(avg, mm.progress.quiz[progKey] ?? 0); db.materials.save(mm); });
      root.innerHTML = `<header class="top"><h1>测验结果</h1></header><section class="rvcard"><div class="score ${avg >= 80 ? 'good' : avg >= 50 ? 'mid' : 'low'}"><b>${avg}</b> 分</div><p>答对 ${first.length - wrong.length} / ${first.length} 题</p><p class="muted small">不会 ${nGave} · 模糊 ${cnt('fuzzy')} · 会 ${cnt('know')} · 熟练 ${cnt('master')}（熟练的不计分、以后不再出现）</p></section>
        ${wrong.length ? `<h2>需要再练的</h2><div class="list">${wrong.map(r => `<div class="item"><b>${esc(r.q.s?.en || r.q.c.term)}${r.choice ? ` <span class="tag">${P.CHOICE_ZH[r.choice]}</span>` : ''}</b><span class="muted">${esc(r.q.s?.zh || (r.q.sense ? S.briefText(r.q.sense, 6) : shortZh(r.q.c.zh)))}</span></div>`).join('')}</div><p class="muted small">这些都已自动加入复习：不会/会但答错 → 明天，模糊答错 → 3 天后。</p>` : '<p class="muted">全部答对，漂亮！</p>'}
        <div class="row gap"><button class="btn" id="again">再来一轮</button><a class="btn" href="#/">首页</a></div>`;
      $('#again', root).onclick = () => start(mode);
      import('../celebrate.js').then(C => C.sessionDone({ key: 'quiz:' + Date.now(), title: '测验完成！', n: first.length, ok: first.length - wrong.length, avg, lines: [`不会 ${nGave} · 模糊 ${cnt('fuzzy')} · 会 ${cnt('know')}`] })).catch(e => console.warn(e));
    }
    ask();
  }
  async function startDrill(task) {
    const { runDrill, pickItems } = await import('./drillrun.js');
    const sentMastered = id => P.isMastered(cards.find(c => c.type === 'sentence' && c.sentenceId === id));
    const ss = sentsAll.filter(s => !sentMastered(s.id)), ws = cpoolAll.filter(c => !P.isMastered(c));
    // 读：加篇章阅读理解（材料里连续 2–4 句）；单练“读”最多 3 段，综合 1 段
    const D = await import('../drill.js'); const wantP = task === 'read' ? 3 : task === 'mix' ? 1 : 0;
    const pas = wantP ? D.passages(pool.flatMap(m => (m.sentences || []).map(s => ({ ...s, materialId: m.id }))), { want: wantP }) : [];
    const items = [...pickItems(task === 'trans' ? ss.filter(s => s.zh) : ss, ws, 10 - pas.length), ...pas].sort(() => Math.random() - 0.5);
    if (!items.length) { toast('这个范围里没有可练的句子或生词'); return menu(); }
    const poolS = sentsOf(mats.filter(m => !m.kind)).length >= 8 ? sentsOf(mats.filter(m => !m.kind)) : sentsAll; // 选择题干扰项：先用本范围，不够用全部材料
    const dpool = [...sentsAll, ...poolS];
    runDrill(root, { task, items, pool: dpool, cards, mats, title, heading: DRILL_NAME[task], onDone: res => drillSummary(task, res) });
  }
  function drillSummary(task, res) {
    const first = res.filter(r => r.choice !== 'master'); const scored = first.map(r => r.choice === 'dunno' ? 0 : r.score ?? (r.ok ? 100 : 0));
    const avg = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : 0, wrong = first.filter(r => !r.ok);
    const cnt = k => res.filter(r => r.choice === k).length;
    if (progKey && pool[0]) db.materials.get(sid).then(mm => { if (!mm) return; mm.progress = mm.progress || { done: {}, last: null, quiz: {} }; mm.progress.quiz = mm.progress.quiz || {}; mm.progress.quiz[progKey] = Math.max(avg, mm.progress.quiz[progKey] ?? 0); db.materials.save(mm); });
    const TK = { listen: '🎧 听', read: '📖 读', speak: '🗣️ 说', trans: '🔁 译', write: '✍️ 写' }; const MZ = { choose: '选', say: '说', trans: '译', write: '写' };
    const by = Object.keys(TK).map(k => [k, first.filter(r => r.task === k)]).filter(([, a]) => a.length);
    root.innerHTML = `<header class="top"><h1>测验结果</h1><span class="muted">${esc(DRILL_NAME[task])} · ${esc(title)}</span></header><section class="rvcard"><div class="score ${avg >= 80 ? 'good' : avg >= 50 ? 'mid' : 'low'}"><b>${avg}</b> 分</div><p>答对 ${first.length - wrong.length} / ${first.length} 题</p>
      <p class="muted small">不会 ${cnt('dunno')} · 模糊 ${cnt('fuzzy')} · 会 ${cnt('know')} · 熟练 ${cnt('master')}（熟练的不计分、以后不再出现）</p></section>
      <h2>听 · 读 · 说 · 译 · 写</h2><div class="skilltab">${by.map(([k, a]) => `<div class="sk"><b>${TK[k]}</b><span>${a.filter(r => r.ok).length}/${a.length} 对</span><span class="muted small">${[...new Set(a.map(r => MZ[r.mode]))].join('/')}</span></div>`).join('')}</div>
      ${wrong.length ? `<h2>需要再练的</h2><div class="list">${wrong.map(r => `<div class="item"><b>${esc(r.it.en)} <span class="tag">${P.CHOICE_ZH[r.choice]}</span></b><span class="muted">${esc(r.it.zh)}</span></div>`).join('')}</div><p class="muted small">这些都已自动加入复习：不会/会但答错 → 明天，模糊答错 → 3 天后${res.some(r => r.it.kind === 'passage') ? '（篇章题只记成绩，不单独排复习）' : ''}。</p>` : '<p class="muted">全部答对，漂亮！</p>'}
      <div class="row gap"><button class="btn" id="again">再来一轮</button><a class="btn" href="#/">首页</a></div>`;
    $('#again', root).onclick = () => startDrill(task);
    import('../celebrate.js').then(C => C.sessionDone({ key: 'drill:' + Date.now(), title: `${DRILL_NAME[task]} 完成！`, n: first.length, ok: first.length - wrong.length, avg, lines: by.map(([k, a]) => `${TK[k]} ${a.filter(r => r.ok).length}/${a.length}`) })).catch(e => console.warn(e));
  }
  if (params?.m) start(params.m); else menu();
}
