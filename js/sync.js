// 同步适配器接口（本地优先）。
// 第一版只有 LocalOnlyAdapter（不联网）。后续“一键绑定云同步”只需实现 SyncAdapter 并在设置里注册，
// 数据层已为每条记录维护 updatedAt，删除记录以墓碑（tombstone）形式保留，合并策略为“后写者胜”。
export class SyncAdapter {
  get id() { return 'abstract'; }
  get label() { return '未命名'; }
  /** 是否已绑定账号/设备（并保持长期登录） */
  async isBound() { return false; }
  /** 一键绑定：成功后应把长期令牌保存在本机，之后无需再次登录 */
  async bind(_opts) { throw new Error('未实现'); }
  async unbind() { throw new Error('未实现'); }
  /** 把本地快照推到云端，返回云端最新快照（供合并） */
  async push(_snapshot) { throw new Error('未实现'); }
  async pull() { throw new Error('未实现'); }
}
export class LocalOnlyAdapter extends SyncAdapter {
  get id() { return 'local'; }
  get label() { return '仅本机（未绑定云同步）'; }
}

const STORES = ['materials', 'cards'];
/** 合并两个快照 {materials:[], cards:[], tombstones:[{store,id,ts}]}；每条记录需有 id 与 updatedAt。 */
export function mergeSnapshots(local, remote) {
  const tomb = new Map();
  for (const t of [...(local.tombstones || []), ...(remote.tombstones || [])]) {
    const k = t.store + ':' + t.id; if (!tomb.has(k) || tomb.get(k).ts < t.ts) tomb.set(k, t);
  }
  const out = { tombstones: [...tomb.values()] };
  for (const st of STORES) {
    const m = new Map();
    for (const r of [...(local[st] || []), ...(remote[st] || [])]) {
      const o = m.get(r.id); if (!o || (r.updatedAt || 0) > (o.updatedAt || 0)) m.set(r.id, r);
    }
    out[st] = [...m.values()].filter(r => { const t = tomb.get(st + ':' + r.id); return !t || t.ts < (r.updatedAt || 0); });
  }
  return out;
}
