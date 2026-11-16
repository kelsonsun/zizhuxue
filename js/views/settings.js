import * as db from '../db.js';
import * as ai from '../ai.js';
import { LocalOnlyAdapter } from '../sync.js';
import { settings, saveSettings, seedIfFirstRun, sampleMaterial } from '../state.js';
import { $, esc, toast, confirmDlg, download, go } from '../ui.js';
import * as tour from '../tour.js';
import { chromeStatus } from '../translate.js';
import { isIosStandalone } from './review.js';
import * as sp from '../speech.js';

const OFFLINE_ASSETS = ['vendor/tesseract/tesseract.min.js', 'vendor/tesseract/worker.min.js', 'vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js', 'vendor/tesseract/core/tesseract-core-lstm.wasm.js', 'vendor/tesseract/lang/eng.traineddata.gz', 'vendor/pdfjs/pdf.min.js', 'vendor/pdfjs/pdf.worker.min.js', 'vendor/mammoth/mammoth.browser.min.js'];

export async function render(root) {
  const c = ai.getConfig() || { baseUrl: '', apiKey: '', model: '' };
  const sync = new LocalOnlyAdapter();
  root.innerHTML = `
  <header class="top"><h1>我的</h1><span class="muted">设置、AI、备份</span></header>

  <section class="card"><h2>AI 设置 <span class="tag ${ai.isConfigured() ? 'okt' : ''}" id="aist">${ai.isConfigured() ? '已配置' : '未配置'}</span></h2>
    <p class="muted small">填入兼容 OpenAI 的接口（地址以 /v1 结尾，例如 https://api.openai.com/v1），自动生成情景对话、词卡、地道表达都靠它。<b>密钥只保存在这台设备的浏览器里</b>，不会进入备份文件，也不会发给本软件以外的任何人；调用时你的文字会直接发到你填的这个地址。部分 AI 服务不允许浏览器直接访问（CORS），那样会提示连接失败。</p>
    <div class="field"><label for="ab">接口地址</label><input id="ab" value="${esc(c.baseUrl)}" placeholder="https://api.openai.com/v1" inputmode="url" autocapitalize="off" autocomplete="off"></div>
    <div class="field"><label for="ak">密钥（API Key）</label><input id="ak" type="password" value="${esc(c.apiKey)}" placeholder="sk-…" autocomplete="off"></div>
    <div class="field"><label for="am">模型</label><input id="am" value="${esc(c.model)}" placeholder="例如 gpt-4o-mini" autocapitalize="off" autocomplete="off"></div>
    <div class="row gap wrap"><button class="btn primary" id="asave">保存</button><button class="btn" id="atest">测试连接</button><button class="btn" id="aclear">清除</button></div><div class="muted small" id="amsg" role="status"></div></section>

  <section class="card"><h2>学习设置</h2>
    <div class="field"><label for="nl">每天新卡上限</label><select id="nl">${[5, 10, 20, 30].map(n => `<option ${settings.newLimit === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <label class="check"><input type="checkbox" id="asr" ${settings.useAsr ? 'checked' : ''}> 跟读和复习「说出来」时用浏览器语音识别转文字判分（关掉则只录音回放 + 自评）</label>
    <p class="muted small" id="asrinfo">语音识别：${!sp.asrSupported() ? '这个浏览器没有。' : isIosStandalone() ? 'iPhone 主屏应用里苹果不提供（即使接口存在也不工作），已自动改为录音回放 + 自评。用 Safari 浏览器打开本站则可用（需开启 Siri，语音交给苹果服务器识别）。' : '可用（由浏览器厂商的服务识别，仅供参考）。'}</p>
    ${isIosStandalone() && sp.asrSupported() ? `<label class="check"><input type="checkbox" id="fasr" ${settings.forceAsr ? 'checked' : ''}> 在主屏应用里也尝试语音识别（若无反应会自动改为自评）</label>` : ''}
    <button class="btn" id="tourAgain">🧭 重新观看新手引导</button></section>

  <section class="card"><h2>翻译（给纯英文/纯中文材料配对照）</h2>
    <p class="muted small">导入纯英文或纯中文的文件后，可以一键配上翻译。三种真实通道，按需选择：</p>
    <ul class="small"><li><b>AI</b>：用上面配置的接口，质量最好；${ai.isConfigured() ? '已配置。' : '<b>未配置</b>。'}</li>
      <li><b>浏览器内置翻译</b>：电脑版 Chrome 138+ / Edge 148+ 在本机翻译、不上传；iPhone 上的所有浏览器都没有。当前浏览器：<span id="csnow">检测中…</span></li>
      <li><b>MyMemory 公共翻译</b>：免费、免注册、iPhone 可用；内容会发给第三方 MyMemory（Translated 公司），每次使用前会让你确认。匿名约 5000 字符/天，填一个邮箱可到约 50000 字符/天（邮箱会随请求发给 MyMemory，不是注册）。</li></ul>
    <div class="field"><label for="mme">MyMemory 联系邮箱（可选）</label><input id="mme" type="email" value="${esc(settings.mmEmail || '')}" placeholder="不填则匿名使用" autocomplete="email"></div></section>

  <section class="card"><h2>数据与备份</h2>
    <p class="muted small">所有材料、卡片和复习进度都保存在本设备。备份文件是 JSON（不含 AI 密钥和录音），可用来换设备或防丢。</p>
    <div class="row gap wrap"><button class="btn" id="exp">导出 JSON 备份</button><label class="btn">导入备份（合并）<input type="file" id="imp" accept=".json,application/json" hidden></label><label class="btn">导入备份（覆盖）<input type="file" id="impr" accept=".json,application/json" hidden></label></div>
    <div class="row gap wrap"><button class="btn" id="sample">恢复示例材料</button><button class="btn danger" id="wipe">清空所有数据</button></div>
    <div class="muted small">存储方式：${db.storageMode === 'indexeddb' ? 'IndexedDB（本地）' : '内存（浏览器禁用了本地存储，关闭即丢失）'}</div></section>

  <section class="card"><h2>云同步 <span class="tag">未启用</span></h2>
    <p class="muted small">当前：${esc(sync.label)}。第一版不联网、不需要登录。数据层已按“可同步”设计（每条记录带更新时间，删除留墓碑，合并策略已实现并测试），后续只需接入同步服务，做到「一键绑定、长期保持登录」，手机和电脑进度自动一致。现在换设备请用上面的 JSON 备份。</p></section>

  <section class="card"><h2>离线使用</h2>
    <p class="muted small">界面和离线词典安装后即可离线使用。截图识别、PDF、Word 的组件约 15MB，点下面按钮提前缓存，之后断网也能用。</p>
    <button class="btn" id="pre">预缓存识别组件</button><div class="muted small" id="premsg" role="status"></div></section>

  <section class="card"><h2>隐私</h2><ul class="small">
    <li>内容只存在本机浏览器，没有账号、没有服务器。</li>
    <li>只有你点「AI」按钮时，相关句子才会发到你配置的 AI 服务。</li>
    <li>只有你确认使用「MyMemory 公共翻译」时，要翻译的句子才会发给 MyMemory。</li>
    <li>跟读录音只在内存里，关页面即清除；浏览器自带的语音识别可能由浏览器厂商的服务处理，请留意。</li></ul></section>

  <section class="card"><h2>关于</h2><p class="muted small">自主学 v1.1（版本 <span id="ver">…</span>）· 离线词典 ECDICT（MIT）· 识别 Tesseract.js（Apache-2.0）· PDF.js（Apache-2.0）· mammoth（BSD-2）</p></section>`;
  const E = id => $(id, root);
  const read = () => ({ baseUrl: E('#ab').value, apiKey: E('#ak').value, model: E('#am').value });
  const refresh = () => { E('#aist').textContent = ai.isConfigured() ? '已配置' : '未配置'; E('#aist').classList.toggle('okt', ai.isConfigured()); };
  E('#asave').onclick = async () => { await ai.saveConfig(read()); refresh(); E('#amsg').textContent = ai.isConfigured() ? '已保存（仅存本机）。' : '三项都要填写才算配置完成。'; };
  E('#aclear').onclick = async () => { await ai.clearConfig(); E('#ab').value = E('#ak').value = E('#am').value = ''; refresh(); E('#amsg').textContent = '已清除。'; };
  E('#atest').onclick = async () => {
    await ai.saveConfig(read()); refresh(); const m = E('#amsg');
    if (!ai.isConfigured()) { m.textContent = '未配置AI，无法测试：请填写地址、密钥和模型。'; return; }
    m.textContent = '测试中…'; try { await ai.testConnection(); m.textContent = '✓ 连接成功，AI 可以使用。'; } catch (e) { m.textContent = '✗ ' + e.message; }
  };
  E('#nl').onchange = e => saveSettings({ newLimit: +e.target.value });
  E('#fasr')?.addEventListener('change', e => saveSettings({ forceAsr: e.target.checked }));
  E('#tourAgain').onclick = () => tour.start();
  E('#mme').onchange = e => { const v = e.target.value.trim(); if (v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return toast('邮箱格式不对'); saveSettings({ mmEmail: v }); toast(v ? '已保存：MyMemory 额度约 50000 字符/天' : '已清除，匿名使用'); };
  chromeStatus('en2zh').then(st => { E('#csnow').textContent = { available: '可用（语言包已下载）', downloadable: '可用（首次需下载语言包）', downloading: '可用（语言包下载中）', unavailable: '不可用', none: '不支持' }[st] || st; });
  fetch('precache.json').then(r => r.json()).then(j => { E('#ver').textContent = j.version; }).catch(() => { E('#ver').textContent = '未知'; });
  E('#asr').onchange = e => saveSettings({ useAsr: e.target.checked });
  E('#exp').onclick = async () => { download(`自主学备份_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await db.exportAll(), null, 1)); toast('已导出（不含 AI 密钥）'); };
  const doImport = (mode) => async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (mode === 'replace' && !(await confirmDlg('覆盖导入会清除当前所有材料和卡片，换成备份里的内容。确定吗？', { ok: '覆盖', danger: true }))) return;
      const r = await db.importAll(data, { mode }); toast(`已导入：${r.materials} 份材料、${r.cards} 张卡片`); render(root);
    } catch (err) { toast('导入失败：' + err.message, 5000); }
    e.target.value = '';
  };
  E('#imp').onchange = doImport('merge'); E('#impr').onchange = doImport('replace');
  E('#sample').onclick = async () => { await db.materials.save(sampleMaterial()); toast('已恢复示例材料'); };
  E('#wipe').onclick = async () => { if (await confirmDlg('清空所有材料、卡片和进度？（AI 设置保留）此操作不能撤销，建议先导出备份。', { ok: '清空', danger: true })) { await db.wipeAll(); await db.meta.set('seeded', true); toast('已清空'); go('#/'); } };
  E('#pre').onclick = async () => {
    const m = E('#premsg'); let n = 0; m.textContent = '下载中…';
    try { for (const a of OFFLINE_ASSETS) { const r = await fetch(a); if (!r.ok) throw new Error(a); await r.arrayBuffer(); m.textContent = `已缓存 ${++n}/${OFFLINE_ASSETS.length}`; } m.textContent = '✓ 全部缓存完成，可离线使用识别、PDF、Word。'; }
    catch (e) { m.textContent = '缓存失败：' + e.message; }
  };
}
