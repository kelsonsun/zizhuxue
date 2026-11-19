// v1.8 学习提醒（纯函数，可单测）：未来几天的提醒计划、各平台实际能做到什么。
import { reminder } from './rewards.js';

export const TITLE = '自主学 · 学习提醒';
export const LATE_AT = '23:00';
export const parseAt = at => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(at || '')); return m ? { h: +m[1], m: +m[2] } : null; };
const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const todayKey = (now = Date.now()) => dayKey(new Date(now));
/**
 * 未来 days 天（含今天）的提醒：[{id, at(毫秒), date, kind:'main'|'late', title, body, tone}]，按时间排。
 * met：今天已打卡 → 今天不提醒；streak：连续天数（只用在今天、以及今天已打卡时的明天，别的日子不预测）。
 * late：另外在 23:00 再提醒一次（“你把我忘了吗？”）—— 提醒时间本身 ≥23:00 时不重复。
 * 文案在安排时按“那个时刻的小时”从 v1.7 文案库里挑，所以早上积极、傍晚撒娇、晚上沮丧、23 点“你把我忘了吗”。
 * id：安卓本地通知要整数 id —— 7000+天序号（主提醒）、7100+天序号（23 点）。
 */
export function plan(now, { at = '20:00', late = false, met = false, streak = 0, days = 7 } = {}) {
  const t = parseAt(at); if (!t) return [];
  const out = []; const base = new Date(now);
  for (let d = 0; d < days; d++) {
    const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + d);
    if (d === 0 && met) continue;
    const sk = d === 0 || (d === 1 && met) ? streak : 0;
    const seed = Math.floor(day.getTime() / 86400000);
    const add = (h, m, kind) => {
      const ts = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0).getTime(); if (ts <= now) return;
      const r = reminder(h, { met: false, streak: sk }, seed + (kind === 'late' ? 1 : 0));
      out.push({ id: (kind === 'late' ? 7100 : 7000) + d, at: ts, date: dayKey(day), kind, title: TITLE, body: r.text, tone: r.tone });
    };
    add(t.h, t.m, 'main');
    if (late && t.h * 60 + t.m < 23 * 60) add(23, 0, 'late');
  }
  return out.sort((a, b) => a.at - b.at);
}
/** 到期但还没弹过的（Service Worker 后台唤醒时用）：at ≤ now，且不早于 now − grace */
export const dueItems = (items, now, shown = {}, grace = 2 * 3600e3) => (items || []).filter(x => x.at <= now && x.at > now - grace && !shown[x.date + ':' + x.kind]);

/** 当前运行环境 → 平台：android-app / ios-app / electron / ios-pwa / ios-safari / web */
export function platformOf(env = globalThis) {
  const cap = env.Capacitor; const ua = env.navigator?.userAgent || '';
  if (cap?.isNativePlatform?.()) return cap.getPlatform?.() === 'ios' ? 'ios-app' : 'android-app';
  if (env.zzxNative?.reminders || /\bElectron\//.test(ua)) return 'electron';
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (env.navigator?.maxTouchPoints || 0) > 1);
  if (ios) return env.navigator?.standalone || env.matchMedia?.('(display-mode: standalone)').matches ? 'ios-pwa' : 'ios-safari';
  return 'web';
}
/**
 * 这台设备上提醒怎么实现、能做到什么、做不到什么（照实说）。
 * caps：{server: 有推送服务器地址, push: 有 PushManager, notif: 有 Notification, periodic: 有定期后台同步, plugin: 原生通知插件在}
 * 返回 {route: 'native'|'electron'|'push'|'page'|'none', ok, lines:[说明]}
 */
export function capability(plat, caps = {}) {
  const L = (route, ok, ...lines) => ({ route, ok, lines });
  if (plat === 'android-app' || plat === 'ios-app') return caps.plugin
    ? L('native', true, '用手机系统的本地通知：到点由系统弹出，App 关着也会提醒，不需要服务器、不联网。', '安卓 13 以上第一次打开时要允许“通知”权限；省电模式下可能晚几分钟。', '每次打开 App 会重新排好未来 7 天；今天打卡后，今天剩下的提醒自动取消。连续 7 天没打开 App，之后就不再提醒了。')
    : L('none', false, '这个安装包里没有本地通知组件（需要用 1.8.0 及以后的安装包）。');
  if (plat === 'electron') return !caps.plugin ? L('none', false, '这个电脑客户端版本还不支持提醒（需要 1.8.0 及以后的安装包）。') : L('electron', true, '用电脑系统通知（Windows 操作中心 / macOS 通知中心）。', '电脑客户端开着（可以最小化）时到点弹通知；完全退出后不会提醒。', '今天打卡后，今天剩下的提醒自动取消。');
  if (plat === 'ios-safari') return L('none', false, 'iPhone 的 Safari 网页不能收通知（苹果的限制）。', '要收提醒：先用 Safari「分享 → 添加到主屏幕」（iOS 16.4 以上），从主屏幕图标打开，再回到这里打开提醒；而且需要推送服务器（见下）。', '现在能做到：打开 App 时首页会按时间显示提醒语。');
  if (caps.server && caps.push && caps.notif) return L('push', true,
    plat === 'ios-pwa' ? '主屏应用（iOS 16.4+）通过苹果推送服务收提醒：手机锁屏、App 没打开也会到。' : '通过浏览器推送服务收提醒：浏览器没开着也能到（电脑上浏览器要在后台运行）。',
    '到点由同步服务器按你设的时间发出；内容端到端加密，推送服务看不到。', '今天打卡后会告诉服务器，今天就不再提醒。');
  if (plat === 'ios-pwa') return L('none', false, '主屏应用要收提醒，必须有推送服务器（苹果只允许通过推送服务发通知）。现在的网址没有配推送服务器，所以收不到。', '服务器端已经做好（sync-server，VAPID 推送），部署后就能用；部署前：打开 App 时首页会按时间显示提醒语。');
  if (caps.notif) return L('page', true, '没有推送服务器：自主学开着（可以在后台标签页）时，到点弹出浏览器通知。', caps.periodic ? '已安装到主屏 / 桌面的安卓 Chrome 还会在后台定期醒来补发（大约每隔一段时间，由浏览器决定，不保证准点）。' : '关掉网页后不会提醒（要关着也能提醒，需要推送服务器或用安卓 / 电脑客户端）。', '首页也会按时间显示提醒语。');
  return L('none', false, '这个浏览器不支持通知。打开 App 时首页会按时间显示提醒语。');
}
