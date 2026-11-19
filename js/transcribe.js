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

// ---------- 解码：任何录音/视频 → 16kHz 单声道 Float32（分层：拆 MP4/MOV/3GP 只取声音轨 → 整段解码 → 播放一遍录下来），见 extract.js ----------
/** 返回 {pcm, info}；onProgress({stage, ratio, eta, text})；失败抛 ExtractError（code: NO_AUDIO / UNSUPPORTED / NEED_TAP…，message 是给用户看的中文） */
export async function readAudio(blob, opts = {}) {
  const X = await import('./extract.js');
  const r = await X.extract(blob, opts);
  if (!r.pcm?.length) throw new X.ExtractError('这个文件里没有声音', 'NO_AUDIO', r.info);
  return r;
}
export async function decodeToPcm(blob, opts) { return (await readAudio(blob, opts)).pcm; }

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
// 断句规则（v1.4.1，kelson：语音备忘录转写出来是一整块）：
//  ① 有句号/问号/叹号就按标点断；② 没有或很少标点时，按说话的停顿（从声音里测出的静音段）断；
//  ③ 再长也不超过 约 20 个词 / 12 秒（中文约 32 个字）：在最长的停顿、逗号、连接词（and/but/so…、然后/但是/所以…）处切；
//  ④ 轻度补标点：句首大写、i → I，句末补 . 或 ?（中文补 。或 ？）。每句都有自己的起止时间，可单独回放原声。
const FRAME = 0.02;
/** 从声音里找停顿：返回 [{a, b}]（秒），只算 ≥ minGap 秒的安静段。阈值按这段录音自己的底噪和音量自动定。 */
export function findPauses(pcm, { sr = SR, minGap = 0.2 } = {}) {
  if (!pcm?.length) return [];
  const n = Math.floor(pcm.length / (sr * FRAME)), w = Math.floor(sr * FRAME), db = new Float32Array(n);
  for (let f = 0; f < n; f++) { let s = 0; for (let i = f * w; i < (f + 1) * w; i++) s += pcm[i] * pcm[i]; db[f] = 10 * Math.log10(s / w + 1e-10); }
  const sorted = Float32Array.from(db).sort(); const q = p => sorted[Math.min(n - 1, Math.floor(p * n))];
  const floor = q(0.1), loud = q(0.95); if (loud - floor < 8) return []; // 几乎没有起伏（持续噪音/音乐），测不出停顿
  const thr = floor + Math.max(6, 0.3 * (loud - floor));
  const out = []; let st = -1;
  for (let f = 0; f <= n; f++) {
    const quiet = f < n && db[f] < thr;
    if (quiet && st < 0) st = f; else if (!quiet && st >= 0) { if ((f - st) * FRAME >= minGap) out.push({ a: +(st * FRAME).toFixed(2), b: +(f * FRAME).toFixed(2) }); st = -1; }
  }
  return out;
}
const CONJ_EN = /^(and|but|so|because|then|or|when|if|which|that's|while|after|before|although|though|also|actually|anyway|now|well|okay|ok|like)$/i;
const CONJ_ZH = /^(然后|但是|可是|不过|所以|因为|而且|还有|就是|那么|如果|其实|另外|接着|后来|结果|那个)/;
/** 一般不会在它后面停下来断句的词（冠词、介词、物主代词等） */
const FUNC_END = /^(the|a|an|to|of|for|by|in|on|at|with|from|into|after|under|before|about|over|through|across|like|nor|her|his|my|your|our|their|its|and|or|but|as|very|so|that|this|is|was|were|are|be|had|has|have|would|could|should|will|shall|not|no|than|then|if|when|which|who|whose|what|i|she|he|they|we|you|it)$/i;
/** 每个字之前的“说话量”：英语按每个词的音节数（元音组）估，中文每字 1 个音节；返回长度 n+1 的累计数组 */
function speakWeights(t, zh) {
  const W = new Float32Array(t.length + 1); const per = new Float32Array(t.length);
  const re = zh ? /[\u3400-\u9fff]|[A-Za-z0-9']+/g : /[A-Za-z0-9'’]+|[^\s]/g; let m;
  while ((m = re.exec(t))) {
    const w = m[0]; let syl;
    if (/[\u3400-\u9fff]/.test(w)) syl = 1;
    else if (/^\d+$/.test(w)) syl = 1.5 * w.length;
    else if (/[A-Za-z]/.test(w)) { syl = (w.toLowerCase().replace(/e$/, '').match(/[aeiouy]+/g) || []).length || 1; syl += 0.3; }
    else syl = 0;
    for (let i = 0; i < w.length; i++) per[m.index + i] = syl / w.length;
  }
  for (let i = 0; i < t.length; i++) W[i + 1] = W[i] + per[i];
  return W;
}
const WH = /^(what|where|when|why|who|whose|how)$/i, AUX = /^(is|are|am|was|were|do|does|did|can|could|would|will|should|shall|have|has|had|may|might|must|isn't|aren't|wasn't|weren't|don't|doesn't|didn't|can't|couldn't|won't|wouldn't|shouldn't|haven't|hasn't)$/i, PRON = /^(i|you|we|they|he|she|it|there|this|that|these|those|the|a|an|my|your|our|his|her|their|anyone|anybody|someone|somebody|everyone)$/i;
/** 像不像问句（只看开头几个词，宁可少判）：What time should I…、How are you…、Do you…、Is it… */
const isQuestion = s => { const w = s.toLowerCase().replace(/[^a-z'’\s]/g, ' ').split(/\s+/).filter(Boolean); return (WH.test(w[0] || '') && (AUX.test(w[1] || '') || AUX.test(w[2] || '') || /'s$/.test(w[0]))) || (AUX.test(w[0] || '') && PRON.test(w[1] || '')); };
const isCjk = ch => /[\u3400-\u9fff]/.test(ch);
/** 轻度补标点和大小写（只补缺的，不改用户/识别已有的标点） */
export function tidySentence(s, zh = false) {
  s = s.trim().replace(/[,，、;；:：\s]+$/, '');
  if (!s) return s;
  if (zh) { s = s.replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, '$1，'); return /[。！？!?…”"）)]$/.test(s) ? s : s + (/(吗|呢|吧|么|嘛)$/.test(s) ? '？' : '。'); } // 中文句中的空格（识别结果常用来代替标点）换成逗号
  s = s.replace(/\bi\b(?=$|[\s'’,.!?])/g, 'I').replace(/^(["'“‘(]?)([a-z])/, (m, q, c) => q + c.toUpperCase());
  if (!/[.!?…]["'”’)\]]*$/.test(s)) s += isQuestion(s) ? '?' : '.';
  return s;
}
/**
 * segs: [{text, t0, t1, words?: [{t0, t1}]}]（秒，绝对时间）。pcm（16kHz，可选）用来测停顿、让字的时间只落在有声音的地方。
 * 返回 [{en, zh, t0, t1}]；中文转写（AI 接口可能识别出中文）放进 zh。
 */
export function segmentsToRows(segs, { pad = 0.15, pcm = null, sr = SR, maxWords = 20, maxSec = 12, maxZh = 32 } = {}) {
  const gaps = pcm ? findPauses(pcm, { sr }) : [];
  // 1) 把各段连成一串文字，给每个字符一个时间。段内只在“有声音的时间”里按字数分配（停顿里不放字）；
  //    段内每个停顿按“剩下的字 / 剩下的有声时间”推算落在哪个词前面，就在那里重新对齐（误差不会越积越大）
  let text = ''; const times = []; const segEnd = new Set(); const wordTimes = []; const anchored = new Map(); const used = new Set();
  const zhAll = lang(segs.map(g => g.text || '').join(' ')) === 'zh';
  const starter = zhAll ? (w => CONJ_ZH.test(w) || /^[我你他她它这那]/.test(w)) : (w => CONJ_EN.test(w) || /^(i|i'm|we|she|he|they|you|my|what|how|why|where|who|please|let's|yes|no)$/i.test(w));
  for (const g of segs) {
    const t = cleanText(g.text); if (!t || g.t0 == null) continue;
    const t1 = g.t1 != null && g.t1 > g.t0 ? g.t1 : g.t0 + Math.max(1, t.length / 15);
    if (text) { text += ' '; times.push(g.t0); }
    const base = text.length, n = t.length; const W = speakWeights(t, zhAll); // W[i]：第 i 个字之前要“说”的量（按音节估，比按字母数准）
    const voiced = []; let cur = g.t0; const inner = [];
    for (const p of gaps) { if (p.b <= g.t0 || p.a >= t1) continue; if (p.a > cur) voiced.push([cur, p.a]); if (p.a > g.t0 + 0.05 && p.b < t1 - 0.05) inner.push(p); cur = Math.max(cur, p.b); }
    if (cur < t1) voiced.push([cur, t1]);
    const vTot = voiced.reduce((x, [u, v]) => x + v - u, 0);
    const useV = gaps.length && vTot >= 0.3 * (t1 - g.t0);
    const vAt = tt => { let v = 0; for (const [u, w] of voiced) { if (tt <= u) break; v += Math.min(tt, w) - u; } return v; }; // 时间 → 之前的有声时长
    const tAt = v => { if (!useV) return g.t0 + (t1 - g.t0) * v / Math.max(1e-6, vTot); for (const [u, w] of voiced) { if (v <= w - u) return u + v; v -= w - u; } return t1; };
    // 段内的词边界（下一个词第一个字的位置）
    const starts = []; const wre = zhAll ? /[\u3400-\u9fff]|[^\s\u3400-\u9fff]+/g : /\S+/g; let mm; while ((mm = wre.exec(t))) if (mm.index > 0) starts.push({ i: mm.index, w: mm[0], prev: t.slice(0, mm.index).trimEnd().slice(-1), pw: (t.slice(0, mm.index).trimEnd().match(/[\p{L}']+$/u) || [''])[0] });
    const anchors = [[0, 0, 0]]; const Wn = W[n];
    if (useV) for (const p of inner) {
      if (p.b - p.a < 0.25) continue;
      const [w0, v0] = anchors[anchors.length - 1]; const vg = vAt(p.a); if (vg <= v0) continue;
      const rate = (Wn - w0) / Math.max(1e-6, vTot - v0); const pred = w0 + (vg - v0) * rate;
      let best = null, bc = Infinity;
      for (const st of starts) { if (W[st.i] <= w0) continue; const d = Math.abs(W[st.i] - pred) / rate; const bonus = (/[.!?。！？,，;；]/.test(st.prev) ? 0.35 : 0) + (starter(st.w.replace(/[^\p{L}']/gu, '')) ? 0.15 : 0) - (FUNC_END.test(st.pw || '') ? 0.2 : 0); const c = d - bonus; if (c < bc) { bc = c; best = st; } }
      if (best && bc < 1.0) { anchors.push([W[best.i], vg, best.i]); anchored.set(base + best.i, p); used.add(p); }
    }
    anchors.push([Wn, vTot, n]);
    let k = 0;
    for (let i = 0; i < n; i++) {
      while (k < anchors.length - 2 && i >= anchors[k + 1][2]) k++;
      const [wa, va] = anchors[k], [wb, vb] = anchors[k + 1];
      // 锚点处：前一个字落在停顿前，后一个字落在停顿后
      const v = wb > wa ? va + (vb - va) * (W[i] - wa) / (wb - wa) : va;
      times.push(tAt(i === anchors[k][2] && k > 0 ? va + 1e-4 : Math.min(v, vb - (i < n - 1 ? 1e-4 : 0))));
    }
    text += t; segEnd.add(text.length - 1);
    if (g.words?.length) wordTimes.push({ base, text: t, words: g.words });
  }
  if (!text) return [];
  const zh = zhAll;
  // 2) 切成词（中文按字，英文按空格），每个词有起止时间
  const toks = []; const re = zh ? /[\u3400-\u9fff][，。！？、；：,.!?;:”’」』）)…]*|[^\s\u3400-\u9fff]+/g : /\S+/g; let m;
  while ((m = re.exec(text))) toks.push({ a: m.index, b: m.index + m[0].length - 1, s: m[0], t0: times[m.index], t1: times[m.index + m[0].length - 1] });
  // AI 接口给了逐词时间（whisper-1 的 timestamp_granularities=word）且词数对得上时，用精确时间
  for (const wt of wordTimes) { const inSeg = toks.filter(k => k.a >= wt.base && k.b < wt.base + wt.text.length); if (inSeg.length === wt.words.length) inSeg.forEach((k, i) => { k.t0 = wt.words[i].t0; k.t1 = wt.words[i].t1; k.exact = true; }); }
  if (!toks.length) return [];
  // 3) 词与词之间的“切点”特征：句末标点、停顿长度、逗号、连接词、识别分段的边界
  const B = toks.slice(0, -1).map((k, j) => {
    const nx = toks[j + 1]; const end = k.s;
    return { strong: zh ? /[。！？!?…]["”’」』）)]*$/.test(end) : /[.!?…]["'”’)\]]*$/.test(end) && !/^(mr|mrs|ms|dr|st|vs|etc|e\.g|i\.e)\.$/i.test(end) && /^["'“‘(\[]?[A-Z0-9]/.test(nx.s),
      comma: /[,，、;；:：]$/.test(end) || (zh && /\s/.test(text.slice(k.b + 1, nx.a)) && isCjk(text[k.b]) && isCjk(text[nx.a])), // 中文识别结果常用空格代替标点
      zsp: zh && /\s/.test(text.slice(k.b + 1, nx.a)) && isCjk(text[k.b]) && isCjk(text[nx.a]), conj: zh ? CONJ_ZH.test(text.slice(nx.a, nx.a + 2)) : CONJ_EN.test(nx.s.replace(/[^a-z'’]/gi, '')),
      seg: [...Array(nx.a - k.b).keys()].some(d => segEnd.has(k.b + d)), pause: k.exact && nx.exact ? Math.max(0, nx.t0 - k.t1) : 0, gap: null }; // 插值出来的时间差不算停顿；停顿只信声音里测到的或逐词时间
  });
  // 测到的停顿落在哪个切点（按时间找最近的词边界）
  for (let j = 0; j < B.length; j++) { const p = anchored.get(toks[j + 1].a); if (p) { B[j].gap = p; B[j].pause = Math.max(B[j].pause, p.b - p.a); } }
  for (const p of gaps) { // 段与段之间的停顿：找时间最近的词边界
    if (p.b - p.a < 0.25 || used.has(p)) continue; const mid = (p.a + p.b) / 2; let best = -1, bd = Infinity;
    for (let j = 0; j < B.length; j++) { const d = Math.abs((toks[j].t1 + toks[j + 1].t0) / 2 - mid); if (d < bd) { bd = d; best = j; } }
    if (best >= 0 && bd < 1.2 && (!B[best].gap || p.b - p.a > B[best].gap.b - B[best].gap.a)) { B[best].gap = p; B[best].pause = Math.max(B[best].pause, p.b - p.a); }
  }
  const unit = zh ? 1 : 1, minStrong = 1, minPause = zh ? 6 : 4, cap = zh ? maxZh : maxWords, minSide = zh ? 4 : 3;
  const score = (j, a, e) => { const b = B[j]; const mid = (a + e) / 2; return (b.strong ? 3 : 0) + Math.min(1.5, b.pause) * 4 + (b.comma ? 1.2 : 0) + (b.conj ? 0.8 : 0) + (b.seg ? 0.6 : 0) - 0.4 * Math.abs(j - mid) / Math.max(1, e - a); };
  // 4) 从前往后断句
  const cuts = []; let st = 0;
  for (let j = 0; j < B.length; j++) {
    const len = (j - st + 1) * unit, dur = toks[j].t1 - toks[st].t0, b = B[j];
    if (b.strong && len >= minStrong) { cuts.push(j); st = j + 1; continue; }
    if (b.pause >= 0.55 && len >= minPause) { cuts.push(j); st = j + 1; continue; }
    if (b.zsp && len >= 8) { cuts.push(j); st = j + 1; continue; }
    if (len >= cap || (dur >= maxSec && len >= minPause * 2)) {
      let best = -1, bs = -Infinity; const lo = st + minSide - 1;
      for (let k = Math.max(lo, st); k <= j; k++) { const v = score(k, st, j); if (v > bs) { bs = v; best = k; } }
      if (best < 0) best = j;
      cuts.push(best); st = best + 1; j = best;
    }
  }
  // 最后剩一两个词又没有句末标点：并到上一句
  if (cuts.length && toks.length - 1 - cuts[cuts.length - 1] < (zh ? 3 : 2) && !/[.!?。！？…]$/.test(toks[toks.length - 1].s)) cuts.pop();
  const rows = []; let a = 0;
  for (const c of [...cuts, toks.length - 1]) {
    const s = text.slice(toks[a].a, toks[c].b + 1); const t = tidySentence(s, zh);
    // 句子边界吸附到停顿：上一句到停顿开始，下一句从停顿结束
    const gl = a > 0 ? B[a - 1].gap : null, gr = c < B.length ? B[c].gap : null;
    rows.push({ en: zh ? '' : t, zh: zh ? t : '', t0: gl ? Math.max(toks[a].t0 - 0.6, gl.b - 0.1) : toks[a].t0, t1: gr ? Math.min(toks[c].t1 + 0.6, gr.a + 0.1) : toks[c].t1 });
    a = c + 1;
  }
  rows.forEach((r, i) => { r.t0 = +Math.max(0, r.t0 - pad, i ? rows[i - 1].t1 - 0.05 : 0).toFixed(2); const nx = rows[i + 1]; r.t1 = +(nx ? Math.min(r.t1 + 0.3, nx.t0 - pad) : r.t1 + 0.5).toFixed(2); if (r.t1 <= r.t0) r.t1 = +(r.t0 + 0.5).toFixed(2); });
  return rows;
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
        f.append('response_format', seg ? 'verbose_json' : 'json'); if (seg) { f.append('timestamp_granularities[]', 'segment'); f.append('timestamp_granularities[]', 'word'); } // 逐词时间让断句更准
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
      const words = Array.isArray(j.words) ? j.words.map(w => ({ t0: off + (+w.start || 0), t1: off + (+w.end || 0) })) : [];
      if (Array.isArray(j.segments) && j.segments.length) for (const s of j.segments) { const a = off + (+s.start || 0), b = off + (+s.end || sec); segs.push({ text: s.text, t0: a, t1: b, words: words.filter(w => w.t0 >= a - 0.01 && w.t0 < b) }); }
      else if (j.text && words.length) segs.push({ text: j.text, t0: off, t1: off + sec, words });
      else if (j.text) segs.push({ text: j.text, t0: off, t1: off + sec }); // 只有文字（如 gpt-4o-transcribe）：断句靠标点 + 声音里的停顿
      text = (text + ' ' + cleanText(j.text || '')).trim();
    }
    done += sec; const el = (performance.now() - t0) / 1000;
    onProgress({ phase: 'api', done, total, chunk: i + 1, chunks: chunks.length, upload: 1, elapsed: el, eta: done ? el / done * (total - done) : null, text });
  }
  return { segs, model, ms: performance.now() - t0 };
}
