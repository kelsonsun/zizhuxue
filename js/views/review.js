import * as db from '../db.js';
import * as tts from '../tts.js';
import { sm2, dailyQueue, dayNumber } from '../sm2.js';
import { settings, CARD_TYPE } from '../state.js';
import { $, esc, toast, hilite } from '../ui.js';

const RATES = [[1, '忘了', 'q1'], [3, '模糊', 'q3'], [4, '记得', 'q4'], [5, '轻松', 'q5']];
const dayLabel = d => d <= 0 ? '今天' : d === 1 ? '明天' : d + '天后';

export async function render(root) {
  const cards = await db.cards.all();
  const queue = dailyQueue(cards, { newLimit: settings.newLimit }).all.slice();
  const total = queue.length; let done = 0; const firstSeen = new Set(); let again = 0;
  if (!total) {
    const nextDue = cards.filter(c => c.sch && c.sch.seen > 0).map(c => c.sch.due).sort((a, b) => a - b)[0];
    root.innerHTML = `<header class="top"><h1>每日复习</h1></header><div class="empty"><div class="big-emoji">🎉</div><p>${cards.length ? '今天没有需要复习的卡片了。' : '还没有卡片可复习。'}</p>
      <p class="muted">${nextDue != null ? `下一批在 ${dayLabel(nextDue - dayNumber())}到期。` : '在材料里点单词收藏，或点 ☆ 收藏句子，就会出现在这里。'}</p><a class="btn primary" href="#/library">去材料库</a></div>`; return;
  }
  let shown = false;
  const frontBack = (c) => {
    if (c.type === 'sentence' || c.type === 'expr') return { front: `<div class="rv-zh">${esc(c.zh) || '听一听，想想意思'}</div><button class="btn" id="say">🔊 听</button>`, back: `<div class="rv-en">${esc(c.term)}</div>${c.note ? `<div class="muted">${esc(c.note)}</div>` : ''}` };
    return { front: `<div class="rv-term">${esc(c.term)}</div>${c.phonetic ? `<div class="muted">/${esc(c.phonetic)/**/}/</div>` : ''}<button class="btn" id="say">🔊 听</button>${c.sentence?.en ? `<div class="rv-sent">${hilite(c.sentence.en, c.term)}</div>` : ''}`, back: `<div class="rv-zh">${esc(c.zh) || '<span class="warn">（释义为空，可在生词本补充）</span>'}</div>${c.sentence?.zh ? `<div class="muted">${esc(c.sentence.zh)}</div>` : ''}` };
  };
  const draw = () => {
    if (!queue.length) return finish();
    const c = queue[0], fb = frontBack(c);
    root.innerHTML = `<header class="top"><h1>每日复习</h1><span class="muted">${done}/${total} · 剩 ${queue.length}</span></header>
      <div class="bar"><i style="width:${Math.round(100 * done / total)}%"></i></div>
      <section class="rvcard"><span class="tag">${CARD_TYPE[c.type]}${c.sch.seen ? '' : ' · 新'}</span>${fb.front}
      <div class="rv-back ${shown ? '' : 'hide'}">${fb.back}</div></section>
      ${shown ? `<div class="rates4">${RATES.map(([q, t, cls]) => `<button class="btn ${cls}" data-q="${q}"><b>${t}</b><small>${dayLabel(sm2(c.sch, q).interval)}</small></button>`).join('')}</div>`
        : '<button class="btn primary big" id="show">显示答案</button>'}`;
    $('#say', root)?.addEventListener('click', () => tts.speak(c.term, { rate: settings.rate }).catch(e => toast(e.message)));
    $('#show', root)?.addEventListener('click', () => { shown = true; draw(); });
    root.querySelectorAll('[data-q]').forEach(b => b.onclick = async () => {
      const q = +b.dataset.q; const first = !firstSeen.has(c.id);
      if (first) {   // SM-2 只在每张卡当天第一次评分时更新；同一轮里重来的卡不重复更新
        firstSeen.add(c.id); c.sch = sm2(c.sch, q); await db.cards.save(c);
        await db.reviews.add({ cardId: c.id, q, ts: Date.now(), day: dayNumber() });
      }
      queue.shift();
      if (q < 3) { again++; queue.push(c); } else done++;
      if (q < 3 && first) { /* 遗忘：已按 SM-2 重置为明天，但本轮仍会再出现，直到记住 */ }
      shown = false; draw();
    });
  };
  const finish = () => { root.innerHTML = `<header class="top"><h1>每日复习</h1></header><div class="empty"><div class="big-emoji">🎉</div><p><b>今天的复习完成了！</b></p><p class="muted">复习 ${total} 张，其中 ${again} 次需要重来。按 SM-2 间隔，明天起会在合适的时间再次出现。</p><a class="btn primary" href="#/">回首页</a></div>`; };
  draw();
}
