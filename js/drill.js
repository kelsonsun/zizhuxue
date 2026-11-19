// v1.6 测验以「听、读、说、译」为主，默写为辅（纯函数，可单测）。
// 设计依据（输入优先、可理解输入、听说领先）：
//  · 先大量“听懂/看懂/认得出”（理解型题：听音选义、听音选文本、阅读认读），再“说出来”（复述、朗读跟读、看中文说），
//    翻译做意思检验（英译中为主，可切中译英），拼写默写只占少量（成年人最容易受挫、对“听得懂看得懂”帮助最小）。
//  · 每道题由题型决定给什么刺激（声音 / 英文 / 中文），作答方式由用户自己选：选 / 说 / 译 / 写；每种题型记住用户上次的选择。
//  · 不会 / 模糊 / 会 / 熟练 四个按钮和间隔规则不变（practice.js 的 scheduleChoice）。
import { tokenize } from './textproc.js';

export const TASKS = { listen: '听力', read: '阅读理解', speak: '口说跟读', trans: '翻译', write: '默写' };
export const TASK_ICON = { listen: '🎧', read: '📖', speak: '🗣️', trans: '🔁', write: '✍️' };
/** 综合练习的题型比例：听 35%、读 20%、说 20%、译 15%、写 10% */
export const MIX = { listen: 0.35, read: 0.2, speak: 0.2, trans: 0.15, write: 0.1 };
export const MODES = { choose: '选', say: '说', trans: '译', write: '写' };
export const MODE_ICON = { choose: '☑️', say: '🎙️', trans: '🔁', write: '⌨️' };
/** 每种题型默认的作答方式（理解题默认“选”，口说默认“说”）；用户改过就记住 */
export const DEFAULT_MODE = { listen: 'choose', read: 'choose', speak: 'say', trans: 'trans', write: 'write' };
export const modeFor = (task, prefs = {}) => (prefs && MODES[prefs[task]]) ? prefs[task] : DEFAULT_MODE[task];

/** 按比例分题数（最大余数法），n 道题 */
export function mixCounts(n, mix = MIX) {
  const ks = Object.keys(mix), tot = ks.reduce((a, k) => a + mix[k], 0);
  const raw = ks.map(k => n * mix[k] / tot), out = Object.fromEntries(ks.map((k, i) => [k, Math.floor(raw[i])]));
  let left = n - Object.values(out).reduce((a, b) => a + b, 0);
  ks.map((k, i) => [k, raw[i] - Math.floor(raw[i]), i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]).forEach(([k]) => { if (left > 0) { out[k]++; left--; } });
  return out;
}
/** 题型能不能用在这个条目上：翻译、默写（看中文）需要中文；默写只给句子或短语以外也行 */
export function taskOk(item, task) {
  if (item.kind === 'passage') return task === 'read';
  if (task === 'trans') return !!(item.zh && item.zh.trim());
  return true;
}
/**
 * 给条目排题型：综合（task='mix'）按比例；单项就全用这一种。相邻两题尽量不同型，前两题用理解题热身。
 * items：[{en, zh, kind}]；返回同样长度的题型数组。
 */
export function planTasks(items, { task = 'mix', mix = MIX, rnd = Math.random } = {}) {
  const n = items.length; if (task !== 'mix') return items.map(it => it.kind === 'passage' ? 'read' : task);
  const cnt = mixCounts(n, mix); const bag = []; for (const [k, v] of Object.entries(cnt)) for (let i = 0; i < v; i++) bag.push(k);
  for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
  // 理解题放前面热身：把前两个位置换成 listen/read
  for (let p = 0; p < Math.min(2, n); p++) if (!['listen', 'read'].includes(bag[p])) { const q = bag.findIndex((t, k) => k > 1 && (t === 'listen' || t === 'read')); if (q > 0) [bag[p], bag[q]] = [bag[q], bag[p]]; }
  const out = new Array(n); const used = new Array(n).fill(false);
  // 篇章题只能是“读”：先给它们分配“读”的名额（名额不够也按读出）
  for (let i = 0; i < n; i++) if (items[i].kind === 'passage') { const k = bag.findIndex((t, x) => !used[x] && t === 'read'); if (k >= 0) used[k] = true; out[i] = 'read'; }
  for (let i = 0; i < n; i++) {
    if (out[i]) continue;
    // 给第 i 个条目挑一个能用、且与上一题不同的题型
    let k = i < 2 ? bag.findIndex((t, x) => !used[x] && taskOk(items[i], t) && (t === 'listen' || t === 'read')) : -1;
    if (k < 0) k = bag.findIndex((t, x) => !used[x] && taskOk(items[i], t) && t !== out[i - 1]);
    if (k < 0) k = bag.findIndex((t, x) => !used[x] && taskOk(items[i], t));
    if (k < 0) { out[i] = taskOk(items[i], 'listen') ? 'listen' : 'read'; continue; }
    used[k] = true; out[i] = bag[k];
  }
  return out;
}
/**
 * 题目给什么、要答什么。task 题型；mode 作答方式；dir 翻译方向。
 * 返回 {audio: 'auto'|'button'|false, en, zh, ask, ans: 'choice'|'en'|'zh', label}
 */
export function stimulus(task, mode, { dir = 'en2zh', hasZh = true, word = false } = {}) {
  const W = word ? '词' : '句';
  const L = task === 'listen', S = task === 'speak';
  if (mode === 'choose') return L ? { audio: 'auto', en: false, zh: false, ans: 'choice', label: '听音选择', ask: '听一听，选出正确的一项' }
    : { audio: S ? 'auto' : 'button', en: true, zh: false, ans: 'choice', label: '认读选义', ask: `读这${W}英文，选出它的意思` };
  if (mode === 'say') {
    if (L) return { audio: 'auto', en: false, zh: false, ans: 'en', label: '听后复述', ask: `听一${W}，把听到的英文说出来` };
    if (task === 'read' || S || !hasZh) return { audio: S ? 'auto' : 'button', en: true, zh: false, ans: 'en', label: S ? '跟读' : '朗读', ask: S ? `先听，再跟着把这${W}读出来` : `把这${W}英文大声读出来` };
    return { audio: false, en: false, zh: true, ans: 'en', label: '看中文说英文', ask: `用英文说出这个意思` };
  }
  if (mode === 'trans') {
    if (dir === 'zh2en' && hasZh) return { audio: false, en: false, zh: true, ans: 'en', label: '中译英', ask: '把中文译成英文（说或写）' };
    return L ? { audio: 'auto', en: false, zh: false, ans: 'zh', label: '听后说中文', ask: '听一听，说出或写出它的中文意思' }
      : { audio: 'button', en: true, zh: false, ans: 'zh', label: '英译中', ask: '说出或写出它的中文意思' };
  }
  // write：英文拼写（少量）
  if (L || S || !hasZh) return { audio: 'auto', en: false, zh: false, ans: 'en', label: '听写', ask: `听一${W}，把它写下来` };
  return { audio: false, en: false, zh: true, ans: 'en', label: '看中文写英文', ask: '用英文写出这个意思' };
}

// ---------- 判分 ----------
const lev = (a, b) => { if (a === b) return 0; const m = a.length, n = b.length; if (!m || !n) return m || n; let p = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) { const c = [i]; for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; } return p[n]; };
const stem = w => w.replace(/(ies)$/, 'y').replace(/(ing|ed|es|s)$/, '');
const NUM = { zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };
/** 两个词算不算“差不多”（语音识别常见的近音/单复数/时态差异）：0 不同，1 一样，0.8 接近 */
export function wordSim(a, b) {
  if (a === b || (NUM[a] || a) === (NUM[b] || b)) return 1;
  if (a.length >= 3 && stem(a) === stem(b)) return 0.8;
  const d = lev(a, b), L = Math.max(a.length, b.length);
  if (L >= 4 && d <= 1) return 0.8; if (L >= 8 && d <= 2) return 0.8;
  return 0;
}
/**
 * 说（语音转写）/ 中译英：逐词模糊对齐（近音、单复数、时态差一点算接近），多说的词不扣分。
 * 返回 {score, tokens:[{w, status:'ok'|'near'|'miss', heard}]}
 */
export function fuzzyEn(ref, said) {
  const raw = String(ref || '').split(/\s+/).filter(Boolean); const R = raw.map(w => ({ show: w, norm: tokenize(w).join('') })).filter(x => x.norm);
  const H = tokenize(said); const n = R.length, m = H.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) { const s = wordSim(R[i].norm, H[j]); dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1], s ? dp[i + 1][j + 1] + s : 0); }
  const tokens = []; let i = 0, j = 0;
  while (i < n) {
    if (j < m) { const s = wordSim(R[i].norm, H[j]); if (s && Math.abs(dp[i][j] - (dp[i + 1][j + 1] + s)) < 1e-9) { tokens.push({ w: R[i].show, status: s === 1 ? 'ok' : 'near', heard: s === 1 ? undefined : H[j] }); i++; j++; continue; } }
    if (j < m && dp[i][j + 1] >= dp[i + 1][j]) { j++; continue; }
    tokens.push({ w: R[i].show, status: 'miss' }); i++;
  }
  const got = tokens.reduce((a, t) => a + (t.status === 'ok' ? 1 : t.status === 'near' ? 0.8 : 0), 0);
  return { score: n ? Math.round(100 * got / n) : 0, tokens };
}
const STOP = new Set('的了吗呢吧啊呀是在我你他她它们这那个一也都就很和与及把被给对着过地得么啦哦嗯请之其'.split(''));
const NEG = /[不没别未无非莫勿]/;
const zhNorm = s => String(s || '').replace(/[^\u3400-\u9fffA-Za-z0-9]/g, '');
const content = s => [...zhNorm(s)].filter(c => !STOP.has(c)).join('');
/**
 * 英译中（没有 AI 时）：和参考译文 / 词典释义做宽松的关键词比对——不懂同义改写，只看关键字和词对不对得上；否定词对不上直接判低。
 * refs：参考中文（句子是整句译文；单词是各条释义）。返回 {score, hit, miss, neg}
 */
export function looseZh(refs, ans) {
  const A = zhNorm(ans), Ac = content(ans); let best = { score: 0, hit: [], miss: [], neg: false };
  for (const ref of refs.map(String).filter(r => zhNorm(r))) {
    const R = zhNorm(ref), Rc = content(ref) || R; let score, hit = [], miss = [];
    if (A && (A.includes(R) || (R.includes(A) && A.length >= Math.max(2, 0.6 * R.length)))) { score = 100; hit = [R]; }
    else {
      const grams = []; for (let k = 0; k < Rc.length - 1; k++) grams.push(Rc.slice(k, k + 2)); if (!grams.length && Rc) grams.push(Rc);
      const gh = grams.filter(g => Ac.includes(g)); const ch = [...new Set(Rc)].filter(c => Ac.includes(c)); const cAll = [...new Set(Rc)];
      score = Math.round(100 * (0.55 * (grams.length ? gh.length / grams.length : 0) + 0.45 * (cAll.length ? ch.length / cAll.length : 0)));
      hit = gh; miss = grams.filter(g => !Ac.includes(g));
    }
    const neg = NEG.test(R) !== NEG.test(A); if (neg) score = Math.min(score, 40);
    if (score > best.score || (!best.score && !best.hit.length)) best = { score, hit: [...new Set(hit)].slice(0, 8), miss: [...new Set(miss)].slice(0, 8), neg };
  }
  return best;
}
/** 各种作答方式的“算答对”线：选择题必须选对；说（语音）≥70；写（拼写）≥80；本地宽松译文比对 ≥60；AI 判分看 AI 的结论 */
export const PASS = { choose: 100, say: 70, write: 80, trans: 60, zh2en: 70 };

// ---------- 选择题选项 ----------
const shuffle = (a, rnd = Math.random) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const overlap = (a, b) => { const A = new Set(tokenize(a)), B = tokenize(b); return B.filter(w => A.has(w)).length; };
/**
 * 句子题的选项：kind='mean' 选中文意思（干扰项是别的句子的译文，长度相近）；kind='text' 听音选英文（干扰项是用词相近的别的句子，考听辨）。
 * 干扰项不够 2 个返回 null。
 */
export function sentChoices(item, pool, kind = 'mean', rnd = Math.random) {
  const key = kind === 'mean' ? 'zh' : 'en'; const right = String(item[key] || '').trim(); if (!right) return null;
  const seen = new Set([right]); const cand = [];
  for (const s of pool) { const v = String(s[key] || '').trim(); if (!v || seen.has(v) || s.id === item.id) continue; seen.add(v); cand.push(v); }
  const L = right.length; const score = v => kind === 'text' ? overlap(right, v) * 3 - Math.abs(v.length - L) / Math.max(8, L) : -Math.abs(v.length - L) / Math.max(4, L);
  const top = cand.sort((a, b) => score(b) - score(a)).slice(0, 8); const dis = shuffle(top, rnd).slice(0, 3);
  if (dis.length < 2) return null;
  return shuffle([{ t: right, ok: true }, ...dis.map(t => ({ t, ok: false }))], rnd);
}
/** 单词听音选拼写：干扰项挑拼写/读音接近的别的词 */
export function wordTextChoices(term, others, rnd = Math.random) {
  const t = String(term).trim(); const lc = t.toLowerCase(); const seen = new Set([lc]); const cand = [];
  for (const o of others) { const v = String(o || '').trim(); if (!v || seen.has(v.toLowerCase())) continue; seen.add(v.toLowerCase()); cand.push(v); }
  // 最相近的一个一定出现（真正考辨认拼写），其余从前 6 个相近的里随机挑，题目有变化
  const near = cand.sort((a, b) => lev(lc, a.toLowerCase()) - lev(lc, b.toLowerCase())).slice(0, 6); const dis = near.length ? [near[0], ...shuffle(near.slice(1), rnd).slice(0, 2)] : [];
  if (dis.length < 2) return null;
  return shuffle([{ t, ok: true }, ...dis.map(x => ({ t: x, ok: false }))], rnd);
}
/** 模糊（翻译题）的提示：参考译文的开头 / 释义的词性和首字 */
export function zhHint(zh, word = false) {
  const z = String(zh || '').trim(); if (!z) return '';
  if (word) { const m = z.match(/^([a-z]+\.)?\s*([\u3400-\u9fff])/i); return m ? `${m[1] ? m[1] + ' ' : ''}${m[2]}…（${zhNorm(z.split(/[,，;；|]/)[0].replace(/^[a-z]+\.\s*/i, '')).length} 个字）` : ''; }
  const c = [...zhNorm(z)]; return c.slice(0, Math.max(2, Math.ceil(c.length / 3))).join('') + '……';
}

// ---------- v1.6 篇章阅读理解（读）----------
// 从用户自己的材料里取 2–4 句连续段落出理解选择题。没有 AI：用规则从各句的译文和生词卡关键词出题；有 AI：AI 出题（界面如实标注）。
const zhAllOk = w => w.every(s => s.zh && String(s.zh).trim());
/** 篇章条目：{kind:'passage', id, en, zh, sents, s:{id, materialId, t0, t1}}（原声：几句都有时间戳才从第一句起点放到最后一句终点） */
export function passageItem(w) {
  const a = w[0], z = w[w.length - 1]; const timed = w.every(s => s.t0 != null && s.t1 != null);
  return { kind: 'passage', id: 'p:' + a.id, en: w.map(s => String(s.en).trim()).join(' '), zh: zhAllOk(w) ? w.map(s => String(s.zh).trim()).join('') : '', sents: w,
    s: { id: a.id, materialId: a.materialId, en: w.map(s => s.en).join(' '), ...(timed ? { t0: a.t0, t1: z.t1 } : {}) } };
}
/**
 * 从句子列表（按材料内顺序，带 materialId）里挑连续 2–4 句的段落；同一材料里相邻的句子才算连续。
 * 段落总词数 minWords–maxWords；优先每句都有译文的；互不重叠，最多 want 段。
 */
export function passages(sents, { min = 2, max = 4, minWords = 10, maxWords = 90, want = 3, rnd = Math.random } = {}) {
  const runs = []; let cur = [];
  for (const s of sents) {
    const ok = s && s.en && String(s.en).trim();
    if (!ok || (cur.length && cur[cur.length - 1].materialId !== s.materialId)) { if (cur.length) runs.push(cur); cur = []; }
    if (ok) cur.push(s);
  }
  if (cur.length) runs.push(cur);
  const cands = [];
  for (const r of runs) for (let i = 0; i + min <= r.length; i++) {
    const Ls = shuffle(Array.from({ length: max - min + 1 }, (_, k) => min + k), rnd);
    for (const L of Ls) { if (i + L > r.length) continue; const w = r.slice(i, i + L); const nw = w.reduce((a, s) => a + tokenize(s.en).length, 0); if (nw >= minWords && nw <= maxWords) { cands.push(w); break; } }
  }
  const out = [], used = new Set();
  for (const w of shuffle(cands, rnd).sort((a, b) => zhAllOk(b) - zhAllOk(a))) {
    if (out.length >= want) break; if (w.some(s => used.has(s.id))) continue; w.forEach(s => used.add(s.id)); out.push(w);
  }
  return out.map(passageItem);
}
const NEG_PAIRS = [['不是', '是'], ['没有', '有'], ['不会', '会'], ['不能', '能'], ['不要', '要'], ['不想', '想'], ['不喜欢', '喜欢'], ['不可以', '可以'], ['不需要', '需要'], ['不用', '用']];
const NO_BEFORE = new Set('但于还可要总真倒只凡或若就像都'.split(''));
/** 把一句中文的意思反过来（规则：有否定词就去掉，没有就在常见动词前加“不/没”）；做不到返回 null */
export function negate(zh) {
  const z = String(zh || '');
  for (const [n, p] of NEG_PAIRS) { const k = z.indexOf(n); if (k >= 0) return z.slice(0, k) + p + z.slice(k + n.length); }
  for (const [n, p] of NEG_PAIRS) {
    for (let k = z.indexOf(p); k >= 0; k = z.indexOf(p, k + 1)) { if (k > 0 && (NO_BEFORE.has(z[k - 1]) || z[k - 1] === '不' || z[k - 1] === '没')) continue; return z.slice(0, k) + n + z.slice(k + p.length); }
  }
  return null;
}
const briefZh = z => String(z || '').replace(/^\s*[a-z]+\.\s*/i, '').split(/[;；,，|\n]/)[0].trim();
export const PQ_ASK = { fact: '根据这段话，下面哪一项是对的？', notin: '下面哪一项，这段话里没有提到？', word: '这段话里的「{w}」是什么意思？' };
/**
 * 篇章理解题（规则出题，不用 AI）。item：passageItem；others：这段以外的句子译文（干扰项）；cards：生词卡（找段里出现的生词）。
 * 题型：fact 哪项符合原文（正确项=段中某句译文；干扰项=把段中另一句意思反过来 + 段外句子的译文）；
 *       notin 哪项没提到（正确项=段外句子译文；干扰项=段中各句译文）；word 段中生词在这里的意思（干扰项=别的生词释义）。
 * 返回 {kind, q, options:[{t, ok}], why} 或 null（凑不出题）。
 */
export function passageQuestion(item, { others = [], cards = [], rnd = Math.random, prefer = null } = {}) {
  const zs = item.sents.map(s => String(s.zh || '').trim()).filter(Boolean);
  const outs = [...new Set(others.map(z => String(z || '').trim()).filter(z => z && !zs.includes(z) && !item.zh.includes(z)))];
  const near = (arr, L) => shuffle(arr.slice().sort((a, b) => Math.abs(a.length - L) - Math.abs(b.length - L)).slice(0, 6), rnd);
  const build = {
    fact() {
      if (!zs.length) return null; const k = Math.floor(rnd() * zs.length), right = zs[k]; const dis = [];
      const negs = shuffle(zs.map((z, j) => [negate(z), j]).filter(([x]) => x && !zs.includes(x)), rnd); const neg = negs.find(([, j]) => j !== k) || negs[0];
      if (neg) dis.push(neg[0]);
      for (const o of near(outs, right.length)) { if (dis.length >= 3) break; if (!dis.includes(o)) dis.push(o); }
      if (dis.length < 2) return null;
      return { kind: 'fact', q: PQ_ASK.fact, options: shuffle([{ t: right, ok: true }, ...dis.map(t => ({ t, ok: false }))], rnd),
        why: `原文：${item.sents[item.sents.findIndex(s => String(s.zh || '').trim() === right)]?.en || ''}${neg ? `；「${neg[0]}」和原文意思相反` : ''}` };
    },
    notin() {
      if (zs.length < 2 || !outs.length) return null; const right = near(outs, zs[0].length)[0];
      return { kind: 'notin', q: PQ_ASK.notin, options: shuffle([{ t: right, ok: true }, ...shuffle(zs, rnd).slice(0, 3).map(t => ({ t, ok: false }))], rnd), why: '其余几项都是这段里各句的意思。' };
    },
    word() {
      const lc = ' ' + tokenize(item.en).join(' ') + ' ';
      const hits = shuffle(cards.filter(c => c.type !== 'sentence' && c.zh && briefZh(c.zh) && lc.includes(' ' + tokenize(c.term).join(' ') + ' ')), rnd); const c = hits[0]; if (!c) return null;
      const right = briefZh(c.zh); const pool = [...new Set(cards.filter(x => x !== c && x.term.toLowerCase() !== c.term.toLowerCase()).map(x => briefZh(x.zh)).filter(z => z && z !== right))];
      const dis = shuffle(pool, rnd).slice(0, 3); if (dis.length < 2) return null;
      const sent = item.sents.find(s => (' ' + tokenize(s.en).join(' ') + ' ').includes(' ' + tokenize(c.term).join(' ') + ' '));
      return { kind: 'word', q: PQ_ASK.word.replace('{w}', c.term), term: c.term, options: shuffle([{ t: right, ok: true }, ...dis.map(t => ({ t, ok: false }))], rnd), why: `原句：${sent?.en || ''}${sent?.zh ? '（' + sent.zh + '）' : ''}` };
    },
  };
  const order = prefer ? [prefer, 'fact', 'notin', 'word'] : [...shuffle(['fact', 'notin', 'word'], rnd), 'fact'];
  for (const k of order) { const q = build[k](); if (q) return q; }
  return null;
}
/** AI 出的题做格式检查：3–4 个不同选项、答案下标有效 */
export function checkAiQuestion(r) {
  const opts = Array.isArray(r?.options) ? r.options.map(x => String(x || '').trim()) : [];
  const a = Number(r?.answer); const q = String(r?.q || '').trim();
  if (!q || opts.length < 3 || opts.length > 4 || opts.some(x => !x) || new Set(opts).size !== opts.length || !Number.isInteger(a) || a < 0 || a >= opts.length) return null;
  return { kind: 'ai', q, options: opts.map((t, k) => ({ t, ok: k === a })), why: String(r.why || '').trim() };
}
