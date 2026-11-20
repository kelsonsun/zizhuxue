import * as db from '../db.js';
import * as ai from '../ai.js';
import * as cloud from '../cloud.js';
import { SYNC_AVAILABLE } from '../deploy.js';
import { sheet } from '../ui.js';
import { settings, saveSettings, seedIfFirstRun, sampleMaterial } from '../state.js';
import { $, esc, toast, confirmDlg, download, go } from '../ui.js';
import * as OFF from '../offmode.js';
import * as tour from '../tour.js';
import * as inst from '../install.js';
import { APP_VERSION } from '../version.js';
import { chromeStatus } from '../translate.js';
import { isIosStandalone } from './review.js';
import * as sp from '../speech.js';
import * as tts from '../tts.js';

const OFFLINE_ASSETS = ['vendor/tesseract/tesseract.min.js', 'vendor/tesseract/worker.min.js', 'vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js', 'vendor/tesseract/core/tesseract-core-lstm.wasm.js', 'vendor/tesseract/lang/eng.traineddata.gz', 'vendor/pdfjs/pdf.min.js', 'vendor/pdfjs/pdf.worker.min.js', 'vendor/mammoth/mammoth.browser.min.js'];

/** v1.7：说明类文字一律可折叠（默认收起，只显示标题；点标题展开 / 收起） */
const help = (title, html, id = '') => `<details class="help"${id ? ` id="${id}"` : ''}><summary>${title}</summary><div class="helpb">${html}</div></details>`;

export async function render(root) {
  const c = ai.getConfig() || { baseUrl: '', apiKey: '', model: '' };
  root.innerHTML = `
  <header class="top"><h1>我的</h1><button class="btn fbtop" id="fbTop" aria-label="反馈问题或提建议">🐞 反馈</button><span class="muted">设置、AI、备份、反馈</span></header>
  <section class="card fbcard" id="fbCard"><h2>反馈与建议</h2><div id="fbBox"></div></section>
  <section class="card sharecard" id="shareCard"><h2>📣 分享给朋友</h2><p class="small">生成一张带二维码的分享卡片图：发微信、朋友圈、任何聊天软件都行，朋友长按识别或扫码就能打开。</p>
    <div class="row gap wrap"><button class="btn primary" id="shareAppGo">🖼 生成分享卡片图</button><button class="btn" id="shareAppCopy">🔗 复制链接</button></div></section>

  <section class="card"><h2>AI 设置 <span class="tag ${ai.isConfigured() ? 'okt' : ''}" id="aist">${ai.isConfigured() ? '已配置' : '未配置'}</span></h2>
    ${help('说明：AI 接口怎么填、密钥存在哪', `<p class="muted small">填入兼容 OpenAI 的接口（地址以 /v1 结尾，例如 https://api.openai.com/v1），自动生成情景对话、词卡、地道表达都靠它。<b>密钥只保存在这台设备的浏览器里</b>，不会进入备份文件，也不会发给本软件以外的任何人；调用时你的文字会直接发到你填的这个地址。部分 AI 服务不允许浏览器直接访问（CORS），那样会提示连接失败。</p>`, 'hAi')}
    <div class="field"><label for="ab">接口地址</label><input id="ab" value="${esc(c.baseUrl || ai.DEFAULT_BASE)}" placeholder="https://api.openai.com/v1" inputmode="url" autocapitalize="off" autocomplete="off"></div>
    <div class="field"><label for="ak">密钥（API Key）</label><input id="ak" type="password" value="${esc(c.apiKey)}" placeholder="sk-…" autocomplete="off"></div>
    <div class="field"><label for="am">模型</label><input id="am" value="${esc(c.model || ai.DEFAULT_MODEL)}" placeholder="例如 gpt-4o-mini" autocapitalize="off" autocomplete="off"></div>
    <div class="field"><label for="asrm">语音转写模型 <span class="muted small">（录音/视频自动转文字，接口 /audio/transcriptions）</span></label><input id="asrm" value="${esc(c.asrModel || 'whisper-1')}" placeholder="whisper-1 或 gpt-4o-mini-transcribe" autocapitalize="off" autocomplete="off"></div>
    <div class="row gap wrap"><button class="btn primary" id="asave">保存</button><button class="btn" id="atest">测试连接</button><button class="btn" id="aclear">清除</button></div><div class="muted small" id="amsg" role="status"></div></section>

  <section class="card"><h2>学习设置</h2>
    <div class="field"><label for="nl">每天新卡上限</label><select id="nl">${[5, 10, 20, 30].map(n => `<option ${settings.newLimit === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <label class="check"><input type="checkbox" id="asr" ${settings.useAsr ? 'checked' : ''}> 跟读和复习「说出来」时用浏览器语音识别转文字判分（关掉则只录音回放 + 自评）</label>
    <p class="muted small" id="asrinfo">语音识别：${!sp.asrSupported() ? '这个浏览器没有。' : isIosStandalone() ? 'iPhone 主屏应用里苹果不提供（即使接口存在也不工作），已自动改为录音回放 + 自评。用 Safari 浏览器打开本站则可用（需开启 Siri，语音交给苹果服务器识别）。' : '可用（由浏览器厂商的服务识别，仅供参考）。'}</p>
    ${isIosStandalone() && sp.asrSupported() ? `<label class="check"><input type="checkbox" id="fasr" ${settings.forceAsr ? 'checked' : ''}> 在主屏应用里也尝试语音识别（若无反应会自动改为自评）</label>` : ''}
    <div class="field"><label for="dgoal">每日目标（打卡）</label><select id="dgoal">${[5, 10, 20, 30].map(n => `<option ${(settings.dailyGoal || 10) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <label class="check"><input type="checkbox" id="hlk" ${settings.hlKnown !== false ? 'checked' : ''}> 课文里自动高亮学过的生词（生词本里的词再次出现时标出来）</label>
    <label class="check"><input type="checkbox" id="sfxTog" ${settings.sfx !== false ? 'checked' : ''}> 庆祝音效（做完一组、打卡里程碑时播放）</label>
    <div class="row gap wrap"><a class="btn" href="#/achieve" id="meAch">🏆 成就</a><a class="btn" href="#/vocab" id="meVocab">📊 词汇量统计</a><button class="btn" id="qkHistMe">🔎 查词翻译历史</button></div>
    <button class="btn" id="tourAgain">🧭 重新观看新手引导</button></section>

  <section class="card" id="licCard"></section>
  <section class="card" id="remindCard"><h2>⏰ 学习提醒</h2>
    <label class="check switch"><input type="checkbox" id="remTog" ${settings.remindOn ? 'checked' : ''}> <b>每天按时提醒我学习</b></label>
    <div class="field"><label for="remAt">提醒时间</label><input type="time" id="remAt" value="${esc(settings.remindAt || '20:00')}" step="300"></div>
    <label class="check"><input type="checkbox" id="remLate" ${settings.remindLate ? 'checked' : ''}> 到 23:00 还没打卡，再提醒一次（“你把我忘了吗？”）</label>
    <p class="muted small">提醒语随时间变语气：早上积极、傍晚撒娇、晚上沮丧、23 点“你把我忘了吗”。今天打卡后当天不再提醒。</p>
    <p class="small" id="remSt" role="status"></p>
    <div class="row gap"><button class="btn" id="remTest">🔔 发一条试试</button></div>
    <div class="note small" id="remCap"></div>
    ${help('说明：各平台实际能做到什么', `<table class="captbl"><tr><th>平台</th><th>怎么提醒</th><th>App 关着时</th></tr>
      <tr><td>安卓 App（APK）</td><td>系统本地通知，不需要服务器</td><td>✅ 会提醒（省电模式下可能晚几分钟）</td></tr>
      <tr><td>电脑客户端（Windows）</td><td>系统通知</td><td>⚠️ 客户端要开着（可最小化）；完全退出不提醒</td></tr>
      <tr><td>iPhone 主屏应用（iOS 16.4+）</td><td>苹果推送（Web Push），需要推送服务器</td><td>✅ 会提醒——前提是部署了推送服务器</td></tr>
      <tr><td>iPhone Safari 网页（没加到主屏）</td><td>苹果不允许网页发通知</td><td>❌ 只能打开时看首页提醒语</td></tr>
      <tr><td>安卓 / 电脑浏览器 + 推送服务器</td><td>浏览器推送</td><td>✅ 会提醒（电脑浏览器要在后台运行）</td></tr>
      <tr><td>安卓 / 电脑浏览器，没有服务器</td><td>网页开着时到点弹通知；安卓 Chrome 安装版另有定期后台补发</td><td>⚠️ 网页关了基本收不到（后台补发不保证准点）</td></tr></table>
      <p class="muted small">推送服务器就是自主学的同步服务器（sync-server），推送功能已做好，部署后自动启用；现在的网页版还没有部署服务器。</p>`, 'hRemind')}
  </section>

  <section class="card" id="voiceCard"><h2>英语朗读声音</h2>
    <div class="field"><label for="vacc">口音</label><select id="vacc">${Object.entries(tts.ACCENTS).map(([k, v]) => `<option value="${k}" ${(settings.accent || 'auto') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div class="field"><label>朗读引擎</label>
      <label class="check"><input type="radio" name="veng" value="system" ${settings.ttsEngine !== 'ai' ? 'checked' : ''}> 系统语音（免费、离线可用）</label>
      <label class="check ${ai.isConfigured() ? '' : 'off'}"><input type="radio" name="veng" value="ai" ${settings.ttsEngine === 'ai' ? 'checked' : ''} ${ai.isConfigured() ? '' : 'disabled'}> AI 自然语音${ai.isConfigured() ? '（用上面配置的接口 /audio/speech，按你的服务计费；生成过的句子缓存在本机，不重复收费）' : '（需先在上面配置 AI 密钥）'}</label></div>
    <div id="vsys"></div><div id="vai"></div>
    <div class="row gap wrap"><button class="btn primary" id="vtry">🔊 试听</button></div><div class="muted small" id="vmsg" role="status"></div>
    ${help('说明：iPhone 怎么换更自然的声音', `<p class="muted small">iPhone 想要更自然的系统声音：打开「设置 → 辅助功能 → 朗读内容 → 声音 → 英语」，选一个口音，下载带“增强”或“高级”字样的声音（如 Ava、Zoe、Evan），下载完回到这里刷新，在「声音」里选它。</p>`, 'hVoice')}</section>

  <section class="card"><h2>翻译（给纯英文/纯中文材料配对照）</h2>
    ${help('说明：三种翻译通道（AI / 浏览器内置 / MyMemory）', `<p class="muted small">导入纯英文或纯中文的文件后，可以一键配上翻译。三种真实通道，按需选择：</p>
    <ul class="small"><li><b>AI</b>：用上面配置的接口，质量最好；${ai.isConfigured() ? '已配置。' : '<b>未配置</b>。'}</li>
      <li><b>浏览器内置翻译</b>：电脑版 Chrome 138+ / Edge 148+ 在本机翻译、不上传；iPhone 上的所有浏览器都没有。当前浏览器：<span id="csnow">检测中…</span></li>
      <li><b>MyMemory 公共翻译</b>：免费、免注册、iPhone 可用；内容会发给第三方 MyMemory（Translated 公司），每次使用前会让你确认。匿名约 5000 字符/天，填一个邮箱可到约 50000 字符/天（邮箱会随请求发给 MyMemory，不是注册）。</li></ul>`, 'hTr')}
    <div class="field"><label for="mme">MyMemory 联系邮箱（可选）</label><input id="mme" type="email" value="${esc(settings.mmEmail || '')}" placeholder="不填则匿名使用" autocomplete="email"></div></section>

  <section class="card"><h2>数据与备份</h2>
    ${help('说明：数据存在哪、备份文件里有什么', '<p class="muted small">所有材料、卡片和复习进度都保存在本设备。备份文件是 JSON（不含 AI 密钥和录音），可用来换设备或防丢。</p>', 'hData')}
    <div class="row gap wrap"><button class="btn" id="exp">导出 JSON 备份</button><label class="btn">导入备份（合并）<input type="file" id="imp" accept=".json,application/json" hidden></label><label class="btn">导入备份（覆盖）<input type="file" id="impr" accept=".json,application/json" hidden></label></div>
    <div class="row gap wrap"><button class="btn" id="sample">恢复示例材料</button><button class="btn danger" id="wipe">清空所有数据</button></div>
    <div class="muted small">存储方式：${db.storageMode === 'indexeddb' ? 'IndexedDB（本地）' : '内存（浏览器禁用了本地存储，关闭即丢失）'}</div></section>

  <section class="card" id="syncCard"><h2>云同步 <span class="tag" id="sytag">…</span></h2><div id="sybody"></div></section>

  ${inst.isNative() ? '' : `<section class="card" id="installCard"><h2>装到主屏 / 电脑桌面</h2>
    ${inst.inAppName() || inst.isStandalone() ? `<p class="small instst" id="instHow">${esc(inst.howText())}</p>` : help('说明：怎么装到主屏 / 桌面', `<p class="small instst" id="instHow">${esc(inst.howText())}</p>`, 'hInst')}
    ${inst.canPrompt() ? '<button class="btn primary" id="doInstall2">一键安装</button>' : ''}
    ${!inst.isStandalone() && inst.inAppName() ? '<button class="btn" id="copyLink2">复制链接</button>' : ''}</section>`}

  <section class="card" id="offCard"><h2>离线使用</h2>
    ${'serviceWorker' in navigator && !inst.isNative() ? `<label class="check switch"><input type="checkbox" id="offTog" ${OFF.offlineOn() ? 'checked' : ''}> <b>离线使用</b>（默认打开）</label>
    <p class="muted small" id="offExp">${OFF.offlineOn() ? '已打开：断网也能用。' : '已关闭：每次从网上加载最新版，没网时打不开。'}</p>
    ${help('说明：离线使用开 / 关有什么区别', '<p class="muted small">打开：整个软件（界面、代码、离线词典）缓存在本机，断网也能用；有新版本时自动更新。</p><p class="muted small">关闭：每次打开都从网上加载最新版，不在本机缓存软件代码，PDF / Word / 截图识别组件也会删掉；没网时打不开，会显示提示页。</p><p class="muted small">两种模式下，你的材料、生词卡、复习记录都不受影响；本机转写的 Whisper 模型也保留。切换后要重新打开才生效。</p>', 'hOff')}` : ''}
    <div id="offBody" ${OFF.offlineOn() ? '' : 'hidden'}>${help('说明：哪些组件会缓存', '<p class="muted small">界面、离线词典，以及 PDF / Word 组件（约 1.8MB），联网打开过一次后就会自动缓存，断网也能用。截图识别组件约 11MB，为省流量不自动下载：第一次用截图识别时会下载，或点下面按钮提前缓存。缓存的组件在应用更新后仍保留。</p>', 'hOffParts')}
    <div class="muted small" id="offst">离线状态：检测中…</div>
    <button class="btn" id="pre">预缓存识别组件</button><div class="muted small" id="premsg" role="status"></div></div>
    <div class="muted small" id="offmsg" role="status"></div></section>

  <section class="card" id="privCard"><details class="help sec" id="hPriv"><summary><h2>隐私</h2></summary><ul class="small">
    <li>不绑定云同步时，内容只存在本机浏览器，没有账号、不联网。绑定后，材料、生词卡和复习记录会存到你填的同步服务器（AI 密钥和录音不会上传）。</li>
    <li>只有你点「AI」按钮时，相关句子才会发到你配置的 AI 服务。</li>
    <li>只有你确认使用「MyMemory 公共翻译」时，要翻译的句子才会发给 MyMemory。</li>
    <li>跟读录音只在内存里，关页面即清除；浏览器自带的语音识别可能由浏览器厂商的服务处理，请留意。</li></ul></details></section>

  <section class="card" id="aboutCard"><details class="help sec" id="hAbout"><summary><h2>关于</h2></summary><p class="muted small">自主学 v${APP_VERSION}（版本 <span id="ver">…</span>）· 离线词典 ECDICT（MIT）· 识别 Tesseract.js（Apache-2.0）· PDF.js（Apache-2.0）· mammoth（BSD-2）</p></details></section>`;
  { const FU = await import('../feedbackui.js'); FU.mountHistory($('#fbBox', root)); $('#fbTop', root).onclick = () => FU.openFeedback({}, { onClose: () => FU.mountHistory($('#fbBox', root)) }); }
  const E = id => $(id, root);
  renderSync(root);
  const qs = new URLSearchParams(location.hash.split('?')[1] || ''); // 扫配对二维码打开：#/me?pair=CODE&srv=URL
  if (qs.get('pair')) { history.replaceState(null, '', '#/me'); bindSheet(root, { pair: qs.get('pair'), url: qs.get('srv') || '' }); }
  const read = () => ({ baseUrl: E('#ab').value, apiKey: E('#ak').value, model: E('#am').value, asrModel: E('#asrm').value.trim() || 'whisper-1' });
  const refresh = () => { E('#aist').textContent = ai.isConfigured() ? '已配置' : '未配置'; E('#aist').classList.toggle('okt', ai.isConfigured()); };
  const saveAi = async () => { const r0 = read(); await ai.saveConfig(r0); const c2 = ai.getConfig(); // 只回填用户没在这期间改过的框，避免覆盖正在输入的内容
    if (E('#ab').value === r0.baseUrl) E('#ab').value = c2.baseUrl; if (E('#am').value === r0.model) E('#am').value = c2.model; if (E('#ak').value === r0.apiKey) E('#ak').value = c2.apiKey; refresh(); if (E('#vsys')) drawVoice(); };
  E('#asave').onclick = async () => { await saveAi(); E('#amsg').textContent = ai.isConfigured() ? '已保存（仅存本机）。地址已自动规范为 ' + ai.getConfig().baseUrl + '。建议点「测试连接」确认。' : '请填写密钥（地址和模型可用默认值）。'; };
  // 填完离开输入框就自动保存（以前只有点「保存」才生效，容易以为填了却没保存）
  ['#ab', '#ak', '#am', '#asrm'].forEach(id => E(id).addEventListener('change', () => { if (E('#ak').value.trim()) saveAi().then(() => { E('#amsg').textContent = '已自动保存（仅存本机）。'; }); }));
  E('#aclear').onclick = async () => { await ai.clearConfig(); E('#ak').value = ''; E('#ab').value = ai.DEFAULT_BASE; E('#am').value = ai.DEFAULT_MODEL; refresh(); E('#amsg').textContent = '已清除。'; };
  E('#atest').onclick = async () => {
    await saveAi(); const m = E('#amsg');
    if (!ai.isConfigured()) { m.textContent = '未配置AI，无法测试：请填写密钥。'; return; }
    m.textContent = '测试中…（会发 2 个很短的请求）'; const b = E('#atest'); b.disabled = true;
    try { const r = await ai.testConnection(); m.textContent = `✓ 连接成功，AI 可以使用（翻译也可以）。地址 ${r.baseUrl} · 模型 ${r.model} · 试译 “Good morning.” → ${r.sample}`; }
    catch (e) { m.textContent = '✗ ' + e.message; } finally { b.disabled = false; }
  };
  // ---- 英语朗读声音 ----
  const drawVoice = async () => {
    const aiR = root.querySelector('input[name=veng][value=ai]'); if (aiR) { aiR.disabled = !ai.isConfigured(); aiR.closest('label').classList.toggle('off', !ai.isConfigured()); }
    const list = tts.englishVoices(settings.accent || 'auto'); const cur = tts.pickVoice();
    E('#vsys').innerHTML = settings.ttsEngine === 'ai' && ai.isConfigured() ? '' : `<div class="field"><label for="vname">声音</label><select id="vname"><option value="">自动挑选（推荐：${esc(cur ? cur.name : '系统默认')}）</option>${list.map(v => `<option value="${esc(v.name)}" ${settings.voiceName === v.name ? 'selected' : ''}>${esc(v.name)} · ${esc(v.lang)}${tts.qualityTag(v) ? ' · ' + tts.qualityTag(v) : ''}</option>`).join('')}</select></div>
      ${list.length ? '' : `<p class="muted small">${tts.supported() ? '这台设备上暂时没有这个口音的英语声音，会用其他英语声音朗读。' : '这个浏览器不支持系统朗读。'}</p>`}`;
    const ci = await tts.cacheInfo();
    E('#vai').innerHTML = settings.ttsEngine === 'ai' && ai.isConfigured() ? `<div class="field"><label for="vaiv">AI 声音</label><select id="vaiv">${tts.AI_VOICES.map(v => `<option ${(settings.aiVoice || 'coral') === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label for="vaim">语音模型</label><input id="vaim" value="${esc(settings.aiTtsModel || tts.AI_TTS_MODEL)}" autocapitalize="off" autocomplete="off"></div>
      <p class="muted small">${/^gpt-4o/i.test(settings.aiTtsModel || tts.AI_TTS_MODEL) ? '口音通过语音指令实现（gpt-4o 系列支持）。' : '这个模型不支持指定口音，口音设置只对系统语音生效。'}本机已缓存 ${ci.count} 段（${(ci.bytes / 1048576).toFixed(1)} MB）。AI 语音失败时会提示原因并自动改用系统语音。</p>
      <button class="btn" id="vclr">清除语音缓存</button>` : '';
    E('#vname')?.addEventListener('change', e => saveSettings({ voiceName: e.target.value }));
    E('#vaiv')?.addEventListener('change', e => saveSettings({ aiVoice: e.target.value }));
    E('#vaim')?.addEventListener('change', e => saveSettings({ aiTtsModel: e.target.value.trim() }).then(drawVoice));
    E('#vclr')?.addEventListener('click', async () => { await tts.clearCache(); E('#vmsg').textContent = '已清除语音缓存。'; drawVoice(); });
  };
  drawVoice(); if (tts.supported()) speechSynthesis.addEventListener?.('voiceschanged', () => { if (E('#vsys')) drawVoice(); });
  E('#vacc').onchange = async e => { await saveSettings({ accent: e.target.value, voiceName: '' }); drawVoice(); };
  root.querySelectorAll('input[name=veng]').forEach(r => r.onchange = async () => { await saveSettings({ ttsEngine: r.value }); drawVoice(); });
  E('#vtry').onclick = async () => {
    const m = E('#vmsg'); m.textContent = settings.ttsEngine === 'ai' && ai.isConfigured() ? '正在生成 AI 语音…' : '';
    try { await tts.speak('Hi! This is how your English reading voice sounds. Shall we practice together?', { rate: settings.rate });
      const v = tts.pickVoice(); if (tts.lastEngine === 'ai') await drawVoice(); m.textContent = tts.lastEngine === 'ai' ? `正在使用 AI 自然语音（${settings.aiVoice || 'coral'} · ${settings.aiTtsModel || tts.AI_TTS_MODEL}）` : `正在使用系统语音：${v ? v.name + '（' + v.lang + '）' : '系统默认'}`; }
    catch (e) { m.textContent = '✗ ' + e.message; }
  };
  E('#nl').onchange = e => saveSettings({ newLimit: +e.target.value });
  E('#dgoal').onchange = e => saveSettings({ dailyGoal: +e.target.value });
  E('#hlk').onchange = e => saveSettings({ hlKnown: e.target.checked });
  E('#sfxTog').onchange = e => saveSettings({ sfx: e.target.checked });
  E('#qkHistMe').onclick = async () => (await import('./quickbox.js')).openHistory({ onPick: r => toast(`「${r.q}」：${r.word ? r.word.zh.split(' | ')[0] : r.tr || (r.rev || []).map(x => x.w).join(', ')}`, 5000) });
  E('#fasr')?.addEventListener('change', e => saveSettings({ forceAsr: e.target.checked }));
  E('#tourAgain').onclick = () => tour.start();
  // v1.8 学习提醒
  const R = await import('../remind.js');
  const fmtNext = it => { if (!it) return ''; const d = new Date(it.at), t = new Date(); const day = d.toDateString() === t.toDateString() ? '今天' : new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1).toDateString() === d.toDateString() ? '明天' : `${d.getMonth() + 1}月${d.getDate()}日`; return `${day} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}「${it.body}」`; };
  const remCap = async () => { const c = await R.capability(); E('#remCap').innerHTML = `<b>这台设备：</b>${esc({ 'android-app': '安卓 App', 'ios-app': 'iPhone App', electron: '电脑客户端', 'ios-pwa': 'iPhone 主屏应用', 'ios-safari': 'iPhone Safari 网页', web: '浏览器网页' }[c.plat])}${c.ok ? '' : ' · <b class="warn">收不到系统通知</b>'}<br>${c.lines.map(esc).join('<br>')}`; E('#remCap').dataset.route = c.route; E('#remTest').disabled = !c.ok || !settings.remindOn; return c; };
  const remApply = async ask => {
    const st = E('#remSt'); st.textContent = settings.remindOn ? '正在安排…' : '';
    try { const r = await R.apply({ ask }); st.textContent = r.route === 'off' ? '提醒已关闭。' : r.items.length ? `✓ 已安排。下一次：${fmtNext(r.items[0])}` : '✓ 已打开。'; st.dataset.route = r.route; st.className = 'small okt'; }
    catch (e) { st.textContent = '没能打开提醒：' + e.message; st.className = 'small warn'; if (e.code === 'perm' || e.code === 'unsupported') { await saveSettings({ remindOn: false }); E('#remTog').checked = false; } }
    await remCap();
  };
  await remCap(); if (settings.remindOn) R.apply().then(r => { if (r.items?.[0]) E('#remSt').textContent = `✓ 已安排。下一次：${fmtNext(r.items[0])}`; }).catch(e => { E('#remSt').textContent = '提醒没排上：' + e.message; });
  E('#remTog').onchange = async e => { await saveSettings({ remindOn: e.target.checked }); remApply(e.target.checked); };
  E('#remAt').onchange = async e => { if (!/^\d{2}:\d{2}$/.test(e.target.value)) return; await saveSettings({ remindAt: e.target.value }); if (settings.remindOn) remApply(false); };
  E('#remLate').onchange = async e => { await saveSettings({ remindLate: e.target.checked }); if (settings.remindOn) remApply(false); };
  E('#remTest').onclick = async () => { try { await R.test(); toast('已发出一条测试提醒'); } catch (e) { toast('没发出去：' + e.message, 5000); } };
  E('#doInstall2')?.addEventListener('click', async () => { if (await inst.prompt()) toast('已安装，以后从主屏幕/桌面打开即可'); E('#doInstall2')?.remove(); E('#instHow').textContent = inst.howText(); });
  E('#copyLink2')?.addEventListener('click', async () => toast(await inst.copyLink() ? '链接已复制，到浏览器里粘贴打开' : '复制失败：请点右上角「···」选「在浏览器打开」', 4000));
  E('#mme').onchange = e => { const v = e.target.value.trim(); if (v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return toast('邮箱格式不对'); saveSettings({ mmEmail: v }); toast(v ? '已保存：MyMemory 额度约 50000 字符/天' : '已清除，匿名使用'); };
  chromeStatus('en2zh').then(st => { E('#csnow').textContent = { available: '可用（语言包已下载）', downloadable: '可用（首次需下载语言包）', downloading: '可用（语言包下载中）', unavailable: '不可用', none: '不支持' }[st] || st; });
  fetch('precache.json').then(r => r.json()).then(j => { E('#ver').textContent = j.version; }).catch(() => { E('#ver').textContent = '未知'; });
  E('#asr').onchange = e => saveSettings({ useAsr: e.target.checked });
  import('./unlock.js').then(U => U.mountCard(E('#licCard'))).catch(e => console.warn('license', e)); // v1.9 会员与激活
  // v1.9.1 分享给朋友：本地画分享卡片图（带二维码）；复制链接
  E('#shareAppGo').onclick = () => import('../sharecard.js').then(m => m.openShareCard()).catch(e => toast('生成分享图没成功：' + e.message));
  E('#shareAppCopy').onclick = () => import('../sharecard.js').then(async m => toast(await m.copyLink() ? '已复制链接：' + m.SHARE_URL : '复制没成功：' + m.SHARE_URL));
  E('#exp').onclick = async () => { download(`自主学备份_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await db.exportAll(), null, 1)); toast('已导出（不含 AI 密钥）'); };
  const doImport = (mode) => async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (mode === 'replace' && !(await confirmDlg('覆盖导入会清除当前所有材料和卡片，换成备份里的内容。确定吗？', { ok: '覆盖', danger: true }))) return;
      const r = await db.importAll(data, { mode }); await (await import('../license.js')).load(true); toast(`已导入：${r.materials} 份材料、${r.cards} 张卡片`); render(root);
    } catch (err) { toast('导入失败：' + err.message, 5000); }
    e.target.value = '';
  };
  E('#imp').onchange = doImport('merge'); E('#impr').onchange = doImport('replace');
  E('#sample').onclick = async () => { await db.materials.save(sampleMaterial()); toast('已恢复示例材料'); };
  E('#wipe').onclick = async () => { if (await confirmDlg('清空所有材料、卡片和进度？（AI 设置保留）此操作不能撤销，建议先导出备份。', { ok: '清空', danger: true })) { await db.wipeAll(); await cloud.resetCursor(); await db.meta.set('seeded', true); toast((await cloud.isBound()) ? '已清空本机（云端数据不受影响，下次同步会重新下载）' : '已清空'); go('#/'); } };
  const offStatus = async () => {
    if (!('caches' in window)) { E('#offst').textContent = '离线状态：此浏览器不支持离线缓存'; return; }
    const has = async f => !!(await caches.match(new URL(f, document.baseURI).href));
    const pdf = await has('vendor/pdfjs/pdf.worker.min.js') && await has('vendor/pdfjs/pdf.min.js'), word = await has('vendor/mammoth/mammoth.browser.min.js');
    const ocr = await has('vendor/tesseract/tesseract.min.js') && await has('vendor/tesseract/lang/eng.traineddata.gz') && await has('vendor/tesseract/worker.min.js');
    const el = E('#offst'); if (el) el.textContent = `离线状态：界面与词典 ✓ · PDF ${pdf ? '✓' : '未缓存'} · Word ${word ? '✓' : '未缓存'} · 截图识别 ${ocr ? '✓' : '未缓存'}`;
  };
  offStatus();
  E('#offTog')?.addEventListener('change', async e => {
    const on = e.target.checked, m = E('#offmsg'); e.target.disabled = true;
    if (!on && !(await confirmDlg('关闭离线使用？关闭后每次打开都从网上加载最新版，没网时打不开；会删掉本机缓存的软件代码和 PDF / Word / 截图识别组件。你的材料、生词卡和复习记录不受影响。', { ok: '关闭离线使用' }))) { e.target.checked = true; e.target.disabled = false; return; }
    m.textContent = on ? '正在下载整个软件到本机…' : '正在切换为联网模式…';
    try {
      await OFF.setOffline(on);
      m.textContent = on ? '✓ 已打开离线使用。' : '✓ 已关闭离线使用。';
      E('#offExp').textContent = on ? '已打开：断网也能用（重新打开后生效）。' : '已关闭：每次从网上加载最新版（重新打开后生效）。'; E('#offBody').hidden = !on; if (on) offStatus();
      const sh = sheet(`<h3>${on ? '已打开离线使用' : '已关闭离线使用'}</h3><p>${on ? '整个软件已缓存到本机，断网也能用。' : '以后每次都从网上加载最新版；没网时会显示提示页。'}你的材料和卡片都没有变。</p><p><b>请重新打开「自主学」让设置生效</b>（关掉再打开，或点下面的按钮）。</p><button class="btn primary" id="reopen">现在重新打开</button>`);
      $('#reopen', sh.el).onclick = () => location.reload();
    } catch (err) { e.target.checked = !on; m.textContent = `切换失败（${err.message}），设置没有改变。${on ? '打开离线使用需要联网下载整个软件。' : '需要联网才能切换。'}`; }
    finally { e.target.disabled = false; }
  });
  E('#pre').onclick = async () => {
    const m = E('#premsg'); let n = 0; m.textContent = '下载中…';
    try { for (const a of OFFLINE_ASSETS) { const r = await fetch(a); if (!r.ok) throw new Error(a); await r.arrayBuffer(); m.textContent = `已缓存 ${++n}/${OFFLINE_ASSETS.length}`; } m.textContent = '✓ 全部缓存完成，可离线使用识别、PDF、Word。'; offStatus(); }
    catch (e) { m.textContent = '缓存失败：' + e.message; }
  };
}

// ---------- 云同步（默认不打扰：不绑定就完全本地使用） ----------
const fmtT = ts => ts ? new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '从未';
/** 是否有可用的同步服务器：已保存过地址，或这次部署自带同步服务器（js/deploy.js，不发网络请求） */
const syncAvailable = cfg => !!(cfg.url || settings.syncUrl || (SYNC_AVAILABLE && cloud.defaultUrl()));
async function renderSync(root) {
  const body = $('#sybody', root), tag = $('#sytag', root); if (!body) return;
  const cfg = await cloud.getConfig(); const st = cloud.status; const bound = !!cfg.refreshToken;
  tag.textContent = bound ? (st.state === 'offline' ? '离线排队中' : st.state === 'error' ? '同步出错' : '已绑定') : st.state === 'expired' ? '需重新绑定' : '未绑定'; tag.classList.toggle('okt', bound && st.state === 'ok');
  if (!bound && !syncAvailable(cfg)) {
    // 没有可用的同步服务器（如 GitHub Pages 静态部署、原生客户端未配置）：显示“未开通”，不放会报错的按钮
    tag.textContent = '未开通'; tag.classList.remove('okt');
    body.innerHTML = `<p class="muted small">还没有开通云同步：数据只保存在这台设备上。</p>${help('说明：换设备怎么办', '<p class="muted small">这个版本还没有开通云同步服务，数据只保存在这台设备上，不登录也能一直正常使用。需要换设备时，可以用上面「数据与备份」里的导出，再在新设备上导入。</p>', 'hSync')}
      <details class="allsense"><summary>我有自己搭建的同步服务器</summary><p class="muted small">填写你自己的「自主学」同步服务器地址后才能绑定；地址不对会直接提示，不会改动本机数据。</p><button class="btn" id="syOwn">填写服务器地址</button></details>`;
    $('#syOwn', body).onclick = () => bindSheet(root, { own: true });
    return;
  }
  if (!bound) {
    body.innerHTML = `<p class="muted small">${st.state === 'expired' ? '<b class="warn">' + esc(st.msg) + '</b><br>' : ''}不登录也能一直用。</p>${help('说明：什么时候需要绑定', '<p class="muted small">现在所有数据只在这台设备上，不登录也能一直用。想让手机和电脑的材料、生词卡、复习进度保持一致时，再绑定（只需一次，之后长期保持登录、自动同步）。</p>', 'hSync')}
      <button class="btn primary" id="syBind">☁️ 绑定/同步</button>`;
    $('#syBind', body).onclick = () => bindSheet(root);
    return;
  }
  body.innerHTML = `<p class="small">账号：<b>${esc(cfg.email || '（配对加入）')}</b><br><span class="muted">上次同步：<span id="syLast">${fmtT(st.lastSync || cfg.lastSync)}</span> · 待上传 <span id="syPend">${st.pending || 0}</span> 条</span><br><span class="muted" id="syMsg" role="status">${esc(st.msg || '')}</span></p>
    <div class="row gap wrap"><button class="btn primary" id="syNow">立即同步</button><button class="btn" id="syPair">📱 添加另一台设备</button><button class="btn" id="syOff">解除绑定</button></div>
    ${help('说明：同步服务器、什么时候同步', `<p class="muted small">同步服务器：${esc(cfg.url)}。会自动在后台同步（打开时、联网时、改动后）；离线时的改动先存本机，联网后自动补传。</p>`, 'hSync')}`;
  $('#syNow', body).onclick = async () => { $('#syMsg', body).textContent = '同步中…'; try { const r = await cloud.syncNow(); toast(`已同步（下载 ${r?.pulled || 0} 条，上传 ${r?.pushed || 0} 条）`); } catch (e) { toast(cloud.status.msg || e.message, 4000); } renderSync(root); };
  $('#syPair', body).onclick = () => pairSheet();
  $('#syOff', body).onclick = async () => { if (await confirmDlg('解除绑定后，这台设备不再同步；本机的数据都保留，云端数据也保留。确定吗？', { ok: '解除绑定' })) { await cloud.unbind(); toast('已解除绑定'); renderSync(root); } };
  const off = cloud.onChange(() => { if (!document.body.contains(body)) return off(); const l = $('#syLast', body), p = $('#syPend', body), m = $('#syMsg', body); if (l) l.textContent = fmtT(cloud.status.lastSync); if (p) p.textContent = cloud.status.pending; if (m) m.textContent = cloud.status.msg; });
}
export function bindSheet(root, { pair = '', url = '', own = false } = {}) {
  return cloud.getConfig().then(cfg => {
    const s = sheet(`<h3>绑定云同步</h3>
      <p class="muted small">绑定后，这台设备上已有的材料、生词卡、复习记录会合并到账号里；另一台设备绑定同一账号后进度一致。</p>
      <div class="field"><label for="syUrl">同步服务器地址</label><input id="syUrl" value="${esc(url || cfg.url || settings.syncUrl || (own ? '' : cloud.defaultUrl()))}" placeholder="https://你的服务器/api/v1/" inputmode="url" autocapitalize="off" autocomplete="off"></div>
      <p class="muted small">原型阶段使用自托管的同步服务器；正式上线用哪家云服务，需由董事长决定后填入。</p>
      <div class="seg" role="tablist"><a href="javascript:void 0" data-t="mail" class="${pair ? '' : 'on'}">邮箱验证码</a><a href="javascript:void 0" data-t="pair" class="${pair ? 'on' : ''}">配对码 / 扫码</a></div>
      <div data-p="mail" class="${pair ? 'hidden' : ''}">
        <div class="field"><label for="syEmail">邮箱</label><input id="syEmail" type="email" autocomplete="email" placeholder="you@example.com"></div>
        <button class="btn" id="sySend">获取验证码</button>
        <div class="field"><label for="syCode">6 位验证码</label><input id="syCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></div>
        <p class="muted small">原型阶段验证码不发邮件，而是显示在同步服务器的日志里（正式版需接入邮件服务）。</p>
        <button class="btn primary" id="syVerify">绑定</button></div>
      <div data-p="pair" class="${pair ? '' : 'hidden'}">
        <p class="muted small">在已经绑定的那台设备上：「我的 → 云同步 → 添加另一台设备」，会显示配对码和二维码。用手机相机扫二维码可直接打开本页。</p>
        <div class="field"><label for="syPairCode">配对码</label><input id="syPairCode" value="${esc(pair)}" autocapitalize="characters" autocomplete="off" placeholder="ABCD-EF23"></div>
        <button class="btn primary" id="syClaim">加入账号</button></div>
      <div class="muted small" id="syBMsg" role="status"></div>`);
    const el = s.el, M = t => { $('#syBMsg', el).textContent = t; }, U = () => $('#syUrl', el).value.trim();
    el.querySelectorAll('.seg a').forEach(a => a.onclick = () => { el.querySelectorAll('.seg a').forEach(x => x.classList.toggle('on', x === a)); el.querySelectorAll('[data-p]').forEach(p => p.classList.toggle('hidden', p.dataset.p !== a.dataset.t)); });
    const done = async () => { await saveSettings({ syncUrl: U() }); s.close(); toast('已绑定，以后会自动同步'); if (root?.isConnected) renderSync(root); else if (location.hash.startsWith('#/me')) go('#/me'); };
    $('#sySend', el).onclick = async () => { M('发送中…'); try { const r = await cloud.emailStart(U(), $('#syEmail', el).value.trim()); M(r?.delivery === 'server-log' ? '验证码已生成（原型服务器：验证码在服务器日志里，不发邮件），10 分钟内有效。' : `验证码已发到你的邮箱，${Math.round((r?.expiresIn || 600) / 60)} 分钟内有效。没收到请看看垃圾邮件。`); $('#syCode', el).focus(); } catch (e) { M('✗ ' + e.message); } };
    $('#syVerify', el).onclick = async () => { M('绑定中…'); try { await cloud.emailVerify(U(), $('#syEmail', el).value.trim(), $('#syCode', el).value.trim()); await done(); } catch (e) { M('✗ ' + e.message); } };
    $('#syClaim', el).onclick = async () => { M('加入中…'); try { await cloud.pairClaim(U(), $('#syPairCode', el).value.trim()); await done(); } catch (e) { M('✗ ' + e.message); } };
    return s;
  });
}
async function pairSheet() {
  const s = sheet(`<h3>添加另一台设备</h3><div id="pp" class="center">生成中…</div>`);
  try {
    const cfg = await cloud.getConfig(); const r = await cloud.pairStart();
    const link = new URL('./', document.baseURI).href + '#/me?pair=' + encodeURIComponent(r.code) + '&srv=' + encodeURIComponent(cfg.url);
    const { default: qrcode } = await import(new URL('vendor/qrcode/qrcode.js', document.baseURI).href);
    const qr = qrcode(0, 'M'); qr.addData(link); qr.make();
    $('#pp', s.el).innerHTML = `<p>在另一台设备上打开「自主学 → 我的 → 绑定/同步 → 配对码」，输入：</p><div class="paircode" id="pairCode">${esc(r.code)}</div>
      <p class="muted small">或用那台手机的相机扫下面的二维码：</p><div class="qr">${qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true })}</div><p class="muted small">10 分钟内有效，只能用一次。</p>`;
  } catch (e) { $('#pp', s.el).textContent = '✗ ' + e.message; }
}
