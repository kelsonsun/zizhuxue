import * as ai from '../ai.js';
import * as imp from '../importers.js';
import { parseBilingual, parseSubtitles } from '../textproc.js';
import { session, aiBtn } from '../state.js';
import * as db from '../db.js';
import * as pb from '../pdfbook.js';
import { $, $$, esc, go, toast, confirmDlg } from '../ui.js';

const MODES = [['paste', '粘贴'], ['file', '文件'], ['ocr', '截图'], ['ai', '情景'], ['audio', '录音/视频']];
const EXAMPLE = `Doctor: Where does it hurt today?
医生：你今天哪里不舒服？
Patient: My neck and shoulder hurt, especially when I turn my head.
患者：我脖子和肩膀疼，尤其是转头的时候。
Doctor: When did the pain start?
医生：疼痛是什么时候开始的？
Patient: About three days ago, after I slept in a bad position.
患者：大概三天前，我睡姿不对之后开始的。`;

function toDraft(rows, extra = {}) {
  session.draft = { title: extra.title || '', tags: extra.tags || [], source: extra.source || 'paste', rows: rows.map(r => ({ speaker: r.speaker || '', en: r.en || '', zh: r.zh || '', t0: r.t0 ?? null, t1: r.t1 ?? null })), editId: null, audioId: extra.audioId || null };
  go('#/draft');
}

export async function render(root, _a, params) {
  const mode = MODES.some(m => m[0] === params.m) ? params.m : 'paste';
  root.innerHTML = `
  <header class="top"><h1>导入素材</h1><span class="muted">你遇到的、想学的内容，都可以直接放进来</span></header>
  <div class="seg" role="tablist">${MODES.map(([k, t]) => `<a role="tab" class="${k === mode ? 'on' : ''}" href="#/import?m=${k}">${t}</a>`).join('')}</div>
  <div id="panel"></div>`;
  const p = $('#panel', root);
  if (mode === 'paste') {
    p.innerHTML = `<p class="muted">支持：每行「中文 | English」、中英文交替两行、纯英文段落、带「Doctor:」说话人的对话。会自动拆句并配对，下一步可逐句修改。</p>
      <textarea id="txt" rows="9" placeholder="把英文或中英双语对话粘贴到这里……" aria-label="粘贴内容"></textarea>
      <div class="row gap"><button class="btn primary grow" id="go">拆句预览</button><button class="btn" id="ex">填入示例</button></div>
      <p class="muted small">🔒 若内容涉及他人隐私（姓名、电话、病历），建议先去掉再导入。</p>`;
    $('#ex', p).onclick = () => { $('#txt', p).value = EXAMPLE; };
    if (session.pendingText) { $('#txt', p).value = session.pendingText; session.pendingText = null; } // v1.8 分享进来的文字
    $('#go', p).onclick = () => {
      const rows = parseBilingual($('#txt', p).value); if (!rows.length) return toast('请先粘贴内容');
      toDraft(rows, { source: 'paste' });
    };
  } else if (mode === 'file') {
    p.innerHTML = `<p class="muted">字幕（srt/vtt，中英双语字幕会自动配对）、txt、Word（docx）、PDF。文件只在本机读取。</p>
      <label class="drop"><input type="file" id="file" accept=".srt,.vtt,.txt,.md,.docx,.pdf" hidden><b>点这里选择文件</b><span class="muted">srt · vtt · txt · docx · pdf</span></label><div id="st" class="muted" role="status"></div>`;
    const handle = async f => {
      $('#st', p).textContent = '正在读取 ' + f.name + ' …';
      try {
        if (imp.extOf(f.name) === 'pdf') return await bookFlow(p, f, toDraft);
        const r = await imp.readFileAsText(f);
        const title = f.name.replace(/\.[^.]+$/, '');
        const rows = r.kind === 'subtitle' ? parseSubtitles(r.text) : parseBilingual(r.text);
        if (!rows.length) throw new Error('没有识别出句子，请检查文件内容');
        toDraft(rows, { title, source: r.kind === 'subtitle' ? 'subtitle' : imp.extOf(f.name) });
      } catch (err) { $('#st', p).textContent = '读取失败：' + err.message; }
    };
    $('#file', p).onchange = e => { const f = e.target.files[0]; if (f) handle(f); };
    if (session.pendingFile) { const f = session.pendingFile; session.pendingFile = null; handle(f); } // v1.8 从「分享到自主学」进来的文件
  } else if (mode === 'ocr') {
    p.innerHTML = `<p class="muted">选一张含英文的截图或照片，用手机上的「本地英文识别」读出文字（图片不会上传）。第一次使用需要加载约 5MB 的识别组件。</p>
      <a class="note small snaplink" href="#/snap">想直接在图上点词查、翻译、做卡？试试 <b>📷 拍照即查</b></a>
      <label class="drop"><input type="file" id="img" accept="image/*" hidden><b>点这里选择截图 / 拍照</b><span class="muted">png · jpg · heic（视浏览器而定）</span></label>
      <div id="st" class="muted" role="status"></div>
      <textarea id="ocrtxt" rows="8" class="hidden" placeholder="识别结果会出现在这里，可以直接修改" aria-label="识别结果"></textarea>
      <div class="row gap hidden" id="ocract"><button class="btn primary grow" id="go">拆句预览</button></div>`;
    const handleImg = async f => {
      const st = $('#st', p); st.textContent = '正在识别…（首次需加载组件）';
      try {
        const r = await imp.ocrImage(f, m => { st.textContent = `${m.status}${m.progress != null ? ' ' + Math.round(m.progress * 100) + '%' : ''}`; });
        $('#ocrtxt', p).value = imp.unwrapSoft(r.text); $('#ocrtxt', p).classList.remove('hidden'); $('#ocract', p).classList.remove('hidden');
        st.textContent = `识别完成（平均置信度约 ${Math.round(r.confidence)}%）。请核对并修改错字，再点「拆句预览」。`;
      } catch (err) { st.textContent = '识别失败：' + err.message; }
    };
    $('#img', p).onchange = e => { const f = e.target.files[0]; if (f) handleImg(f); };
    if (session.pendingFile) { const f = session.pendingFile; session.pendingFile = null; handleImg(f); }
    $('#go', p).onclick = () => { const rows = parseBilingual($('#ocrtxt', p).value); if (!rows.length) return toast('没有可用文字'); toDraft(rows, { source: 'ocr' }); };
  } else if (mode === 'ai') {
    p.innerHTML = `<p class="muted">用中文描述你实际遇到或即将遇到的情景，AI 会生成贴合的英文对话和中文翻译（生成后可逐句修改）。</p>
      <textarea id="desc" rows="5" placeholder="例如：我在休斯顿做理疗，想跟第一次来的客人说清楚疼痛位置和治疗流程。" aria-label="情景描述"></textarea>
      <div class="row gap">${aiBtn('aiScene', '生成英文情景对话', 'primary grow')}</div><div id="st" class="muted" role="status"></div>
      <p class="muted small">使用时，你的描述会发送到你在「我的」里配置的 AI 服务。</p>`;
    $('#aiScene', p).onclick = async () => {
      const desc = $('#desc', p).value.trim(); if (!desc) return toast('请先写一下情景');
      const st = $('#st', p), b = $('#aiScene', p); b.disabled = true; st.textContent = '正在生成…';
      try { const r = await ai.generateScene(desc); toDraft(r.sentences, { title: r.title, tags: r.tags, source: 'ai' }); }
      catch (err) { st.textContent = '没有生成成功：' + err.message; b.disabled = false; }
    };
  } else if (mode === 'audio') audioPanel(p);
}

/** 录音 / 视频：现场录音或选文件 → 读出声音 → 保存原声 → 自动转写（#/asr/id） */
function audioPanel(p) {
  p.innerHTML = `<p class="muted">用身边真实的英语声音来学：现场录一段，或选手机里的录音、视频。软件自动转成文字，生成句子、生词和练习，每句都能回放原声跟读。</p>
    <div class="grid2 audbtns"><button class="btn primary big" id="recBtn">🎙 现场录音</button>
      <label class="btn big" id="pickBtn"><input type="file" id="aud" accept="audio/*,video/*,.mp3,.m4a,.aac,.wav,.ogg,.opus,.webm,.mp4,.mov,.m4v,.3gp,.amr" hidden>📁 选择录音/视频</label></div>
    <div id="recbox"></div><div id="st" role="status"></div>
    <ul class="muted small tips"><li>手机相册里的视频：点「选择录音/视频」→「照片图库」（安卓选「相册」或「图库」）。</li>
      <li>苹果「语音备忘录」的录音：在语音备忘录里点这条录音 →「…」→「分享」→「存储到“文件”」，再回来点「选择录音/视频」→「浏览」选它。</li></ul>`;
  $('#aud', p).onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) takeAudio(p, f, f.name); };
  $('#recBtn', p).onclick = () => recordFlow(p);
  if (session.pendingFile) { const f = session.pendingFile; session.pendingFile = null; takeAudio(p, f, f.name); } // v1.8 分享进来的录音 / 视频
}
const fmtClk = s => { s = Math.floor(s); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
async function recordFlow(p) {
  const box = $('#recbox', p), btn = $('#recBtn', p); const rec = await import('../recorder.js');
  btn.disabled = true; box.innerHTML = '<div class="card recbox"><p class="muted">正在打开麦克风…（第一次会请求「麦克风」权限，请点「允许」）</p></div>';
  let r;
  try { r = await rec.start({ onTick: ({ sec, level, state }) => { const t = $('#rtime', box); if (!t) return; t.textContent = fmtClk(sec); $('#rlvl', box).style.width = Math.round(Math.min(1, level * 2.2) * 100) + '%'; box.querySelector('.recbox').classList.toggle('paused', state === 'paused'); if (sec >= 3600 && state === 'recording') { r.pause(); toast('已录满 60 分钟，自动暂停。建议分段录。', 6000); } } }); }
  catch (e) { btn.disabled = false; box.innerHTML = `<div class="note err" id="micErr">🎙 ${esc(e.message)}</div>`; return; }
  box.innerHTML = `<div class="card recbox"><div class="rechead"><span class="rdot"></span><b id="rtime" class="rtime">00:00</b><span class="muted small" id="rstate">录音中</span></div>
    <div class="rlvl" aria-hidden="true"><i id="rlvl"></i></div>
    <div class="row gap"><button class="btn" id="rPause">⏸ 暂停</button><button class="btn primary grow" id="rStop">■ 完成</button><button class="btn" id="rCancel">取消</button></div>
    <p class="muted small">点「完成」后自动转成文字。录音时请保持屏幕亮着、不要切到别的 App（iPhone 锁屏或切走会中断录音）。录音只存在这台设备上。</p></div>`;
  $('#rPause', box).onclick = e => { const b = e.currentTarget; if (r.state() === 'recording') { r.pause(); b.textContent = '▶ 继续'; $('#rstate', box).textContent = '已暂停'; } else { r.resume(); b.textContent = '⏸ 暂停'; $('#rstate', box).textContent = '录音中'; } };
  $('#rCancel', box).onclick = () => { r.cancel(); box.innerHTML = ''; btn.disabled = false; toast('已取消录音'); };
  $('#rStop', box).onclick = async e => {
    e.currentTarget.disabled = true; const out = await r.stop(); btn.disabled = false; box.innerHTML = '';
    if (out.sec < 1 || !out.blob.size) return toast('录音太短了，再录一次吧');
    const d = new Date(); const name = `现场录音 ${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const rm = await import('../recorder.js');
    takeAudio(p, new File([out.blob], name + '.' + rm.extOf(out.mime), { type: out.mime }), name, { recorded: true });
  };
}
/** 读出声音（视频也只取声音）→ 存原声 → 去转写页 */
async function takeAudio(p, file, name, { recorded = false } = {}) {
  const T = await import('../transcribe.js'); const X = await import('../extract.js'); const st = $('#st', p);
  const kind = await X.sniff(file); // 按文件内容判断（相册给的文件常常没有类型，或扩展名是大写 .MOV）
  let isVideo = /^video\//.test(file.type) || /\.(mp4|mov|m4v|3gp|3g2|qt)$/i.test(file.name);
  const mb = file.size / 1e6;
  // MP4/MOV/3GP 只取声音轨、分批读，几百 MB 的视频也不占多少内存；其他格式要整段读进内存，才提醒
  if (kind !== 'isobmff' && mb > T.LIMITS.fileMB && !await confirmDlg(`这个文件有 ${Math.round(mb)} MB，超过建议的 ${T.LIMITS.fileMB} MB：手机可能内存不够，读取中途退出。建议先剪短（只留要学的部分）。仍然继续吗？`, { ok: '继续' })) return;
  const { readWithUi } = await import('./audioread.js');
  const r = await readWithUi(st, file, { name: file.name, isVideo });
  if (!r) return;
  const pcm = r.pcm; if (r.info?.hasVideo != null) isVideo = r.info.hasVideo;
  const id = db.newId();
  // 视频只保留声音（16kHz 单声道 WAV，约 1.9 MB/分钟），不把几百 MB 的视频塞进本机数据库
  // 只有浏览器能直接播放的录音才存原文件（回放「原声」要用）；AMR 等用自带解码器读出的，也存成 WAV
  const playable = r.info?.method === 'decode' || (r.info?.method === 'demux' && /AAC|MP3/.test(r.info.used || ''));
  const blob = isVideo || !playable ? T.encodeWav(pcm) : file;
  try { await db.blobs.set('audio:' + id, blob); }
  catch (e) { st.innerHTML = `<div class="note err">保存录音失败：${esc(e?.message || e?.name || '浏览器不让存')}（可能是手机存储空间不够）</div>`; return; }
  const m = { id, title: name.replace(/\.[^.]+$/, ''), tags: [recorded ? '现场录音' : isVideo ? '视频' : '录音'], source: 'audio', audioName: file.name, duration: +(pcm.length / T.SR).toFixed(1), fromVideo: isVideo || undefined, audioVia: [r.info?.method, r.info?.used].filter(Boolean).join(' ') || undefined, sentences: [] };
  await db.materials.save(m); session.asr = { id, pcm }; go('#/asr/' + id);
}

const fmtT = ms => ms < 90000 ? Math.round(ms / 1000) + ' 秒' : Math.round(ms / 60000) + ' 分钟';
/** PDF：整本书导入（目录/章节标题/页数切章），也适用于短 PDF。 */
async function bookFlow(p, file, toDraft) {
  let cancel = false; const t0 = Date.now();
  p.innerHTML = `<div class="card" id="bk"><h3>正在读取《${esc(file.name)}》</h3><div class="bar"><i id="bkbar" style="width:0%"></i></div><div id="bkmsg" role="status" class="muted">打开 PDF…</div>
    <div class="muted small">本地解析，不上传。大文件分页处理，可以放着等；扫描版（没有文字层）的页会自动用本地 OCR 识别，每页要几秒到十几秒，会慢很多。</div>
    <button class="btn" id="bkcancel">取消</button></div>`;
  $('#bkcancel', p).onclick = () => { cancel = true; };
  const msg = t => { const m = $('#bkmsg', p); if (m) m.textContent = t; };
  let pdf, pages, outline;
  try {
    pdf = await pb.openPdf(file); outline = await pb.readOutline(pdf);
    msg(`共 ${pdf.numPages} 页，PDF 目录 ${outline.length} 项。开始抽取文字…`);
    pages = await pb.extractPages(pdf, { cancelled: () => cancel, onProgress: ({ n, total, phase, ocrCount }) => {
      $('#bkbar', p).style.width = Math.round(100 * n / total) + '%';
      msg(phase === 'ocr' ? `第 ${n}/${total} 页没有文字层，正在 OCR（较慢）… 已 OCR ${ocrCount} 页` : `第 ${n}/${total} 页 · 已用 ${fmtT(Date.now() - t0)}${ocrCount ? ` · OCR ${ocrCount} 页` : ''}`);
    } });
  } catch (e) { p.innerHTML = `<div class="note">${cancel ? '已取消。' : '读取失败：' + esc(e.message)}</div><a class="btn" href="#/import?m=file">重新选择</a>`; return; }
  const { method, chapters } = pb.splitChapters(pages, outline);
  const chs = chapters.map(c => ({ ...c, sentences: pb.parasToSentences(c.paras) })).filter(c => c.sentences.length);
  const scanned = pages.filter(x => x.scanned).length;
  if (!chs.length) { p.innerHTML = `<div class="note">没有提取到文字。${scanned ? '' : '这个 PDF 可能是图片扫描件；'}请改用「截图」识别。</div><a class="btn" href="#/import?m=file">重新选择</a>`; return; }
  const title0 = (pdf.title || file.name.replace(/\.pdf$/i, '')).trim();
  if (pdf.numPages <= 12 && chs.length <= 1) return toDraft(chs[0].sentences, { title: title0, source: 'pdf' });
  const total = chs.reduce((a, c) => a + c.sentences.length, 0);
  const METHOD = { outline: '按 PDF 目录切章', headings: '没有目录，按章节标题（Chapter …）切章', pages: '没有目录和章节标题，按每 10 页切段' }[method];
  p.innerHTML = `<div class="card"><h3>读完了：${pdf.numPages} 页 · ${chs.length} 章 · ${total} 句 · 用时 ${fmtT(Date.now() - t0)}</h3>
    <p class="small">${esc(METHOD)}。可以改书名、改章名、取消不要的章。</p>${scanned ? `<div class="note">其中 ${scanned} 页是扫描页，已用本地 OCR 识别：速度较慢，识别结果可能有错字，学习时可在「编辑句子」里修改。</div>` : ''}
    <div class="field"><label for="bt">书名</label><input id="bt" value="${esc(title0)}"></div>
    <div class="list chlist">${chs.map((c, i) => `<label class="item chrow"><span class="row gap"><input type="checkbox" data-i="${i}" checked><input class="grow" data-t="${i}" value="${esc(c.title)}" aria-label="第${i + 1}章名"></span><span class="muted small">第 ${c.from}–${c.to} 页 · ${c.sentences.length} 句</span></label>`).join('')}</div>
    <div class="row gap"><button class="btn primary grow" id="bkgo">导入整本书（<span id="bkn">${chs.length}</span> 章）</button></div><div id="bkst" class="muted small" role="status"></div></div>`;
  const upd = () => { $('#bkn', p).textContent = $$('input[data-i]:checked', p).length; };
  $$('input[data-i]', p).forEach(c => c.onchange = upd);
  $('#bkgo', p).onclick = async (e) => {
    e.currentTarget.disabled = true; const pick = $$('input[data-i]:checked', p).map(x => +x.dataset.i); if (!pick.length) { e.currentTarget.disabled = false; return toast('至少选一章'); }
    const book = { id: db.newId(), kind: 'book', title: $('#bt', p).value.trim() || title0, tags: ['书'], source: 'pdf', method, pages: pdf.numPages, sentences: [], chapters: [], progress: {} };
    let k = 0;
    for (const i of pick) {
      const c = chs[i]; k++; $('#bkst', p).textContent = `保存第 ${k}/${pick.length} 章…`;
      const ch = { id: db.newId(), title: ($(`input[data-t="${i}"]`, p).value.trim() || c.title), tags: ['书'], source: 'pdf', bookId: book.id, chapterNo: k, pageRange: `第 ${c.from}–${c.to} 页`, sentences: c.sentences.map(s => ({ id: db.newId(), ...s })), progress: { done: {}, last: null, quiz: {} } };
      await db.materials.save(ch); book.chapters.push(ch.id);
      if (k % 5 === 0) await new Promise(r => setTimeout(r, 0));
    }
    await db.materials.save(book); toast(`已导入《${book.title}》${pick.length} 章`); go('#/book/' + book.id);
  };
}
