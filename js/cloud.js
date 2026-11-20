// 云同步客户端（可插拔后端）：默认不打扰——不绑定就完全本地使用；需要时「我的 → 绑定/同步」一键绑定，之后长期保持登录、后台自动同步。
// 后端接口见 sync-server/（自托管原型）。换成 Supabase / Firebase / Cloudflare 等时，只需另写一个实现同样方法的适配器。
import * as db from './db.js';
import { mergeRecord, isDeleted, sameRecord } from './syncmerge.js';
import { SyncAdapter } from './sync.js';
import { SYNC_URL } from './deploy.js';

const KEY = 'sync';
const listeners = new Set();
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(f => { try { f(status); } catch { } });
export const status = { state: 'local', msg: '', pending: 0, lastSync: 0, email: null, url: '' };

let cfg = null; // {url, accountId, email, accessToken, accessExpires, refreshToken, cursor, lastSync, skew, auto}
async function load() { if (!cfg) cfg = await db.meta.get(KEY, null) || {}; return cfg; }
async function save() { await db.meta.set(KEY, cfg); }
// 网页版默认用同源服务器（自托管原型同时提供网页和接口）；原生客户端里需填写同步服务器地址
// 默认同步地址：部署配置里填了正式服务器（js/deploy.js 的 SYNC_URL）就用它；否则网页版用同源服务器（自托管原型同时提供网页和接口），原生客户端留空待填
export const defaultUrl = () => SYNC_URL || ((globalThis.Capacitor?.isNativePlatform?.() || globalThis.__TAURI_INTERNALS__ || /\bElectron\//.test(navigator.userAgent)) ? '' : new URL('api/v1/', document.baseURI).href);
export async function getConfig() { await load(); return { ...cfg }; }
export const isBound = async () => !!(await load()).refreshToken;
const deviceName = () => { const u = navigator.userAgent; return /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? '安卓手机' : /Mac/.test(u) ? 'Mac 电脑' : /Windows/.test(u) ? 'Windows 电脑' : '电脑'; };

class HttpError extends Error { constructor(st, body) { super(body?.error || ('HTTP ' + st)); this.status = st; this.code = body?.code; } }
async function call(url, path, body, token) {
  let r;
  try { r = await fetch(new URL(path.replace(/^\//, ''), url).href, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch (e) { const x = new Error('连不上同步服务器（离线或地址不对）'); x.offline = true; throw x; }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(r.status, j);
  return j;
}
export async function checkServer(url) { const j = await call(url, 'health'); if (j.app !== 'zizhuxue-sync') throw new Error('这个地址不是「自主学」同步服务器'); return j; }

// ---- 绑定 ----
export async function emailStart(url, email) { await checkServer(url); return call(url, 'auth/email/start', { email }); }
export async function emailVerify(url, email, code) { return bound(url, await call(url, 'auth/email/verify', { email, code, deviceId: await db.deviceId(), deviceName: deviceName() })); }
export async function pairClaim(url, code) { await checkServer(url); return bound(url, await call(url, 'pair/claim', { code, deviceId: await db.deviceId(), deviceName: deviceName() })); }
export async function pairStart() { return authed(t => call(cfg.url, 'pair/start', {}, t)); }
/** v1.9 授权 / 试用接口（已绑定时用；同一台同步服务器） */
export async function api(path, body) { await load(); return authed(t => call(cfg.url, path, body, t)); }
export async function devices() { return authed(t => call(cfg.url, 'devices', undefined, t)); }
async function bound(url, tok) {
  await load();
  cfg = { url, accountId: tok.accountId, email: tok.email, accessToken: tok.accessToken, accessExpires: tok.accessExpires, refreshToken: tok.refreshToken, cursor: 0, lastSync: 0, skew: cfg.skew || 0, auto: true };
  await save();
  await db.raw.markAllDirty(); // 本机已有（匿名使用时）的材料、生词、复习记录全部合并进账户
  status.email = tok.email; status.url = url;
  await syncNow();
  start();
  return cfg;
}
export async function resetCursor() { await load(); if (cfg.refreshToken) { cfg.cursor = 0; await save(); } }
export async function unbind() {
  await load();
  if (cfg.refreshToken) { try { await authed(t => call(cfg.url, 'auth/logout', {}, t)); } catch { } }
  cfg = {}; await save(); stop(); status.state = 'local'; status.email = null; status.msg = '已解除绑定，本机数据保留。'; emit();
}

// ---- 令牌：访问令牌过期前自动用刷新令牌续期（刷新令牌每次轮换、365 天滑动有效） ----
async function access() {
  await load(); if (!cfg.refreshToken) throw new Error('未绑定');
  if (cfg.accessToken && cfg.accessExpires - 60e3 > Date.now()) return cfg.accessToken;
  const used = cfg.refreshToken;
  try {
    const tok = await call(cfg.url, 'auth/refresh', { refreshToken: used });
    Object.assign(cfg, { accessToken: tok.accessToken, accessExpires: tok.accessExpires, refreshToken: tok.refreshToken, email: tok.email ?? cfg.email }); await save();
    return cfg.accessToken;
  } catch (e) {
    if (e.status === 401) { const fresh = await db.meta.get(KEY, null); if (fresh?.refreshToken && fresh.refreshToken !== used) { cfg = fresh; return access(); } } // 另一个标签页刚轮换过令牌
    if (e.status === 401) { cfg.refreshToken = null; cfg.accessToken = null; cfg.expired = true; await save(); status.state = 'expired'; status.msg = '登录已失效，请重新绑定（本机数据不受影响）'; emit(); }
    throw e;
  }
}
async function authed(fn) {
  try { return await fn(await access()); }
  catch (e) { if (e.status === 401 && e.code === 'unauth') { cfg.accessToken = null; return fn(await access()); } throw e; }
}

// ---- 同步 ----
const BATCH = 300;
let running = null;
export function syncNow() { if (!running) running = doSync().finally(() => { running = null; }); return running; }
async function readLocal(store, id) {
  const r = await db.raw.get(store, id);
  if (r) return db.raw.ensureStamps(r);
  const t = (await db.meta.get('tombstones', [])).filter(x => x.store === store && x.id === id).pop();
  return { id, _del: t?.ts || db.now(), _f: {} };
}
async function doSync() {
  await load(); if (!cfg.refreshToken) return;
  status.state = 'syncing'; status.msg = '同步中…'; emit();
  let pulled = 0, pushed = 0;
  try {
    for (let round = 0; round < 50; round++) {
      const out = (await db.raw.outbox()).sort((a, b) => a.ts - b.ts).slice(0, BATCH);
      const changes = []; for (const e of out) if (db.SYNCED.includes(e.store)) changes.push({ store: e.store, id: e.id, rec: await readLocal(e.store, e.id) });
      const t0 = Date.now(), dev = await db.deviceId();
      const res = await authed(t => call(cfg.url, 'sync', { cursor: cfg.cursor || 0, changes, deviceId: dev }, t));
      cfg.skew = Math.round(res.serverTime - (t0 + Date.now()) / 2); db.setSkew(cfg.skew);
      await db.raw.ack(out); pushed += res.accepted || 0;
      for (const c of res.changes) {
        if (!db.SYNCED.includes(c.store)) continue;
        const local = await db.raw.get(c.store, c.id);
        const pending = (await db.raw.outbox()).some(e => e.key === c.store + ':' + c.id);
        const merged = mergeRecord(c.store, pending ? local : null, c.rec) || c.rec;
        if (isDeleted(merged)) { if (local) await db.raw.del(c.store, c.id); }
        else await db.raw.put(c.store, merged);
        if (pending && !sameRecord(merged, c.rec)) await db.raw.markDirty(c.store, c.id);
        pulled++;
      }
      cfg.cursor = res.cursor; await save();
      if (!res.more && !(await db.raw.outbox()).length) break;
    }
    cfg.lastSync = Date.now(); await save();
    status.state = 'ok'; status.lastSync = cfg.lastSync; status.msg = '已同步';
    if (pulled) globalThis.dispatchEvent?.(new CustomEvent('zzx-synced', { detail: { pulled, pushed } }));
    return { pulled, pushed };
  } catch (e) {
    status.state = e.offline ? 'offline' : (status.state === 'expired' ? 'expired' : 'error');
    status.msg = e.offline ? '现在离线，改动已保存在本机队列，联网后自动同步' : status.state === 'expired' ? status.msg : '同步失败：' + e.message;
    throw e;
  } finally { status.pending = (await db.raw.outbox()).length; emit(); }
}

// ---- 自动同步：启动、联网、回到前台、本地有改动（2 秒防抖）、每 60 秒 ----
let timers = [], deb = null, started = false;
const quiet = () => syncNow().catch(() => { });
export function start() {
  if (started) return; started = true;
  const onDirty = async () => { status.pending = (await db.raw.outbox()).length; emit(); clearTimeout(deb); deb = setTimeout(quiet, 2000); };
  const onVis = () => { if (document.visibilityState === 'visible') quiet(); };
  addEventListener('zzx-dirty', onDirty); addEventListener('online', quiet); document.addEventListener('visibilitychange', onVis);
  const iv = setInterval(() => { if (document.visibilityState === 'visible') quiet(); }, 60e3);
  timers = [() => removeEventListener('zzx-dirty', onDirty), () => removeEventListener('online', quiet), () => document.removeEventListener('visibilitychange', onVis), () => clearInterval(iv)];
}
export function stop() { timers.forEach(f => f()); timers = []; started = false; clearTimeout(deb); }
/** 应用启动时调用：已绑定才联网，未绑定什么都不做（默认不打扰） */
export async function boot() {
  await load(); if (cfg.skew) db.setSkew(cfg.skew);
  if (!cfg.refreshToken) { status.state = cfg.expired ? 'expired' : 'local'; if (cfg.expired) status.msg = '登录已失效，请重新绑定（本机数据不受影响）'; return; }
  status.email = cfg.email; status.url = cfg.url; status.lastSync = cfg.lastSync || 0; status.state = 'ok';
  start(); quiet();
}

/** 适配器形式（与 sync.js 的接口一致），方便以后换后端 */
export class HttpSyncAdapter extends SyncAdapter {
  get id() { return 'http'; }
  get label() { return '自托管同步服务器'; }
  isBound() { return isBound(); }
  bind({ url, email, code, pair }) { return pair ? pairClaim(url, pair) : emailVerify(url, email, code); }
  unbind() { return unbind(); }
  sync() { return syncNow(); }
}
