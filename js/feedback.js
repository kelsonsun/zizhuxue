// v1.6 反馈 bug / 意见：不用任何付费或需要注册的第三方服务。
//  · 每条反馈先存在本机（IndexedDB），随时能在「我的 → 反馈与建议」里看到、再发、删除；
//  · 发出去的方式：① 用邮件发送（mailto 预填，收件人见 deploy.js 的 FEEDBACK_EMAIL）② 复制全文（发微信/QQ 等）
//    ③ 系统分享（手机上可连截图一起发给微信/邮件）④ 上了同步服务器后直接发到服务器（POST /api/v1/feedback）。
import * as db from './db.js';
import { APP_VERSION } from './version.js';
import { FEEDBACK_EMAIL, SYNC_AVAILABLE } from './deploy.js';

export const TYPES = [['bug', '🐞 问题 / bug'], ['idea', '💡 建议'], ['other', '💬 其他']];
export const TYPE_ZH = { bug: '问题/bug', idea: '建议', other: '其他' };
export const MAX_TEXT = 5000, MAX_SHOT = 1.5e6;
const KEY = 'feedbackLog';

/** 从 UA 认出设备和浏览器（只用于反馈里的环境说明） */
export function deviceInfo(ua = '', { w, h, dpr, standalone, lang } = {}) {
  const os = /iPhone/.test(ua) ? 'iPhone iOS ' + ((ua.match(/OS (\d+[_.]\d+)/) || [])[1] || '').replace('_', '.')
    : /iPad/.test(ua) ? 'iPad iPadOS ' + ((ua.match(/OS (\d+[_.]\d+)/) || [])[1] || '').replace('_', '.')
    : /Android/.test(ua) ? 'Android ' + ((ua.match(/Android (\d+(\.\d+)?)/) || [])[1] || '') + (((ua.match(/Android [^;]+; ([^;)]+)/) || [])[1] || '').replace(/ Build.*/, '') ? ' · ' + (ua.match(/Android [^;]+; ([^;)]+)/)[1]).replace(/ Build.*/, '') : '')
    : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '未知系统';
  const br = /MicroMessenger/.test(ua) ? '微信内置浏览器' : /EdgA?\/(\d+)/.test(ua) ? 'Edge ' + RegExp.$1 : /CriOS\/(\d+)/.test(ua) ? 'Chrome(iOS) ' + RegExp.$1
    : /Chrome\/(\d+)/.test(ua) ? 'Chrome ' + RegExp.$1 : /Firefox\/(\d+)/.test(ua) ? 'Firefox ' + RegExp.$1 : /Version\/(\d+(\.\d+)?).*Safari/.test(ua) ? 'Safari ' + RegExp.$1 : '未知浏览器';
  return { os: os.trim(), browser: br, screen: w ? `${w}×${h}${dpr ? ' @' + dpr + 'x' : ''}` : '', standalone: !!standalone, lang: lang || '' };
}
/** 页面地址 → 中文页面名 */
export function pageName(hash = '') {
  const h = String(hash).replace(/^#\/?/, '').split('?')[0]; const n = h.split('/')[0];
  return ({ '': '首页', import: '导入', draft: '拆句预览/编辑句子', asr: '转写', library: '材料库', lesson: '学习页', book: '书', review: '复习', quiz: '测验', me: '我的', roots: '词根' }[n] || n) + (h ? `（#/${h}）` : '');
}
export function envNow() {
  const n = globalThis.navigator || {}; const s = globalThis.screen || {};
  return { version: APP_VERSION, ...deviceInfo(n.userAgent || '', { w: globalThis.innerWidth, h: globalThis.innerHeight, dpr: globalThis.devicePixelRatio, standalone: n.standalone === true || globalThis.matchMedia?.('(display-mode: standalone)').matches, lang: n.language }), ua: n.userAgent || '', screenFull: s.width ? `${s.width}×${s.height}` : '' };
}
/** 校验并整理一条反馈 */
export function make({ type, text, contact = '', page = '', trail = [], shot = null, env = envNow() }, ts = Date.now()) {
  text = String(text || '').trim(); contact = String(contact || '').trim();
  if (!TYPE_ZH[type]) throw new Error('请选择反馈类型');
  if (text.length < 2) throw new Error('请写几句描述（至少 2 个字）');
  if (text.length > MAX_TEXT) throw new Error(`描述太长了（最多 ${MAX_TEXT} 字）`);
  if (contact.length > 200) throw new Error('联系方式太长了');
  return { id: 'fb_' + ts.toString(36) + Math.random().toString(36).slice(2, 6), ts, type, text, contact, page, trail: trail.slice(-4), env, shot: shot ? { name: shot.name || 'screenshot.jpg', type: shot.type, size: shot.size } : null, sent: [] };
}
const fmtTs = ts => { const d = new Date(ts); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
/** 反馈全文（复制、邮件、分享都用这一份） */
export function toText(fb) {
  const e = fb.env || {};
  return [`【自主学反馈】${TYPE_ZH[fb.type]}`, '', fb.text, '',
    `联系方式：${fb.contact || '（没留）'}`, `截图：${fb.shot ? '有（' + Math.max(1, Math.round(fb.shot.size / 1024)) + ' KB，邮件里请手动添加附件）' : '无'}`,
    '—— 自动附上的信息 ——', `版本：v${e.version || '?'}`, `设备：${e.os || '?'}${e.standalone ? '（主屏应用）' : ''}`, `浏览器：${e.browser || '?'}`, `屏幕：${e.screen || '?'}`, `当前页面：${fb.page || '?'}`,
    ...(fb.trail?.length ? [`之前去过：${fb.trail.join(' → ')}`] : []), `时间：${fmtTs(fb.ts)}`, `编号：${fb.id}`, `UA：${e.ua || ''}`].join('\n');
}
/** mailto 链接（收件人可空）。正文太长时截短（部分邮件 App 对链接长度有限制），并提示用“复制全文”。 */
export function mailto(fb, to = FEEDBACK_EMAIL, max = 1800) {
  let body = toText(fb); if (body.length > max) body = body.slice(0, max) + '\n……（太长被截断，完整内容请用“复制全文”粘贴）';
  return `mailto:${encodeURIComponent(to || '')}?subject=${encodeURIComponent(`[自主学反馈] ${TYPE_ZH[fb.type]}：${fb.text.replace(/\s+/g, ' ').slice(0, 30)}`)}&body=${encodeURIComponent(body)}`;
}
/** 截图压缩：长边不超过 1280，转 JPEG（截图常有几 MB） */
export async function shrinkImage(file, maxSide = 1280, q = 0.82) {
  if (!file || !/^image\//.test(file.type)) throw new Error('请选择图片文件');
  try {
    const bmp = await createImageBitmap(file); const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
    const b = await new Promise(r => c.toBlob(r, 'image/jpeg', q)); if (b && b.size < file.size) return new File([b], (file.name || 'screenshot').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch { }
  return file;
}
// ---- 本机记录 ----
export async function list() { return (await db.meta.get(KEY, [])) || []; }
export async function save(fb, shotFile = null) {
  if (shotFile) await db.blobs.set('fb:' + fb.id, shotFile);
  const all = await list(); const i = all.findIndex(x => x.id === fb.id); if (i >= 0) all[i] = fb; else all.unshift(fb);
  await db.meta.set(KEY, all.slice(0, 100)); return fb;
}
export async function mark(id, how) { const all = await list(); const fb = all.find(x => x.id === id); if (!fb) return; fb.sent = [...new Set([...(fb.sent || []), how])]; fb.sentAt = Date.now(); await db.meta.set(KEY, all); return fb; }
export async function remove(id) { await db.meta.set(KEY, (await list()).filter(x => x.id !== id)); await db.blobs.del('fb:' + id).catch(() => { }); }
export async function shotOf(id) { return (await db.blobs.get('fb:' + id).catch(() => null))?.blob || null; }
// ---- 发到服务器（上线同步服务器以后） ----
const blobToDataUrl = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
/** 有没有可用的反馈服务器：部署时开了同步服务器（deploy.js），或这台设备绑定过同步服务器。返回接口地址或 '' */
export async function serverUrl() {
  const c = await db.meta.get('sync', null);
  if (c?.url) return new URL('feedback', c.url).href;
  if (SYNC_AVAILABLE) { const { defaultUrl } = await import('./cloud.js'); const u = defaultUrl(); return u ? new URL('feedback', u).href : ''; }
  return '';
}
export async function sendToServer(fb, url) {
  const shot = await shotOf(fb.id); const payload = { id: fb.id, type: fb.type, text: fb.text, contact: fb.contact, page: fb.page, trail: fb.trail, env: fb.env, ts: fb.ts };
  if (shot && shot.size <= MAX_SHOT) payload.screenshot = await blobToDataUrl(shot);
  let r; try { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); } catch { throw new Error('连不上反馈服务器（离线或服务器没开）'); }
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
  return j;
}
