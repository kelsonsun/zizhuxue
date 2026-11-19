// 从录音 / 视频里取出声音 → 16kHz 单声道 Float32。分三层，前一层不行再用下一层：
//  ① 拆封装（MP4 / MOV / M4A / 3GP，纯 JS）：只读音轨，按帧拼成 ADTS（AAC）/ AMR / MP3 / PCM 再分段解码。
//     不管视频是 H.264 还是 HEVC，也不用把几百 MB 的视频整个读进内存（iPhone 上整段 decodeAudioData 会因内存或不认 MOV 而失败）。
//  ② 整个文件交给浏览器 decodeAudioData（mp3、wav、webm、ogg 等）。iPhone 上只对较小的文件这样做。
//  ③ 用隐藏的播放器把声音放一遍（2 倍速）并录下 PCM：浏览器能播的就能取。
// 都不行时给出具体原因（例如“这个视频没有声音轨”“声音是 Dolby AC-3”）。
export const SR = 16000;
export class ExtractError extends Error { constructor(msg, code, info) { super(msg); this.code = code; this.info = info; } }
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
const Off = () => globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
const decodeWith = (ctx, buf) => new Promise((res, rej) => { const p = ctx.decodeAudioData(buf, res, rej); if (p?.then) p.then(res, rej); });
const u8 = async (blob, a, b) => new Uint8Array(await blob.slice(a, b).arrayBuffer());
const fourcc = (d, o) => String.fromCharCode(d[o], d[o + 1], d[o + 2], d[o + 3]);
const be32 = (d, o) => ((d[o] << 24) >>> 0) + (d[o + 1] << 16) + (d[o + 2] << 8) + d[o + 3];
const be16 = (d, o) => (d[o] << 8) | d[o + 1];
const be64 = (d, o) => be32(d, o) * 4294967296 + be32(d, o + 4);

/** AudioBuffer → 16kHz 单声道 */
export async function toMono16k(ab) {
  if (ab.sampleRate === SR && ab.numberOfChannels === 1) return ab.getChannelData(0).slice();
  if (ab.sampleRate === SR) { const out = new Float32Array(ab.length); for (let c = 0; c < ab.numberOfChannels; c++) { const d = ab.getChannelData(c); for (let i = 0; i < d.length; i++) out[i] += d[i] / ab.numberOfChannels; } return out; }
  const O = Off(); const off = new O(1, Math.max(1, Math.ceil(ab.duration * SR)), SR); const s = off.createBufferSource(); s.buffer = ab; s.connect(off.destination); s.start();
  return (await off.startRendering()).getChannelData(0);
}
/** 一段字节交给浏览器解码（16kHz 上下文会顺便重采样；个别浏览器不支持就用 44.1kHz 再重采样） */
export async function decodeBytes(buf) {
  const O = Off(); if (!O) throw new ExtractError('这个浏览器不支持读取音频（缺少 Web Audio）', 'NO_WEBAUDIO');
  const copy = buf.slice(0);
  try { return await toMono16k(await decodeWith(new O(1, 1, SR), buf)); }
  catch { return await toMono16k(await decodeWith(new O(1, 1, 44100), copy)); }
}
export function resampleLinear(x, from, to = SR) {
  if (from === to) return x; const n = Math.floor(x.length * to / from), out = new Float32Array(n), r = from / to;
  for (let i = 0; i < n; i++) { const p = i * r, k = Math.floor(p), f = p - k; out[i] = (x[k] || 0) * (1 - f) + (x[k + 1] ?? x[k] ?? 0) * f; }
  return out;
}
const concat = parts => { const n = parts.reduce((a, p) => a + p.length, 0), out = new Float32Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

// ---------- 识别文件 ----------
export async function sniff(blob) {
  const h = await u8(blob, 0, 64); const t = fourcc(h, 4);
  if (['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].includes(t)) return 'isobmff';
  if (h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3) return 'webm';
  const s = String.fromCharCode(...h.slice(0, 12));
  if (s.startsWith('RIFF') && s.slice(8, 12) === 'WAVE') return 'wav';
  if (s.startsWith('#!AMR')) return 'amr';
  if (s.startsWith('OggS')) return 'ogg';
  if (s.startsWith('ID3') || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0)) return (h[1] & 0xf6) === 0xf0 ? 'aac' : 'mp3';
  if (s.startsWith('fLaC')) return 'flac';
  if (h[0] === 0x30 && h[1] === 0x26 && h[2] === 0xb2) return 'asf';
  return 'unknown';
}

// ---------- ① MP4 / MOV / 3GP 拆封装 ----------
export async function readMoov(blob) {
  let pos = 0; const n = blob.size;
  while (pos + 8 <= n) {
    const h = await u8(blob, pos, pos + 16); let size = be32(h, 0); const type = fourcc(h, 4); let hdr = 8;
    if (size === 1) { size = be64(h, 8); hdr = 16; } else if (size === 0) size = n - pos;
    if (size < 8) break;
    if (type === 'moov') { if (size > 200e6) throw new Error('moov too big'); return await u8(blob, pos + hdr, pos + size); }
    pos += size;
  }
  return null;
}
function* boxes(d, a = 0, b = d.length) {
  let p = a;
  while (p + 8 <= b) { let size = be32(d, p); const type = fourcc(d, p + 4); let hdr = 8; if (size === 1) { size = be64(d, p + 8); hdr = 16; } else if (size === 0) size = b - p; if (size < 8 || p + size > b) return; yield { type, s: p + hdr, e: p + size }; p += size; }
}
const child = (d, box, type) => { for (const x of boxes(d, box.s, box.e)) if (x.type === type) return x; return null; };
const path = (d, box, ...types) => { let x = box; for (const t of types) { x = x && child(d, x, t); } return x; };
/** 在一段字节里递归找某个盒子（stsd 里的 esds 可能包在 QuickTime 的 wave 里） */
function findDeep(d, a, b, type, depth = 0) {
  for (const x of boxes(d, a, b)) { if (x.type === type) return x; if (depth < 3 && x.type === 'wave') { const y = findDeep(d, x.s, x.e, type, depth + 1); if (y) return y; } }
  return null;
}
function descLen(d, p) { let len = 0, i = 0, c; do { c = d[p + i]; len = (len << 7) | (c & 0x7f); i++; } while (c & 0x80 && i < 4); return { len, n: i }; }
function parseEsds(d, box) {
  let p = box.s + 4; const out = { oti: 0, asc: null };
  const walk = (p, end) => {
    while (p < end) { const tag = d[p]; const { len, n } = descLen(d, p + 1); const s = p + 1 + n;
      if (tag === 3) { let q = s + 2; const f = d[q++]; if (f & 0x80) q += 2; if (f & 0x40) q += 1 + d[q]; if (f & 0x20) q += 2; walk(q, s + len); }
      else if (tag === 4) { out.oti = d[s]; walk(s + 13, s + len); }
      else if (tag === 5) out.asc = d.slice(s, s + len);
      p = s + len; }
  };
  walk(p, box.e); return out;
}
const SFI = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
/** AudioSpecificConfig → ADTS 需要的 profile / 采样率序号 / 声道 */
export function parseAsc(a) {
  let bit = 0; const rd = n => { let v = 0; for (let i = 0; i < n; i++) { v = (v << 1) | ((a[bit >> 3] >> (7 - (bit & 7))) & 1); bit++; } return v; };
  const ot = () => { let t = rd(5); if (t === 31) t = 32 + rd(6); return t; };
  const sfi = () => { let i = rd(4); if (i === 15) { const f = rd(24); i = SFI.reduce((b, r, k) => Math.abs(r - f) < Math.abs(SFI[b] - f) ? k : b, 0); } return i; };
  let type = ot(), rate = sfi(); const ch = rd(4);
  if (type === 5 || type === 29) { sfi(); type = ot(); } // HE-AAC：用基础层（LC），解码器会自动识别 SBR/PS
  return { type, rate, ch, hz: SFI[rate] };
}
export function adtsHeader(cfg, len) {
  const L = len + 7, p = Math.max(0, Math.min(3, cfg.type - 1)), ch = cfg.ch || 2;
  return [0xff, 0xf1, (p << 6) | (cfg.rate << 2) | ((ch >> 2) & 1), ((ch & 3) << 6) | ((L >> 11) & 3), (L >> 3) & 0xff, ((L & 7) << 5) | 0x1f, 0xfc];
}
/** 解析 moov 里的所有轨道（只取声音轨的样本表） */
export function parseTracks(moov) {
  const tracks = [];
  for (const t of boxes(moov)) if (t.type === 'trak') {
    const mdia = child(moov, t, 'mdia'); if (!mdia) continue;
    const hdlr = child(moov, mdia, 'hdlr'); const kind = hdlr ? fourcc(moov, hdlr.s + 8) : '';
    const mdhd = child(moov, mdia, 'mdhd'); let ts = 0, dur = 0; if (mdhd) { const v = moov[mdhd.s]; ts = be32(moov, mdhd.s + (v ? 20 : 12)); dur = v ? be64(moov, mdhd.s + 24) : be32(moov, mdhd.s + 16); }
    const stbl = path(moov, mdia, 'minf', 'stbl'); const stsd = stbl && child(moov, stbl, 'stsd');
    const tr = { kind, ts, sec: ts ? dur / ts : 0, codec: stsd ? fourcc(moov, stsd.s + 12) : '' };
    if (kind === 'soun' && stsd) {
      // 声音样本描述：8 字节盒头 + 8 字节 SampleEntry + 20 字节（版本、声道、位数、采样率）；QuickTime v1 再多 16 字节，v2 多 36 字节
      const e = stsd.s + 8; const ver = be16(moov, e + 16); tr.channels = be16(moov, e + 24); tr.bits = be16(moov, e + 26); tr.hz = be32(moov, e + 32) >>> 16;
      const extra = ver === 1 ? 16 : ver === 2 ? 36 : 0; if (ver === 2) { const dv = new DataView(moov.buffer, moov.byteOffset + e + 40, 8); tr.hz = Math.round(dv.getFloat64(0)); tr.channels = be32(moov, e + 48); }
      const esds = findDeep(moov, e + 36 + extra, e + be32(moov, e), 'esds'); if (esds) Object.assign(tr, parseEsds(moov, esds));
      // 样本表
      const stsz = child(moov, stbl, 'stsz'), stsc = child(moov, stbl, 'stsc'), stco = child(moov, stbl, 'stco') || child(moov, stbl, 'co64'), stts = child(moov, stbl, 'stts');
      if (stsz && stsc && stco) {
        const fixed = be32(moov, stsz.s + 4), cnt = be32(moov, stsz.s + 8); const sizes = new Uint32Array(cnt); for (let i = 0; i < cnt; i++) sizes[i] = fixed || be32(moov, stsz.s + 12 + i * 4);
        const big = stco.type === 'co64', nc = be32(moov, stco.s + 4); const chunks = new Array(nc); for (let i = 0; i < nc; i++) chunks[i] = big ? be64(moov, stco.s + 8 + i * 8) : be32(moov, stco.s + 8 + i * 4);
        const ne = be32(moov, stsc.s + 4); const sc = []; for (let i = 0; i < ne; i++) sc.push([be32(moov, stsc.s + 8 + i * 12), be32(moov, stsc.s + 12 + i * 12)]);
        const offs = new Float64Array(cnt); let si = 0;
        for (let k = 0; k < sc.length && si < cnt; k++) { const [first, per] = sc[k]; const last = k + 1 < sc.length ? sc[k + 1][0] - 1 : nc; for (let c = first; c <= last && si < cnt; c++) { let o = chunks[c - 1]; for (let j = 0; j < per && si < cnt; j++) { offs[si] = o; o += sizes[si]; si++; } } }
        tr.sizes = sizes; tr.offs = offs; tr.count = si;
        if (stts) { let tot = 0; const n2 = be32(moov, stts.s + 4); for (let i = 0; i < n2; i++) tot += be32(moov, stts.s + 8 + i * 8) * be32(moov, stts.s + 12 + i * 8); tr.samplesTotal = tot; }
      }
    }
    tracks.push(tr);
  }
  return tracks;
}
const CODEC_NAME = { mp4a: 'AAC', samr: 'AMR-NB', sawb: 'AMR-WB', apac: 'Apple 空间音频（APAC）', 'ac-3': 'Dolby AC-3', 'ec-3': 'Dolby E-AC-3', Opus: 'Opus', alac: 'Apple Lossless', sowt: 'PCM', twos: 'PCM', lpcm: 'PCM', '.mp3': 'MP3', fLaC: 'FLAC' };
export const codecName = t => t.codec === 'mp4a' && (t.oti === 0x69 || t.oti === 0x6b) ? 'MP3' : CODEC_NAME[t.codec] || t.codec || '未知';
const RANK = t => t.codec === 'mp4a' && t.asc ? 0 : t.codec === 'mp4a' ? 1 : ['samr', 'sawb', 'sowt', 'twos', '.mp3'].includes(t.codec) ? 2 : 5;
/** 按文件位置分批读出一条轨道的样本（相邻的合并成一次读，每次最多 4MB） */
async function* readSamples(blob, tr, from, to) {
  let i = from;
  while (i < to) {
    let j = i, end = tr.offs[i] + tr.sizes[i];
    while (j + 1 < to && tr.offs[j + 1] === end && end - tr.offs[i] < 4e6) { j++; end += tr.sizes[j]; }
    const buf = await u8(blob, tr.offs[i], end); let o = 0;
    for (let k = i; k <= j; k++) { yield buf.subarray(o, o + tr.sizes[k]); o += tr.sizes[k]; }
    i = j + 1;
  }
}
let amrLib = null;
async function loadAmr() {
  if (globalThis.AMR) return globalThis.AMR;
  return amrLib ||= new Promise((res, rej) => { const s = document.createElement('script'); s.src = new URL('../vendor/amrnb/amrnb.js', import.meta.url).href; s.onload = () => globalThis.AMR ? res(globalThis.AMR) : rej(new Error('AMR 解码器加载失败')); s.onerror = () => { amrLib = null; rej(new Error('AMR 解码器加载失败（离线且没有缓存？）')); }; document.head.append(s); });
}
/** ① 拆封装取声音。返回 {pcm, info} ；没有声音轨抛 NO_AUDIO；不支持的编码抛 UNSUPPORTED（交给下一层） */
export async function demux(blob, onProgress = () => { }) {
  const moov = await readMoov(blob); if (!moov) throw new ExtractError('找不到 moov', 'NO_MOOV');
  const tracks = parseTracks(moov); const audio = tracks.filter(t => t.kind === 'soun'); const hasVideo = tracks.some(t => t.kind === 'vide');
  const info = { container: 'mp4', hasVideo, audio: audio.map(codecName), videoCodec: tracks.find(t => t.kind === 'vide')?.codec };
  if (!audio.length) throw new ExtractError(hasVideo ? '这个视频没有声音轨（录的时候没有收音，或是被去掉了声音），没法转写。' : '这个文件里没有声音。', 'NO_AUDIO', info);
  const tr = audio.filter(t => t.count > 0).sort((a, b) => RANK(a) - RANK(b))[0];
  if (!tr) throw new ExtractError('声音轨没有数据（可能是分段格式）', 'UNSUPPORTED', info);
  info.used = codecName(tr); info.method = 'demux';
  try { return await demuxTrack(blob, tr, info, onProgress); }
  catch (e) { if (e instanceof ExtractError) { e.info ||= info; throw e; } throw new ExtractError(`${info.used} 解码失败（${e?.message || e?.name || e}）`, 'UNSUPPORTED', info); }
}
async function demuxTrack(blob, tr, info, onProgress) {
  const N = tr.count; const parts = [];
  if (tr.codec === 'mp4a' && tr.asc && (tr.oti === 0x40 || tr.oti === 0x66 || tr.oti === 0x67 || tr.oti === 0x68 || !tr.oti)) { // AAC
    const cfg = parseAsc(tr.asc); if (cfg.type < 1 || cfg.type > 4) throw new ExtractError('AAC 类型 ' + cfg.type, 'UNSUPPORTED', info);
    const per = Math.max(200, Math.round(120 * (cfg.hz || 44100) / 1024)); // 每批约 2 分钟声音
    for (let a = 0; a < N; a += per) {
      const b = Math.min(N, a + per); let bytes = 0; for (let k = a; k < b; k++) bytes += tr.sizes[k] + 7;
      const out = new Uint8Array(bytes); let o = 0;
      for await (const s of readSamples(blob, tr, a, b)) { out.set(adtsHeader(cfg, s.length), o); out.set(s, o + 7); o += 7 + s.length; }
      parts.push(await decodeBytes(out.buffer)); onProgress(b / N);
    }
  } else if (tr.codec === 'samr' || tr.codec === 'sawb') { // AMR：3GP 里的样本就是 AMR 文件的帧
    const head = new TextEncoder().encode(tr.codec === 'samr' ? '#!AMR\n' : '#!AMR-WB\n'); let bytes = head.length; for (let k = 0; k < N; k++) bytes += tr.sizes[k];
    const out = new Uint8Array(bytes); out.set(head); let o = head.length; for await (const s of readSamples(blob, tr, 0, N)) { out.set(s, o); o += s.length; }
    onProgress(0.5);
    try { parts.push(await decodeBytes(out.slice().buffer)); }
    catch { if (tr.codec !== 'samr') throw new ExtractError('AMR-WB', 'UNSUPPORTED', info); const A = await loadAmr(); const f = A.decode(out); if (!f) throw new ExtractError('AMR 解码失败', 'UNSUPPORTED', info); parts.push(resampleLinear(f, 8000)); info.amrJs = true; }
    onProgress(1);
  } else if (tr.codec === '.mp3' || (tr.codec === 'mp4a' && (tr.oti === 0x69 || tr.oti === 0x6b))) {
    let bytes = 0; for (let k = 0; k < N; k++) bytes += tr.sizes[k]; const out = new Uint8Array(bytes); let o = 0; for await (const s of readSamples(blob, tr, 0, N)) { out.set(s, o); o += s.length; }
    parts.push(await decodeBytes(out.buffer)); onProgress(1);
  } else if ((tr.codec === 'sowt' || tr.codec === 'twos') && tr.bits === 16) {
    const ch = tr.channels || 1; const le = tr.codec === 'sowt'; const pcm = [];
    for await (const s of readSamples(blob, tr, 0, N)) { const dv = new DataView(s.buffer, s.byteOffset, s.byteLength); const n = Math.floor(s.length / 2 / ch); const f = new Float32Array(n); for (let i = 0; i < n; i++) { let v = 0; for (let c = 0; c < ch; c++) v += dv.getInt16((i * ch + c) * 2, le); f[i] = v / ch / 32768; } pcm.push(f); }
    parts.push(resampleLinear(concat(pcm), tr.hz || 44100)); onProgress(1);
  } else throw new ExtractError('声音编码 ' + codecName(tr), 'UNSUPPORTED', info);
  const pcm = concat(parts); if (!pcm.length) throw new ExtractError('声音轨是空的', 'UNSUPPORTED', info);
  return { pcm, info };
}

// ---------- ③ 播放一遍录下来 ----------
export const PLAY_RATE = 2;
/** onProgress({ratio, eta}); 浏览器拦截自动播放时抛 NEED_TAP（err.resume() 要在用户点按里调用） */
export function viaPlayback(blob, { onProgress = () => { }, video = true } = {}) {
  let resolve, reject; const first = new Promise((a, b) => { resolve = a; reject = b; });
  const url = URL.createObjectURL(blob); const el = document.createElement(video ? 'video' : 'audio');
  el.muted = false; el.preload = 'auto'; el.playsInline = true; el.setAttribute('playsinline', ''); el.style.cssText = 'position:fixed;width:2px;height:2px;opacity:0;pointer-events:none;left:0;top:0';
  document.body.append(el); el.src = url;
  let ac = null, done = false, tick = null; const bufs = [];
  const clean = () => { done = true; clearInterval(tick); clearTimeout(to); try { el.pause(); } catch { } el.removeAttribute('src'); el.remove(); URL.revokeObjectURL(url); ac?.close().catch(() => { }); };
  const fail = e => { if (!done) { clean(); reject(e); } };
  const to = setTimeout(() => fail(new ExtractError('浏览器打不开这个文件', 'NO_PLAY')), 20000);
  el.onerror = () => fail(new ExtractError('浏览器播放不了这个文件的声音', 'NO_PLAY'));
  // 先播放再恢复 AudioContext：没点按时 Chrome/Safari 的 ac.resume() 会一直挂着不返回，不能先等它
  const start = async () => {
    el.currentTime = 0; bufs.length = 0; el.playbackRate = PLAY_RATE;
    const res = ac.resume().catch(() => { }); await el.play(); el.playbackRate = PLAY_RATE;
    await Promise.race([res, new Promise(r => setTimeout(r, 1500))]);
    if (ac.state !== 'running') { el.pause(); const e = new Error('AudioContext 未获准启动'); e.name = 'NotAllowedError'; throw e; }
  };
  el.onloadedmetadata = async () => {
    clearTimeout(to);
    if (el.audioTracks && el.audioTracks.length === 0) return fail(new ExtractError('这个视频没有声音轨，没法转写。', 'NO_AUDIO'));
    try {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext; if (!AC) return fail(new ExtractError('这个浏览器不支持读取音频（缺少 Web Audio）', 'NO_WEBAUDIO'));
      ac = new AC();
      const src = ac.createMediaElementSource(el); const sp = ac.createScriptProcessor(4096, 2, 1); const g = ac.createGain(); g.gain.value = 0;
      sp.onaudioprocess = e => { if (el.paused || done) return; const ib = e.inputBuffer; const n = ib.length, f = new Float32Array(n); for (let c = 0; c < ib.numberOfChannels; c++) { const d = ib.getChannelData(c); for (let i = 0; i < n; i++) f[i] += d[i] / ib.numberOfChannels; } bufs.push(f); };
      src.connect(sp); sp.connect(g); g.connect(ac.destination);
      el.preservesPitch = false; el.mozPreservesPitch = false; el.webkitPreservesPitch = false; el.defaultPlaybackRate = PLAY_RATE;
      const dur = isFinite(el.duration) ? el.duration : 0;
      el.onended = () => {
        const all = concat(bufs); const hz = ac.sampleRate / PLAY_RATE; clean();
        let peak = 0; for (let i = 0; i < all.length; i += 7) peak = Math.max(peak, Math.abs(all[i]));
        if (!all.length || peak < 1e-4) return reject(new ExtractError('放了一遍没有读到任何声音：这个视频可能没有声音，或全程静音。', 'NO_AUDIO'));
        // 倍速播放时浏览器的实际速度、开头结尾的延迟并不精确：已知总时长时按它校正，句子时间点才对得上原声
        const got = all.length / hz; const target = dur && Math.abs(got / dur - 1) < 0.25 ? dur : got;
        resolve({ pcm: resampleLinear(all, all.length / target), info: { method: 'playback', captured: +got.toFixed(2), duration: +target.toFixed(2) } });
      };
      tick = setInterval(() => { if (dur && !el.paused) onProgress({ ratio: el.currentTime / dur, eta: (dur - el.currentTime) / PLAY_RATE }); }, 500);
      try { await start(); }
      catch (e) {
        if (e?.name !== 'NotAllowedError') return fail(e);
        // 浏览器（尤其 iPhone）不许没点按就出声：让界面放一个按钮，用户点了再继续；继续后的结果由 resume() 返回的 Promise 给出
        const err = new ExtractError('需要点一下才能开始读取声音', 'NEED_TAP');
        err.resume = () => new Promise((a, b) => { resolve = a; reject = b; start().catch(fail); });
        err.cancel = () => clean();
        reject(err);
      }
    } catch (e) { fail(e); }
  };
  return first;
}

/**
 * 主入口：任何录音/视频 → {pcm, info}。onProgress({stage, ratio, eta, text})。
 * 出错时抛 ExtractError（message 已是给用户看的中文）。
 */
export async function extract(blob, { onProgress = () => { }, name = '' } = {}) {
  const kind = await sniff(blob); const tried = []; let info = { container: kind };
  if (kind === 'isobmff') {
    try { const r = await demux(blob, ratio => onProgress({ stage: 'demux', ratio, text: '正在从文件里取出声音…' })); return r; }
    catch (e) { if (e.code === 'NO_AUDIO') throw e; info = { ...info, ...(e.info || {}) }; tried.push('拆封装：' + e.message); }
  }
  if (kind === 'amr') { // 单独的 .amr 录音：浏览器多半不支持，直接用自带的 AMR 解码器
    try { return { pcm: await decodeBytes(await blob.arrayBuffer()), info: { ...info, method: 'decode' } }; } catch { }
    try { const A = await loadAmr(); const head = new Uint8Array(await blob.slice(0, 9).arrayBuffer()); if (String.fromCharCode(...head) === '#!AMR-WB\n') throw new Error('AMR-WB'); const f = A.decode(new Uint8Array(await blob.arrayBuffer())); if (f?.length) return { pcm: resampleLinear(f, 8000), info: { ...info, method: 'amrjs', used: 'AMR-NB' } }; }
    catch (e) { tried.push('AMR：' + e.message); }
  }
  const maxWhole = isIOS() ? 80e6 : 600e6; // iPhone 上整段解码大文件会因内存不够失败（甚至页面被系统关掉）
  if (blob.size <= maxWhole && kind !== 'asf') {
    onProgress({ stage: 'decode', text: '正在读取声音…' });
    try { return { pcm: await decodeBytes(await blob.arrayBuffer()), info: { ...info, method: 'decode' } }; }
    catch (e) { tried.push('整段解码：' + (e.message || e.name)); }
  }
  onProgress({ stage: 'play', ratio: 0, text: `正在用播放器读取声音（${PLAY_RATE} 倍速）…` });
  const play = video => viaPlayback(blob, { onProgress: p => onProgress({ stage: 'play', ...p, text: `正在用播放器读取声音（${PLAY_RATE} 倍速）…` }), video });
  try {
    try { return await play(info.hasVideo !== false); }
    catch (e) { if (e.code !== 'NO_PLAY' || info.hasVideo === false) throw e; tried.push('视频播放器：' + e.message); return await play(false); } // 视频画面解不了（如少见的视频编码）时，只用音频播放器再试
  } catch (e) {
    if (e.code === 'NO_AUDIO' || e.code === 'NEED_TAP') throw e;
    tried.push('播放：' + e.message);
    const what = info.audio?.length ? `检测到的声音编码：${info.audio.join('、')}` : `文件类型：${{ isobmff: 'MP4/MOV', webm: 'WebM', ogg: 'Ogg', asf: 'WMA/WMV', amr: 'AMR', unknown: '无法识别' }[kind] || kind}`;
    throw new ExtractError(`这个浏览器读不出这个文件的声音（${what}）。可以换用电脑上的 Chrome / Edge / Safari 打开自主学再选这个文件，或在手机上用「现场录音」把它外放录下来。`, 'UNSUPPORTED', { ...info, tried });
  }
}
