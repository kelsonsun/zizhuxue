// 离线词典：ECDICT（MIT 许可）精简词表，约 4 万常用词 + 词形还原。首次查词时按需加载。
let map = null, loading = null;
async function load() {
  if (map) return map;
  if (loading) return loading;
  loading = (async () => {
    const r = await fetch('data/dict.tsv'); if (!r.ok) throw new Error('词典加载失败');
    const txt = await r.text(); const m = new Map();
    for (const line of txt.split('\n')) {
      if (!line) continue; const p = line.split('\t');
      if (p[1] === '->') m.set(p[0], { lemma: p[2] });
      else m.set(p[0], { rank: +p[1], phonetic: p[2], zh: p[3] });
    }
    map = m; return m;
  })();
  return loading;
}
const guess = w => {
  const c = [];
  if (w.endsWith('ies')) c.push(w.slice(0, -3) + 'y');
  if (w.endsWith('es')) c.push(w.slice(0, -2));
  if (w.endsWith('s')) c.push(w.slice(0, -1));
  if (w.endsWith('ed')) c.push(w.slice(0, -2), w.slice(0, -1));
  if (w.endsWith('ing')) c.push(w.slice(0, -3), w.slice(0, -3) + 'e');
  if (w.endsWith('ly')) c.push(w.slice(0, -2));
  return c;
};
/** 查词：返回 {word, lemma, phonetic, zh, rank} 或 null（词典里没有）。 */
export async function lookup(word) {
  const m = await load();
  const w = String(word).toLowerCase().replace(/^['’]+|['’]+$/g, '');
  let e = m.get(w), lemma = w;
  if (e?.lemma) { lemma = e.lemma; e = m.get(lemma); }
  if (!e) for (const g of guess(w)) { const x = m.get(g); if (x && !x.lemma) { e = x; lemma = g; break; } }
  if (!e || e.lemma) return null;
  return { word: w, lemma, phonetic: e.phonetic, zh: e.zh, rank: e.rank, senses: parseSenses(e.zh) };
}
/** 把 ECDICT 的释义行拆成义项：[{pos:'n.', zh:'银行, 堤, 岸'}]。词典本身不带例句。 */
export function parseSenses(zh) {
  return String(zh || '').split(' | ').map(x => x.trim()).filter(Boolean).map(line => {
    const m = line.match(/^((?:[a-z]+\.)|(?:\[[^\]]+\]))\s*(.*)$/);
    return m ? { pos: m[1], zh: m[2] } : { pos: '', zh: line };
  });
}
export async function wordRank(w) { const x = await lookup(w); return x ? x.rank : null; }
/** 离线“生词候选”：找出句子里不属于最常见 N 词的词，按罕见程度排序。 */
export async function candidates(sentences, { common = 1500, max = 30 } = {}) {
  const seen = new Map();
  for (let i = 0; i < sentences.length; i++) {
    const words = (sentences[i].en || '').match(/[A-Za-z][A-Za-z'’-]*/g) || [];
    for (const raw of words) {
      const w = raw.toLowerCase(); if (w.length < 3 || seen.has(w)) continue;
      const e = await lookup(w);
      if (e && e.rank > common) seen.set(w, { term: raw, si: i, e });
      else if (!e && /^[a-z]{4,}$/.test(w) && !/^[A-Z]/.test(raw)) seen.set(w, { term: raw, si: i, e: null });
    }
  }
  return [...seen.values()].sort((a, b) => (b.e?.rank ?? 99999) - (a.e?.rank ?? 99999)).slice(0, max);
}
/** 随机取一些常见词的释义，用作选择题干扰项。 */
export async function randomZh(n, exclude = []) {
  const m = await load(); const keys = [...m.keys()]; const out = [];
  const ex = new Set(exclude.map(x => x.slice(0, 12)));
  let guard = 0;
  while (out.length < n && guard++ < 4000) {
    const k = keys[Math.floor(Math.random() * keys.length)]; const e = m.get(k);
    if (!e || e.lemma || e.rank > 6000 || !e.zh || ex.has(e.zh.slice(0, 12))) continue;
    out.push(e.zh); ex.add(e.zh.slice(0, 12));
  }
  return out;
}
/** 随机取常见词里指定词性的义项（选择题干扰项用）：[{pos, zh}] */
export async function randomSenses(posKeyWanted, n = 20) {
  const m = await load(); const keys = [...m.keys()]; const out = []; const norm = p => { const s = String(p || '').toLowerCase(); return /^v(t|i)?\.$/.test(s) ? 'v' : /^(a|adj)\.$/.test(s) ? 'a' : /^(ad|adv)\.$/.test(s) ? 'adv' : s.replace(/\.$/, ''); };
  for (let g = 0; out.length < n && g < 6000; g++) {
    const e = m.get(keys[Math.floor(Math.random() * keys.length)]);
    if (!e || e.lemma || e.rank > 8000 || !e.zh) continue;
    const s = parseSenses(e.zh).find(x => !posKeyWanted || norm(x.pos) === posKeyWanted); if (s) out.push(s);
  }
  return out;
}
