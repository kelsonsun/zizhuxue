// 同步合并规则（客户端与同步服务器共用，纯函数，无依赖）。
// 每条记录：普通字段 + _f（每个字段最后修改时间）+ _del（删除墓碑时间，可无）。
//  · 按字段“后写者胜”：两台设备改了同一记录的不同字段，两边的修改都保留；同一字段取时间较新的一方。
//  · 学习进度（materials.progress）按键深度合并：A 学了第 1–3 句、B 学了第 4–5 句，合并后 1–5 都算学过。
//  · 复习日志（reviews）只追加、每条有唯一 id，两边的日志合并后全部保留，不会冲突。
//  · 删除：_del 晚于所有字段修改时间 → 视为已删除；删除后又在别处修改（时间更晚）→ 记录复活。
//  · 时间用“设备时间 + 与服务器的时差校正”，避免设备时钟不准导致旧修改覆盖新修改。
export const META_KEYS = new Set(['_f', '_del', 'updatedAt']);
const DEEP = { materials: new Set(['progress']) };
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const J = v => JSON.stringify(v);

/** 深度合并两个普通对象：冲突的叶子取 newerIsA ? a : b */
function deep(a, b, newerIsA) {
  if (!isObj(a) || !isObj(b)) return newerIsA ? a : b;
  const o = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!(k in a)) o[k] = b[k]; else if (!(k in b)) o[k] = a[k]; else o[k] = deep(a[k], b[k], newerIsA);
  }
  return o;
}
/** 给没有 _f 的旧记录补上字段时间（用 updatedAt；示例材料用 1，保证“删了示例”总能赢） */
export function ensureStamps(rec) {
  if (!rec || rec._f) return rec;
  const t = rec.sample ? 1 : (rec.updatedAt || rec.created || rec.ts || 1);
  const f = {}; for (const k of Object.keys(rec)) if (!META_KEYS.has(k)) f[k] = t;
  return { ...rec, _f: f };
}
/** 保存本地修改时，为改动过的字段打上时间戳 */
export function stampChanges(oldRec, newRec, now) {
  const base = oldRec ? ensureStamps(oldRec) : null;
  const f = { ...(base?._f || {}) };
  for (const k of new Set([...Object.keys(newRec), ...(base ? Object.keys(base) : [])])) {
    if (META_KEYS.has(k)) continue;
    if (!base) { f[k] = newRec.sample ? 1 : now; continue; }
    if (!(k in newRec) && !(k in base)) continue;
    if (J(base[k]) !== J(newRec[k])) f[k] = now;
  }
  const out = { ...newRec, _f: f }; delete out._del;
  return out;
}
export const maxStamp = r => Math.max(0, ...Object.values(r?._f || {}));
export const isDeleted = r => !!r && !!r._del && r._del >= maxStamp(r);

/** 合并同一条记录的两个版本（可交换、幂等、可结合：多台设备以任意顺序同步结果一致） */
export function mergeRecord(store, a, b) {
  if (!a) return b ? ensureStamps(b) : a; if (!b) return ensureStamps(a);
  a = ensureStamps(a); b = ensureStamps(b);
  const out = {}, f = {};
  const keys = new Set([...Object.keys(a._f), ...Object.keys(b._f), ...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (META_KEYS.has(k)) continue;
    const ta = a._f[k] ?? 0, tb = b._f[k] ?? 0;
    // 平局时用内容排序决定，保证两边算出同一结果
    const aWins = ta > tb || (ta === tb && (J(a[k]) ?? '') >= (J(b[k]) ?? ''));
    f[k] = Math.max(ta, tb);
    if (DEEP[store]?.has(k) && isObj(a[k]) && isObj(b[k])) out[k] = deep(a[k], b[k], aWins);
    else { const w = aWins ? a : b; if (k in w) out[k] = w[k]; }
  }
  out._f = f;
  const del = Math.max(a._del || 0, b._del || 0); if (del) out._del = del;
  out.updatedAt = Math.max(a.updatedAt || 0, b.updatedAt || 0, maxStamp(out));
  if (isDeleted(out)) { // 已删除：只留墓碑，不再保存内容
    return { id: out.id ?? a.id ?? b.id, _del: out._del, _f: {}, updatedAt: out._del };
  }
  return out;
}
/** 两个版本在“同步意义上”是否相同 */
export const sameRecord = (a, b) => J(norm(a)) === J(norm(b));
function norm(r) { if (!r) return null; const o = {}; for (const k of Object.keys(r).sort()) if (k !== 'updatedAt') o[k] = isObj(r[k]) ? sortObj(r[k]) : r[k]; return o; }
function sortObj(v) { if (!isObj(v)) return v; const o = {}; for (const k of Object.keys(v).sort()) o[k] = sortObj(v[k]); return o; }
