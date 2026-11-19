// 读取录音/视频里的声音（带进度、剩余时间；iPhone 拦截自动播放时给一个「点这里继续」按钮）。导入页、转写页共用。
import * as T from '../transcribe.js';
import { $, esc } from '../ui.js';

/** 在 box 里显示读取进度，返回 {pcm, info}；失败时在 box 里显示具体原因并返回 null */
export async function readWithUi(box, blob, { name = '', isVideo = false } = {}) {
  const t0 = Date.now(); let last = { text: `正在读取${isVideo ? '视频里的' : ''}声音…` };
  box.innerHTML = `<div class="card" id="rdcard"><b id="rdtitle">${esc(last.text)}</b> <span class="muted small">${esc(name)} · ${T.fmtMB(blob.size)}</span>
    <div class="bar sm"><i id="rdbar" style="width:0%"></i></div><div class="muted small" id="rdt" role="status">只在本机读取，不上传。</div></div>`;
  const paint = () => {
    const sec = Math.round((Date.now() - t0) / 1000); const tt = $('#rdtitle', box), bar = $('#rdbar', box), t = $('#rdt', box); if (!t) return;
    tt.textContent = last.text;
    if (last.ratio != null) bar.style.width = Math.round(Math.min(1, last.ratio) * 100) + '%';
    const eta = last.eta != null ? last.eta : last.ratio > 0.05 && sec > 2 ? sec * (1 - last.ratio) / last.ratio : null;
    t.textContent = `只在本机读取，不上传。已用 ${T.fmtClock(sec)}${last.ratio != null ? ` · ${Math.round(last.ratio * 100)}%` : ''}${eta != null ? ` · 还需${T.fmtDur(eta)}` : ''}${last.stage === 'play' ? '（这个格式要把声音完整播放一遍才能取出，页面请保持打开）' : ''}`;
  };
  const tick = setInterval(paint, 1000);
  const onProgress = p => { last = { ...last, ...p }; paint(); };
  try {
    try { return await T.readAudio(blob, { onProgress, name }); }
    catch (e) {
      if (e.code !== 'NEED_TAP') throw e;
      // iPhone 不许网页没点按就播放声音：等用户点一下再继续
      const card = $('#rdcard', box);
      const holder = document.createElement('div'); holder.innerHTML = `<p class="muted small">这个文件要用播放器读取声音（静音、不会外放），浏览器需要你点一下才允许。</p><button class="btn primary" id="rdTap">▶ 点这里继续读取声音</button>`;
      card.append(holder);
      const r = await new Promise((res, rej) => { $('#rdTap', box).onclick = () => { holder.remove(); e.resume().then(res, rej); }; });
      return r;
    }
  } catch (e) {
    box.innerHTML = `<div class="note err" id="readErr" data-code="${esc(e.code || '')}">${esc(e.message || String(e))}</div>`;
    return null;
  } finally { clearInterval(tick); }
}
