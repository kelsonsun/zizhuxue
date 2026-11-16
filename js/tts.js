// 浏览器 TTS（speechSynthesis）。
let voices = [];
const loadVoices = () => { voices = speechSynthesis.getVoices(); };
if ('speechSynthesis' in globalThis) { loadVoices(); speechSynthesis.addEventListener?.('voiceschanged', loadVoices); }
export const supported = () => 'speechSynthesis' in globalThis;
export function pickVoice(lang = 'en-US') {
  const pref = ['Samantha', 'Google US English', 'Aaron', 'Microsoft Aria', 'Microsoft Jenny', 'Alex'];
  const v = voices.filter(v => v.lang?.replace('_', '-').toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
  return v.find(x => x.lang.replace('_', '-') === lang && pref.some(p => x.name.includes(p))) || v.find(x => x.lang.replace('_', '-') === lang) || v[0] || null;
}
export function cancel() { if (supported()) speechSynthesis.cancel(); }
/** 朗读并在结束时 resolve（带超时兜底，避免 iOS 偶发不触发 onend）。 */
export function speak(text, { rate = 1, lang = 'en-US' } = {}) {
  return new Promise((resolve, reject) => {
    if (!supported()) return reject(new Error('本设备不支持语音朗读'));
    cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = lang; u.rate = rate;
    try { const v = pickVoice(lang); if (v) u.voice = v; } catch { /* 个别浏览器不接受该语音对象，用默认声音 */ }
    let done = false; const fin = () => { if (!done) { done = true; clearTimeout(to); resolve(); } };
    const to = setTimeout(fin, Math.max(3000, (text.length * 110) / rate + 2500));
    u.onend = fin; u.onerror = (e) => { if (e.error === 'interrupted' || e.error === 'canceled') { done = true; clearTimeout(to); resolve('interrupted'); } else fin(); };
    speechSynthesis.speak(u);
  });
}
