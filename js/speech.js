// 跟读：MediaRecorder 录音回放 + 浏览器语音识别（SpeechRecognition）评分。录音只在本机内存里，不上传、不保存到磁盘。
// 每次跟读都独立评分，不限次数；上一轮的识别器/麦克风必须先中止，新一轮在用户点击的同步调用栈里 start()。
// 不能先 await getUserMedia 再 start 识别：第一次常因权限框的点击还能出分，第二次权限已有，await 之后手势失效，
// Safari/Chrome 会静默失败或抛错，表现为“第一次有评分、第二次没有评分”。
import { compareWords } from './textproc.js';
export const ASR_LABEL = '浏览器识别，仅供参考';
export const asrSupported = () => !!(globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition);
export const recSupported = () => !!(navigator.mediaDevices?.getUserMedia && globalThis.MediaRecorder);

function pickMime() {
  const c = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  return c.find(t => MediaRecorder.isTypeSupported?.(t)) || '';
}

/** 从 SpeechRecognitionResultList 取出全部识别文本（不用 for...of，旧版 Safari 上这个对象可能不可迭代）。 */
export function collectTranscript(results) {
  if (!results) return '';
  let t = '';
  for (let i = 0; i < results.length; i++) {
    const alt = results[i] && results[i][0];
    if (alt && alt.transcript) t += alt.transcript + ' ';
  }
  return t.trim();
}

let live = null; // 当前或尚未释放完的会话

function killSession(s) {
  if (!s) return;
  try { s.recog?.abort ? s.recog.abort() : s.recog?.stop(); } catch { }
  try { if (s.rec && s.rec.state !== 'inactive') s.rec.stop(); } catch { }
  try { s.stream?.getTracks().forEach(t => t.stop()); } catch { }
}

/** 中止正在进行的跟读（关面板、换一句、被打断时用），不评分。 */
export async function abortLiveShadowing() {
  const s = live; live = null;
  if (!s) return;
  killSession(s);
  await Promise.race([s.done || Promise.resolve(), new Promise(r => setTimeout(r, 400))]);
}

const micErr = e => e?.name === 'NotAllowedError' ? '麦克风权限被拒绝。请在浏览器/系统设置里允许本站使用麦克风后重试。' : '无法打开麦克风：' + (e?.message || e);

/** 开始一次跟读。返回 {stop(): Promise<{url, transcript|null, asr:boolean, error?, source?}>}。 */
export async function startShadowing({ lang = 'en-US', useAsr = true, transcribe } = {}) {
  if (!recSupported()) throw new Error('此浏览器不支持录音');

  // 同步中止上一轮，但不在这里 await，以免丢掉这次点击的用户手势。
  const prev = live; live = null;
  if (prev) killSession(prev);

  // 在用户点击的同步栈里发起录音权限和语音识别（两者都可能要求手势）。
  const mic = () => navigator.mediaDevices.getUserMedia({ audio: true });
  let um = mic();

  let transcript = '', asrErr = null, asrOn = false, recog = null, asrEnded = Promise.resolve();
  const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  if (useAsr && SR) {
    try {
      recog = new SR(); recog.lang = lang; recog.interimResults = true; recog.continuous = true; recog.maxAlternatives = 1;
      asrOn = true;
      asrEnded = new Promise(r => { recog.onend = () => r(); });
      recog.onresult = (e) => { const t = collectTranscript(e.results); if (t) transcript = t; };
      recog.onerror = (e) => { const err = e?.error || String(e || ''); if (err !== 'aborted' && err !== 'no-speech') asrErr = err; };
      recog.start();
    } catch (e) { asrOn = false; asrErr = String(e.message || e); recog = null; }
  }

  if (prev) await Promise.race([prev.done || Promise.resolve(), new Promise(r => setTimeout(r, 400))]);

  let stream;
  try { stream = await um; }
  catch (e) {
    try { stream = await mic(); }
    catch (e2) { try { recog?.abort ? recog.abort() : recog?.stop(); } catch { } throw new Error(micErr(e2.name === 'NotAllowedError' ? e2 : e)); }
  }

  const mime = pickMime();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = []; rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const stopped = new Promise(r => { rec.onstop = r; });
  rec.start();

  const session = { recog, rec, stream };
  session.done = Promise.allSettled ? Promise.allSettled([stopped, asrEnded]) : Promise.all([stopped, asrEnded]).catch(() => { });
  live = session;

  return {
    async stop() {
      if (live === session) live = null;
      try { recog?.stop(); } catch { }
      if (rec.state !== 'inactive') rec.stop();
      await stopped; stream.getTracks().forEach(t => t.stop());
      await Promise.race([asrEnded, new Promise(r => setTimeout(r, 1500))]);
      const blob = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' });
      let text = asrOn ? transcript : null;
      let source = text ? 'browser' : null;
      // 浏览器没听清时，可用调用方提供的转写（自己的密钥 / 内置 AI 等）再评一次，保证这次跟读仍有分。
      if (useAsr && !text && typeof transcribe === 'function' && blob.size) {
        try {
          const t = String(await transcribe(blob, { lang }) || '').trim();
          if (t) { text = t; source = 'ai'; asrOn = true; asrErr = null; }
        } catch (e) { asrErr = asrErr || String(e.message || e); }
      }
      return { url: URL.createObjectURL(blob), blob, transcript: asrOn ? text : null, asr: asrOn, error: asrErr, source };
    },
  };
}
export function scoreSpeech(reference, transcript) { return compareWords(reference, transcript); }
