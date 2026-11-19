// v1.8 双语对照：材料 → 段（或句）对照组；导出 TXT / HTML / Word（.docx）。纯函数，可单测。
import { paragraphs } from './structure.js';
import { makeZip } from './zip.js';

const line = s => (s.speaker ? s.speaker + ': ' : '') + (s.en || '').trim();
const zline = s => (s.speaker && s.zh ? s.speaker + '：' : '') + (s.zh || '').trim();
/**
 * mats：一份材料，或一本书的各章（按顺序）。by：'para' 按段 | 'sent' 按句。
 * 返回 [{chapter?, en, zh, ids:[句子id], missing: 没中文的句数}]；对话（有说话人）每句换行，普通文章同段句子连成一段。
 */
export function groupsOf(mats, by = 'para') {
  const list = Array.isArray(mats) ? mats : [mats]; const out = [];
  for (const m of list) {
    const S = m.sentences || []; const dialog = S.some(s => s.speaker);
    const gs = by === 'sent' ? S.map((_, i) => ({ start: i, end: i })) : paragraphs(m);
    gs.forEach((g, k) => {
      const ss = S.slice(g.start, g.end + 1).filter(s => (s.en || '').trim());
      if (!ss.length) return;
      const sep = dialog ? '\n' : ' ', zsep = dialog ? '\n' : '';
      const zs = dialog ? (ss.some(s => (s.zh || '').trim()) ? ss.map(s => (s.zh || '').trim() ? zline(s) : (s.speaker ? s.speaker + '：' : '') + '—') : []) : ss.map(zline).filter(Boolean); // 对话：逐行对齐，没翻译的行用 — 占位
      out.push({ chapter: list.length > 1 && k === 0 ? m.title : null, en: ss.map(line).join(sep), zh: zs.join(zsep), ids: ss.map(s => s.id), missing: ss.filter(s => !(s.zh || '').trim()).length });
    });
  }
  return out;
}
export const missingCount = groups => groups.reduce((n, g) => n + g.missing, 0);

const escH = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function toText(title, groups) {
  return [title, '='.repeat(Math.min(40, title.length * 2)), '', ...groups.flatMap(g => [...(g.chapter ? ['## ' + g.chapter, ''] : []), g.en, g.zh || '（暂无中文）', ''])].join('\n');
}
/** 独立的 HTML 文件（不依赖网络，可以直接打印 / 存 PDF）。layout：'side' 并排 | 'stack' 上下 */
export function toHtml(title, groups, layout = 'side', when = new Date()) {
  const rows = groups.map(g => (g.chapter ? `<h2>${escH(g.chapter)}</h2>` : '') + (layout === 'side'
    ? `<div class="r"><div class="en">${escH(g.en).replace(/\n/g, '<br>')}</div><div class="zh">${g.zh ? escH(g.zh).replace(/\n/g, '<br>') : '<i>（暂无中文）</i>'}</div></div>`
    : `<div class="s"><div class="en">${escH(g.en).replace(/\n/g, '<br>')}</div><div class="zh">${g.zh ? escH(g.zh).replace(/\n/g, '<br>') : '<i>（暂无中文）</i>'}</div></div>`)).join('\n');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escH(title)} · 双语对照</title>
<style>body{font:16px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#1d2a26;max-width:1000px;margin:24px auto;padding:0 16px}h1{font-size:22px}.meta{color:#6b7a74;font-size:13px}
.r{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:10px 0;border-bottom:1px solid #e3e0d8;break-inside:avoid}.s{padding:10px 0;border-bottom:1px solid #e3e0d8;break-inside:avoid}.s .zh{margin-top:4px}
.en{font-family:Georgia,"Times New Roman",serif}.zh{color:#3b4a44}i{color:#9aa}h2{font-size:18px;margin-top:28px}@media(max-width:600px){.r{grid-template-columns:1fr;gap:4px}}@media print{body{margin:0}}</style></head>
<body><h1>${escH(title)}</h1><p class="meta">双语对照 · ${groups.length} ${layout === 'side' ? '组（左英右中）' : '组（上英下中）'} · 自主学导出 ${when.toLocaleDateString('zh-CN')}</p>
${rows}
</body></html>`;
}
// ———— Word（.docx）：最小 OOXML 包 ————
const escX = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const run = (t, { b = false, color = '', size = 0, font = '' } = {}) => {
  const rpr = `${font ? `<w:rFonts w:ascii="${font}" w:hAnsi="${font}"/>` : ''}${b ? '<w:b/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}${size ? `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` : ''}<w:lang w:val="en-US" w:eastAsia="zh-CN"/>`;
  return String(t).split('\n').map((x, i) => `${i ? '<w:r><w:br/></w:r>' : ''}<w:r><w:rPr>${rpr}</w:rPr><w:t xml:space="preserve">${escX(x)}</w:t></w:r>`).join('');
};
const para = (runs, { after = 120, keep = false, style = '' } = {}) => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${keep ? '<w:keepNext/>' : ''}<w:spacing w:after="${after}"/></w:pPr>${runs}</w:p>`;
const cell = (inner, w) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/></w:tcPr>${inner}</w:tc>`;
export function docxXml(title, groups, layout = 'side') {
  const B = '<w:top w:val="single" w:sz="4" w:color="D9D5CB"/><w:left w:val="single" w:sz="4" w:color="D9D5CB"/><w:bottom w:val="single" w:sz="4" w:color="D9D5CB"/><w:right w:val="single" w:sz="4" w:color="D9D5CB"/><w:insideH w:val="single" w:sz="4" w:color="D9D5CB"/><w:insideV w:val="single" w:sz="4" w:color="D9D5CB"/>';
  let body = para(run(title, { b: true, size: 36 }), { after: 80 }) + para(run(`双语对照 · ${layout === 'side' ? '左英右中' : '上英下中'} · 自主学导出`, { color: '6B7A74', size: 18 }), { after: 240 });
  const zhOf = g => g.zh || '（暂无中文）';
  if (layout === 'side') {
    const rows = []; const flush = () => { if (rows.length) { body += `<w:tbl><w:tblPr><w:tblW w:w="9638" w:type="dxa"/><w:tblBorders>${B}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="4819"/><w:gridCol w:w="4819"/></w:tblGrid>`
      + `<w:tr><w:trPr><w:tblHeader/></w:trPr>${cell(para(run('English', { b: true }), { after: 0 }), 4819)}${cell(para(run('中文', { b: true }), { after: 0 }), 4819)}</w:tr>` + rows.join('') + '</w:tbl>'; rows.length = 0; } };
    for (const g of groups) {
      if (g.chapter) { flush(); body += para(run(g.chapter, { b: true, size: 28 }), { after: 120, keep: true }); }
      rows.push(`<w:tr><w:trPr><w:cantSplit/></w:trPr>${cell(para(run(g.en, { font: 'Georgia' }), { after: 0 }), 4819)}${cell(para(run(zhOf(g), { color: g.zh ? '3B4A44' : '999999' }), { after: 0 }), 4819)}</w:tr>`);
    }
    flush();
  } else for (const g of groups) {
    if (g.chapter) body += para(run(g.chapter, { b: true, size: 28 }), { after: 120, keep: true });
    body += para(run(g.en, { font: 'Georgia' }), { after: 40, keep: true }) + para(run(zhOf(g), { color: g.zh ? '3B4A44' : '999999' }), { after: 200 });
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}
export function toDocx(title, groups, layout = 'side') {
  return makeZip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escX(title)} · 双语对照</dc:title><dc:creator>自主学</dc:creator></cp:coreProperties>` },
    { name: 'word/document.xml', data: docxXml(title, groups, layout) },
  ]);
}
export const safeName = t => String(t || '材料').replace(/[\\/:*?"<>|\n\r]+/g, ' ').trim().slice(0, 60) || '材料';
