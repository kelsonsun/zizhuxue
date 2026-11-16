// 翻译通道：给纯英文配中文、给纯中文配英文。三条真实通道（不造假）：
//  1) AI：用户在「我的」配置的 OpenAI 兼容接口（内容发给该接口）。
//  2) 浏览器内置翻译（Translator API）：Chrome 138+/Edge 148+ 桌面版端侧翻译，不上传；iPhone 上所有浏览器都不支持。
//  3) MyMemory 公共翻译接口：免费免注册，匿名约 5000 字符/天（填邮箱约 50000），内容会发给 MyMemory（Translated 公司）。
// 进度写进材料（m.trans），翻译结果逐批保存，中断后可续传。
import * as db from './db.js';
import * as ai from './ai.js';
import { settings } from './state.js';
import { lang } from './textproc.js';

export const MM_DEFAULT = 'https://api.mymemory.translated.net/get';
export const NAMES = { ai: 'AI（你配置的接口）', chrome: '浏览器内置翻译（端侧）', mymemory: 'MyMemory 公共翻译' };
export const SHORT = { ai: 'AI 翻译', chrome: '浏览器端侧翻译', mymemory: 'MyMemory 机器翻译', manual: '手动' };
export class QuotaError extends Error { constructor(m) { super(m); this.code = 'QUOTA'; } }
const CJK = /[\u3400-\u9fff]/, LAT = /[A-Za-z]/;

/** 判断材料方向：纯英文 → en2zh；纯中文 → zh2en；需要翻译的句子数。 */
export function needOf(sentences) {
  const en2zh = sentences.filter(s => s.en && !s.zh).length, zh2en = sentences.filter(s => s.zh && !s.en).length;
  if (!en2zh && !zh2en) return { dir: null, count: 0 };
  return en2zh >= zh2en ? { dir: 'en2zh', count: en2zh } : { dir: 'zh2en', count: zh2en };
}
export const srcOf = (s, dir) => dir === 'en2zh' ? s.en : s.zh;
export const pending = (sentences, dir) => sentences.filter(s => dir === 'en2zh' ? (s.en && !s.zh) : (s.zh && !s.en));

/** 浏览器内置翻译的可用性：'available'|'downloadable'|'downloading'|'unavailable'|'none'（没有此 API）。 */
export async function chromeStatus(dir) {
  if (!globalThis.Translator?.availability) return 'none';
  try { return await globalThis.Translator.availability(pair(dir)); } catch { return 'unavailable'; }
}
const pair = dir => dir === 'en2zh' ? { sourceLanguage: 'en', targetLanguage: 'zh' } : { sourceLanguage: 'zh', targetLanguage: 'en' };
let chromeTr = {};
/** 必须在用户点击里调用（首次会下载语言包）。 */
export async function chromePrepare(dir, onDownload) {
  if (chromeTr[dir]) return chromeTr[dir];
  chromeTr[dir] = await globalThis.Translator.create({ ...pair(dir), monitor(m) { m.addEventListener('downloadprogress', e => onDownload?.(e.loaded)); } });
  return chromeTr[dir];
}

// ---- MyMemory ----
const utf8len = s => new TextEncoder().encode(s).length;
/** MyMemory 单次最多 500 字节：长句按标点/空格切成几段分别翻译再拼起来。 */
export function chunkForMM(text, max = 450) {
  if (utf8len(text) <= max) return [text];
  const parts = text.split(/(?<=[,;:，；：、])\s*/); const out = []; let cur = '';
  const push = () => { if (cur) out.push(cur.trim()); cur = ''; };
  for (const p of parts) {
    if (utf8len(p) > max) { push(); let buf = ''; for (const w of p.split(/(\s+)/)) { if (utf8len(buf + w) > max) { out.push(buf.trim()); buf = ''; } buf += w; } if (buf.trim()) out.push(buf.trim()); continue; }
    if (utf8len(cur + ' ' + p) > max) push(); cur += (cur ? ' ' : '') + p;
  }
  push(); return out.filter(Boolean);
}
async function mmOne(text, dir) {
  const lp = dir === 'en2zh' ? 'en|zh-CN' : 'zh-CN|en';
  const u = new URL(settings.mmUrl || MM_DEFAULT, location.href); u.searchParams.set('q', text); u.searchParams.set('langpair', lp);
  if (settings.mmEmail) u.searchParams.set('de', settings.mmEmail);
  let r; try { r = await fetch(u); } catch { throw new Error('连不上 MyMemory（请检查网络）'); }
  let d; try { d = await r.json(); } catch { throw new Error('MyMemory 返回了无法解析的内容（HTTP ' + r.status + '）'); }
  const t = String(d?.responseData?.translatedText || '');
  if (d?.quotaFinished || d?.responseStatus == 429 || /MYMEMORY WARNING/i.test(t)) throw new QuotaError('MyMemory 今天的免费额度用完了（匿名约 5000 字符/天）。进度已保存，明天或换个通道可以继续。');
  if (d?.responseStatus != 200 || !t) throw new Error('MyMemory 出错：' + (d?.responseDetails || ('状态 ' + d?.responseStatus)));
  return t.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 把一批原文译成目标语言，返回等长数组（某句失败则为 null）。 */
export async function translateTexts(provider, texts, dir) {
  if (provider === 'ai') return ai.translateBatch(texts, dir);
  if (provider === 'chrome') { const tr = chromeTr[dir]; if (!tr) throw new Error('浏览器内置翻译还没准备好'); const out = []; for (const t of texts) out.push(await tr.translate(t)); return out; }
  if (provider === 'mymemory') {
    const out = [];
    for (const t of texts) { const parts = chunkForMM(t); const tr = []; for (const p of parts) { tr.push(await mmOne(p, dir)); await sleep(settings.mmDelay ?? 250); } out.push(tr.join(dir === 'en2zh' ? '' : ' ')); }
    return out;
  }
  throw new Error('未知的翻译通道');
}
/** 结果核对：en2zh 必须含中文；zh2en 必须含英文字母且不是原文照抄。 */
export const plausible = (src, t, dir) => !!t && (dir === 'en2zh' ? CJK.test(t) : (LAT.test(t) && lang(t) === 'en')) && t.trim() !== src.trim();

// ---- 后台任务（可续传） ----
export const job = { running: false, cancel: false, ids: [], title: '', done: 0, total: 0, provider: null, dir: null, error: null, listeners: new Set() };
const emit = () => job.listeners.forEach(f => { try { f(job); } catch { } });
export const onJob = f => { job.listeners.add(f); return () => job.listeners.delete(f); };

/** 统计一组材料（一课或整本书的各章）还要翻译多少。 */
export async function statsOf(ids) {
  let total = 0, left = 0, chars = 0, dir = null;
  for (const id of ids) { const m = await db.materials.get(id); if (!m) continue; const n = needOf(m.sentences); dir = dir || n.dir || m.trans?.dir || null;
    const d = dir || 'en2zh'; const p = pending(m.sentences, d); left += p.length; chars += p.reduce((a, s) => a + srcOf(s, d).length, 0); total += m.sentences.length; }
  return { total, left, chars, dir };
}

/**
 * 运行翻译任务：逐章、每批 batch 句，翻完一批就存一次（所以随时中断都能续传）。
 * 每句标记 s.tr = 通道名（界面显示“机器翻译，可改”）。
 */
export async function run(ids, { provider, dir, title = '', batch = provider === 'ai' ? 15 : 5 } = {}) {
  if (job.running) throw new Error('已有翻译任务在进行');
  Object.assign(job, { running: true, cancel: false, ids, title, provider, dir, error: null });
  const st = await statsOf(ids); job.total = st.left; job.done = 0; emit();
  try {
    for (const id of ids) {
      const m = await db.materials.get(id); if (!m) continue;
      m.trans = { ...(m.trans || {}), dir, provider, status: 'running', at: Date.now() }; await db.materials.save(m);
      let todo = pending(m.sentences, dir);
      for (let i = 0; i < todo.length; i += batch) {
        if (job.cancel) { m.trans.status = 'paused'; await db.materials.save(m); throw Object.assign(new Error('已暂停，进度已保存，可随时继续'), { code: 'PAUSED' }); }
        const part = todo.slice(i, i + batch); let res;
        try { res = await translateTexts(provider, part.map(s => srcOf(s, dir)), dir); }
        catch (e) { m.trans.status = 'paused'; m.trans.error = e.message; await db.materials.save(m); throw e; }
        part.forEach((s, k) => { const t = res[k]; const src = srcOf(s, dir); if (!plausible(src, t, dir)) { s.trFail = (s.trFail || 0) + 1; return; } if (dir === 'en2zh') s.zh = t.trim(); else { s.en = t.trim(); s.orig = 'zh'; } s.tr = provider; delete s.trFail; });
        m.updatedAt = Date.now(); await db.materials.save(m);
        job.done += part.length; emit();
      }
      const left = pending(m.sentences, dir).length; m.trans.status = left ? 'partial' : 'done'; m.trans.failed = left; delete m.trans.error; await db.materials.save(m);
    }
  } catch (e) { job.error = e; throw e; }
  finally { job.running = false; emit(); }
}
export function pause() { if (job.running) job.cancel = true; }
