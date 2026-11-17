// 练习式复习的核心算法（纯函数，可单测）：
// 1) 按遗忘曲线选内容：SM-2 到期 + 新卡；同时计算“此刻的遗忘概率”。
// 2) 每项算难度分（词频/句长、历史错误率、SM-2 的 EF、遗忘概率）。
// 3) 排序：易 → 难，中间易难交叉，最难的一组固定放在最后。
// 4) 题型混合，全部可用语音或文字作答；作答得分 → SM-2 的 q（0-5）。
import { dayNumber, isNew, isDue, sm2, newSchedule } from './sm2.js';
import { compareWords, tokenize } from './textproc.js';

/** 记忆保持率 R：按“到期日时 R≈0.9”的指数遗忘曲线（SM-2 的间隔本身就是按此设计）。 */
export function retention(card, today = dayNumber()) {
  const s = card.sch; if (!s || !s.seen || s.last == null) return null; // 新卡：没有记忆可言
  const t = Math.max(0, today - s.last), S = Math.max(1, s.interval || 1);
  return Math.exp(Math.log(0.9) * t / S);
}
export const forgetProb = (card, today) => { const r = retention(card, today); return r == null ? 1 : 1 - r; };

const LOGMAX = Math.log10(40000);
/** 单词的“生僻度” 0..1：按 ECDICT 词频序号（越靠后越生僻），词典里没有算最生僻。 */
export const rarity = rank => (rank == null || !(rank > 0)) ? 1 : Math.min(1, Math.log10(Math.max(1, rank)) / LOGMAX);

/** 历史错误率（带平滑）：fails/attempts，来自复习记录。 */
export function errorRate(hist = []) { const n = hist.length, f = hist.filter(q => q < 3).length; return (f + 0.3) / (n + 1); }

/**
 * 难度分 0-100 及其组成。rankOf(word) → 词频序号|null（同步，调用方预先查好）。hist: 这张卡历次 q。
 * 权重：词汇 40%、历史错误率 25%、EF 15%、遗忘概率 20%。
 */
export function difficulty(card, { rankOf = () => null, hist = [], today = dayNumber() } = {}) {
  const words = tokenize(card.term || ''); const n = words.length || 1;
  const rar = words.map(w => rarity(rankOf(w))).sort((a, b) => b - a);
  let lex;
  if (card.type === 'sentence' || n > 4) {
    const top = rar.slice(0, 3); const avgTop = top.reduce((a, b) => a + b, 0) / (top.length || 1);
    lex = 0.55 * avgTop + 0.45 * Math.min(1, n / 25);           // 句子：最难 3 个词 + 句长
  } else lex = Math.min(1, (rar[0] ?? 1) * 0.85 + 0.08 * (n - 1) + (card.type === 'expr' ? 0.1 : 0)); // 词/短语：最生僻的词 + 词数
  const err = errorRate(hist);
  const ef = card.sch?.ef ?? 2.5; const ease = Math.max(0, Math.min(1, (2.5 - ef) / 1.2));
  const fp = isNew(card) ? 0.5 : forgetProb(card, today);
  const score = Math.round(100 * (0.4 * lex + 0.25 * err + 0.15 * ease + 0.2 * fp));
  return { score, parts: { lex: +lex.toFixed(2), err: +err.toFixed(2), ease: +ease.toFixed(2), forget: +fp.toFixed(2) } };
}
export const level = s => s < 34 ? '易' : s < 58 ? '中' : '难';

/**
 * 选内容：到期卡（SM-2）+ 新卡（每日上限）；超过上限 max 时，优先遗忘概率高的。
 * extra=true 时（今天没有到期的，用户想加练），挑未到期但遗忘概率最高的若干张。
 */
export function selectCards(cards, { newLimit = 10, max = 40, today = dayNumber(), extra = 0 } = {}) {
  const ts = Date.now();
  cards = cards.filter(c => !isMastered(c)); // 「熟练」的卡不再出现（可在生词本恢复）
  let due = cards.filter(c => !isNew(c) && isDue(c, ts));
  due.sort((a, b) => priority(b, today) - priority(a, today));
  const fresh = cards.filter(c => isNew(c)).sort((a, b) => (a.created || 0) - (b.created || 0)).slice(0, newLimit);
  let picked = [...due.slice(0, Math.max(0, max - Math.min(fresh.length, newLimit))), ...fresh].slice(0, max);
  if (extra) { const ids = new Set(picked.map(c => c.id)); picked.push(...cards.filter(c => !ids.has(c.id) && !isNew(c)).sort((a, b) => priority(b, today) - priority(a, today)).slice(0, extra)); }
  return { picked, dueCount: due.length, newCount: fresh.length };
}

/**
 * 排序：按难度升序；最难的 ~15%（至少 1 个）固定在最后；其余分成“较易半”和“较难半”，
 * 先给 2 个最易的热身，然后易、难交替出现（两半各自由易到难，整体逐渐变难）。
 */
export function orderEasyToHard(items, key = x => x.diff) {
  const s = [...items].sort((a, b) => key(a) - key(b)); const n = s.length;
  if (n <= 3) return { order: s, tailFrom: n - 1 };
  const tailN = Math.max(1, Math.round(n * 0.15)); const tail = s.slice(n - tailN), body = s.slice(0, n - tailN);
  const half = Math.ceil(body.length / 2); const E = body.slice(0, half), H = body.slice(half);
  const out = E.splice(0, Math.min(2, E.length));
  while (E.length || H.length) { if (H.length) out.push(H.shift()); if (E.length) out.push(E.shift()); }
  return { order: [...out, ...tail], tailFrom: n - tailN };
}

/** 题型：listen 听写/听说（最易）< cloze 原句填空 < zh2en 看中文说英文（最难）。都要求说出或写出英文。 */
export const QTYPES = { listen: '听音说/写', cloze: '原句填空', zh2en: '看中文说英文' };
export function availableTypes(card) {
  const t = ['listen'];
  if ((card.type !== 'sentence') && card.sentence?.en && card.sentence.en.toLowerCase().includes(String(card.term).toLowerCase()) && card.sentence.en.trim().toLowerCase() !== String(card.term).trim().toLowerCase()) t.push('cloze');
  if (card.zh && card.zh.trim()) t.push('zh2en');
  return t;
}
/** 按熟练度选题型（新卡用易的，熟卡用难的），并避免与上一题同型，形成混合。 */
export function chooseType(card, prev = null) {
  const av = availableTypes(card); const reps = card.sch?.reps || 0;
  let idx = reps === 0 ? 0 : reps <= 2 ? Math.min(1, av.length - 1) : av.length - 1;
  if (av[idx] === prev && av.length > 1) idx = idx === av.length - 1 ? idx - 1 : idx + 1;
  return av[idx];
}

const lev = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
/** 判分：逐词比对；单个词允许一个字母的拼写/识别误差（记 70 分）。 */
export function gradeAnswer(ref, ans) {
  const r = compareWords(ref, ans);
  const a = tokenize(ref), b = tokenize(ans);
  if (a.length === 1 && b.length >= 1 && r.score < 100) {
    const best = Math.min(...b.map(w => lev(a[0], w)));
    if (best === 0) return { ...r, score: 100 }; // 说多了几个词但包含目标词（语音常见）
    if (best === 1 && a[0].length >= 4) return { ...r, score: 70, near: true };
  }
  return r;
}
/** 得分 → SM-2 q。看了提示最多 3；放弃=0。 */
export function scoreToQ(score, { hinted = false, gaveUp = false } = {}) {
  if (gaveUp) return 0;
  let q = score >= 95 ? 5 : score >= 80 ? 4 : score >= 60 ? 3 : score >= 30 ? 2 : 1;
  if (hinted) q = Math.min(q, 3);
  return q;
}
/** 失败的卡在本轮重来：插回 3 题之后，但不挤进最后“最难的一组”之后的位置。 */
export function requeuePos(queueLen, tailLeft) { return Math.max(0, Math.min(3, queueLen - tailLeft)); }

// —— 作答前先选：不会 / 模糊 / 会 / 熟练（v1.3.1，kelson 定的固定间隔，覆盖 SM-2 算出的间隔）——
// 不会：马上看答案，1 天后再出（本轮不再出）。模糊：先给提示再作答，对 → 9 天，错 → 3 天。会：直接作答，对 → 12 天，错 → 1 天。
// 熟练：跳过，以后不再出现（mastered），可在生词本里恢复。SM-2 的其余字段（EF、reps、lapses、seen、last）照常按对应 q 更新，保持一致。
export const CHOICES = [['dunno', '不会'], ['fuzzy', '模糊'], ['know', '会'], ['master', '熟练']];
export const CHOICE_ZH = Object.fromEntries(CHOICES);
export const CORRECT_MIN = 80;
export const isCorrect = score => score >= CORRECT_MIN;
export const GAVE_UP_Q = 0;
/** 选择+对错 → [SM-2 的 q, 固定间隔天数]。 */
export function choiceRule(choice, correct) {
  if (choice === 'dunno') return [0, 1];
  if (choice === 'fuzzy') return correct ? [3, 9] : [2, 3];
  if (choice === 'know') return correct ? [4, 12] : [1, 1];
  throw new RangeError('unknown choice ' + choice);
}
/** 返回 { sch, q, days }。熟练：不改间隔，只标记 mastered。 */
export function scheduleChoice(sch, choice, correct = false, ts = Date.now()) {
  const base = { ...newSchedule(ts), ...(sch || {}) };
  if (choice === 'master') return { sch: { ...base, mastered: true, masteredAt: ts, lastChoice: 'master' }, q: null, days: null };
  const [q, days] = choiceRule(choice, correct); const s = sm2(base, q, ts);
  return { sch: { ...s, interval: days, due: dayNumber(ts) + days, lastQ: q, lastChoice: choice, lastCorrect: choice === 'dunno' ? false : !!correct, mastered: false, masteredAt: null }, q, days };
}
export const isMastered = c => !!c?.sch?.mastered;
/** 误点「熟练」后恢复练习：今天就重新出现。 */
export function restorePractice(sch, ts = Date.now()) { return { ...newSchedule(ts), ...(sch || {}), mastered: false, masteredAt: null, due: dayNumber(ts) }; }
/** 作答写回 SM-2，并记住最近一次的 q（lastQ）。 */
export function applyAnswer(sch, q, ts = Date.now()) { return { ...sm2(sch, q, ts), lastQ: q }; }
/** 选卡优先级：遗忘概率；上次点了「不会」的卡再加 1（到期后优先选上）。 */
export function priority(card, today = dayNumber()) { return forgetProb(card, today) + (card.sch?.lastQ === GAVE_UP_Q ? 1 : 0); }
/** 模糊的提示：每个词给首字母（长句只给前 8 个词），词卡再给词性/中文。 */
export function hintText(term, { zh = '', words = 8 } = {}) {
  const ws = String(term).trim().split(/\s+/); const shown = ws.slice(0, words).map(w => w.replace(/^([^A-Za-z]*[A-Za-z])([A-Za-z'’-]*)/, (_, a, b) => a + b.replace(/[A-Za-z]/g, '_'))).join(' ');
  return { letters: shown + (ws.length > words ? ' …' : ''), count: ws.length, zh };
}
/** 词义选择题「模糊」：去掉一半干扰项（至少留 1 个干扰项），返回要保留的选项下标。 */
export function eliminate(opts, rnd = Math.random) {
  const wrong = opts.map((o, i) => o.ok ? -1 : i).filter(i => i >= 0); const keepN = Math.max(1, Math.floor(wrong.length / 2));
  const keep = new Set([opts.findIndex(o => o.ok)]); const pool = [...wrong]; while (keep.size < keepN + 1 && pool.length) keep.add(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return opts.map((_, i) => i).filter(i => keep.has(i));
}
