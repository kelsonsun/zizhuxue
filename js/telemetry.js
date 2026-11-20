// v1.9.2 匿名使用统计（只为知道“有多少人在用”）：
// · 只有配置了服务器地址才上报：js/deploy.js 的 TELEMETRY_URL（和云同步开关无关，见 endpoint.js）/ SYNC_URL /
//   同步服务器同端口提供网页（SYNC_AVAILABLE）/ 用户自己绑定过的云同步地址。都没有 → 不发任何请求。
//   本机 / 局域网打开的网页、自动化测试浏览器不往公网服务器报（endpoint.js）。
// · 只发：随机的匿名设备 ID（和云同步无关）、事件类型（打开 / 导入 / 学课文 / 复习 / 测验 / 分享）、来源类型（微信 / 主屏 / 直接打开…，网站来源只留域名）、
//   平台、App 版本、时间。不发学习内容、材料标题、姓名、邮箱、账户。
// · 用 sendBeacon / fetch keepalive 静默发送，失败就留着下次再发（最多攒 60 条），绝不影响使用。「我的 → 隐私」可以关掉。
import { SYNC_AVAILABLE, SYNC_URL } from './deploy.js';
import { telemetryUrl } from './endpoint.js';
import { APP_VERSION } from './version.js';

export const EVENTS = ['open', 'import', 'study', 'quiz', 'review', 'share'];
export const MAX_BATCH = 20, MAX_QUEUE = 60;
const K = { id: 'zzx.tid', q: 'zzx.telq', open: 'zzx.telopen', off: 'zzx.teloff' };

/** 上报地址：没有服务器地址时返回 ''（不上报） */
export function resolveEndpoint({ telemetry = '', syncUrl = SYNC_URL, syncAvailable = SYNC_AVAILABLE, storedUrl = '', baseURI = globalThis.document?.baseURI } = {}) {
  if (telemetry) return telemetry; // deploy.js 的 TELEMETRY_URL（已按 endpoint.js 过滤）优先：所有入口报到同一个看板
  try {
    if (syncUrl) return new URL('telemetry', syncUrl.endsWith('/') ? syncUrl : syncUrl + '/').href;
    if (syncAvailable && baseURI) return new URL('api/v1/telemetry', baseURI).href;
    if (storedUrl && /^https?:\/\//.test(storedUrl)) return new URL('telemetry', storedUrl.endsWith('/') ? storedUrl : storedUrl + '/').href;
  } catch { }
  return '';
}
/** 来源类型（第一次打开时怎么来的）。网站来源只留域名 */
export function sourceOf({ ua = '', referrer = '', host = '', native = '', desktop = false, standalone = false } = {}) {
  if (/MicroMessenger/i.test(ua)) return { src: 'wechat' };
  if (/\bQQ\/|MQQBrowser.*QQ/i.test(ua)) return { src: 'qq' };
  if (/Weibo/i.test(ua)) return { src: 'weibo' };
  if (native === 'ios' || native === 'android') return { src: native + '-app' };
  if (desktop) return { src: 'desktop-app' };
  if (standalone) return { src: 'pwa' };
  let r = null; try { r = referrer ? new URL(referrer).hostname.replace(/^www\./, '') : null; } catch { }
  if (r && r !== host) return { src: 'site', ref: r };
  return { src: 'direct' };
}
export const platformOf = ua => /iPhone|iPad|iPod/.test(ua) ? 'ios' : /Android/.test(ua) ? 'android' : /Macintosh|Mac OS X/.test(ua) ? 'mac' : /Windows/.test(ua) ? 'windows' : /Linux/.test(ua) ? 'linux' : 'other';
const localDay = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const rid = () => { const a = new Uint8Array(16); crypto.getRandomValues(a); return 't_' + [...a].map(b => b.toString(16).padStart(2, '0')).join(''); };

/** 可注入依赖（单元测试用）：endpoint() 返回地址或 ''；store 是类 localStorage；beacon / fetch 发送 */
export function createClient({ endpoint, store, beacon, fetchImpl, now = () => Date.now(), version = APP_VERSION, env = () => ({}) }) {
  const get = (k, d = null) => { try { const v = store.getItem(k); return v == null ? d : v; } catch { return d; } };
  const set = (k, v) => { try { v == null ? store.removeItem(k) : store.setItem(k, v); } catch { } };
  const queue = () => { try { return JSON.parse(get(K.q, '[]')) || []; } catch { return []; } };
  const deviceId = () => { let id = get(K.id); if (!/^[A-Za-z0-9_-]{8,64}$/.test(id || '')) { id = rid(); set(K.id, id); } return id; };
  let timer = null, sending = false;
  const enabled = () => get(K.off) !== '1';
  async function flush() {
    if (sending || !enabled()) return 0; const url = await endpoint(); if (!url) { set(K.q, null); return 0; } // 没服务器：什么都不留、不发
    sending = true; let sent = 0;
    try {
      while (true) {
        const q = queue(); if (!q.length) break; const batch = q.slice(0, MAX_BATCH), e = env();
        const body = JSON.stringify({ d: deviceId(), v: version, src: e.src, ref: e.ref, p: e.p, e: batch });
        let ok = false;
        try { ok = !!beacon?.(url, body); } catch { ok = false; }
        if (!ok && fetchImpl) { try { const r = await fetchImpl(url, { method: 'POST', body, keepalive: true, mode: 'cors', credentials: 'omit', headers: { 'Content-Type': 'text/plain;charset=UTF-8' } }); ok = r.ok || (r.status >= 400 && r.status < 500 && r.status !== 429); } catch { ok = false; } } // 4xx（坏数据）也丢掉，免得一直重发
        if (!ok) break;
        set(K.q, JSON.stringify(queue().slice(batch.length))); sent += batch.length;
      }
    } finally { sending = false; }
    return sent;
  }
  /** 记一个事件（静默；没服务器时直接忽略） */
  async function track(ev, { soon = 1500 } = {}) {
    try {
      if (!EVENTS.includes(ev) || !enabled()) return false;
      if (!(await endpoint())) return false;
      const q = queue(); q.push({ e: ev, t: now() }); set(K.q, JSON.stringify(q.slice(-MAX_QUEUE)));
      clearTimeout(timer); if (soon <= 0) await flush(); else timer = setTimeout(() => flush().catch(() => { }), soon);
      return true;
    } catch { return false; }
  }
  /** 打开：每台设备每天记一次 */
  async function open() { const d = localDay(now()); if (get(K.open) === d) return false; const ok = await track('open', { soon: 0 }); if (ok) set(K.open, d); return ok; }
  return { track, flush, open, deviceId, queue, enabled, setEnabled: on => set(K.off, on ? null : '1') };
}

// ———— 浏览器里的默认实例 ————
let client = null, firstEnv = null;
async function storedUrl() { try { const db = await import('./db.js'); const c = await db.meta.get('sync', null); return c?.refreshToken ? c.url || '' : ''; } catch { return ''; } }
function env() {
  if (firstEnv) return firstEnv;
  const ua = navigator.userAgent, C = globalThis.Capacitor;
  const s = sourceOf({ ua, referrer: document.referrer, host: location.hostname, native: C?.isNativePlatform?.() ? C.getPlatform?.() : '', desktop: !!globalThis.__TAURI_INTERNALS__ || /\bElectron\//.test(ua), standalone: !!(matchMedia?.('(display-mode: standalone)').matches || navigator.standalone) });
  return (firstEnv = { ...s, p: platformOf(ua) });
}
export function getClient() {
  if (!client) client = createClient({
    endpoint: async () => resolveEndpoint({ telemetry: telemetryUrl(), storedUrl: await storedUrl() }), store: globalThis.localStorage, env,
    beacon: (u, body) => navigator.sendBeacon?.(u, new Blob([body], { type: 'text/plain;charset=UTF-8' })), fetchImpl: globalThis.fetch?.bind(globalThis),
  });
  return client;
}
export const track = ev => getClient().track(ev).catch(() => false);
export const enabled = () => getClient().enabled();
export const setEnabled = on => getClient().setEnabled(on);
/** 启动：记“打开”；导入材料 / 切到后台时顺手发出去 */
export async function boot() {
  env(); const c = getClient();
  addEventListener('zzx-imported', () => c.track('import'));
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') c.flush().catch(() => { }); });
  await c.open().catch(() => { });
}
