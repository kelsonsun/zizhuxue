// v1.6 测验：听、读、说、译为主，默写为辅。每题由题型给刺激（声音/英文/中文），作答方式用户自己选（选/说/译/写），每种题型记住偏好。
// 四个按钮（不会/模糊/会/熟练）和间隔规则不变；判分按作答方式：选择 → 对错；说 → 语音转写后模糊比对；写 → 逐词拼写；
// 译 → 有 AI 用 AI 判分，没有就和参考译文/词典释义宽松比对（如实标注，可以改判）。
import * as db from '../db.js';
import * as tts from '../tts.js';
import * as sp from '../speech.js';
import * as ai from '../ai.js';
import * as S from '../sense.js';
import * as P from '../practice.js';
import * as D from '../drill.js';
import { settings, saveSettings, makeCard } from '../state.js';
import { undoBar } from '../matdelete.js';
import { dayNumber } from '../sm2.js';
import { onLeave } from '../app.js';
import { asrStatus } from './review.js';
import { $, $$, esc, toast, hilite } from '../ui.js';

const dayLabel = d => d <= 0 ? '今天' : d === 1 ? '明天' : d + '天后';
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** 从句子和生词卡里挑题：句子为主（约 7 成），生词补足 */
export function pickItems(sents, wcards, n = 10) {
  const ss = shuffle(sents).map(s => ({ kind: 'sent', id: s.id, en: s.en, zh: s.zh || '', s })), ws = shuffle(wcards).map(c => ({ kind: 'word', id: c.id, en: c.term, zh: c.zh || '', c }));
  const nw = Math.min(ws.length, Math.max(n - ss.length, Math.round(n * 0.3))); return shuffle([...ss.slice(0, n - nw), ...ws.slice(0, nw)]).slice(0, n);
}

/**
 * ctx：{task:'mix'|'listen'|'read'|'speak'|'trans', items, pool(句子池，给选择题出干扰项), cards(全部卡), mats, title, onDone(res)}
 */
export async function runDrill(root, ctx) {
  const { items, pool, cards, mats } = ctx; const tasks = D.planTasks(items, { task: ctx.task });
  const audioOf = new Map(); for (const m of mats) if (m.audioId) audioOf.set(m.id, m.audioId);
  const urls = new Map(); let au = null, auTok = 0, recorder = null, pending = null;
  const stopAll = () => { auTok++; au?.pause(); tts.cancel(); };
  onLeave(() => { stopAll(); recorder?.stop().catch(() => { }); void sp.abortLiveShadowing(); if (pending) commitPending(); document.querySelector('#undobar')?.remove(); });
  const audioUrl = async it => { if ((it.kind !== 'sent' && it.kind !== 'passage') || it.s.t0 == null) return null; const aid = audioOf.get(it.s.materialId); if (!aid) return null;
    if (!urls.has(aid)) { const b = await db.blobs.get('audio:' + aid).catch(() => null); urls.set(aid, b ? URL.createObjectURL(b.blob) : null); } return urls.get(aid); };
  /** 播放：有原声用原声（慢速 0.75×），没有用朗读（TTS） */
  async function play(it, slow = false) {
    stopAll(); const my = auTok; const url = await audioUrl(it);
    if (url) {
      au = au || new Audio(); if (au.src !== url) au.src = url; au.playbackRate = slow ? 0.75 : 1; au.currentTime = it.s.t0;
      try { await au.play(); } catch (e) { return tts.speak(it.en, { rate: slow ? 0.6 : settings.rate }).catch(x => toast(x.message)); }
      const end = it.s.t1 ?? Infinity; const fn = () => { if (my !== auTok || au.currentTime >= end || au.ended) { au.removeEventListener('timeupdate', fn); if (my === auTok) au.pause(); } }; au.addEventListener('timeupdate', fn); return;
    }
    return tts.speak(it.en, { rate: slow ? 0.6 : settings.rate }).catch(e => toast(e.message));
  }

  let i = 0; const res = [];
  const next = () => { commitPending(); i++; i >= items.length ? ctx.onDone(res) : ask(); };
  async function ensureCard(it) {
    if (it.c) return it.c; const s = it.s; let c = cards.find(x => x.type === 'sentence' && x.sentenceId === s.id);
    if (!c) { c = makeCard({ type: 'sentence', term: s.en, zh: s.zh, sentence: { en: s.en, zh: s.zh }, material: s.materialId, sentenceId: s.id, source: 'quiz' }); cards.push(c); }
    return it.c = c;
  }
  async function schedule(it, choice, ok, score, qtype) {
    const c = await ensureCard(it); const prev = c.sch; const r = P.scheduleChoice(c.sch, choice, ok); c.sch = r.sch; await db.cards.save(c);
    await db.reviews.add({ cardId: c.id, q: r.q, choice, correct: choice === 'master' ? null : !!ok, days: r.days, ts: Date.now(), day: dayNumber(), mode: 'quiz', qtype, score });
    return { days: r.days, c, prev };
  }
  /** 判完分先不写库：用户可以改判（本地比对/语音识别不准时），点“下一题”或离开时再按最终结果排下次复习 */
  function commitPending() { const p = pending; pending = null; if (!p) return; p.r.ok = p.ok; if (p.it.kind === 'passage') return; /* 篇章题只记成绩，不单独排复习 */ schedule(p.it, p.choice, p.ok, p.score, p.qtype); }

  async function ask() {
    const it = items[i], tk = tasks[i], word = it.kind === 'word', pas = it.kind === 'passage'; const hasZh = !!it.zh.trim();
    const st = { mode: D.modeFor(tk, settings.drillModes), dir: settings.drillDir === 'zh2en' && hasZh && !pas ? 'zh2en' : 'en2zh', choice: null, kind: null, opts: null, sense: null, pq: null };
    if (pas && ai.isConfigured()) root.innerHTML = `<header class="top"><h1>${esc(ctx.heading)}</h1><span class="muted">第 ${i + 1} / ${items.length} 题</span></header><div class="empty"><p class="muted">📖 AI 正在根据这段原文出阅读理解题…</p></div>`;
    if (word) st.sense = await S.contextSense(it.c).catch(() => null);
    // 选择题选项：句子——听力题单双号交替“选意思/选英文”，其余选意思；生词——选意思（词典干扰项），没有就听音选拼写
    const choicesFor = async () => {
      if (st.opts !== null) return st.opts;
      if (pas) { // 篇章理解：有 AI → AI 出题（格式不对/失败就改用规则出题）；没有 AI → 规则出题（译文 + 生词关键词）
        if (ai.isConfigured()) {
          try { const q = D.checkAiQuestion(await ai.passageQuiz(it.en, it.zh)); if (q) { st.pq = { ...q, src: 'ai' }; } else toast('AI 出的题格式不对，改用规则出题', 4000); }
          catch (e) { toast('AI 出题没成功，改用规则出题：' + e.message, 5000); }
        }
        if (!st.pq) { const q = D.passageQuestion(it, { others: pool.map(x => x.zh), cards }); if (q) st.pq = { ...q, src: 'rule' }; }
        st.kind = 'passage'; return st.opts = st.pq ? st.pq.options : false;
      }
      if (!word) {
        const kinds = tk === 'listen' ? (i % 2 ? ['text', 'mean'] : ['mean', 'text']) : ['mean']; st.opts = null;
        for (const k of kinds) { const o = D.sentChoices(it, pool, k); if (o) { st.opts = o; st.kind = k; break; } }
        return st.opts || (st.opts = false);
      }
      if (st.sense && hasZh) {
        const others = cards.filter(x => x.id !== it.c.id && x.term.toLowerCase() !== it.en.toLowerCase()).map(x => x.zh).filter(Boolean);
        const dis = await S.distractors(st.sense, shuffle(others), 3).catch(() => []);
        const optText = x => S.briefText({ ...x, pos: S.posKey(x.pos) === 'v' ? 'v.' : x.pos }, 4);
        if (dis.length >= 2) { st.kind = 'mean'; return st.opts = shuffle([{ t: optText(st.sense), ok: true }, ...dis.map(d => ({ t: optText(d), ok: false }))]); }
      }
      const o = tk === 'listen' ? D.wordTextChoices(it.en, cards.map(x => x.term)) : null; st.kind = 'text'; return st.opts = o || false;
    };
    const modeWhy = async m => {
      if (m === 'choose') return (await choicesFor()) ? '' : '这题凑不出选择题（材料里可用的干扰项太少）';
      if (m === 'trans') return hasZh || ai.isConfigured() ? '' : '这句没有中文参考译文、也没配置 AI，没法判翻译';
      if (m === 'write' && pas) return '篇章题不考默写（拼写只放在单句题里）';
      return '';
    };
    const why = {}; for (const m of Object.keys(D.MODES)) why[m] = await modeWhy(m);
    if (why[st.mode]) st.mode = ['choose', 'say', 'write'].find(m => !why[m]) || 'write';
    if (i !== items.indexOf(it)) return;
    draw(true);

    function draw(first = false) {
      const sti = { ...D.stimulus(tk, st.mode, { dir: st.dir, hasZh, word }) }; st.sti = sti;
      if (pas) Object.assign(sti, st.mode === 'choose' ? { label: '篇章理解', ask: st.pq?.q || '读这段，回答问题', audio: 'button' } : st.mode === 'say' ? { label: '篇章朗读', ask: '把这段英文大声读出来' } : { label: '篇章英译中', ask: '说出或写出这段话的中文意思', en: true, zh: false });
      const zhShow = word ? (st.sense ? S.briefText({ pos: st.sense.pos, zh: st.sense.zh }, 99) : it.zh) : it.zh;
      root.innerHTML = `<header class="top"><h1>${esc(ctx.heading)}</h1><span class="muted">第 ${i + 1} / ${items.length} 题 · ${esc(ctx.title)}</span></header><div class="bar"><i style="width:${Math.round(100 * i / items.length)}%"></i></div>
        <section class="rvcard drill" data-task="${tk}" data-mode="${st.mode}" data-kind="${it.kind}"><span class="tag">${D.TASK_ICON[tk]} ${D.TASKS[tk]} · ${sti.label} · ${word ? '生词' : pas ? `篇章 ${it.sents.length} 句` : '句子'}</span>${pas && st.mode === 'choose' && st.pq ? ` <span class="tag pqsrc ${st.pq.src}">${st.pq.src === 'ai' ? '🤖 AI 出题，仅供参考' : '规则出题（译文 + 关键词）'}</span>` : ''}
          <div class="rv-q muted">${esc(sti.ask)}</div>
          ${sti.en ? `<div class="rv-en dr-en${pas ? ' passage' : ''}">${word ? esc(it.en) : esc(it.en)}</div>${word && it.c.sentence?.en ? `<div class="rv-sent small">${hilite(it.c.sentence.en, it.en)}</div>` : ''}` : ''}
          ${sti.zh ? `<div class="rv-zh">${esc(zhShow)}</div>${word && it.c.sentence?.zh ? `<div class="muted small">语境：${esc(it.c.sentence.zh)}</div>` : ''}` : ''}
          ${sti.audio ? `<div class="row gap center"><button class="btn primary" id="say">🔊 ${sti.en ? '听' : '播放'}</button><button class="btn" id="slow">🐢 慢速</button></div>` : ''}
          ${st.mode === 'trans' && hasZh && !pas ? `<div class="seg trdir" role="tablist" aria-label="翻译方向"><a role="tab" data-dir="en2zh" class="${st.dir === 'en2zh' ? 'on' : ''}">英 → 中</a><a role="tab" data-dir="zh2en" class="${st.dir === 'zh2en' ? 'on' : ''}">中 → 英</a></div>` : ''}
        </section>
        ${st.choice ? '' : `<div class="amodes" role="radiogroup" aria-label="作答方式">${Object.entries(D.MODES).map(([m, t]) => `<button class="btn am ${m === st.mode ? 'on' : ''}" data-am="${m}" role="radio" aria-checked="${m === st.mode}" ${why[m] ? `disabled title="${esc(why[m])}"` : ''}>${D.MODE_ICON[m]} ${t}</button>`).join('')}</div>
        <p class="muted small amnote">作答方式自己选：<b>选</b>选择题 · <b>说</b>用语音 · <b>译</b>说出/写出意思 · <b>写</b>键入英文（会记住你在「${D.TASKS[tk]}」题的选择）</p>
        <div class="choices" role="group" aria-label="先选：你会吗？">${P.CHOICES.map(([k, t]) => `<button class="btn ch ch-${k}" data-ch="${k}">${{ dunno: '🙈', fuzzy: '🤔', know: '🙂', master: '⭐' }[k]} ${t}</button>`).join('')}</div>
        <p class="muted small chnote">先选再答：<b>不会</b>直接看答案（明天再练）·<b>模糊</b>先给提示再答·<b>会</b>直接答·<b>熟练</b>以后不再出（可撤销）</p>`}
        <div id="area"></div><div id="fb"></div>`;
      $('#say', root)?.addEventListener('click', () => play(it));
      $('#slow', root)?.addEventListener('click', () => play(it, true));
      if (sti.audio === 'auto' && (first || st.replay)) setTimeout(() => { if (items[i] === it && !st.choice) play(it); }, 300);
      st.replay = false;
      $$('[data-am]', root).forEach(b => b.onclick = () => { if (b.disabled) return; const m = b.dataset.am; if (m === st.mode) return; const prevAudio = sti.audio; st.mode = m; saveSettings({ drillModes: { ...(settings.drillModes || {}), [tk]: m } }); st.replay = !prevAudio; stopAll(); draw(); });
      $$('[data-dir]', root).forEach(b => b.onclick = () => { st.dir = b.dataset.dir; saveSettings({ drillDir: st.dir }); draw(); });
      $$('[data-ch]', root).forEach(b => b.onclick = () => choose(b.dataset.ch));
    }
    const ansHtml = () => `<div class="rv-ans"><div class="rv-en">${esc(it.en)} <button class="mini" id="hear2" aria-label="听">🔊</button></div>${it.zh ? `<div class="muted">${word && S.parse(it.zh).length > 1 ? S.fullHtml(it.zh) : esc(it.zh)}</div>` : ''}${word && it.c.sentence?.en ? `<div class="rv-sent small">${esc(it.c.sentence.en)}</div>` : ''}${pas && st.pq && st.mode === 'choose' ? `<div class="small pqans">这题的答案：<b>${esc(st.pq.options.find(o => o.ok).t)}</b></div>${st.pq.why ? `<div class="muted small pqwhy">💡 ${esc(st.pq.why)}</div>` : ''}` : ''}</div>`;
    const qtype = () => `${tk}:${st.mode}${st.mode === 'trans' ? ':' + st.dir : st.mode === 'choose' ? ':' + st.kind + (pas && st.pq ? ':' + st.pq.src : '') : ''}`;
    function choose(ch) {
      if (st.choice) return; st.choice = ch; stopAll();
      if (ch === 'master') return master();
      draw(); $('#area', root).insertAdjacentHTML('beforebegin', `<div class="chosen muted small">你选了：<b>${P.CHOICE_ZH[ch]}</b>${pas ? '（篇章题只记成绩）' : ch === 'fuzzy' ? '（对了 9 天后再练，错了 3 天后）' : ch === 'know' ? '（对了 12 天后再练，错了 1 天后）' : '（明天再练）'} · 作答方式：<b>${D.MODES[st.mode]}</b></div>`);
      if (ch === 'dunno') {
        const r = { it, task: tk, mode: st.mode, choice: ch, ok: false, score: 0 }; res.push(r);
        $('#fb', root).innerHTML = `<div class="fb low dunnofb">🙈 没关系，先看答案：</div>${ansHtml()}${nextHtml(1)}`;
        pending = { it, choice: 'dunno', ok: false, score: 0, qtype: qtype(), r }; bindNx(); return;
      }
      ({ choose: answerChoose, say: answerSay, write: answerWrite, trans: answerTrans })[st.mode](ch);
    }
    async function master() {
      if (pas) { res.push({ it, task: tk, mode: st.mode, choice: 'master' }); toast('篇章题只记成绩、不单独排复习：已跳过这段'); return next(); }
      const { c, prev } = await schedule(it, 'master', true, null, qtype()); res.push({ it, task: tk, mode: st.mode, choice: 'master' }); const at = i;
      undoBar(`「${c.term.length > 24 ? c.term.slice(0, 23) + '…' : c.term}」已标为熟练，以后不再出现`, async () => {
        c.sch = prev; await db.cards.save(c); await db.reviews.add({ cardId: c.id, q: null, choice: 'restore', ts: Date.now(), day: dayNumber(), mode: 'undo' });
        const k = res.findIndex(r => r.it === it && r.choice === 'master'); if (k >= 0) res.splice(k, 1);
        if (root.isConnected && i === at + 1 && !$('#nx', root)) { i = at; ask(); } toast('已撤销，恢复练习');
      }, 10000);
      next();
    }
    const nextHtml = days => `<p class="muted small nextdue">${pas ? '篇章题只记成绩，<b id="nd">不单独排复习</b>（段里的句子和生词按各自的卡复习）' : `下次复习：<b id="nd">${dayLabel(days)}</b>`}</p><button class="btn primary big" id="nx">${i + 1 >= items.length ? '看结果' : '下一题'}</button>`;
    function bindNx() { $('#hear2', root)?.addEventListener('click', () => play(it)); $('#nx', root).onclick = next; $('#nx', root).focus({ preventScroll: true }); $('#fb', root).scrollIntoView({ block: 'nearest' }); }
    /** 出结果。override：本地比对 / 语音识别可能判错，允许用户改判 */
    function result(ok, score, html, { override = false } = {}) {
      const r = { it, task: tk, mode: st.mode, choice: st.choice, ok, score }; res.push(r);
      pending = { it, choice: st.choice, ok, score, qtype: qtype(), r };
      const days = ok2 => P.choiceRule(st.choice, ok2)[1];
      const verdict = ok2 => `<div class="fb ${ok2 ? 'good' : 'low'} verdict">${ok2 ? '✓ 算答对' : '✗ 没答对'}</div>`;
      $('#fb', root).innerHTML = `${html}<div id="vd">${verdict(ok)}</div>${override ? `<div class="row gap wrap ovr"><span class="muted small">判得不对？</span><button class="mini" data-ov="1">算我对</button><button class="mini" data-ov="0">算我错</button></div>` : ''}${ansHtml()}${nextHtml(days(ok))}`;
      $$('[data-ov]', root).forEach(b => b.onclick = () => { const v = b.dataset.ov === '1'; pending.ok = v; r.ok = v; r.overridden = true; $('#vd', root).innerHTML = verdict(v) + '<div class="muted small">（你改判了）</div>'; if (!pas) $('#nd', root).textContent = dayLabel(days(v)); });
      bindNx();
    }
    async function answerChoose(ch) {
      const opts = await choicesFor(); const keep = ch === 'fuzzy' ? new Set(P.eliminate(opts)) : null;
      $('#area', root).innerHTML = `${keep ? `<div class="hintbox" id="hintbox">💡 提示：已去掉 ${opts.length - keep.size} 个干扰项</div>` : ''}<div class="muted small">${st.kind === 'passage' ? esc(st.pq.q) : st.kind === 'text' ? '选出你听到的英文：' : '选出意思：'}</div>
        <div class="opts" role="group" aria-label="选项">${opts.map((o, k) => `<button class="btn opt ${keep && !keep.has(k) ? 'elim' : ''}" data-k="${k}"${o.ok ? ' data-ok' : ''}${keep && !keep.has(k) ? ' disabled aria-disabled="true"' : ''}>${esc(o.t)}</button>`).join('')}</div>`;
      $$('.opt', root).forEach(b => b.onclick = () => {
        if ($('#nx', root) || b.disabled) return; const o = opts[+b.dataset.k];
        $$('.opt', root).forEach((x, k) => { x.disabled = true; if (opts[k].ok) x.classList.add('right'); else if (x === b) x.classList.add('bad'); });
        result(o.ok, o.ok ? 100 : 0, o.ok ? '' : `<div class="muted small">正确：<b>${esc(opts.find(x => x.ok).t)}</b></div>`);
      });
    }
    const letters = () => { const h = P.hintText(it.en); return `<div class="hintbox" id="hintbox">💡 提示：<b class="hintl">${esc(h.letters)}</b>（${h.count} 个词）${st.sti.zh || !it.zh ? '' : `<div class="muted small">中文：${esc(it.zh)}</div>`}</div>`; };
    /** 录音 + 浏览器语音识别。lang：en-US / zh-CN。onText(transcript, url) */
    function micButton(box, lang, onText, label) {
      const a = asrStatus(); const btn = $('#recbtn', box);
      btn.onclick = async () => {
        if (!recorder) { try { stopAll(); recorder = await sp.startShadowing({ lang, useAsr: a.ok }); btn.textContent = '■ 说完了'; btn.classList.add('recording'); } catch (e) { recorder = null; toast(e.message, 5000); } return; }
        btn.disabled = true; btn.textContent = '正在处理…'; const r = await recorder.stop(); recorder = null; btn.disabled = false; btn.classList.remove('recording'); btn.textContent = label;
        onText(r.asr && r.transcript ? r.transcript : '', r.url, !r.asr ? a.why || '语音识别不可用。' : r.error ? `语音识别出错（${r.error}）。` : '没有识别出文字。');
      };
      return a;
    }
    function answerSay(ch) {
      if (!sp.recSupported()) { $('#area', root).innerHTML = `${ch === 'fuzzy' ? letters() : ''}<div class="note">这个浏览器不能录音。可以改用「写」或「选」作答：</div><button class="btn" id="toWrite">⌨️ 改成写</button>`; $('#toWrite', root).onclick = () => { st.mode = 'write'; answerWrite(ch); }; return; }
      const a = asrStatus();
      $('#area', root).innerHTML = `${ch === 'fuzzy' ? letters() : ''}<div class="row gap ansrow"><button class="btn primary big grow" id="recbtn">🎙️ 按一下开始说</button></div>
        <p class="muted small">${a.ok ? `说完再按一次。用浏览器语音识别转成文字，再和原句模糊比对（近音、单复数、时态差一点都算接近；${sp.ASR_LABEL}）。` : `⚠️ 语音识别不可用：${esc(a.why)} 仍可录音 → 回放对照答案 → 自己判断。`} 录音只在本机内存里，不上传。</p>`;
      micButton($('#area', root), 'en-US', (text, url, why) => {
        $('#area', root).innerHTML = '';
        if (!text) {
          $('#fb', root).innerHTML = `<div class="note small">⚠️ ${esc(why)} 可再跟读一次评分，或回放对照答案自己判断：</div>${url ? `<div class="row gap center"><audio controls src="${url}" id="myrec"></audio></div>` : ''}${ansHtml()}<div class="row gap"><button class="btn grow" id="retryRec">🎙 再跟读一次</button></div><div class="grid2 selfchk"><button class="btn q5" id="selfOk">✓ 说对了</button><button class="btn q1" id="selfBad">✗ 没说对</button></div>`;
          $('#hear2', root)?.addEventListener('click', () => play(it));
          $('#retryRec', root).onclick = () => { $('#fb', root).innerHTML = ''; answerSay(ch); };
          $('#selfOk', root).onclick = () => result(true, null, `<div class="muted small">自己判断：说对了</div>`); $('#selfBad', root).onclick = () => result(false, null, `<div class="muted small">自己判断：没说对</div>`); return;
        }
        const g = D.fuzzyEn(it.en, text); const ok = g.score >= D.PASS.say;
        result(ok, g.score, `<div class="muted small">识别到：“${esc(text)}”（${sp.ASR_LABEL}，语音识别可能听错）</div><div class="score ${g.score >= 80 ? 'good' : g.score >= 50 ? 'mid' : 'low'}"><b>${g.score}</b> 分 <span class="muted small">（${D.PASS.say} 分算对）</span></div>
          <div class="diff">${g.tokens.map(t => `<span class="${t.status === 'near' ? 'near' : t.status === 'miss' ? 'miss' : 'ok'}" ${t.heard ? `title="听成：${esc(t.heard)}"` : ''}>${esc(t.w)}</span>`).join(' ')}</div>${url ? `<div class="row gap center"><audio controls src="${url}" id="myrec"></audio></div>` : ''}`, { override: true });
      }, '🎙️ 再说一次');
    }
    function answerWrite(ch) {
      $('#area', root).innerHTML = `${ch === 'fuzzy' ? letters() : ''}<textarea id="ans" rows="2" placeholder="在这里写英文……" aria-label="你的答案" autocapitalize="off" spellcheck="false"></textarea>
        <div class="row gap ansrow"><button class="btn primary grow" id="sub">提交判分</button></div>`;
      setTimeout(() => $('#ans', root)?.focus(), 50);
      $('#sub', root).onclick = () => {
        const v = $('#ans', root).value.trim(); if (!v) return toast('先写一点再提交'); $('#sub', root).disabled = true; $('#ans', root).readOnly = true;
        const r = P.gradeAnswer(it.en, v); const ok = r.score >= D.PASS.write;
        result(ok, r.score, `<div class="score ${r.score >= 80 ? 'good' : r.score >= 50 ? 'mid' : 'low'}"><b>${r.score}</b> 分${r.near ? '（差一个字母）' : ''}</div><div class="diff">${r.tokens.map(t => `<span class="${t.status}" ${t.heard ? `title="你写的：${esc(t.heard)}"` : ''}>${esc(t.w)}</span>`).join(' ')}</div>`);
      };
    }
    function answerTrans(ch) {
      const toZh = st.dir !== 'zh2en' || !hasZh; const lang = toZh ? 'zh-CN' : 'en-US';
      const hint = ch !== 'fuzzy' ? '' : toZh ? (it.zh ? `<div class="hintbox" id="hintbox">💡 提示：${esc(D.zhHint(word && st.sense ? `${st.sense.pos} ${st.sense.zh}` : it.zh, word))}</div>` : '<div class="hintbox" id="hintbox">💡 提示：先听一遍慢速</div>') : letters();
      $('#area', root).innerHTML = `${hint}<textarea id="ans" rows="2" placeholder="${toZh ? '写中文意思，或点 🎙️ 说中文' : '写英文，或点 🎙️ 说英文'}" aria-label="你的译文" ${toZh ? 'lang="zh"' : 'autocapitalize="off" spellcheck="false"'}></textarea>
        <div class="row gap ansrow">${sp.recSupported() ? `<button class="btn" id="recbtn">🎙️ 说${toZh ? '中文' : '英文'}</button>` : ''}<button class="btn primary grow" id="sub">提交判分</button></div>
        <p class="muted small">${ai.isConfigured() ? '用你配置的 AI 判断意思对不对（同义说法也算对）。' : toZh ? '没有配置 AI：和参考译文 / 词典释义做宽松的关键词比对，不懂同义改写，判得不对可以改判。' : '没有配置 AI：和原句逐词模糊比对，换了说法可能判低，可以改判。'}</p>`;
      if (sp.recSupported()) micButton($('#area', root), lang, (text, _u, why) => { if (!text) return toast('⚠️ ' + why + ' 可以直接打字。', 4000); $('#ans', root).value = text; }, `🎙️ 说${toZh ? '中文' : '英文'}`);
      $('#sub', root).onclick = async () => {
        const v = $('#ans', root).value.trim(); if (!v) return toast('先说或写一点再提交'); const btn = $('#sub', root); btn.disabled = true; $('#ans', root).readOnly = true;
        const refs = toZh ? (word ? [...new Set([st.sense?.zh, ...S.parse(it.zh).flatMap(x => S.items(x.zh))].filter(Boolean).flatMap(z => S.items(z)))] : [it.zh]) : [it.en];
        if (ai.isConfigured()) {
          btn.textContent = 'AI 判分中…';
          try { const j = await ai.judgeTranslation({ src: toZh ? it.en : it.zh, ref: toZh ? it.zh : it.en, answer: v, dir: toZh ? 'en2zh' : 'zh2en' });
            return result(j.ok, j.score, `<div class="score ${j.score >= 80 ? 'good' : j.score >= 50 ? 'mid' : 'low'}"><b>${j.score}</b> 分 <span class="tag">AI 判分，仅供参考</span></div>${j.comment ? `<div class="small">${esc(j.comment)}</div>` : ''}${j.better ? `<div class="muted small">更好的说法：${esc(j.better)}</div>` : ''}`, { override: true });
          } catch (e) { toast('AI 判分没成功，改用本地比对：' + e.message, 5000); }
        }
        if (toZh) {
          if (!it.zh) return result(false, null, '<div class="note small">没有参考译文，没法本地判分：请对照答案自己判断。</div>', { override: true });
          const g = D.looseZh(refs, v); const ok = g.score >= D.PASS.trans;
          result(ok, g.score, `<div class="score ${g.score >= 80 ? 'good' : g.score >= 50 ? 'mid' : 'low'}"><b>${g.score}</b> 分 <span class="tag">本地宽松比对</span></div>
            <div class="muted small">对上的关键字：${g.hit.length ? esc(g.hit.join('、')) : '无'}${g.miss.length ? `；没对上：${esc(g.miss.join('、'))}` : ''}${g.neg ? '；<b>否定意思（不/没…）对不上</b>' : ''}。只看字面关键字，意思对但换了说法会判低，可以改判。</div>`, { override: true });
        } else {
          const g = D.fuzzyEn(it.en, v); const ok = g.score >= D.PASS.zh2en;
          result(ok, g.score, `<div class="score ${g.score >= 80 ? 'good' : g.score >= 50 ? 'mid' : 'low'}"><b>${g.score}</b> 分 <span class="tag">本地逐词模糊比对</span></div><div class="diff">${g.tokens.map(t => `<span class="${t.status}">${esc(t.w)}</span>`).join(' ')}</div>`, { override: true });
        }
      };
    }
  }
  ask();
}
