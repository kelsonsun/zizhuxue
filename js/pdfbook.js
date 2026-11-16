// 整本 PDF 书籍导入：本地 pdf.js 解析（vendor），按目录/章节标题/页数自动切章，分批处理并报告进度；
// 没有文字层的扫描页自动走本地 Tesseract OCR（较慢）。全程不联网。
import { ocrImage } from './importers.js';
import { splitEnglish, splitChinese, lang } from './textproc.js';

const abs = p => new URL(p, document.baseURI).href;
let libp = null;
function loadPdfLib() {
  if (libp) return libp;
  libp = new Promise((res, rej) => {
    if (globalThis.pdfjsLib) return res(globalThis.pdfjsLib);
    const s = document.createElement('script'); s.src = abs('vendor/pdfjs/pdf.min.js');
    s.onload = () => { globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc = abs('vendor/pdfjs/pdf.worker.min.js'); res(globalThis.pdfjsLib); };
    s.onerror = () => rej(new Error('PDF 组件加载失败（离线且尚未缓存？）')); document.head.appendChild(s);
  });
  return libp;
}
const tick = () => new Promise(r => setTimeout(r, 0));
const TERMINAL = /[.!?…"”’)\]:。！？；]$/;

export async function openPdf(file) {
  const lib = await loadPdfLib();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  let title = ''; try { title = (await doc.getMetadata())?.info?.Title || ''; } catch { }
  return { doc, numPages: doc.numPages, title };
}

/** 一页 → 段落[]。按行距/首行缩进切段。 */
async function pageParas(page) {
  const tc = await page.getTextContent(); const lines = [];
  let cur = null;
  for (const it of tc.items) {
    if (!it.str && !it.hasEOL) continue;
    const y = it.transform[5], x = it.transform[4];
    if (!cur || Math.abs(y - cur.y) > Math.max(2, (it.height || 8) * 0.5)) { cur = { y, x, text: '', h: it.height || 10 }; lines.push(cur); }
    cur.text += it.str;
  }
  const L = lines.map(l => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() })).filter(l => l.text);
  if (!L.length) return { paras: [], chars: 0, lines: [] };
  const gaps = []; for (let i = 1; i < L.length; i++) { const g = Math.abs(L[i - 1].y - L[i].y); if (g > 0) gaps.push(g); }
  gaps.sort((a, b) => a - b); const med = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 12;
  const minX = Math.min(...L.map(l => l.x));
  const paras = []; let buf = [];
  const flush = () => { if (buf.length) { paras.push(joinLines(buf)); buf = []; } };
  for (let i = 0; i < L.length; i++) {
    const l = L[i], prev = L[i - 1];
    if (prev) {
      const gap = Math.abs(prev.y - l.y);
      const bigGap = gap > med * 1.45;
      const indent = l.x - minX > l.h * 0.8 && TERMINAL.test(prev.text);
      if (bigGap || indent) flush();
    }
    const isHead = l.text.length < 70 && HEAD.test(l.text) && !/[,;]$/.test(l.text);
    if (isHead) { flush(); paras.push(l.text); continue; } // “CHAPTER I.” 这样的标题行单独成段
    buf.push(l.text);
  }
  flush();
  return { paras, chars: L.reduce((a, l) => a + l.text.length, 0), lines: L };
}
function joinLines(ls) {
  let out = '';
  for (const l of ls) { if (!out) out = l; else if (/[a-z]-$/.test(out) && /^[a-z]/.test(l)) out = out.slice(0, -1) + l; else if (/[\u3400-\u9fff，。、；：！？）]$/.test(out) || /^[\u3400-\u9fff，。、；：！？（]/.test(l)) out += l; else out += ' ' + l; }
  return out.trim();
}
async function ocrPage(page) {
  const vp = page.getViewport({ scale: 2 }); const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
  await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
  const blob = await new Promise(r => cv.toBlob(r, 'image/png')); cv.width = cv.height = 0;
  const { text } = await ocrImage(blob);
  const paras = text.replace(/\r/g, '').split(/\n\s*\n/).map(p => p.split('\n').map(s => s.trim()).filter(Boolean)).filter(p => p.length).map(joinLines);
  return paras;
}

/** 逐页抽取（分批让出主线程）。返回 pages: [{n, paras, scanned}]。 */
export async function extractPages(pdf, { onProgress = () => { }, cancelled = () => false, ocrScanned = true } = {}) {
  const pages = []; let ocrCount = 0;
  for (let n = 1; n <= pdf.numPages; n++) {
    if (cancelled()) throw new Error('已取消');
    const page = await pdf.doc.getPage(n);
    const r = await pageParas(page); let paras = r.paras, scanned = false;
    if (r.chars < 25 && ocrScanned) {
      scanned = true; ocrCount++;
      onProgress({ n, total: pdf.numPages, phase: 'ocr', ocrCount });
      try { paras = await ocrPage(page); } catch (e) { paras = []; console.warn('OCR 失败 第' + n + '页', e); }
    } else onProgress({ n, total: pdf.numPages, phase: 'text', ocrCount });
    pages.push({ n, paras, scanned, firstLine: r.lines[0]?.text || '', lastLine: r.lines.at(-1)?.text || '' });
    page.cleanup?.();
    if (n % 3 === 0) await tick();
  }
  stripHeadersFooters(pages);
  return pages;
}
/** 去掉每页重复的页眉页脚与单独的页码。 */
function stripHeadersFooters(pages) {
  const norm = t => t.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
  const cnt = new Map(); const textPages = pages.filter(p => p.paras.length);
  for (const p of textPages) for (const t of new Set([norm(p.paras[0] || ''), norm(p.paras.at(-1) || '')])) if (t) cnt.set(t, (cnt.get(t) || 0) + 1);
  const rep = new Set([...cnt].filter(([t, c]) => c >= Math.max(4, textPages.length * 0.3) && t.length < 80).map(x => x[0]));
  for (const p of textPages) {
    const isNum = t => /^(page\s*)?[\divxlc]{1,5}$/i.test(t.trim());
    while (p.paras.length && (rep.has(norm(p.paras[0])) || isNum(p.paras[0]))) p.paras.shift();
    while (p.paras.length && (rep.has(norm(p.paras.at(-1))) || isNum(p.paras.at(-1)))) p.paras.pop();
  }
}

async function pageOfItem(doc, item) {
  try {
    let dest = item.dest; if (typeof dest === 'string') dest = await doc.getDestination(dest); if (!Array.isArray(dest)) return null;
    const ref = dest[0]; return typeof ref === 'object' ? await doc.getPageIndex(ref) : ref;
  } catch { return null; }
}
/** 读取 PDF 目录（outline）→ [{title, page(0-based)}]；取最合适的一层。 */
export async function readOutline(pdf) {
  let ol; try { ol = await pdf.doc.getOutline(); } catch { ol = null; }
  if (!ol?.length) return [];
  const level = async (items) => { const out = []; for (const it of items) { const p = await pageOfItem(pdf.doc, it); if (p != null && it.title?.trim()) out.push({ title: it.title.trim(), page: p, kids: it.items || [] }); } return out; };
  let items = await level(ol);
  if (items.length === 1 && items[0].kids.length) items = await level(items[0].kids);
  items.sort((a, b) => a.page - b.page);
  return items.map(({ title, page }) => ({ title, page }));
}

const HEAD_EN = /^(chapter|part|book|section|stave|letter|act)\s+([ivxlcdm]+|\d+|[a-z]+)\b[.:\s-]*/i;
const HEAD_ZH = /^第\s*[一二三四五六七八九十百千零〇两\d]+\s*[章回节卷部篇]/;
const HEAD = { test: t => HEAD_EN.test(t) || HEAD_ZH.test(t) };
const norm = t => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** 按页面段落切章。返回 {method, chapters:[{title, from, to, paras}]}。 */
export function splitChapters(pages, outline, { chunk = 10 } = {}) {
  const N = pages.length;
  if (outline.length >= 2) {
    const chapters = [];
    for (let k = 0; k < outline.length; k++) {
      const o = outline[k], nx = outline[k + 1]; const from = o.page, to = nx ? Math.max(from, nx.page) : N - 1;
      let paras = [];
      for (let p = from; p <= to; p++) paras.push(...pages[p].paras.map(t => ({ t, page: p })));
      // 起点：丢弃本章标题之前的段落（同页上一章的结尾）
      const tn = norm(o.title); const si = paras.findIndex(x => x.page === from && norm(x.t).startsWith(tn.slice(0, 30)));
      if (si > 0) paras = paras.slice(si);
      // 章标题本身不是正文：丢弃开头与标题相同（或是标题一部分）的短段落
      while (paras.length && paras[0].page === from && paras[0].t.length <= o.title.length + 12 && norm(paras[0].t) && (norm(paras[0].t).startsWith(tn) || tn.startsWith(norm(paras[0].t)))) { const t0 = norm(paras[0].t); paras.shift(); if (t0.length >= tn.length) break; }
      if (nx) { const en = norm(nx.title); const ei = paras.findIndex((x, i) => x.page === nx.page && i > 0 && norm(x.t).startsWith(en.slice(0, 30))); if (ei > 0) paras = paras.slice(0, ei); else if (nx.page > from) paras = paras.filter(x => x.page < nx.page); }
      chapters.push({ title: o.title, from: from + 1, to: Math.min(to, N - 1) + 1, paras: paras.map(x => x.t) });
    }
    // 目录之前的内容（封面/前言）并为“前言”
    const pre = []; for (let p = 0; p < outline[0].page; p++) pre.push(...pages[p].paras);
    if (pre.join(' ').length > 800) chapters.unshift({ title: '前言 / 目录前内容', from: 1, to: outline[0].page, paras: pre });
    return { method: 'outline', chapters: chapters.filter(c => c.paras.length) };
  }
  // 章节标题检测
  const flat = []; pages.forEach((p, pi) => p.paras.forEach(t => flat.push({ t, page: pi })));
  const heads = []; flat.forEach((x, i) => { if (x.t.length < 80 && HEAD.test(x.t)) heads.push(i); });
  if (heads.length >= 3) {
    const chapters = [];
    for (let k = 0; k < heads.length; k++) {
      const a = heads[k], b = heads[k + 1] ?? flat.length; let paras = flat.slice(a, b);
      let title = paras[0].t; // “CHAPTER I.” 后面一行常是章名
      if (HEAD.test(title) && title.length < 30 && paras[1] && paras[1].t.length < 70 && !TERMINAL.test(paras[1].t.replace(/[.]$/, ''))) { title += ' ' + paras[1].t; paras = paras.slice(2); } else paras = paras.slice(1);
      chapters.push({ title: title.replace(/\s+/g, ' ').slice(0, 80), from: paras[0] ? flat[a].page + 1 : flat[a].page + 1, to: (flat[Math.min(b, flat.length) - 1] || flat[a]).page + 1, paras: paras.map(x => x.t) });
    }
    const pre = flat.slice(0, heads[0]).map(x => x.t); if (pre.join(' ').length > 1500) chapters.unshift({ title: '前言', from: 1, to: flat[heads[0]].page + 1, paras: pre });
    return { method: 'headings', chapters };
  }
  // 按页数
  const chapters = [];
  for (let a = 0; a < N; a += chunk) { const b = Math.min(a + chunk, N) - 1; const paras = []; for (let p = a; p <= b; p++) paras.push(...pages[p].paras); if (paras.length) chapters.push({ title: `第 ${a + 1}–${b + 1} 页`, from: a + 1, to: b + 1, paras }); }
  return { method: 'pages', chapters };
}

/** 段落[] → 句子[]（带段号 p）。跨页断开的句子在 splitChapters 前不处理，这里把“未结束的段落+小写开头的下一段”合并。 */
export function parasToSentences(paras) {
  const merged = [];
  for (const t of paras) { const prev = merged[merged.length - 1]; if (prev && ((!TERMINAL.test(prev) && /^[a-z]/.test(t)) || (lang(prev) === 'zh' && lang(t) === 'zh' && !/[。！？…”』」]$/.test(prev)))) merged[merged.length - 1] = prev + ' ' + t; else merged.push(t); }
  const out = []; let p = 0;
  for (const para of merged) {
    if (lang(para) === 'zh') { const zs = splitChinese(para); if (!zs.length) continue; for (const z of zs) out.push({ en: '', zh: z, speaker: '', p }); p++; continue; } // 中文书：中文原文，英文待翻译
    const ss = splitEnglish(para).filter(s => /[A-Za-z]{2}/.test(s)); if (!ss.length) continue; for (const s of ss) out.push({ en: s, zh: '', speaker: '', p }); p++; }
  return out;
}
