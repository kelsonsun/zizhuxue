// 材料结构：书 → 章 → 段 → 句 → 词。章是一份“材料”（bookId 指向书）；段由句子的 p 字段分组（没有 p 时每 5 句为一段）。
import * as db from './db.js';
export const PARA_CHUNK = 5;
export const isBook = m => m.kind === 'book';
/** 返回 [{p, start, end}]，start/end 为句子下标（含）。 */
export function paragraphs(m) {
  const s = m.sentences || []; if (!s.length) return [];
  const out = [];
  if (s.some(x => x.p != null)) {
    let cur = null;
    s.forEach((x, i) => { if (!cur || x.p !== cur.p) { cur = { p: x.p, start: i, end: i }; out.push(cur); } else cur.end = i; });
  } else for (let i = 0; i < s.length; i += PARA_CHUNK) out.push({ p: out.length, start: i, end: Math.min(i + PARA_CHUNK, s.length) - 1 });
  return out;
}
export const paraIndexOf = (m, si) => Math.max(0, paragraphs(m).findIndex(g => si >= g.start && si <= g.end));
export function progressOf(m) {
  const n = m.sentences?.length || 0, d = n ? m.sentences.filter(s => m.progress?.done?.[s.id]).length : 0;
  return { done: d, total: n, pct: n ? Math.round(100 * d / n) : 0 };
}
export async function markDone(m, ids, last) {
  m.progress = m.progress || { done: {}, last: null, quiz: {} };
  const now = Date.now(); for (const id of ids) m.progress.done[id] = now;
  if (last) m.progress.last = last;
  await db.materials.save(m);
  if (m.bookId) { const b = await db.materials.get(m.bookId); if (b) { b.progress = { ...(b.progress || {}), lastChapter: m.id }; await db.materials.save(b); } }
}
export async function touchLast(m, last) {
  m.progress = m.progress || { done: {}, last: null, quiz: {} }; m.progress.last = last; await db.materials.save(m);
  if (m.bookId) { const b = await db.materials.get(m.bookId); if (b) { b.progress = { ...(b.progress || {}), lastChapter: m.id }; await db.materials.save(b); } }
}
export async function bookStats(book, all) {
  const ch = (all || await db.materials.all()).filter(x => x.bookId === book.id).sort((a, b) => a.chapterNo - b.chapterNo);
  let done = 0, total = 0; for (const c of ch) { const p = progressOf(c); done += p.done; total += p.total; }
  return { chapters: ch, done, total, pct: total ? Math.round(100 * done / total) : 0 };
}
