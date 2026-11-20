// v1.5.1 拆分一句：切点完全由用户决定（点哪两个词之间就从哪里断）；这里只算每段的原声时间。
//  · 有逐词时间（AI 转写 whisper 的 word 时间戳）→ 按词的时间切；
//  · 没有 → 按“说话量”（音节）比例在这句的有声时间里估算，再在附近找测到的停顿微调。
//  停顿只用来微调时间，绝不改变文字切点。纯函数，可单测。
const CJK = /[\u3400-\u9fff]/;
/** 把一句切成“词”（英文按空格；中文按字，标点跟着前一个字）。返回 [{s, a, b}]，b 不含。 */
export function tokenize(text, zh = false) {
  const re = zh ? /[\u3400-\u9fff][，。！？、；：,.!?;:”’」』）)…]*|[^\s\u3400-\u9fff]+/g : /\S+/g; const out = []; let m;
  while ((m = re.exec(text || ''))) out.push({ s: m[0], a: m.index, b: m.index + m[0].length });
  return out;
}
/** 这句拆哪个字段：有英文拆英文，否则拆中文 */
export const fieldOf = row => (row.en || '').trim() ? 'en' : 'zh';
export const tokensOfRow = row => { const f = fieldOf(row); return tokenize(row[f] || '', f === 'zh'); };
/** v1.9.3 中文也能拆：两边都有文字时，用户可选从英文拆还是从中文拆；中文材料（英文是译出来的）默认从中文拆 */
export const splitFields = row => ['en', 'zh'].filter(f => (row[f] || '').trim());
export const defaultField = row => row.orig === 'zh' && (row.zh || '').trim() ? 'zh' : fieldOf(row);
/** 这句能不能拆：任一边有 2 个以上的词 / 字 */
export const canSplit = row => splitFields(row).some(f => tokenize(row[f], f === 'zh').length >= 2);
const syl = w => CJK.test(w) ? 1 : /^\d+$/.test(w) ? 1.5 * w.length : /[A-Za-z]/.test(w) ? ((w.toLowerCase().replace(/[^a-z]/g, '').replace(/e$/, '').match(/[aeiouy]+/g) || []).length || 1) + 0.3 : 0.2;
/** 逐词时间是否还能用（文字改过、词数对不上就不用） */
export const wtOk = (row, toks) => Array.isArray(row.wt) && row.wt.length === toks.length && row.wt.every(x => Array.isArray(x) && x.length === 2 && x[1] >= x[0]);
const r2 = x => +(+x).toFixed(2);

/**
 * 按用户选的切点算出各段。cuts：在第 j 个词之后断开（0 起）。pauses：整段录音测到的停顿 [{a, b}]（秒）。
 * 返回 {field, toks, pieces:[{text, t0, t1, how, wt}]}；how：'word' 逐词时间 / 'pause' 对齐到停顿 / 'est' 按比例估算 / null 无时间。
 */
export function planSplit(row, cuts, { pauses = [], field: want = null } = {}) {
  const field = want && (row[want] || '').trim() ? want : fieldOf(row), zh = field === 'zh', text = row[field] || '', toks = tokenize(text, zh);
  cuts = [...new Set(cuts.map(Number))].filter(j => j >= 0 && j < toks.length - 1).sort((a, b) => a - b);
  const hasT = row.t0 != null && row.t1 != null && row.t1 > row.t0;
  const wt = hasT && field === fieldOf(row) && wtOk(row, toks) ? row.wt : null; // 逐词时间属于英文（转写原文），从中文拆时不用
  const T0 = hasT ? +row.t0 : null, T1 = hasT ? +row.t1 : null;
  const inner = hasT ? (pauses || []).filter(p => p.b > T0 + 0.05 && p.a < T1 - 0.05 && p.b - p.a >= 0.12) : [];
  // 有声时间（去掉句内停顿）：比例估算只在有声的地方分配
  const voiced = []; if (hasT) { let cur = T0; for (const p of inner) { const a = Math.max(p.a, T0), b = Math.min(p.b, T1); if (a > cur) voiced.push([cur, a]); cur = Math.max(cur, b); } if (cur < T1) voiced.push([cur, T1]); }
  const vTot = voiced.reduce((x, [u, v]) => x + v - u, 0);
  const tAt = v => { for (const [u, w] of voiced) { if (v <= w - u) return u + v; v -= w - u; } return T1; };
  const W = [0]; for (const k of toks) W.push(W[W.length - 1] + syl(k.s));
  const bounds = cuts.map(j => {
    if (!hasT) return { j, end: null, start: null, how: null };
    let est, lo, hi, how;
    if (wt) { lo = wt[j][1]; hi = wt[j + 1][0]; est = (lo + hi) / 2; how = 'word'; }
    else { est = vTot > 0 ? tAt(vTot * W[j + 1] / W[toks.length]) : T0 + (T1 - T0) * W[j + 1] / W[toks.length]; how = 'est'; }
    // 附近测到的停顿：只用来微调时间（文字切点不变）
    const win = wt ? 0.3 : Math.max(0.8, 0.15 * (T1 - T0)); let best = null, bd = Infinity;
    for (const p of inner) { const d = est < p.a ? p.a - est : est > p.b ? est - p.b : 0; if (d <= win && d < bd) { bd = d; best = p; } }
    if (best) { const mid = (best.a + best.b) / 2; return { j, end: Math.min(best.a + 0.15, mid), start: Math.max(best.b - 0.15, mid), how: wt ? 'word' : 'pause' }; }
    if (wt && hi >= lo) return { j, end: Math.min(lo + 0.1, est), start: Math.max(hi - 0.1, est), how };
    return { j, end: est, start: est, how };
  });
  const pieces = []; let prevStart = T0;
  for (let k = 0; k <= cuts.length; k++) {
    const a = k ? cuts[k - 1] + 1 : 0, b = k < cuts.length ? cuts[k] : toks.length - 1;
    const p = { text: text.slice(toks[a].a, toks[b].b).trim(), from: a, to: b, how: k < cuts.length ? bounds[k].how : (k ? bounds[k - 1].how : null) };
    if (hasT) {
      let t0 = k ? bounds[k - 1].start : T0, t1 = k < cuts.length ? bounds[k].end : T1;
      t0 = Math.max(t0, prevStart); t1 = Math.min(Math.max(t1, t0 + 0.1), T1); if (t1 <= t0) t0 = Math.max(T0, t1 - 0.1);
      p.t0 = r2(t0); p.t1 = r2(t1); prevStart = t0;
      if (wt) p.wt = wt.slice(a, b + 1);
    }
    pieces.push(p);
  }
  return { field, toks, cuts, pieces };
}
// —— v1.6 译文跟着拆：用户定好原文切点后，把已有译文分成对应的段（不重新翻译）——
const STRONG = /[。！？；!?;.…]["”’」』）)]*$/, WEAK = /[，、,：:—]["”’」』）)]*$/;
const lenOf = (s, zh) => zh ? (s.match(/[\u3400-\u9fffA-Za-z0-9]/g) || []).length : (s.match(/[A-Za-z0-9]/g) || []).length;
/**
 * 按原文各段的长度比例，在译文里找对应的切点（优先落在句号/逗号等标点后面）。
 * toks：译文的词/字；weights：原文各段的长度；srcEnds：原文各段文字（看结尾标点）。返回 k=weights.length-1 个切点（第 j 个词/字之后断开），译文太短时返回 null。
 */
export function autoCutsOther(toks, weights, srcEnds = []) {
  const k = weights.length - 1, n = toks.length; if (k <= 0) return []; if (n < k + 1) return null;
  const W = weights.map(w => Math.max(0.5, w)), tot = W.reduce((a, b) => a + b, 0); const target = []; let acc = 0;
  for (let m = 0; m < k; m++) { acc += W[m]; target.push(acc / tot); }
  const zh = toks.some(t => /[\u3400-\u9fff]/.test(t.s)); const L = [0]; for (const t of toks) L.push(L[L.length - 1] + Math.max(1, lenOf(t.s, zh)));
  // 标点对标点：原文这段以句号/问号结尾 → 译文也尽量断在句号/问号后；以逗号结尾 → 断在逗号后（中英文长短比例差别大，标点比长度更可靠）
  const PEN = { strong: { strong: 0, weak: 0.12, none: 0.3 }, weak: { weak: 0, strong: 0.08, none: 0.22 }, none: { strong: 0.04, weak: 0.04, none: 0.1 } };
  const kindOf = s => STRONG.test(s) ? 'strong' : WEAK.test(s) ? 'weak' : 'none';
  const ends = (srcEnds || []).map(kindOf);
  const cost = (m, j) => Math.abs(L[j + 1] / L[n] - target[m]) + PEN[ends[m] || 'none'][kindOf(toks[j].s)];
  // 动态规划：第 m 个切点放在 j，切点严格递增
  const INF = 1e9; let prev = Array(n).fill(INF), back = [];
  for (let j = 0; j < n - 1; j++) prev[j] = cost(0, j);
  for (let m = 1; m < k; m++) {
    const cur = Array(n).fill(INF), b = Array(n).fill(-1); let best = INF, bi = -1;
    for (let j = 0; j < n - 1; j++) { if (j - 1 >= 0 && prev[j - 1] < best) { best = prev[j - 1]; bi = j - 1; } if (bi >= 0) { cur[j] = best + cost(m, j); b[j] = bi; } }
    back.push(b); prev = cur;
  }
  let j = -1, bv = INF; for (let x = 0; x < n - 1; x++) if (prev[x] < bv) { bv = prev[x]; j = x; }
  if (j < 0) return null; const out = [j]; for (let m = k - 2; m >= 0; m--) { j = back[m][j]; out.unshift(j); }
  return out;
}
/** 译文按切点取各段文字 */
export function textsByCuts(text, toks, cuts) {
  const out = []; let a = 0;
  for (const c of [...cuts, toks.length - 1]) { out.push(toks.length ? text.slice(toks[a].a, toks[c].b).trim() : ''); a = c + 1; }
  return out;
}
/**
 * 译文怎么分：
 *  · texts（AI 对齐结果 / 各段重新翻译）条数对得上就直接用；
 *  · 否则用用户在预览里点的切点 cuts；没点过就按标点 + 长度比例自动对齐（how='auto'）。
 * 返回 {field, toks, cuts, texts, how}；how：none 没有译文 / auto 自动对齐 / user 用户调过 / ai AI 对齐 / ai-adj AI 对齐并微调措辞 / mt:通道 重新翻译 / short 译文太短分不开
 */
export function planOther(row, plan, { cuts = null, texts = null, how = null } = {}) {
  const field = plan.field === 'en' ? 'zh' : 'en', zh = field === 'zh', text = (row[field] || '').trim(), n = plan.pieces.length;
  const toks = tokenize(text, zh);
  if (Array.isArray(texts) && texts.length === n) return { field, toks, cuts: null, texts: texts.map(t => String(t || '').trim()), how: how || 'ai' };
  if (!text) return { field, toks, cuts: [], texts: Array(n).fill(''), how: 'none' };
  let cs = null, h = 'user';
  if (Array.isArray(cuts)) { cs = [...new Set(cuts.map(Number))].filter(j => j >= 0 && j < toks.length - 1).sort((a, b) => a - b); if (cs.length !== n - 1) cs = null; }
  if (!cs) { cs = autoCutsOther(toks, plan.pieces.map(p => lenOf(p.text, plan.field === 'zh')), plan.pieces.map(p => p.text)); h = 'auto'; }
  if (!cs) return { field, toks, cuts: [], texts: [text, ...Array(n - 1).fill('')], how: 'short' };
  return { field, toks, cuts: cs, texts: textsByCuts(text, toks, cs), how: h };
}
/** AI 返回的各段译文 → 如果只是把原译文切开（去掉空白后拼起来一字不差），换算成切点，用户还能继续点着调 */
export function cutsFromTexts(text, toks, texts) {
  const norm = s => String(s || '').replace(/\s+/g, ''); if (norm(texts.join('')) !== norm(text)) return null;
  const cuts = []; let acc = 0, ti = 0;
  for (let k = 0; k < texts.length - 1; k++) {
    acc += norm(texts[k]).length; let got = 0, j = -1;
    for (let x = 0; x < toks.length; x++) { got += norm(toks[x].s).length; if (got === acc) { j = x; break; } if (got > acc) return null; }
    if (j < 0 || j < ti) return null; cuts.push(j); ti = j + 1;
  }
  return cuts;
}
/** 把计划应用到一行：第一段保留原句的 id（学习记录、生词卡的来源句还在），其余是新句。other：译文怎么分（planOther 的结果）。 */
export function applySplit(row, plan, other = planOther(row, plan)) {
  const of = other.field;
  return plan.pieces.map((p, i) => {
    const base = i === 0 ? { ...row } : { speaker: row.speaker || '' };
    const r = { ...base, [plan.field]: p.text, [of]: other.texts[i] || '' }; r._sp = 1; // 拆分出来的（草稿内标记，保存时去掉）：中英文已对应，不算“改过”
    if (String(other.how).startsWith('mt:')) r.trNew = String(other.how).slice(3); else if (row.tr && other.texts[i]) r.trNew = row.tr; else delete r.trNew; // 各段重新翻译：保存后标“机器翻译，可改”
    if (p.t0 != null) { r.t0 = p.t0; r.t1 = p.t1; }
    if (p.wt) r.wt = p.wt; else delete r.wt;
    return r;
  });
}
/** 合并两句（与拆分对称）：时间取并集，逐词时间都有效才拼起来。 */
export function mergeRows(a, n) {
  const ta = tokensOfRow(a), tn = tokensOfRow(n);
  const zj = (x, y) => (x && y ? (/[\u3400-\u9fff，。！？；：、”’）]$/.test(x) && /^[\u3400-\u9fff“‘（]/.test(y) ? x + y : x + ' ' + y) : x || y).trim();
  const r = { ...a, en: ((a.en || '') + ' ' + (n.en || '')).trim(), zh: zj((a.zh || '').trim(), (n.zh || '').trim()) };
  if (n.t1 != null) r.t1 = n.t1; if (r.t0 == null && n.t0 != null) r.t0 = n.t0;
  if (wtOk(a, ta) && wtOk(n, tn) && fieldOf(a) === fieldOf(n)) r.wt = [...a.wt, ...n.wt]; else delete r.wt;
  return r;
}
