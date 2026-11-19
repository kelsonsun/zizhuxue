// v1.5 关联提示：放在单词信息下方，自动显示拆解 + 同根/同缀家族；点家族词就地展开，不用跳页。
import { $, $$, esc, toast } from './ui.js';
import * as R from './roots.js';
import * as dict from './dict.js';
import * as db from './db.js';
import { makeCard } from './state.js';

const KIND = { pre: '前缀', root: '词根', suf: '后缀', comb: '构词', el: '' };
const partHtml = p => `<span class="rp ${p.kind}${p.unknown ? ' unk' : ''}" title="${KIND[p.kind] || ''}"><b>${p.kind === 'pre' || p.kind === 'comb' ? esc(p.t) + '-' : p.kind === 'suf' ? '-' + esc(p.t) : esc(p.t)}</b><i>${esc(p.word && p.word !== p.t ? p.word + ' · ' + p.m : p.m.split('；').slice(0, 2).join('；'))}</i></span>`;
const partsHtml = ps => `<div class="rb-parts">${ps.map(partHtml).join('<span class="rb-plus">+</span>')}</div>`;
const chip = (e, zh = true) => `<button type="button" class="rchip" data-rw="${esc(e.w)}">${esc(e.w)}${zh ? `<small>${esc(R.brief(e.zh))}</small>` : ''}</button>`;
const famRow = (label, list, key, max = 6, zh = true, tail = '') => !list.length ? '' : `<div class="rb-fam"><span class="rb-l">${label}</span><div class="rb-scroll">${list.slice(0, max).map(e => chip(e, zh)).join('')}${list.length > max ? `<button type="button" class="rchip more" data-rmore="${key}">+${list.length - max}</button>` : ''}${tail}</div></div>`;

/** 只要拆解方块（复习题干用）。 */
export const partsTiles = word => { const e = R.entry(word); return e ? partsHtml(e.parts) : ''; };
/** 生成关联提示的 HTML。opts.has：同步查词典（可省略）。 */
export function rootBoxHtml(word, { lemma = null, has = dict.hasWord, back = null } = {}) {
  const d = R.decompose(word, lemma, has);
  const head = (tag, cls = '') => `<div class="rb-h"><span>🌳 构词与家族</span>${back ? `<button type="button" class="rb-back" data-rback="${esc(back)}">‹ ${esc(back)}</button>` : ''}<span class="rb-tag ${cls}">${tag}</span></div>`;
  if (d.type === 'none') return `<div class="rbox thin" data-rbox="${esc(d.w)}">${head('')}<div class="muted small">“${esc(d.w)}”没有可靠的词根拆解（内置 ${R.stats().roots} 个词根、${R.stats().words} 个词），不硬拆。</div></div>`;
  if (d.type === 'false') {
    const r = d.root && R.rootById(d.root);
    return `<div class="rbox" data-rbox="${esc(d.w)}">${head('拼写像，词源不同', 'warn')}<div class="rb-logic">⚠ ${esc(d.note)}</div>${r ? famRow(`真正的 ${esc(r.forms[0])}（${esc(r.m)}）家族`, R.family(r.id), 'root:' + r.id) : ''}</div>`;
  }
  const rel = R.relatives(d, { max: 40 }); const e = d.e; let h = '';
  if (d.type === 'known') {
    h += head('依据词源', 'ok') + partsHtml(e.parts) + `<div class="rb-logic">${esc(e.logic)}</div>`;
  } else if (d.type === 'derived') {
    h += head('依据词源', 'ok') + `<div class="rb-eq">${esc(d.w)} = ${d.at === 'pre' ? `${partHtml(d.add)}<span class="rb-plus">+</span><button type="button" class="rlink" data-rw="${esc(e.w)}">${esc(e.w)}</button>` : `<button type="button" class="rlink" data-rw="${esc(e.w)}">${esc(e.w)}</button><span class="rb-plus">+</span>${partHtml(d.add)}`}</div>`
      + partsHtml(e.parts) + `<div class="rb-logic">${esc(e.w)}（${esc(R.brief(e.zh))}）：${esc(e.logic)}</div>`;
  } else if (d.type === 'guess') {
    h += head('推测，仅供参考', 'warn') + partsHtml(d.parts) + `<div class="rb-logic muted">按常见词根词缀拆出来的，词源未经核对；请以词典释义为准。</div>`;
  } else if (d.type === 'partial') {
    h += head('部分拆解', 'warn') + partsHtml(d.parts) + `<div class="rb-logic muted">${d.parts.some(p => p.unknown) ? '只认出了前后缀，中间部分不在内置词根里。' : '常见前/后缀 + 一个独立的词。'}</div>`;
  }
  if (rel.root?.r) { const r = rel.root.r; h += famRow(`同根 <b>${esc(r.forms[0])}</b>`, rel.root.list, 'root:' + r.id, 6, true, `<a class="rchip rb-map" href="#/roots?r=${esc(r.id)}">词根地图 ›</a>`); }
  if (rel.pre?.list.length) h += famRow(`同前缀 <b>${esc(rel.pre.t)}-</b>${rel.pre.t !== rel.pre.p.k.replace('!', '') ? `<small>(=${esc(rel.pre.p.k.replace('!', ''))}-)</small>` : ''}`, rel.pre.list, 'pre:' + rel.pre.p.k, 3, false);
  if (rel.suf?.list.length) h += famRow(`同后缀 <b>-${esc(rel.suf.t)}</b>`, rel.suf.list, 'suf:' + rel.suf.s.k, 3, false);
  if (rel.root?.r) h += `<div class="rb-src muted">${esc(rel.root.r.forms.join(' / '))} ← ${esc(rel.root.r.src)}</div>`;
  if (back && e) h += `<div class="rb-act"><span class="rb-zh">${esc(e.w)}：${esc(e.zh)}</span><button type="button" class="mini" data-rsave="${esc(e.w)}">＋生词</button></div>`;
  return `<div class="rbox" data-rbox="${esc(d.w)}">${h}</div>`;
}

/** 把关联提示放进 el，并处理点击（就地展开家族词、返回、展开更多、收藏）。 */
export function mountRootBox(el, word, opts = {}) {
  if (!el) return;
  const stack = [];
  const draw = (w, back) => { el.innerHTML = rootBoxHtml(w, { ...opts, back, lemma: back ? null : opts.lemma }); };
  const ready = dict.ready().catch(() => null);
  draw(word, null); ready.then(() => { if (!stack.length) draw(word, null); });
  el.onclick = async ev => {
    const t = ev.target.closest('[data-rw],[data-rback],[data-rmore],[data-rsave]'); if (!t) return; ev.stopPropagation();
    if (t.dataset.rw) { stack.push(el.querySelector('[data-rbox]')?.dataset.rbox || word); draw(t.dataset.rw, stack[stack.length - 1]); el.scrollIntoView?.({ block: 'nearest' }); }
    else if (t.dataset.rback) { const w = stack.pop() || word; draw(w, stack.length ? stack[stack.length - 1] : null); }
    else if (t.dataset.rmore) {
      const [kind, k] = t.dataset.rmore.split(':'); const cur = el.querySelector('[data-rbox]')?.dataset.rbox;
      const list = (kind === 'root' ? R.family(k) : kind === 'pre' ? R.prefixFamily(k) : R.suffixFamily(k)).filter(e => e.w !== cur);
      const sc = t.parentElement; const tail = sc.querySelector('.rb-map')?.outerHTML || ''; sc.innerHTML = list.map(e => chip(e, kind === 'root')).join('') + tail; sc.scrollLeft = 0;
    } else if (t.dataset.rsave) {
      const e = R.entry(t.dataset.rsave); if (!e) return;
      const has = (await db.cards.all()).find(c => c.type === 'word' && c.term.toLowerCase() === e.w);
      if (has) return toast('已经在生词本里了');
      const c = makeCard({ type: 'word', term: e.w, zh: e.zh, source: 'roots', note: `${e.parts.map(p => p.t).join(' + ')}：${e.logic}` });
      c.root = e.root; await db.cards.save(c); t.disabled = true; t.textContent = '已收藏'; toast(`已加入生词：${e.w}`);
      opts.onSaved?.(c);
    }
  };
}
