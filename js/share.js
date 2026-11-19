// v1.8「分享到自主学」收件箱：两条来路，同一个出口（#/shared）。
//   · 网页安装版（安卓 Chrome 装到主屏）：manifest share_target → Service Worker 收下 POST，存进 zzx-share 缓存；
//   · 安卓 App（Capacitor）：原生插件 ShareIn 接住系统分享（ACTION_SEND / SEND_MULTIPLE），交给这里存进同一个缓存。
export const CACHE = 'zzx-share';
const URL_RE = /\bhttps?:\/\/[^\s<>"'，。）)]+/i;
const TEXT_EXT = /\.(txt|md|srt|vtt)$/i, DOC_EXT = /\.(docx|pdf)$/i, AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|opus|webm|mp4|mov|m4v|3gp|amr)$/i;

/** 一个分享来的文件该怎么用：image（拍照即查 / 整图识别）、doc（导入材料）、audio（录音/视频转写）、other（不支持） */
export function fileKind(f) {
  const t = (f.type || '').toLowerCase(), n = f.name || '';
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('audio/') || t.startsWith('video/') || AUDIO_EXT.test(n)) return 'audio';
  if (t.startsWith('text/') || TEXT_EXT.test(n) || DOC_EXT.test(n) || /pdf|wordprocessingml|subrip/.test(t)) return 'doc';
  return 'other';
}
/** 分享来的文字：只有一个链接 → link；短的（一两个词 / 一句）→ lookup；长的 → material。返回 {kind, text, url} */
export function textKind({ title = '', text = '', url = '' } = {}) {
  const t = String(text || '').trim(); const u = String(url || '').trim() || (t.match(URL_RE) || [])[0] || '';
  const rest = u ? t.replace(u, '').trim() : t;
  if (!rest && !u && !String(title).trim()) return { kind: 'empty', text: '', url: '' };
  if (u && rest.length < 120 && !/\n/.test(rest)) return { kind: 'link', text: rest || String(title).trim(), url: u };
  const body = rest || String(title).trim();
  return { kind: body.length <= 80 && !/\n/.test(body) && (body.match(/[A-Za-z]+/g) || []).length <= 12 && !/[.!?。！？].+[.!?。！？]/.test(body) ? 'lookup' : 'material', text: body, url: u };
}
/** 原生插件给的 {text, subject, files:[{name,type,data(base64)}]} → 统一格式 {title,text,url,files:[File]} */
export function fromNative(d = {}) {
  const files = (d.files || []).filter(f => f && f.data).map(f => { const b = Uint8Array.from(atob(f.data), c => c.charCodeAt(0)); return new File([b], f.name || 'shared', { type: f.type || '' }); });
  return { title: d.subject || '', text: d.text || '', url: '', files, skipped: (d.skipped || []).map(String) };
}
export async function put({ title = '', text = '', url = '', files = [], skipped = [] }) {
  const c = await caches.open(CACHE); for (const k of await c.keys()) await c.delete(k);
  const meta = { title, text, url, skipped, ts: Date.now(), files: files.slice(0, 10).map((f, i) => ({ i, name: f.name || 'file' + i, type: f.type || '', size: f.size })) };
  await Promise.all(files.slice(0, 10).map((f, i) => c.put('share/file/' + i, new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream' } }))));
  await c.put('share/meta', new Response(JSON.stringify(meta)));
}
/** 读出最近一次分享（没有 → null）。文件还原成 File（带原文件名） */
export async function take() {
  if (!('caches' in globalThis)) return null;
  const c = await caches.open(CACHE); const m = await c.match('share/meta'); if (!m) return null;
  const meta = await m.json();
  meta.files = await Promise.all((meta.files || []).map(async f => { const r = await c.match('share/file/' + f.i); return r ? new File([await r.blob()], f.name, { type: f.type }) : null; }));
  meta.files = meta.files.filter(Boolean); return meta;
}
export async function clear() { if ('caches' in globalThis) await caches.delete(CACHE); }
/** 安卓 App：启动时 + App 开着又收到分享时，把系统分享交给 #/shared */
export async function boot() {
  const P = globalThis.Capacitor?.Plugins?.ShareIn; if (!P) return;
  const got = async d => { if (!d || (!d.text && !d.subject && !(d.files || []).length)) return; await put(fromNative(d)); location.hash = '#/shared?t=' + Date.now(); };
  try { P.addListener?.('shared', got); } catch { }
  await got(await P.getPending().catch(() => null));
}
