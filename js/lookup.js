// v1.7 首页快速查词 / 翻译（纯函数 + 历史记录）。查词走离线词典（ECDICT）；句子翻译走用户选的通道（AI / 浏览器端侧 / MyMemory），如实标注。
const CJK = /[\u3400-\u9fff]/;
/** 输入分类：zhword 短中文词（≤6 字、无标点）/ zh 中文句子 / word 英文单词 / phrase 2–4 个英文词 / en 英文句子 / empty */
export function classify(q) {
  const s = String(q || '').trim(); if (!s) return 'empty';
  if (CJK.test(s)) return s.replace(/\s/g, '').length <= 6 && !/[，。！？,.!?；;：:、]/.test(s) ? 'zhword' : 'zh';
  const ws = s.match(/[A-Za-z][A-Za-z'’-]*/g) || []; if (!ws.length) return 'empty';
  if (/^[A-Za-z][A-Za-z'’-]*$/.test(s)) return 'word';
  if (ws.length <= 4 && /^[A-Za-z'’\-\s]+$/.test(s)) return 'phrase';
  return 'en';
}
/** 中文 → 英文词（离线反查）：在词典释义里找完整义项等于这个中文的词，常用的排前面 */
export function reverseLookup(entries, zh, max = 8) {
  const z = String(zh || '').trim(); if (!z) return [];
  const out = [];
  for (const [w, e] of entries) {
    if (!e || e.lemma || !e.zh || !/^[a-z]+$/.test(w)) continue;
    const items = e.zh.split(/\s*[|,，;；]\s*|\s+/).map(x => x.replace(/^[a-z]+\.\s*/i, '').replace(/[（(].*?[)）]/g, '').trim()).filter(Boolean);
    const exact = items.includes(z); const part = !exact && items.some(x => x.length <= z.length + 2 && x.startsWith(z));
    if (exact || part) out.push({ w, zh: e.zh, rank: e.rank, exact });
  }
  return out.sort((a, b) => (b.exact - a.exact) || (a.rank - b.rank)).slice(0, max);
}
/** 在用户材料里找含这个词/短语的句子（做卡时当语境）。返回 [{en, zh, mid, sid, title}] */
export function findInMats(mats, term, max = 3) {
  const t = String(term || '').trim(); if (!t) return [];
  const re = new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+') + '(s|es|ed|d|ing)?\\b', 'i'); const out = [];
  for (const m of mats) { if (m.kind === 'book') continue; for (const s of m.sentences || []) { if (s.en && re.test(s.en)) { out.push({ en: s.en, zh: s.zh || '', mid: m.id, sid: s.id, title: m.title }); if (out.length >= max) return out; } } }
  return out;
}
export const HIST_MAX = 200;
/** 历史：同一查询只留最新一条，最多 200 条 */
export function addHist(list, rec, max = HIST_MAX) {
  const k = String(rec.q).trim().toLowerCase(); return [rec, ...list.filter(x => String(x.q).trim().toLowerCase() !== k)].slice(0, max);
}
