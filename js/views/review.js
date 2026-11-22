// 复习 = 练习：按遗忘曲线选内容，按难度“易→难、易难交叉、最难压轴”出题；v1.6 起和测验一样以听、读为主，每题自选 选/说/译/写，判分回写 SM-2。
import * as db from '../db.js';
import * as tts from '../tts.js';
import * as dict from '../dict.js';
import * as sp from '../speech.js';
import * as P from '../practice.js';
import * as S from '../sense.js';
import { dayNumber } from '../sm2.js';
import { settings, saveSettings, CARD_TYPE } from '../state.js';
import { onLeave } from '../app.js';
import { $, $$, esc, toast, hilite } from '../ui.js';
import { tokenize } from '../textproc.js';
import { undoBar } from '../matdelete.js';
import { mountRootBox, partsTiles } from '../rootbox.js';
import * as R from '../roots.js';
import * as D from '../drill.js';
import * as ai from '../ai.js';

const RQT = { listen: '🎧 听力', read: '📖 阅读', speak: '🗣️ 口说', trans: '🔁 翻译', write: '✍️ 默写', cloze: '✍️ 原句填空', parts: '🧩 拆解推测', rootm: '🌱 词根配对' };
const RM = { choose: 'choose', voice: 'say', trans: 'trans', text: 'write' }; // 复习页的作答方式 → 测验的作答方式（偏好共用）
const RMR = Object.fromEntries(Object.entries(RM).map(([a, b]) => [b, a]));
const MODE_LABEL = { choose: '☑️ 选', voice: '🎙️ 说', trans: '🔁 译', text: '⌨️ 写' };
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

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
  // v1.6 复习 = 练习，和测验一样以听、读为主：题型按 听 35% · 读 20% · 说 20% · 译 15% · 写 10% 分配（新卡只出听/读理解题；
  // 词根家族的生词前几次仍是 v1.5 的拆解推测/词根配对；“写”的名额给有原句的生词时出原句填空）。作答方式每题自己选：选/说/译/写，按题型记住。
  const plan0 = D.planTasks(order.map(x => ({ kind: x.c.type === 'sentence' ? 'sent' : 'word', zh: x.c.zh || '' })), { task: 'mix' });
  order.forEach((x, i) => {
    const legacy = P.chooseType(x.c); if (legacy === 'parts' || legacy === 'rootm') { x.qt = legacy; return; }
    let t = plan0[i]; if (!(x.c.sch?.reps) && !['listen', 'read'].includes(t)) t = i % 2 ? 'read' : 'listen';
    if (t === 'write' && P.availableTypes(x.c).includes('cloze')) t = 'cloze';
    x.qt = t;
  });
  // 生词：按原句词性给义项（显示中文、出“选意思”题都用它），避免“动词用法却给名词义”
  await Promise.all(order.map(async x => { if (x.c.type !== 'sentence' && !['parts', 'rootm'].includes(x.qt)) x.sense = await S.contextSense(x.c).catch(() => null); }));
  // 选择题干扰项池：全部材料的句子 + 句子卡；原声：句子卡对应材料有录音和时间戳就放原声
  const mats = await db.materials.all(); const sentInfo = new Map(); const pool = []; const seenEn = new Set();
  for (const m of mats) for (const s of m.sentences || []) { if (s.en && !seenEn.has(s.en)) { seenEn.add(s.en); pool.push({ id: s.id, en: s.en, zh: s.zh || '' }); } sentInfo.set(s.id, { m, s }); }
  for (const c of cards) if (c.type === 'sentence' && !seenEn.has(c.term)) { seenEn.add(c.term); pool.push({ id: c.sentenceId || c.id, en: c.term, zh: c.zh || '' }); }

  const plan = () => {
    root.innerHTML = `<header class="top"><h1>今日复习练习</h1><span class="muted">按遗忘曲线挑出 ${order.length} 项 · 到期 ${sel.dueCount} · 新 ${sel.newCount}</span></header>
      <div class="note small">复习就是练习，<b>以听、读为主</b>：听 35% · 读 20% · 说 20% · 译 15% · 写 10%（新卡只出听/读）。顺序先易后难、易难交叉，<b>最难的放在最后</b>。每题先选<b>不会 / 模糊 / 会 / 熟练</b>，作答方式自己选：<b>选 / 说 / 译 / 写</b>（按题型记住你的选择）。</div>
      <button class="btn primary big" id="go">开始练习（${order.length} 题）</button>
      <h2>本轮顺序</h2><ol class="plan">${order.map((x, i) => `<li class="pl ${x.tail ? 'tail' : ''}" data-i="${i}" data-qt="${x.qt}"><span class="pl-t">${esc(x.c.term.length > 42 ? x.c.term.slice(0, 41).replace(/\s+\S*$/, '') + '…' : x.c.term)}</span>
        <span class="pl-m"><span class="lvl-${P.level(x.diff)}">${P.level(x.diff)} ${x.diff}</span> · ${RQT[x.qt]} · ${x.c.sch?.seen ? '遗忘概率 ' + pct(x.fp) : '新'}${x.tail ? ' · 压轴' : ''}</span>
        <i class="dbar"><b style="width:${x.diff}%"></b></i></li>`).join('')}</ol>`;
    $('#go', root).onclick = () => draw();
  };

  const queue = order.slice(); const total = order.length; let done = 0; const scores = []; const tally = { dunno: 0, fuzzy: 0, know: 0, master: 0, ok: 0, bad: 0 }; const byTask = {};
  let st = null, recorder = null, au = null, auTok = 0; const urls = new Map();
  const stopAudio = () => { auTok++; au?.pause(); tts.cancel(); };
  onLeave(() => { stopAudio(); recorder?.stop().catch(() => { }); void sp.abortLiveShadowing(); document.querySelector('#undobar')?.remove(); });
  /** 播放标准答案：句子卡的材料有原声就放原声这一句（慢速 0.75×），否则朗读（TTS） */
  async function playRef(slow = false) {
    const c = st.x.c; stopAudio(); const my = auTok; const inf = c.type === 'sentence' && c.sentenceId ? sentInfo.get(c.sentenceId) : null;
    if (inf?.m.audioId && inf.s.t0 != null && inf.s.t1 != null) {
      if (!urls.has(inf.m.audioId)) { const b = await db.blobs.get('audio:' + inf.m.audioId).catch(() => null); urls.set(inf.m.audioId, b ? URL.createObjectURL(b.blob) : null); }
      const url = urls.get(inf.m.audioId);
      if (url && my === auTok) {
        au = au || new Audio(); if (au.src !== url) au.src = url; au.playbackRate = slow ? 0.75 : 1; au.currentTime = inf.s.t0;
        try { await au.play(); const end = inf.s.t1; const fn = () => { if (my !== auTok || au.currentTime >= end || au.ended) { au.removeEventListener('timeupdate', fn); if (my === auTok) au.pause(); } }; au.addEventListener('timeupdate', fn); return; } catch (e) { /* 放不了原声就朗读 */ }
      }
    }
    return tts.speak(c.term, { rate: slow ? 0.6 : settings.rate }).catch(e => toast(e.message));
  }
  const speakRef = () => playRef();
  const bump = k => { const h = document.documentElement; h.dataset[k] = String((+h.dataset[k] || 0) + 1); }; // 给新手引导用：是否已选过/点过下一题
  const isMc = x => x.qt === 'parts' || x.qt === 'rootm';
  const word = () => st.x.c.type !== 'sentence';
  const prefKey = x => x.qt === 'cloze' ? 'cloze' : x.qt;
  /** 题目给什么：五种练习题按作答方式变（和测验同一套规则）；原句填空固定给挖空的原句 */
  const stim = () => {
    const x = st.x, c = x.c;
    if (x.qt === 'cloze') return { audio: false, cloze: true, label: '原句填空', ask: st.mode === 'choose' ? '原句填空：选出空里的词' : '原句填空：空里应该是什么？说出来或写下来' };
    return D.stimulus(x.qt, RM[st.mode], { dir: st.dir, hasZh: !!(c.zh && c.zh.trim()), word: word() });
  };
  const zhShow = () => { const x = st.x, c = x.c; return word() && x.sense ? S.briefText({ pos: x.sense.pos, zh: x.sense.zh }, 99) : (c.zh || ''); };
  const prompt = (x) => {
    const c = x.c;
    if (x.qt === 'parts') return `<div class="rv-q muted">拆解推测：看词根词缀，猜这个词的意思</div><div class="rv-en">${esc(c.term)}</div><div class="rbox rv-parts">${partsTiles(c.term)}</div>`;
    if (x.qt === 'rootm') { const rq = x.rq || (x.rq = P.rootQuestion(c, 'rootm')); return `<div class="rv-q muted">词根配对：<b class="rv-root">${esc(rq.root.forms.join(' / '))}</b> 是什么意思？</div><div class="muted small">出自 ${esc(c.term)}</div>`; }
    const sti = stim();
    if (sti.cloze) return `<div class="rv-q muted">${esc(sti.ask)}</div><div class="rv-sent">${mask(c.sentence.en, c.term)}</div>${c.sentence.zh ? `<div class="muted">${esc(c.sentence.zh)}</div>` : ''}<div class="muted small">提示：${esc(c.zh || '')}</div>`;
    return `<div class="rv-q muted">${esc(sti.ask)}</div>
      ${sti.en ? `<div class="rv-en dr-en">${esc(c.term)}</div>${word() && c.sentence?.en ? `<div class="rv-sent small">${hilite(c.sentence.en, c.term)}</div>` : ''}` : ''}
      ${sti.zh ? `<div class="rv-zh">${esc(zhShow())}</div>${word() && S.parse(c.zh).length > 1 ? `<details class="allsense"><summary>展开全部释义</summary>${S.fullHtml(c.zh)}</details>` : ''}${word() && c.sentence?.zh ? `<div class="muted small">语境：${esc(c.sentence.zh)}</div>` : ''}` : ''}
      ${sti.audio ? `<div class="row gap center"><button class="btn primary" id="say">🔊 ${sti.en ? '听' : '播放'}</button><button class="btn" id="slow">🐢 慢速</button></div>` : ''}
      ${st.mode === 'trans' && c.zh && !st.result ? `<div class="seg trdir" role="tablist" aria-label="翻译方向"><a role="tab" data-dir="en2zh" class="${st.dir === 'en2zh' ? 'on' : ''}">英 → 中</a><a role="tab" data-dir="zh2en" class="${st.dir === 'zh2en' ? 'on' : ''}">中 → 英</a></div>` : ''}`;
  };

  /** 选择题选项：原句填空 → 拼写相近的别的生词；句子 → 听力题交替“选意思/选听到的英文”，其余选意思；生词 → 选意思（词典干扰项），听力题没有就选拼写 */
  async function choicesFor() {
    if (st.opts !== null) return st.opts; const x = st.x, c = x.c;
    if (x.qt === 'cloze') { st.kind = 'word'; return st.opts = D.wordTextChoices(c.term, cards.filter(o => o.type !== 'sentence' && o.id !== c.id).map(o => o.term)) || false; }
    if (!word()) {
      const kinds = x.qt === 'listen' ? (done % 2 ? ['text', 'mean'] : ['mean', 'text']) : ['mean'];
      for (const k of kinds) { const o = D.sentChoices({ id: c.sentenceId || c.id, en: c.term, zh: c.zh || '' }, pool, k); if (o) { st.kind = k; return st.opts = o; } }
      return st.opts = false;
    }
    if (x.sense && c.zh) {
      const others = cards.filter(o => o.id !== c.id && o.term.toLowerCase() !== c.term.toLowerCase()).map(o => o.zh).filter(Boolean);
      const dis = await S.distractors(x.sense, shuffle(others), 3).catch(() => []);
      const optText = s => S.briefText({ ...s, pos: S.posKey(s.pos) === 'v' ? 'v.' : s.pos }, 4);
      if (dis.length >= 2) { st.kind = 'mean'; return st.opts = shuffle([{ t: optText(x.sense), ok: true }, ...dis.map(d => ({ t: optText(d), ok: false }))]); }
    }
    st.kind = 'text'; return st.opts = (x.qt === 'listen' ? D.wordTextChoices(c.term, cards.map(o => o.term)) : null) || false;
  }
  async function modeWhy(m) {
    const x = st.x, c = x.c;
    if (m === 'choose') return (await choicesFor()) ? '' : '这题凑不出选择题（可用的干扰项太少）';
    if (m === 'trans') return x.qt === 'cloze' ? '填空题不做翻译' : (c.zh && c.zh.trim()) || ai.isConfigured() ? '' : '没有中文参考、也没配置 AI，没法判翻译';
    return '';
  }

  async function draw() {
    if (!queue.length) return finish();
    const x = queue[0]; stopAudio();
    st = { x, choice: null, result: null, audio: null, opts: null, kind: null, why: {}, dir: settings.drillDir === 'zh2en' && x.c.zh ? 'zh2en' : 'en2zh', replay: false };
    if (!isMc(x)) {
      const me = st; for (const m of Object.keys(RM)) me.why[m] = await modeWhy(m); if (st !== me) return;
      const prefs = settings.drillModes || {}; const k = prefKey(x);
      let m = RMR[k === 'cloze' ? (D.MODES[prefs.cloze] ? prefs.cloze : 'choose') : D.modeFor(k, prefs)];
      if (st.why[m]) m = ['choose', 'voice', 'text'].find(y => !st.why[y]) || 'text';
      st.mode = m;
    }
    render(true);
  }
  const modesHtml = () => `<div class="amodes ansmode" role="radiogroup" aria-label="作答方式">${Object.keys(RM).map(m => `<button class="btn am ${m === st.mode ? 'on' : ''}" data-mode="${m}" role="radio" aria-checked="${m === st.mode}" ${st.why[m] ? `disabled title="${esc(st.why[m])}"` : ''}>${MODE_LABEL[m]}</button>`).join('')}</div>
    ${st.choice ? '' : `<p class="muted small amnote">作答方式自己选：<b>选</b>选择题 · <b>说</b>用语音 · <b>译</b>说出/写出意思 · <b>写</b>键入英文（会记住你在「${RQT[st.x.qt].replace(/^\S+\s/, '')}」题的选择）</p>`}`;
  function render(first = false) {
    const x = st.x; const sti = isMc(x) ? {} : stim();
    root.innerHTML = `<header class="top"><h1>复习练习</h1><span class="muted">${done}/${total} · 剩 ${queue.length}</span></header>
      <div class="bar"><i style="width:${Math.round(100 * done / total)}%"></i></div>
      <section class="rvcard" data-cid="${esc(x.c.id)}" data-qt="${x.qt}" data-mode="${st.mode || 'choose'}"><span class="tag">${(CARD_TYPE[x.c.type] || '词')}${x.c.sch?.seen ? '' : ' · 新'} · ${RQT[x.qt]}${sti.label ? ' · ' + sti.label : ''} · <span class="lvl-${P.level(x.diff)}">${P.level(x.diff)}</span>${x.tail ? ' · 压轴' : ''}</span>${prompt(x)}</section>
      ${isMc(x) || st.result ? '' : modesHtml()}
      ${st.choice ? `<div class="chosen muted small">你选了：<b>${P.CHOICE_ZH[st.choice]}</b>${st.choice === 'fuzzy' ? '（对了 9 天后再练，错了 3 天后）' : '（对了 12 天后再练，错了 1 天后）'}</div>` : choicesHtml()}
      <div id="ansarea"></div><div id="fb"></div>`;
    $('#say', root)?.addEventListener('click', () => playRef());
    $('#slow', root)?.addEventListener('click', () => playRef(true));
    if (sti.audio === 'auto' && (first || st.replay)) { const me = st; setTimeout(() => { if (st === me && !st.choice) playRef(); }, 300); }
    st.replay = false;
    $$('[data-mode]', root).forEach(b => b.onclick = () => {
      if (b.disabled || st.result) return; const m = b.dataset.mode; if (m === st.mode) return;
      const prevAudio = stim().audio; st.mode = m; saveSettings({ drillModes: { ...(settings.drillModes || {}), [prefKey(st.x)]: RM[m] } });
      if (recorder) { recorder.stop().catch(() => { }); recorder = null; }
      st.replay = !prevAudio; stopAudio(); render();
    });
    $$('[data-dir]', root).forEach(b => b.onclick = () => { st.dir = b.dataset.dir; saveSettings({ drillDir: st.dir }); render(); });
    $$('[data-ch]', root).forEach(b => b.onclick = () => choose(b.dataset.ch));
    if (st.choice) ansArea();
  }
  function choose(ch) {
    if (st.choice) return; st.choice = ch; bump('rvChose'); stopAudio();
    if (ch === 'dunno') return giveUp();
    if (ch === 'master') return master();
    render();
    if (st.mode === 'text') setTimeout(() => $('#ans', root)?.focus(), 50);
  }
  const choicesHtml = () => `<div class="choices" role="group" aria-label="先选：你会吗？">${P.CHOICES.map(([k, t]) => `<button class="btn ch ch-${k}" data-ch="${k}">${{ dunno: '🙈', fuzzy: '🤔', know: '🙂', master: '⭐' }[k]} ${t}</button>`).join('')}</div>
      <p class="muted small chnote">先选再答：<b>不会</b>直接看答案（明天再练）·<b>模糊</b>先给提示再答·<b>会</b>直接答·<b>熟练</b>以后不再出（可撤销）</p>`;
  /** 作答区：按作答方式 */
  function ansArea() {
    const x = st.x, ch = st.choice; if (st.result) return;
    if (isMc(x)) return mcBox(ch);
    if (st.mode === 'choose') return chooseBox(ch);
    if (st.mode === 'trans') return transBox(ch);
    const c = x.c, h = P.hintText(c.term); const sti = stim();
    $('#ansarea', root).innerHTML = `${ch === 'fuzzy' ? `<div class="hintbox" id="hintbox">💡 提示：<b class="hintl">${esc(h.letters)}</b>（${h.count} 个词）${!sti.zh && !sti.cloze && c.zh ? `<div class="muted small">中文：${esc(c.zh)}</div>` : ''}</div>` : ''}<div id="ansbox"></div>`;
    ansBox();
  }
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
  /** 选：模糊 → 去掉一半干扰项 */
  async function chooseBox(ch) {
    const opts = await choicesFor(); if (!opts) { st.mode = 'text'; return render(); }
    const keep = ch === 'fuzzy' ? new Set(P.eliminate(opts)) : null;
    $('#ansarea', root).innerHTML = `${keep ? `<div class="hintbox" id="hintbox">💡 提示：已去掉 ${opts.length - keep.size} 个干扰项</div>` : ''}<div class="muted small">${st.kind === 'word' ? '选出空里的词：' : st.kind === 'text' ? '选出你听到的英文：' : '选出意思：'}</div>
      <div class="opts" role="group" aria-label="选项">${opts.map((o, k) => `<button class="btn opt ${keep && !keep.has(k) ? 'elim' : ''}" data-k="${k}"${o.ok ? ' data-ok' : ''}${keep && !keep.has(k) ? ' disabled aria-disabled="true"' : ''}>${esc(o.t)}</button>`).join('')}</div>`;
    $$('.opt', root).forEach(b => b.onclick = () => {
      if (st.result || b.disabled) return; const o = opts[+b.dataset.k];
      $$('.opt', root).forEach((y, k) => { y.disabled = true; if (opts[k].ok) y.classList.add('right'); else if (y === b) y.classList.add('bad'); });
      st.result = { score: o.ok ? 100 : 0, mode: 'choice', answer: o.t }; scores.push(st.result.score);
      finalize(o.ok, o.ok ? '' : `<div class="muted small">正确：<b>${esc(opts.find(y => y.ok).t)}</b></div>`);
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
    if (!sp.recSupported()) { box.innerHTML = `<div class="note">这个浏览器不能录音，请用「写」或「选」作答。</div>`; return; }
    box.innerHTML = `<div class="row gap ansrow"><button class="btn primary big grow" id="recbtn">🎙️ 按一下开始说</button></div>
      <p class="muted small">${a.ok ? `说完再按一次。用浏览器语音识别转成文字，再和答案模糊比对（近音、单复数、时态差一点都算接近；${sp.ASR_LABEL}）。` : `⚠️ 语音识别不可用：${esc(a.why)} 仍可录音 → 回放对照参考答案 → 自己判断对不对。`}
      录音只在本机内存里，不上传、不保存。第一次会请求麦克风权限。</p>`;
    const btn = $('#recbtn', box);
    btn.onclick = async () => {
      if (!recorder) {
        try { stopAudio(); recorder = await sp.startShadowing({ useAsr: a.ok }); btn.textContent = '■ 说完了'; btn.classList.add('recording'); }
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
  /** 译：英→中（默认）或中→英；说或写都行。有 AI → AI 判意思；没有 → 本地宽松比对（如实标注，可改判） */
  function transBox(ch) {
    const x = st.x, c = x.c; const toZh = st.dir !== 'zh2en' || !c.zh; const lang = toZh ? 'zh-CN' : 'en-US';
    const h = P.hintText(c.term);
    const hint = ch !== 'fuzzy' ? '' : toZh ? `<div class="hintbox" id="hintbox">💡 提示：${esc(D.zhHint(word() && x.sense ? `${x.sense.pos} ${x.sense.zh}` : c.zh, word()) || '先听一遍慢速')}</div>` : `<div class="hintbox" id="hintbox">💡 提示：<b class="hintl">${esc(h.letters)}</b>（${h.count} 个词）</div>`;
    $('#ansarea', root).innerHTML = `${hint}<div id="ansbox"><textarea id="ans" rows="2" placeholder="${toZh ? '写中文意思，或点 🎙️ 说中文' : '写英文，或点 🎙️ 说英文'}" aria-label="你的译文" ${toZh ? 'lang="zh"' : 'autocapitalize="off" spellcheck="false"'}></textarea>
      <div class="row gap ansrow">${sp.recSupported() ? `<button class="btn" id="recbtn">🎙️ 说${toZh ? '中文' : '英文'}</button>` : ''}<button class="btn primary grow" id="sub">提交判分</button></div>
      <p class="muted small">${ai.isConfigured() ? '用你配置的 AI 判断意思对不对（同义说法也算对）。' : toZh ? '没有配置 AI：和参考译文 / 词典释义做宽松的关键词比对，不懂同义改写，判得不对可以改判。' : '没有配置 AI：和原句逐词模糊比对，换了说法可能判低，可以改判。'}</p></div>`;
    const rb = $('#recbtn', root);
    if (rb) { const a = asrStatus(); const label = rb.textContent; rb.onclick = async () => {
      if (!recorder) { try { stopAudio(); recorder = await sp.startShadowing({ lang, useAsr: a.ok }); rb.textContent = '■ 说完了'; rb.classList.add('recording'); } catch (e) { recorder = null; toast(e.message, 5000); } return; }
      rb.disabled = true; const r = await recorder.stop(); recorder = null; rb.disabled = false; rb.classList.remove('recording'); rb.textContent = label;
      if (r.asr && r.transcript) $('#ans', root).value = r.transcript; else toast('⚠️ ' + (!r.asr ? a.why || '语音识别不可用。' : '没有识别出文字。') + ' 可以直接打字。', 4000);
    }; }
    keepVisible($('#ans', root), $('.ansrow', root));
    $('#sub', root).onclick = async () => {
      const v = $('#ans', root).value.trim(); if (!v) return toast('先说或写一点再提交'); const btn = $('#sub', root); btn.disabled = true; $('#ans', root).readOnly = true;
      const refs = toZh ? (word() ? [...new Set([x.sense?.zh, ...S.parse(c.zh).flatMap(y => S.items(y.zh))].filter(Boolean).flatMap(z => S.items(z)))] : [c.zh]) : [c.term];
      const done1 = (ok, score, html) => { st.result = { score, mode: 'trans:' + (toZh ? 'en2zh' : 'zh2en'), answer: v }; if (score != null) scores.push(score); $('#ansarea', root).innerHTML = ''; finalize(ok, html, false, { override: true }); };
      const sc = g => `score ${g >= 80 ? 'good' : g >= 50 ? 'mid' : 'low'}`;
      if (ai.isConfigured()) {
        btn.textContent = 'AI 判分中…';
        try { const j = await ai.judgeTranslation({ src: toZh ? c.term : c.zh, ref: toZh ? c.zh : c.term, answer: v, dir: toZh ? 'en2zh' : 'zh2en' });
          return done1(j.ok, j.score, `<div class="${sc(j.score)}"><b>${j.score}</b> 分 <span class="tag">AI 判分，仅供参考</span></div>${j.comment ? `<div class="small">${esc(j.comment)}</div>` : ''}${j.better ? `<div class="muted small">更好的说法：${esc(j.better)}</div>` : ''}`);
        } catch (e) { toast('AI 判分没成功，改用本地比对：' + e.message, 5000); }
      }
      if (toZh) {
        if (!c.zh) return done1(false, null, '<div class="note small">没有参考译文，没法本地判分：请对照答案自己判断（可改判）。</div>');
        const g = D.looseZh(refs, v);
        return done1(g.score >= D.PASS.trans, g.score, `<div class="${sc(g.score)}"><b>${g.score}</b> 分 <span class="tag">本地宽松比对</span></div>
          <div class="muted small">对上的关键字：${g.hit.length ? esc(g.hit.join('、')) : '无'}${g.miss.length ? `；没对上：${esc(g.miss.join('、'))}` : ''}${g.neg ? '；<b>否定意思（不/没…）对不上</b>' : ''}。只看字面关键字，意思对但换了说法会判低，可以改判。</div>`);
      }
      const g = D.fuzzyEn(c.term, v);
      done1(g.score >= D.PASS.zh2en, g.score, `<div class="${sc(g.score)}"><b>${g.score}</b> 分 <span class="tag">本地逐词模糊比对</span></div><div class="diff">${g.tokens.map(t => `<span class="${t.status}">${esc(t.w)}</span>`).join(' ')}</div>`);
    };
  }
  /** 键盘弹出（视口变矮）时，让作答行留在屏幕里。 */
  function keepVisible(input, row) {
    if (!input || !row) return;
    const fit = () => { if (document.activeElement === input && row.isConnected) row.scrollIntoView({ block: 'nearest' }); };
    input.addEventListener('focus', () => setTimeout(fit, 250));
    const vv = window.visualViewport; if (vv) { vv.addEventListener('resize', fit); onLeave(() => vv.removeEventListener('resize', fit)); }
    window.addEventListener('resize', fit); onLeave(() => window.removeEventListener('resize', fit));
  }
  const rootable = c => c.type !== 'sentence' && /^[A-Za-z][A-Za-z'’-]+$/.test(String(c.term).trim());
  const mountRv = () => { const el = $('#rvroot', root); if (el) mountRootBox(el, st.x.c.term.trim()); };
  const answerHtml = () => { const c = st.x.c; return `<div class="rv-ans"><div class="rv-en">${esc(c.term)} <button class="mini" id="hear" aria-label="听发音">🔊</button></div>${c.type !== 'sentence' && S.parse(c.zh).length > 1 ? `<div class="muted senses">${S.fullHtml(c.zh)}</div>` : `<div class="muted">${esc(c.zh || '')}</div>`}${c.sentence?.en && c.type !== 'sentence' ? `<div class="rv-sent small">${esc(c.sentence.en)}</div>` : ''}</div>`; };
  const nextHtml = days => `${rootable(st.x.c) ? '<div id="rvroot"></div>' : ''}<p class="muted small nextdue">下次复习：<b id="nd">${dayLabel(days)}</b></p><button class="btn primary big" id="next">下一题</button>`;
  function bindNext(x) { mountRv(); $('#hear', root)?.addEventListener('click', () => speakRef()); $('#next', root).onclick = () => advance(x); $('#next', root).focus({ preventScroll: true }); $('#fb', root).scrollIntoView({ block: 'nearest' }); }
  // 不会：马上给出答案（原句/释义/🔊），1 天后再练；本轮不再出
  async function giveUp() {
    const x = st.x; st.result = { score: null, mode: 'gaveup' }; tally.dunno++; countTask(x, false);
    $('.choices', root)?.remove(); $('.chnote', root)?.remove(); $('.ansmode', root)?.remove(); $('.amnote', root)?.remove();
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
  /** 写：逐词拼写（≥80 分算对，差一个字母宽容）；说：语音转写后逐词模糊比对（≥70 分算对，可改判） */
  function grade(answer, mode) {
    const ref = st.x.c.term;
    if (mode === 'voice') {
      const g = D.fuzzyEn(ref, answer); const ok = g.score >= D.PASS.say;
      st.result = { score: g.score, mode, answer }; scores.push(g.score);
      $('#ansarea', root).innerHTML = '';
      return finalize(ok, `<div class="muted small">识别到：“${esc(answer)}”（${sp.ASR_LABEL}，语音识别可能听错）</div>
        <div class="score ${g.score >= 80 ? 'good' : g.score >= 50 ? 'mid' : 'low'}"><b>${g.score}</b> 分 <span class="muted small">（${D.PASS.say} 分算对）</span></div>
        <div class="diff">${g.tokens.map(t => `<span class="${t.status}" ${t.heard ? `title="听成：${esc(t.heard)}"` : ''}>${esc(t.w)}</span>`).join(' ')}</div>`, false, { override: true });
    }
    const r = P.gradeAnswer(ref, answer); const ok = P.isCorrect(r.score);
    st.result = { score: r.score, mode, answer }; scores.push(r.score);
    $('#ansarea', root).innerHTML = '';
    finalize(ok, `<div class="score ${r.score >= 80 ? 'good' : r.score >= 50 ? 'mid' : 'low'}"><b>${r.score}</b> 分${r.near ? '（差一个字母）' : ''}</div>
      <div class="diff">${r.tokens.map(t => `<span class="${t.status}" ${t.heard ? `title="你的：${esc(t.heard)}"` : ''}>${esc(t.w)}</span>`).join(' ')}</div>`);
  }
  function selfCheck(why) {
    $('#ansarea', root).innerHTML = '<div id="ansbox"></div>';
    $('#fb', root).innerHTML = `<div class="note small">⚠️ ${esc(why)} 已保留你的录音：可再跟读一次评分，或回放对照答案自己判断。</div>${answerHtml()}
      ${st.audio ? `<div class="row gap center"><audio controls src="${st.audio}" id="myrec"></audio></div>` : ''}
      <div class="row gap"><button class="btn grow" id="retryRec">🎙 再跟读一次</button></div>
      <div class="grid2 selfchk"><button class="btn q5" id="selfOk">✓ 说对了</button><button class="btn q1" id="selfBad">✗ 没说对</button></div>`;
    $('#hear', root)?.addEventListener('click', () => speakRef());
    $('#retryRec', root).onclick = () => { $('#fb', root).innerHTML = ''; ansBox(); };
    $('#selfOk', root).onclick = () => { st.result = { score: null, mode: 'voice-self' }; finalize(true, '', true); };
    $('#selfBad', root).onclick = () => { st.result = { score: null, mode: 'voice-self' }; finalize(false, '', true); };
  }
  const countTask = (x, ok) => { const k = x.qt === 'cloze' ? 'write' : ['parts', 'rootm'].includes(x.qt) ? 'read' : x.qt; const b = byTask[k] || (byTask[k] = { n: 0, ok: 0 }); b.n++; if (ok) b.ok++; };
  async function finalize(ok, html, self = false, { override = false } = {}) {
    const x = st.x; ok ? tally.ok++ : tally.bad++; tally[st.choice]++; countTask(x, ok);
    $('.ansmode', root)?.remove(); $('.trdir', root)?.remove();
    const prev = x.c.sch; const { days, rec } = await commit(x, st.choice, ok);
    const verdict = v => `<div class="fb ${v ? 'good' : 'low'} verdict">${v ? '✓ 答对了' : '✗ 没答对，正确答案在下面'}</div>`;
    $('#fb', root).innerHTML = `${self ? `${answerHtml()}${st.audio ? `<div class="row gap center"><audio controls src="${st.audio}" id="myrec"></audio></div>` : ''}` : html}
      <div id="vd">${verdict(ok)}</div>${override ? `<div class="row gap wrap ovr"><span class="muted small">判得不对？</span><button class="mini" data-ov="1">算我对</button><button class="mini" data-ov="0">算我错</button></div>` : ''}${!self ? answerHtml() : ''}${!self && st.audio ? `<div class="row gap center"><audio controls src="${st.audio}" id="myrec"></audio></div>` : ''}${nextHtml(days)}`;
    $('#hintbox', root)?.remove(); bindNext(x);
    // 改判：按改后的对错重新排下次复习（覆盖刚才那条记录，间隔规则不变）
    let cur = ok;
    $$('[data-ov]', root).forEach(b => b.onclick = async () => {
      const v = b.dataset.ov === '1'; if (v === cur) return; cur = v; const c = x.c; const r = P.scheduleChoice(prev, st.choice, v); c.sch = r.sch; await db.cards.save(c);
      await db.reviews.add({ ...rec, q: r.q, correct: v, days: r.days, overridden: true });
      v ? (tally.ok++, tally.bad--) : (tally.ok--, tally.bad++); const bt = byTask[x.qt === 'cloze' ? 'write' : x.qt]; if (bt) bt.ok += v ? 1 : -1;
      $('#vd', root).innerHTML = verdict(v) + '<div class="muted small">（你改判了）</div>'; $('#nd', root).textContent = dayLabel(r.days);
    });
  }
  async function commit(x, choice, correct) {
    const c = x.c; const { sch, q, days } = P.scheduleChoice(c.sch, choice, correct); c.sch = sch; await db.cards.save(c);
    const rec = { cardId: c.id, q, choice, correct: choice === 'master' ? null : !!correct, days, ts: Date.now(), day: dayNumber(), mode: st.result?.mode || choice, qtype: x.qt + (st.mode && !isMc(x) ? ':' + RM[st.mode] : ''), score: st.result?.score ?? null };
    const saved = await db.reviews.add(rec);
    return { days, id: saved.id, rec: { ...rec, id: saved.id } };
  }
  function advance(x) {
    if (queue[0] !== x) return; // 防止连点
    queue.shift(); done++; bump('rvNext'); draw();
  }
  function finish() {
    const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    root.innerHTML = `<header class="top"><h1>复习练习</h1></header><div class="empty"><div class="big-emoji">🎉</div><p><b>今天的复习完成了！</b></p>
      <p class="muted">练习 ${total} 项${avg != null ? `，作答平均 ${avg} 分` : ''}。不会 ${tally.dunno} · 模糊 ${tally.fuzzy} · 会 ${tally.know} · 熟练 ${tally.master}；答对 ${tally.ok}、答错 ${tally.bad}。</p>
      ${Object.keys(byTask).length ? `<div class="skilltab">${['listen', 'read', 'speak', 'trans', 'write'].filter(k => byTask[k]).map(k => `<div class="sk"><b>${RQT[k]}</b><span>${byTask[k].ok}/${byTask[k].n} 对</span></div>`).join('')}</div>` : ''}
      <p class="muted small">间隔：不会→1 天；模糊 对→9 天/错→3 天；会 对→12 天/错→1 天；熟练→不再出现（生词本里可恢复）。</p><a class="btn primary" href="#/">回首页</a></div>`;
    if (total) import('../celebrate.js').then(C => C.sessionDone({ key: 'review:' + Date.now(), title: '今天的复习完成了！', n: total, ok: tally.ok, avg, lines: [`练习 ${total} 项`, `不会 ${tally.dunno} · 模糊 ${tally.fuzzy} · 会 ${tally.know} · 熟练 ${tally.master}`] })).catch(e => console.warn(e));
  }
  if (params.go) { draw(); } else plan();
}
