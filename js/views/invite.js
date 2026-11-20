// v1.10 邀请落地页（#/invite?c=ZZXF-…）：填写邀请码、手机验证。短信未开通时如实说明。
import { $, esc, toast, go } from '../ui.js';
import * as Pay from '../pay.js';

export async function render(root) {
  const qs = new URLSearchParams((location.hash.split('?')[1] || '').replace(/#.*$/, ''));
  const pre = (qs.get('c') || qs.get('code') || Pay.pendingInvite() || '').toUpperCase();
  if (pre) Pay.setPendingInvite(pre);
  const cat = await Pay.catalog();
  let invHint = '';
  if (pre) { try { const j = await Pay.peekInvite(pre); invHint = `邀请码 ${j.code} 有效（来自 ${j.inviterTail}）`; } catch (e) { invHint = e.message || '邀请码无效'; } }
  const smsOff = cat.sms === 'off' || !cat.enabled;
  root.innerHTML = `<header class="top"><h1>好友邀请</h1><a class="muted" href="#/me">返回我的</a></header>
  <section class="card" id="invBox">
    <p class="muted small">通过邀请链接或邀请码注册，完成手机验证，并在首周内打卡 ${cat.rules?.firstWeekCheckins || 3} 天（窗口 ${cat.rules?.firstWeekDays || 7} 天，每天达到 ${cat.rules?.checkinGoal || 10} 次作答才算打卡，冰块不算），才算有效注册。之后会为你生成 8 折优惠码。自己注册没有优惠。</p>
    ${cat.enabled ? '' : '<p class="warn small" id="invOff">推荐功能尚未开放。</p>'}
    <label class="lbl" for="invCode">邀请码（没有可以留空）</label>
    <input id="invCode" type="text" value="${esc(pre)}" placeholder="ZZXF-……" autocomplete="off" autocapitalize="characters">
    <p id="invHint" class="muted small">${esc(invHint)}</p>
    <label class="lbl" for="invPhone">手机号</label>
    <input id="invPhone" type="tel" placeholder="11 位或 + 区号" autocomplete="tel">
    <div class="row gap"><button class="btn primary" id="invSend">获取验证码</button><span id="invSendMsg" class="muted small" role="status"></span></div>
    <label class="lbl" for="invOtp">验证码</label>
    <input id="invOtp" type="text" inputmode="numeric" maxlength="8" placeholder="6 位数字" autocomplete="one-time-code">
    <div class="row gap"><button class="btn primary" id="invGo">验证并继续</button><span id="invMsg" class="muted small" role="status"></span></div>
    <p class="muted small" id="smsNote">${smsOff ? '短信验证尚未开通，不能发送真实验证码。开通前不会向任何短信服务注册或付费。测试环境可把短信通道设为 console（验证码只写在服务器日志里）。' : (cat.sms === 'console' ? '当前是模拟短信：验证码写在服务器日志，不会真的发到手机上。' : '')}</p>
  </section>`;
  $('#invCode', root).onchange = () => { Pay.setPendingInvite($('#invCode', root).value); };
  $('#invSend', root).onclick = async () => {
    const msg = $('#invSendMsg', root); msg.textContent = '发送中…';
    Pay.setPendingInvite($('#invCode', root).value);
    try { const j = await Pay.sendPhone($('#invPhone', root).value, $('#invCode', root).value); msg.textContent = j.message || '已发送'; msg.className = 'ok small'; }
    catch (e) { msg.textContent = e.message; msg.className = 'warn small'; }
  };
  $('#invGo', root).onclick = async () => {
    const msg = $('#invMsg', root); msg.textContent = '验证中…';
    try {
      const j = await Pay.verifyPhone($('#invPhone', root).value, $('#invOtp', root).value, $('#invCode', root).value, Pay.todayLocal());
      msg.textContent = j.me?.valid ? '验证成功，已是有效注册。' : (j.me?.invitedBy ? '验证成功。请完成首周打卡后生成优惠码。' : '验证成功。自己注册没有优惠，你仍可以邀请好友。');
      msg.className = 'ok small';
      toast(msg.textContent);
      setTimeout(() => go('#/me'), 600);
    } catch (e) { msg.textContent = e.message; msg.className = 'warn small'; }
  };
}
