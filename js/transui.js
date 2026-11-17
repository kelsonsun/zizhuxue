// 翻译界面：选择通道（如实说明可用性/额度/隐私）→ 用户确认 → 后台分批翻译，全局进度条，可暂停/续传。
import * as T from './translate.js';
import * as ai from './ai.js';
import * as db from './db.js';
import { settings } from './state.js';
import { $, $$, esc, sheet, toast } from './ui.js';

const DIRT = { en2zh: '配上中文翻译', zh2en: '配上英文译文（英文将成为学习内容）' };

/** 打开翻译设置弹层。ids：要翻译的材料（一课或一本书的所有章）。 */
export async function openTranslate({ ids, title, onDone } = {}) {
  const st = await T.statsOf(ids);
  if (!st.left) return toast('这份材料已经有完整的对照翻译了');
  const dir = st.dir || 'en2zh';
  const cs = await T.chromeStatus(dir);
  const aiOk = ai.isConfigured(); const host = aiOk ? (() => { try { return new URL(ai.getConfig().baseUrl).host; } catch { return ai.getConfig().baseUrl; } })() : '';
  const quota = settings.mmEmail ? 50000 : 5000; const days = Math.ceil(st.chars / quota);
  const csText = { available: '可用：语言包已在本机，翻译在本机完成，不上传。', downloadable: '可用：第一次需要下载语言包（由浏览器下载），之后在本机翻译，不上传。', downloading: '语言包下载中，可用。', unavailable: '不可用：此浏览器不支持这个语言对或设备。', none: '不可用：只有电脑版 Chrome 138+ / Edge 148+ 才有；iPhone 上的 Safari、Chrome 等都没有这个功能。' }[cs];
  const csOk = ['available', 'downloadable', 'downloading'].includes(cs);
  // 上次用 AI 翻译失败（余额不足 429、密钥无效、连不上等）：默认改选免费通道，并在 AI 选项上说明原因（v1.3）
  let lastErr = ''; for (const id of ids) { const x = await db.materials.get(id); if (x?.trans?.provider === 'ai' && x.trans.error) { lastErr = x.trans.error; break; } }
  const def = aiOk && !lastErr ? 'ai' : csOk ? 'chrome' : 'mymemory';
  const s = sheet(`<h3>${esc(title || '')}：${DIRT[dir]}</h3>
    <p class="muted">还有 <b>${st.left}</b> 句要翻译，约 <b>${st.chars}</b> 个字符。翻译分批进行，翻完一批就保存一批；中途关掉也不会丢，之后可以接着翻。</p>
    <div class="list tlist">
      <label class="item tp ${aiOk ? '' : 'off'}"><input type="radio" name="tp" value="ai" ${aiOk ? '' : 'disabled'} ${def === 'ai' ? 'checked' : ''}><div><b>${T.NAMES.ai}</b>
        ${lastErr && aiOk ? `<span class="small warn">上次 AI 翻译没成功：${esc(lastErr)}。已默认改选下面的免费通道，也可以处理好后再选 AI。</span>` : ''}<span class="muted small">${aiOk ? `质量最好。内容会发送到你配置的接口（${esc(host)}），按你的服务计费。` : '未配置AI，无法生成。去「我的 → AI 设置」填好接口后可用。'}</span></div></label>
      <label class="item tp ${csOk ? '' : 'off'}"><input type="radio" name="tp" value="chrome" ${csOk ? '' : 'disabled'} ${def === 'chrome' ? 'checked' : ''}><div><b>${T.NAMES.chrome}</b><span class="muted small">${csText}</span></div></label>
      <label class="item tp"><input type="radio" name="tp" value="mymemory" ${def === 'mymemory' ? 'checked' : ''}><div><b>${T.NAMES.mymemory}</b>
        <span class="muted small">免费、不用注册，iPhone 也能用（需要联网）。额度：${settings.mmEmail ? '已填邮箱，约 50000' : '匿名约 5000'} 字符/天${days > 1 ? `，这份材料大约要分 <b>${days}</b> 天翻完（额度用完会自动暂停，第二天点“继续”即可）` : ''}。机器翻译，质量一般，可逐句改。</span></div></label>
    </div>
    <label class="check consent hidden" id="mmc"><input type="checkbox" id="mmok"><span>我知道：句子会逐句发送到第三方 <b>MyMemory（Translated 公司，api.mymemory.translated.net）</b>的服务器做翻译${settings.mmEmail ? '，同时附上我填的邮箱' : ''}。涉及隐私（姓名、电话、病历）的内容不要用这个通道。</span></label>
    <label class="check consent hidden" id="aic"><input type="checkbox" id="aiok"><span>我知道：内容会发送到我配置的 AI 接口（${esc(host)}）。</span></label>
    <div class="row gap"><button class="btn" data-close>取消</button><button class="btn primary grow" id="tgo">开始翻译</button></div>`);
  const el = s.el;
  const upd = () => { const v = $('input[name=tp]:checked', el)?.value; $('#mmc', el).classList.toggle('hidden', v !== 'mymemory'); $('#aic', el).classList.toggle('hidden', v !== 'ai');
    $('#tgo', el).disabled = !v || (v === 'mymemory' && !$('#mmok', el).checked) || (v === 'ai' && !$('#aiok', el).checked); };
  $$('input', el).forEach(i => i.onchange = upd); upd();
  $('#tgo', el).onclick = async () => {
    const provider = $('input[name=tp]:checked', el).value;
    if (provider === 'chrome') { try { $('#tgo', el).textContent = '正在准备语言包…'; await T.chromePrepare(dir, p => { $('#tgo', el).textContent = `下载语言包 ${Math.round(p * 100)}%`; }); } catch (e) { toast('浏览器内置翻译启动失败：' + e.message, 5000); return; } }
    s.close(); start(ids, { provider, dir, title, onDone });
  };
}
export function start(ids, { provider, dir, title, onDone }) {
  T.run(ids, { provider, dir, title }).then(async () => {
    const st = await T.statsOf(ids); toast(st.left ? `翻译完成，但有 ${st.left} 句没译好（可再点继续，或手动补）` : `《${title}》翻译完成（${T.SHORT[provider]}，可逐句修改）`, 4000); onDone?.();
  }).catch(e => { toast(e.code === 'PAUSED' ? e.message : '翻译暂停：' + e.message + (provider === 'ai' ? '。已翻好的都保存了；可以点「继续翻译」改用免费的 MyMemory 公共翻译接着翻。' : ''), 8000); onDone?.(); });
}

/** 全局进度条（任何页面都显示）。 */
export function mountPill() {
  const pill = document.createElement('div'); pill.id = 'tpill'; pill.className = 'tpill hidden'; pill.setAttribute('role', 'status'); document.body.appendChild(pill);
  let was = false; const de = document.documentElement; de.dataset.tjobs = '0';
  T.onJob(j => {
    if (was && !j.running) de.dataset.tjobs = String(+de.dataset.tjobs + 1); // 已结束的任务数（暂停/完成/出错都算结束）
    was = j.running;
    if (!j.running) { pill.classList.add('hidden'); return; }
    pill.classList.remove('hidden');
    const p = j.total ? Math.round(100 * j.done / j.total) : 0;
    pill.innerHTML = `<span>🌐 正在翻译《${esc(j.title)}》${j.done}/${j.total}（${p}%）· ${esc(T.SHORT[j.provider])}</span><i class="tbar"><b style="width:${p}%"></b></i><button class="mini" id="tpause">暂停</button>`;
    $('#tpause', pill).onclick = () => { T.pause(); pill.querySelector('span').textContent = '正在暂停（这一批翻完就停）…'; };
  });
}

/** 一课/一本书的翻译状态条（显示在课程页、书页）。 */
export async function statusHtml(ids, m) {
  const st = await T.statsOf(ids); let tr = m?.trans;
  if (!tr) for (const id of ids) { const x = await db.materials.get(id); if (x?.trans) { tr = x.trans; if (x.trans.status !== 'done') break; } }
  if (T.job.running && T.job.ids.some(i => ids.includes(i))) return `<div class="note tnote">🌐 正在后台翻译…（进度见页面底部）</div>`;
  if (!st.left) return tr ? `<div class="muted small tdone">译文来自 ${esc(T.SHORT[tr.provider] || '机器翻译')}，可点句子旁的“编辑”逐句修改。</div>` : '';
  const dir = st.dir || 'en2zh';
  const resume = tr && tr.status && tr.status !== 'done';
  return `<div class="note tnote">${dir === 'en2zh' ? `这份材料是纯英文，还有 ${st.left} 句没有中文翻译。` : `这份材料是中文，还有 ${st.left} 句没有英文译文（英文译文会作为学习内容）。`}
    ${resume ? `<br>上次翻译到一半${tr.error ? `（${esc(tr.error)}）` : ''}，可以接着翻${tr.provider === 'ai' && tr.error ? '，也可以改用免费的 MyMemory 公共翻译' : ''}。` : ''}<div class="row gap"><button class="btn primary" id="trBtn">🌐 ${resume ? '继续翻译' : dir === 'en2zh' ? '配上中文翻译' : '配上英文译文'}</button></div></div>`;
}
