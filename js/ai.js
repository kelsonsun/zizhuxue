// AI：兼容 OpenAI 的 /chat/completions 接口。地址/密钥/模型由用户填写，密钥只存本机 IndexedDB（不进导出备份）。
// 未配置时所有 AI 功能直接拒绝（NOT_CONFIGURED），绝不产生任何“假结果”。本文件不读取任何环境变量。
import * as db from './db.js';
export const NOT_CONFIGURED_MSG = '未配置AI，无法生成';
export class AIError extends Error { constructor(msg, code) { super(msg); this.code = code; } }
let cfg = null;
export async function loadConfig() { cfg = await db.meta.get('ai', null); return cfg; }
export function getConfig() { return cfg; }
export function isConfigured() { return !!(cfg && cfg.baseUrl && cfg.apiKey && cfg.model); }
export async function saveConfig(c) {
  cfg = { baseUrl: (c.baseUrl || '').trim().replace(/\/+$/, ''), apiKey: (c.apiKey || '').trim(), model: (c.model || '').trim() };
  await db.meta.set('ai', cfg);
}
export async function clearConfig() { cfg = null; await db.meta.set('ai', null); }

function extractJSON(text) {
  const t = String(text || '').trim();
  try { return JSON.parse(t); } catch {}
  const f = t.match(/```(?:json)?\s*([\s\S]*?)```/i); if (f) try { return JSON.parse(f[1]); } catch {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a >= 0 && b > a) try { return JSON.parse(t.slice(a, b + 1)); } catch {}
  throw new AIError('AI 返回的内容不是有效的 JSON，请重试', 'BAD_FORMAT');
}

async function chat(messages, { json = true, temperature = 0.4 } = {}) {
  if (!isConfigured()) throw new AIError(NOT_CONFIGURED_MSG, 'NOT_CONFIGURED');
  const url = cfg.baseUrl + '/chat/completions';
  const body = { model: cfg.model, messages, temperature };
  const call = async (withFmt) => {
    const b = withFmt && json ? { ...body, response_format: { type: 'json_object' } } : body;
    let r;
    try { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey }, body: JSON.stringify(b) }); }
    catch { throw new AIError('连不上 AI 服务：请检查接口地址和网络；若地址正确，可能是该服务不允许浏览器直接访问（CORS）。', 'NETWORK'); }
    return r;
  };
  let r = await call(true);
  if ((r.status === 400 || r.status === 422) && json) r = await call(false);
  if (r.status === 401 || r.status === 403) throw new AIError('AI 服务拒绝了密钥（' + r.status + '），请检查密钥是否正确', 'AUTH');
  if (!r.ok) { let m = ''; try { m = (await r.json())?.error?.message || ''; } catch {} throw new AIError(`AI 服务出错（${r.status}）${m ? '：' + m : ''}`, 'HTTP'); }
  let data; try { data = await r.json(); } catch { throw new AIError('AI 服务返回了无法解析的响应', 'BAD_FORMAT'); }
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new AIError('AI 服务没有返回内容', 'BAD_FORMAT');
  return json ? extractJSON(content) : content;
}

const SYS = '你是为中国成年英语学习者服务的英语老师助手。只输出 JSON，不要多余文字。英文要地道自然，中文要准确简洁。';
const str = v => (typeof v === 'string' ? v.trim() : '');

export async function testConnection() {
  const r = await chat([{ role: 'system', content: SYS }, { role: 'user', content: '请只返回 JSON：{"ok":true}' }]);
  if (r?.ok !== true) throw new AIError('已连通，但返回内容不符合预期', 'BAD_FORMAT');
  return true;
}

/** 用中文描述实际情景 → 英文情景对话。 */
export async function generateScene(desc, { turns = 8 } = {}) {
  const r = await chat([{ role: 'system', content: SYS }, { role: 'user', content:
    `用户用中文描述了一个他实际遇到的情景：\n"""${desc}"""\n请写一段贴合该情景、口语地道的英文对话（约${turns}句），每句附中文翻译。` +
    `返回 JSON：{"title":"中文标题","tags":["场景标签"],"sentences":[{"speaker":"说话人(英文，如 Doctor)","en":"英文句子","zh":"中文翻译"}]}` }]);
  const ss = (r?.sentences || []).map(s => ({ speaker: str(s.speaker), en: str(s.en), zh: str(s.zh) })).filter(s => s.en);
  if (!ss.length) throw new AIError('AI 没有生成有效的对话，请换个描述再试', 'BAD_FORMAT');
  return { title: str(r.title) || '情景对话', tags: Array.isArray(r.tags) ? r.tags.map(str).filter(Boolean).slice(0, 4) : [], sentences: ss };
}

/** 从用户自己的句子里挑生词/短语并给中文释义。返回的词必须真实出现在对应句子中，否则丢弃。 */
export async function generateCards(sentences) {
  const list = sentences.map((s, i) => `${i}. ${s.en}`).join('\n');
  const r = await chat([{ role: 'system', content: SYS }, { role: 'user', content:
    `下面是用户自己的英文句子（带序号）。请挑出对中文母语成年学习者最值得学的生词和固定短语（总共约${Math.min(12, Math.max(4, sentences.length))}个，宁少勿滥，不要太简单的词），` +
    `给出该词在这个句子里的中文释义和 IPA 音标（单词才需要）。term 必须原样出现在对应句子里。\n${list}\n` +
    `返回 JSON：{"cards":[{"i":句子序号,"term":"词或短语","type":"word|phrase","zh":"中文释义","phonetic":"音标或空"}]}` }]);
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
  const r = await chat([{ role: 'system', content: SYS }, { role: 'user', content:
    `句子：${sentence.en}${sentence.zh ? '\n中文：' + sentence.zh : ''}\n请给出 3 种表达同一意思、母语者真会说的地道说法（可含口语/礼貌/简洁等不同语气），不改变事实和数字。` +
    `返回 JSON：{"expressions":[{"en":"英文","zh":"中文","tone":"语气，如 口语/礼貌/简洁","note":"一句中文用法提示"}]}` }]);
  const ex = (r?.expressions || []).map(e => ({ en: str(e.en), zh: str(e.zh), tone: str(e.tone), note: str(e.note) })).filter(e => e.en);
  if (!ex.length) throw new AIError('AI 没有给出可用的表达，请重试', 'BAD_FORMAT');
  return ex;
}

/** 补齐翻译：给缺中文（或缺英文）的句子补上另一语言。 */
export async function fillTranslations(rows) {
  const need = rows.map((s, i) => ({ i, en: s.en, zh: s.zh })).filter(x => !x.zh || !x.en);
  if (!need.length) return [];
  const r = await chat([{ role: 'system', content: SYS }, { role: 'user', content:
    `为下列每条补全缺失的那一种语言（缺 zh 就译成中文，缺 en 就译成地道英文），保留意思、数字和否定关系。\n${JSON.stringify(need)}\n返回 JSON：{"rows":[{"i":序号,"en":"英文","zh":"中文"}]}` }]);
  const out = [];
  for (const x of r?.rows || []) { const i = Number(x.i); if (rows[i] && need.some(n => n.i === i)) out.push({ i, en: str(x.en), zh: str(x.zh) }); }
  if (!out.length) throw new AIError('AI 没有返回可用的翻译，请重试', 'BAD_FORMAT');
  return out;
}

/** 单词/短语在句中的释义。 */
export async function defineTerm(term, sentence) {
  const r = await chat([{ role: 'system', content: SYS }, { role: 'user', content:
    `句子：${sentence}\n请解释其中的 "${term}" 在这句话里的意思。返回 JSON：{"zh":"简洁中文释义","phonetic":"IPA 音标(单词才给，短语留空)"}` }]);
  const zh = str(r?.zh); if (!zh) throw new AIError('AI 没有返回释义', 'BAD_FORMAT');
  return { zh, phonetic: str(r.phonetic) };
}

/** 句子语法与翻译方法解析。返回结构里的“成分文本”必须真实出现在原句中，否则丢弃。 */
export async function analyzeSentence(sentence) {
  const r = await chat([{ role: 'system', content: SYS }, { role: 'user', content:
    `【语法分析】请为中国成年英语学习者分析下面这个句子，讲解要具体、简洁、用中文。\n句子：${sentence.en}${sentence.zh ? '\n参考译文：' + sentence.zh : ''}\n` +
    `返回 JSON：{"structure":[{"text":"原句中的一段原文","role":"句子成分，如 主语/谓语/宾语/定语/状语/补语/从句","zh":"这一段的中文意思"}],` +
    `"tense_voice":[{"label":"时态/语态/语气，如 一般过去时 被动语态","explain":"在这句里怎么判断"}],` +
    `"grammar_points":[{"name":"语法点","explain":"解释"}],` +
    `"translation_methods":[{"method":"翻译方法，如 语序调整/词性转换/拆句/合句/增译/省译/被动转主动","explain":"这句为什么/怎么用","before":"直译或原序","after":"调整后的自然中文"}],` +
    `"natural_zh":"自然的中文译文"}` }]);
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
  const list = senses.map((s, i) => `${i}. ${s.pos} ${s.zh}`).join('\n');
  const r = await chat([{ role: 'system', content: SYS }, { role: 'user', content:
    `【义项判断】句子：${sentence}\n词：${term}\n词典义项（带序号）：\n${list || '（词典没有该词）'}\n` +
    `请判断“${term}”在这句话里用的是哪个义项（给序号；若都不贴切或词典没有，index 填 -1 并在 meaning 里给出你的解释），说明理由，并给 2 个体现该义项的英文例句（带中文）。` +
    `返回 JSON：{"index":序号或-1,"meaning":"在本句中的中文意思","reason":"一句话理由","examples":[{"en":"例句","zh":"中文"}]}` }]);
  let idx = Number(r?.index); if (!Number.isInteger(idx) || idx < -1 || idx >= senses.length) idx = -1;
  const examples = (Array.isArray(r?.examples) ? r.examples : []).map(e => ({ en: str(e.en), zh: str(e.zh) })).filter(e => e.en);
  const meaning = str(r?.meaning);
  if (idx < 0 && !meaning) throw new AIError('AI 没有给出可用的义项判断', 'BAD_FORMAT');
  return { index: idx, meaning, reason: str(r?.reason), examples, at: Date.now() };
}
