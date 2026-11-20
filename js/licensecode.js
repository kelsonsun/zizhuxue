// v1.9 激活码（私域收费第一阶段，不需要服务器）：Ed25519 签名，App 离线验证。
// 内容 8 字节：版本(1) 套餐(1) 到期日(2，2020-01-01 起的天数；65535=永久) 编号(4)；签名 64 字节。
// 编码：Crockford Base32（不分大小写，O/0、I/L/1 自动当成同一个字），末尾 2 位校验（区分“输错了”和“假的”），
// 显示成 ZZX1-XXXXX-XXXXX-…（共 118 位，分 5 位一组）。私钥只在发码工具那里，App 里只有公钥。
import * as E from './ed25519.js';
export const PLANS = { 1: { id: 'basic', name: '基础版' }, 2: { id: 'ai', name: '含 AI 版' } };
export const PLAN_NUM = { basic: 1, ai: 2 };
export const FOREVER = 65535;
const DOMAIN = new TextEncoder().encode('zizhuxue-license-v1:');
const AB = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const EPOCH = Date.UTC(2020, 0, 1);
/** 'YYYY-MM-DD' ↔ 天数 */
export const dayOf = ymd => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd)); if (!m) return NaN; return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - EPOCH) / 864e5); };
export const ymdOf = day => new Date(EPOCH + day * 864e5).toISOString().slice(0, 10);
/** 本地日期（用户所在时区的“今天”）→ 天数 */
export const localDay = ms => { const d = new Date(ms); return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH) / 864e5); };
export const b32 = bytes => { let bits = 0, v = 0, out = ''; for (const b of bytes) { v = (v << 8) | b; bits += 8; while (bits >= 5) { out += AB[(v >>> (bits - 5)) & 31]; bits -= 5; } v &= (1 << bits) - 1; } if (bits) out += AB[(v << (5 - bits)) & 31]; return out; };
export const unb32 = (s, n) => { const o = new Uint8Array(n); let bits = 0, v = 0, i = 0; for (const ch of s) { const x = AB.indexOf(ch); if (x < 0) return null; v = (v << 5) | x; bits += 5; if (bits >= 8) { if (i < n) o[i++] = (v >>> (bits - 8)) & 255; bits -= 8; } v &= (1 << bits) - 1; } return i === n ? o : null; };
const crc10 = bytes => { let c = 0x3ff; for (const b of bytes) { c ^= b << 2; for (let k = 0; k < 8; k++) c = c & 0x200 ? ((c << 1) ^ 0x233) & 0x3ff : (c << 1) & 0x3ff; } return c; };
const payload = ({ plan, expDay, serial }) => Uint8Array.of(1, plan, (expDay >> 8) & 255, expDay & 255, (serial >>> 24) & 255, (serial >>> 16) & 255, (serial >>> 8) & 255, serial & 255);
const msgOf = p => { const m = new Uint8Array(DOMAIN.length + p.length); m.set(DOMAIN); m.set(p, DOMAIN.length); return m; };
export const group = s => 'ZZX1-' + s.match(/.{1,5}/g).join('-');
/** 生成激活码（发码工具用）：plan 'basic'|'ai'，expires 'YYYY-MM-DD' 或 null（永久），serial 正整数 */
export function makeCode(seed, { plan, expires, serial }) {
  const p = PLAN_NUM[plan] || +plan; if (!PLANS[p]) throw new Error('套餐只能是 basic 或 ai');
  const expDay = expires == null || expires === '' || expires === 'forever' ? FOREVER : dayOf(expires); if (!(expDay > 0 && expDay <= FOREVER)) throw new Error('到期日格式应为 YYYY-MM-DD');
  if (!(Number.isInteger(serial) && serial > 0 && serial < 2 ** 32)) throw new Error('编号应为正整数');
  const pl = payload({ plan: p, expDay, serial }), sig = E.sign(seed, msgOf(pl)), all = new Uint8Array(72); all.set(pl); all.set(sig, 8);
  const c = crc10(all); return group(b32(all) + AB[c >> 5] + AB[c & 31]);
}
/** 规范化用户输入：去空格 / 横线 / 换行，大写，O→0、I/L→1，去掉 ZZX1 前缀 */
export const normalize = s => { let t = String(s || '').toUpperCase().replace(/[\s\-_.,，、—]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1'); if (t.length === 122 && t.startsWith('ZZX1')) t = t.slice(4); return t; };
/** 验证（离线）：返回 {ok, err?, plan, planName, expires, expDay, serial, forever} */
export function readCode(input, pub) {
  const t = normalize(input);
  if (t.length !== 118) return { ok: false, err: 'format', msg: t.length ? `激活码长度不对（应为 118 位字符，现在 ${t.length} 位）。请整段复制粘贴。` : '请粘贴激活码' };
  const all = unb32(t.slice(0, 116), 72), ck = AB.indexOf(t[116]) * 32 + AB.indexOf(t[117]);
  if (!all || ck < 0) return { ok: false, err: 'format', msg: '激活码里有不认识的字符' };
  if (crc10(all) !== ck) return { ok: false, err: 'typo', msg: '激活码好像有字符输错或漏了，请核对或重新复制' };
  const pl = all.slice(0, 8), sig = all.slice(8);
  if (pl[0] !== 1) return { ok: false, err: 'version', msg: '这个激活码需要更新版本的自主学' };
  if (!E.verify(pub, msgOf(pl), sig)) return { ok: false, err: 'sig', msg: '这不是有效的自主学激活码' };
  const plan = pl[1], expDay = (pl[2] << 8) | pl[3], serial = ((pl[4] << 24) | (pl[5] << 16) | (pl[6] << 8) | pl[7]) >>> 0;
  if (!PLANS[plan]) return { ok: false, err: 'plan', msg: '这个激活码的套餐需要更新版本的自主学' };
  const forever = expDay === FOREVER;
  return { ok: true, plan: PLANS[plan].id, planName: PLANS[plan].name, expDay, expires: forever ? null : ymdOf(expDay), forever, serial };
}
const hex = s => Uint8Array.from(s.match(/../g).map(h => parseInt(h, 16)));
export const fromHex = hex;
export const toHex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
