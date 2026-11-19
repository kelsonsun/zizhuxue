// v1.7 词汇量统计：生词本掌握情况、你材料里的词按词频分级（和你收藏的对照）、学过的词再次遇到、最近 14 天练习。只用本机数据，不估算“总词汇量”。
import * as db from '../db.js';
import * as dict from '../dict.js';
import * as V from '../vocab.js';
import * as K from '../streak.js';
import { dayNumber } from '../sm2.js';
import { settings, CARD_TYPE } from '../state.js';
import { esc } from '../ui.js';

export async function render(root) {
  root.innerHTML = '<header class="top"><h1>词汇量统计</h1></header><p class="muted">统计中…</p>';
  await dict.ready().catch(() => { });
  const [cards, mats, reviews, log] = await Promise.all([db.cards.all(), db.materials.all(), db.reviews.all(), db.meta.get('dailyLog', {})]);
  const today = dayNumber(); const own = mats.filter(m => m.kind !== 'book');
  const v = V.vocabStats({ cards, mats: own, reviews, today, lemmaOf: dict.lemmaSync, rankOf: dict.rankSync });
  const k = (await (await import('../progress.js')).streakNow()).info;
  const maxD = Math.max(1, ...v.days.map(d => d.n)); const c = v.cards;
  const pc = (a, b) => b ? Math.round(100 * a / b) : 0;
  root.innerHTML = `<header class="top"><h1>词汇量统计</h1><span class="muted">只用这台设备上的数据</span></header>
    <section class="card vstat"><h2>生词本</h2>
      <div class="vnums"><div><b id="vTotal">${c.total}</b><span>生词 / 短语</span></div><div class="k"><b id="vKnown">${c.known}</b><span>已掌握</span></div><div class="l"><b>${c.learning}</b><span>学习中</span></div><div class="n"><b>${c.new}</b><span>新卡</span></div></div>
      ${c.total ? `<div class="sbar" aria-label="掌握情况"><i class="k" style="width:${pc(c.known, c.total)}%"></i><i class="l" style="width:${pc(c.learning, c.total)}%"></i></div>` : ''}
      <p class="muted small">已掌握 = 标为熟练，或复习间隔已到 21 天以上；学习中 = 复习过但间隔还短。另有句子卡 ${c.byType.sentence || 0} 张。${Object.entries(c.byType).filter(([t]) => t !== 'sentence').map(([t, n]) => `${CARD_TYPE[t] || t} ${n}`).join(' · ')}</p></section>
    <section class="card vstat"><h2>你的材料里的词</h2>
      <p>共 <b id="vWords">${v.mats.words}</b> 个不同的词（按原形算，${v.mats.tokens} 个词次）。最常用 3000 词占全部词次的 <b>${v.mats.coverage3000}%</b>。</p>
      <table class="vtab"><thead><tr><th>词频分级</th><th>出现的词</th><th>已收藏</th></tr></thead><tbody>
        ${v.mats.bands.map(b => `<tr><td>${b.label}</td><td>${b.n}</td><td>${b.mine}${b.n ? `<i class="mini-bar"><b style="width:${pc(b.mine, b.n)}%"></b></i>` : ''}</td></tr>`).join('')}
        <tr><td>词典外（人名、拼写等）</td><td>${v.mats.outside}</td><td>—</td></tr></tbody></table>
      <p class="muted small">词频来自离线词典 ECDICT 的排序。这里统计的是“你的材料里出现过多少词”，不是你掌握了多少词，也不是词汇量测试。</p></section>
    <section class="card vstat"><h2>学过的词再次遇到</h2>
      <p>学过的生词在收藏它的那句以外又出现了 <b id="vAgain">${v.again.total}</b> 次（在课文里会自动高亮）。</p>
      ${v.again.top.length ? `<div class="chips">${v.again.top.map(x => `<span class="chip">${esc(x.term)} <b>×${x.n}</b></span>`).join('')}</div>` : '<p class="muted small">还没有：多导入几段材料，学过的词就会在新内容里再次出现。</p>'}</section>
    <section class="card vstat"><h2>练习</h2>
      <p>连续打卡 <b>${k.streak}</b> 天 · 最长 ${k.best} 天 · 累计打卡 ${k.total} 天${v.acc30 != null ? ` · 近 30 天答对率 <b>${v.acc30}%</b>（${v.n30} 题）` : ''}</p>
      <div class="bars" aria-label="最近 14 天每天作答题数">${v.days.map(d => `<div class="bcol ${d.day === today ? 'today' : ''}" title="${d.n} 题，答对 ${d.ok}"><i style="height:${Math.round(100 * d.n / maxD)}%"></i><span>${d.n || ''}</span></div>`).join('')}</div>
      <p class="muted small">最近 14 天每天作答题数（复习 + 测验），最右边是今天。</p></section>`;
}
