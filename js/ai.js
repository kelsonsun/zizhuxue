// AI：兼容 OpenAI 的 /chat/completions 接口。两条通路（都是真的 AI，绝不造假结果）：
//  ① 自己填的密钥（地址/密钥/模型由用户填写，密钥只存本机 IndexedDB，不进导出备份）——优先用；
//  ② v1.9.4 内置 AI：没填密钥时，经自主学服务器代理（密钥只在服务器上，不下发到网页；服务器按设备限额度、缓存、控花费）。
// 两条都不可用（服务器 AI 未开 / 离线）时所有 AI 功能直接拒绝（NOT_CONFIGURED），按钮显示“未配置AI，无法生成”。
import * as db from './db.js';
import * as P from './aiprompts.js';
import { aiUrl } from './endpoint.js';
import { APP_VERSION } from './version.js';
export const NOT_CONFIGURED_MSG = '未配置AI，无法生成';
export const { AIError, DEFAULT_BASE, DEFAULT_MODEL, normalizeBase, normalizeKey, badKeyChars, extractJSON } = P;
let cfg = null;
export async function loadConfig() {
  cfg = await db.meta.get('ai', null);
  // 旧版本保存的配置也规范一遍（地址缺 /v1、密钥带空格、模型留空等）
  if (cfg && cfg.apiKey) cfg = { ...cfg, baseUrl: normalizeBase(cfg.baseUrl), apiKey: normalizeKey(cfg.apiKey), model: String(cfg.model || '').trim() || DEFAULT_MODEL };
  initBuiltin();
  return cfg;
}
export function getConfig() { return cfg; }
const errInfo = e => e ? `${e.name || 'Error'}: ${e.message || e}` : '';
/**
 * 带密钥请求 AI 接口：先校验密钥字符；超时可控；网络失败时再做一次“不带密钥的简单请求”探测，
 * 区分“网络不通”和“服务器能连上但带密钥的请求被拦截（CORS 预检/非法头）”，报错写清楚具体原因。
 */
export async function aiFetch(path, body, { timeout = 120000 } = {}) {
  const c = cfg; const bad = badKeyChars(c.apiKey);
  if (bad) throw new AIError(`密钥里有不能用的字符：${bad}。请删掉密钥重新粘贴（只应包含英文字母、数字和 - _ 等符号）。`, 'KEY_CHARS');
  const url = c.baseUrl + path; const ac = new AbortController(); const to = setTimeout(() => ac.abort(), timeout);
  try { return await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.apiKey }, body: JSON.stringify(body), signal: ac.signal }); }
  catch (e) {
    if (e?.name === 'AbortError') throw new AIError(`AI 服务 ${Math.round(timeout / 1000)} 秒没有响应（超时），请稍后重试或换个更快的模型。`, 'TIMEOUT');
    if (/header|ISO-8859|code point|invalid value/i.test(e?.message || '')) throw new AIError(`密钥格式不对，浏览器拒绝发送（${errInfo(e)}）。请删掉密钥重新粘贴。`, 'KEY_CHARS');
    if (globalThis.navigator && navigator.onLine === false) throw new AIError('设备现在离线，请联网后再试。', 'OFFLINE');
    let probe = null; const ac2 = new AbortController(); const t2 = setTimeout(() => ac2.abort(), 10000);
    try { await fetch(c.baseUrl + '/models', { mode: 'no-cors', signal: ac2.signal }); probe = 'ok'; } catch { probe = null; } finally { clearTimeout(t2); }
    let host = c.baseUrl; try { host = new URL(c.baseUrl).host; } catch { }
    if (probe == null) throw new AIError(`网络连不上 ${host}：可能是网络/代理/VPN、广告或内容拦截器、iCloud 私有中继，或所在网络无法访问该服务。请换个网络（如关掉 VPN、Wi-Fi 与蜂窝网络互换）再点「测试连接」。（浏览器错误：${errInfo(e)}）`, 'NETWORK');
    throw new AIError(`能连上 ${host}（不带密钥的探测请求能到达服务器），但带密钥的请求被浏览器拦截了（CORS 预检失败）。常见原因：接口地址不是 OpenAI 兼容地址，或该服务不允许网页直接调用，或被内容拦截器改写。（浏览器错误：${errInfo(e)}）`, 'CORS');
  } finally { clearTimeout(to); }
}
/** 自己填了密钥 */
export function hasOwnKey() { return !!(cfg && cfg.baseUrl && cfg.apiKey && cfg.model); }
/** 有 AI 可用：自己的密钥，或内置 AI（服务器开着、在线） */
export function isConfigured() { return hasOwnKey() || builtinReady(); }
/** 这次会走内置 AI（没填密钥、服务器 AI 可用） */
export const usingBuiltin = () => !hasOwnKey() && builtinReady();
export async function saveConfig(c) {
  cfg = { ...(cfg || {}), ...c, baseUrl: normalizeBase(c.baseUrl), apiKey: normalizeKey(c.apiKey), model: String(c.model || '').trim() || DEFAULT_MODEL };
  await db.meta.set('ai', cfg);
}
export async function clearConfig() { cfg = null; await db.meta.set('ai', null); }

/** 把 HTTP 错误翻成具体原因（带上当前模型 / 地址，不含密钥） */
export const explainError = (status, j) => P.explainError(status, j, { model: cfg?.model, baseUrl: cfg?.baseUrl });

/** 用自己的密钥调 /chat/completions */
async function chat(messages, { json = true, temperature = 0.4, timeout = 120000 } = {}) {
  if (!hasOwnKey()) throw new AIError(NOT_CONFIGURED_MSG, 'NOT_CONFIGURED');
  const call = ({ fmt, temp }) => aiFetch('/chat/completions', { model: cfg.model, messages, ...(temp ? { temperature } : {}), ...(fmt && json ? { response_format: { type: 'json_object' } } : {}) }, { timeout });
  // 有的模型不支持 temperature（如推理模型）或 response_format：遇到 400/422 依次去掉再试
  let r = await call({ fmt: true, temp: true });
  for (const opt of [{ fmt: false, temp: true }, { fmt: false, temp: false }]) { if (r.status !== 400 && r.status !== 422) break; r = await call(opt); }
  if (!r.ok) { let j = null; try { j = await r.json(); } catch { } throw explainError(r.status, j); }
  let data; try { data = await r.json(); } catch { throw new AIError('AI 服务返回了无法解析的响应（可能地址指向了网页而不是接口）', 'BAD_FORMAT'); }
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new AIError('AI 服务没有返回内容', 'BAD_FORMAT');
  return json ? extractJSON(content) : content;
}

// ———— v1.9.4 内置 AI（服务器代理） ————
const SK = 'zzx.aisrv', DK = 'zzx.aiid';
let srv = null; let statusJob = null;
const ls = () => { try { return globalThis.localStorage || null; } catch { return null; } };
const online = () => !(globalThis.navigator && navigator.onLine === false);
/** 服务器 AI 接口地址（deploy.js 的 AI_URL，按 endpoint.js 规则过滤；本机开发页面 / 自动化浏览器不连公网服务器） */
export const builtinUrl = () => { try { return aiUrl(); } catch { return ''; } };
/** 内置 AI 的状态（上次从服务器拿到的，存在 localStorage，启动时不用等网络） */
export const builtinStatus = () => srv;
export const builtinReady = () => !!(srv?.enabled && builtinUrl() && online());
/** 启动时（和以后每 30 分钟）问一次服务器：内置 AI 开着没有、额度多少。离线不请求。 */
export function initBuiltin({ force = false } = {}) {
  const u = builtinUrl();
  if (!u) { srv = null; return Promise.resolve(null); }
  if (!srv) { try { const c = JSON.parse(ls()?.getItem(SK) || 'null'); if (c && c.url === u) srv = c; } catch { } }
  if (!online()) return Promise.resolve(srv);
  if (statusJob) return statusJob;
  if (!force && srv?.at && Date.now() - srv.at < 30 * 60000) return Promise.resolve(srv);
  statusJob = (async () => {
    try {
      const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 8000);
      const r = await fetch(u + 'status', { signal: ac.signal, credentials: 'omit', cache: 'no-store' }).finally(() => clearTimeout(to));
      const was = !!srv?.enabled; const j = await r.json(); srv = { ...j, enabled: !!(r.ok && j.enabled), url: u, at: Date.now() }; try { ls()?.setItem(SK, JSON.stringify(srv)); } catch { }
      if (was !== srv.enabled) globalThis.dispatchEvent?.(new Event('zzx-ai-status')); // 内置 AI 开 / 关变了：界面刷新按钮状态
    } catch { /* 连不上：沿用上次的状态（真调用时如实报错） */ }
    finally { statusJob = null; }
    return srv;
  })();
  return statusJob;
}
/** 内置 AI 用的匿名设备 ID（只用来按设备算额度；服务器只存它的加盐哈希） */
export function builtinDeviceId() {
  const s = ls(); let id = s?.getItem(DK) || '';
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) { const a = new Uint8Array(16); crypto.getRandomValues(a); id = 'a_' + [...a].map(b => b.toString(16).padStart(2, '0')).join(''); try { s?.setItem(DK, id); } catch { } }
  return id;
}
const SRV_MSG = {
  quota_device: '今天内置 AI 的免费额度用完了（每台设备每天有上限），明天自动恢复。也可以在「我的 → AI 设置」填自己的密钥继续用。',
  quota_month: '这个月内置 AI 的免费额度用完了，下个月自动恢复。也可以在「我的 → AI 设置」填自己的密钥继续用。',
  budget: '内置 AI 本月的总额度已经用完（开发者设的花费上限），下个月恢复。也可以在「我的 → AI 设置」填自己的密钥继续用。',
  ai_off: '内置 AI 暂时关闭了。可以在「我的 → AI 设置」填自己的密钥使用。',
  rate_limited: '用得太快了，请稍等一会儿再试。',
  too_big: '内容太长了，内置 AI 一次处理不了，请分成小段再试。',
};
async function srvPost(path, body, timeout) {
  const u = builtinUrl(); if (!u) throw new AIError(NOT_CONFIGURED_MSG, 'NOT_CONFIGURED');
  if (!online()) throw new AIError('设备现在离线，内置 AI 需要联网。请联网后再试。', 'OFFLINE');
  const ac = new AbortController(); const to = setTimeout(() => ac.abort(), timeout + 5000);
  let r;
  try { r = await fetch(u + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, d: builtinDeviceId(), v: APP_VERSION }), signal: ac.signal, credentials: 'omit' }); }
  catch (e) { throw e?.name === 'AbortError' ? new AIError('内置 AI 太久没有响应（超时），请稍后再试。', 'TIMEOUT') : new AIError('连不上自主学服务器的内置 AI（请检查网络后再试）。', 'NETWORK'); }
  finally { clearTimeout(to); }
  return r;
}
async function srvError(r) {
  let j = null; try { j = await r.json(); } catch { }
  const code = j?.code || 'error';
  if (code === 'ai_off') { srv = { ...(srv || {}), enabled: false, at: Date.now() }; try { ls()?.setItem(SK, JSON.stringify(srv)); } catch { } }
  return new AIError(SRV_MSG[code] || ('内置 AI 出错：' + (j?.error || ('HTTP ' + r.status))), 'SRV_' + code.toUpperCase());
}
/** 内置 AI 的错误：额度 / 花费上限 / 关闭 / 服务器出错（这些时候可以改用免费翻译） */
export const isBuiltinFallback = e => /^SRV_|^NETWORK$|^TIMEOUT$/.test(e?.code || '');
async function srvRun(task, args, timeout) {
  const r = await srvPost('run', { task, args }, timeout);
  if (!r.ok) throw await srvError(r);
  const j = await r.json(); if (j?.r == null) throw new AIError('内置 AI 没有返回内容', 'BAD_FORMAT');
  return j.r;
}
/** 内置 AI 语音：返回 mp3 Blob */
export async function builtinSpeech({ text, voice, accent }) {
  const r = await srvPost('speech', { text, voice, accent }, 30000);
  if (!r.ok) throw await srvError(r);
  const b = await r.blob(); if (!b.size) throw new AIError('内置 AI 语音返回了空音频', 'BAD_FORMAT'); return b;
}
/** 自己的密钥调用成功 / 失败次数（不含内容）顺带进匿名统计 */
const ownStat = ok => import('./telemetry.js').then(T => T.track(ok ? 'ai_own_ok' : 'ai_own_fail')).catch(() => { });
/** 跑一项 AI 功能：自己的密钥优先；没有就走内置 AI；都没有 → NOT_CONFIGURED */
async function run(task, rawArgs) {
  const b = P.build(task, rawArgs);
  if (hasOwnKey()) {
    try { const r = await chat(b.messages, { temperature: b.temperature, timeout: b.timeout }); ownStat(true); return r; }
    catch (e) { if (e.code !== 'NOT_CONFIGURED') ownStat(false); throw e; }
  }
  if (builtinReady()) return srvRun(task, b.args, b.timeout);
  throw new AIError(online() || !builtinUrl() || !srv?.enabled ? NOT_CONFIGURED_MSG : '设备现在离线，内置 AI 需要联网。', online() ? 'NOT_CONFIGURED' : 'OFFLINE');
}

const str = v => (typeof v === 'string' ? v.trim() : '');

export async function testConnection() {
  const r = await chat(P.build('test').messages, { timeout: 30000 });
  if (r?.ok !== true) throw new AIError('已连通，但返回内容不符合预期', 'BAD_FORMAT');
  // 再试一句真实翻译，确认“翻译”功能可用
  const t = await translateBatch(['Good morning.'], 'en2zh');
  return { ok: true, sample: t[0], baseUrl: cfg.baseUrl, model: cfg.model };
}

/** 用中文描述实际情景 → 英文情景对话。 */
export async function generateScene(desc, { turns = 8 } = {}) {
  const r = await run('scene', { desc, turns });
  const ss = (r?.sentences || []).map(s => ({ speaker: str(s.speaker), en: str(s.en), zh: str(s.zh) })).filter(s => s.en);
  if (!ss.length) throw new AIError('AI 没有生成有效的对话，请换个描述再试', 'BAD_FORMAT');
  return { title: str(r.title) || '情景对话', tags: Array.isArray(r.tags) ? r.tags.map(str).filter(Boolean).slice(0, 4) : [], sentences: ss };
}

/** 从用户自己的句子里挑生词/短语并给中文释义。返回的词必须真实出现在对应句子中，否则丢弃。 */
export async function generateCards(sentences) {
  const r = await run('cards', { en: sentences.map(s => s.en) });
  const out = [];
  for (const c of r?.cards || []) {
    const i = Number(c.i), s = sentences[i]; const term = str(c.term), zh = str(c.zh);
    if (!s || !term || !zh) continue;
    if (!s.en.toLowerCase().includes(term.toLowerCase())) continue;
    out.push({ i, term, zh, type: c.type === 'phrase' || /\s/.test(term) ? 'phrase' : 'word', phonetic: str(c.phonetic) });
  }
  if (!out.length) throw new AIError('AI 没有给出可用的词卡（返回内容与句子对不上），请重试', 'BAD_FORMAT');
  return out;
}

/** 地道表达：给一句话，给出更地道/不同语气的说法。 */
export async function generateExpressions(sentence) {
  const r = await run('expr', { en: sentence.en, zh: sentence.zh || '' });
  const ex = (r?.expressions || []).map(e => ({ en: str(e.en), zh: str(e.zh), tone: str(e.tone), note: str(e.note) })).filter(e => e.en);
  if (!ex.length) throw new AIError('AI 没有给出可用的表达，请重试', 'BAD_FORMAT');
  return ex;
}

/** 补齐翻译：给缺中文（或缺英文）的句子补上另一语言。 */
export async function fillTranslations(rows) {
  const need = rows.map((s, i) => ({ i, en: s.en, zh: s.zh })).filter(x => !x.zh || !x.en);
  if (!need.length) return [];
  const r = await run('fill', { need });
  const out = [];
  for (const x of r?.rows || []) { const i = Number(x.i); if (rows[i] && need.some(n => n.i === i)) out.push({ i, en: str(x.en), zh: str(x.zh) }); }
  if (!out.length) throw new AIError('AI 没有返回可用的翻译，请重试', 'BAD_FORMAT');
  return out;
}

/** 单词/短语在句中的释义。 */
export async function defineTerm(term, sentence) {
  const r = await run('define', { term, sentence });
  const zh = str(r?.zh); if (!zh) throw new AIError('AI 没有返回释义', 'BAD_FORMAT');
  return { zh, phonetic: str(r.phonetic) };
}

/** 句子语法与翻译方法解析。返回结构里的“成分文本”必须真实出现在原句中，否则丢弃。 */
export async function analyzeSentence(sentence) {
  const r = await run('analyze', { en: sentence.en, zh: sentence.zh || '' });
  const arr = (a) => (Array.isArray(a) ? a : []);
  const low = sentence.en.toLowerCase().replace(/\s+/g, ' ');
  const out = {
    structure: arr(r?.structure).map(x => ({ text: str(x.text), role: str(x.role), zh: str(x.zh) })).filter(x => x.text && x.role && low.includes(x.text.toLowerCase().replace(/\s+/g, ' '))),
    tense_voice: arr(r?.tense_voice).map(x => ({ label: str(x.label), explain: str(x.explain) })).filter(x => x.label),
    grammar_points: arr(r?.grammar_points).map(x => ({ name: str(x.name), explain: str(x.explain) })).filter(x => x.name),
    translation_methods: arr(r?.translation_methods).map(x => ({ method: str(x.method), explain: str(x.explain), before: str(x.before), after: str(x.after) })).filter(x => x.method),
    natural_zh: str(r?.natural_zh), at: Date.now(),
  };
  if (!out.structure.length && !out.tense_voice.length && !out.grammar_points.length && !out.translation_methods.length) throw new AIError('AI 没有给出可用的解析，请重试', 'BAD_FORMAT');
  return out;
}

/** 判断词在原句中用的是哪个义项（义项列表来自离线词典），并补例句。index 必须落在给定义项范围内，否则视为“无法判断”。 */
export async function explainSense(term, sentence, senses) {
  const r = await run('sense', { term, sentence, senses });
  let idx = Number(r?.index); if (!Number.isInteger(idx) || idx < -1 || idx >= senses.length) idx = -1;
  const examples = (Array.isArray(r?.examples) ? r.examples : []).map(e => ({ en: str(e.en), zh: str(e.zh) })).filter(e => e.en);
  const meaning = str(r?.meaning);
  if (idx < 0 && !meaning) throw new AIError('AI 没有给出可用的义项判断', 'BAD_FORMAT');
  return { index: idx, meaning, reason: str(r?.reason), examples, at: Date.now() };
}

/** 【逐句翻译】texts: string[]，dir: 'en2zh'|'zh2en'。返回等长译文数组；条数不对或缺项视为失败。 */
export async function translateBatch(texts, dir) {
  const r = await run('translate', { texts, dir });
  const t = Array.isArray(r?.t) ? r.t.map(str) : [];
  if (t.length !== texts.length || t.some(x => !x)) throw new AIError('AI 返回的译文条数不对，请重试', 'BAD_FORMAT');
  return t;
}

/** v1.6【译文对齐】拆分一句时：把已有的整句译文按原文各段切开（不重新翻译，只在必要时微调连接词/标点）。返回等长数组。 */
export async function alignSplit(srcPieces, other, dir = 'en2zh') {
  const r = await run('align', { pieces: srcPieces, other, dir });
  const t = Array.isArray(r?.t) ? r.t.map(str) : [];
  if (t.length !== srcPieces.length || t.some(x => !x)) throw new AIError('AI 返回的分段条数不对', 'BAD_FORMAT');
  return { t, changed: !!r.changed };
}

/** v1.6【作答判分】翻译题：判断学习者的译文意思对不对（意思对、说法不同也算对）。返回 {score 0-100, ok, comment, better}。 */
export async function judgeTranslation({ src, ref = '', answer, dir }) {
  const r = await run('judge', { src, ref, answer, dir });
  const score = Math.max(0, Math.min(100, Math.round(+r?.score)));
  if (!Number.isFinite(score)) throw new AIError('AI 没有给出分数', 'BAD_FORMAT');
  return { score, ok: typeof r.ok === 'boolean' ? r.ok : score >= 70, comment: str(r.comment), better: str(r.better) };
}

/** v1.6【阅读理解出题】给一段用户自己材料里的英文（2–4 句），出一道中文的理解选择题。返回 {q, options[], answer(下标), why}（格式由调用方检查）。 */
export async function passageQuiz(en, zh = '') {
  return run('pquiz', { en, zh });
}
