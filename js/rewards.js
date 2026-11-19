// v1.7 激励系统（纯函数，可单测）：连胜冻结（冰块）、里程碑主题与名言、提醒文案（随时间变语气）、星星 / 钻石奖励（防刷）、等级与徽章。
// ———————————————— 连胜冻结 ————————————————
export const FREEZE_START = 2, FREEZE_MAX = 3, FREEZE_COST = 20; // 新用户送 2 个；最多存 3 个；20 钻石换 1 个
/**
 * 断了的日子自动用冰块补上：找到今天之前最近一个“打卡或已冻结”的日子，它和今天之间没打卡的每一天各用 1 个冰块。
 * 冰块不够补满整段时一个都不用（补不住就不浪费）。st：{freezes, frozen:[day]}；返回 {st, used:[day]}
 */
export function applyFreezes(counts, goal, today, st) {
  const s = { freezes: st?.freezes ?? FREEZE_START, frozen: [...(st?.frozen || [])] }; const fz = new Set(s.frozen);
  const ok = d => (counts.get(d) || 0) >= goal || fz.has(d);
  let d0 = today - 1; const lim = today - 3650; while (d0 > lim && !ok(d0)) d0--;
  if (!ok(d0)) return { st: s, used: [] };
  const miss = []; for (let d = d0 + 1; d < today; d++) miss.push(d);
  if (!miss.length || miss.length > s.freezes) return { st: s, used: [] };
  return { st: { freezes: s.freezes - miss.length, frozen: [...s.frozen, ...miss].slice(-400) }, used: miss };
}
export function buyFreeze(wallet, st) {
  if ((st.freezes ?? 0) >= FREEZE_MAX) throw new Error(`冰块最多存 ${FREEZE_MAX} 个`);
  if ((wallet.diamonds || 0) < FREEZE_COST) throw new Error(`钻石不够：需要 ${FREEZE_COST} 个，现在有 ${wallet.diamonds || 0} 个`);
  return { wallet: { ...wallet, diamonds: wallet.diamonds - FREEZE_COST, hist: [{ t: '兑换 1 个冰块', s: 0, d: -FREEZE_COST }, ...(wallet.hist || [])].slice(0, 50) }, st: { ...st, freezes: st.freezes + 1 } };
}

// ———————————————— 里程碑 ————————————————
export const MILESTONES = [3, 7, 10, 20, 30, 50, 60, 70, 100];
export const isMilestone = n => MILESTONES.includes(n) || (n > 100 && n % 50 === 0);
const MS = {
  3: { badge: '🔥', name: '起步之火', c: ['#ff9a3c', '#ff5e62'], notes: [523, 659, 784], wave: 'triangle', q: ['千里之行，始于足下。', 'A journey of a thousand miles begins with a single step. — 老子'] },
  7: { badge: '🌱', name: '一周坚持', c: ['#5fd068', '#1f8a5c'], notes: [392, 523, 659, 784], wave: 'triangle', q: ['小步走，天天走，就会走很远。', 'Small steps every day add up to big results.'] },
  10: { badge: '⭐', name: '十日之星', c: ['#ffd452', '#f39c12'], notes: [523, 659, 784, 1047], wave: 'square', q: ['熟能生巧。', 'Practice makes perfect.'] },
  20: { badge: '🏅', name: '二十天勋章', c: ['#56ccf2', '#2f80ed'], notes: [440, 554, 659, 880], wave: 'triangle', q: ['不怕慢，就怕停。', 'It does not matter how slowly you go as long as you do not stop. — 孔子'] },
  30: { badge: '🌙', name: '满月', c: ['#8e7cf0', '#4b3ab5'], notes: [392, 494, 587, 784, 988], wave: 'sine', q: ['我们反复做的事造就了我们。卓越不是一时之举，而是一种习惯。', 'We are what we repeatedly do. Excellence, then, is not an act, but a habit. — Will Durant'] },
  50: { badge: '💎', name: '五十钻石', c: ['#43e8d8', '#1a9bb5'], notes: [587, 740, 880, 1175], wave: 'sine', q: ['罗马不是一天建成的。', "Rome wasn't built in a day."] },
  60: { badge: '🚀', name: '两个月起飞', c: ['#ff7eb3', '#c2185b'], notes: [523, 659, 784, 1047, 1319], wave: 'triangle', q: ['成功是日复一日的小小努力累积而成。', 'Success is the sum of small efforts, repeated day in and day out. — Robert Collier'] },
  70: { badge: '🌈', name: '七十彩虹', c: ['#f6d365', '#fda085'], notes: [440, 554, 659, 880, 1109], wave: 'square', q: ['锲而不舍，金石可镂。', 'Keep carving without stopping, and even metal and stone can be engraved. — 荀子'] },
  100: { badge: '👑', name: '百日王冠', c: ['#f7c948', '#b8860b'], notes: [523, 659, 784, 1047, 784, 1047, 1319], wave: 'sawtooth', q: ['滴水穿石。', 'Constant dripping wears away the stone.'] },
};
const MS_MORE = [
  { badge: '🏆', name: '奖杯', c: ['#ffb347', '#ff7f50'], wave: 'triangle', q: ['任何领域的专家，都曾是初学者。', 'The expert in anything was once a beginner. — Helen Hayes'] },
  { badge: '🦁', name: '雄狮', c: ['#e0a96d', '#8b5a2b'], wave: 'square', q: ['一点一点，就能走很远。', 'Little by little, one travels far. — J. R. R. Tolkien'] },
  { badge: '🐉', name: '飞龙', c: ['#ff6b6b', '#8e0e00'], wave: 'sawtooth', q: ['别盯着钟，学它：一直走。', "Don't watch the clock; do what it does. Keep going. — Sam Levenson"] },
  { badge: '🌟', name: '恒星', c: ['#a18cd1', '#5f2c82'], wave: 'sine', q: ['坚持下去，你需要的一切会在最好的时候到来。', 'Keep going. Everything you need will come to you at the perfect time.'] },
];
/** 里程碑主题：{n, badge, name, colors:[c1,c2], notes, wave, zh, en} */
export function milestoneTheme(n) {
  let t = MS[n];
  if (!t) { const k = Math.max(0, Math.floor(n / 50) - 3); const b = MS_MORE[k % MS_MORE.length]; const base = 392 + (k % 5) * 30; t = { ...b, notes: [base, base * 1.25, base * 1.5, base * 2, base * 2.5] }; }
  return { n, badge: t.badge, name: t.name, colors: t.c, notes: t.notes, wave: t.wave, zh: t.q[0], en: t.q[1] };
}
export const milestoneKey = (n, today) => `ms:${n}@${today - n + 1}`; // 同一段连续里每个节点只庆祝一次

// ———————————————— 鼓励语（按这组的成绩） ————————————————
const CHEER = {
  great: [['太棒了！', 'Amazing!'], ['完美发挥！', 'Flawless!'], ['你今天状态真好！', "You're on fire!"]],
  good: [['做得好！', 'Well done!'], ['稳稳进步中！', 'Steady progress!'], ['继续保持！', 'Keep it up!']],
  ok: [['完成就是胜利！', 'Done is better than perfect!'], ['错的地方就是要长进的地方。', 'Mistakes are proof that you are trying.'], ['明天会更好！', 'Tomorrow will be even better!']],
};
export function cheer(pct, seed = 0) { const k = pct == null ? 'good' : pct >= 90 ? 'great' : pct >= 60 ? 'good' : 'ok'; const a = CHEER[k][Math.abs(seed) % CHEER[k].length]; return { tone: k, zh: a[0], en: a[1] }; }

// ———————————————— 提醒文案：语气随时间变 ————————————————
const REMIND = {
  morning: ['早上好！趁脑子最清醒，先学一句吧 ☀️', '新的一天，新的一句英语，开始吧！', '一日之计在于晨，今天的目标等你来拿 💪'],
  day: ['今天的目标还差一点点，抽 5 分钟就够啦！', '午后来一组练习，提提神 🍵', '你已经很棒了，再学几题就打卡！'],
  owl: ['夜猫子你好 🦉 学一句再睡？', '这么晚还在，顺手打个卡吧！'],
  coax: ['人家等你一整天了，来陪我学几题嘛～ 🥺', '今天还没见到你呢，就学一小会儿好不好？', '晚饭吃完了吧？来学两句嘛，就两句～'],
  sad: ['唉……今天还没学，我有点难过 😢', '天都黑透了，你还没来看我……', '我们的连胜在发抖，快来救救它 😣'],
  midnight: ['你把我忘了吗？再不学连胜就没了 💔', '快到午夜了！你把我忘了吗？再不学连胜就没了', '还剩不到一小时……你把我忘了吗？再不学连胜就没了 ⏰'],
};
/** 提醒：hour 0–23。已打卡：庆祝语；没打卡：6–11 早上积极、12–17 白天积极、18–20 撒娇、21–22 沮丧、23 点“你把我忘了吗”、0–5 夜猫子 */
export function reminder(hour, info, seed = 0) {
  if (info?.met) return { tone: 'done', text: info.streak > 1 ? `今天已打卡 ✅ 连续 ${info.streak} 天，明天见！` : '今天已打卡 ✅ 明天见！' };
  const tone = hour >= 23 ? 'midnight' : hour >= 21 ? 'sad' : hour >= 18 ? 'coax' : hour >= 12 ? 'day' : hour >= 6 ? 'morning' : 'owl';
  const a = REMIND[tone]; let text = a[Math.abs(seed) % a.length];
  if (info?.streak && (tone === 'sad' || tone === 'midnight')) text += `（连续 ${info.streak} 天）`;
  return { tone, text };
}
export const REMIND_LIB = REMIND;

// ———————————————— 星星 / 钻石（防刷） ————————————————
// open：每天第一次打开；goal：当天达标；practice：复习 / 测验 / 练习一组（至少 3 题才算，每天最多 8 组）；unit：学完一段（每段只给一次，每天最多 10 段）；
// sent：学完一句（每句只给一次，每天最多 30 句）；import：导入一份新材料（每份一次，每天最多 3 份）；milestone：里程碑（每段连续每个节点一次）
export const RULES = { open: { perDay: 1 }, goal: { perDay: 1 }, practice: { perDay: 8, minN: 3 }, unit: { perDay: 10 }, sent: { perDay: 30 }, import: { perDay: 3 }, milestone: { perDay: 99 } };
export const newWallet = () => ({ stars: 0, diamonds: 0, keys: {}, perDay: {}, hist: [], badges: [] });
export function gain(kind, { n = 0, ok = 0, ms = 0 } = {}) {
  switch (kind) {
    case 'open': return { s: 5, d: 0 };
    case 'goal': return { s: 20, d: 2 };
    case 'practice': return { s: Math.min(30, 5 + ok), d: n && ok / n >= 0.8 ? 2 : 1 };
    case 'unit': return { s: 10, d: 1 };
    case 'sent': return { s: 1, d: 0 };
    case 'import': return { s: 10, d: 1 };
    case 'milestone': return { s: ms, d: ms >= 100 ? 20 : ms >= 30 ? 10 : 5 };
    default: return { s: 0, d: 0 };
  }
}
/** 领奖：key 唯一（同一件事只给一次）+ 每类每天上限 + 练习至少 3 题。返回 {wallet, got:{s,d}, why}（why 说明没给的原因） */
export function award(wallet, { kind, key, day, n = 0, ok = 0, ms = 0, label = '' }) {
  const w = { ...newWallet(), ...wallet, keys: { ...(wallet?.keys || {}) }, perDay: { ...(wallet?.perDay || {}) } };
  const r = RULES[kind]; if (!r) return { wallet: w, got: { s: 0, d: 0 }, why: '未知类型' };
  const k = key || `${kind}:${day}`;
  if (w.keys[k]) return { wallet: w, got: { s: 0, d: 0 }, why: '已经领过' };
  if (r.minN && n < r.minN) return { wallet: w, got: { s: 0, d: 0 }, why: `至少做 ${r.minN} 题才有奖励` };
  const pd = `${day}:${kind}`; if ((w.perDay[pd] || 0) >= r.perDay) return { wallet: w, got: { s: 0, d: 0 }, why: '今天这类奖励已领满' };
  const g = gain(kind, { n, ok, ms });
  w.keys[k] = day; w.perDay = Object.fromEntries(Object.entries(w.perDay).filter(([x]) => +x.split(':')[0] > day - 3)); w.perDay[pd] = (w.perDay[pd] || 0) + 1;
  w.stars += g.s; w.diamonds += g.d; w.hist = [{ t: label || kind, s: g.s, d: g.d, day }, ...(w.hist || [])].slice(0, 50);
  if (kind === 'milestone' && !w.badges.includes(ms)) w.badges = [...w.badges, ms].sort((a, b) => a - b);
  return { wallet: w, got: g, why: '' };
}

// ———————————————— 等级与徽章 ————————————————
const LV = [[0, '新芽'], [50, '小苗'], [150, '学徒'], [300, '探索者'], [500, '行者'], [800, '达人'], [1200, '高手'], [1700, '大师'], [2300, '宗师'], [3000, '传奇']];
export function levelInfo(stars = 0) {
  let i = 0; while (i + 1 < LV.length && stars >= LV[i + 1][0]) i++;
  const lo = LV[i][0], hi = LV[i + 1]?.[0] ?? null;
  return { lv: i + 1, name: LV[i][1], next: hi, toNext: hi == null ? 0 : hi - stars, pct: hi == null ? 100 : Math.round(100 * (stars - lo) / (hi - lo)) };
}
/** 徽章：里程碑（拿到才亮）+ 几个学习成就 */
export function badgeList({ wallet, best = 0, answers = 0, mats = 0, cards = 0 }) {
  const got = new Set(wallet?.badges || []);
  const ms = MILESTONES.map(n => { const t = milestoneTheme(n); return { id: 'ms' + n, icon: t.badge, name: `连续 ${n} 天`, sub: t.name, got: got.has(n) || best >= n }; });
  const extra = [...got].filter(n => n > 100).map(n => { const t = milestoneTheme(n); return { id: 'ms' + n, icon: t.badge, name: `连续 ${n} 天`, sub: t.name, got: true }; });
  return [...ms, ...extra,
    { id: 'imp1', icon: '📥', name: '第一份材料', sub: '导入自己的内容', got: mats >= 1 },
    { id: 'card50', icon: '🗂️', name: '50 张卡', sub: '生词本 50 张', got: cards >= 50 },
    { id: 'ans100', icon: '🎯', name: '答题 100', sub: '累计作答 100 题', got: answers >= 100 },
    { id: 'ans1000', icon: '🧠', name: '答题 1000', sub: '累计作答 1000 题', got: answers >= 1000 },
    { id: 'star1000', icon: '🌟', name: '千星', sub: '累计 1000 颗星', got: (wallet?.stars || 0) >= 1000 }];
}
