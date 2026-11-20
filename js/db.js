// 本地数据层：IndexedDB（本地优先）。IndexedDB 不可用时退回内存并提示。
import { stampChanges, ensureStamps } from './syncmerge.js';
const DB_NAME = 'zizhuxue', VER = 2;
// v2：复习日志改为每条有唯一 id（可跨设备合并追加）；新增 outbox（离线同步队列：本机改动过、尚未推到云端的记录）
const STORES = { materials: 'id', cards: 'id', reviews: 'id', meta: 'key', blobs: 'id', outbox: 'key' };
export const SYNCED = ['materials', 'cards', 'reviews'];
let dbp = null, mem = null;
export let storageMode = 'indexeddb';

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    if (!('indexedDB' in globalThis)) return rej(new Error('no idb'));
    const r = indexedDB.open(DB_NAME, VER);
    r.onupgradeneeded = (ev) => {
      const db = r.result, t = r.transaction;
      const make = () => { for (const [n, kp] of Object.entries(STORES)) if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, { keyPath: kp }); };
      if (ev.oldVersion >= 1 && db.objectStoreNames.contains('reviews') && t.objectStore('reviews').keyPath !== 'id') {
        // 迁移 v1 → v2：旧复习日志（自增键）读出 → 重建为按 id 存储，并补上唯一 id
        const g = t.objectStore('reviews').getAll();
        g.onsuccess = () => { db.deleteObjectStore('reviews'); make(); const st = t.objectStore('reviews'); for (const x of g.result) st.put({ ...x, id: x.id || uid() }); };
      } else make();
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('blocked'));
  }).catch(e => { console.warn('IndexedDB 不可用，退回内存存储', e); storageMode = 'memory'; mem = Object.fromEntries(Object.keys(STORES).map(k => [k, new Map()])); return null; });
  return dbp;
}
// 同步钩子：本地修改写入 outbox，并广播事件（同步模块据此在后台推送）
const DEVICE_CLOCK = { skew: 0 };                         // 与服务器的时差（同步时校正）
export const now = () => Date.now() + DEVICE_CLOCK.skew;
export const setSkew = ms => { DEVICE_CLOCK.skew = ms; };
async function markDirty(store, id) {
  await put('outbox', { key: store + ':' + id, store, id, ts: now() });
  globalThis.dispatchEvent?.(new Event('zzx-dirty'));
}
const tx = async (store, mode, fn) => {
  const db = await open();
  if (!db) return fn(null);
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode); const s = t.objectStore(store);
    let out; try { out = fn(s); } catch (e) { rej(e); return; }
    t.oncomplete = () => res(out && out.__req ? out.result : out);
    t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  });
};
const wrap = (req) => { const o = { __req: true }; Object.defineProperty(o, 'result', { get: () => req.result }); return o; };

export async function getAll(store) {
  await open(); if (mem) return [...mem[store].values()];
  return tx(store, 'readonly', s => wrap(s.getAll()));
}
export async function get(store, key) {
  await open(); if (mem) return mem[store].get(key);
  return tx(store, 'readonly', s => wrap(s.get(key)));
}
export async function put(store, val) {
  await open();
  if (mem) { mem[store].set(val[STORES[store]], val); return; }
  return tx(store, 'readwrite', s => { s.put(val); });
}
export async function del(store, key) {
  await open(); if (mem) { mem[store].delete(key); return; }
  return tx(store, 'readwrite', s => { s.delete(key); });
}
export async function clear(store) {
  await open(); if (mem) { mem[store].clear(); return; }
  return tx(store, 'readwrite', s => { s.clear(); });
}

function uid() { return Math.random().toString(36).slice(2, 8) + Date.now().toString(36); }
export const newId = uid;

// ---- 业务 API ----
/** 保存一条可同步记录：给改动的字段打时间戳（按字段合并用），并进入同步队列 */
async function saveSynced(store, rec) {
  const t = now(); const old = await get(store, rec.id);
  rec.updatedAt = t; if (!rec.created) rec.created = t;
  const stamped = stampChanges(old, rec, t); rec._f = stamped._f; delete rec._del;
  await put(store, rec); await markDirty(store, rec.id);
  // v1.9.2 匿名统计：新建了一份材料（导入成功）。示例材料、书的各章（整本书算一次）不算
  if (store === 'materials' && (!old || old._del) && !rec.sample && !rec.bookId) globalThis.dispatchEvent?.(new Event('zzx-imported'));
  return rec;
}
/** 撤销删除：把删除前的记录原样放回，所有字段重新打上“现在”的时间戳（晚于墓碑 → 各设备合并后都视为复活），并移除本机墓碑 */
export async function restoreSynced(store, rec) {
  const t = now(); const r = { ...rec }; delete r._del; r._f = {};
  for (const k of Object.keys(r)) if (k !== '_f' && k !== 'updatedAt') r._f[k] = t;
  await put(store, r);
  const tb = await meta.get('tombstones', []); await meta.set('tombstones', tb.filter(x => !(x.store === store && x.id === r.id)));
  await markDirty(store, r.id); return r;
}
async function removeSynced(store, id) {
  await del(store, id); await addTombstone(store, id); await markDirty(store, id);
}
export const materials = {
  all: () => getAll('materials'),
  get: id => get('materials', id),
  save: m => saveSynced('materials', m),
  /** 删除材料（写删除墓碑，云同步会传播）。cards=true 时级联删除由它收藏的卡片；false 时卡片保留在生词本里照常复习 */
  async remove(id, { cards = true } = {}) {
    await removeSynced('materials', id);
    if (cards) { const m = await getAll('cards'); for (const c of m) if (c.materialId === id) await removeSynced('cards', c.id); }
    await del('blobs', 'audio:' + id);
  },
};
export const cards = {
  all: () => getAll('cards'),
  get: id => get('cards', id),
  save: c => saveSynced('cards', c),
  remove: id => removeSynced('cards', id),
};
// 复习日志：只追加，每条有唯一 id 与设备 id，跨设备合并不冲突
export const reviews = {
  all: () => getAll('reviews'),
  async add(r) { const t = now(); const rec = { ...r, id: r.id || uid(), dev: await deviceId(), _f: {} }; for (const k of Object.keys(rec)) if (k !== '_f') rec._f[k] = t; await put('reviews', rec); await markDirty('reviews', rec.id); globalThis.dispatchEvent?.(new Event('zzx-study')); return rec; }, // v1.9：答题 = 学习操作（延续这一次学习）
};
/** 本机匿名设备 ID：首次使用自动生成，不需要登录 */
let devId = null;
export async function deviceId() {
  if (devId) return devId;
  devId = (await get('meta', 'deviceId'))?.value;
  if (!devId) { devId = 'd_' + uid() + uid(); await put('meta', { key: 'deviceId', value: devId }); }
  return devId;
}
/** 同步模块专用：读写记录但不进入队列（来自云端的数据） */
export const raw = {
  get, put, del, getAll,
  outbox: () => getAll('outbox'),
  async ack(entries) { for (const e of entries) { const cur = await get('outbox', e.key); if (cur && cur.ts <= e.ts) await del('outbox', e.key); } },
  markDirty,
  async markAllDirty() { for (const st of SYNCED) for (const r of await getAll(st)) await put('outbox', { key: st + ':' + r.id, store: st, id: r.id, ts: now() }); for (const t of await meta.get('tombstones', [])) if (SYNCED.includes(t.store)) await put('outbox', { key: t.store + ':' + t.id, store: t.store, id: t.id, ts: now() }); },
  ensureStamps,
};
export const meta = {
  get: async (k, d) => (await get('meta', k))?.value ?? d,
  set: (k, v) => put('meta', { key: k, value: v }),
};
export const blobs = { get: id => get('blobs', id), set: (id, blob) => put('blobs', { id, blob }), del: id => del('blobs', id) };

async function addTombstone(store, id) {
  const t = await meta.get('tombstones', []); t.push({ store, id, ts: Date.now() }); await meta.set('tombstones', t.slice(-5000));
}

/** 导出：不含 AI 密钥与录音。 */
export async function exportAll() {
  return {
    app: 'zizhuxue', version: 1, exportedAt: new Date().toISOString(),
    materials: await getAll('materials'), cards: await getAll('cards'), reviews: await getAll('reviews'),
    settings: await meta.get('settings', {}), tombstones: await meta.get('tombstones', []),
    trial: await meta.get('trial', null), license: (await meta.get('license', null))?.code || null, // v1.9：试用记录和激活码跟着备份走（导入时次数取最大，清数据再导入也不会重置）
  };
}
export async function importAll(data, { mode = 'merge' } = {}) {
  if (!data || data.app !== 'zizhuxue' || !Array.isArray(data.materials) || !Array.isArray(data.cards)) throw new Error('这不是「自主学」的备份文件');
  if (mode === 'replace') { await clear('materials'); await clear('cards'); await clear('reviews'); }
  const local = { materials: await getAll('materials'), cards: await getAll('cards') };
  const have = new Map(); local.materials.forEach(m => have.set('m' + m.id, m)); local.cards.forEach(c => have.set('c' + c.id, c));
  let nm = 0, nc = 0;
  for (const m of data.materials) { const o = have.get('m' + m.id); if (!o || (m.updatedAt || 0) > (o.updatedAt || 0)) { await put('materials', m); nm++; } }
  for (const c of data.cards) { const o = have.get('c' + c.id); if (!o || (c.updatedAt || 0) > (o.updatedAt || 0)) { await put('cards', c); nc++; } }
  if (mode === 'replace') for (const r of data.reviews || []) await put('reviews', { ...r, id: r.id || uid() });
  if (data.settings && mode === 'replace') await meta.set('settings', data.settings);
  if (data.trial) { const cur = await meta.get('trial', null) || {}; await meta.set('trial', { ...cur, used: Math.max(+cur.used || 0, +data.trial.used || 0), last: Math.max(+cur.last || 0, +data.trial.last || 0), first: Math.min(...[cur.first, data.trial.first].filter(x => x > 0), Date.now()), log: cur.log || data.trial.log || [] }); }
  if (data.license && !(await meta.get('license', null))?.code) await meta.set('license', { code: data.license, at: Date.now() });
  return { materials: nm, cards: nc };
}
// v1.9：清空数据不清试用记录和激活码（trial / license / clockMax / licServer）
export async function wipeAll() { for (const s of Object.keys(STORES)) if (s !== 'meta') await clear(s); const keep = ['deviceId', 'sync', 'ai', 'aiConfig', 'trial', 'license', 'clockMax', 'licServer']; for (const r of await getAll('meta')) if (!keep.includes(r.key)) await del('meta', r.key); }
