// v1.10 价格与付款页（#/pay）：按商店地区显示年付/月付，可填优惠码看 8 折价。在线付款未开通时如实说明。
import { $, esc, toast } from '../ui.js';
import * as P from '../pricetable.js';
import * as Pay from '../pay.js';
import * as L from '../license.js';

const opts = (prices, cur) => prices.map(r => `<option value="${esc(r.region)}"${r.region === cur ? ' selected' : ''}>${esc(r.name)}（${esc(r.currency)}）</option>`).join('');

export function iosCnNote(region) {
  return Pay.blockWebPay(region) ? '<p class="warn small" id="iosCnNote">中国大陆的 iOS 请在 App Store 内购买。应用内购买尚未开通，这里不会引导你去网页付款。</p>' : '';
}

export async function render(root) {
  const cat = await Pay.catalog();
  const prices = cat.prices || P.DEFAULT_PRICES;
  let region = Pay.suggestRegion() || 'CN';
  if (!prices.some(r => r.region === region)) region = 'OTHER';
  Pay.setRegion(region);
  const paint = async () => {
    const row = P.rowOf(prices, region);
    let qte = { list: P.displayPrice(row, period), pay: P.displayPrice(row, period), percent: 0, listCents: P.periodCents(row, period), payCents: P.periodCents(row, period) };
    const coupon = ($('#coup', root)?.value || '').trim();
    if (coupon) {
      try { qte = await Pay.quote(period, region, coupon); $('#qmsg', root).textContent = qte.percent ? `已按优惠码打 ${P.zheLabel(qte.percent)}（不与其他优惠叠加）` : ''; $('#qmsg', root).className = 'ok small'; }
      catch (e) { $('#qmsg', root).textContent = e.message; $('#qmsg', root).className = 'warn small'; }
    } else if ($('#qmsg', root)) { $('#qmsg', root).textContent = ''; }
    const y = P.displayPrice(row, 'year'), m = P.displayPrice(row, 'month');
    $('#ppYear', root).textContent = y; $('#ppMonth', root).textContent = m;
    $('#curPay', root).textContent = period === 'year' ? (qte.percent ? `${qte.list} → ${qte.pay}` : y) : (qte.percent ? `${qte.list} → ${qte.pay}` : m);
    $('#taxNote', root).textContent = row.storeTax ? '该地区商店标价通常含税。' : '';
    const n = $('#iosCnNote', root); if (n) n.outerHTML = iosCnNote(region);
  };
  let period = 'year';
  const r0 = P.rowOf(prices, region);
  root.innerHTML = `<header class="top"><h1>价格与会员</h1><a class="muted" href="#/me">返回我的</a></header>
  <section class="card" id="priceBox">
    <h2>订阅价格</h2>
    <p class="muted small" id="regionNote">价格按你的应用商店地区或你在这里选择的地区显示，<b>不按 IP、不按手机号</b>区分。</p>
    <label class="lbl" for="storeRegion">商店地区</label>
    <select id="storeRegion">${opts(prices, region)}</select>
    <ul class="prices">
      <li class="price ${period === 'year' ? 'on' : ''}" id="pickYear" data-plan="year"><b>年付</b> <span class="pp" id="ppYear">${esc(P.displayPrice(r0, 'year'))}</span></li>
      <li class="price ${period === 'month' ? 'on' : ''}" id="pickMonth" data-plan="month"><b>月付</b> <span class="pp" id="ppMonth">${esc(P.displayPrice(r0, 'month'))}</span></li>
    </ul>
    <p class="muted small" id="taxNote">${r0.storeTax ? '该地区商店标价通常含税。' : ''}</p>
    ${iosCnNote(region)}
    <label class="lbl" for="coup">优惠码（选填）</label>
    <input id="coup" type="text" inputmode="text" placeholder="ZZXC-……" autocomplete="off" autocapitalize="characters">
    <div class="row gap"><button class="btn" id="qGo">查看折后价</button><span id="qmsg" class="muted small" role="status"></span></div>
    <p id="curLine">应付：<b id="curPay">${esc(P.displayPrice(r0, 'year'))}</b></p>
    ${cat.enabled ? '' : '<p class="muted small" id="billOff">付费与推荐总开关尚未打开（所有学习功能仍免费）。打开后才能邀请、核销优惠码和登记付款。</p>'}
    <p class="muted small" id="payTbd">${esc(cat.notes?.pay || '在线付款尚未开通（苹果 / Google Play / Stripe 都还没办）。管理员可在看板手工登记付款后发放授权。')}</p>
    <div class="row gap wrap"><button class="btn primary" id="odGo">生成订单（不扣款）</button><a class="btn" href="#/invite" id="toInvite">好友推荐 / 邀请码</a></div>
    <p id="odMsg" class="muted small" role="status"></p>
  </section>`;
  const syncPick = () => { $('#pickYear', root).classList.toggle('on', period === 'year'); $('#pickMonth', root).classList.toggle('on', period === 'month'); };
  $('#storeRegion', root).onchange = () => { region = $('#storeRegion', root).value; Pay.setRegion(region); paint(); };
  $('#pickYear', root).onclick = () => { period = 'year'; syncPick(); paint(); };
  $('#pickMonth', root).onclick = () => { period = 'month'; syncPick(); paint(); };
  $('#qGo', root).onclick = () => paint();
  $('#odGo', root).onclick = async () => {
    const msg = $('#odMsg', root);
    if (Pay.blockWebPay(region)) { msg.textContent = '中国大陆的 iOS 不会在 App 里引导去网页付款。'; msg.className = 'warn small'; return; }
    try {
      const j = await Pay.placeOrder(period, region, $('#coup', root).value.trim());
      msg.textContent = `已生成订单 ${j.orderId}，应付 ${j.pay}（原价 ${j.list}${j.percent ? '，已打 ' + P.zheLabel(j.percent) : ''}）。${j.payMessage || ''}`;
      msg.className = 'ok small';
    } catch (e) { msg.textContent = e.message; msg.className = 'warn small'; }
  };
}

export async function mountRefCard(box) {
  if (!box) return;
  // 没有付费登录时不向服务器发请求，避免未绑定用户被当成“同步请求”，也不影响免费使用。
  let cat = { enabled: false, rules: { firstWeekCheckins: 3, firstWeekDays: 7, checkinGoal: 10 } };
  let me = null;
  if (Pay.token()) {
    try { cat = await Pay.catalog(); } catch { }
    try { me = await Pay.me(); } catch { Pay.setToken(''); me = null; }
  }
  const inv = me?.invites?.[0]?.code;
  box.innerHTML = `<h2>🎁 好友推荐</h2>
    <p class="muted small">自己注册没有优惠。好友通过你的邀请链接或邀请码注册，完成手机验证并完成首周打卡后，系统会给他一张 8 折优惠码；他用这张码付款，你们各享 8 折。他付款满 30 天且未退款，你的 8 折才会发放。不限邀请人数，优惠不叠加，每次续费最多一张 8 折券。组队优惠暂不做。</p>
    ${cat.enabled ? '' : '<p class="muted small" id="refOff">推荐功能尚未开放（可在管理看板打开总开关）。</p>'}
    ${me ? `<p id="refMe">你已验证手机（${esc(me.phoneTail)}）${me.valid ? ' · 有效注册' : me.invitedBy ? ` · 首周打卡 ${me.checkins} 天` : ' · 自己注册无优惠'}</p>
      ${inv ? `<p id="refCode">你的邀请码：<b>${esc(inv)}</b></p><p class="muted small" id="refLink">${esc(Pay.inviteLink(inv))}</p>
        <div class="row gap wrap"><button class="btn primary" id="refCopy">复制邀请链接</button><button class="btn" id="refCopyCode">复制邀请码</button></div>` : ''}
      <p class="muted small" id="refStat">已邀请 ${me.invited} 人，其中有效注册 ${me.invitedValid} 人。</p>
      ${me.coupons?.length ? `<ul id="refCoupons">${me.coupons.map(c => `<li><code>${esc(c.code)}</code> · ${c.kind === 'referral_inviter' ? '邀请人优惠' : '好友优惠'} · ${esc({ issued: '可使用', granted: '已发放', pending: '待发放（满 30 天）', redeemed: '已使用', cancelled: '已取消', revoked: '已作废', clawback: '退款收回' }[c.status] || c.status)} · ${P.zheLabel(c.percent_off || 20)}</li>`).join('')}</ul>` : ''}` : `<p><a class="btn" href="#/invite" id="refGo">填写邀请码 / 验证手机</a></p>`}
    <p><a class="btn" href="#/pay" id="toPay2">查看价格</a></p>`;
  const copy = async (text, ok) => { try { await navigator.clipboard.writeText(text); toast(ok); } catch { toast('复制失败，请长按手动复制'); } };
  box.querySelector('#refCopy')?.addEventListener('click', () => copy(Pay.inviteLink(inv), '邀请链接已复制'));
  box.querySelector('#refCopyCode')?.addEventListener('click', () => copy(inv, '邀请码已复制'));
}
