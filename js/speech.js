// 跟读：MediaRecorder 录音回放 + 浏览器语音识别（SpeechRecognition）评分。录音只在本机内存里，不上传、不保存到磁盘。
import { compareWords } from './textproc.js';
export const ASR_LABEL = '浏览器识别，仅供参考';
export const asrSupported = () => !!(globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition);
export const recSupported = () => !!(navigator.mediaDevices?.getUserMedia && globalThis.MediaRecorder);

function pickMime() {
  const c = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  return c.find(t => MediaRecorder.isTypeSupported?.(t)) || '';
}

/** 开始一次跟读。返回 {stop(): Promise<{url, transcript|null, asr:boolean, error?}>}。 */
export async function startShadowing({ lang = 'en-US', useAsr = true } = {}) {
  if (!recSupported()) throw new Error('此浏览器不支持录音');
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { throw new Error(e.name === 'NotAllowedError' ? '麦克风权限被拒绝。请在浏览器/系统设置里允许本站使用麦克风后重试。' : '无法打开麦克风：' + e.message); }
  const mime = pickMime();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = []; rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const stopped = new Promise(r => { rec.onstop = r; });
  rec.start();
  let transcript = '', asrErr = null, asrOn = false, recog = null, asrEnded = Promise.resolve();
  const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  if (useAsr && SR) {
    try {
      recog = new SR(); recog.lang = lang; recog.interimResults = true; recog.continuous = true; recog.maxAlternatives = 1;
      asrOn = true;
      asrEnded = new Promise(r => { recog.onend = r; });
      recog.onresult = (e) => { let t = ''; for (const res of e.results) t += res[0].transcript + ' '; transcript = t.trim(); };
      recog.onerror = (e) => { asrErr = e.error; };
      recog.start();
    } catch (e) { asrOn = false; asrErr = String(e.message || e); }
  }
  return {
    async stop() {
      try { recog?.stop(); } catch {}
      if (rec.state !== 'inactive') rec.stop();
      await stopped; stream.getTracks().forEach(t => t.stop());
      await Promise.race([asrEnded, new Promise(r => setTimeout(r, 1500))]);
      const blob = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' });
      return { url: URL.createObjectURL(blob), blob, transcript: asrOn ? transcript : null, asr: asrOn, error: asrErr };
    },
  };
}
export function scoreSpeech(reference, transcript) { return compareWords(reference, transcript); }
