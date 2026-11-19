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
const syl = w => CJK.test(w) ? 1 : /^\d+$/.test(w) ? 1.5 * w.length : /[A-Za-z]/.test(w) ? ((w.toLowerCase().replace(/[^a-z]/g, '').replace(/e$/, '').match(/[aeiouy]+/g) || []).length || 1) + 0.3 : 0.2;
/** 逐词时间是否还能用（文字改过、词数对不上就不用） */
export const wtOk = (row, toks) => Array.isArray(row.wt) && row.wt.length === toks.length && row.wt.every(x => Array.isArray(x) && x.length === 2 && x[1] >= x[0]);
const r2 = x => +(+x).toFixed(2);

/**
 * 按用户选的切点算出各段。cuts：在第 j 个词之后断开（0 起）。pauses：整段录音测到的停顿 [{a, b}]（秒）。
 * 返回 {field, toks, pieces:[{text, t0, t1, how, wt}]}；how：'word' 逐词时间 / 'pause' 对齐到停顿 / 'est' 按比例估算 / null 无时间。
 */
export function planSplit(row, cuts, { pauses = [] } = {}) {
  const field = fieldOf(row), zh = field === 'zh', text = row[field] || '', toks = tokenize(text, zh);
  cuts = [...new Set(cuts.map(Number))].filter(j => j >= 0 && j < toks.length - 1).sort((a, b) => a - b);
  const hasT = row.t0 != null && row.t1 != null && row.t1 > row.t0;
  const wt = hasT && wtOk(row, toks) ? row.wt : null;
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
/** 把计划应用到一行：第一段保留原句的 id（学习记录、生词卡的来源句还在），其余是新句。 */
export function applySplit(row, plan) {
  const other = plan.field === 'en' ? 'zh' : 'en';
  return plan.pieces.map((p, i) => {
    const base = i === 0 ? { ...row } : { speaker: row.speaker || '' };
    const r = { ...base, [plan.field]: p.text, [other]: i === 0 ? (row[other] || '') : '' };
    if (p.t0 != null) { r.t0 = p.t0; r.t1 = p.t1; }
    if (p.wt) r.wt = p.wt; else delete r.wt;
    return r;
  });
}
/** 合并两句（与拆分对称）：时间取并集，逐词时间都有效才拼起来。 */
export function mergeRows(a, n) {
  const ta = tokensOfRow(a), tn = tokensOfRow(n);
  const r = { ...a, en: ((a.en || '') + ' ' + (n.en || '')).trim(), zh: ((a.zh || '') + (a.zh && n.zh ? ' ' : '') + (n.zh || '')).trim() };
  if (n.t1 != null) r.t1 = n.t1; if (r.t0 == null && n.t0 != null) r.t0 = n.t0;
  if (wtOk(a, ta) && wtOk(n, tn) && fieldOf(a) === fieldOf(n)) r.wt = [...a.wt, ...n.wt]; else delete r.wt;
  return r;
}
