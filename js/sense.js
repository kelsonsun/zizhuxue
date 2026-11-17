// 释义显示与“语境义项”：
//  · 释义只在义项/词义边界精简（绝不在字中间截断、不留尾逗号），并可展开看全部；
//  · 题目里给的释义优先选与原句中该词词性一致的义项（本地词性标注 + 离线词典按词性挑）。
import * as dict from './dict.js';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** 词性归一：vt./vi./v. → v；a./adj. → a；ad./adv. → adv … 方括号领域标签（如 [计]）→ 'dom' */
export function posKey(p) {
  const s = String(p || '').toLowerCase().replace(/\s/g, '');
  if (!s) return '';
  if (s.startsWith('[')) return 'dom';
  if (/^v(t|i)?\.?$|^aux/.test(s)) return 'v';
  if (/^(a|adj|s)\.?$/.test(s)) return 'a';
  if (/^(ad|adv)\.?$/.test(s)) return 'adv';
  return s.replace(/\.$/, '');
}
/** 把一段释义拆成词义条目（按逗号、顿号、分号；保留“决定...的位置”这类条目完整） */
export const items = zh => String(zh || '').split(/\s*[,，;；、]\s*/).map(x => x.trim()).filter(Boolean);
/** 把任意释义字符串拆成义项：支持 ECDICT 的 “n. a, b | vt. c” 与卡片里的 “n. a, b；vt. c” */
export function parse(zh) {
  const t = String(zh || '').trim(); if (!t) return [];
  const parts = t.split(/\s*\|\s*|\s*；\s*(?=(?:[a-z]+\.|\[[^\]]+\]))/i);
  return parts.map(x => x.trim()).filter(Boolean).map(line => {
    const m = line.match(/^((?:[a-z]+\.)|(?:\[[^\]]+\]))\s*(.*)$/i);
    return m ? { pos: m[1], zh: m[2].replace(/[,，;；、\s]+$/, '') } : { pos: '', zh: line.replace(/[,，;；、\s]+$/, '') };
  });
}
/** 单个义项的精简显示：前 max 个词义，按边界截取，不留尾逗号；more=是否还有没显示的 */
export function brief(sense, max = 4) {
  const it = items(sense?.zh); const shown = it.slice(0, max);
  return { pos: sense?.pos || '', text: shown.join('，'), more: it.length > max, all: it.join('，') };
}
export const briefText = (sense, max = 4) => { const b = brief(sense, max); return `${b.pos ? b.pos + ' ' : ''}${b.text}${b.more ? ' 等' : ''}`; };
/** 整段释义（可能含多个义项）的精简文本：前 maxSenses 个义项，每个前 maxItems 个词义 */
export function briefAll(zh, { maxSenses = 2, maxItems = 3 } = {}) {
  const ss = parse(zh).filter(s => posKey(s.pos) !== 'dom' || parse(zh).length === 1);
  const out = ss.slice(0, maxSenses).map(s => briefText(s, maxItems)).join('；');
  return { text: out, more: ss.length > maxSenses || ss.some((s, i) => i < maxSenses && items(s.zh).length > maxItems) };
}
/** 完整释义 HTML（每个义项一行，自动换行） */
export const fullHtml = zh => parse(zh).map(s => `<div class="sline"><b class="pos">${esc(s.pos)}</b> ${esc(items(s.zh).join('，'))}</div>`).join('');

let nlpMod = null;
async function posInSentence(sentence, term) {
  if (!sentence || /\s/.test(term)) return '';
  try { nlpMod = nlpMod || await import('./nlp.js'); const t = await Promise.race([nlpMod.posOfToken(sentence, term.replace(/[^A-Za-z'’-]/g, '')), new Promise(r => setTimeout(() => r(null), 5000))]); return posKey(t?.dictPos || ''); } catch { return ''; }
}
/**
 * 卡片在原句语境下的义项：{pos, zh, ctxPos, from, all}
 *  1) 用户/AI 已经选定的义项（card.sense）优先；
 *  2) 否则用本地词性标注判断原句中的词性，先在卡片释义里找同词性义项，再到离线词典里找；
 *  3) 都没有时，用卡片释义的第一个义项（如实，不编造）。
 */
export async function contextSense(card) {
  const own = parse(card.zh);
  const ctxPos = await posInSentence(card.sentence?.en, card.term || '');
  if (card.sense?.zh) return { pos: card.sense.pos || '', zh: card.sense.zh, ctxPos, from: card.sense.by || 'picked', all: card.zh };
  const pick = list => list.find(s => ctxPos && posKey(s.pos) === ctxPos);
  let s = pick(own), from = 'card';
  let d = null;
  if (!s && !/\s/.test(card.term || '')) { d = await dict.lookup(card.term).catch(() => null); s = d && pick(parse(d.zh)); from = 'dict'; }
  if (!s) { s = own.find(x => posKey(x.pos) !== 'dom') || own[0] || { pos: '', zh: card.zh || '' }; from = 'card-first'; }
  return { pos: s.pos, zh: s.zh, ctxPos, from, all: card.zh || d?.zh || '' };
}
/** 选择题干扰项：同词性、彼此不重复、不与正确答案共享词义。先用用户其它卡片，再用离线词典常用词。 */
export async function distractors(correct, others, n = 3) {
  const key = posKey(correct.pos); const used = new Set(items(correct.zh)); const out = [];
  const ok = s => s && s.zh && (!key || posKey(s.pos) === key) && !items(s.zh).some(x => used.has(x));
  const take = s => { out.push(s); items(s.zh).forEach(x => used.add(x)); };
  for (const o of others) { if (out.length >= n) break; const s = parse(o).find(ok); if (s) take(s); }
  if (out.length < n) for (const s of await dict.randomSenses(key, 40)) { if (out.length >= n) break; if (ok(s)) take(s); }
  return out;
}
