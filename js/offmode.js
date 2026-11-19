// v1.7「离线使用」开关（默认打开）。
// 打开：Service Worker 预缓存整个软件（界面、代码、离线词典），断网也能用（原来的行为）。
// 关闭：Service Worker 改为“只走网络”模式（sw.js?online=1）：每次都向服务器确认最新版（no-cache 重新验证），
//       删掉软件代码缓存（zizhuxue-<版本>、PDF/Word/截图识别组件、转写运行库）；只留一个很小的“没有网络”提示页。
// 不管开还是关：IndexedDB 里的材料、卡片、复习记录、设置都不动；transformers.js 自己存的 Whisper 模型（transformers-cache）也不动。
// 开关存在 localStorage（启动时同步读取，决定注册哪种 SW），不进云同步：每台设备各自设。
export const KEY = 'zzx.offline';
export function offlineOn() { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } }
export const swUrl = (on = offlineOn()) => on ? 'sw.js' : 'sw.js?online=1';
export const state = { switching: false };

/** 等这个 worker 激活（或失败） */
function untilActive(w, ms) {
  return new Promise((res, rej) => {
    if (!w || w.state === 'activated') return res();
    const t = setTimeout(() => rej(new Error('超时')), ms);
    w.addEventListener('statechange', () => { if (w.state === 'activated') { clearTimeout(t); res(); } else if (w.state === 'redundant') { clearTimeout(t); rej(new Error('安装失败')); } });
  });
}
/** 切换。成功返回 true；失败会恢复原设置并抛错（比如没网时无法下载新的离线缓存） */
export async function setOffline(on) {
  if (!('serviceWorker' in navigator)) throw new Error('这个浏览器不支持 Service Worker');
  const prev = offlineOn(); state.switching = true;
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
    const reg = await navigator.serviceWorker.register(swUrl(on));
    await reg.update().catch(() => { });
    await untilActive(reg.installing || reg.waiting || reg.active, 120000);
    return true;
  } catch (e) {
    localStorage.setItem(KEY, prev ? '1' : '0');
    try { await navigator.serviceWorker.register(swUrl(prev)); } catch { }
    throw e;
  }
}
/** 当前缓存情况（给设置页显示） */
export async function cacheInfo() {
  if (!('caches' in window)) return { app: false, keys: [] };
  const keys = await caches.keys();
  return { keys, app: keys.some(k => /^zizhuxue-[0-9a-f]{10}$/.test(k)) };
}
