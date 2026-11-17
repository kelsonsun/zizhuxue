// 删除材料（单个/批量）：删除前确认并说明对生词卡、复习进度的影响（默认保留生词卡，可勾选一并删除），删除后可“撤销”。
// 与云同步兼容：删除写墓碑并同步到其他设备；撤销 = 用更晚的时间戳把记录放回（各设备合并后都会复活）。
import * as db from './db.js';
import * as cloud from './cloud.js';
import { sheet, esc } from './ui.js';

/** 把“书”展开成书 + 各章；返回要删的材料记录 */
async function expand(ids) {
  const all = await db.materials.all(); const set = new Set(ids);
  for (const m of all) if (m.bookId && set.has(m.bookId)) set.add(m.id);
  return all.filter(m => set.has(m.id));
}
/** 撤销条：底部显示 ms 毫秒，点“撤销”执行 onUndo */
export function undoBar(msg, onUndo, ms = 10000) {
  document.querySelector('#undobar')?.remove();
  const el = document.createElement('div'); el.id = 'undobar'; el.className = 'undobar'; el.setAttribute('role', 'status');
  el.innerHTML = `<span>${esc(msg)}</span><button class="btn" id="undoBtn">↩︎ 撤销</button><button class="mini2" id="undoX" aria-label="关闭">✕</button>`;
  document.body.appendChild(el); const t = setTimeout(() => el.remove(), ms);
  el.querySelector('#undoX').onclick = () => { clearTimeout(t); el.remove(); };
  el.querySelector('#undoBtn').onclick = async () => { clearTimeout(t); el.querySelector('#undoBtn').disabled = true; try { await onUndo(); } finally { el.remove(); } };
  return el;
}
/**
 * 询问并删除。返回 Promise<boolean>（是否删了）。onChange 在删除后、撤销后各调用一次（用来刷新列表）。
 */
export async function deleteMaterials(ids, { onChange } = {}) {
  const mats = await expand(ids); if (!mats.length) return false;
  const mids = new Set(mats.map(m => m.id)); const top = mats.filter(m => !m.bookId || !mids.has(m.bookId));
  const cards = (await db.cards.all()).filter(c => mids.has(c.materialId));
  const cids = new Set(cards.map(c => c.id)); const nRev = (await db.reviews.all()).filter(r => cids.has(r.cardId)).length;
  const bound = !!(await cloud.getConfig().catch(() => ({}))).refreshToken;
  const names = top.slice(0, 4).map(m => `「${esc(m.title)}」${m.kind === 'book' ? `（整本书 ${mats.filter(x => x.bookId === m.id).length} 章）` : ''}`).join('、') + (top.length > 4 ? ` 等 ${top.length} 份` : '');
  const ok = await new Promise(res => {
    const s = sheet(`<h3>删除${top.length > 1 ? ` ${top.length} 份` : ''}材料？</h3>
      <p class="confirm-msg">${names}</p>
      <ul class="small delinfo"><li>材料原文、音频和学习进度（已学句子、测验成绩）会一起删除。</li>
      ${cards.length ? `<li>这些材料里收藏了 <b>${cards.length}</b> 张生词卡${nRev ? `（${nRev} 条复习记录）` : ''}。<b>默认保留</b>：卡片留在生词本，复习进度不变，照常复习，原句仍保存在卡片里。</li>` : '<li>这些材料没有收藏生词卡，不影响复习。</li>'}
      ${bound ? '<li>已开启云同步：删除会同步到你的其他设备；撤销也会同步回去。</li>' : ''}
      <li>删除后 10 秒内可以点「撤销」恢复。</li></ul>
      ${cards.length ? `<label class="check"><input type="checkbox" id="delCards"><span>同时删除这 ${cards.length} 张生词卡及其复习进度</span></label>` : ''}
      <div class="row gap"><button class="btn grow" data-no>取消</button><button class="btn danger grow" id="delYes" data-yes>删除</button></div>`, { cls: 'small', onClose: () => res(null) });
    s.el.querySelector('[data-no]').onclick = () => s.close();
    s.el.querySelector('#delYes').onclick = () => { const withCards = !!s.el.querySelector('#delCards')?.checked; res({ withCards }); s.close(); };
  });
  if (!ok) return false;
  // 快照（撤销用）
  const blobs = []; for (const m of mats) { const b = await db.blobs.get('audio:' + m.id).catch(() => null); if (b) blobs.push(b); }
  const delCards = ok.withCards ? cards : [];
  const parents = []; // 只删了某几章、书还在：从书的章节列表里去掉
  for (const m of mats) if (m.bookId && !mids.has(m.bookId)) { const b = await db.materials.get(m.bookId); if (b && !parents.some(p => p.id === b.id)) parents.push(structuredClone(b)); }
  for (const m of mats) await db.materials.remove(m.id, { cards: ok.withCards });
  for (const p of parents) { const b = await db.materials.get(p.id); if (b) { b.chapters = (b.chapters || []).filter(x => !mids.has(x)); await db.materials.save(b); } }
  await onChange?.();
  undoBar(`已删除 ${top.length} 份材料${delCards.length ? `和 ${delCards.length} 张生词卡` : cards.length ? `（${cards.length} 张生词卡已保留）` : ''}`, async () => {
    for (const m of mats) await db.restoreSynced('materials', m);
    for (const c of delCards) await db.restoreSynced('cards', c);
    for (const b of blobs) await db.blobs.set(b.id, b.blob);
    for (const p of parents) await db.restoreSynced('materials', p);
    await onChange?.('undo');
  });
  return true;
}
