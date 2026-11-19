// v1.7 学过的生词再出现时高亮 + 词汇量统计（纯函数，可单测；查词形还原由调用方传 lemmaOf）。
const lc = s => String(s || '').toLowerCase().replace(/[’]/g, "'").trim();
/** 生词卡 → 索引：Map(词或短语（小写，及其词形还原）→ 卡)。句子卡不算生词。 */
export function knownIndex(cards, lemmaOf = w => w) {
  const m = new Map();
  for (const c of cards) {
    if (!c || c.type === 'sentence' || !c.term) continue; const t = lc(c.term).replace(/\s+/g, ' ');
    if (!m.has(t)) m.set(t, c);
    if (!/\s/.test(t)) { const l = lemmaOf(t); if (l && !m.has(l)) m.set(l, c); }
  }
  return m;
}
/**
 * 在一句的词序列里标出学过的词：短语（最长 5 个词）优先，其次单词本身，再次词形还原。
 * 返回 [{k: 起始词序号, len: 词数, card}]
 */
export function markKnown(tokens, index, lemmaOf = w => w) {
  const out = []; const T = tokens.map(lc);
  for (let k = 0; k < T.length;) {
    let hit = null;
    for (let L = Math.min(5, T.length - k); L >= 2 && !hit; L--) { const c = index.get(T.slice(k, k + L).join(' ')); if (c) hit = { k, len: L, card: c }; }
    if (!hit) { const c = index.get(T[k]) || index.get(lemmaOf(T[k])); if (c && T[k].length >= 2) hit = { k, len: 1, card: c }; }
    if (hit) { out.push(hit); k += hit.len; } else k++;
  }
  return out;
}
/** 卡片状态：熟练（标为熟练，或复习间隔 ≥21 天）/ 学习中（复习过）/ 新卡 */
export function cardStatus(c) {
  const s = c?.sch || {}; if (s.mastered || (s.interval || 0) >= 21) return 'known';
  return (s.seen || s.reps) ? 'learning' : 'new';
}
export const BANDS = [[1000, '最常用 1000'], [3000, '1001–3000'], [5000, '3001–5000'], [10000, '5001–10000'], [Infinity, '10000 以后']];
/**
 * 词汇量统计。mats：材料（取 sentences[].en）；rankOf(lemma) → 词频序号或 null（词典外）；lemmaOf(词) → 原形。
 * 返回 {cards:{total, byType, known, learning, new}, mats:{words, tokens, bands:[{label, n, mine}], outside, coverage3000},
 *       again:{total, top:[{term, n}]}, days:[{day, n, ok}]（最近 14 天）, acc30}
 */
export function vocabStats({ cards = [], mats = [], reviews = [], today, lemmaOf = w => w, rankOf = () => null }) {
  const vc = cards.filter(c => c.type !== 'sentence');
  const st = { known: 0, learning: 0, new: 0 }; for (const c of vc) st[cardStatus(c)]++;
  const byType = {}; for (const c of cards) byType[c.type] = (byType[c.type] || 0) + 1;
  // 材料里的不同词（按原形）
  const seen = new Map(); let tokens = 0;
  for (const m of mats) for (const s of m.sentences || []) for (const w of (String(s.en || '').match(/[A-Za-z][A-Za-z'’-]*/g) || [])) {
    tokens++; const l = lemmaOf(lc(w)); if (l.length < 2) continue; if (!seen.has(l)) seen.set(l, { n: 0, rank: rankOf(l) }); seen.get(l).n++;
  }
  const idx = knownIndex(cards, lemmaOf);
  const bands = BANDS.map(([max, label], i) => ({ label, max, n: 0, mine: 0 })); let outside = 0, in3000 = 0, tok3000 = 0;
  for (const [l, x] of seen) {
    if (x.rank == null) { outside++; continue; }
    const b = bands.find(b => x.rank <= b.max); b.n++; if (idx.has(l)) b.mine++;
    if (x.rank <= 3000) { in3000++; tok3000 += x.n; }
  }
  // 学过的词“再次遇到”：在收藏它的那句以外出现的次数
  const again = new Map();
  for (const m of mats) for (const s of m.sentences || []) {
    const toks = String(s.en || '').match(/[A-Za-z][A-Za-z'’-]*/g) || [];
    for (const h of markKnown(toks, idx, lemmaOf)) if (h.card.sentenceId !== s.id) again.set(h.card.id, (again.get(h.card.id) || 0) + 1);
  }
  const top = [...again].map(([id, n]) => ({ term: cards.find(c => c.id === id)?.term || '', n })).sort((a, b) => b.n - a.n || a.term.localeCompare(b.term)).slice(0, 10);
  // 最近 14 天作答、30 天正确率
  const days = Array.from({ length: 14 }, (_, i) => ({ day: today - 13 + i, n: 0, ok: 0 })); let a30 = 0, ok30 = 0;
  for (const r of reviews) {
    if (r.mode === 'undo' || r.choice === 'restore' || r.day == null) continue; const d = days.find(x => x.day === r.day); if (d) { d.n++; if (r.correct) d.ok++; }
    if (r.day > today - 30 && r.correct != null && r.choice !== 'master') { a30++; if (r.correct) ok30++; }
  }
  return { cards: { total: vc.length, byType, ...st }, mats: { words: seen.size, tokens, bands, outside, coverage3000: tokens ? Math.round(100 * tok3000 / tokens) : 0, in3000 },
    again: { total: [...again.values()].reduce((a, b) => a + b, 0), top }, days, acc30: a30 ? Math.round(100 * ok30 / a30) : null, n30: a30 };
}
