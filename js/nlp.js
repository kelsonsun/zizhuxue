// 本地基础词性标注（compromise.js，规则式，离线）。只给“基础词性/动词形态”，不是语法分析，结果仅供参考。
let nlp = null, loading = null;
export async function load() {
  if (nlp) return nlp;
  if (!loading) loading = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = new URL('vendor/compromise/compromise.min.js', document.baseURI).href;
    s.onload = () => { nlp = globalThis.nlp; res(nlp); }; s.onerror = () => { loading = null; s.remove(); rej(new Error('词性标注组件加载失败，请稍后重试')); }; document.head.appendChild(s);
  });
  return loading;
}
const POS = [
  ['Modal', '情态动词', 'v.'], ['Copula', '系动词', 'v.'], ['Auxiliary', '助动词', 'v.'], ['Verb', '动词', 'v.'], ['Noun', '名词', 'n.'], ['Pronoun', '代词', 'pron.'],
  ['Adjective', '形容词', 'a.'], ['Adverb', '副词', 'adv.'], ['Preposition', '介词', 'prep.'], ['Conjunction', '连词', 'conj.'], ['Determiner', '限定词', 'art.'],
  ['Value', '数词', 'num.'], ['Interjection', '感叹词', 'int.'], ['Possessive', '所有格', ''], ['Negative', '否定词', 'adv.'],
];
const FORM = [['PastTense', '过去式'], ['PresentTense', '一般现在'], ['Infinitive', '原形'], ['Gerund', '-ing形式'], ['FutureTense', '将来'], ['Participle', '分词'], ['PerfectTense', '完成'], ['Passive', '被动']];
/** 返回 [{w, pos, posZh, dictPos, forms:[]}]，只含词（不含标点）。 */
export async function tag(sentence) {
  const n = await load();
  const doc = n(sentence); const out = [];
  for (const sent of doc.json()) for (const t of sent.terms) {
    const tags = t.tags || []; const w = t.text.replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, '');
    if (!w) continue;
    const p = POS.find(([k]) => tags.includes(k));
    out.push({ w, pos: p?.[0] || '', posZh: p?.[1] || '其他', dictPos: p?.[2] || '', forms: FORM.filter(([k]) => tags.includes(k)).map(x => x[1]) });
  }
  return out;
}
/** 词在句中的词性（按第 k 个词）。 */
export async function posOfToken(sentence, word, k) {
  const t = await tag(sentence);
  const w = String(word || '').toLowerCase();
  let hit = t.filter(x => x.w.toLowerCase() === w);
  // 卡片词条常是原形（start），原句里可能是变形（started/starting/starts）
  if (!hit.length && w.length >= 3) { const stem = w.replace(/e$/, ''); hit = t.filter(x => { const v = x.w.toLowerCase(); return v.startsWith(stem) && v.length - stem.length <= 4; }); }
  if (!hit.length) return null;
  return hit[Math.min(hit.length - 1, Math.max(0, k | 0))];
}
