// 复习 = 练习：按遗忘曲线选内容，按难度“易→难、易难交叉、最难压轴”出题；每题可用语音或文字作答，判分回写 SM-2。
import * as db from '../db.js';
import * as tts from '../tts.js';
import * as dict from '../dict.js';
import * as sp from '../speech.js';
import * as P from '../practice.js';
import * as S from '../sense.js';
import { dayNumber } from '../sm2.js';
import { settings, saveSettings, CARD_TYPE } from '../state.js';
import { onLeave } from '../app.js';
import { $, $$, esc, toast } from '../ui.js';
import { tokenize } from '../textproc.js';
import { undoBar } from '../matdelete.js';
import { mountRootBox, partsTiles } from '../rootbox.js';
import * as R from '../roots.js';

const dayLabel = d => d <= 0 ? '今天' : d === 1 ? '明天' : d + '天后';
const pct = x => Math.round(x * 100) + '%';
export const isIosStandalone = () => /iP(hone|ad|od)/.test(navigator.userAgent) && (navigator.standalone === true || matchMedia?.('(display-mode: standalone)').matches);
/** 语音识别能不能用：API 不存在 → 不可用；iPhone 主屏应用 → 苹果不提供（API 可能存在但不工作）。 */
export function asrStatus() {
  if (!sp.asrSupported()) return { ok: false, why: '这个浏览器没有语音识别功能。' };
  if (isIosStandalone() && !settings.forceAsr) return { ok: false, why: 'iPhone 装到主屏后打开时，苹果不让网页用语音识别（只有在 Safari 浏览器里打开才行）。' };
  if (!settings.useAsr) return { ok: false, why: '你在「我的」里关掉了语音识别。' };
  return { ok: true };
}

async function rankMap(cards) {
  const words = new Set(); cards.forEach(c => tokenize(c.term).forEach(w => words.add(w)));
  const m = new Map(); await Promise.all([...words].map(async w => { const d = await dict.lookup(w).catch(() => null); m.set(w, d?.rank ?? null); })); return m;
}
const mask = (sent, term) => { const i = sent.toLowerCase().indexOf(term.toLowerCase()); return i < 0 ? esc(sent) : esc(sent.slice(0, i)) + '<span class="blank">' + '＿'.repeat(Math.min(8, Math.max(3, term.length))) + '</span>' + esc(sent.slice(i + term.length)); };

export async function render(root, _a, params = {}) {
  const cards = await db.cards.all(); const reviews = await db.reviews.all(); const today = dayNumber();
  const hist = new Map(); for (const r of reviews) { if (r.q == null) continue; /* 熟练/撤销：不是作答 */ if (!hist.has(r.cardId)) hist.set(r.cardId, []); hist.get(r.cardId).push(r.q); }
  const sel = P.selectCards(cards, { newLimit: settings.newLimit, max: settings.dailyMax || 40, extra: params.extra ? 10 : 0, today });
  if (!sel.picked.length) {
    const seen = cards.filter(c => c.sch && c.sch.seen > 0); const nextDue = seen.map(c => c.sch.due).sort((a, b) => a - b)[0];
    root.innerHTML = `<header class="top"><h1>复习练习</h1></header><div class="empty"><div class="big-emoji">🎉</div><p>${cards.length ? '今天没有需要复习的卡片了。' : '还没有卡片可复习。'}</p>
      <p class="muted">${nextDue != null ? `下一批在 ${dayLabel(nextDue - today)}到期。` : '在材料里点单词收藏，或点 ☆ 收藏句子，就会出现在这里。'}</p>
      ${seen.length ? `<button class="btn" id="extra">加练：遗忘概率最高的 ${Math.min(10, seen.length)} 张</button>` : ''}<a class="btn primary" href="#/library">去材料库</a></div>`;
    $('#extra', root)?.addEventListener('click', () => render(root, _a, { extra: 1 }));
    return;
  }
  const ranks = await rankMap(sel.picked);
  const items = sel.picked.map(c => { const d = P.difficulty(c, { rankOf: w => ranks.get(w), hist: hist.get(c.id) || [], today }); return { c, diff: d.score, parts: d.parts, fp: P.forgetProb(c, today) }; });
  const { order, tailFrom } = P.orderEasyToHard(items);
  order.forEach((x, i) => { x.tail = i >= tailFrom; });
  // 题型：按熟练度 + 避免连续同型
  let prevT = null; for (const x of order) { x.qt = P.chooseType(x.c, prevT); prevT = x.qt; }
  // 看中文说英文：词卡只给与原句词性一致的义项，避免“动词用法却给名词义”
  await Promise.all(order.map(async x => { if (x.qt === 'zh2en' && x.c.type !== 'sentence') x.sense = await S.contextSense(x.c).catch(() => null); }));

  const plan = () => {
    root.innerHTML = `<header class="top"><h1>今日复习练习</h1><span class="muted">按遗忘曲线挑出 ${order.length} 项 · 到期 ${sel.dueCount} · 新 ${sel.newCount}</span></header>
      <div class="note small">顺序：先易后难，中间易难交叉，<b>最难的放在最后</b>。难度分 = 词汇难度（词频/句长）40% + 你的历史错误率 25% + 记忆难度 EF 15% + 此刻遗忘概率 20%。每题先选<b>不会 / 模糊 / 会 / 熟练</b>，再<b>说</b>或<b>写</b>英文来回答。</div>
      <button class="btn primary big" id="go">开始练习（${order.length} 题）</button>
      <h2>本轮顺序</h2><ol class="plan">${order.map((x, i) => `<li class="pl ${x.tail ? 'tail' : ''}" data-i="${i}"><span class="pl-t">${esc(x.c.term.length > 42 ? x.c.term.slice(0, 41).replace(/\s+\S*$/, '') + '…' : x.c.term)}</span>
        <span class="pl-m"><span class="lvl-${P.level(x.diff)}">${P.level(x.diff)} ${x.diff}</span> · ${P.QTYPES[x.qt]} · ${x.c.sch?.seen ? '遗忘概率 ' + pct(x.fp) : '新'}${x.tail ? ' · 压轴' : ''}</span>
        <i class="dbar"><b style="width:${x.diff}%"></b></i></li>`).join('')}</ol>`;
    $('#go', root).onclick = () => draw();
  };

  const queue = order.slice(); const total = order.length; let done = 0; const scores = []; const tally = { dunno: 0, fuzzy: 0, know: 0, master: 0, ok: 0, bad: 0 };
  let st = null, recorder = null;
  onLeave(() => { tts.cancel(); recorder?.stop().catch(() => { }); document.querySelector('#undobar')?.remove(); });

  const prompt = (x) => {
    const c = x.c;
    if (x.qt === 'listen') return `<div class="rv-q muted">${c.type === 'sentence' ? '听一句，把它说出来或写下来' : '听一听，把这个' + (CARD_TYPE[c.type] || '词') + '说出来或写下来'}</div><div class="row gap center"><button class="btn primary" id="say">🔊 播放</button><button class="btn" id="slow">🐢 慢速</button></div>`;
    if (x.qt === 'parts') return `<div class="rv-q muted">拆解推测：看词根词缀，猜这个词的意思</div><div class="rv-en">${esc(c.term)}</div><div class="rbox rv-parts">${partsTiles(c.term)}</div>`;
    if (x.qt === 'rootm') { const rq = x.rq || (x.rq = P.rootQuestion(c, 'rootm')); return `<div class="rv-q muted">词根配对：<b class="rv-root">${esc(rq.root.forms.join(' / '))}</b> 是什么意思？</div><div class="muted small">出自 ${esc(c.term)}</div>`; }
    if (x.qt === 'cloze') return `<div class="rv-q muted">原句填空：空里应该是什么？</div><div class="rv-sent">${mask(c.sentence.en, c.term)}</div>${c.sentence.zh ? `<div class="muted">${esc(c.sentence.zh)}</div>` : ''}<div class="muted small">提示：${esc(c.zh || '')}</div>`;
    return `<div class="rv-q muted">${c.type === 'sentence' ? '用英文说出/写出这句话' : '这个意思用英文怎么说？'}</div>${c.type !== 'sentence' && x.sense ? `<div class="rv-zh">${esc(S.briefText({ pos: x.sense.pos, zh: x.sense.zh }, 99))}</div>${S.parse(c.zh).length > 1 ? `<details class="allsense"><summary>展开全部释义</summary>${S.fullHtml(c.zh)}</details>` : ''}` : `<div class="rv-zh">${esc(c.zh)}</div>`}${c.type !== 'sentence' && c.sentence?.zh ? `<div class="muted small">语境：${esc(c.sentence.zh)}</div>` : ''}`;
  };
  const speakRef = (rate = settings.rate) => tts.speak(st.x.c.term, { rate }).catch(e => toast(e.message));
  const bump = k => { const h = document.documentElement; h.dataset[k] = String((+h.dataset[k] || 0) + 1); }; // 给新手引导用：是否已选过/点过下一题

  function draw() {
    if (!queue.length) return finish();
    const x = queue[0]; st = { x, choice: null, result: null, mode: settings.answerMode || 'voice', audio: null };
    root.innerHTML = `<header class="top"><h1>复习练习</h1><span class="muted">${done}/${total} · 剩 ${queue.length}</span></header>
      <div class="bar"><i style="width:${Math.round(100 * done / total)}%"></i></div>
      <section class="rvcard" data-cid="${esc(x.c.id)}" data-qt="${x.qt}"><span class="tag">${(CARD_TYPE[x.c.type] || '词')}${x.c.sch?.seen ? '' : ' · 新'} · ${P.QTYPES[x.qt]} · <span class="lvl-${P.level(x.diff)}">${P.level(x.diff)}</span>${x.tail ? ' · 压轴' : ''}</span>${prompt(x)}</section>
      ${choicesHtml()}
      <div id="ansarea"></div><div id="fb"></div>`;
    $('#say', root)?.addEventListener('click', () => speakRef());
    $('#slow', root)?.addEventListener('click', () => speakRef(0.6));
    if (x.qt === 'listen') setTimeout(() => { if (st?.x === x) speakRef(); }, 300);
    $$('[data-ch]', root).forEach(b => b.onclick = () => choose(b.dataset.ch));
  }
  function choose(ch) {
    if (st.choice) return; st.choice = ch; bump('rvChose');
    if (ch === 'dunno') return giveUp();
    if (ch === 'master') return master();
    $('.choices', root).outerHTML = `<div class="chosen muted small">你选了：<b>${P.CHOICE_ZH[ch]}</b>${ch === 'fuzzy' ? '（对了 9 天后再练，错了 3 天后）' : '（对了 12 天后再练，错了 1 天后）'}</div>`;
    $('.chnote', root)?.remove();
    const c = st.x.c, h = P.hintText(c.term);
    if (st.x.qt === 'parts' || st.x.qt === 'rootm') return mcBox(ch);
    $('#ansarea', root).innerHTML = `${ch === 'fuzzy' ? `<div class="hintbox" id="hintbox">💡 提示：<b class="hintl">${esc(h.letters)}</b>（${h.count} 个词）${st.x.qt !== 'zh2en' && c.zh ? `<div class="muted small">中文：${esc(c.zh)}</div>` : ''}</div>` : ''}
      <div class="seg ansmode" role="tablist"><a role="tab" data-mode="voice" class="${st.mode === 'voice' ? 'on' : ''}">🎙️ 说出来</a><a role="tab" data-mode="text" class="${st.mode === 'text' ? 'on' : ''}">⌨️ 写出来</a></div><div id="ansbox"></div>`;
    $$('[data-mode]', root).forEach(b => b.onclick = () => { st.mode = b.dataset.mode; saveSettings({ answerMode: st.mode }); $$('[data-mode]', root).forEach(y => y.classList.toggle('on', y === b)); ansBox(); });
    ansBox();
    if (st.mode === 'text') setTimeout(() => $('#ans', root)?.focus(), 50);
  }
  const choicesHtml = () => `<div class="choices" role="group" aria-label="先选：你会吗？">${P.CHOICES.map(([k, t]) => `<button class="btn ch ch-${k}" data-ch="${k}">${{ dunno: '🙈', fuzzy: '🤔', know: '🙂', master: '⭐' }[k]} ${t}</button>`).join('')}</div>
      <p class="muted small chnote">先选再答：<b>不会</b>直接看答案（明天再练）·<b>模糊</b>先给提示再答·<b>会</b>直接答·<b>熟练</b>以后不再出（可撤销）</p>`;
  // v1.5 选择题（拆解推测 / 词根配对）：模糊先给提示；选完按同样的四按钮规则排下次复习
  function mcBox(ch) {
    const x = st.x, c = x.c; const rq = x.rq || (x.rq = P.rootQuestion(c, x.qt));
    const hint = x.qt === 'parts' ? `构词逻辑：${esc(rq.e.logic)}` : `同根词：${R.family(rq.root.id).filter(e => e.w !== c.term.toLowerCase()).slice(0, 3).map(e => esc(e.w)).join('、')}`;
    $('#ansarea', root).innerHTML = `${ch === 'fuzzy' ? `<div class="hintbox" id="hintbox">💡 ${hint}</div>` : ''}<div class="opts mcopts">${rq.options.map((o, i) => `<button class="btn opt" data-mo="${i}">${esc(o)}</button>`).join('')}</div>`;
    $$('[data-mo]', root).forEach(b => b.onclick = () => {
      const pick = rq.options[+b.dataset.mo], ok = pick === rq.answer; st.result = { score: ok ? 100 : 0, mode: 'choice', answer: pick }; scores.push(ok ? 100 : 0);
      $$('[data-mo]', root).forEach(y => { y.disabled = true; y.classList.toggle('right', rq.options[+y.dataset.mo] === rq.answer); y.classList.toggle('bad', y === b && !ok); });
      finalize(ok, `<div class="muted small">你选了：${esc(pick)}${ok ? '' : `；正确：<b>${esc(rq.answer)}</b>`}</div>`);
    });
  }
  function ansBox(a = asrStatus()) {
    const box = $('#ansbox', root); if (!box || st.result) return;
    if (st.mode === 'text') {
      box.innerHTML = `<textarea id="ans" rows="2" placeholder="在这里写英文……" aria-label="你的答案" autocapitalize="off" spellcheck="false"></textarea>
        <div class="row gap ansrow"><button class="btn primary grow" id="sub">提交判分</button></div>`;
      $('#sub', box).onclick = () => { const v = $('#ans', box).value.trim(); if (!v) return toast('先写一点再提交'); grade(v, 'text'); };
      keepVisible($('#ans', box), $('.ansrow', box));
      return;
    }
    if (!sp.recSupported()) { box.innerHTML = `<div class="note">这个浏览器不能录音，请用「写出来」作答。</div>`; return; }
    box.innerHTML = `<div class="row gap ansrow"><button class="btn primary big grow" id="recbtn">🎙️ 按一下开始说</button></div>
      <p class="muted small">${a.ok ? `说完再按一次。用浏览器语音识别转成文字后判分（${sp.ASR_LABEL}）。` : `⚠️ 语音识别不可用：${esc(a.why)} 仍可录音 → 回放对照参考答案 → 自己判断对不对。`}
      录音只在本机内存里，不上传、不保存。第一次会请求麦克风权限。</p>`;
    const btn = $('#recbtn', box);
    btn.onclick = async () => {
      if (!recorder) {
        try { tts.cancel(); recorder = await sp.startShadowing({ useAsr: a.ok }); btn.textContent = '■ 说完了'; btn.classList.add('recording'); }
        catch (e) { recorder = null; toast(e.message, 5000); }
        return;
      }
      btn.disabled = true; btn.textContent = '正在处理…';
      const r = await recorder.stop(); recorder = null; st.audio = r.url;
      if (r.asr && r.transcript) return grade(r.transcript, 'voice');
      // 识别不可用/没识别出来：保留录音回放 → 自己判断对不对
      const why = !r.asr ? a.why || '语音识别不可用。' : r.error ? `语音识别出错（${r.error}）。` : '没有识别出文字。';
      selfCheck(why);
    };
  }
  /** 键盘弹出（视口变矮）时，让作答行留在屏幕里。 */
  function keepVisible(input, row) {
    const fit = () => { if (document.activeElement === input && row.isConnected) row.scrollIntoView({ block: 'nearest' }); };
    input.addEventListener('focus', () => setTimeout(fit, 250));
    const vv = window.visualViewport; if (vv) { vv.addEventListener('resize', fit); onLeave(() => vv.removeEventListener('resize', fit)); }
    window.addEventListener('resize', fit); onLeave(() => window.removeEventListener('resize', fit));
  }
  const rootable = c => c.type !== 'sentence' && /^[A-Za-z][A-Za-z'’-]+$/.test(String(c.term).trim());
  const mountRv = () => { const el = $('#rvroot', root); if (el) mountRootBox(el, st.x.c.term.trim()); };
  const answerHtml = () => { const c = st.x.c; return `<div class="rv-ans"><div class="rv-en">${esc(c.term)} <button class="mini" id="hear" aria-label="听发音">🔊</button></div>${c.type !== 'sentence' && S.parse(c.zh).length > 1 ? `<div class="muted senses">${S.fullHtml(c.zh)}</div>` : `<div class="muted">${esc(c.zh || '')}</div>`}${c.sentence?.en && c.type !== 'sentence' ? `<div class="rv-sent small">${esc(c.sentence.en)}</div>` : ''}</div>`; };
  const nextHtml = days => `${rootable(st.x.c) ? '<div id="rvroot"></div>' : ''}<p class="muted small nextdue">下次复习：<b>${dayLabel(days)}</b></p><button class="btn primary big" id="next">下一题</button>`;
  function bindNext(x) { mountRv(); $('#hear', root)?.addEventListener('click', () => speakRef()); $('#next', root).onclick = () => advance(x); $('#next', root).focus({ preventScroll: true }); $('#fb', root).scrollIntoView({ block: 'nearest' }); }
  // 不会：马上给出答案（原句/释义/🔊），1 天后再练；本轮不再出
  async function giveUp() {
    const x = st.x; st.result = { score: null, mode: 'gaveup' }; tally.dunno++;
    $('.choices', root)?.remove(); $('.chnote', root)?.remove();
    const { days } = await commit(x, 'dunno', false);
    $('#fb', root).innerHTML = `<div class="fb low dunnofb">🙈 没关系，先看答案，明天再练。</div>${answerHtml()}${nextHtml(days)}`;
    bindNext(x);
  }
  // 熟练：跳过，以后不再出现；10 秒内可撤销，生词本里也能恢复
  async function master() {
    const x = st.x, c = x.c, prev = c.sch; tally.master++;
    await commit(x, 'master', true);
    undoBar(`「${c.term.length > 24 ? c.term.slice(0, 23) + '…' : c.term}」已标为熟练，以后不再出现`, async () => {
      c.sch = prev; await db.cards.save(c); await db.reviews.add({ cardId: c.id, q: null, choice: 'restore', ts: Date.now(), day: dayNumber(), mode: 'undo' }); tally.master--;
      if (root.isConnected && st) { done--; queue.unshift(x); draw(); }
      toast('已撤销，恢复练习');
    }, 10000);
    advance(x);
  }
  function grade(answer, mode) {
    const ref = st.x.c.term; const r = P.gradeAnswer(ref, answer); const ok = P.isCorrect(r.score);
    st.result = { score: r.score, mode, answer }; scores.push(r.score);
    $('#ansbox', root).innerHTML = ''; $('.ansmode', root)?.remove();
    finalize(ok, `${mode === 'voice' ? `<div class="muted small">识别到：“${esc(answer)}”（${sp.ASR_LABEL}）</div>` : ''}
      <div class="score ${r.score >= 80 ? 'good' : r.score >= 50 ? 'mid' : 'low'}"><b>${r.score}</b> 分${r.near ? '（差一个字母）' : ''}</div>
      <div class="diff">${r.tokens.map(t => `<span class="${t.status}" ${t.heard ? `title="你的：${esc(t.heard)}"` : ''}>${esc(t.w)}</span>`).join(' ')}</div>`);
  }
  function selfCheck(why) {
    st.result = { score: null, mode: 'voice-self' }; $('#ansbox', root).innerHTML = ''; $('.ansmode', root)?.remove();
    $('#fb', root).innerHTML = `<div class="note small">⚠️ ${esc(why)} 已保留你的录音：回放并对照下面的答案，自己判断。</div>${answerHtml()}
      ${st.audio ? `<div class="row gap center"><audio controls src="${st.audio}" id="myrec"></audio></div>` : ''}
      <div class="grid2 selfchk"><button class="btn q5" id="selfOk">✓ 说对了</button><button class="btn q1" id="selfBad">✗ 没说对</button></div>`;
    $('#hear', root)?.addEventListener('click', () => speakRef());
    $('#selfOk', root).onclick = () => finalize(true, '', true); $('#selfBad', root).onclick = () => finalize(false, '', true);
  }
  async function finalize(ok, html, self = false) {
    const x = st.x; ok ? tally.ok++ : tally.bad++; tally[st.choice]++;
    const { days } = await commit(x, st.choice, ok);
    $('#fb', root).innerHTML = `${self ? `${answerHtml()}${st.audio ? `<div class="row gap center"><audio controls src="${st.audio}" id="myrec"></audio></div>` : ''}` : html}
      <div class="fb ${ok ? 'good' : 'low'} verdict">${ok ? '✓ 答对了' : '✗ 没答对，正确答案在下面'}</div>${!self ? answerHtml() : ''}${!self && st.audio ? `<div class="row gap center"><audio controls src="${st.audio}" id="myrec"></audio></div>` : ''}${nextHtml(days)}`;
    $('#hintbox', root)?.remove(); bindNext(x);
  }
  async function commit(x, choice, correct) {
    const c = x.c; const { sch, q, days } = P.scheduleChoice(c.sch, choice, correct); c.sch = sch; await db.cards.save(c);
    const rec = await db.reviews.add({ cardId: c.id, q, choice, correct: choice === 'master' ? null : !!correct, days, ts: Date.now(), day: dayNumber(), mode: st.result?.mode || choice, qtype: x.qt, score: st.result?.score ?? null });
    return { days, id: rec.id };
  }
  function advance(x) {
    if (queue[0] !== x) return; // 防止连点
    queue.shift(); done++; bump('rvNext'); draw();
  }
  function finish() {
    const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    root.innerHTML = `<header class="top"><h1>复习练习</h1></header><div class="empty"><div class="big-emoji">🎉</div><p><b>今天的复习完成了！</b></p>
      <p class="muted">练习 ${total} 项${avg != null ? `，作答平均 ${avg} 分` : ''}。不会 ${tally.dunno} · 模糊 ${tally.fuzzy} · 会 ${tally.know} · 熟练 ${tally.master}；答对 ${tally.ok}、答错 ${tally.bad}。</p>
      <p class="muted small">间隔：不会→1 天；模糊 对→9 天/错→3 天；会 对→12 天/错→1 天；熟练→不再出现（生词本里可恢复）。</p><a class="btn primary" href="#/">回首页</a></div>`;
  }
  if (params.go) { draw(); } else plan();
}
