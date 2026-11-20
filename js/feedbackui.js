// v1.6 反馈弹层：类型 + 描述 + 可选截图 + 可选联系方式；自动附上版本、设备/浏览器、当前页面。先存本机，再选怎么发出去。
import * as F from './feedback.js';
import { FEEDBACK_EMAIL } from './deploy.js';
import { session } from './state.js';
import { $, $$, esc, toast, sheet, confirmDlg } from './ui.js';

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch { }
  const ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0'; document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { } ta.remove(); return ok;
}
const SENT = { mail: '已打开邮件', copy: '已复制', share: '已分享', server: '已发到服务器' };
export const sentLabel = fb => (fb.sent || []).map(k => SENT[k]).filter(Boolean).join(' · ') || '还没发出（只存在本机）';

/** 打开反馈弹层。prefill：{type, text}（例如页面出错时自动带上错误信息） */
export function openFeedback(prefill = {}, { onClose } = {}) {
  const page = F.pageName(location.hash); const trail = (session.trail || []).slice(0, -1).filter(h => !/^#\/?_/.test(h)).map(F.pageName).map(s => s.replace(/（.*$/, '')).filter((x, k, a) => x && x !== a[k - 1]);
  const env = F.envNow(); let type = prefill.type || 'bug', shotFile = null, shotUrl = null;
  const sh = sheet(`<h3>反馈问题 / 提建议</h3>
    <div class="seg fbtype" role="radiogroup" aria-label="反馈类型">${F.TYPES.map(([k, t]) => `<a role="radio" tabindex="0" data-ft="${k}" class="${k === type ? 'on' : ''}" aria-checked="${k === type}">${t}</a>`).join('')}</div>
    <div class="field"><label for="fbText">描述</label><textarea id="fbText" rows="5" maxlength="${F.MAX_TEXT}" placeholder="哪里不对 / 希望怎么改？例如：在学习页点 ▶ 原声没有声音。">${esc(prefill.text || '')}</textarea></div>
    <div class="field"><label>截图（可选）</label><label class="btn fbshotbtn"><input type="file" id="fbShot" accept="image/*" hidden>📷 选一张截图</label><div id="fbShotPrev"></div></div>
    <div class="field"><label for="fbContact">联系方式（可选：微信 / 邮箱 / 手机，方便回复你）</label><input id="fbContact" maxlength="200" autocomplete="email" placeholder="可以不填"></div>
    <details class="fbenv"><summary>会自动附上的信息</summary><div class="muted small">版本 v${esc(env.version)} · ${esc(env.os)}${env.standalone ? '（主屏应用）' : ''} · ${esc(env.browser)} · 屏幕 ${esc(env.screen)}<br>当前页面：${esc(page)}</div></details>
    <button class="btn primary big" id="fbSave">保存并选择发送方式</button>
    <p class="muted small">反馈先保存在这台设备上（「我的 → 反馈与建议」里能看到）。不点“直接发给开发者”就不会上传。</p>`, { onClose: () => { if (shotUrl) URL.revokeObjectURL(shotUrl); onClose?.(); } });
  const el = sh.el;
  $$('[data-ft]', el).forEach(b => b.onclick = () => { type = b.dataset.ft; $$('[data-ft]', el).forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); }); });
  $('#fbShot', el).onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { shotFile = await F.shrinkImage(f); } catch (err) { return toast(err.message); }
    if (shotUrl) URL.revokeObjectURL(shotUrl); shotUrl = URL.createObjectURL(shotFile);
    $('#fbShotPrev', el).innerHTML = `<div class="fbshot"><img src="${shotUrl}" alt="截图预览"><span class="muted small">${Math.max(1, Math.round(shotFile.size / 1024))} KB</span><button class="mini" id="fbShotDel">去掉</button></div>`;
    $('#fbShotDel', el).onclick = () => { shotFile = null; $('#fbShotPrev', el).innerHTML = ''; $('#fbShot', el).value = ''; };
  };
  $('#fbSave', el).onclick = async () => {
    let fb; try { fb = F.make({ type, text: $('#fbText', el).value, contact: $('#fbContact', el).value, page, trail, shot: shotFile, env }); } catch (e) { toast(e.message); $('#fbText', el).focus(); return; }
    await F.save(fb, shotFile); sendPanel(el, fb, shotFile);
  };
  return sh;
}
/** 已保存的反馈 → 发送方式 */
export async function sendPanel(el, fb, shotFile = null) {
  shotFile = shotFile || (fb.shot ? await F.shotOf(fb.id) : null);
  const srv = await F.serverUrl(); const canShare = !!navigator.share;
  el.innerHTML = `<h3>✅ 已保存在本机</h3><p class="muted small">选一种方式发出去（可以都用）：</p>
    <div class="fbsend">
      ${srv ? '<button class="btn primary" id="fbSrv">☁️ 直接发给开发者</button>' : ''}
      <a class="btn${srv ? '' : ' primary'}" id="fbMail" href="${esc(F.mailto(fb))}">📧 用邮件发送</a>
      <button class="btn" id="fbCopy">📋 复制全文</button>
      ${canShare ? `<button class="btn" id="fbShare">📤 分享${shotFile ? '（连截图）' : ''}</button>` : ''}
    </div>
    <p class="muted small">${srv ? '推荐“直接发给开发者”：一点就发到自主学的服务器（连截图），开发者在后台就能看到；不用邮箱、不用加微信。' : ''}${FEEDBACK_EMAIL ? `邮件会发给 ${esc(FEEDBACK_EMAIL)}。` : '<b>收件邮箱还没定</b>：邮件 App 打开后请自己填收件人（或用“复制全文”发到微信）。'}${shotFile ? '邮件链接不能自动带附件，截图请在邮件里手动添加' + (canShare ? '，或用“分享”连截图一起发' : '') + '。' : ''}
    ${srv ? '' : '现在没有反馈服务器（应用是静态网页），上线同步服务器后这里会出现“发到服务器”。'}</p>
    <pre class="fbtext" id="fbTextOut">${esc(F.toText(fb))}</pre>
    <div class="row gap"><button class="btn" data-close>完成</button></div>`;
  const done = async (how, msg) => { await F.mark(fb.id, how); if (msg) toast(msg); };
  $('#fbMail', el).onclick = () => { done('mail'); };
  $('#fbCopy', el).onclick = async () => { const ok = await copyText(F.toText(fb)); if (ok) done('copy', '已复制，可以粘贴到微信 / 邮件里发送'); else { toast('浏览器不让复制，请长按下面的文字手动复制'); const r = document.createRange(); r.selectNodeContents($('#fbTextOut', el)); getSelection().removeAllRanges(); getSelection().addRange(r); } };
  $('#fbShare', el)?.addEventListener('click', async () => {
    const data = { title: '自主学反馈', text: F.toText(fb) };
    if (shotFile && navigator.canShare?.({ files: [shotFile] })) data.files = [shotFile];
    try { await navigator.share(data); done('share', '已分享'); } catch (e) { if (e?.name !== 'AbortError') toast('分享没成功：' + e.message); }
  });
  $('#fbSrv', el)?.addEventListener('click', async e => {
    const b = e.currentTarget; b.disabled = true; b.textContent = '发送中…';
    try { const r = await F.sendToServer(fb, srv); await done('server', '已发到服务器' + (r.id ? '（编号 ' + r.id + '）' : '')); b.textContent = '✓ 已发给开发者'; }
    catch (err) { toast(err.message, 5000); b.disabled = false; b.textContent = '☁️ 重试发给开发者'; }
  });
}
/** 「我的」里的反馈卡片 */
export async function mountHistory(box) {
  const all = await F.list();
  box.innerHTML = `<p class="muted small">遇到问题或有想法，点下面告诉开发者。会自动附上版本、设备和当前页面，帮助定位。</p>
    <button class="btn primary" id="fbOpen2">🐞 反馈问题 / 提建议</button>
    ${all.length ? `<h3>我的反馈（${all.length}）</h3><div class="list fblist">${all.slice(0, 20).map(fb => `<div class="item" data-fb="${esc(fb.id)}"><b>${esc(F.TYPE_ZH[fb.type])} · ${esc(fb.text.slice(0, 40))}${fb.text.length > 40 ? '…' : ''}</b><span class="muted small">${new Date(fb.ts).toLocaleString('zh-CN', { hour12: false })} · ${esc(sentLabel(fb))}${fb.shot ? ' · 有截图' : ''}</span>
      <div class="row gap"><button class="mini" data-fbsend>发送 / 复制</button><button class="mini" data-fbdel>删除</button></div></div>`).join('')}</div>` : ''}`;
  $('#fbOpen2', box).onclick = () => openFeedback({}, { onClose: () => mountHistory(box) });
  $$('[data-fbsend]', box).forEach(b => b.onclick = async () => { const fb = all.find(x => x.id === b.closest('[data-fb]').dataset.fb); const s = sheet('', { onClose: () => mountHistory(box) }); await sendPanel(s.el, fb); });
  $$('[data-fbdel]', box).forEach(b => b.onclick = async () => { if (!(await confirmDlg('删除这条反馈记录？', { ok: '删除', danger: true }))) return; await F.remove(b.closest('[data-fb]').dataset.fb); mountHistory(box); });
}
