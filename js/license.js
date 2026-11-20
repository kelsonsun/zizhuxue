// v1.9 授权与试用（本机存取 + 第二阶段的服务器对账）。规则在 trial.js，激活码格式在 licensecode.js，可改的数在 billing.js。
// 防清数据重置（尽力而为）：试用记录同时存在 IndexedDB、localStorage、Cache Storage 三处，读时取最大；
// 导出备份带上试用记录，导入时取最大；复习 / 测验作答记录（会跟着备份和云同步回来）反推“至少用过几次”；
// 绑定了同步服务器时，次数以服务器记录为准（取最大）。见过的最大时间也同样多处保存，防把日期往回调。
import * as db from './db.js';
import * as T from './trial.js';
import * as C from './licensecode.js';
import { LICENSE_PUBLIC_KEY } from './licensekey.js';
import { CHANNEL } from './channel.js';
import { isNativeApp } from './state.js';

const PUB = C.fromHex(LICENSE_PUBLIC_KEY);
const LS = 'zzx.lic', CACHE = 'zzx-lic', ckey = () => new URL('./__zzx_lic__', location.href).href; // Cache Storage 里的一份（不对应真实网址，只当键用）
let st = null, loading = null;
export const offer = () => T.offerView(CHANNEL);
const lsGet = () => { try { return JSON.parse(localStorage.getItem(LS) || 'null'); } catch { return null; } };
async function cacheGet() { try { if (!globalThis.caches) return null; const r = await (await caches.open(CACHE)).match(ckey()); return r ? await r.json() : null; } catch { return null; } }
async function persist() {
  st.savedMax = st.clockMax;
  const blob = { trial: st.trial, clockMax: st.clockMax, code: st.code || null };
  await db.meta.set('trial', st.trial); await db.meta.set('clockMax', st.clockMax);
  if (st.code) await db.meta.set('license', { code: st.code, at: st.codeAt || Date.now() }); else await db.meta.set('license', null);
  try { localStorage.setItem(LS, JSON.stringify(blob)); } catch { }
  try { if (globalThis.caches) await (await caches.open(CACHE)).put(ckey(), new Response(JSON.stringify(blob), { headers: { 'Content-Type': 'application/json' } })); } catch { }
}
async function doLoad() {
  const [mt, mc, ml, ms, revs, ca] = await Promise.all([db.meta.get('trial', null), db.meta.get('clockMax', 0), db.meta.get('license', null), db.meta.get('licServer', null), db.reviews.all(), cacheGet()]);
  const ls = lsGet();
  const trial = T.mergeTrial(mt, ls?.trial, ca?.trial, ms?.trial);
  const floor = T.floorFromReviews(revs, T.cfgOf(), trial.log); // 起算日期以后的作答记录反推的下限（只在判断试用时用，不改记录）
  const code = ml?.code || ls?.code || ca?.code || null;
  st = { trial, clockMax: Math.max(mc || 0, ls?.clockMax || 0, ca?.clockMax || 0), code, codeAt: ml?.at, server: ms, floor };
  tick(); await persist(); return st;
}
export async function load(force = false) { if (st && !force) return st; if (!loading || force) loading = doLoad().finally(() => { loading = null; }); return loading; }
/** 可信的“现在”：不比见过的最大时间早（防调日期） */
function tick() { const c = T.clockNow(Date.now(), st.clockMax); st.back = c.back; if (Date.now() > (st.clockMax || 0)) st.clockMax = Date.now(); return c.now; }
export function decoded(code = st?.code) { return code ? C.readCode(code, PUB) : null; }
/** 汇总：授权状态 + 试用 + 显示规则 */
export async function info() {
  await load(); const now = tick(), o = offer();
  if (st.clockMax - (st.savedMax || 0) > 60000) await persist(); // 见过的最新时间：往前走了就记下来（防之后把日期往回调）
  const lic = decoded(), ls = T.licenseStatus(lic, now);
  const srv = st.server && st.server.ok ? st.server : null;
  const deviceBlocked = !!(srv && srv.deviceOk === false && lic?.ok && srv.serials?.includes(lic.serial));
  const srvLicensed = !!(srv && srv.deviceOk !== false && srv.plan && (srv.expDay == null || srv.expDay >= C.localDay(now)) && now - (srv.at || 0) < 30 * 864e5);
  const licensed = (['active', 'expiring'].includes(ls.state) && !deviceBlocked) || srvLicensed;
  const g = T.gate({ trial: st.trial, floor: st.floor, licensed, now, enforce: o.enforce });
  return { ...g, lic, ls, offer: o, back: st.back, server: srv, deviceBlocked, srvLicensed, trial: st.trial, floor: st.floor, now };
}
export const gateNow = info;
/** 学完一次（celebrate.sessionDone 调用） */
export async function countUse(ev) {
  await load(); const now = tick();
  const r = T.countUse(st.trial, ev, now); st.trial = r.trial; await persist();
  if (r.counted) serverSync().catch(() => { });
  return r.counted;
}
/** 一次学习操作（答题、点按、播放）：延续当前这段学习（停下超过 30 分钟再学才算新的一次）。调用方已节流（最多 15 秒一次） */
export async function touch() {
  await load(); if ((await info()).locked) return; // 已被挡住时不算学习操作
  const now = tick(); st.trial = T.touch(st.trial, now); await persist();
}
/** 输入激活码 */
export async function activate(input) {
  await load(); const r = C.readCode(input, PUB); if (!r.ok) throw new Error(r.msg);
  const s = T.licenseStatus(r, tick());
  if (s.state === 'revoked') throw new Error(`这个激活码（#${r.serial}）已作废，请联系我们`);
  if (s.state === 'expired') throw new Error(`这个激活码已在 ${r.expires} 到期`);
  st.code = C.normalize(input); st.codeAt = Date.now(); await persist();
  let server = null;
  try { const cloud = await import('./cloud.js'); if (await cloud.isBound()) { server = await cloud.api('license/activate', { code: st.code }); await saveServer(server); } }
  catch (e) { if (e.code === 'device_limit' || e.code === 'used_elsewhere') { await saveServer({ ok: true, deviceOk: false, serials: [r.serial], reason: e.message, at: Date.now() }); throw Object.assign(new Error(e.message), { saved: true }); } }
  return { ...r, server };
}
export async function removeCode() { await load(); st.code = null; await persist(); }
async function saveServer(s) { st.server = { ...s, at: Date.now() }; await db.meta.set('licServer', st.server); }
/** 第二阶段：绑定了同步服务器时，和服务器对一下试用次数、订阅、设备数（取最大 / 以服务器为准） */
export async function serverSync() {
  const cloud = await import('./cloud.js'); if (!(await cloud.isBound())) return null; await load();
  const t = await cloud.api('trial/sync', { used: st.trial.used, last: st.trial.last, first: st.trial.first, log: st.trial.log.map(l => l.t) });
  st.trial = T.mergeTrial(st.trial, t.trial);
  const s = await cloud.api('license/status');
  if (s.serverTime) trusted(s.serverTime);
  await saveServer({ ok: true, ...s, trial: st.trial }); await persist();
  return st.server;
}
/** 可信时间（服务器给的）：纠正“见过的最大时间”（以前把日期调到未来过的情况） */
function trusted(t) { if (!(t > 1.6e12)) return; if (st.clockMax > t + 864e5) st.clockMax = Math.max(t, Math.min(Date.now(), t + 10 * 60000)); else st.clockMax = Math.max(st.clockMax, t); st.back = Date.now() < t - 10 * 60000; }
/** 网页版联网时：用网站响应头里的时间校正（不需要自己的服务器；离线时什么都不做） */
export async function trustWebTime() {
  if (isNativeApp() || !globalThis.fetch || navigator.onLine === false) return;
  try { const r = await fetch(new URL('manifest.webmanifest', document.baseURI).href, { method: 'HEAD', cache: 'no-store' }); const d = Date.parse(r.headers.get('date') || ''); if (d) { await load(); trusted(d); await persist(); } } catch { }
}
export async function boot() {
  await load(); trustWebTime().catch(() => { });
  serverSync().catch(() => { });
  let lastSrv = Date.now(); addEventListener('zzx-synced', () => { if (Date.now() - lastSrv < 10 * 60000) return; lastSrv = Date.now(); serverSync().catch(() => { }); });
}
