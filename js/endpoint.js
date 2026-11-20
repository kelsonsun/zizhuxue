// v1.9.2 统计 / 反馈接口地址（和云同步开关分开）：deploy.js 的 TELEMETRY_URL / FEEDBACK_URL。
// 防止污染真实数据：网页从本机 / 局域网地址打开（开发、自动化测试），或浏览器被自动化控制（navigator.webdriver），
// 就不往“别的公网服务器”发；同源、或接口本身就在本机（测试服务器）不受影响。安卓 / iOS 客户端（https://localhost）照常发。
// 测试里想强制发：localStorage zzx.telTest = '1'。
import * as D from './deploy.js';

export const isLocalHost = h => { h = String(h || '').toLowerCase().replace(/^\[|\]$/g, ''); return !h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '::1' || h === '0.0.0.0' || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h); };
/** 这个地址能不能发：返回解析后的绝对地址，或 ''（不发） */
export function allowed(url, { base = globalThis.document?.baseURI, native = false, webdriver = false, force = false } = {}) {
  if (!url) return '';
  let u, pg; try { u = new URL(url, base); pg = new URL(base || u.href); } catch { return ''; }
  if (!/^https?:$/.test(u.protocol)) return '';
  if (u.origin === pg.origin || isLocalHost(u.hostname) || force) return u.href;
  if (webdriver) return '';
  if (native) return u.href;
  if (pg.protocol === 'file:' || (/^https?:$/.test(pg.protocol) && isLocalHost(pg.hostname))) return '';
  return u.href;
}
export function runtime() {
  const C = globalThis.Capacitor; let force = false; try { force = globalThis.localStorage?.getItem('zzx.telTest') === '1'; } catch { }
  return { base: globalThis.document?.baseURI, native: !!C?.isNativePlatform?.(), webdriver: !!globalThis.navigator?.webdriver, force };
}
export const telemetryUrl = (o = runtime()) => allowed(D.TELEMETRY_URL || '', o);
export const feedbackUrl = (o = runtime()) => allowed(D.FEEDBACK_URL || '', o);
/** v1.9.4 内置 AI（服务器代理）地址：deploy.js 的 AI_URL（末尾带 /），同样的过滤规则 */
export const aiUrl = (o = runtime()) => { const u = allowed(D.AI_URL || '', o); return u && !u.endsWith('/') ? u + '/' : u; };
