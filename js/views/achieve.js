// v1.7 成就页：累计星星 / 钻石、等级、徽章（里程碑 + 学习成就）、冰块（钻石兑换）、最近获得记录、奖励规则（防刷）。
import * as db from '../db.js';
import * as P from '../progress.js';
import * as R from '../rewards.js';
import { $, esc, toast, confirmDlg } from '../ui.js';

export async function render(root) {
  const [{ info, freeze }, w, cards, mats, revs] = await Promise.all([P.streakNow(), P.getWallet(), db.cards.all(), db.materials.all(), db.reviews.all()]);
  const L = R.levelInfo(w.stars); const answers = revs.filter(r => r.mode !== 'undo' && r.choice !== 'restore').length;
  const B = R.badgeList({ wallet: w, best: info.best, answers, mats: mats.filter(m => !m.sample && m.kind !== 'book').length, cards: cards.length });
  const msBest = [...(w.badges || [])].pop(); const canBuy = w.diamonds >= R.FREEZE_COST && freeze.freezes < R.FREEZE_MAX;
  root.innerHTML = `<header class="top"><h1>成就</h1><span class="muted">星星、钻石、等级、徽章</span></header>
    <section class="card achtop"><div class="achnums"><div><b id="aStars">${w.stars}</b><span>⭐ 星星</span></div><div><b id="aDia">${w.diamonds}</b><span>💎 钻石</span></div><div><b id="aStreak">${info.streak}</b><span>🔥 连续天数</span></div><div><b id="aFrz">${freeze.freezes}</b><span>🧊 冰块</span></div></div>
      <div class="achlv"><b id="aLv">Lv.${L.lv} ${esc(L.name)}</b><span class="muted small">${L.next == null ? '已是最高等级' : `再得 ${L.toNext} ⭐ 升到 Lv.${L.lv + 1}`}</span></div>
      <div class="gbar" role="progressbar" aria-valuenow="${L.pct}" aria-valuemin="0" aria-valuemax="100" aria-label="等级进度"><i style="width:${L.pct}%"></i></div>
      <p class="muted small">最长连续 ${info.best} 天 · 累计打卡 ${info.total} 天${info.frozenN ? ` · 用冰块保住 ${info.frozenN} 天` : ''}${msBest ? ` · 最高里程碑 ${msBest} 天` : ''}</p></section>
    <section class="card"><h2>🧊 连胜冻结</h2>
      <p>断一天时自动用掉 1 个冰块保住连续天数（日历上那天显示 🧊）。新用户送 ${R.FREEZE_START} 个，最多存 ${R.FREEZE_MAX} 个；之后用 ${R.FREEZE_COST} 💎 换 1 个。</p>
      <button class="btn primary" id="buyFrz" ${canBuy ? '' : 'disabled'}>用 ${R.FREEZE_COST} 💎 换 1 个冰块</button>
      <span class="muted small" id="buyMsg">${freeze.freezes >= R.FREEZE_MAX ? '已经存满了。' : w.diamonds < R.FREEZE_COST ? `还差 ${R.FREEZE_COST - w.diamonds} 💎。` : ''}</span></section>
    <section class="card"><h2>徽章 <span class="muted small">${B.filter(b => b.got).length} / ${B.length}</span></h2>
      <div class="badges">${B.map(b => `<div class="badge ${b.got ? 'got' : ''}" data-b="${b.id}"><i>${b.icon}</i><b>${esc(b.name)}</b><span>${esc(b.sub)}</span></div>`).join('')}</div></section>
    <section class="card"><h2>最近获得</h2>${(w.hist || []).length ? `<div class="list" id="aHist">${w.hist.slice(0, 15).map(h => `<div class="item hrow"><span class="grow">${esc(h.t)}</span><b>${h.s ? `+${h.s} ⭐ ` : ''}${h.d ? `${h.d > 0 ? '+' : ''}${h.d} 💎` : ''}</b></div>`).join('')}</div>` : '<p class="muted">还没有记录。</p>'}</section>
    <section class="card"><details class="help sec" id="hRules"><summary><h2>怎么得星星和钻石</h2></summary><ul class="small">
      <li>每天第一次打开：+5 ⭐（每天只给一次）</li><li>当天达到每日目标：+20 ⭐ +2 💎（每天一次）</li>
      <li>做完一组复习 / 测验 / 练习：+5 ⭐ 加每答对一题 +1 ⭐（最多 30），+1 💎，答对 80% 以上 +2 💎；至少 3 题才算，每天最多 8 组</li>
      <li>学完一段：+10 ⭐ +1 💎（每段只给一次，每天最多 10 段）；学完一句：+1 ⭐（每句一次，每天最多 30 句）</li>
      <li>导入一份新材料：+10 ⭐ +1 💎（每份一次，每天最多 3 份）</li><li>连续打卡里程碑（3、7、10、20、30、50、60、70、100 天，之后每 50 天）：星星 = 天数，另加 5–20 💎</li>
      <li>星星和钻石只存在这台设备上；数字只用来激励，不能换钱。</li></ul></details></section>`;
  $('#buyFrz', root).onclick = async () => {
    if (!(await confirmDlg(`用 ${R.FREEZE_COST} 💎 换 1 个冰块？`, { ok: '兑换' }))) return;
    try { await P.buyFreeze(); toast('已兑换 1 个冰块 🧊'); render(root); } catch (e) { toast(e.message); }
  };
}
