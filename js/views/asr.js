// 自动转写页：#/asr/<材料id>。选引擎（AI 接口 / 本机免费）→ 显示模型大小、建议上限、预计用时 → 转写（进度 + 剩余时间 + 可取消）→ 核对修改（#/draft）。
import * as db from '../db.js';
import * as ai from '../ai.js';
import * as T from '../transcribe.js';
import { session } from '../state.js';
import { $, $$, esc, go, toast } from '../ui.js';
import { onLeave } from '../app.js';

const PREF = 'zzx.asr.model';
export async function render(root, [id]) {
  const m = await db.materials.get(id); const b = await db.blobs.get('audio:' + id).catch(() => null);
  if (!m || !b) { root.innerHTML = `<div class="empty"><p>找不到这段录音。</p><a class="btn" href="#/import?m=audio">去导入</a></div>`; return; }
  const url = URL.createObjectURL(b.blob); let ac = null;
  onLeave(() => { ac?.abort(); URL.revokeObjectURL(url); });
  root.innerHTML = `<header class="top"><a class="back" href="#/lesson/${esc(id)}" aria-label="返回">‹</a><h1>自动转写</h1><span class="muted">${esc(m.title)}</span></header>
    <audio controls src="${url}" preload="metadata" class="asrau"></audio><div id="asr"><div class="card"><p>正在读取声音…</p></div></div>`;
  const box = $('#asr', root);
  let pcm = session.asr?.id === id ? session.asr.pcm : null;
  if (!pcm) { try { pcm = await T.decodeToPcm(b.blob); session.asr = { id, pcm }; } catch (e) { box.innerHTML = `<div class="note err">${esc(e.message)}</div><a class="btn" href="#/lesson/${esc(id)}">‹ 回到材料</a>`; return; } }
  const dur = pcm.length / T.SR, size = b.blob.size;
  const hasAi = ai.isConfigured();
  let engine = hasAi ? 'api' : 'local', mk = T.LOCAL_MODELS[localStorage.getItem(PREF)] ? localStorage.getItem(PREF) : T.DEFAULT_LOCAL;
  const cached = { fast: await T.isCached('fast'), accurate: await T.isCached('accurate') };
  const durTxt = `${dur < 60 ? Math.round(dur) + ' 秒' : (dur / 60).toFixed(dur < 1200 ? 1 : 0) + ' 分钟'}`;

  const choose = (err = '') => {
    const e = T.estimateLocal(mk, dur, m.fromVideo ? 0 : size); const M = T.LOCAL_MODELS[mk];
    const apiChunks = T.planChunks(pcm, T.apiHasSegments(T.apiModel()) ? T.LIMITS.apiChunkSec : 30, T.apiHasSegments(T.apiModel()) ? T.LIMITS.apiChunkSec - 30 : 20).length;
    box.innerHTML = `${err ? `<div class="note err" id="asrErr">${esc(err)}</div>` : ''}
    <section class="card">
      <h3>这段声音：${fmtLen(dur)}${m.fromVideo ? '（从视频里取出的声音）' : ` · 文件 ${T.fmtMB(size)}`}</h3>
      ${hasAi ? `<div class="engines" role="radiogroup" aria-label="转写方式">
        <label class="opt ${engine === 'api' ? 'on' : ''}"><input type="radio" name="eng" value="api" ${engine === 'api' ? 'checked' : ''}><span><b>AI 转写</b>（推荐，快、准，中英文都能识别）<br><span class="muted small">用你在「我的」配置的接口 · 模型 ${esc(T.apiModel())} · 声音会上传到该服务，按它的价格计费</span></span></label>
        <label class="opt ${engine === 'local' ? 'on' : ''}"><input type="radio" name="eng" value="local" ${engine === 'local' ? 'checked' : ''}><span><b>本机免费转写</b><br><span class="muted small">不上传、不花钱；只识别英语，速度看手机性能</span></span></label></div>` : ''}
      ${engine === 'local' ? `
        ${hasAi ? '' : '<p><b>本机免费转写</b>：不上传、不花钱，只识别英语。<span class="muted small">（在「我的」填了 AI 密钥，还可用更快更准的 AI 转写）</span></p>'}
        <div class="models" role="radiogroup" aria-label="本机模型">${Object.values(T.LOCAL_MODELS).map(x => `
          <label class="opt ${mk === x.key ? 'on' : ''}"><input type="radio" name="mk" value="${x.key}" ${mk === x.key ? 'checked' : ''}><span><b>${x.label}</b> <span class="muted small">${x.model}</span> ${cached[x.key] ? '<span class="tag okt">已下载</span>' : `<span class="tag">首次需下载约 ${x.mb} MB</span>`}<br>
            <span class="muted small">${x.key === 'fast' ? '速度快，日常对话够用' : '错字更少，速度约慢一半'} · 建议 ≤ ${T.LIMITS.localMin[x.key]} 分钟</span></span></label>`).join('')}</div>
        <div class="est" id="est"><b>约 ${durTxt}音频，预计需${T.fmtDur(e.sec)}</b>${cached[mk] ? '' : `，另需先下载约 ${M.mb} MB（只需一次，建议连 Wi‑Fi）`}
          <div class="muted small">${e.measured ? `按这台设备上次实测速度（每 1 分钟音频约需 ${Math.round(e.rtf * 60)} 秒）。` : `首次按估算（${T.isMobile() ? '手机' : '电脑'}每 1 分钟音频约需 ${Math.round(e.rtf * 60)} 秒），开始后按这台设备的实际速度更新。`}</div></div>
        ${e.overTime || e.overSize ? `<div class="note" id="over">⚠ 这个文件${e.overTime ? `有 ${fmtLen(dur)}，超过建议的 ${T.LIMITS.localMin[mk]} 分钟` : ''}${e.overTime && e.overSize ? '，' : ''}${e.overSize ? `有 ${T.fmtMB(size)}，超过建议的 ${T.LIMITS.fileMB} MB` : ''}。可以继续，预计要${T.fmtDur(e.sec)}；${mk === 'accurate' ? '也可以换「快速」模型，' : ''}建议先剪成几段${hasAi ? '，或改用 AI 转写' : ''}。</div>` : ''}
        <div class="limits small" id="limits">📏 <b>建议大小</b>：本机转写每个文件不超过 <b>${T.LIMITS.localMin.fast} 分钟</b>音频（「更准」${T.LIMITS.localMin.accurate} 分钟）、<b>${T.LIMITS.fileMB} MB</b>。超过也能转，但更慢，手机可能内存不够中途退出；长的建议先剪成几段${hasAi ? '，或用 AI 转写' : ''}。</div>`
      : `<div class="est" id="est"><b>约 ${durTxt}音频，分 ${apiChunks} 段上传</b><div class="muted small">每段都在 25 MB 以内（接口上限）。上传和识别时间取决于网速和服务，进度和剩余时间会实时显示。</div></div>`}
      <div class="row gap"><button class="btn primary grow" id="go">开始转写</button></div>
      <p class="small"><a href="#/lesson/${esc(id)}" id="manual">不转写，自己边听边打 ›</a></p>
    </section>`;
    $$('input[name=eng]', box).forEach(r => r.onchange = () => { engine = r.value; choose(); });
    $$('input[name=mk]', box).forEach(r => r.onchange = () => { mk = r.value; localStorage.setItem(PREF, mk); choose(); });
    $('#go', box).onclick = () => run();
  };

  const run = async () => {
    ac = new AbortController(); const sig = ac.signal; const t0 = performance.now(); const M = T.LOCAL_MODELS[mk];
    box.innerHTML = `<section class="card asrprog" aria-live="polite"><h3 id="ph">准备中…</h3><div class="bar big"><i id="pb" style="width:0%"></i></div>
      <div id="pm" class="pm"></div><div id="pm2" class="muted small"></div><div id="ptext" class="ptext" aria-label="已转写的文字"></div>
      <div class="row gap"><button class="btn" id="cancel">取消</button></div>
      <p class="muted small">转写时请保持这个页面打开、屏幕亮着；切到别的 App 时手机可能暂停计算。</p></section>`;
    $('#cancel', box).onclick = () => ac.abort();
    const set = (ph, pct, pm, pm2) => { const q = s => $(s, box); if (!q('#ph')) return; q('#ph').textContent = ph; q('#pb').style.width = Math.round(Math.min(1, pct) * 100) + '%'; q('#pm').innerHTML = pm; if (pm2 != null) q('#pm2').textContent = pm2; };
    const showText = t => { const x = $('#ptext', box); if (x && t) x.textContent = t.length > 240 ? '…' + t.slice(-240) : t; };
    let dl0 = null;
    const onP = p => {
      if (p.phase === 'download') {
        if (!dl0 && p.loaded > 0) dl0 = { t: performance.now(), b: p.loaded };
        const sp = dl0 ? (p.loaded - dl0.b) / ((performance.now() - dl0.t) / 1000) : 0; const left = sp > 0 ? (p.total - p.loaded) / sp : null;
        set(cached[mk] ? '正在载入本机识别模型…' : `正在下载本机识别模型（${M.label}，只需一次）`, p.total ? p.loaded / p.total : 0, `${T.fmtMB(p.loaded)} / 约 ${M.mb} MB${left != null && p.loaded > 1e6 ? ` · 剩余${T.fmtDur(left)}` : ''}`, '下载完成后保存在这台设备的浏览器里，以后转写不再下载、可离线使用。');
      } else if (p.phase === 'load') set('正在启动识别…', 0, '', '');
      else if (p.phase === 'asr' || p.phase === 'api') {
        const ph = p.phase === 'api' ? `正在 AI 转写（第 ${p.chunk}/${p.chunks} 段${p.upload != null && p.upload < 1 ? ` · 上传 ${Math.round(p.upload * 100)}%` : ''}）` : `正在本机转写（${M.label}）`;
        const eta = p.eta == null ? '' : p.eta < 3 && p.done >= p.total ? ' · 马上好' : ` · 预计还需${T.fmtDur(p.eta)}`;
        set(ph, p.done / p.total, `已转写 <b>${T.fmtClock(p.done)}</b> / ${T.fmtClock(p.total)}${eta}`,
          `已用 ${T.fmtClock(p.elapsed)}${p.phase === 'asr' ? ` · 本机${p.measured ? '实测' : '估算'}：每 1 分钟音频约需 ${Math.round(p.rtf * 60)} 秒` : ''}`);
        showText(p.text);
      }
    };
    try {
      const r = engine === 'api' ? await T.transcribeApi(pcm, { onProgress: onP, signal: sig }) : await T.transcribeLocal(pcm, { modelKey: mk, onProgress: onP, signal: sig });
      const rows = T.segmentsToRows(r.segs);
      const sec = (performance.now() - t0) / 1000;
      if (!rows.length) return choose('没有听出内容：可能是静音、音乐，或不是英语（本机转写只识别英语）。可以换一段，或自己边听边打。');
      const mm = await db.materials.get(id);
      mm.asr = { engine, model: engine === 'api' ? r.model : M.model, sec: +sec.toFixed(1), rtf: r.rtf ? +r.rtf.toFixed(3) : undefined, at: Date.now() }; await db.materials.save(mm);
      session.draft = { title: mm.title, tags: [...(mm.tags || [])], source: 'audio', editId: id, fresh: true, audioId: id, asrInfo: `${engine === 'api' ? 'AI 转写（' + r.model + '）' : '本机转写（' + M.label + ' · ' + M.model + '）'} · ${fmtLen(dur)}音频用时 ${T.fmtClock(sec)}`,
        rows: rows.map(x => ({ speaker: '', en: x.en, zh: x.zh, t0: x.t0, t1: x.t1 })) };
      toast(`转写完成：${rows.length} 句`); go('#/draft');
    } catch (e) {
      if (e.name === 'AbortError') { toast('已取消转写'); return choose(); }
      choose('转写没有完成：' + e.message);
    }
  };
  choose();
}
const fmtLen = s => s < 60 ? Math.round(s) + ' 秒' : Math.floor(s / 60) + ' 分 ' + Math.round(s % 60) + ' 秒';
