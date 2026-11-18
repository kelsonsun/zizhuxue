// 自动转写：录音 / 视频 → 16kHz 单声道 → ① AI 接口 /audio/transcriptions（填了密钥时）或 ② 本机 Whisper（Web Worker，免费）
// → 带时间点的句子（每句可回放原声）。纯逻辑 + 引擎，不含界面。数字（模型大小、速度）来自 v1.4 实测，见 docs/v1.4更新说明.docx。
import * as ai from './ai.js';
import { splitEnglish, splitChinese, lang } from './textproc.js';

export const SR = 16000;
/** 本机模型。mb = 首次下载实测（模型 + 运行库）；rtf = 每 1 秒音频需要的处理秒数（电脑为实测，手机为估算，开始后按本机实测更新）。 */
export const LOCAL_MODELS = {
  fast: { key: 'fast', id: 'onnx-community/whisper-tiny.en', label: '快速', model: 'Whisper tiny.en', mb: 47, dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, rtf: { desktop: 0.2, mobile: 0.6 } },
  accurate: { key: 'accurate', id: 'onnx-community/whisper-base.en', label: '更准', model: 'Whisper base.en', mb: 83, dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, rtf: { desktop: 0.35, mobile: 1.05 } },
};
export const DEFAULT_LOCAL = 'fast';
/** 建议上限（界面提示用）：本机转写单个文件的音频时长、文件大小；AI 接口单次上传上限 25MB（OpenAI 规定）。 */
export const LIMITS = { localMin: { fast: 10, accurate: 5 }, fileMB: 200, apiMB: 25, apiChunkSec: 600, localChunkSec: 30 };
export const DEFAULT_API_MODEL = 'whisper-1';

// ---------- 小工具 ----------
export const isMobile = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
export function fmtClock(sec) { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); }
/** 给人看的时长：“约 40 秒”“约 3 分钟”“约 1 小时 10 分钟” */
export function fmtDur(sec) {
  sec = Math.max(0, sec);
  if (sec < 55) return `约 ${Math.max(5, Math.round(sec / 5) * 5)} 秒`;
  if (sec < 90) return '约 1 分钟';
  const m = Math.round(sec / 60); if (m < 60) return `约 ${m} 分钟`;
  return `约 ${Math.floor(m / 60)} 小时${m % 60 ? ' ' + (m % 60) + ' 分钟' : ''}`;
}
export const fmtMB = b => (b / 1e6 >= 10 ? Math.round(b / 1e6) : (b / 1e6).toFixed(1)) + ' MB'; // 十进制 MB，与“约 47 MB”一致
const rtfKey = k => 'zzx.asr.rtf.' + k;
/** 本机实测速度（上次转写记下的），没有则用默认（电脑实测/手机估算） */
export function speedOf(modelKey) {
  const v = +(globalThis.localStorage?.getItem(rtfKey(modelKey)) || 0);
  if (v > 0) return { rtf: v, measured: true };
  const m = LOCAL_MODELS[modelKey]; return { rtf: m.rtf[isMobile() ? 'mobile' : 'desktop'], measured: false };
}
export function saveSpeed(modelKey, rtf) { if (rtf > 0 && isFinite(rtf)) try { localStorage.setItem(rtfKey(modelKey), rtf.toFixed(3)); } catch { } }
/** 转写前的预估：处理时间（秒）+ 是否超出建议 */
export function estimateLocal(modelKey, durSec, fileBytes = 0) {
  const sp = speedOf(modelKey);
  return { sec: durSec * sp.rtf, measured: sp.measured, rtf: sp.rtf, overTime: durSec > LIMITS.localMin[modelKey] * 60, overSize: fileBytes > LIMITS.fileMB * 1e6 };
}

// ---------- 解码：任何浏览器能播的音频/视频 → 16kHz 单声道 Float32 ----------
const decodeWith = (ctx, buf) => new Promise((res, rej) => { const p = ctx.decodeAudioData(buf, res, rej); if (p?.then) p.then(res, rej); });
export async function decodeToPcm(blob) {
  const Off = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Off) throw new Error('这个浏览器不支持读取音频（缺少 Web Audio）');
  const buf = await blob.arrayBuffer();
  let ab;
  try { ab = await decodeWith(new Off(1, 1, SR), buf); }
  catch (e) {
    try { ab = await decodeWith(new Off(1, 1, 44100), await blob.arrayBuffer()); } // 个别浏览器不支持 16kHz 的离线上下文
    catch { throw new Error('读不出这个文件的声音：可能没有声音轨，或格式浏览器不支持（如 amr、wma）。请转成 mp3 / m4a / mp4 后再试。'); }
  }
  let pcm;
  if (ab.sampleRate === SR && ab.numberOfChannels === 1) pcm = ab.getChannelData(0);
  else if (ab.sampleRate === SR) { pcm = new Float32Array(ab.length); for (let c = 0; c < ab.numberOfChannels; c++) { const d = ab.getChannelData(c); for (let i = 0; i < d.length; i++) pcm[i] += d[i] / ab.numberOfChannels; } }
  else { // 重采样 + 混成单声道
    const off = new Off(1, Math.ceil(ab.duration * SR), SR); const src = off.createBufferSource(); src.buffer = ab; src.connect(off.destination); src.start();
    pcm = (await off.startRendering()).getChannelData(0);
  }
  if (!pcm.length) throw new Error('这个文件里没有声音');
  return pcm;
}

// ---------- 切段：在最安静的地方切，避免把一个词切成两半 ----------
const rms = (pcm, a, b) => { let s = 0; for (let i = a; i < b; i++) s += pcm[i] * pcm[i]; return Math.sqrt(s / Math.max(1, b - a)); };
/** 返回 [{s, e, silent}]（样本下标）。每段不超过 maxSec；在 [minSec, maxSec] 之间找最安静的 0.1 秒切开。 */
export function planChunks(pcm, maxSec, minSec = Math.max(1, maxSec * 2 / 3), sr = SR) {
  const out = []; const max = Math.floor(maxSec * sr), min = Math.floor(minSec * sr), win = Math.floor(0.1 * sr), step = Math.floor(0.02 * sr);
  let pos = 0;
  while (pos < pcm.length) {
    let end;
    if (pcm.length - pos <= max) end = pcm.length;
    else { let best = Infinity; end = pos + max; for (let i = pos + min; i + win <= pos + max; i += step) { const r = rms(pcm, i, i + win); if (r < best) { best = r; end = i + (win >> 1); } } }
    out.push({ s: pos, e: end, silent: rms(pcm, pos, end) < 0.003 }); pos = end;
  }
  return out;
}
/** 16 位 PCM WAV */
export function encodeWav(pcm, sr = SR) {
  const b = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(b), w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) { const x = Math.max(-1, Math.min(1, pcm[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
  return new Blob([b], { type: 'audio/wav' });
}

// ---------- 转写结果 → 句子（带原声时间段） ----------
const NOISE = /\[(?:BLANK_AUDIO|MUSIC|NOISE|SILENCE|INAUDIBLE)[^\]]*\]|\((?:music|applause|laughs?|laughter|silence|inaudible|noise)[^)]*\)|♪+/gi;
export const cleanText = t => String(t || '').replace(NOISE, ' ').replace(/\s+/g, ' ').trim();
/**
 * segs: [{text, t0, t1}]（秒，绝对时间）。把各段文字连起来按句子重新切分，每句的起止时间按字符在段内线性插值。
 * 返回 [{en, zh, t0, t1}]；中文转写（AI 接口可能识别出中文）放进 zh。
 */
export function segmentsToRows(segs, { pad = 0.15 } = {}) {
  let text = ''; const times = []; // times[i] = 第 i 个字符的时间
  for (const g of segs) {
    const t = cleanText(g.text); if (!t || g.t0 == null) continue;
    const t1 = g.t1 != null && g.t1 > g.t0 ? g.t1 : g.t0 + Math.max(1, t.length / 15);
    if (text) { text += ' '; times.push(g.t0); }
    for (let i = 0; i < t.length; i++) times.push(g.t0 + (t1 - g.t0) * (i / Math.max(1, t.length - 1)));
    text += t;
  }
  if (!text) return [];
  const zh = lang(text) === 'zh'; const parts = zh ? splitChinese(text) : splitEnglish(text);
  const rows = []; let cur = 0;
  for (const p of parts) {
    let a = text.indexOf(p, cur); if (a < 0) a = cur; const b = Math.min(text.length - 1, a + p.length - 1); cur = b + 1;
    rows.push({ en: zh ? '' : p, zh: zh ? p : '', t0: times[a], t1: times[b] });
  }
  // 太长（> 25 秒）的“句子”（转写没有标点时）按原始分段再拆开
  const out = [];
  for (const r of rows) {
    if (r.t1 - r.t0 <= 25 || zh) { out.push(r); continue; }
    const inside = segs.filter(g => g.t0 >= r.t0 - 0.01 && g.t0 < r.t1 && cleanText(g.text));
    if (inside.length < 2) { out.push(r); continue; }
    for (const g of inside) out.push({ en: cleanText(g.text), zh: '', t0: g.t0, t1: Math.min(g.t1 ?? r.t1, r.t1) });
  }
  out.forEach((r, i) => { r.t0 = +Math.max(0, r.t0 - pad, i ? out[i - 1].t1 - 0.05 : 0).toFixed(2); const nx = out[i + 1]; r.t1 = +(nx ? Math.min(r.t1 + 0.4, nx.t0) : r.t1 + 0.5).toFixed(2); if (r.t1 <= r.t0) r.t1 = +(r.t0 + 0.5).toFixed(2); });
  return out;
}

// ---------- 引擎 ① 本机 Whisper（Web Worker） ----------
export const workerUrl = () => new URL('./asr-worker.js', import.meta.url);
/** 模型是否已下载过（在浏览器缓存里） */
export async function isCached(modelKey) {
  try { const id = LOCAL_MODELS[modelKey].id; const c = await caches.open('transformers-cache'); const ks = await c.keys(); return ks.some(r => r.url.includes(id) && /decoder_model_merged/.test(r.url)); } catch { return false; }
}
const abortErr = () => Object.assign(new Error('已取消'), { name: 'AbortError' });
/**
 * 本机转写。onProgress({phase:'download', loaded, total} | {phase:'load'} | {phase:'asr', done, total, elapsed, eta, rtf, text})
 * 返回 {segs, rtf, ms}。signal 取消时终止 Worker。
 */
export async function transcribeLocal(pcm, { modelKey = DEFAULT_LOCAL, onProgress = () => { }, signal } = {}) {
  const M = LOCAL_MODELS[modelKey]; const w = new Worker(workerUrl(), { type: 'module' });
  let pending = null; const files = {};
  const kill = () => { w.terminate(); pending?.rej(abortErr()); };
  signal?.addEventListener('abort', kill, { once: true });
  w.onmessage = ({ data: d }) => {
    if (d.type === 'dl') {
      if (d.file && d.total) { files[d.file] = { loaded: d.status === 'done' ? d.total : d.loaded || 0, total: d.total }; }
      else if (d.file && d.status === 'done' && files[d.file]) files[d.file].loaded = files[d.file].total;
      const v = Object.values(files); const loaded = v.reduce((a, f) => a + f.loaded, 0), total = Math.max(loaded, M.mb * 1e6); // 以实测总大小为准（各文件大小是陆续才知道的）
      onProgress({ phase: 'download', loaded, total });
    } else if (d.type === 'error') pending?.rej(new Error('本机转写出错：' + d.message));
    else pending?.res(d);
  };
  w.onerror = e => pending?.rej(new Error('本机转写组件加载失败（需要联网下载一次；或这个浏览器不支持）：' + (e.message || '')));
  const call = msg => new Promise((res, rej) => { pending = { res, rej }; w.postMessage(msg); });
  try {
    if (signal?.aborted) throw abortErr();
    onProgress({ phase: 'download', loaded: 0, total: M.mb * 1e6 });
    await call({ type: 'load', model: M.id, dtype: M.dtype });
    onProgress({ phase: 'load' });
    const chunks = planChunks(pcm, LIMITS.localChunkSec, 20); const total = pcm.length / SR;
    const segs = []; let done = 0, work = 0, workSec = 0; const t0 = performance.now(); let text = '';
    let rtf = speedOf(modelKey).rtf;
    for (const c of chunks) {
      const sec = (c.e - c.s) / SR;
      if (!c.silent) {
        const cs = performance.now();
        const tick = setInterval(() => { const run = (performance.now() - cs) / 1000; const part = Math.min(sec * 0.95, run / rtf); onProgress({ phase: 'asr', done: done + part, total, elapsed: (performance.now() - t0) / 1000, eta: Math.max(0, (total - done - part) * rtf), rtf, text, measured: workSec > 0 }); }, 1000);
        let r; try { r = await call({ type: 'run', id: c.s, audio: pcm.slice(c.s, c.e) }); } finally { clearInterval(tick); }
        work += r.ms / 1000; workSec += sec; rtf = work / workSec;
        const off = c.s / SR;
        const cks = r.chunks?.length ? r.chunks : [{ text: r.text, t0: 0, t1: sec }];
        for (const k of cks) segs.push({ text: k.text, t0: off + (k.t0 ?? 0), t1: off + (k.t1 ?? sec) });
        text = (text + ' ' + cleanText(r.text)).trim();
      }
      done += sec;
      onProgress({ phase: 'asr', done, total, elapsed: (performance.now() - t0) / 1000, eta: Math.max(0, (total - done) * rtf), rtf, text, measured: workSec > 0 });
    }
    if (workSec >= 5) saveSpeed(modelKey, rtf);
    return { segs, rtf, ms: performance.now() - t0 };
  } finally { signal?.removeEventListener('abort', kill); w.terminate(); }
}

// ---------- 引擎 ② AI 接口 /audio/transcriptions（OpenAI 兼容，按你的服务计费） ----------
export const apiModel = () => (ai.getConfig()?.asrModel || '').trim() || DEFAULT_API_MODEL;
/** whisper 系列返回逐段时间（verbose_json）；gpt-4o-*-transcribe 只返回文字，就切成 30 秒左右的小段，每段内按字数估时间。 */
export const apiHasSegments = model => /whisper/i.test(model);
function postForm(path, form, { signal, onUpload, timeout = 300000 }) {
  const c = ai.getConfig();
  return new Promise((res, rej) => {
    const x = new XMLHttpRequest(); x.open('POST', c.baseUrl + path); x.setRequestHeader('Authorization', 'Bearer ' + c.apiKey); x.timeout = timeout;
    x.upload.onprogress = e => e.lengthComputable && onUpload?.(e.loaded / e.total);
    x.onload = () => { let j = null; try { j = JSON.parse(x.responseText); } catch { } res({ status: x.status, json: j, text: x.responseText }); };
    x.onerror = () => rej(new ai.AIError(`连不上 AI 服务（${c.baseUrl}）：网络不通，或这个服务不允许浏览器直接访问（CORS）。`, 'NETWORK'));
    x.ontimeout = () => rej(new ai.AIError('AI 转写超时（5 分钟没有返回），请稍后重试或改用本机转写。', 'TIMEOUT'));
    const ab = () => { x.abort(); rej(abortErr()); }; if (signal) { if (signal.aborted) return ab(); signal.addEventListener('abort', ab, { once: true }); }
    x.send(form);
  });
}
/** onProgress({phase:'api', done, total, chunk, chunks, upload, elapsed, eta}) */
export async function transcribeApi(pcm, { onProgress = () => { }, signal } = {}) {
  if (!ai.isConfigured()) throw new ai.AIError(ai.NOT_CONFIGURED_MSG, 'NOT_CONFIGURED');
  const model = apiModel(), seg = apiHasSegments(model);
  const chunks = planChunks(pcm, seg ? LIMITS.apiChunkSec : 30, seg ? LIMITS.apiChunkSec - 30 : 20);
  const total = pcm.length / SR; const segs = []; let done = 0; const t0 = performance.now(); let text = '';
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i], sec = (c.e - c.s) / SR;
    if (!c.silent) {
      const wav = encodeWav(pcm.subarray(c.s, c.e));
      if (wav.size > LIMITS.apiMB * 1e6) throw new Error('分段后仍超过 25MB（不应发生）');
      const send = async () => {
        const f = new FormData(); f.append('file', wav, `part${i + 1}.wav`); f.append('model', model);
        f.append('response_format', seg ? 'verbose_json' : 'json'); if (seg) f.append('timestamp_granularities[]', 'segment');
        return postForm('/audio/transcriptions', f, { signal, onUpload: u => onProgress({ phase: 'api', done, total, chunk: i + 1, chunks: chunks.length, upload: u, elapsed: (performance.now() - t0) / 1000, text }) });
      };
      let r = await send();
      if (r.status === 429 && !/quota|billing/i.test(r.text) || r.status >= 500) { await new Promise(s => setTimeout(s, 2000)); r = await send(); }
      if (r.status !== 200) {
        const e = ai.explainError(r.status, r.json);
        if (r.status === 404 && !/模型/.test(e.message)) e.message = `这个接口没有语音转写（${ai.getConfig().baseUrl}/audio/transcriptions 返回 404），或模型“${model}”不可用。可在「我的 → AI 设置」改“语音转写模型”，或改用本机转写。`;
        if (r.status === 404 && /模型/.test(e.message)) e.message = `语音转写模型“${model}”在这个接口上不可用（404）。可在「我的 → AI 设置」改“语音转写模型”（例如 whisper-1），或改用本机转写。`;
        throw e;
      }
      const j = r.json || {}; const off = c.s / SR;
      if (Array.isArray(j.segments) && j.segments.length) for (const s of j.segments) segs.push({ text: s.text, t0: off + (+s.start || 0), t1: off + (+s.end || sec) });
      else if (j.text) segs.push({ text: j.text, t0: off, t1: off + sec });
      text = (text + ' ' + cleanText(j.text || '')).trim();
    }
    done += sec; const el = (performance.now() - t0) / 1000;
    onProgress({ phase: 'api', done, total, chunk: i + 1, chunks: chunks.length, upload: 1, elapsed: el, eta: done ? el / done * (total - done) : null, text });
  }
  return { segs, model, ms: performance.now() - t0 };
}
