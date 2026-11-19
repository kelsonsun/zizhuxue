// v1.8 拍照即查：拍一张 / 选一张图 → 本机识别英文（Tesseract，图片不上传）→ 直接在原图上点词或点句 → 查词、翻译、一键做卡。
import * as imp from '../importers.js';
import * as SN from '../snap.js';
import { parseBilingual } from '../textproc.js';
import { session } from '../state.js';
import { $, $$, esc, go, toast } from '../ui.js';

let last = null; // 本次打开期间最近一张图（返回本页时不必重新识别）

export async function render(root, _a, params) {
  root.innerHTML = `<header class="top"><h1>📷 拍照即查</h1><span class="muted">拍菜单、说明书、路牌、书页……识别后直接点图上的词或句子：查词、翻译、一键做卡</span></header>
  <div class="grid2 snapbtns"><label class="btn primary big" id="snapCamL"><input type="file" id="snapCam" accept="image/*" capture="environment" hidden>📷 拍照</label>
    <label class="btn big" id="snapPickL"><input type="file" id="snapPick" accept="image/*" hidden>🖼 选图</label></div>
  <p class="muted small">🔒 在这台设备上识别英文，图片不会上传。第一次使用要加载约 5MB 的识别组件。只有切到「点句子」翻译时，那一句才会发给翻译服务（用公共翻译前会先问你）。</p>
  <div id="snapSt" class="muted" role="status"></div>
  <div id="snapBody"></div>`;
  const st = $('#snapSt', root), body = $('#snapBody', root);
  const pick = e => { const f = e.target.files[0]; e.target.value = ''; if (f) run(f); };
  $('#snapCam', root).onchange = pick; $('#snapPick', root).onchange = pick;

  async function run(file) {
    if (!/^image\//.test(file.type || 'image/')) return toast('请选一张图片');
    body.innerHTML = ''; st.textContent = '正在准备图片…';
    try {
      const img = await toCanvasBlob(file);
      st.textContent = '正在识别英文…（首次需加载组件）';
      const r = await imp.ocrWords(img.blob, m => { st.textContent = `正在识别：${m.status}${m.progress != null ? ' ' + Math.round(m.progress * 100) + '%' : ''}`; });
      const lay = SN.buildLayout(r.data);
      last = { url: img.url, w: img.w, h: img.h, lay, conf: r.confidence, name: file.name || '' };
      show();
    } catch (err) { console.error(err); st.textContent = '识别失败：' + err.message; }
  }

  function show() {
    const { url, w, h, lay, conf } = last; const words = lay.words.filter(x => x.term);
    if (!words.length) { st.textContent = '图上没有识别出英文。换一张更清楚、更正的照片试试（文字占画面大一些、光线均匀）。'; body.innerHTML = `<img class="snapimg" src="${url}" alt="你选的图片">`; return; }
    st.textContent = `识别出 ${words.length} 个词、${lay.sentences.length} 句（平均置信度约 ${Math.round(conf)}%）。点图上的词查词，切到「点句子」翻译整句。`;
    body.innerHTML = `<div class="seg snapmode" role="tablist"><a role="tab" href="javascript:void 0" id="modeW" class="on">点单词</a><a role="tab" href="javascript:void 0" id="modeS">点句子</a></div>
      <div class="row gap snaptools"><button class="btn" id="snapZoom" aria-pressed="false">🔍 放大图片</button><span class="muted small">字小点不准时放大，左右拖动看</span></div>
      <div class="snapscroll" id="snapScroll"><div class="snapwrap" id="snapWrap" style="aspect-ratio:${w}/${h}"><img class="snapimg" src="${url}" alt="识别的图片（可以直接点上面的英文）" draggable="false">
        <div class="snapov" id="snapOv">${lay.words.map(x => { if (!x.term) return ''; const p = SN.boxPct(x, w, h); return `<button class="snw" data-w="${x.i}" data-s="${x.sent}" style="left:${p.left}%;top:${p.top}%;width:${p.width}%;height:${p.height}%" aria-label="${esc(x.term)}" title="${esc(x.text)}${x.conf < 60 ? '（识别不太确定）' : ''}"></button>`; }).join('')}</div></div></div>
      <div id="snapSel" class="snapsel muted small">还没选：点图上的英文试试</div>
      <div id="snapQ"></div>
      <details class="card snaptext"><summary>识别出的全文（可改错字后导入为材料）</summary><textarea id="snapTxt" rows="7" aria-label="识别出的全文">${esc(lay.text)}</textarea>
        <div class="row gap"><button class="btn" id="snapImp">📥 全文导入为材料（拆句预览）</button><button class="btn" id="snapCopy">复制全文</button></div></details>`;
    let mode = 'w', ctx = null, quick = null;
    import('./quickbox.js').then(async q => { quick = await q.mountQuick($('#snapQ', body), { ctx: () => ctx, hist: false, source: 'snap' }); });
    const setMode = m => { mode = m; $('#modeW', body).classList.toggle('on', m === 'w'); $('#modeS', body).classList.toggle('on', m === 's'); $('#snapOv', body).classList.toggle('sent', m === 's'); };
    $('#snapZoom', body).onclick = e => { const z = $('#snapScroll', body).classList.toggle('zoom'); e.currentTarget.setAttribute('aria-pressed', z); e.currentTarget.textContent = z ? '↩️ 恢复大小' : '🔍 放大图片'; };
    $('#modeW', body).onclick = () => setMode('w'); $('#modeS', body).onclick = () => setMode('s');
    const pickWord = i => {
      const x = lay.words[i]; const s = lay.sentences[x.sent];
      $$('.snw', body).forEach(b => { b.classList.toggle('on', mode === 'w' ? +b.dataset.w === i : +b.dataset.s === x.sent); b.classList.toggle('ctx', mode === 'w' && +b.dataset.s === x.sent && +b.dataset.w !== i); });
      ctx = s ? { en: s.text } : null;
      const q = mode === 'w' ? x.term : s.text;
      $('#snapSel', body).innerHTML = mode === 'w' ? `选中的词：<b>${esc(x.term)}</b>${x.conf < 60 ? ' <span class="tag">识别不太确定，可在下面框里改</span>' : ''}` : `选中的句子：<b>${esc(s.text)}</b>`;
      if (quick) quick.run(q); else setTimeout(() => quick?.run(q), 300);
      $('#snapQ', body).scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    };
    $('#snapOv', body).addEventListener('click', e => {
      const b = e.target.closest('.snw');
      if (b) return pickWord(+b.dataset.w);
      // 点在词框之间：找最近的词（手指点不准时也能选中）
      const r = $('#snapOv', body).getBoundingClientRect(); const i = SN.hitTest(lay.words, w, h, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
      if (i >= 0) pickWord(i);
    });
    $('#snapImp', body).onclick = () => {
      const rows = parseBilingual(imp.unwrapSoft($('#snapTxt', body).value)); if (!rows.length) return toast('没有可用文字');
      session.draft = { title: (last.name || '').replace(/\.[^.]+$/, '') || '拍照识别', tags: [], source: 'ocr', rows: rows.map(r => ({ speaker: r.speaker || '', en: r.en || '', zh: r.zh || '', t0: null, t1: null })), editId: null, audioId: null };
      go('#/draft');
    };
    $('#snapCopy', body).onclick = async () => { try { await navigator.clipboard.writeText($('#snapTxt', body).value); toast('已复制'); } catch { toast('复制失败，请长按文字手动复制'); } };
  }

  if (session.snapFile) { const f = session.snapFile; session.snapFile = null; run(f); }
  else if (last && params.keep !== '0') show();
}

/** 读图 → 缩到最长边 ≤2000 像素（识别更快、手机不爆内存）→ JPEG。返回 {blob, url, w, h} */
async function toCanvasBlob(file) {
  const url0 = URL.createObjectURL(file);
  try {
    const im = new Image(); im.decoding = 'async'; im.src = url0;
    await im.decode().catch(() => { throw new Error('这张图片打不开（格式不支持？换成 JPG/PNG 试试）'); });
    const { w, h } = SN.fitSize(im.naturalWidth, im.naturalHeight, 2000);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(im, 0, 0, w, h);
    const blob = await new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('图片处理失败')), 'image/jpeg', 0.92));
    if (last?.url) URL.revokeObjectURL(last.url);
    return { blob, url: URL.createObjectURL(blob), w, h };
  } finally { URL.revokeObjectURL(url0); }
}
