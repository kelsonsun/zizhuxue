// v1.8 收到分享（#/shared）：从别的 App 分享过来的文字 / 链接 / 图片 / 文件，在这里选怎么用。
import * as SH from '../share.js';
import { session } from '../state.js';
import { $, $$, esc, go, toast } from '../ui.js';

const size = n => n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB';
export async function render(root, _a, params) {
  root.innerHTML = `<header class="top"><h1>📥 收到分享</h1><span class="muted">从别的 App 分享给「自主学」的内容，选一种用法</span></header><div id="shBody"><p class="muted">正在读取…</p></div>`;
  const body = $('#shBody', root);
  const item = await SH.take().catch(() => null);
  if (!item) {
    body.innerHTML = `${params.err ? `<div class="note err small">没收到分享内容：${esc(params.err)}</div>` : ''}<div class="card"><b>现在没有待处理的分享。</b>
      <p class="muted small">怎么分享到自主学：</p><ul class="muted small tips">
        <li><b>安卓 App（APK）</b>：在浏览器、微信、相册、文件等 App 里点「分享」→ 选「自主学」。文字、链接、图片、文件都行。</li>
        <li><b>安卓 Chrome 装到主屏的网页版</b>：同上（Chrome 会把装好的网页应用放进分享菜单）。</li>
        <li><b>iPhone</b>：苹果不允许网页应用出现在分享菜单里。可以复制文字后到「导入 → 粘贴」，图片用「📷 拍照即查」选图，文件用「导入 → 文件」。</li>
        <li><b>电脑</b>：直接把文件拖到「导入 → 文件」，或复制粘贴。</li></ul></div>`;
    return;
  }
  const tk = SH.textKind(item); const parts = [];
  if (tk.kind === 'link') parts.push(`<div class="card shitem" data-kind="link"><b>🔗 链接</b><div class="shlink"><a href="${esc(tk.url)}" target="_blank" rel="noopener">${esc(tk.url)}</a></div>${tk.text ? `<div class="muted small">${esc(tk.text)}</div>` : ''}
    <p class="muted small">自主学不会替你去抓网页内容（网页版没有服务器，抓别人的网页会被浏览器拦住）。打开网页，选中想学的英文复制，再回来粘贴导入。</p>
    <div class="row gap wrap"><a class="btn primary" href="${esc(tk.url)}" target="_blank" rel="noopener" id="shOpen">打开网页</a><button class="btn" id="shPaste">📋 粘贴导入</button>${tk.text ? '<button class="btn" id="shLook">🔎 查词翻译这段文字</button>' : ''}</div></div>`);
  else if (tk.kind === 'lookup') parts.push(`<div class="card shitem" data-kind="lookup"><b>✍️ 文字</b><div class="shtext">${esc(tk.text)}</div><div class="row gap wrap"><button class="btn primary" id="shLook">🔎 查词 / 翻译</button><button class="btn" id="shImp">📥 导入为材料</button></div></div>`);
  else if (tk.kind === 'material') parts.push(`<div class="card shitem" data-kind="material"><b>✍️ 文字（${tk.text.length} 字）</b><div class="shtext clamp">${esc(tk.text)}</div><div class="row gap wrap"><button class="btn primary" id="shImp">📥 导入为材料（拆句预览）</button><button class="btn" id="shLook">🔎 翻译这段</button></div></div>`);
  item.files.forEach((f, i) => {
    const k = SH.fileKind(f);
    parts.push(`<div class="card shitem" data-kind="${k}"><b>${{ image: '🖼 图片', doc: '📄 文件', audio: '🎧 录音 / 视频', other: '📎 文件' }[k]}</b> <span class="muted small">${esc(f.name)} · ${size(f.size)}</span>
      ${k === 'image' ? `<img class="shimg" src="${URL.createObjectURL(f)}" alt="分享来的图片">` : ''}
      <div class="row gap wrap">${k === 'image' ? `<button class="btn primary" data-snap="${i}">📷 拍照即查（点图上的词）</button><button class="btn" data-ocr="${i}">整张识别导入为材料</button>`
        : k === 'doc' ? `<button class="btn primary" data-doc="${i}">📥 导入为材料</button>` : k === 'audio' ? `<button class="btn primary" data-aud="${i}">🎧 转写成材料</button>` : '<span class="muted small">这种文件自主学用不了（支持：图片、txt / srt / vtt / docx / pdf、录音和视频）。</span>'}</div></div>`);
  });
  if (item.skipped?.length) parts.push(`<div class="note small">有 ${item.skipped.length} 个文件太大没收下：${esc(item.skipped.join('、'))}</div>`);
  body.innerHTML = (parts.join('') || '<p class="muted">分享的内容是空的。</p>') + '<button class="btn" id="shClear">🗑 丢掉这次分享</button>';
  const done = () => SH.clear().catch(() => { });
  $('#shLook', body)?.addEventListener('click', async () => { session.quickQ = tk.text; await done(); go('#/'); });
  $('#shImp', body)?.addEventListener('click', async () => { session.pendingText = tk.text; await done(); go('#/import?m=paste'); });
  $('#shPaste', body)?.addEventListener('click', async () => { await done(); go('#/import?m=paste'); });
  $$('[data-snap]', body).forEach(b => b.onclick = async () => { session.snapFile = item.files[+b.dataset.snap]; await done(); go('#/snap'); });
  $$('[data-ocr]', body).forEach(b => b.onclick = async () => { session.pendingFile = item.files[+b.dataset.ocr]; await done(); go('#/import?m=ocr'); });
  $$('[data-doc]', body).forEach(b => b.onclick = async () => { session.pendingFile = item.files[+b.dataset.doc]; await done(); go('#/import?m=file'); });
  $$('[data-aud]', body).forEach(b => b.onclick = async () => { session.pendingFile = item.files[+b.dataset.aud]; await done(); go('#/import?m=audio'); });
  $('#shClear', body).onclick = async () => { await done(); toast('已丢掉'); go('#/'); };
}
