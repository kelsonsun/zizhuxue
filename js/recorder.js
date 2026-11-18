// 现场录音：MediaRecorder，可暂停/继续，显示时长和音量。iPhone Safari 录成 audio/mp4（AAC），安卓/电脑 Chrome 录成 audio/webm（Opus）。
// 录音只在本机：停止后交给导入流程保存到本机数据库（IndexedDB），不上传。
export const supported = () => !!(navigator.mediaDevices?.getUserMedia && globalThis.MediaRecorder);
const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/aac', 'audio/ogg;codecs=opus'];
export const pickMime = () => TYPES.find(t => MediaRecorder.isTypeSupported?.(t)) || '';
export const extOf = mime => /mp4|aac|m4a/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : /wav/.test(mime) ? 'wav' : 'webm';
/** 麦克风错误 → 给用户看的中文说明（分 iPhone / 安卓 / 电脑） */
export function micError(e) {
  const n = e?.name || '';
  if (!globalThis.isSecureContext) return '录音需要用 https 打开本站（或 localhost）。';
  if (n === 'NotAllowedError' || n === 'SecurityError') {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent), and = /Android/.test(navigator.userAgent);
    return '没有麦克风权限，无法录音。' + (ios ? '请在 iPhone「设置 → Safari 浏览器 → 麦克风」选「询问」或「允许」；或在地址栏左边点「大小」→「网站设置」→ 麦克风选「允许」，然后再点一次「开始录音」。'
      : and ? '请点地址栏左边的图标 →「权限」→ 麦克风选「允许」；如果还不行，到手机「设置 → 应用 → Chrome → 权限」打开麦克风。然后再点一次「开始录音」。'
      : '请点地址栏左边的图标，把「麦克风」改成「允许」，再点一次「开始录音」。');
  }
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return '没有找到麦克风。请接上麦克风/耳机后再试。';
  if (n === 'NotReadableError' || n === 'AbortError') return '麦克风正被别的 App（如电话、微信语音）占用，请关掉后再试。';
  return '无法打开麦克风：' + (e?.message || n || '未知错误');
}
/**
 * 开始录音。onTick({sec, level}) 每 0.2 秒回调。返回控制对象：
 * pause() / resume() / stop() → Promise<{blob, mime, sec}> / cancel() / state()
 */
export async function start({ onTick = () => { } } = {}) {
  if (!supported()) throw Object.assign(new Error('这个浏览器不支持录音（需要 iOS 14.3+ 的 Safari、安卓 Chrome 或电脑 Chrome/Edge/Safari）。也可以用手机自带录音机录好再「选择文件」。'), { name: 'Unsupported' });
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch (e) { throw Object.assign(new Error(micError(e)), { name: e?.name || 'Error' }); }
  const mime = pickMime(); const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = []; rec.ondataavailable = e => e.data?.size && chunks.push(e.data);
  const stopped = new Promise(r => { rec.onstop = r; });
  let acc = 0, since = performance.now(), ac = null, an = null, lock = null;
  try { ac = new (globalThis.AudioContext || globalThis.webkitAudioContext)(); an = ac.createAnalyser(); an.fftSize = 512; ac.createMediaStreamSource(stream).connect(an); } catch { an = null; }
  try { lock = await navigator.wakeLock?.request('screen'); } catch { } // 录音时不让屏幕自动锁（锁屏后 iPhone 会停止录音）
  const buf = new Uint8Array(256);
  const sec = () => acc + (rec.state === 'recording' ? (performance.now() - since) / 1000 : 0);
  const timer = setInterval(() => { let level = 0; if (an && rec.state === 'recording') { an.getByteTimeDomainData(buf); for (const v of buf) level = Math.max(level, Math.abs(v - 128) / 128); } onTick({ sec: sec(), level, state: rec.state }); }, 200);
  rec.start(1000);
  const end = () => { clearInterval(timer); stream.getTracks().forEach(t => t.stop()); ac?.close().catch(() => { }); lock?.release?.().catch(() => { }); };
  return {
    state: () => rec.state, sec,
    pause() { if (rec.state === 'recording') { acc += (performance.now() - since) / 1000; rec.pause(); } },
    resume() { if (rec.state === 'paused') { since = performance.now(); rec.resume(); } },
    async stop() { const s = sec(); if (rec.state !== 'inactive') rec.stop(); await stopped; end(); const type = rec.mimeType || mime || 'audio/webm'; return { blob: new Blob(chunks, { type }), mime: type, sec: s }; },
    cancel() { try { if (rec.state !== 'inactive') rec.stop(); } catch { } end(); },
  };
}
