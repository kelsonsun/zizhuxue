// v1.8 学习提醒：用户自己定时间；文案用 v1.7 随时间变语气的文案库。按平台走真实能用的路：
//   安卓 / iOS 安装包 → Capacitor 本地通知（系统定时，App 关着也弹）；电脑客户端 → Electron 系统通知（客户端开着时）；
//   网页 + 推送服务器 → Web Push（iOS 16.4+ 主屏应用、安卓 / 电脑浏览器；服务器 = sync-server，VAPID）；
//   网页、没有服务器 → 网页开着时到点弹浏览器通知 + 安卓 Chrome 安装版的定期后台同步补发；都不行 → 首页提醒语（v1.7）。
import * as db from './db.js';
import * as RP from './remindplan.js';
import * as cloud from './cloud.js';
import { SYNC_AVAILABLE } from './deploy.js';
import { settings, saveSettings } from './state.js';
import { pushApi } from './endpoint.js';
import { APP_VERSION } from './version.js';
// v1.11 网页推送强提醒：四种提醒（每日定点 / 复习卡到期 / 连续打卡将断 / 晚间补提醒）、免打扰、每日上限都由服务器按用户时区判断；
//   本机把「今天学了没、打卡没、到期几张卡（未来 8 天）、连续几天」报给服务器（学过就不再催）。离线时先存着，联网后自动开通。

const PUSHKEY = 'remindPush', PLANKEY = 'remindPlan', PENDKEY = 'remindPushPending';
let timer = null, lastSig = '';
const LN = () => globalThis.Capacitor?.Plugins?.LocalNotifications;
const NATIVE = () => globalThis.zzxNative?.reminders;
export const plat = () => RP.platformOf(globalThis);
/** 推送服务器（= 同步服务器）地址：已绑定云同步的用它；部署配置里开通了同步服务器的用默认地址；都没有 → ''（没有服务器） */
export async function serverUrl() {
  const p = pushApi(); if (p) return p; // v1.11 推送服务器和云同步分开（不用登录、不用开云同步）
  const c = await cloud.getConfig().catch(() => ({})); return c.url || (SYNC_AVAILABLE ? cloud.defaultUrl() : '');
}
export async function caps() {
  const sw = 'serviceWorker' in navigator;
  const ua = navigator.userAgent || ''; const inApp = await import('./install.js').then(I => I.inAppName()).catch(() => '');
  return { server: !!(await serverUrl()), push: sw && 'PushManager' in globalThis, notif: 'Notification' in globalThis, periodic: sw && 'periodicSync' in (globalThis.ServiceWorkerRegistration?.prototype || {}), plugin: !!(LN() || NATIVE()), iosVer: RP.iosVersion(ua, navigator.maxTouchPoints || 0), inApp };
}
export async function capability() { const p = plat(); return { plat: p, ...RP.capability(p, await caps()) }; }
async function today() { const P = await import('./progress.js'); const { info } = await P.streakNow(); return { met: !!info.met, streak: info.streak || 0 }; }
/** v1.11 报给推送服务器的「今天」：打卡了没、做过题没、连续天数、冰块、未来 8 天每天到期的卡数 */
export async function pushState() {
  const P = await import('./progress.js'); const [{ info, freeze }, cards] = await Promise.all([P.streakNow(), db.cards.all()]);
  const d = RP.todayKey(); return { metDate: info.met ? d : null, studiedDate: info.today > 0 ? d : null, streak: info.streak || 0, freezes: freeze?.freezes || 0, due: RP.dueMap(cards) };
}
/** v1.11 推送提醒的偏好（四种提醒、免打扰、每日上限）；每日提醒时间和旧的「提醒时间」是同一个 */
export const prefs = () => RP.normPrefs(settings.remindPrefs || {}, settings.remindAt);
export async function savePrefs(p) { const n = RP.normPrefs(p, settings.remindAt); await saveSettings({ remindPrefs: n, remindAt: n.daily.at }); return n; }
/** 设置页显示「下一次」：今天 / 明天里最早一条会发的推送（按偏好粗算：免打扰里的不算，条件类的标“有条件”） */
export function nextPush(p = prefs(), now = Date.now()) {
  const out = []; const b = new Date(now);
  for (let d = 0; d < 2; d++) for (const k of RP.KINDS) { const x = p[k]; if (!x.on) continue; const t = RP.parseAt(x.at); const ts = new Date(b.getFullYear(), b.getMonth(), b.getDate() + d, t.h, t.m).getTime(); if (ts <= now || RP.inQuiet(t.h * 60 + t.m, p.quiet)) continue; out.push({ at: ts, kind: k, body: RP.KIND_LABEL[k] }); }
  return out.sort((a, c) => a.at - c.at);
}
const opts = () => ({ at: settings.remindAt || '20:00', late: !!settings.remindLate });
const api = async (path, body) => {
  const url = await serverUrl(); if (!url) throw new Error('没有推送服务器');
  let r; try { r = await fetch(new URL(path, url).href, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new Error('连不上推送服务器（离线或地址不对）'); }
  const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j.error || 'HTTP ' + r.status); e.code = j.code; throw e; } return j;
};
const u8 = b64 => { const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - b64.length % 4) % 4)); return Uint8Array.from(s, c => c.charCodeAt(0)); };
async function askNotif(ask, permP) {
  if (!('Notification' in globalThis)) throw new Error('这个浏览器不支持通知');
  let p = Notification.permission; if (permP) p = await permP; else if (p === 'default' && ask) p = await Notification.requestPermission();
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
export async function apply({ ask = false, permP = null } = {}) {
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
    await askNotif(ask, permP);
    return pushSubscribe();
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
  await db.meta.set(PENDKEY, null);
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
export async function test(kind) {
  const cap = await capability(); const x = { title: RP.TITLE, body: '提醒已开启 ✅ 到点我会来叫你学习～' };
  if (cap.route === 'native') return LN().schedule({ notifications: [{ id: 7299, ...x, channelId: 'remind', schedule: { at: new Date(Date.now() + 1500), allowWhileIdle: true } }] });
  if (cap.route === 'electron') return NATIVE().test(x);
  if (cap.route === 'push') { const p = await db.meta.get(PUSHKEY, null); if (!p?.endpoint) throw new Error(await db.meta.get(PENDKEY, null) ? '还没连上服务器：联网后会自动开通，再试' : '还没订阅推送，请先打开提醒'); return api('push/test', { endpoint: p.endpoint, ...(kind ? { kind } : {}) }); }
  if (cap.route === 'page') { await askNotif(true); return show(x); }
  throw new Error(cap.lines[0]);
}
/** 进度变了（做题、打卡）：今天的打卡状态变了才重新排（避免频繁打扰服务器） */
let deb = null;
export function watch() {
  addEventListener('zzx-dirty', () => { clearTimeout(deb); deb = setTimeout(refresh, 1500); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); else if (document.visibilityState === 'hidden') { clearTimeout(deb); refresh(); } }); // 切走 / 关 App 前把今天的进度报上去
  navigator.serviceWorker?.addEventListener?.('message', e => { const d = e.data; if (d?.type === 'zzx-push' && d.kind && document.visibilityState === 'visible') import('./ui.js').then(U => U.toast(`${d.title} ${d.body}`, 6000)).catch(() => { }); }); // 网页开着时收到提醒：页面里也提示一下
  addEventListener('online', () => { db.meta.get(PENDKEY, null).then(p => { if (p && settings.remindOn) apply().catch(e => console.warn('提醒联网后开通失败', e.message)); }); });
}
export async function refresh() {
  if (!settings.remindOn) return;
  const pu = await db.meta.get(PUSHKEY, null);
  if (pu?.endpoint && plat() !== 'electron' && !LN()) return pushProgress(pu); // v1.11 推送：只报进度，不重新订阅
  const pend = await db.meta.get(PENDKEY, null); if (pend && (navigator.onLine === false || Date.now() - (pend.at || 0) < 60e3)) return; // 等联网 / 别一直重试
  const st = await today().catch(() => null); if (!st) return;
  if (JSON.stringify([opts(), st, RP.todayKey()]) === lastSig) return;
  await apply().catch(e => console.warn('提醒更新失败', e.message));
}
/** 启动时：提醒开着就重新排（不弹权限请求） */
export async function boot() { if (settings.remindOn) { await apply().catch(e => console.warn('提醒未能安排：', e.message)); } watch(); }
export async function setOn(on) { await saveSettings({ remindOn: on }); return apply({ ask: on }); }

// ———— v1.11 网页推送：订阅 / 报进度 / 改偏好 ————
const pushBody = async () => {
  const pay = await import('./pay.js').catch(() => null);
  return { prefs: prefs(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null, tzOffset: new Date().getTimezoneOffset(), deviceId: await db.deviceId(), billingToken: pay?.token?.() || undefined, platform: plat(), appVersion: APP_VERSION, ...(await pushState()) };
};
const netErr = e => !navigator.onLine || /连不上|Failed to fetch|NetworkError|network|push service|AbortError/i.test(String(e?.message || e) + ' ' + (e?.name || ''));
/** 订阅推送并把偏好 + 今天的状态交给服务器。离线 / 连不上 → 先存着（pending），联网后自动再试 */
async function pushSubscribe() {
  const p = prefs(); const url = await serverUrl();
  try {
    if (navigator.onLine === false) throw new Error('离线');
    const reg = await navigator.serviceWorker.ready; let sub = await reg.pushManager.getSubscription();
    if (!sub) { const { publicKey } = await api('push/vapid'); sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(publicKey) }); }
    const j = sub.toJSON(); const body = await pushBody();
    const r = await api('push/subscribe', { subscription: { endpoint: j.endpoint, keys: j.keys }, ...body });
    await db.meta.set(PUSHKEY, { url, endpoint: j.endpoint, id: r.id, sig: progSig(body), body: { ...body, billingToken: undefined, due: undefined } }); await db.meta.set(PENDKEY, null);
    lastSig = JSON.stringify([p, RP.todayKey()]);
    return { route: 'push', items: nextPush(p), id: r.id };
  } catch (e) {
    if (e?.code && !/rate_limited/.test(e.code)) throw e; // 服务器明确拒绝（格式不对等）：照实报
    if (!netErr(e) && !/离线/.test(e?.message || '')) throw e;
    await db.meta.set(PENDKEY, { at: Date.now(), prefs: p });
    return { route: 'push', items: nextPush(p), pending: true };
  }
}
const progSig = b => JSON.stringify([b.metDate, b.studiedDate, b.streak, b.freezes, b.due, b.tz]);
/** 今天学了 / 打卡了 / 到期卡变了 → 报给服务器（没变不报） */
async function pushProgress(pu) {
  const st = await pushState().catch(() => null); if (!st) return;
  try { const n = st.due[RP.todayKey()] || 0; if (n > 0) await navigator.setAppBadge?.(n); else await navigator.clearAppBadge?.(); } catch { } // 主屏图标上的数字 = 今天到期的卡
  const prefSig = JSON.stringify([prefs(), RP.todayKey()]);
  if (prefSig !== lastSig && lastSig) return apply().catch(e => console.warn('提醒更新失败', e.message));
  const body = { ...st, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null, tzOffset: new Date().getTimezoneOffset() };
  if (progSig(body) === pu.sig) return;
  try { await api('push/progress', { endpoint: pu.endpoint, ...body }); await db.meta.set(PUSHKEY, { ...pu, sig: progSig(body) }); }
  catch (e) { if (e.code === 'no_sub') { await db.meta.set(PUSHKEY, null); apply().catch(() => { }); } }
}
/** 设置页改了提醒偏好：已订阅的直接改服务器上的偏好（不重新订阅）；没订阅 / 离线就走 apply */
export async function updatePrefs(p) {
  const n = await savePrefs(p); if (!settings.remindOn) return { route: 'off', items: [] };
  const pu = await db.meta.get(PUSHKEY, null);
  if (!pu?.endpoint) return apply();
  try { await api('push/prefs', { endpoint: pu.endpoint, prefs: n, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null, tzOffset: new Date().getTimezoneOffset() }); lastSig = JSON.stringify([n, RP.todayKey()]); await db.meta.set(PUSHKEY, { ...pu, body: { ...(pu.body || {}), prefs: n } }); return { route: 'push', items: nextPush(n), id: pu.id }; }
  catch (e) { if (e.code === 'no_sub') { await db.meta.set(PUSHKEY, null); return apply(); } if (netErr(e)) { await db.meta.set(PENDKEY, { at: Date.now(), prefs: n }); return { route: 'push', items: nextPush(n), pending: true }; } throw e; }
}
/** 本机推送状态（设置页显示「本机提醒编号」，管理看板按编号发测试推送） */
export async function pushInfo() { const [pu, pend] = await Promise.all([db.meta.get(PUSHKEY, null), db.meta.get(PENDKEY, null)]); return { id: pu?.id || '', endpoint: pu?.endpoint || '', pending: !!pend }; }
