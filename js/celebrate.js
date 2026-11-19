// v1.7 庆祝画面（参照多邻国）：做完一组练习 / 复习 / 测验 / 一个学习单元时弹出——动画、彩带粒子、WebAudio 合成音效、鼓励语、这一组的成绩、获得的星星钻石；
// 到了连续打卡里程碑再弹一张不同颜色、徽章、音效、双语名言的里程碑画面，可生成分享图（canvas）。
import * as P from './progress.js';
import * as R from './rewards.js';
import { settings } from './state.js';
import { esc, toast, sheet } from './ui.js';

const noCeleb = () => { try { return localStorage.getItem('zzx.noCeleb') === '1'; } catch { return false; } }; // 旧的自动化测试用：只领奖不弹画面
let actx = null;
/** WebAudio 合成音效：notes 频率依次响起（带包络），不用任何音频文件。设置里可关。 */
export function sfx(name, notes = [523, 659, 784, 1047], wave = 'triangle', step = 0.11) {
  document.documentElement.dataset.sfx = settings.sfx === false ? 'off' : name; // 测试可见：播了哪个音效 / 关了
  if (settings.sfx === false) return false;
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
    actx = actx || new AC(); if (actx.state === 'suspended') actx.resume().catch(() => { });
    const t0 = actx.currentTime + 0.02; const master = actx.createGain(); master.gain.value = 0.18; master.connect(actx.destination);
    notes.forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain(); o.type = wave; o.frequency.value = f;
      const t = t0 + i * step; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + step * 2.6);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + step * 2.8);
    });
    window.__sfxCount = (window.__sfxCount || 0) + 1; return true;
  } catch { return false; }
}
/** 彩带粒子（canvas + requestAnimationFrame，约 2.6 秒；系统设置“减少动态效果”时少放一些） */
function confetti(cv, colors) {
  const ctx = cv.getContext('2d'); const W = cv.width = innerWidth * devicePixelRatio, H = cv.height = innerHeight * devicePixelRatio;
  const few = matchMedia('(prefers-reduced-motion: reduce)').matches; const N = few ? 40 : 160;
  const ps = Array.from({ length: N }, () => ({ x: W / 2 + (Math.random() - 0.5) * W * 0.3, y: H * 0.35, vx: (Math.random() - 0.5) * 22 * devicePixelRatio, vy: (-Math.random() * 20 - 6) * devicePixelRatio, r: (4 + Math.random() * 6) * devicePixelRatio, c: colors[Math.floor(Math.random() * colors.length)], a: Math.random() * 6, va: (Math.random() - 0.5) * 0.4, sh: Math.random() < 0.5 }));
  const t0 = performance.now(); cv.dataset.n = N;
  const frame = t => {
    if (!cv.isConnected) return; const k = (t - t0) / 2600; ctx.clearRect(0, 0, W, H);
    for (const p of ps) { p.vy += 0.6 * devicePixelRatio; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.a += p.va; ctx.save(); ctx.globalAlpha = Math.max(0, 1 - k); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; if (p.sh) ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); else { ctx.beginPath(); ctx.arc(0, 0, p.r / 1.4, 0, 7); ctx.fill(); } ctx.restore(); }
    if (k < 1) requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
  };
  requestAnimationFrame(frame);
}
function overlay(html, { colors, cls = '' }) {
  document.querySelector('#celeb')?.remove();
  const el = document.createElement('div'); el.id = 'celeb'; el.className = 'celeb ' + cls; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
  el.innerHTML = `<canvas class="confetti" aria-hidden="true"></canvas><div class="cbox">${html}</div>`; document.body.appendChild(el);
  confetti(el.querySelector('canvas'), colors);
  return new Promise(res => { const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 180); res(); }; el.querySelector('#celebOk').onclick = close; el.querySelector('#celebOk').focus(); });
}
const gotHtml = g => g && (g.s || g.d) ? `<div class="cgot" id="celebGot">${g.s ? `<span>+${g.s} ⭐</span>` : ''}${g.d ? `<span>+${g.d} 💎</span>` : ''}</div>` : '';

/**
 * 一组练习 / 一个单元做完：领奖 → 弹庆祝画面（成绩 + 鼓励语 + 奖励）→ 若今天到了里程碑，接着弹里程碑画面。
 * kind：'practice'（复习 / 测验 / 练习一组）或 'unit'（学完一段）；n / ok：题数 / 答对；avg：平均分；lines：成绩补充
 */
export async function sessionDone({ kind = 'practice', key, title, n = 0, ok = 0, avg = null, lines = [], label }) {
  const pct = avg ?? (n ? Math.round(100 * ok / n) : null);
  const r = await P.grant({ kind, key, n, ok, label: label || title });
  const after = await P.afterProgress();
  const result = { got: r.got, why: r.why, goalGot: after.goalGot, milestone: after.milestone, info: after.info };
  if (noCeleb()) return result;
  const c = R.cheer(pct, Date.now() >> 10); const tot = { s: r.got.s + (after.goalGot?.s || 0), d: r.got.d + (after.goalGot?.d || 0) };
  sfx(c.tone === 'great' ? 'great' : 'done', c.tone === 'great' ? [523, 659, 784, 1047, 1319] : [523, 659, 784]);
  await overlay(`<div class="cbig">${c.tone === 'great' ? '🏆' : c.tone === 'good' ? '🎉' : '💪'}</div><h2 id="celebTitle">${esc(title)}</h2>
    <p class="cmsg"><b>${esc(c.zh)}</b><br><span>${esc(c.en)}</span></p>
    ${n || pct != null ? `<div class="cscore" id="celebScore">${pct != null ? `<b>${pct}</b><small>${avg != null ? ' 分' : '%'}</small>` : ''}${n ? `<span>答对 ${ok} / ${n}</span>` : ''}</div>` : ''}
    ${lines.length ? `<div class="clines">${lines.map(l => `<span>${esc(l)}</span>`).join('')}</div>` : ''}
    ${gotHtml(tot)}${r.why && !tot.s ? `<p class="muted small" id="celebWhy">这组没有奖励：${esc(r.why)}</p>` : ''}${after.goalGot ? '<p class="cgoal">✅ 今日目标达成！</p>' : ''}
    <p class="cstreak">🔥 连续 ${after.info.streak} 天 · 今日 ${after.info.today} / ${after.info.goal}</p>
    <button class="btn primary big" id="celebOk">继续</button>`, { colors: ['#1f6f5c', '#f7b733', '#fc4a1a', '#4abdac', '#a78bfa', '#ff7eb3'] });
  if (after.milestone) await showMilestone(after.milestone);
  return result;
}
/** 只检查达标 / 里程碑（每日一句、首页打开时用） */
export async function checkProgress() {
  const after = await P.afterProgress();
  if (after.milestone && !noCeleb()) await showMilestone(after.milestone);
  return after;
}
export async function showMilestone(t) {
  sfx('milestone-' + t.n, t.notes, t.wave, 0.14);
  const p = overlay(`<div class="msbadge" style="background:linear-gradient(135deg,${t.colors[0]},${t.colors[1]})">${t.badge}</div>
    <div class="msn"><b id="msN">${t.n}</b> 天连续打卡！</div><div class="msname">${esc(t.name)}</div>
    <blockquote class="msq"><p id="msZh">${esc(t.zh)}</p><p class="en" id="msEn">${esc(t.en)}</p></blockquote>
    ${gotHtml(t.got)}
    <div class="row gap"><button class="btn" id="msShare">🖼 生成分享图</button><button class="btn primary" id="celebOk">继续</button></div>`, { colors: [...t.colors, '#ffffff', '#ffd700'], cls: 'ms' });
  const el = document.querySelector('#celeb'); el.style.setProperty('--ms1', t.colors[0]); el.style.setProperty('--ms2', t.colors[1]); el.dataset.ms = t.n;
  el.querySelector('#msShare').onclick = () => openShare(t);
  return p;
}

// ———————————————— 分享图 ————————————————
function wrap(ctx, text, maxW) { const out = []; let line = ''; for (const ch of text.split(/(?<=\s)|(?=[\u3400-\u9fff])/)) { if (ctx.measureText(line + ch).width > maxW && line) { out.push(line.trim()); line = ch; } else line += ch; } if (line.trim()) out.push(line.trim()); return out; }
/** 1080×1440 PNG：连续天数、名言（中英）、徽章、自主学品牌 */
export async function shareImage(t) {
  const cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1440; const c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, 1080, 1440); g.addColorStop(0, t.colors[0]); g.addColorStop(1, t.colors[1]); c.fillStyle = g; c.fillRect(0, 0, 1080, 1440);
  c.globalAlpha = 0.12; c.fillStyle = '#fff'; for (let i = 0; i < 26; i++) { c.beginPath(); c.arc((i * 397) % 1080, (i * 613) % 1440, 20 + (i * 37) % 90, 0, 7); c.fill(); } c.globalAlpha = 1;
  const F = '"PingFang SC","Noto Sans SC","Noto Sans CJK SC","Microsoft YaHei",sans-serif';
  c.fillStyle = '#fff'; c.textAlign = 'center';
  c.font = `160px ${F}`; c.fillText(t.badge, 540, 300);
  c.font = `bold 300px ${F}`; c.fillText(String(t.n), 540, 640);
  c.font = `bold 72px ${F}`; c.fillText('天连续打卡', 540, 760);
  c.font = `44px ${F}`; c.globalAlpha = 0.9; c.fillText(`🏅 ${t.name}`, 540, 850); c.globalAlpha = 1;
  c.fillStyle = 'rgba(255,255,255,.18)'; c.beginPath(); c.roundRect(90, 920, 900, 330, 40); c.fill(); c.fillStyle = '#fff';
  c.font = `bold 52px ${F}`; let y = 1010; for (const l of wrap(c, t.zh, 800).slice(0, 2)) { c.fillText(l, 540, y); y += 66; }
  c.font = `italic 36px ${F}`; y += 6; for (const l of wrap(c, t.en, 820).slice(0, 3)) { c.fillText(l, 540, y); y += 46; }
  c.font = `bold 56px ${F}`; c.fillText('自主学', 540, 1340); c.font = `32px ${F}`; c.globalAlpha = 0.9; c.fillText('用你自己的真实内容学英语', 540, 1392);
  return new Promise(r => cv.toBlob(b => r(b), 'image/png'));
}
export async function openShare(t) {
  const blob = await shareImage(t); const url = URL.createObjectURL(blob); const file = new File([blob], `自主学_连续${t.n}天.png`, { type: 'image/png' });
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
  const cel = document.querySelector('#celeb'); cel?.classList.add('under'); // 分享面板打开时先把庆祝弹层藏起来，关了再回来
  const sh = sheet(`<h3>分享图</h3><img id="shareImg" class="shareimg" src="${url}" alt="连续 ${t.n} 天打卡分享图" data-bytes="${blob.size}">
    <p class="muted small">${canShare ? '点「分享」可以直接发到微信、朋友圈等；' : ''}也可以保存图片后发朋友圈。${/iPhone|iPad/.test(navigator.userAgent) ? 'iPhone 上也可以长按图片 →「存储到照片」。' : ''}</p>
    <div class="row gap">${canShare ? '<button class="btn primary" id="shareGo">📤 分享</button>' : ''}<a class="btn ${canShare ? '' : 'primary'}" id="shareSave" href="${url}" download="${esc(file.name)}">💾 保存图片</a></div>`, { onClose: () => cel?.classList.remove('under') });
  sh.el.querySelector('#shareGo')?.addEventListener('click', async () => { try { await navigator.share({ files: [file], title: '自主学', text: `我在「自主学」连续打卡 ${t.n} 天！` }); } catch (e) { if (e.name !== 'AbortError') toast('分享没成功：' + e.message); } });
  return sh;
}
