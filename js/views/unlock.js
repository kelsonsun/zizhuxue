// v1.9 会员与激活：试用用完后的页面（#/unlock）、「我的 → 会员与激活」卡片、首页提醒条。
import * as db from '../db.js';
import * as L from '../license.js';
import * as B from '../billing.js';
import * as PT from '../pricetable.js';
import * as Pay from '../pay.js';
import { $, esc, toast, download } from '../ui.js';

const ONE = `一次 = 一段连续的学习，不限时长：不管做了多少组、学了多久都只算一次；停下超过 ${B.SESSION_GAP_MIN} 分钟（没有任何学习操作）再开始学，才算新的一次。这段学习里至少完成一组复习 / 测验 / 练习（${B.MIN_ANSWERS} 题以上）或学完课文一段才计入；只打开 App、查词、拍照、导入、看材料都不算。`;
/** 提示语（免费版、私域版显示；已激活或商店版不显示）。试用限制没开时当作方案说明 */
const tagline = g => g.licensed || g.offer.store ? '' : `<p class="tagline" id="licTagline"><b>${esc(B.TRIAL_TAGLINE)}</b>${g.offer.enforce ? '' : '<br><span class="muted small">试用限制还没开始，现在所有功能免费。</span>'}</p>`;
const fmtLeft = d => d === Infinity ? '永久有效' : d === 0 ? '今天到期' : `还有 ${d} 天`;
export function statusLine(g) {
  if (g.ls.state === 'active' || g.ls.state === 'expiring') return `已激活 · ${esc(g.lic.planName)} · ${g.lic.forever ? '永久有效' : `到 ${g.lic.expires}（${fmtLeft(g.ls.daysLeft)}）`}${g.deviceBlocked ? ' · <b class="warn">这台设备超出设备数，暂不可用</b>' : ''}`;
  if (g.srvLicensed) return `已开通（账户订阅）· ${esc(g.server.planName || g.server.plan)}${g.server.expires ? ` · 到 ${g.server.expires}` : ''}`;
  if (g.ls.state === 'expired') return `会员已在 ${g.lic.expires} 到期${g.locked ? ' · 需要续费才能继续学习' : ''}`;
  if (g.ls.state === 'revoked') return `激活码 #${g.lic.serial} 已作废`;
  if (!g.offer.enforce) return '免费使用';
  return g.locked ? `免费试用已用完（${g.uses} / ${g.uses} 次）` : `免费试用中：已用 ${g.used} / ${g.uses} 次，还剩 <b>${g.remaining}</b> 次${g.inSession ? '（这一次还没结束，可以接着学，不限时长）' : ''}`;
}
function pricesHtml(o, region) {
  if (!o.showPrices) return o.store ? '<p class="muted small" id="storeNote">商店版的购买方式以商店页面为准。</p>' : '';
  const filled = (B.PRICES || []).filter(p => p.price);
  if (filled.length) {
    const rows = B.PRICES.map(p => `<li class="price" data-plan="${esc(p.plan)}"><b>${esc(p.name)}</b>${p.price ? ` <span class="pp">${esc(p.price)}${p.period ? ' / ' + esc(p.period) : ''}</span>` : ''}${p.desc ? `<div class="muted small">${esc(p.desc)}</div>` : ''}</li>`).join('');
    const pay = o.showPay ? `${B.PAY.url ? `<a class="btn primary" id="payGo" href="${esc(B.PAY.url)}" target="_blank" rel="noopener">去购买</a>` : ''}${B.PAY.contact ? `<p id="payContact">购买 / 续费：${esc(B.PAY.contact)}</p>` : ''}` : '<p class="muted small" id="payTbd">在线付款尚未开通。价格可以先看，付款由管理员登记后发放授权。</p>';
    return `<ul class="prices">${rows}</ul>${pay}<p class="muted small">${esc(B.PAY.note)}</p><div class="row gap wrap"><a class="btn" href="#/pay" id="toPay">价格与优惠码</a><a class="btn" href="#/invite" id="toInvite">好友推荐</a></div>`;
  }
  const reg = region || Pay.suggestRegion() || 'CN';
  const row = PT.rowOf(PT.DEFAULT_PRICES, reg);
  const rows = `<li class="price" data-plan="year" id="priceYear"><b>年付</b> <span class="pp" id="ppYear">${esc(PT.displayPrice(row, 'year'))}</span></li><li class="price" data-plan="month" id="priceMonth"><b>月付</b> <span class="pp" id="ppMonth">${esc(PT.displayPrice(row, 'month'))}</span></li>`;
  const noWeb = Pay.blockWebPay(reg);
  const pay = noWeb ? '<p class="warn small" id="iosCnNote">中国大陆的 iOS 请在 App Store 内购买。应用内购买尚未开通，这里不会引导你去网页付款。</p>'
    : (o.showPay ? `${B.PAY.url ? `<a class="btn primary" id="payGo" href="${esc(B.PAY.url)}" target="_blank" rel="noopener">去购买</a>` : ''}${B.PAY.contact ? `<p id="payContact">购买 / 续费：${esc(B.PAY.contact)}</p>` : ''}` : '<p class="muted small" id="payTbd">在线付款尚未开通（苹果 / Google Play / Stripe 都还没办）。价格可以先看，付款由管理员登记后发放授权。</p>');
  return `<p class="muted small" id="regionNote">价格按商店地区显示，不按 IP 区分。当前：${esc(row.name)}</p><ul class="prices">${rows}</ul>${pay}<p class="muted small">${esc(B.PAY.note)}</p><div class="row gap wrap"><a class="btn" href="#/pay" id="toPay">价格与优惠码</a><a class="btn" href="#/invite" id="toInvite">好友推荐</a></div>`;
}
const codeForm = o => o.showCode ? `<label class="lbl" for="licCode">激活码</label><textarea id="licCode" rows="3" placeholder="ZZX1-…（整段粘贴，空格和横线没关系）" autocomplete="off" autocapitalize="characters" spellcheck="false"></textarea>
  <div class="row gap"><button class="btn primary" id="licGo">激活</button><span class="muted small" id="licMsg" role="status"></span></div>` : '';
function wireCode(box, after) {
  const go = $('#licGo', box); if (!go) return;
  go.onclick = async () => {
    const msg = $('#licMsg', box); go.disabled = true; msg.textContent = '验证中…';
    try { const r = await L.activate($('#licCode', box).value); msg.textContent = ''; toast(`激活成功：${r.planName}，${r.forever ? '永久有效' : '到 ' + r.expires}`, 4000); after(r); }
    catch (e) { msg.textContent = e.message; msg.classList.add('warn'); if (e.saved) after(); }
    finally { go.disabled = false; }
  };
}
/** 试用用完 / 到期时的页面 */
export async function render(root, args = [], params = {}) {
  const g = await L.info();
  const [mats, cards, revs] = await Promise.all([db.materials.all(), db.cards.all(), db.reviews.all()]);
  const id = params.id || '', back = params.from ? decodeURIComponent(params.from) : '';
  const title = g.licensed ? '已激活，可以继续学习' : g.ls.state === 'expired' ? '会员已到期' : g.locked ? '免费试用次数已用完' : '会员与激活';
  root.innerHTML = `<header class="top"><h1>${title}</h1><span class="muted">${statusLine(g)}</span></header>
  ${tagline(g)}
  ${g.locked ? `<section class="card warnbox" id="lockBox"><p><b>需要激活后才能继续学习</b>（复习、测验、练习、学课文）。</p><p class="small">${esc(ONE)}</p></section>` : g.licensed && back ? `<a class="btn primary big" id="licBack" href="${esc(back)}">继续学习</a>` : ''}
  <section class="card" id="keepBox"><h2>你的数据都在，不会丢</h2>
    <p>材料 ${mats.filter(m => !m.sample).length} 份 · 生词卡 ${cards.length} 张 · 作答记录 ${revs.length} 条</p>
    <p class="muted small">不激活也可以随时查看和导出：</p>
    <div class="row gap wrap"><a class="btn" href="#/library" id="toLib">📚 材料库</a><a class="btn" href="#/vocab" id="toVoc">📊 词汇统计</a>${id ? `<a class="btn" id="toBi" href="#/bilingual/${encodeURIComponent(id)}">📑 查看这份材料（双语对照，可导出）</a>` : ''}<button class="btn" id="licExp">导出全部数据（JSON 备份）</button></div></section>
  ${g.offer.showCode || g.offer.showPrices ? `<section class="card" id="buyBox"><h2>激活 / 续费</h2>${pricesHtml(g.offer)}${codeForm(g.offer)}</section>` : ''}`;
  $('#licExp', root).onclick = async () => { await download(`自主学备份_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await db.exportAll(), null, 1)); toast('已导出（不含 AI 密钥）'); };
  wireCode(root, () => render(root, args, params));
}
/** 「我的」页卡片 */
export async function mountCard(box) {
  const g = await L.info();
  const has = g.lic?.ok;
  box.innerHTML = `<h2>💳 会员与激活 <span class="tag ${g.licensed ? 'okt' : ''}" id="licTag">${g.licensed ? '已激活' : g.offer.enforce ? '试用' : '免费'}</span></h2>
  ${tagline(g)}<p id="licSt">${statusLine(g)}</p>
  ${g.back ? '<p class="warn small" id="licBackClock">⚠️ 这台设备的日期好像被调早了。会员到期和试用按见过的最新日期算；把日期改回正确的就好。</p>' : ''}
  ${g.ls.state === 'expiring' ? `<p class="warn" id="licRenew">会员${fmtLeft(g.ls.daysLeft)}，记得续费（续费后粘贴新激活码）。</p>` : ''}
  ${has ? `<p class="muted small" id="licCur">当前激活码：#${g.lic.serial} · ${esc(g.lic.planName)} <button class="mini" id="licDel">移除</button></p>` : ''}
  ${g.server ? `<p class="muted small" id="licSrv">同步服务器：${g.server.devices ? `设备 ${g.server.devices.length} / ${g.server.maxDevices} 台` : ''}${g.server.trial ? ` · 服务器记录试用 ${g.server.trial.used} 次` : ''}</p>` : ''}
  ${(g.offer.showCode || g.offer.showPrices) && !(g.licensed && g.ls.state === 'active') ? pricesHtml(g.offer) : ''}${codeForm(g.offer)}
  <details class="help"><summary>说明：${g.offer.enforce ? '试用怎么算、' : ''}数据会不会丢</summary><div class="helpb small">${g.offer.enforce ? `<p>免费试用 ${B.TRIAL_USES} 次学习。${esc(ONE)}</p>` : ''}${g.offer.enforce ? `<p>试用用完、或会员到期后：材料、生词卡、记录都还在，可以查看和导出备份，只是不能继续复习、测验、练习和学课文。</p>` : '<p>现在所有功能都免费用。材料、生词卡、记录都存在这台设备上，随时可以导出备份。</p>'}<p>激活码在这台设备上离线验证，不需要联网、不上传任何东西。换设备时重新粘贴同一个激活码即可（导出的备份里也带着它）。</p></div></details>`;
  wireCode(box, () => mountCard(box));
  const del = $('#licDel', box); if (del) del.onclick = async () => { await L.removeCode(); toast('已移除激活码'); mountCard(box); };
}
/** 首页提醒条（没什么要说的时候不显示） */
export async function mountBanner(box) {
  const g = await L.info(); let h = '';
  if (g.locked) h = `<div class="card warnbox licban" id="licBan"><b>${g.ls.state === 'expired' ? '会员已到期' : '免费试用次数已用完'}</b><p class="small">${esc(B.TRIAL_TAGLINE)}。材料和记录都在，可以查看、导出；激活后继续学习。</p><a class="btn primary" href="#/unlock" id="licBanGo">${g.offer.showCode ? '输入激活码 / 了解价格' : '了解详情'}</a></div>`;
  else if (g.ls.state === 'expiring') h = `<div class="card warnbox licban" id="licBan"><b>会员${fmtLeft(g.ls.daysLeft)}（${g.lic.expires} 到期）</b><p class="small">${g.offer.enforce ? '记得续费，到期后不能继续学习（数据不会丢）。' : '记得续费。'}</p><a class="btn" href="#/me" id="licBanGo">去续费</a></div>`;
  else if (g.enforce && !g.licensed) h = `<div class="card licban${g.low ? ' warnbox' : ''}" id="licBan"><b id="licTagline">${esc(B.TRIAL_TAGLINE)}</b><p class="small" id="licLeft">${g.inSession ? `正在学第 ${g.used} 次，` : ''}还剩 <b>${g.remaining}</b> 次${g.low ? '，用完后需要激活才能继续学习' : ''}</p><a class="mini" href="#/unlock" id="licBanGo">了解激活</a></div>`;
  else if (g.back) h = '<div class="card warnbox licban" id="licBan"><b>⚠️ 设备日期好像被调早了</b><p class="small">请把日期改回正确的。</p></div>';
  box.innerHTML = h;
}
