export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const go = h => { if (location.hash === h) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = h; };

let tt;
export function toast(msg, ms = 2600) {
  let el = $('#toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => el.classList.remove('show'), ms);
}
/** 底部弹层。返回 {el, close}。 */
export function sheet(inner, { onClose, cls = '' } = {}) {
  const back = document.createElement('div'); back.className = 'backdrop';
  back.innerHTML = `<div class="sheet ${cls}" role="dialog" aria-modal="true"><button class="sheet-x" data-close aria-label="关闭">✕</button><div class="sheet-body">${inner}</div></div>`;
  document.body.appendChild(back);
  document.body.classList.add('noscroll');
  const close = () => { back.remove(); if (!$('.backdrop')) document.body.classList.remove('noscroll'); onClose?.(); };
  back.addEventListener('click', e => { if (e.target === back || e.target.closest('[data-close]')) close(); });
  return { el: $('.sheet-body', back), close };
}
export function confirmDlg(msg, { ok = '确定', cancel = '取消', danger = false } = {}) {
  return new Promise(res => {
    const s = sheet(`<p class="confirm-msg">${esc(msg)}</p><div class="row gap"><button class="btn" data-no>${esc(cancel)}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(ok)}</button></div>`, { cls: 'small', onClose: () => res(false) });
    s.el.querySelector('[data-yes]').onclick = () => { res(true); s.close(); };
    s.el.querySelector('[data-no]').onclick = () => s.close();
  });
}
export function download(name, text, type = 'application/json') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
export const fmtDate = ts => new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
/** 高亮句子中的词/短语 */
export function hilite(sentence, term) {
  const i = sentence.toLowerCase().indexOf(String(term).toLowerCase());
  if (i < 0 || !term) return esc(sentence);
  return esc(sentence.slice(0, i)) + '<mark>' + esc(sentence.slice(i, i + term.length)) + '</mark>' + esc(sentence.slice(i + term.length));
}
export function wordsHtml(en) {
  let k = 0;
  return en.split(/([A-Za-z][A-Za-z'’-]*)/).map(p => /^[A-Za-z]/.test(p) ? `<span class="w" data-w data-k="${k++}">${esc(p)}</span>` : esc(p)).join('');
}
export const tokensOf = en => en.match(/[A-Za-z][A-Za-z'’-]*/g) || [];
