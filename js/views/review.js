// 复习 = 练习：按遗忘曲线选内容，按难度“易→难、易难交叉、最难压轴”出题；每题可用语音或文字作答，判分回写 SM-2。
import * as db from '../db.js';
import * as tts from '../tts.js';
import * as dict from '../dict.js';
import * as sp from '../speech.js';
import * as P from '../practice.js';
import { sm2, dayNumber } from '../sm2.js';
import { settings, saveSettings, CARD_TYPE } from '../state.js';
import { onLeave } from '../app.js';
import { $, $$, esc, toast } from '../ui.js';
import { tokenize } from '../textproc.js';

const RATES = [[1, '忘了', 'q1'], [3, '模糊', 'q3'], [4, '记得', 'q4'], [5, '轻松', 'q5']];
const QN = { 0: '不会', 1: '忘了', 2: '差一点', 3: '模糊', 4: '记得', 5: '轻松' };
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
const hintOf = (term, lvl) => term.split(' ').map(w => w.slice(0, lvl) + w.slice(lvl).replace(/[A-Za-z]/g, '·')).join(' ');

export async function render(root, _a, params = {}) {
  const cards = await db.cards.all(); const reviews = await db.reviews.all(); const today = dayNumber();
  const hist = new Map(); for (const r of reviews) { if (!hist.has(r.cardId)) hist.set(r.cardId, []); hist.get(r.cardId).push(r.q); }
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

  const plan = () => {
    root.innerHTML = `<header class="top"><h1>今日复习练习</h1><span class="muted">按遗忘曲线挑出 ${order.length} 项 · 到期 ${sel.dueCount} · 新 ${sel.newCount}</span></header>
      <div class="note small">顺序：先易后难，中间易难交叉，<b>最难的放在最后</b>。难度分 = 词汇难度（词频/句长）40% + 你的历史错误率 25% + 记忆难度 EF 15% + 此刻遗忘概率 20%。每题都可以<b>说</b>或<b>写</b>英文来回答。</div>
      <button class="btn primary big" id="go">开始练习（${order.length} 题）</button>
      <h2>本轮顺序</h2><ol class="plan">${order.map((x, i) => `<li class="pl ${x.tail ? 'tail' : ''}" data-i="${i}"><span class="pl-t">${esc(x.c.term.length > 42 ? x.c.term.slice(0, 40) + '…' : x.c.term)}</span>
        <span class="pl-m"><span class="lvl-${P.level(x.diff)}">${P.level(x.diff)} ${x.diff}</span> · ${P.QTYPES[x.qt]} · ${x.c.sch?.seen ? '遗忘概率 ' + pct(x.fp) : '新'}${x.tail ? ' · 压轴' : ''}</span>
        <i class="dbar"><b style="width:${x.diff}%"></b></i></li>`).join('')}</ol>`;
    $('#go', root).onclick = () => { idx = 0; draw(); };
  };

  const queue = order.slice(); const total = order.length; let done = 0, again = 0, idx = 0; const firstSeen = new Set(); const scores = [];
  let tailLeft = total - tailFrom; let st = null, recorder = null, audioUrl = null;
  onLeave(() => { tts.cancel(); recorder?.stop().catch(() => { }); });

  const prompt = (x) => {
    const c = x.c;
    if (x.qt === 'listen') return `<div class="rv-q muted">${c.type === 'sentence' ? '听一句，把它说出来或写下来' : '听一听，把这个' + CARD_TYPE[c.type] + '说出来或写下来'}</div><div class="row gap center"><button class="btn primary" id="say">🔊 播放</button><button class="btn" id="slow">🐢 慢速</button></div>`;
    if (x.qt === 'cloze') return `<div class="rv-q muted">原句填空：空里应该是什么？</div><div class="rv-sent">${mask(c.sentence.en, c.term)}</div>${c.sentence.zh ? `<div class="muted">${esc(c.sentence.zh)}</div>` : ''}<div class="muted small">提示：${esc(c.zh || '')}</div>`;
    return `<div class="rv-q muted">${c.type === 'sentence' ? '用英文说出/写出这句话' : '这个意思用英文怎么说？'}</div><div class="rv-zh">${esc(c.zh)}</div>${c.type !== 'sentence' && c.sentence?.zh ? `<div class="muted small">语境：${esc(c.sentence.zh)}</div>` : ''}`;
  };
  const speakRef = (rate = settings.rate) => tts.speak(st.x.c.term, { rate }).catch(e => toast(e.message));

  function draw() {
    if (!queue.length) return finish();
    const x = queue[0]; st = { x, hinted: 0, result: null, mode: settings.answerMode || 'voice', audio: null };
    const a = asrStatus();
    root.innerHTML = `<header class="top"><h1>复习练习</h1><span class="muted">${done}/${total} · 剩 ${queue.length}</span></header>
      <div class="bar"><i style="width:${Math.round(100 * done / total)}%"></i></div>
      <section class="rvcard" data-cid="${esc(x.c.id)}" data-qt="${x.qt}"><span class="tag">${CARD_TYPE[x.c.type]}${x.c.sch?.seen ? '' : ' · 新'} · ${P.QTYPES[x.qt]} · <span class="lvl-${P.level(x.diff)}">${P.level(x.diff)}</span>${x.tail ? ' · 压轴' : ''}</span>${prompt(x)}</section>
      <div class="seg ansmode" role="tablist"><a role="tab" data-mode="voice" class="${st.mode === 'voice' ? 'on' : ''}">🎙️ 说出来</a><a role="tab" data-mode="text" class="${st.mode === 'text' ? 'on' : ''}">⌨️ 写出来</a></div>
      <div id="ansbox"></div>
      <div class="row gap"><button class="btn" id="hint">💡 提示</button><button class="btn grow" id="show">不会，看答案</button></div>
      <div id="fb"></div>`;
    $('#say', root)?.addEventListener('click', () => speakRef());
    $('#slow', root)?.addEventListener('click', () => speakRef(0.6));
    if (x.qt === 'listen') setTimeout(() => { if (st?.x === x) speakRef(); }, 300);
    $$('[data-mode]', root).forEach(b => b.onclick = () => { st.mode = b.dataset.mode; saveSettings({ answerMode: st.mode }); $$('[data-mode]', root).forEach(y => y.classList.toggle('on', y === b)); ansBox(); });
    $('#hint', root).onclick = () => { st.hinted = Math.min(st.hinted + 1, 3); $('#hint', root).textContent = '💡 ' + hintOf(x.c.term.length > 60 ? x.c.term.split(' ').slice(0, 6).join(' ') + ' …' : x.c.term, st.hinted); };
    $('#show', root).onclick = () => reveal({ gaveUp: true });
    ansBox(a);
  }
  function ansBox(a = asrStatus()) {
    const box = $('#ansbox', root); if (st.result) return;
    if (st.mode === 'text') {
      box.innerHTML = `<textarea id="ans" rows="2" placeholder="在这里写英文……" aria-label="你的答案" autocapitalize="off" spellcheck="false"></textarea><button class="btn primary big" id="sub">提交判分</button>`;
      $('#sub', box).onclick = () => { const v = $('#ans', box).value.trim(); if (!v) return toast('先写一点再提交'); grade(v, 'text'); };
      return;
    }
    if (!sp.recSupported()) { box.innerHTML = `<div class="note">这个浏览器不能录音，请用「写出来」作答。</div>`; return; }
    box.innerHTML = `<button class="btn primary big" id="recbtn">🎙️ 按一下开始说</button>
      <p class="muted small">${a.ok ? `说完再按一次。用浏览器语音识别转成文字后判分（${sp.ASR_LABEL}）。` : `⚠️ 语音识别不可用：${esc(a.why)} 仍可录音 → 回放对照参考答案 → 自己评分。`}
      录音只在本机内存里，不上传、不保存。第一次会请求麦克风权限。</p>`;
    const btn = $('#recbtn', box);
    btn.onclick = async () => {
      if (!recorder) {
        try { tts.cancel(); recorder = await sp.startShadowing({ useAsr: a.ok }); btn.textContent = '■ 说完了'; btn.classList.add('recording'); }
        catch (e) { recorder = null; toast(e.message, 5000); }
        return;
      }
      btn.disabled = true; btn.textContent = '正在处理…';
      const r = await recorder.stop(); recorder = null; audioUrl = r.url; st.audio = r.url;
      if (r.asr && r.transcript) return grade(r.transcript, 'voice');
      // 识别不可用/没识别出来：保留录音回放 + 自评
      const why = !r.asr ? a.why || '语音识别不可用。' : r.error ? `语音识别出错（${r.error}）。` : '没有识别出文字。';
      reveal({ selfRate: true, why });
    };
  }
  function grade(answer, mode) {
    const ref = st.x.c.term; const r = P.gradeAnswer(ref, answer); const q = P.scoreToQ(r.score, { hinted: st.hinted > 0 });
    st.result = { score: r.score, q, mode, answer }; scores.push(r.score);
    $('#ansbox', root).innerHTML = ''; $('#hint', root).parentElement.remove();
    $('#fb', root).innerHTML = `${mode === 'voice' ? `<div class="muted small">识别到：“${esc(answer)}”（${sp.ASR_LABEL}）</div>` : ''}
      <div class="score ${r.score >= 80 ? 'good' : r.score >= 50 ? 'mid' : 'low'}"><b>${r.score}</b> 分${r.near ? '（差一个字母）' : ''}${st.hinted ? '（用了提示）' : ''}</div>
      <div class="diff">${r.tokens.map(t => `<span class="${t.status}" ${t.heard ? `title="你的：${esc(t.heard)}"` : ''}>${esc(t.w)}</span>`).join(' ')}</div>
      ${answerHtml()}${st.audio ? `<div class="row gap center"><audio controls src="${st.audio}" id="myrec"></audio></div>` : ''}
      ${ratesHtml(q)}`;
    bindRates(q);
  }
  const answerHtml = () => { const c = st.x.c; return `<div class="rv-ans"><div class="rv-en">${esc(c.term)} <button class="mini" id="hear">🔊</button></div><div class="muted">${esc(c.zh || '')}</div>${c.sentence?.en && c.type !== 'sentence' ? `<div class="rv-sent small">${esc(c.sentence.en)}</div>` : ''}</div>`; };
  const ratesHtml = (sug) => `<p class="muted small">${sug != null ? `建议评分：<b>${QN[sug]}</b>（可改）。` : '对照答案，给自己评个分：'}评分会写入 SM-2，决定下次什么时候再练。</p>
      <div class="rates4">${RATES.map(([q, t, cls]) => `<button class="btn ${cls} ${sug != null && q === (sug < 3 ? 1 : sug) ? 'sug' : ''}" data-q="${q}"><b>${t}</b><small>${dayLabel(sm2(st.x.c.sch, q).interval)}</small></button>`).join('')}</div>
      ${sug != null ? `<button class="btn primary big" id="next">下一题（按建议：${QN[sug]}）</button>` : ''}`;
  function reveal({ gaveUp = false, selfRate = false, why = '' } = {}) {
    if (st.result) return;
    st.result = { score: null, q: gaveUp ? 0 : null, mode: selfRate ? 'voice-self' : 'gaveup' };
    $('#ansbox', root).innerHTML = ''; $('#hint', root)?.parentElement.remove();
    $('#fb', root).innerHTML = `${why ? `<div class="note small">⚠️ ${esc(why)} 已保留你的录音：回放并对照下面的答案，自己评分。</div>` : ''}${answerHtml()}
      ${st.audio ? `<div class="row gap center"><audio controls src="${st.audio}" id="myrec"></audio></div>` : ''}${ratesHtml(gaveUp ? 0 : null)}`;
    bindRates(gaveUp ? 0 : null);
  }
  function bindRates(sug) {
    $('#hear', root)?.addEventListener('click', () => speakRef());
    $$('[data-q]', root).forEach(b => b.onclick = () => rate(+b.dataset.q));
    $('#next', root)?.addEventListener('click', () => rate(sug));
  }
  async function rate(q) {
    const x = st.x, c = x.c; const first = !firstSeen.has(c.id);
    if (first) { // SM-2 只在每张卡当天第一次作答时更新；本轮重来的不重复更新
      firstSeen.add(c.id); c.sch = sm2(c.sch, q); await db.cards.save(c);
      await db.reviews.add({ cardId: c.id, q, ts: Date.now(), day: dayNumber(), mode: st.result?.mode || 'self', qtype: x.qt, score: st.result?.score ?? null });
    }
    queue.shift(); if (x.tail) tailLeft--;
    if (q < 3) { again++; queue.splice(P.requeuePos(queue.length, tailLeft), 0, x); if (x.tail) tailLeft++; } else done++;
    draw();
  }
  function finish() {
    const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    root.innerHTML = `<header class="top"><h1>复习练习</h1></header><div class="empty"><div class="big-emoji">🎉</div><p><b>今天的复习完成了！</b></p>
      <p class="muted">练习 ${total} 项${avg != null ? `，作答平均 ${avg} 分` : ''}，其中 ${again} 次需要重来。按 SM-2 间隔，之后会在快要忘记的时候再次出现。</p><a class="btn primary" href="#/">回首页</a></div>`;
  }
  if (params.go) { draw(); } else plan();
}
