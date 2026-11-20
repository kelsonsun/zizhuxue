// v1.9.1 “分享给朋友”卡片图：纯本地 Canvas 绘制（750×1200 PNG），带离线生成的标准二维码（vendor/qrcode，不调用任何外部接口）。
// 二维码内容固定为正式线上网址（不用 location，免得本地调试 / App 里编出 localhost 或 capacitor:// 地址）。
// 微信里发网址不会变成卡片，所以给一张图：长按识别 / 扫码就能打开。
import qrcode from '../vendor/qrcode/qrcode.js';
import { TRIAL_TAGLINE } from './billing.js';
import { CHANNEL } from './channel.js';

export const SHARE_URL = 'https://kelsonsun.github.io/zizhuxue/';
export const CARD_W = 750, CARD_H = 1200;
const MAIN = '#1f6f5c', DARK = '#154c40', CREAM = '#fff7d6';
const F = '"PingFang SC","Hiragino Sans GB","Noto Sans SC","Noto Sans CJK SC","Source Han Sans SC","Microsoft YaHei",sans-serif';

/** 二维码矩阵（true = 黑块）。纠错级别 M（约 15% 损坏仍能扫），版本按内容自动选 */
export function qrMatrix(text = SHARE_URL, level = 'M') {
  const qr = qrcode(0, level); qr.addData(text, 'Byte'); qr.make();
  const n = qr.getModuleCount(); return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}
/** 卡片上的亮点（商店版不写私域的试用说明） */
export const highlights = (channel = CHANNEL) => [
  ['导入自己的文章', '网页、字幕、电子书、录音都能变成教材'],
  ['拍图即查', '拍一张图，点哪个词查哪个词'],
  ['生词卡 + 记忆曲线复习', '自动做卡，按遗忘规律提醒你复习'],
  ...(channel === 'store' ? [] : [[TRIAL_TAGLINE, '先用起来，喜欢再说', true]]),
];
/** 在一个 2D 画布上画卡片（浏览器 canvas；icon 是已加载的图标图片，可以没有） */
export function drawCard(c, icon, { url = SHARE_URL, channel = CHANNEL } = {}) {
  const W = CARD_W, H = CARD_H;
  c.fillStyle = '#f4f1ea'; c.fillRect(0, 0, W, H);
  // 顶部主色区
  const g = c.createLinearGradient(0, 0, W, 470); g.addColorStop(0, MAIN); g.addColorStop(1, DARK); c.fillStyle = g;
  c.beginPath(); c.moveTo(0, 0); c.lineTo(W, 0); c.lineTo(W, 430); c.quadraticCurveTo(W / 2, 500, 0, 430); c.closePath(); c.fill();
  c.globalAlpha = 0.08; c.fillStyle = '#fff'; for (const [x, y, r] of [[680, 60, 150], [40, 380, 90], [620, 380, 60]]) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); } c.globalAlpha = 1;
  // 大图标
  const IX = (W - 170) / 2, IY = 56;
  c.save(); c.shadowColor = 'rgba(0,0,0,.28)'; c.shadowBlur = 24; c.shadowOffsetY = 8; c.fillStyle = MAIN; c.beginPath(); c.roundRect(IX, IY, 170, 170, 38); c.fill(); c.restore();
  if (icon) { c.save(); c.beginPath(); c.roundRect(IX, IY, 170, 170, 38); c.clip(); c.drawImage(icon, IX, IY, 170, 170); c.restore(); }
  c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillStyle = '#fff';
  c.font = `bold 84px ${F}`; c.fillText('自主学', W / 2, 318);
  c.font = `bold 36px ${F}`; c.globalAlpha = 0.95; c.fillText('用你自己的真实内容学英语', W / 2, 378); c.globalAlpha = 1;
  // 亮点
  let y = 474; c.textAlign = 'left';
  for (const [t, sub, hot] of highlights(channel)) {
    if (hot) { c.fillStyle = CREAM; c.beginPath(); c.roundRect(60, y - 14, W - 120, 74, 18); c.fill(); }
    c.fillStyle = MAIN; c.beginPath(); c.arc(98, y + 22, 15, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#fff'; c.lineWidth = 4; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); c.moveTo(90, y + 22); c.lineTo(96, y + 29); c.lineTo(107, y + 15); c.stroke();
    c.fillStyle = hot ? MAIN : '#1d2b27'; c.font = `bold 32px ${F}`; c.fillText(t, 128, y + 22);
    c.fillStyle = '#6b746f'; c.font = `22px ${F}`; c.fillText(sub, 128, y + 52); y += 80;
  }
  // 二维码（白底 + 4 格静区，整数像素，保证能扫）
  const m = qrMatrix(url), n = m.length, cell = Math.floor(280 / (n + 8)), size = cell * (n + 8), QX = Math.round((W - size) / 2), QY = H - size - 122;
  c.save(); c.shadowColor = 'rgba(0,0,0,.12)'; c.shadowBlur = 18; c.fillStyle = '#fff'; c.beginPath(); c.roundRect(QX - 18, QY - 18, size + 36, size + 36, 22); c.fill(); c.restore();
  c.fillStyle = '#fff'; c.fillRect(QX, QY, size, size); c.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (m[r][k]) c.fillRect(QX + (k + 4) * cell, QY + (r + 4) * cell, cell, cell);
  c.textAlign = 'center'; c.fillStyle = '#1d2b27'; c.font = `bold 30px ${F}`; c.fillText('微信/手机长按或扫码立即打开', W / 2, H - 56);
  c.fillStyle = '#8a928e'; c.font = `22px ${F}`; c.fillText(url.replace(/^https:\/\//, '').replace(/\/$/, ''), W / 2, H - 22);
  return { qrModules: n, qrCell: cell, qrBox: [QX, QY, size] };
}
const loadImg = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });
/** 生成 PNG（Blob） */
export async function cardBlob(opts = {}) {
  const cv = document.createElement('canvas'); cv.width = CARD_W; cv.height = CARD_H;
  try { await document.fonts?.ready; } catch { }
  const icon = await loadImg(new URL('icons/icon-512.png', document.baseURI).href);
  const info = drawCard(cv.getContext('2d'), icon, opts);
  const blob = await new Promise(r => cv.toBlob(r, 'image/png')); blob.info = info; return blob;
}
export async function copyLink(url = SHARE_URL) {
  try { await navigator.clipboard.writeText(url); return true; } catch { }
  const ta = document.createElement('textarea'); ta.value = url; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0'; document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { } ta.remove(); return ok;
}
/** 弹窗：预览（<img>，手机上可直接长按保存 / 转发）+ 保存图片 / 直接分享 / 复制链接 */
export async function openShareCard() {
  const { sheet, toast, download, esc } = await import('./ui.js');
  const s = sheet(`<h3>分享给朋友</h3><div id="scBox" class="center muted">生成中…</div>`, { cls: 'sharecardsheet' });
  const blob = await cardBlob(); const url = URL.createObjectURL(blob), name = '自主学_分享卡片.png';
  const file = typeof File === 'function' ? new File([blob], name, { type: 'image/png' }) : null;
  const iOS = /iPhone|iPad/.test(navigator.userAgent);
  s.el.querySelector('#scBox').outerHTML = `<img id="scImg" class="shareimg sharecardimg" src="${url}" alt="自主学分享卡片图：扫码打开 ${esc(SHARE_URL)}" width="${CARD_W}" height="${CARD_H}" data-bytes="${blob.size}">
    <p class="muted small">在手机上可以直接${iOS ? '长按图片 →「存储到照片」或转发给微信好友' : '长按图片保存或转发给微信好友'}；朋友长按识别或扫码就能打开。</p>
    <div class="row gap wrap scbtns"><button class="btn primary" id="scSave">💾 保存图片</button><button class="btn" id="scShare">📤 直接分享</button><button class="btn" id="scCopy">🔗 复制链接</button></div>
    <p class="muted small" id="scMsg" role="status"></p>`;
  const msg = t => { const m = s.el.querySelector('#scMsg'); if (m) m.textContent = t; };
  s.el.querySelector('#scSave').onclick = async () => { try { await download(name, blob, 'image/png'); msg('已保存图片：' + name); } catch (e) { msg('保存没成功：' + e.message + '。可以长按上面的图片保存。'); } };
  s.el.querySelector('#scShare').onclick = async () => {
    if (file && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: '自主学', text: '自主学 · 用你自己的真实内容学英语 ' + SHARE_URL }); msg('已打开系统分享'); } catch (e) { if (e?.name !== 'AbortError') msg('分享没成功：' + e.message + '。可以长按图片转发，或点「保存图片」。'); }
    } else { msg('这里不能直接分享图片：请长按上面的图片转发，或点「保存图片」后再发。'); toast('请长按图片转发，或先保存图片'); }
  };
  s.el.querySelector('#scCopy').onclick = async () => { const ok = await copyLink(); msg(ok ? '已复制链接：' + SHARE_URL : '复制没成功，请手动复制：' + SHARE_URL); };
  s.blob = blob; return s;
}
