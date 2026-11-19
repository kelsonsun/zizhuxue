// v1.5 单词关联：拆解（前缀/词根/后缀）、同根/同缀家族、推测拆解。纯本地、同步计算。
import { ROOTS, PREFIXES, SUFFIXES, COMBINING } from './rootdata.js';

const PRE = new Map(PREFIXES.map(x => [x.k, x])), SUF = new Map(SUFFIXES.map(x => [x.k, x])), COMB = new Map(COMBINING.map(x => [x.k, x]));
const ROOT = new Map(ROOTS.map(r => [r.id, r]));
const formRoot = new Map(); for (const r of ROOTS) for (const f of r.forms) if (!formRoot.has(f)) formRoot.set(f, r);
const affOf = (map, t) => map.get(t) || [...map.values()].find(x => x.forms.includes(t));

/** 拼写像词根、其实词源不同的词（推测时不能拆）。值是给用户看的说明。 */
export const FALSE_FRIENDS = {
  port: ['port', '这里的 port（港口）来自拉丁语 portus（港口），和 port（携带）不是一个来源。'],
  airport: ['port', 'airport 的 port 是“港口”（拉丁语 portus），不是 port（携带）。'],
  passport: ['port', 'passport 的 port 是“港口”（拉丁语 portus），不是 port（携带）。'],
  opportunity: ['port', 'opportunity 来自拉丁语 ob portum（朝着港口），port 是“港口”，不是“携带”。'],
  opportune: ['port', 'opportune 来自拉丁语 ob portum（朝着港口），不是 port（携带）。'],
  importune: ['port', 'importune 来自拉丁语 importunus（无港可靠 → 不合时宜），不是 port（携带）。'],
  portion: ['port', 'portion 来自拉丁语 portio（份），和 port（携带）无关。'],
  proportion: ['port', 'proportion 来自 pro portione（按份），和 port（携带）无关。'],
  portrait: ['port', 'portrait 来自古法语 portraire（描绘），和 port（携带）无关。'],
  portray: ['port', 'portray 来自古法语 portraire（描绘），和 port（携带）无关。'],
  portal: ['port', 'portal 来自拉丁语 porta（门），和 port（携带）无关。'],
  porch: ['port', 'porch 来自拉丁语 porticus（门廊），和 port（携带）无关。'],
  perform: ['form', 'perform 来自古法语 parfournir（完成），和 form（形状）无关。'],
  performance: ['form', 'performance 来自 perform（古法语 parfournir，完成），和 form（形状）无关。'],
  performer: ['form', 'performer 来自 perform（古法语 parfournir，完成），和 form（形状）无关。'],
  tense: ['tend', '作“时态”讲的 tense 来自拉丁语 tempus（时间）；作“紧张的”讲才和 tendere（伸展）同源。'],
  content: ['tend', 'content 来自拉丁语 continere（包含，tenere 握住），不是 tend（伸展）家族。'],
  vent: ['ven', 'vent（通风口）和 venire（来）无关。'],
  even: ['ven', 'even 是古英语词，和 ven（来）无关。'],
  divide: ['vid', 'divide 来自拉丁语 dividere（分开），和 vid（看）无关。'],
  division: ['vid', 'division 来自拉丁语 dividere（分开），和 vis（看）无关。'],
  devise: ['vid', 'devise 来自拉丁语 dividere（分开），和 vise（看）无关。'],
  individual: ['vid', 'individual 来自 in + dividuus（不可分的），和 vid（看）无关。'],
  avid: ['vid', 'avid 来自拉丁语 avidus（渴望的），和 vid（看）无关。'],
  empire: ['spir', 'empire 来自拉丁语 imperium（统治），和 spire（呼吸）无关。'],
  spiral: ['spir', 'spiral 来自拉丁语 spira（螺旋），和 spir（呼吸）无关。'],
  captain: ['cap', 'captain 来自拉丁语 caput（头），和 cap（拿）无关。'],
  capital: ['cap', 'capital 来自拉丁语 caput（头），和 cap（拿）无关。'],
  audacity: ['aud', 'audacity 来自拉丁语 audax（大胆的），和 aud（听）无关。'],
  audacious: ['aud', 'audacious 来自拉丁语 audax（大胆的），和 aud（听）无关。'],
  logo: ['log', 'logo 是 logotype 的缩写，不是“学科”的 -logy。'],
  blog: ['log', 'blog 是 web + log（日志）的缩写，不是希腊语 logos。'],
  login: ['log', 'login 的 log 是“记录、日志”，不是希腊语 logos（话语）。'],
};
const FF_PREFIX = ['divi', 'devis', 'indivi', 'avid', 'portion', 'portra', 'spiral', 'captain', 'capital', 'perform', 'audaci'];
const NOGUESS = new Set(['pire', 'creed', 'mob', 'fac', 'cap', 'dic', 'ced', 'mot']);

const part = (kind, t, it, extra = {}) => ({ kind, t, k: it?.k || it?.id || t, m: it?.m || extra.m || '', ...extra });
function parseParts(str, r) {
  return str.split('+').map(t => {
    let m;
    if ((m = t.match(/^([a-z]+)(!?)-(?::([a-z!]+))?$/))) { const it = m[2] ? PRE.get(m[1] + '!') : (m[3] ? PRE.get(m[3]) : (affOf(PRE, m[1]) || affOf(COMB, m[1]))); return part(COMB.has(it?.k) ? 'comb' : 'pre', m[1], it); }
    if ((m = t.match(/^-([a-z]+)$/))) return part('suf', m[1], affOf(SUF, m[1]));
    if ((m = t.match(/^@([a-z]+)$/))) { const o = formRoot.get(m[1]); return part('root', m[1], o, { src: o?.src }); }
    if ((m = t.match(/^([a-z]+)=(.+)$/))) return part('el', m[1], null, { m: m[2] });
    return part('root', t, r, { src: r.src, main: true });
  });
}
const ENTRY = new Map(); const FAM = new Map(); const BY_PRE = new Map(), BY_SUF = new Map();
for (const r of ROOTS) {
  const list = [];
  for (const s of r.words) {
    const [w, ps, zh, logic] = s.split('|'); const e = { w, zh, logic, root: r.id, parts: parseParts(ps, r) };
    ENTRY.set(w, e); list.push(e);
    const p0 = e.parts[0]; if (p0.kind === 'pre') (BY_PRE.get(p0.k) || BY_PRE.set(p0.k, []).get(p0.k)).push(e);
    const pz = e.parts[e.parts.length - 1]; if (pz.kind === 'suf') (BY_SUF.get(pz.k) || BY_SUF.set(pz.k, []).get(pz.k)).push(e);
  }
  FAM.set(r.id, list);
}
export const stats = () => ({ roots: ROOTS.length, words: ENTRY.size, prefixes: PREFIXES.length, suffixes: SUFFIXES.length, combining: COMBINING.length });
export const rootById = id => ROOT.get(id);
export const prefixByKey = k => PRE.get(k);
export const allRoots = () => ROOTS;
export const allPrefixes = () => PREFIXES;
export const allSuffixes = () => SUFFIXES;
export const family = id => FAM.get(id) || [];
export const prefixFamily = k => BY_PRE.get(k) || [];
export const suffixFamily = k => BY_SUF.get(k) || [];
export const entry = w => ENTRY.get(String(w || '').toLowerCase()) || null;

// 屈折变化 → 原形候选（与 dict.js 的 guess 同思路）
function bases(w) {
  const c = [w];
  if (w.endsWith('ies')) c.push(w.slice(0, -3) + 'y');
  if (w.endsWith('es')) c.push(w.slice(0, -2));
  if (w.endsWith('s') && !w.endsWith('ss')) c.push(w.slice(0, -1));
  if (w.endsWith('ed')) c.push(w.slice(0, -2), w.slice(0, -1));
  if (w.endsWith('ing')) c.push(w.slice(0, -3), w.slice(0, -3) + 'e');
  return c;
}
/** 已知词，或由已知词 + 常见前后缀派生（如 unimportant、respectful、visibly）。 */
const PRE_FORMS = PREFIXES.flatMap(p => p.forms.map(f => [f, p])).sort((a, b) => b[0].length - a[0].length);
const SUF_FORMS = SUFFIXES.flatMap(s => s.forms.map(f => [f, s])).sort((a, b) => b[0].length - a[0].length);
function derived(w) {
  for (const [f, p] of PRE_FORMS) if (f.length >= 2 && w.startsWith(f)) { const e = ENTRY.get(w.slice(f.length)); if (e) return { base: e, add: part('pre', f, p), at: 'pre' }; }
  for (const [f, s] of SUF_FORMS) if (w.endsWith(f) && w.length - f.length >= 4) {
    const stem = w.slice(0, -f.length);
    for (const b of [stem, stem + 'e', stem.replace(/i$/, 'y'), stem.replace(/l$/, 'le'), stem + 'le', stem.replace(/bil$/, 'ble'), stem.replace(/ibil$/, 'ible')]) { const e = ENTRY.get(b); if (e && b !== w) return { base: e, add: part('suf', f, s), at: 'suf' }; }
  }
  return null;
}
const isFF = w => FALSE_FRIENDS[w] || (FF_PREFIX.some(p => w.startsWith(p)) ? [null, ''] : null);
/** 纯推测：前缀(0-2) + 词根写法 + 后缀(0-2)，必须正好拼成整个词。 */
function guessParts(w) {
  const preForms = []; for (const p of PREFIXES) for (const f of p.forms) preForms.push([f, p]);
  for (const c of COMBINING) for (const f of c.forms) preForms.push([f, c, 'comb']);
  const sufForms = []; for (const s of SUFFIXES) for (const f of s.forms) sufForms.push([f, s]);
  let best = null;
  const tryRoot = (rest, pres) => {
    for (const [f, r] of formRoot) {
      if (NOGUESS.has(f) || !rest.startsWith(f)) continue;
      const tail = rest.slice(f.length); const sufs = matchSufs(tail, 2); if (!sufs) continue;
      const preLen = pres.reduce((a, x) => a + x.t.length, 0);
      if (f.length <= 3 && !(preLen >= 2 || (pres.length && sufs.length))) continue; // 3 个字母的词根要有足够上下文
      if (!pres.length && !sufs.length) continue;
      const parts = [...pres, part('root', f, r, { src: r.src, main: true }), ...sufs];
      const score = f.length * 3 - parts.length;
      if (!best || score > best.score) best = { parts, root: r.id, score };
    }
  };
  const matchSufs = (tail, n) => { if (!tail) return []; if (!n) return null; for (const [f, s] of sufForms) if (tail.startsWith(f)) { const more = matchSufs(tail.slice(f.length), n - 1); if (more) return [part('suf', f, s), ...more]; } return null; };
  const walk = (rest, pres) => { tryRoot(rest, pres); if (pres.length >= 2) return; for (const [f, p, kind] of preForms) if (rest.startsWith(f) && rest.length > f.length + 2) walk(rest.slice(f.length), [...pres, part(kind || 'pre', f, p)]); };
  walk(w, []);
  return best;
}
/**
 * 拆解一个词。lemma：词典给的原形（可选）。返回
 *  {type:'known', w, e}           内置数据里的词（e = 条目）
 *  {type:'derived', w, e, add, at}  已知词加常见前/后缀
 *  {type:'guess', w, parts, root}   按词根词缀推测（仅供参考）
 *  {type:'false', w, root, note}    拼写像，但词源不同
 *  {type:'none', w}
 */
export function decompose(word, lemma, has = null) {
  const w = String(word || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return { type: 'none', w };
  const cands = [...new Set([lemma && String(lemma).toLowerCase(), ...bases(w)].filter(Boolean))];
  for (const c of cands) if (ENTRY.has(c)) return { type: 'known', w: c, e: ENTRY.get(c) };
  for (const c of cands) { const ff = isFF(c); if (ff) return { type: 'false', w: c, root: ff[0], note: ff[1] || `${c} 的拼写像某个词根，但词源不同，不按词根拆。` }; }
  for (const c of cands) { if (c.length < 5) continue; const d = derived(c); if (d) return { type: 'derived', w: c, e: d.base, add: d.add, at: d.at }; }
  for (const c of cands) { if (c.length < 5) continue; const g = guessParts(c); if (g) return { type: 'guess', w: c, parts: g.parts, root: g.root }; }
  for (const c of cands) { const p = partial(c, has); if (p) return { type: 'partial', w: c, parts: p }; }
  return { type: 'none', w: cands[0] || w };
}
const STRONG_SUF = new Set(['able', 'ible', 'ment', 'ness', 'ful', 'less', 'ly', 'er', 'or', 'ion', 'ation', 'ity', 'ive', 'ous', 'ious', 'ance', 'ence', 'ant', 'ent', 'ize', 'ise', 'ist', 'ure', 'ary', 'ory']);
const SOFT_PRE = new Set(['un', 're', 'dis', 'mis', 'pre', 'over', 'under', 'inter', 'multi', 'micro', 'anti', 'super', 'tele', 'auto', 'mono', 'uni']);
const SOFT_SUF = new Set(['ful', 'less', 'ness', 'ly', 'ment', 'able']);
/** 只认出前缀和/或后缀，中间部分不在内置词根里（has：同步查词典是否有这个词）。 */
function partial(w, has) {
  if (w.length < 6) return null;
  const inDict = x => !has ? null : has(x) ? x : has(x + 'e') ? x + 'e' : (/i$/.test(x) && has(x.replace(/i$/, 'y'))) ? x.replace(/i$/, 'y') : null;
  let b;
  // 1) 前缀 + 一个完整的词（un+certainty、re+write）
  for (const [f, p] of PRE_FORMS) if (SOFT_PRE.has(f) && w.startsWith(f) && w.length - f.length >= 4 && (b = inDict(w.slice(f.length)))) return [part('pre', f, p), part('el', w.slice(f.length), null, { m: '独立的词', word: b })];
  // 2) 一个完整的词 + 常见后缀（beauti→beauty + ful）
  for (const [f, s] of SUF_FORMS) if (SOFT_SUF.has(f) && w.endsWith(f) && w.length - f.length >= 4 && (b = inDict(w.slice(0, -f.length)))) return [part('el', w.slice(0, -f.length), null, { m: '独立的词', word: b }), part('suf', f, s)];
  // 3) 两头都认得出：前缀 + 未知部分 + 后缀
  let pre = null, suf = null;
  for (const [f, p] of PRE_FORMS) if (f.length >= 3 && w.startsWith(f) && w.length - f.length >= 5) { pre = part('pre', f, p); break; }
  if (!pre) return null;
  const mid0 = w.slice(pre.t.length);
  for (const [f, s] of SUF_FORMS) if (STRONG_SUF.has(f) && mid0.endsWith(f) && mid0.length - f.length >= 3) { suf = part('suf', f, s); break; }
  if (!suf) return null;
  return [pre, part('el', mid0.slice(0, -suf.t.length), null, { m: '（不在内置词根里）', unknown: true }), suf];
}
/** 拆解结果的部件列表（统一给界面用）。 */
export function partsOf(d) {
  if (d.type === 'known') return d.e.parts;
  if (d.type === 'derived') return d.at === 'pre' ? [d.add, ...d.e.parts] : [...d.e.parts, d.add];
  if (d.type === 'guess' || d.type === 'partial') return d.parts;
  return [];
}
export const rootOf = d => d.type === 'known' || d.type === 'derived' ? d.e.root : d.type === 'guess' ? d.root : null;
/** 材料里的单词是否属于某个词根家族（只认内置词和其屈折/派生形式，不用推测，避免误标）。 */
const TAGS = new Map();
export function familyTag(word) {
  const w = String(word || '').toLowerCase().replace(/[^a-z]/g, ''); if (w.length < 4) return null;
  if (TAGS.has(w)) return TAGS.get(w);
  let r = null;
  for (const c of bases(w)) { if (FALSE_FRIENDS[c]) break; const e = ENTRY.get(c) || (c.length >= 6 ? derived(c)?.base : null); if (e) { r = e.root; break; } }
  TAGS.set(w, r); return r;
}
/** 同根 / 同前缀 / 同后缀家族（去掉自己）。 */
export function relatives(d, { max = 12 } = {}) {
  const self = d.e?.w || d.w; const ps = partsOf(d); const rid = rootOf(d);
  const pre = ps.find(p => p.kind === 'pre'), suf = [...ps].reverse().find(p => p.kind === 'suf');
  const pick = list => list.filter(e => e.w !== self && e.w !== d.w).slice(0, max);
  return {
    root: rid ? { r: ROOT.get(rid), list: pick(FAM.get(rid) || []) } : null,
    pre: pre && PRE.has(pre.k) ? { p: PRE.get(pre.k), t: pre.t, list: pick((BY_PRE.get(pre.k) || []).filter(e => e.root !== rid).sort((a, b) => (b.parts[0].t === pre.t) - (a.parts[0].t === pre.t))) } : null,
    suf: suf && SUF.has(suf.k) ? { s: SUF.get(suf.k), t: suf.t, list: pick((BY_SUF.get(suf.k) || []).filter(e => e.root !== rid).sort((a, b) => (b.parts.at(-1).t === suf.t) - (a.parts.at(-1).t === suf.t))) } : null,
  };
}
export const brief = zh => String(zh || '').replace(/^[a-z./]+\s*/, '').split(/[；;，,]|\s+[a-z]+\.\s/)[0].trim().slice(0, 10);
