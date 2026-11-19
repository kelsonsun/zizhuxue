// v1.8 双语对照视图（#/bilingual/<材料或书 id>）：原文和译文逐段（或逐句）并排 / 上下对照；导出 Word、网页、文本，或打印 / 存 PDF。
import * as db from '../db.js';
import * as BI from '../bilingual.js';
import { settings, saveSettings } from '../state.js';
import { $, $$, esc, toast, download } from '../ui.js';

export async function render(root, [id], params) {
  const m = await db.materials.get(id);
  if (!m) { root.innerHTML = '<div class="empty"><p>找不到这份材料。</p><a class="btn" href="#/library">回材料库</a></div>'; return; }
  const chapters = m.kind === 'book' ? (await Promise.all((m.chapters || []).map(c => db.materials.get(c)))).filter(Boolean) : [m];
  const back = m.kind === 'book' ? '#/book/' + m.id : '#/lesson/' + m.id;
  let layout = params.v || settings.biLayout || (innerWidth >= 700 ? 'side' : 'stack'), by = params.g || settings.biBy || 'para';
  const draw = () => {
    const groups = BI.groupsOf(chapters, by); const miss = BI.missingCount(groups);
    root.innerHTML = `<header class="top noprint"><a class="back" href="${back}" aria-label="返回">‹</a><h1>📑 双语对照</h1><span class="muted">${esc(m.title)} · ${groups.length} ${by === 'para' ? '段' : '句'}</span></header>
    <h1 class="printonly">${esc(m.title)}</h1>
    <div class="bictl noprint"><div class="seg" role="tablist" aria-label="排版"><a role="tab" href="javascript:void 0" id="biSide" class="${layout === 'side' ? 'on' : ''}">左右并排</a><a role="tab" href="javascript:void 0" id="biStack" class="${layout === 'stack' ? 'on' : ''}">上下对照</a></div>
      <div class="seg" role="tablist" aria-label="对照单位"><a role="tab" href="javascript:void 0" id="biPara" class="${by === 'para' ? 'on' : ''}">按段</a><a role="tab" href="javascript:void 0" id="biSent" class="${by === 'sent' ? 'on' : ''}">按句</a></div></div>
    ${miss ? `<div class="note small noprint" id="biMiss">有 ${miss} 句还没有中文翻译（显示为“暂无中文”）。<button class="btn" id="biTr">🌐 配上翻译</button></div>` : ''}
    <div class="bi ${layout}" id="biBody">${layout === 'side' ? '<div class="bihead"><b>English</b><b>中文</b></div>' : ''}${groups.map((g, i) => `${g.chapter ? `<h2 class="bich">${esc(g.chapter)}</h2>` : ''}<div class="birow" data-i="${i}"><div class="bien" lang="en">${esc(g.en).replace(/\n/g, '<br>')}</div><div class="bizh" lang="zh-CN">${g.zh ? esc(g.zh).replace(/\n/g, '<br>') : '<i class="muted">（暂无中文）</i>'}</div></div>`).join('') || '<p class="muted">这份材料还没有句子。</p>'}</div>
    <h2 class="noprint">导出</h2><div class="grid2 noprint biexp"><button class="btn primary" id="biDocx">📄 Word（.docx）</button><button class="btn" id="biHtml">🌐 网页（.html）</button><button class="btn" id="biTxt">📝 文本（.txt）</button><button class="btn" id="biPrint">🖨 打印 / 存 PDF</button><button class="btn" id="biCopy">📋 复制全文</button></div>
    <p class="muted small noprint">导出的是当前的排版（${layout === 'side' ? '左右并排' : '上下对照'}、${by === 'para' ? '按段' : '按句'}）。文件只在本机生成。</p>`;
    const set = (k, v) => { if (k === 'layout') layout = v; else by = v; saveSettings(k === 'layout' ? { biLayout: v } : { biBy: v }); draw(); };
    $('#biSide', root).onclick = () => set('layout', 'side'); $('#biStack', root).onclick = () => set('layout', 'stack');
    $('#biPara', root).onclick = () => set('by', 'para'); $('#biSent', root).onclick = () => set('by', 'sent');
    $('#biTr', root)?.addEventListener('click', async () => (await import('../transui.js')).openTranslate({ ids: chapters.map(c => c.id), title: m.title, onDone: async () => { const fresh = await Promise.all(chapters.map(c => db.materials.get(c.id))); chapters.splice(0, chapters.length, ...fresh.filter(Boolean)); draw(); } }));
    const name = `${BI.safeName(m.title)}-双语对照`;
    $('#biDocx', root).onclick = () => save(name + '.docx', BI.toDocx(m.title, groups, layout), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    $('#biHtml', root).onclick = () => save(name + '.html', BI.toHtml(m.title, groups, layout), 'text/html;charset=utf-8');
    $('#biTxt', root).onclick = () => save(name + '.txt', BI.toText(m.title, groups), 'text/plain;charset=utf-8');
    $('#biPrint', root).onclick = () => window.print();
    $('#biCopy', root).onclick = async () => { try { await navigator.clipboard.writeText(BI.toText(m.title, groups)); toast('已复制全文（英文一段、中文一段）'); } catch { toast('复制失败'); } };
  };
  draw();
}
async function save(name, data, type) {
  // 安卓 App 存到「下载」时 download 自己会提示
  try { const r = await download(name, data, type); if (!r) toast('已导出：' + name); } catch (e) { toast('导出失败：' + e.message, 5000); }
}
