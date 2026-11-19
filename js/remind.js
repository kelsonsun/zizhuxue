// v1.8 学习提醒：用户自己定时间；文案用 v1.7 随时间变语气的文案库。按平台走真实能用的路：
//   安卓 / iOS 安装包 → Capacitor 本地通知（系统定时，App 关着也弹）；电脑客户端 → Electron 系统通知（客户端开着时）；
//   网页 + 推送服务器 → Web Push（iOS 16.4+ 主屏应用、安卓 / 电脑浏览器；服务器 = sync-server，VAPID）；
//   网页、没有服务器 → 网页开着时到点弹浏览器通知 + 安卓 Chrome 安装版的定期后台同步补发；都不行 → 首页提醒语（v1.7）。
import * as db from './db.js';
import * as RP from './remindplan.js';
import * as cloud from './cloud.js';
import { SYNC_AVAILABLE } from './deploy.js';
import { settings, saveSettings } from './state.js';

const PUSHKEY = 'remindPush', PLANKEY = 'remindPlan';
let timer = null, lastSig = '';
const LN = () => globalThis.Capacitor?.Plugins?.LocalNotifications;
const NATIVE = () => globalThis.zzxNative?.reminders;
export const plat = () => RP.platformOf(globalThis);
/** 推送服务器（= 同步服务器）地址：已绑定云同步的用它；部署配置里开通了同步服务器的用默认地址；都没有 → ''（没有服务器） */
export async function serverUrl() {
  const c = await cloud.getConfig().catch(() => ({})); return c.url || (SYNC_AVAILABLE ? cloud.defaultUrl() : '');
}
export async function caps() {
  const sw = 'serviceWorker' in navigator;
  return { server: !!(await serverUrl()), push: sw && 'PushManager' in globalThis, notif: 'Notification' in globalThis, periodic: sw && 'periodicSync' in (globalThis.ServiceWorkerRegistration?.prototype || {}), plugin: !!(LN() || NATIVE()) };
}
export async function capability() { const p = plat(); return { plat: p, ...RP.capability(p, await caps()) }; }
async function today() { const P = await import('./progress.js'); const { info } = await P.streakNow(); return { met: !!info.met, streak: info.streak || 0 }; }
const opts = () => ({ at: settings.remindAt || '20:00', late: !!settings.remindLate });
const api = async (path, body) => {
  const url = await serverUrl(); if (!url) throw new Error('没有推送服务器');
  let r; try { r = await fetch(new URL(path, url).href, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new Error('连不上推送服务器（离线或地址不对）'); }
  const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j.error || 'HTTP ' + r.status); e.code = j.code; throw e; } return j;
};
const u8 = b64 => { const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - b64.length % 4) % 4)); return Uint8Array.from(s, c => c.charCodeAt(0)); };
async function askNotif(ask) {
  if (!('Notification' in globalThis)) throw new Error('这个浏览器不支持通知');
  let p = Notification.permission; if (p === 'default' && ask) p = await Notification.requestPermission();
  if (p !== 'granted') throw Object.assign(new Error(p === 'denied' ? '通知权限被拒绝了：请在浏览器 / 系统设置里允许「自主学」发通知，再回来打开' : '需要允许通知才能提醒'), { code: 'perm' });
}
/** 弹一条通知（网页内）：优先走 Service Worker（安卓 Chrome 只认这种），没有就用 new Notification */
export async function show(x) {
  const o = { body: x.body, tag: 'zzx-remind', icon: new URL('icons/icon-192.png', document.baseURI).href, badge: new URL('icons/icon-192.png', document.baseURI).href, data: { url: './#/' }, renotify: true };
  const reg = await navigator.serviceWorker?.getRegistration?.().catch(() => null);
  if (reg?.showNotification) return reg.showNotification(x.title || RP.TITLE, o);
  return new Notification(x.title || RP.TITLE, o);
}

/**
 * 按当前设置把提醒排好（或全部取消）。ask=true：用户刚点了“打开”，可以弹权限请求。
 * 返回 {route, items}；失败抛错（错误信息给用户看）。
 */
export async function apply({ ask = false } = {}) {
  const cap = await capability(); clearTimeout(timer); timer = null;
  if (!settings.remindOn) { await disable(cap.route); lastSig = ''; return { route: 'off', items: [] }; }
  const st = await today(); const items = RP.plan(Date.now(), { ...opts(), ...st });
  lastSig = JSON.stringify([opts(), st, RP.todayKey()]);
  if (cap.route === 'native') {
    const ln = LN(); if (ask) await ln.requestPermissions?.();
    const perm = await ln.checkPermissions?.(); if (perm && perm.display !== 'granted') throw Object.assign(new Error('通知权限没打开：请到手机「设置 → 应用 → 自主学 → 通知」里允许'), { code: 'perm' });
    await ln.createChannel?.({ id: 'remind', name: '学习提醒', description: '每天按你设的时间提醒学习', importance: 4 }).catch(() => { });
    const pend = await ln.getPending().catch(() => ({ notifications: [] })); const old = (pend.notifications || []).filter(n => n.id >= 7000 && n.id < 7300);
    if (old.length) await ln.cancel({ notifications: old.map(n => ({ id: n.id })) });
    if (items.length) await ln.schedule({ notifications: items.map(x => ({ id: x.id, title: x.title, body: x.body, channelId: 'remind', schedule: { at: new Date(x.at), allowWhileIdle: true }, extra: { url: '#/', kind: x.kind } })) });
  } else if (cap.route === 'electron') {
    await NATIVE().set(items);
  } else if (cap.route === 'push') {
    await askNotif(ask);
    const reg = await navigator.serviceWorker.ready; let sub = await reg.pushManager.getSubscription();
    if (!sub) { const { publicKey } = await api('push/vapid'); sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(publicKey) }); }
    const j = sub.toJSON(); const url = await serverUrl();
    await api('push/subscribe', { subscription: { endpoint: j.endpoint, keys: j.keys }, ...opts(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null, tzOffset: new Date().getTimezoneOffset(), streak: st.streak, metDate: st.met ? RP.todayKey() : null });
    await db.meta.set(PUSHKEY, { url, endpoint: j.endpoint });
  } else if (cap.route === 'page') {
    await askNotif(ask);
    const old = await db.meta.get(PLANKEY, {}); await db.meta.set(PLANKEY, { items, shown: old.shown || {} });
    try { const reg = await navigator.serviceWorker?.getRegistration(); if (reg?.periodicSync) { const p = await navigator.permissions?.query({ name: 'periodic-background-sync' }).catch(() => null); if (!p || p.state === 'granted') await reg.periodicSync.register('zzx-remind', { minInterval: 3600e3 }); } } catch { /* 浏览器不给就算了 */ }
    arm(items);
  } else throw Object.assign(new Error(cap.lines[0]), { code: 'unsupported' });
  return { route: cap.route, items };
}
async function disable(route) {
  try { if (LN()) { const pend = await LN().getPending(); const old = (pend.notifications || []).filter(n => n.id >= 7000 && n.id < 7300); if (old.length) await LN().cancel({ notifications: old.map(n => ({ id: n.id })) }); } } catch { }
  try { await NATIVE()?.set([]); } catch { }
  const p = await db.meta.get(PUSHKEY, null);
  if (p?.endpoint) { try { await api('push/unsubscribe', { endpoint: p.endpoint }); } catch { } try { const reg = await navigator.serviceWorker?.getRegistration(); const s = await reg?.pushManager?.getSubscription(); await s?.unsubscribe(); } catch { } await db.meta.set(PUSHKEY, null); }
  await db.meta.set(PLANKEY, null);
  try { const reg = await navigator.serviceWorker?.getRegistration(); await reg?.periodicSync?.unregister('zzx-remind'); } catch { }
}
/** 网页开着时：到下一条的时间弹通知（每次弹之前再确认一下今天是不是已经打卡） */
function arm(items) {
  clearTimeout(timer); const now = Date.now(); const next = items.find(x => x.at > now); if (!next) return;
  timer = setTimeout(async () => {
    const st = await today().catch(() => ({ met: false }));
    const plan = await db.meta.get(PLANKEY, null); const k = next.date + ':' + next.kind;
    if (!st.met && plan && !plan.shown?.[k]) { await show(next).catch(e => console.warn('提醒通知失败', e)); plan.shown = { ...(plan.shown || {}), [k]: Date.now() }; await db.meta.set(PLANKEY, plan); }
    arm(items.filter(x => x.at > next.at));
  }, Math.min(next.at - now, 2 ** 31 - 1));
}
/** 发一条测试提醒 */
export async function test() {
  const cap = await capability(); const x = { title: RP.TITLE, body: '提醒已开启 ✅ 到点我会来叫你学习～' };
  if (cap.route === 'native') return LN().schedule({ notifications: [{ id: 7299, ...x, channelId: 'remind', schedule: { at: new Date(Date.now() + 1500), allowWhileIdle: true } }] });
  if (cap.route === 'electron') return NATIVE().test(x);
  if (cap.route === 'push') { const p = await db.meta.get(PUSHKEY, null); if (!p?.endpoint) throw new Error('还没订阅推送，请先打开提醒'); return api('push/test', { endpoint: p.endpoint }); }
  if (cap.route === 'page') { await askNotif(true); return show(x); }
  throw new Error(cap.lines[0]);
}
/** 进度变了（做题、打卡）：今天的打卡状态变了才重新排（避免频繁打扰服务器） */
let deb = null;
export function watch() {
  addEventListener('zzx-dirty', () => { clearTimeout(deb); deb = setTimeout(refresh, 1500); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
}
export async function refresh() {
  if (!settings.remindOn) return;
  const st = await today().catch(() => null); if (!st) return;
  if (JSON.stringify([opts(), st, RP.todayKey()]) === lastSig) return;
  await apply().catch(e => console.warn('提醒更新失败', e.message));
}
/** 启动时：提醒开着就重新排（不弹权限请求） */
export async function boot() { if (settings.remindOn) { await apply().catch(e => console.warn('提醒未能安排：', e.message)); } watch(); }
export async function setOn(on) { await saveSettings({ remindOn: on }); return apply({ ask: on }); }
