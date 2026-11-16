// 文件/图片读取：txt、docx、pdf、OCR。第三方库全部来自本地 vendor/（不依赖外网 CDN），按需加载。
const abs = p => new URL(p, document.baseURI).href;
const loaded = {};
function loadScript(src) {
  if (loaded[src]) return loaded[src];
  loaded[src] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = abs(src); s.onload = res; s.onerror = () => rej(new Error('组件加载失败：' + src + '（离线且尚未缓存？）')); document.head.appendChild(s); });
  return loaded[src];
}
export const extOf = n => (n.split('.').pop() || '').toLowerCase();

async function readText(file) {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { try { return new TextDecoder('gb18030').decode(buf); } catch { return new TextDecoder().decode(buf); } }
}
export async function readDocx(file) {
  await loadScript('vendor/mammoth/mammoth.browser.min.js');
  const r = await globalThis.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return r.value;
}
export async function readPdf(file) {
  await loadScript('vendor/pdfjs/pdf.min.js');
  const lib = globalThis.pdfjsLib; lib.GlobalWorkerOptions.workerSrc = abs('vendor/pdfjs/pdf.worker.min.js');
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  let out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p); const tc = await page.getTextContent();
    let line = '', lastY = null;
    for (const it of tc.items) {
      const y = it.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 3) { out.push(line.trim()); line = ''; }
      line += it.str + (it.hasEOL ? '\n' : ' '); lastY = y;
    }
    if (line.trim()) out.push(line.trim());
  }
  const text = out.join('\n').trim();
  if (!text) throw new Error('这个 PDF 里没有可提取的文字（可能是扫描件，请改用「截图识别」）');
  return text;
}
/** 统一入口：返回 {kind:'subtitle'|'text', text}。 */
export async function readFileAsText(file) {
  const e = extOf(file.name);
  if (e === 'srt' || e === 'vtt') return { kind: 'subtitle', text: await readText(file) };
  if (e === 'docx') return { kind: 'text', text: collapseBlank(await readDocx(file)) };
  if (e === 'pdf') return { kind: 'text', text: unwrapSoft(await readPdf(file)) };
  if (e === 'txt' || e === 'md' || file.type.startsWith('text/')) return { kind: 'text', text: collapseBlank(await readText(file)) };
  throw new Error('暂不支持 .' + e + ' 文件（支持 srt/vtt/txt/docx/pdf）');
}

let ocrWorker = null;
export async function ocrImage(file, onProgress = () => {}) {
  await loadScript('vendor/tesseract/tesseract.min.js');
  if (!ocrWorker) {
    ocrWorker = await globalThis.Tesseract.createWorker('eng', 1, {
      workerPath: abs('vendor/tesseract/worker.min.js'),
      corePath: abs('vendor/tesseract/core'),
      langPath: abs('vendor/tesseract/lang'),
      gzip: true,
      logger: m => { if (m.status) onProgress(m); },
    });
  }
  const { data } = await ocrWorker.recognize(file);
  return { text: data.text.trim(), confidence: data.confidence };
}
/** 软合并：PDF/OCR 里被排版硬换行的句子并回一行；已有句末标点的行、中文行、标题行保持独立。 */
export function unwrapSoft(t) {
  const L = String(t).replace(/\r/g, '').replace(/-\n(?=[a-z])/g, '').split('\n').map(s => s.trim());
  const out = [];
  for (const line of L) {
    if (!line) { out.push(''); continue; }
    const prev = out[out.length - 1];
    if (prev && !/[.!?…。！？"”)]$/.test(prev) && (/^[a-z]/.test(line) || /[,;:，；：]$/.test(prev)) && !/[\u3400-\u9fff]/.test(prev + line)) out[out.length - 1] = prev + ' ' + line;
    else out.push(line);
  }
  return out.join('\n').replace(/\n{2,}/g, '\n').trim();
}
export const collapseBlank = t => String(t).replace(/\r/g, '').replace(/\n{2,}/g, '\n').trim();
