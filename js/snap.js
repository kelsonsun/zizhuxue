// v1.8 拍照即查：把 Tesseract 的识别结果（块 → 段 → 行 → 词，带像素坐标）整理成“可点的词框”和“句子”。纯函数，便于单元测试。
const ABBR = new Set(['mr', 'mrs', 'ms', 'dr', 'st', 'jr', 'sr', 'vs', 'etc', 'e.g', 'i.e', 'no', 'p.m', 'a.m', 'u.s', 'prof', 'inc', 'ltd', 'co', 'fig', 'approx']);
/** 词框上的文字 → 可查的词（去掉两头标点；没有字母就返回 ''） */
export function cleanWord(t) {
  const s = String(t || '').replace(/[’‘`]/g, "'").replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
  return /[A-Za-z]/.test(s) ? s : '';
}
/** 这个词是否结束一句（. ! ? 结尾，排除常见缩写和单个大写字母缩写） */
export function endsSentence(t) {
  const s = String(t || '').trim(); if (!/[.!?…]["'”’)\]]*$/.test(s)) return false;
  if (/[!?…]["'”’)\]]*$/.test(s)) return true;
  const core = s.replace(/["'”’)\]]+$/, '').replace(/\.$/, '').replace(/^[^A-Za-z]+/, '').toLowerCase();
  return !(ABBR.has(core) || /^[a-z]$/.test(core));
}
/** 把 Tesseract 输出统一成 [{words:[{text,conf,bbox}]}]（行列表，带段号）。支持 data.blocks（v5 默认）或 data.lines / data.words。 */
export function linesOf(data) {
  const out = [];
  if (Array.isArray(data?.blocks) && data.blocks.length) {
    let para = 0;
    for (const b of data.blocks) for (const p of b.paragraphs || []) { for (const l of p.lines || []) out.push({ para, bbox: l.bbox, words: l.words || [] }); para++; }
    return out;
  }
  if (Array.isArray(data?.lines) && data.lines.length) {
    const paras = new Map(); return data.lines.map(l => { const k = l.paragraph || 0; if (!paras.has(k)) paras.set(k, paras.size); return { para: paras.get(k), bbox: l.bbox, words: l.words || [] }; });
  }
  if (Array.isArray(data?.words) && data.words.length) return [{ para: 0, bbox: null, words: data.words }];
  return [];
}
/**
 * 识别结果 → 版面：
 *   words: [{i, text, term, x0,y0,x1,y1, conf, line, para, sent}]（term = 查词用的词；行尾连字符断开的词两半都查合并后的词）
 *   sentences: [{i, text, words:[下标]}]；text：整理后的全文（一段一行）
 * minConf：低于这个置信度、又没有字母的“词”（多半是图上的噪点）丢掉
 */
export function buildLayout(data, { minConf = 30 } = {}) {
  const lines = linesOf(data); const words = []; const sentences = [];
  let cur = null; const flush = () => { if (cur && cur.words.length) { cur.text = sentText(cur.words.map(i => words[i])); cur.i = sentences.length; sentences.push(cur); } cur = null; };
  let lastPara = -1;
  lines.forEach((l, li) => {
    if (l.para !== lastPara) { flush(); lastPara = l.para; }
    for (const w of l.words) {
      const text = String(w.text || '').trim(); if (!text) continue;
      const conf = w.confidence ?? 100; if (conf < minConf && !/[A-Za-z]/.test(text)) continue;
      const b = w.bbox || {};
      const o = { i: words.length, text, term: cleanWord(text), x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, conf: Math.round(conf), line: li, para: l.para, sent: 0 };
      words.push(o);
      if (!cur) cur = { words: [] };
      o.sent = sentences.length; cur.words.push(o.i);
      if (endsSentence(text)) flush();
    }
    // 行尾连字符：insur- / ance → insurance
    const lw = words.filter(x => x.line === li); const last = lw[lw.length - 1];
    if (last && /[A-Za-z]-$/.test(last.text)) last.hyph = true;
  });
  flush();
  for (let k = 0; k < words.length - 1; k++) {
    const a = words[k], b = words[k + 1];
    if (a.hyph && b.line === a.line + 1 && b.para === a.para && /^[a-z]/.test(b.text)) { const t = cleanWord(a.text.replace(/-$/, '') + b.text); a.term = b.term = t; }
  }
  const text = []; let p = -1, buf = [];
  for (const s of sentences) { const sp = words[s.words[0]].para; if (sp !== p && buf.length) { text.push(buf.join(' ')); buf = []; } p = sp; buf.push(s.text); }
  if (buf.length) text.push(buf.join(' '));
  return { words, sentences, text: text.join('\n') };
}
/** 一句的词 → 文本（行尾连字符并回去） */
export function sentText(ws) {
  let s = '';
  ws.forEach((w, k) => { const nxt = ws[k + 1]; if (w.hyph && nxt && /^[a-z]/.test(nxt.text)) s += w.text.replace(/-$/, ''); else s += w.text + (nxt ? ' ' : ''); });
  return s.trim();
}
/** 图片缩放：最长边不超过 max（识别速度和内存），返回整数宽高 */
export function fitSize(w, h, max = 2000) { const k = Math.min(1, max / Math.max(w, h)); return { w: Math.round(w * k), h: Math.round(h * k), k }; }
/** 词框 → 相对图片的百分比位置（叠在图片上，缩放显示时也对得上）；四周留一点余量方便手指点 */
export function boxPct(w, W, H, pad = 2) {
  const x0 = Math.max(0, w.x0 - pad), y0 = Math.max(0, w.y0 - pad), x1 = Math.min(W, w.x1 + pad), y1 = Math.min(H, w.y1 + pad);
  const f = v => Math.round(v * 10000) / 100;
  return { left: f(x0 / W), top: f(y0 / H), width: f((x1 - x0) / W), height: f((y1 - y0) / H) };
}
/** 点击位置（相对图片的 0–1 坐标）→ 最近的词下标（在词框内优先；都不在时取 tol 以内最近的） */
export function hitTest(words, W, H, fx, fy, tol = 0.03) {
  const x = fx * W, y = fy * H; let best = -1, bd = Infinity;
  for (const w of words) {
    if (!w.term) continue;
    const dx = x < w.x0 ? w.x0 - x : x > w.x1 ? x - w.x1 : 0, dy = y < w.y0 ? w.y0 - y : y > w.y1 ? y - w.y1 : 0;
    const d = Math.hypot(dx / W, dy / H); if (d < bd) { bd = d; best = w.i; }
  }
  return bd <= tol ? best : -1;
}
