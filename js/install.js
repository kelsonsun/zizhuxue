// 安装到主屏/桌面：识别当前环境，给出“这台设备上真正能用”的做法。
// 重点：微信/QQ/微博/抖音等 App 里的内置浏览器不能装到主屏，而且内置浏览器的存储可能被清掉——必须先提示用浏览器打开。
import { session, isNativeApp } from './state.js';

const UA = () => navigator.userAgent || '';
const IN_APP = [[/MicroMessenger/i, '微信'], [/\bQQ\//i, 'QQ'], [/Weibo/i, '微博'], [/aweme|BytedanceWebview|ByteLocale/i, '抖音'], [/AlipayClient/i, '支付宝'], [/DingTalk/i, '钉钉'], [/Lark|Feishu/i, '飞书'], [/XiaoHongShu|xhsdiscover/i, '小红书'],
  [/FBAN|FBAV/i, 'Facebook'], [/Instagram/i, 'Instagram'], [/\bLine\//i, 'LINE'], [/WhatsApp/i, 'WhatsApp'], [/Snapchat/i, 'Snapchat'], [/TikTok|musical_ly/i, 'TikTok']];
/** 在哪个 App 的内置浏览器里（不在则返回空字符串） */
export const inAppName = () => (IN_APP.find(([re]) => re.test(UA())) || [])[1] || '';
export const isIos = () => /iphone|ipad|ipod/i.test(UA()) || (/Macintosh/.test(UA()) && navigator.maxTouchPoints > 1);
export const isAndroid = () => /Android/i.test(UA());
/** iPhone 上的非 Safari 浏览器（Chrome/Edge/Firefox 等，内核仍是 Safari） */
export const iosBrowser = () => isIos() ? ((/CriOS/.test(UA()) && 'Chrome') || (/EdgiOS/.test(UA()) && 'Edge') || (/FxiOS/.test(UA()) && 'Firefox') || (/OPiOS|OPT\//.test(UA()) && 'Opera') || '') : '';
export const isStandalone = () => !!(globalThis.matchMedia?.('(display-mode: standalone)').matches || globalThis.matchMedia?.('(display-mode: window-controls-overlay)').matches || navigator.standalone === true || isNativeApp());
export const canPrompt = () => !!session.install && !isStandalone();

/** 当前设备上的安装做法（纯文字，一句到两句） */
export function howText() {
  if (isStandalone()) return isNativeApp() ? '这是安装版客户端，不用再装。' : '你已经是从主屏幕/桌面打开的，不用再装了。';
  const app = inAppName();
  if (app) return `你现在是在「${app}」里打开的：这里不能装到主屏，而且它的缓存被清理时，你学的内容可能会丢。请点右上角「···」→ 选「${isIos() ? '在 Safari 中打开' : '在浏览器打开'}」，再按提示装到主屏。`;
  if (isIos()) {
    const b = iosBrowser();
    return b ? `在 ${b} 里点「分享」按钮（${b === 'Chrome' ? '地址栏右边' : '菜单里'}的方框加向上箭头）→「添加到主屏幕」。找不到这一项（iOS 16.4 以前的系统）时，请复制链接用 Safari 打开再添加。`
      : '在 Safari 点底部的「分享」按钮（方框加向上箭头）→ 往下找「添加到主屏幕」→「添加」。之后像 App 一样直接打开，无需登录，离线也能用。';
  }
  if (canPrompt()) return '点下面的「一键安装」，会像 App 一样出现在' + (isAndroid() ? '主屏幕' : '桌面') + '，无需登录，离线也能用。';
  if (isAndroid()) return '点浏览器右上角「⋮」菜单 →「添加到主屏幕」或「安装应用」。之后像 App 一样直接打开，无需登录，离线也能用。';
  return '在浏览器地址栏右侧点「安装」图标，或在菜单里选「安装自主学」/「应用 → 安装此站点」。安装后像软件一样从桌面打开，离线也能用。';
}
export async function prompt() {
  const ev = session.install; if (!ev) return false;
  ev.prompt(); const r = await ev.userChoice.catch(() => ({ outcome: 'dismissed' })); session.install = null;
  return r?.outcome === 'accepted';
}
/** 复制当前地址（内置浏览器里提示“去浏览器打开”时用） */
export async function copyLink() {
  const url = new URL('./', document.baseURI).href;
  try { await navigator.clipboard.writeText(url); return true; } catch { }
  try { const t = document.createElement('textarea'); t.value = url; document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); return ok; } catch { return false; }
}
export const isNative = () => isNativeApp();
