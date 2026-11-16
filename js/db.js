// 本地数据层：IndexedDB（本地优先）。IndexedDB 不可用时退回内存并提示。
const DB_NAME = 'zizhuxue', VER = 1;
const STORES = { materials: 'id', cards: 'id', reviews: { autoIncrement: true }, meta: 'key', blobs: 'id' };
let dbp = null, mem = null;
export let storageMode = 'indexeddb';

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    if (!('indexedDB' in globalThis)) return rej(new Error('no idb'));
    const r = indexedDB.open(DB_NAME, VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const [n, kp] of Object.entries(STORES)) if (!db.objectStoreNames.contains(n))
        db.createObjectStore(n, typeof kp === 'string' ? { keyPath: kp } : kp);
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('blocked'));
  }).catch(e => { console.warn('IndexedDB 不可用，退回内存存储', e); storageMode = 'memory'; mem = Object.fromEntries(Object.keys(STORES).map(k => [k, new Map()])); return null; });
  return dbp;
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
  if (mem) { const k = val.id ?? val.key ?? mem[store].size + 1; mem[store].set(k, val); return; }
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

const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
export const newId = uid;

// ---- 业务 API ----
export const materials = {
  all: () => getAll('materials'),
  get: id => get('materials', id),
  async save(m) { m.updatedAt = Date.now(); if (!m.created) m.created = m.updatedAt; await put('materials', m); return m; },
  async remove(id) {
    await del('materials', id); await addTombstone('materials', id);
    const m = await getAll('cards'); // 级联：删除该材料的卡片
    for (const c of m) if (c.materialId === id) { await del('cards', c.id); await addTombstone('cards', c.id); }
    await del('blobs', 'audio:' + id);
  },
};
export const cards = {
  all: () => getAll('cards'),
  get: id => get('cards', id),
  async save(c) { c.updatedAt = Date.now(); if (!c.created) c.created = c.updatedAt; await put('cards', c); return c; },
  async remove(id) { await del('cards', id); await addTombstone('cards', id); },
};
export const reviews = { all: () => getAll('reviews'), add: r => put('reviews', r) };
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
  if (mode === 'replace') for (const r of data.reviews || []) await put('reviews', r);
  if (data.settings && mode === 'replace') await meta.set('settings', data.settings);
  return { materials: nm, cards: nc };
}
export async function wipeAll() { for (const s of Object.keys(STORES)) await clear(s); }
