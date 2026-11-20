// v1.9.4 AI 提示词与纯工具函数：前端（自己填的密钥）和服务器（内置 AI 代理）共用同一份，保证两条通路结果一致。
// 服务器只接受这里列出的任务（task + 参数），由服务器自己拼提示词 —— 内置 AI 不能被当成通用聊天接口白嫖。
// 纯函数，不碰 IndexedDB / DOM / 网络。
export class AIError extends Error { constructor(msg, code) { super(msg); this.code = code; } }
export const DEFAULT_BASE = 'https://api.openai.com/v1', DEFAULT_MODEL = 'gpt-4o-mini';
export const SYS = '你是为中国成年英语学习者服务的英语老师助手。只输出 JSON，不要多余文字。英文要地道自然，中文要准确简洁。';

/** 规范接口地址：补 https://、去掉多余斜杠和误贴的 /chat/completions；只有域名时补 /v1（OpenAI 官方地址必须带 /v1） */
export function normalizeBase(u) {
  let s = String(u || '').trim().replace(/[\s\u200b-\u200d\ufeff]+/g, '').replace(/[“”"'‘’]/g, '');
  if (!s) return DEFAULT_BASE;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  s = s.replace(/\/+(chat\/completions|completions|audio\/speech|audio\/transcriptions|models)\/*$/i, '').replace(/\/+$/, '');
  try { const x = new URL(s); x.pathname = x.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, ''); if (!x.pathname || x.pathname === '/') x.pathname = '/v1'; s = x.origin + x.pathname; } catch { }
  return s;
}
/** 规范密钥：去掉前后空格、换行、零宽字符、引号，以及误贴的 “Bearer ” 前缀 */
export const normalizeKey = k => String(k || '').normalize('NFKC').replace(/[\s\u00a0\u200b-\u200f\u2028\u2029\u2060\ufeff]+/g, '').replace(/^["'“”‘’「」]+|["'“”‘’「」]+$/g, '').replace(/^Bearer/i, '').replace(/[‐‑‒–—―−]/g, '-');
/** 密钥里不能出现的字符（HTTP 头只允许可见 ASCII；iPhone 粘贴偶尔夹带全角/中文/省略号）。返回问题描述或 '' */
export function badKeyChars(k) {
  const bad = [...String(k || '')].map((c, i) => ({ c, i })).filter(x => !/[\x21-\x7e]/.test(x.c));
  return bad.length ? bad.slice(0, 3).map(x => `第 ${x.i + 1} 个字符“${x.c}”(U+${x.c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')})`).join('、') : '';
}
/** 把 HTTP 错误翻成具体原因。ctx：{model, baseUrl}（只用来写提示，不含密钥） */
export function explainError(status, j, ctx = {}) {
  const e = j?.error || {}; const m = String(e.message || (typeof j?.error === 'string' ? j.error : '') || j?.message || ''); const code = String(e.code || e.type || '');
  if (status === 401) return new AIError('密钥无效（401）：请检查密钥是否完整、有没有多复制空格，或密钥已被删除。' + (m ? ' 服务返回：' + m : ''), 'AUTH');
  if (status === 403) return new AIError('没有权限（403）：密钥无权使用这个模型/接口，或所在地区不被支持。' + (m ? ' 服务返回：' + m : ''), 'AUTH');
  if (status === 429 && /insufficient_quota|quota|billing|balance|余额/i.test(code + ' ' + m)) return new AIError('余额不足（429 insufficient_quota）：这个账号没有可用额度，请到服务商后台充值或检查账单。', 'QUOTA');
  if (status === 429) return new AIError('请求太频繁（429）：稍等一会儿再试。' + (m ? ' 服务返回：' + m : ''), 'RATE');
  if (status === 404) return new AIError(/model/i.test(code + m) ? `模型不存在（404）：“${ctx?.model}”在这个接口上不可用，请换一个模型名。` + (m ? ' 服务返回：' + m : '') : `接口地址不对（404）：${ctx?.baseUrl}/chat/completions 不存在，请检查地址（一般以 /v1 结尾）。` + (m ? ' 服务返回：' + m : ''), 'NOT_FOUND');
  return new AIError(`AI 服务出错（${status}）${m ? '：' + m : ''}`, 'HTTP');
}
export function extractJSON(text) {
  const t = String(text || '').trim();
  try { return JSON.parse(t); } catch {}
  const f = t.match(/```(?:json)?\s*([\s\S]*?)```/i); if (f) try { return JSON.parse(f[1]); } catch {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a >= 0 && b > a) try { return JSON.parse(t.slice(a, b + 1)); } catch {}
  throw new AIError('AI 返回的内容不是有效的 JSON，请重试', 'BAD_FORMAT');
}

// ———— 各项 AI 功能的提示词（参数先规范成固定形状：服务器据此算缓存键、限长度） ————
const S = (v, max = 4000) => String(v ?? '').slice(0, max);
const SA = (a, n, max) => (Array.isArray(a) ? a : []).slice(0, n).map(x => S(x, max));
const DIR = d => d === 'zh2en' ? 'zh2en' : 'en2zh';
/** 每项任务：args(原始参数) → 规范参数；user(规范参数) → 用户消息；opt：temperature / timeout */
export const TASKS = {
  test: { args: () => ({}), user: () => '请只返回 JSON：{"ok":true}', opt: { timeout: 30000 } },
  scene: { name: '中文描述生成英文对话', args: a => ({ desc: S(a.desc, 2000), turns: Math.max(2, Math.min(20, +a.turns || 8)) }),
    user: a => `用户用中文描述了一个他实际遇到的情景：\n"""${a.desc}"""\n请写一段贴合该情景、口语地道的英文对话（约${a.turns}句），每句附中文翻译。` +
      `返回 JSON：{"title":"中文标题","tags":["场景标签"],"sentences":[{"speaker":"说话人(英文，如 Doctor)","en":"英文句子","zh":"中文翻译"}]}` },
  cards: { name: '生成词卡', args: a => ({ en: SA(a.en, 60, 600) }),
    user: a => `下面是用户自己的英文句子（带序号）。请挑出对中文母语成年学习者最值得学的生词和固定短语（总共约${Math.min(12, Math.max(4, a.en.length))}个，宁少勿滥，不要太简单的词），` +
      `给出该词在这个句子里的中文释义和 IPA 音标（单词才需要）。term 必须原样出现在对应句子里。\n${a.en.map((s, i) => `${i}. ${s}`).join('\n')}\n` +
      `返回 JSON：{"cards":[{"i":句子序号,"term":"词或短语","type":"word|phrase","zh":"中文释义","phonetic":"音标或空"}]}` },
  expr: { name: '地道表达', args: a => ({ en: S(a.en, 800), zh: S(a.zh, 800) }),
    user: a => `句子：${a.en}${a.zh ? '\n中文：' + a.zh : ''}\n请给出 3 种表达同一意思、母语者真会说的地道说法（可含口语/礼貌/简洁等不同语气），不改变事实和数字。` +
      `返回 JSON：{"expressions":[{"en":"英文","zh":"中文","tone":"语气，如 口语/礼貌/简洁","note":"一句中文用法提示"}]}` },
  fill: { name: '补齐翻译', args: a => ({ need: (Array.isArray(a.need) ? a.need : []).slice(0, 30).map(x => ({ i: +x.i || 0, en: S(x.en, 600), zh: S(x.zh, 600) })) }),
    user: a => `为下列每条补全缺失的那一种语言（缺 zh 就译成中文，缺 en 就译成地道英文），保留意思、数字和否定关系。\n${JSON.stringify(a.need)}\n返回 JSON：{"rows":[{"i":序号,"en":"英文","zh":"中文"}]}` },
  define: { name: '查词释义', args: a => ({ term: S(a.term, 80), sentence: S(a.sentence, 800) }),
    user: a => `句子：${a.sentence}\n请解释其中的 "${a.term}" 在这句话里的意思。返回 JSON：{"zh":"简洁中文释义","phonetic":"IPA 音标(单词才给，短语留空)"}` },
  analyze: { name: '语法与翻译方法', args: a => ({ en: S(a.en, 800), zh: S(a.zh, 800) }),
    user: a => `【语法分析】请为中国成年英语学习者分析下面这个句子，讲解要具体、简洁、用中文。\n句子：${a.en}${a.zh ? '\n参考译文：' + a.zh : ''}\n` +
      `返回 JSON：{"structure":[{"text":"原句中的一段原文","role":"句子成分，如 主语/谓语/宾语/定语/状语/补语/从句","zh":"这一段的中文意思"}],` +
      `"tense_voice":[{"label":"时态/语态/语气，如 一般过去时 被动语态","explain":"在这句里怎么判断"}],` +
      `"grammar_points":[{"name":"语法点","explain":"解释"}],` +
      `"translation_methods":[{"method":"翻译方法，如 语序调整/词性转换/拆句/合句/增译/省译/被动转主动","explain":"这句为什么/怎么用","before":"直译或原序","after":"调整后的自然中文"}],` +
      `"natural_zh":"自然的中文译文"}` },
  sense: { name: '义项判断', args: a => ({ term: S(a.term, 80), sentence: S(a.sentence, 800), senses: (Array.isArray(a.senses) ? a.senses : []).slice(0, 20).map(s => ({ pos: S(s.pos, 20), zh: S(s.zh, 200) })) }),
    user: a => { const list = a.senses.map((s, i) => `${i}. ${s.pos} ${s.zh}`).join('\n');
      return `【义项判断】句子：${a.sentence}\n词：${a.term}\n词典义项（带序号）：\n${list || '（词典没有该词）'}\n` +
      `请判断“${a.term}”在这句话里用的是哪个义项（给序号；若都不贴切或词典没有，index 填 -1 并在 meaning 里给出你的解释），说明理由，并给 2 个体现该义项的英文例句（带中文）。` +
      `返回 JSON：{"index":序号或-1,"meaning":"在本句中的中文意思","reason":"一句话理由","examples":[{"en":"例句","zh":"中文"}]}`; } },
  translate: { name: '翻译', args: a => ({ texts: SA(a.texts, 20, 1200), dir: DIR(a.dir) }),
    user: a => `【逐句翻译】把下面 JSON 数组里的每一句分别译成${a.dir === 'en2zh' ? '简体中文（自然、准确，保留人名地名）' : '地道自然的英文（适合中国学习者模仿，保留意思、数字和否定关系）'}。一句对一句，不要合并、拆分或省略。\n${JSON.stringify(a.texts)}\n返回 JSON：{"t":["第1句译文","第2句译文",...]}，数组长度必须是 ${a.texts.length}。`, opt: { temperature: 0.2 } },
  align: { name: '拆分对齐', args: a => ({ pieces: SA(a.pieces, 20, 1200), other: S(a.other, 3000), dir: DIR(a.dir) }),
    user: a => `【译文对齐】一句原文被用户拆成了 ${a.pieces.length} 段，它原来有一整句${a.dir === 'en2zh' ? '中文' : '英文'}译文。请把这句译文按原文的分段切成对应的 ${a.pieces.length} 段：每段只包含对应那段原文的意思。` +
      `尽量直接切开原译文、保留原用字；只有语序必须调整时才微调措辞，不要重新翻译、不要遗漏或增加意思。\n原文各段：${JSON.stringify(a.pieces)}\n原译文：${a.other}\n` +
      `返回 JSON：{"t":["第1段译文",...],"changed":是否改动了措辞(true/false)}，数组长度必须是 ${a.pieces.length}。`, opt: { temperature: 0.1, timeout: 60000 } },
  judge: { name: '翻译题判分', args: a => ({ src: S(a.src, 1200), ref: S(a.ref, 1200), answer: S(a.answer, 1200), dir: DIR(a.dir) }),
    user: a => `【作答判分】学习者在做${a.dir === 'en2zh' ? '英译中' : '中译英'}练习。原文：${a.src}\n${a.ref ? '参考译文：' + a.ref + '\n' : ''}学习者的答案：${a.answer}\n` +
      `请只看意思是否准确完整（不要求和参考译文字面一致；口语、同义说法都算对；漏掉关键信息、否定/时态/主语弄反算错）。` +
      `返回 JSON：{"score":0-100的整数,"ok":true或false,"comment":"一句中文点评（指出漏掉或弄错的地方）","better":"更好的说法（可选）"}`, opt: { temperature: 0.1, timeout: 45000 } },
  pquiz: { name: '阅读理解出题', args: a => ({ en: S(a.en, 2000), zh: S(a.zh, 2000) }),
    user: a => `【阅读理解出题】下面是学习者自己材料里的一小段英文${a.zh ? '（附参考译文）' : ''}。请出一道考“读懂这段话”的单选题：问题和选项都用简体中文，` +
      `考段落的要点、细节、因果或推断（不要考单个词的字面翻译，不要出原文没有依据的题）；4 个选项，只有 1 个正确，干扰项要看起来合理但和原文不符。\n` +
      `英文：${a.en}\n${a.zh ? '参考译文：' + a.zh + '\n' : ''}返回 JSON：{"q":"问题","options":["A","B","C","D"],"answer":正确选项的下标(0-3),"why":"一句话说明依据（引用原文）"}`, opt: { temperature: 0.3, timeout: 60000 } },
};
/** 内置 AI（服务器代理）接受的任务（test 只给管理员「测试连接」用） */
export const PUBLIC_TASKS = Object.keys(TASKS).filter(k => k !== 'test');
/** 拼出一次请求：{args(规范后), messages, temperature, timeout} */
export function build(task, rawArgs = {}) {
  const T = TASKS[task]; if (!T) throw new AIError('不支持的 AI 功能：' + task, 'BAD_TASK');
  const args = T.args(rawArgs || {});
  return { task, args, messages: [{ role: 'system', content: SYS }, { role: 'user', content: T.user(args) }], temperature: T.opt?.temperature ?? 0.4, timeout: T.opt?.timeout ?? 120000 };
}
// ———— AI 自然语音（/audio/speech） ————
export const AI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'];
export const AI_TTS_MODEL = 'gpt-4o-mini-tts';
export function speechBody({ text, model = AI_TTS_MODEL, voice = 'coral', accent = 'auto' }) {
  const body = { model, voice: AI_VOICES.includes(voice) ? voice : 'coral', input: String(text || ''), response_format: 'mp3' };
  if (/^gpt-4o/i.test(model) && accent && accent !== 'auto') body.instructions = `Speak clearly at a natural pace with a ${{ 'en-US': 'General American', 'en-GB': 'British (Received Pronunciation)', 'en-AU': 'Australian' }[accent] || 'General American'} English accent.`;
  return body;
}
