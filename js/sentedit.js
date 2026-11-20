// v1.9.3 已保存的教材也能随时改：逐句 / 逐段直接改中文、英文（改完就存，刷新后还在，学习进度和生词卡的复习进度不动）。
// 改完不会自动翻译（可能只是改个错别字）；改过的句子旁边出现「重新翻译」按钮，用户自己点了才重新翻译这一处。
// 纯函数 + 一个可注入翻译函数的 retranslate()，可单测。
import { plausible } from './translate.js';

/** 把编辑结果写进句子 s（就地修改）。返回改了哪些：{en:boolean, zh:boolean}。 */
export function applyEdit(s, { en, zh }) {
  const ne = String(en ?? s.en ?? '').trim(), nz = String(zh ?? s.zh ?? '').trim();
  const ch = { en: ne !== (s.en || ''), zh: nz !== (s.zh || '') };
  if (!ch.en && !ch.zh) return ch;
  // 和「编辑句子」保存时一致：改过的文字不再标“机器翻译”；英文改了，缓存的语法解析 / 注释作废
  delete s.tr; delete s.trFail;
  if (ch.en) { delete s.analysis; delete s.notes; delete s.wt; }
  s.en = ne; s.zh = nz;
  const prev = s.edited || '';
  const both = (ch.en || prev === 'en' || prev === 'both') && (ch.zh || prev === 'zh' || prev === 'both');
  s.edited = both ? 'both' : ch.en ? 'en' : 'zh';
  s.editedAt = Date.now();
  return ch;
}

/** 重新翻译的方向：改了英文 → 按英文重译中文；改了中文 → 按中文重译英文；两边都改 → 按这句原本的语言（中文材料译出的英文以中文为准）。 */
export function retransDir(s) {
  const e = s.edited;
  let dir = e === 'en' ? 'en2zh' : e === 'zh' ? 'zh2en' : (s.orig === 'zh' ? 'zh2en' : 'en2zh');
  if (dir === 'en2zh' && !(s.en || '').trim() && (s.zh || '').trim()) dir = 'zh2en';
  if (dir === 'zh2en' && !(s.zh || '').trim() && (s.en || '').trim()) dir = 'en2zh';
  return dir;
}

/** 重新翻译成功后写回（就地修改）。 */
export function applyRetrans(s, dir, text, provider) {
  const t = String(text).trim();
  if (dir === 'en2zh') s.zh = t; else { if (s.en !== t) { delete s.analysis; delete s.notes; delete s.wt; } s.en = t; s.orig = 'zh'; }
  s.tr = provider; delete s.trFail; delete s.edited; delete s.editedAt;
}

/**
 * 重新翻译一组句子（一句或一段里改过的句子）。translate(provider, texts, dir) → 等长数组。
 * 全部成功才写回；任何一句失败（出错 / 结果不像译文）都抛错，原译文一个字都不改。
 */
export async function retranslate(list, { provider, translate }) {
  const groups = { en2zh: [], zh2en: [] };
  for (const s of list) groups[retransDir(s)].push(s);
  const out = [];
  for (const dir of ['en2zh', 'zh2en']) {
    const g = groups[dir]; if (!g.length) continue;
    const src = g.map(s => (dir === 'en2zh' ? s.en : s.zh) || '');
    if (src.some(x => !x.trim())) throw new Error('这句没有可翻译的原文');
    const res = await translate(provider, src, dir);
    if (!Array.isArray(res) || res.length !== g.length || res.some((t, k) => !plausible(src[k], t, dir))) throw new Error('没有翻译出来（结果为空或和原文一样）');
    g.forEach((s, k) => out.push([s, dir, res[k]]));
  }
  for (const [s, dir, t] of out) applyRetrans(s, dir, t, provider);
  return out.length;
}

/** 句子改了以后，来源是这句的生词卡 / 句子卡：原句跟着更新（复习进度 sch 不动）。返回改过的卡。 */
export function syncCards(cards, s) {
  const changed = [];
  for (const c of cards) {
    if (c.sentenceId !== s.id) continue;
    let ch = false;
    if (c.sentence && (c.sentence.en !== s.en || c.sentence.zh !== s.zh)) { c.sentence = { ...c.sentence, en: s.en, zh: s.zh }; ch = true; }
    if (c.type === 'sentence' && s.en && (c.term !== s.en || c.zh !== s.zh)) { c.term = s.en; c.zh = s.zh; ch = true; }
    if (ch) changed.push(c);
  }
  return changed;
}
