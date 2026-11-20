// v1.7 首页“今日打卡”：连续天数、每日目标进度、最近 7 天，以及从你自己的材料里挑的“每日一句”。
import * as db from '../db.js';
import * as tts from '../tts.js';
import * as K from '../streak.js';
import * as P from '../progress.js';
import * as RW from '../rewards.js';
import { dayNumber } from '../sm2.js';
import { settings, saveSettings, makeCard } from '../state.js';
import { $, $$, esc, toast } from '../ui.js';

const WD = ['日', '一', '二', '三', '四', '五', '六'];
const wdOf = day => WD[new Date(day * 86400000).getUTCDay()];
export const dailyLog = () => db.meta.get('dailyLog', {});
/** 所有可选的句子（按材料、句序），带标题和是否示例 */
export function allSents(mats) {
  const out = []; for (const m of mats) { if (m.kind === 'book') continue; (m.sentences || []).forEach((s, i) => out.push({ id: s.id, en: s.en, zh: s.zh || '', t0: s.t0, t1: s.t1, materialId: m.id, title: m.title, idx: i, sample: !!m.sample, audioId: m.audioId || (m.source === 'audio' ? m.id : null) })); }
  return out;
}
/** 今天的每日一句：已定过就沿用（同一天不变），否则从材料里挑一句并记下 */
export async function todaySentence(mats, { change = false } = {}) {
  const today = dayNumber(); const log = await dailyLog(); const sents = allSents(mats); const cur = log[today];
  // 已定的一句沿用；但如果定的是示例材料、而现在有了自己的材料（且还没读完），改从自己的材料挑
  if (cur && !change) { const s = sents.find(x => x.id === cur.id && x.materialId === cur.mid); if (s && (cur.done || !s.sample || !sents.some(x => !x.sample))) return { s, done: !!cur.done }; }
  const recent = Object.entries(log).filter(([d]) => +d > today - 30).map(([, x]) => x.id).concat(cur ? [cur.id] : []);
  const s = K.pickDaily(sents, today + (change ? (cur?.n || 0) + 1 : 0), recent); if (!s) return null;
  log[today] = { id: s.id, mid: s.materialId, done: false, n: change ? (cur?.n || 0) + 1 : 0 }; await db.meta.set('dailyLog', log);
  return { s, done: false };
}

export async function mountDaily(box) {
  let au = null;
  const draw = async (change = false) => {
    const [mats, cards] = await Promise.all([db.materials.all(), db.cards.all()]);
    const ds = await todaySentence(mats, { change });
    const today = dayNumber(); const sn = await P.streakNow(); const info = sn.info; const fr = sn.freeze;
    const [wal, note] = await Promise.all([P.getWallet(), db.meta.get('freezeNote', null)]);
    const rem = RW.reminder(new Date().getHours(), info, today);
    const pct = Math.min(100, Math.round(100 * info.today / info.goal)); const s = ds?.s;
    const starred = s && cards.some(c => c.type === 'sentence' && c.sentenceId === s.id);
    box.innerHTML = `<section class="card daily" id="dailyCard">
      <div class="remind ${rem.tone}" id="remind" data-tone="${rem.tone}">${esc(rem.text)}</div>
      ${note?.day === today && note.used?.length ? `<div class="note small frznote" id="frzNote">🧊 ${note.used.length === 1 ? '昨天' : `有 ${note.used.length} 天`}没打卡，自动用了 ${note.used.length} 个冰块，连续天数保住了！还剩 ${fr.freezes} 个。</div>` : ''}
      <div class="dtop"><div class="streak ${info.streak ? 'on' : ''}"><b id="streakN">${info.streak}</b><span>天连续打卡 🔥</span><span class="frz" id="frzN" title="连胜冻结：断一天时自动用掉一个">🧊×${fr.freezes}</span></div>
        <div class="goal"><div class="muted small">今日目标 <b id="goalTxt">${info.today} / ${info.goal}</b>${info.met ? ' · <b class="okt">已打卡 ✅</b>' : ` · 还差 ${info.left}`}</div>
          <div class="gbar" role="progressbar" aria-valuemin="0" aria-valuemax="${info.goal}" aria-valuenow="${info.today}" aria-label="今日目标进度"><i style="width:${pct}%"></i></div>
          <div class="week" aria-label="最近 7 天">${info.week.map(w => `<span class="wd ${w.met ? 'met' : w.frozen ? 'frozen' : w.n ? 'some' : ''} ${w.day === today ? 'today' : ''}" title="${w.frozen ? '用冰块保住' : w.n + ' 题'}"><i>${w.met ? '✓' : w.frozen ? '🧊' : ''}</i>${w.day === today ? '今' : wdOf(w.day)}</span>`).join('')}</div></div></div>
      <a href="#/achieve" id="toAch" class="walletln">⭐ <b id="wStars">${wal.stars}</b> 星星 · 💎 <b id="wDia">${wal.diamonds}</b> 钻石 · 🏆 成就 ›</a>
      <div class="muted small">每复习 / 测验答一题算 1，完成每日一句算 1；达到目标这天就算打卡。最长连续 ${info.best} 天 · 累计打卡 ${info.total} 天 ·
        目标 ${K.GOALS.map(g => `<button class="chip ${g === info.goal ? 'on' : ''}" data-goal="${g}">${g}</button>`).join('')}</div>
      ${s ? `<div class="dsent" data-sid="${esc(s.id)}"><div class="muted small">📅 每日一句 · 来自你的材料《${esc(s.title)}》${s.sample ? '（示例材料：导入你自己的内容后从那里挑）' : ''}</div>
        <div class="den">${esc(s.en)}</div><div class="dzh ${ds.done ? '' : 'blur'}" id="dzh" title="点一下看中文">${esc(s.zh || '（这句还没有中文）')}</div>
        <div class="row gap wrap"><button class="btn" id="dSay">🔊 听</button><a class="btn" id="dGo" href="#/lesson/${esc(s.materialId)}?lv=sent&si=${s.idx}">去学这句</a>
          <button class="btn ${starred ? 'on' : ''}" id="dStar" ${starred ? 'disabled' : ''}>${starred ? '★ 已收藏' : '☆ 收藏成卡'}</button>
          ${ds.done ? '<span class="tag okt" id="dDone">✅ 今天这句已完成</span>' : '<button class="btn primary" id="dDone">✅ 读完了，打卡 +1</button>'}${ds.done ? '' : '<button class="mini" id="dNext">换一句</button>'}</div></div>`
        : '<div class="note small">导入一段你自己的材料后，这里每天从里面挑一句“每日一句”。</div>'}
    </section>`;
    $$('[data-goal]', box).forEach(b => b.onclick = async () => { await saveSettings({ dailyGoal: +b.dataset.goal }); draw(); });
    if (!s) return;
    $('#dzh', box).onclick = e => e.currentTarget.classList.remove('blur');
    $('#dSay', box).onclick = async () => {
      tts.cancel(); au?.pause();
      if (s.audioId && s.t0 != null && s.t1 != null) {
        const b = await db.blobs.get('audio:' + s.audioId).catch(() => null);
        if (b) { au = new Audio(URL.createObjectURL(b.blob)); au.currentTime = s.t0; try { await au.play(); const fn = () => { if (au.currentTime >= s.t1) { au.pause(); au.removeEventListener('timeupdate', fn); } }; au.addEventListener('timeupdate', fn); return; } catch (e) { /* 放不了原声就朗读 */ } }
      }
      tts.speak(s.en, { rate: settings.rate }).catch(e => toast(e.message));
    };
    $('#dStar', box).onclick = async () => { await db.cards.save(makeCard({ type: 'sentence', term: s.en, zh: s.zh, sentence: { en: s.en, zh: s.zh }, material: s.materialId, sentenceId: s.id, source: 'daily' })); toast('已收藏句子，会进入每日复习'); draw(); };
    $('button#dDone', box)?.addEventListener('click', async () => { if ((await (await import('../license.js')).info()).locked) { location.hash = '#/unlock'; return; } // v1.9 试用用完不能打卡学习
 const log = await dailyLog(); const t = dayNumber(); log[t] = { ...(log[t] || { id: s.id, mid: s.materialId }), done: true }; await db.meta.set('dailyLog', log); toast('每日一句完成，打卡进度 +1'); await draw(); import('../celebrate.js').then(C => C.checkProgress()).then(a => { if (a?.goalGot) draw(); }).catch(() => { }); });
    $('#dNext', box)?.addEventListener('click', () => draw(true));
  };
  onDestroy(() => au?.pause());
  await draw();
  // 别的途径达标（比如另一台设备同步过来）时也补发达标奖 / 里程碑
  import('../celebrate.js').then(C => C.checkProgress()).then(a => { if ((a?.goalGot || a?.milestone) && box.isConnected) draw(); }).catch(() => { });
}
function onDestroy(fn) { addEventListener('hashchange', fn, { once: true }); }
