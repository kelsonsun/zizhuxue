// v1.10 付费与推荐客户端：价格（按商店地区，不按 IP）、邀请、手机验证、打卡上报、优惠码、下单。
// 在线付款 / 短信默认都未开通时，界面如实说明，绝不假装已经能收款或已发出短信。
import * as EP from './endpoint.js';
import * as P from './pricetable.js';
import { isNativeApp } from './state.js';

const TOK = 'zzx.billTok', REG = 'zzx.storeRegion', DEV = 'zzx.billDev', INV = 'zzx.pendingInvite';
const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { return null; } };
export const deviceId = () => { let d = ls(DEV); if (!d) { d = 'dev_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); ls(DEV, d); } return d; };
export const token = () => ls(TOK) || '';
export const setToken = t => ls(TOK, t || null);
export const pendingInvite = () => ls(INV) || '';
export const setPendingInvite = c => ls(INV, c ? String(c).toUpperCase().replace(/\s+/g, '') : null);
export const savedRegion = () => ls(REG) || '';
export const setRegion = r => ls(REG, r || null);

/** 地区来源：用户自选 > 系统语言粗分（仅作默认建议，用户可改）> 未选。绝不使用 IP。 */
export function suggestRegion() {
  const s = savedRegion(); if (s) return s;
  try {
    const lang = (globalThis.navigator?.language || '').toLowerCase();
    if (lang.startsWith('zh-cn') || lang === 'zh') return 'CN';
    if (lang.startsWith('zh-tw')) return 'TW';
    if (lang.startsWith('zh-hk')) return 'HK';
    if (lang.startsWith('ja')) return 'JP';
    if (lang.startsWith('ko')) return 'KR';
    if (lang.startsWith('en-gb')) return 'GB';
    if (lang.startsWith('en-au')) return 'AU';
    if (lang.startsWith('en-ca') || lang.startsWith('fr-ca')) return 'CA';
    if (lang.startsWith('ms')) return 'MY';
    if (lang.startsWith('en-sg')) return 'SG';
  } catch { }
  return '';
}

export const isIos = () => {
  if (isNativeApp()) { try { return /ios/i.test(globalThis.Capacitor?.getPlatform?.() || ''); } catch { } }
  return /iPhone|iPad|iPod/i.test(globalThis.navigator?.userAgent || '');
};
/** 中国大陆 iOS：不得在 App 内引导去网页付款 */
export const blockWebPay = (region) => isIos() && isNativeApp() && (region || suggestRegion()) === 'CN';

const base = () => EP.billingUrl();
async function api(path, { method = 'GET', body, auth = true } = {}) {
  const url = base(); if (!url) throw Object.assign(new Error('没有付费服务器地址'), { code: 'no_server' });
  const h = { 'Content-Type': 'application/json' };
  if (auth && token()) h.Authorization = 'Bearer ' + token();
  const r = await fetch(url + path.replace(/^\//, ''), { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false && j.error) throw Object.assign(new Error(j.error || '请求失败'), { code: j.code || 'error', status: r.status, j });
  return j;
}

let catalogCache = null;
export async function catalog(force = false) {
  if (catalogCache && !force) return catalogCache;
  try { catalogCache = await api('catalog', { auth: false }); }
  catch { catalogCache = { ok: true, enabled: false, sms: 'off', pay: 'none', prices: P.DEFAULT_PRICES, rules: { firstWeekDays: 7, firstWeekCheckins: 3, checkinGoal: 10, rewardHoldDays: 30, discountPercent: 20 }, notes: { region: '价格按应用商店地区或你选择的地区显示，不按 IP 区分。', pay: '暂时无法从服务器读取价格，先显示默认价格表。' } }; }
  return catalogCache;
}
export const pricesOf = async () => (await catalog()).prices || P.DEFAULT_PRICES;
export const rowOf = async (region) => P.rowOf(await pricesOf(), region || suggestRegion() || 'OTHER');

export async function me() { const j = await api('me'); return j.me; }
export async function sendPhone(phone, inviteCode) { return api('phone/send', { method: 'POST', body: { phone, d: deviceId(), inviteCode: inviteCode || pendingInvite() }, auth: false }); }
export async function verifyPhone(phone, code, inviteCode, today) {
  const j = await api('phone/verify', { method: 'POST', body: { phone, code, d: deviceId(), inviteCode: inviteCode || pendingInvite(), today }, auth: false });
  if (j.token) setToken(j.token);
  if (j.me) setPendingInvite(null);
  return j;
}
export async function peekInvite(code) { return api('invite?code=' + encodeURIComponent(code), { auth: false }); }
export async function reportCheckin(day, n, goal) {
  if (!token()) return null;
  try { return await api('checkin', { method: 'POST', body: { day, n, goal, d: deviceId() } }); } catch { return null; }
}
export async function quote(period, region, coupon) { return api('quote', { method: 'POST', body: { period, region, coupon: coupon || '', d: deviceId() }, auth: !!token() }); }
export async function placeOrder(period, region, coupon, payAccount) { return api('order', { method: 'POST', body: { period, region, coupon: coupon || '', payAccount: payAccount || '', d: deviceId() } }); }
export async function payOrder(orderId, payAccount) { return api('pay', { method: 'POST', body: { orderId, payAccount: payAccount || '' } }); }

export function inviteLink(code, origin) {
  const loc = globalThis.location;
  const o = (origin || loc?.origin || '').replace(/\/+$/, '');
  const path = loc?.pathname && loc.pathname !== '/' ? loc.pathname : '/';
  const tail = `#/invite?c=${encodeURIComponent(code)}`;
  return o ? `${o}${path}${tail}` : tail;
}
export const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
