// v1.9 试用次数 / 授权状态 / 付费入口显示规则（纯函数，单元测试覆盖；存取在 license.js）。
import * as B from './billing.js';
import { localDay } from './licensecode.js';
export const sinceOf = ymd => new Date((ymd || B.TRIAL_LAUNCH) + 'T00:00:00').getTime(); // 起算日期（本地 0 点）
export const cfgOf = (o = {}) => ({ since: sinceOf(B.TRIAL_SINCE), uses: B.TRIAL_USES, gapMin: B.SESSION_GAP_MIN, minAnswers: B.MIN_ANSWERS, warn: B.WARN_REMAINING, renewDays: B.RENEW_WARN_DAYS, ...o });
const LOG_MAX = 1000; // 每次（每段学习）计次的时间都记下（按起算日期计数、多设备合并要用）
// 字段：used 次数；last 最后一次学习操作的时间；ss 当前这段学习的开始时间；cs 最近一次计过次的那段学习的开始时间；first 第一次计次；log 计次时间
export const emptyTrial = () => ({ used: 0, last: 0, ss: 0, cs: 0, first: 0, log: [] });
/** 一组计次时间按“相隔不到 gapMin 分钟算同一段”数段数（多台设备同时在学时不重复算；同一台设备两段之间至少隔 gapMin 分钟，数出来就是原次数） */
export function sessionsFromTimes(times, gapMin) {
  const ts = [...times].map(Number).filter(x => x > 0).sort((a, b) => a - b); let n = 0, prev = -Infinity;
  for (const t of ts) { if (t - prev >= gapMin * 60000) n++; prev = t; }
  return n;
}
/** 合并几处存的试用记录（本机多处 / 备份 / 服务器）：次数取最大，时间取最新，计次日志合并 */
export function mergeTrial(...xs) {
  const t = emptyTrial();
  for (const x of xs) {
    if (!x) continue; t.used = Math.max(t.used, +x.used || 0); t.last = Math.max(t.last, +x.last || 0);
    t.ss = Math.max(t.ss, +x.ss || 0); t.cs = Math.max(t.cs, +x.cs || 0); // 服务器 / 备份里没有 ss、cs 的记录不影响本机这段学习
    if (x.first && (!t.first || x.first < t.first)) t.first = +x.first; if (Array.isArray(x.log)) t.log = [...t.log, ...x.log];
  }
  const byT = new Map(); for (const l of t.log.map(l => typeof l === 'number' ? { t: l } : l).filter(l => l && l.t > 0)) { const o = byT.get(l.t); byT.set(l.t, o ? { ...o, ...l, e: Math.max(+o.e || 0, +l.e || 0) || undefined } : { ...l }); }
  t.log = [...byT.values()].sort((a, b) => a.t - b.t).slice(-LOG_MAX); // 每条：t 计次时间；s 这段开始；e 这段最后一次操作
  t.used = Math.max(t.used, sessionsFromTimes(t.log.map(l => l.t), +B.SESSION_GAP_MIN || 30));
  return t;
}
/** 这件事能不能让这段学习计次：一组至少 minAnswers 题，或学完一段 */
export const qualifies = (ev, cfg = cfgOf()) => ev?.kind === 'unit' || (ev?.kind === 'practice' && (+ev.n || 0) >= cfg.minAnswers);
/** 一次学习操作（答题、点按、播放……）：距上一次操作超过 gapMin 分钟就开始新的一段，否则延续当前这段（滑动窗口） */
export function touch(trial, now, cfg = cfgOf()) {
  const t = mergeTrial(trial);
  if (!t.last || now - t.last >= cfg.gapMin * 60000 || now < t.last - 864e5) t.ss = now;
  t.last = Math.max(t.last, now);
  const L = t.log[t.log.length - 1]; if (t.cs === t.ss && L && L.t >= t.ss) L.e = Math.max(+L.e || 0, now); // 计过次的这段还在继续：记下它延续到哪
  return t;
}
/** 完成一组 / 学完一段：这段学习还没计过次就计 1 次（一段连续学习不管做了多少组、学了多久都只算一次）。返回 {trial, counted} */
export function countUse(trial, ev, now, cfg = cfgOf()) {
  const t = touch(trial, now, cfg);
  if (!qualifies(ev, cfg) || t.cs === t.ss) return { trial: t, counted: false };
  t.used += 1; t.cs = t.ss; if (!t.first) t.first = now; t.log = [...t.log, { t: now, s: t.ss, e: now, k: ev.kind, n: +ev.n || 0 }].slice(-LOG_MAX);
  return { trial: t, counted: true };
}
/** 起算日期以后用了几次：记录都在起算日期之后（或没有更早的记录可分）时就是总次数，否则数日志 */
export function usedSince(trial, since) {
  const t = mergeTrial(trial); if (!since || !t.first || t.first >= since) return t.used;
  return sessionsFromTimes(t.log.filter(l => l.t >= since).map(l => l.t), +B.SESSION_GAP_MIN || 30);
}
/** 从复习 / 测验作答记录估算“至少用过几次”（防清掉试用记录：作答记录会跟着备份和云同步回来）。
 *  和计次同一套规则：作答之间（以及已知的学习段 log 里 s–e 之间）停顿不到 gapMin 分钟算同一段；一段里至少 minAnswers 题、或含已计次的学习段，算一次 */
export function floorFromReviews(reviews, cfg = cfgOf(), log = []) {
  const since = cfg.since || 0, gap = cfg.gapMin * 60000;
  const iv = [...reviews.filter(r => r && r.ts && r.ts >= since && r.mode !== 'undo' && r.choice !== 'restore').map(r => ({ a: +r.ts, b: +r.ts, n: 1 })),
    ...(log || []).map(l => typeof l === 'number' ? { t: l } : l).filter(l => l && l.t >= since).map(l => ({ a: Math.min(+l.s || l.t, l.t), b: Math.max(+l.e || l.t, l.t), n: 0, span: true }))].sort((x, y) => x.a - y.a);
  let n = 0, cur = null;
  const close = () => { if (cur && (cur.span || cur.n >= cfg.minAnswers)) n++; };
  for (const x of iv) { if (!cur || x.a - cur.b >= gap) { close(); cur = { ...x }; } else { cur.b = Math.max(cur.b, x.b); cur.n += x.n; cur.span = cur.span || x.span; } }
  close(); return n;
}
/** 时间：取“现在”和“见过的最大时间”中较大的（防把手机日期往回调）；回拨超过 10 分钟标记 back */
export const clockNow = (real, maxSeen = 0) => ({ now: Math.max(real, maxSeen || 0), back: !!maxSeen && real < maxSeen - 10 * 60000 });
/** 激活码状态：none / active / expiring（到期前 renewDays 天内）/ expired / revoked */
export function licenseStatus(lic, now, cfg = cfgOf(), revoked = B.REVOKED_SERIALS) {
  if (!lic || !lic.ok) return { state: 'none' };
  if (revoked.includes(lic.serial)) return { state: 'revoked', lic };
  if (lic.forever) return { state: 'active', lic, daysLeft: Infinity };
  const daysLeft = lic.expDay - localDay(now); // 到期日当天仍可用
  if (daysLeft < 0) return { state: 'expired', lic, daysLeft };
  return { state: daysLeft < cfg.renewDays ? 'expiring' : 'active', lic, daysLeft };
}
/** 付费入口怎么显示（商店版不显示私域价格 / 付款 / 联系方式） */
export function offerView(channel, b = B) {
  const store = channel === 'store';
  return { store, showPrices: !store, showPay: !store && !!(b.PAY.url || b.PAY.contact), showCode: !store || !!b.STORE.showCodeEntry, enforce: store ? !!b.STORE.enforceTrial : !!b.TRIAL_ENFORCED };
}
/** 现在能不能继续学：licensed 有效就能；否则看试用次数（最后一次已计次的那段学习没中断，就能接着学，不限时长） */
export function gate({ trial, floor = 0, licensed, now, enforce = true, cfg = cfgOf() }) {
  const t = mergeTrial(trial), used = Math.max(usedSince(t, cfg.since), floor), remaining = Math.max(0, cfg.uses - used), inSession = !!t.cs && t.cs === t.ss && now - t.last >= 0 && now - t.last < cfg.gapMin * 60000; // 已计过次的这段学习还在继续（停下没超过 gapMin 分钟）
  const locked = !!enforce && !licensed && remaining <= 0 && !inSession;
  return { locked, remaining, used, total: t.used, uses: cfg.uses, enforce: !!enforce, inSession, licensed: !!licensed, low: !licensed && enforce && remaining > 0 && remaining <= cfg.warn };
}
