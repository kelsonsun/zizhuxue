// 英语朗读：系统语音（speechSynthesis，按口音挑高品质声音，可手动选）+ 可选“AI 自然语音”（OpenAI 兼容 /audio/speech）。
// 只做英语。AI 语音：音频缓存在本机（同一句不重复请求/计费）；失败时如实提示并回退系统语音。
import { settings } from './state.js';
import * as ai from './ai.js';
import * as db from './db.js';

let voices = [];
const loadVoices = () => { try { voices = speechSynthesis.getVoices() || []; } catch { voices = []; } };
if ('speechSynthesis' in globalThis) { loadVoices(); speechSynthesis.addEventListener?.('voiceschanged', loadVoices); }
export const supported = () => 'speechSynthesis' in globalThis;
export const ACCENTS = { auto: '自动', 'en-US': '美式 en-US', 'en-GB': '英式 en-GB', 'en-AU': '澳式 en-AU' };
export const AI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'];
export const AI_TTS_MODEL = 'gpt-4o-mini-tts';
const norm = l => String(l || '').replace('_', '-').toLowerCase();
// macOS/iOS 的趣味/怪声，不适合跟读
const NOVELTY = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred|Junior|Ralph|Kathy|Grandma|Grandpa|Rocko|Shelley|Flo|Eddy|Reed|Sandy)\b/i;
const GOOD = /\b(Samantha|Ava|Zoe|Evan|Nathan|Allison|Susan|Tom|Daniel|Kate|Serena|Oliver|Arthur|Martha|Karen|Lee|Catherine|Gordon|Aria|Jenny|Guy|Sonia|Ryan|Natasha|William|Libby)\b/i;
/** 声音品质分：Premium/Enhanced/Siri/Natural/Neural/Google 等优先 */
export function quality(v) {
  const n = v.name || ''; let s = 0;
  if (/premium|高级/i.test(n)) s += 50; if (/enhanced|增强/i.test(n)) s += 40; if (/siri/i.test(n)) s += 35;
  if (/natural|neural|online/i.test(n)) s += 30; if (/google/i.test(n)) s += 20; if (/microsoft/i.test(n)) s += 8;
  if (GOOD.test(n)) s += 8; if (NOVELTY.test(n)) s -= 200; if (/compact|eloquence/i.test(n + ' ' + (v.voiceURI || ''))) s -= 10;
  return s;
}
const accentScore = (v, accent) => { const l = norm(v.lang); const want = accent === 'auto' ? null : norm(accent);
  if (want) return l === want ? 100 : l.startsWith('en') ? 10 : -999;
  return l === 'en-us' ? 100 : l === 'en-gb' ? 90 : l === 'en-au' ? 80 : l.startsWith('en') ? 50 : -999; };
/** 某口音下可选的英语系统声音，按推荐顺序 */
export function englishVoices(accent = settings.accent || 'auto') {
  return voices.filter(v => norm(v.lang).startsWith('en') && accentScore(v, accent) > 0 && (accent === 'auto' || norm(v.lang) === norm(accent)))
    .map(v => ({ v, s: accentScore(v, accent) + quality(v) })).filter(x => quality(x.v) > -100).sort((a, b) => b.s - a.s).map(x => x.v);
}
export const qualityTag = v => /premium|高级/i.test(v.name) ? '高级' : /enhanced|增强/i.test(v.name) ? '增强' : /siri/i.test(v.name) ? 'Siri' : /natural|neural|online/i.test(v.name) ? '自然' : /google/i.test(v.name) ? 'Google' : '';
export function pickVoice(lang) {
  const accent = settings.accent || 'auto';
  if (settings.voiceName) { const v = voices.find(x => x.name === settings.voiceName && norm(x.lang).startsWith('en')); if (v) return v; }
  const list = englishVoices(accent); if (list.length) return list[0];
  const any = voices.filter(v => norm(v.lang).startsWith(norm(lang || 'en').slice(0, 2))); return any[0] || null;
}
const langFor = v => v?.lang?.replace('_', '-') || ((settings.accent && settings.accent !== 'auto') ? settings.accent : 'en-US');

// ---- AI 自然语音 ----
let audio = null; let notified = '';
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
export const aiEnabled = () => settings.ttsEngine === 'ai' && ai.isConfigured();
const aiModel = () => (settings.aiTtsModel || '').trim() || AI_TTS_MODEL;
const aiVoice = () => AI_VOICES.includes(settings.aiVoice) ? settings.aiVoice : 'coral';
const cacheKey = text => 'tts:' + hash([aiModel(), aiVoice(), settings.accent || 'auto', text].join('|'));
async function cacheIndex() { return db.meta.get('ttsCache', []); }
export async function cacheInfo() { const ix = await cacheIndex(); return { count: ix.length, bytes: ix.reduce((a, x) => a + (x.n || 0), 0) }; }
export async function clearCache() { for (const x of await cacheIndex()) await db.blobs.del(x.k); await db.meta.set('ttsCache', []); }
/** 取 AI 语音（先查本机缓存），返回 Blob */
export async function aiAudio(text) {
  const k = cacheKey(text); const hit = await db.blobs.get(k).catch(() => null);
  if (hit?.blob) return { blob: hit.blob, cached: true };
  const c = ai.getConfig(); const model = aiModel(); const accent = settings.accent || 'auto';
  const body = { model, voice: aiVoice(), input: text, response_format: 'mp3' };
  if (/^gpt-4o/i.test(model) && accent !== 'auto') body.instructions = `Speak clearly at a natural pace with a ${{ 'en-US': 'General American', 'en-GB': 'British (Received Pronunciation)', 'en-AU': 'Australian' }[accent]} English accent.`;
  const r = await ai.aiFetch('/audio/speech', body, { timeout: 30000 });
  if (!r.ok) { let j = null; try { j = await r.json(); } catch { } const e = ai.explainError(r.status, j); if (r.status === 404 && !/模型/.test(e.message)) e.message = `这个接口没有 AI 语音（${c.baseUrl}/audio/speech 返回 404），或模型“${model}”不可用`; throw e; }
  const blob = await r.blob(); if (!blob.size) throw new ai.AIError('AI 语音接口返回了空音频', 'BAD_FORMAT');
  await db.blobs.set(k, blob); const ix = (await cacheIndex()).filter(x => x.k !== k); ix.push({ k, n: blob.size, t: Date.now() });
  while (ix.length > 400) { const o = ix.shift(); await db.blobs.del(o.k).catch(() => { }); } // 本机最多缓存 400 段
  await db.meta.set('ttsCache', ix); return { blob, cached: false };
}
function playBlob(blob, rate) {
  return new Promise((resolve, reject) => {
    audio = audio || new Audio(); const url = URL.createObjectURL(blob); audio.src = url; audio.playbackRate = rate || 1; audio.preservesPitch = true;
    const end = v => { URL.revokeObjectURL(url); audio.onended = audio.onerror = audio.onpause = null; resolve(v); };
    audio.onended = () => end(); audio.onpause = () => { if (!audio.ended) end('interrupted'); }; audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error('音频无法播放')); };
    audio.play().catch(e => { URL.revokeObjectURL(url); reject(e.name === 'NotAllowedError' ? new Error('iPhone 拦截了自动播放，请再点一次 🔊') : e); });
  });
}
function notify(msg) { if (notified === msg) return; notified = msg; import('./ui.js').then(u => u.toast(msg, 5000)).catch(() => { }); }
export let lastEngine = 'system';

export function cancel() { if (supported()) speechSynthesis.cancel(); if (audio && !audio.paused) audio.pause(); }
/** 系统语音朗读，结束时 resolve（带超时兜底，避免 iOS 偶发不触发 onend）。 */
export function speakSystem(text, { rate = 1, voice = null } = {}) {
  return new Promise((resolve, reject) => {
    if (!supported()) return reject(new Error('本设备不支持语音朗读'));
    if (supported()) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); const v = voice || pickVoice(); u.lang = langFor(v); u.rate = rate;
    try { if (v) u.voice = v; } catch { /* 个别浏览器不接受该语音对象，用默认声音 */ }
    let done = false; const fin = () => { if (!done) { done = true; clearTimeout(to); resolve(); } };
    const to = setTimeout(fin, Math.max(3000, (text.length * 110) / rate + 2500));
    u.onend = fin; u.onerror = (e) => { if (e.error === 'interrupted' || e.error === 'canceled') { done = true; clearTimeout(to); resolve('interrupted'); } else fin(); };
    speechSynthesis.speak(u);
  });
}
/** 朗读英语：选了“AI 自然语音”且已配置 AI 时用 AI（有缓存），失败则如实提示并回退系统语音。 */
export async function speak(text, { rate = 1, engine } = {}) {
  cancel();
  const useAi = engine ? engine === 'ai' && ai.isConfigured() : aiEnabled();
  if (useAi) {
    try { const { blob } = await aiAudio(text); lastEngine = 'ai'; return await playBlob(blob, rate); }
    catch (e) { lastEngine = 'system'; notify('AI 语音不可用：' + e.message + '。已改用系统语音。'); if (!supported()) throw e; }
  } else lastEngine = 'system';
  return speakSystem(text, { rate });
}
