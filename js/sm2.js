// SuperMemo-2 间隔重复（真 SM-2）。q: 0-5 分；q<3 视为遗忘（重置间隔，EF 不变）。
// 日期以“本地日编号”表示（自 1970-01-01 起的本地天数），保证“每日复习队列”按自然日滚动。
export const MIN_EF = 1.3;

export function dayNumber(ts = Date.now()) {
  const d = new Date(ts);
  return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
}

export function newSchedule(ts = Date.now()) {
  return { ef: 2.5, reps: 0, interval: 0, due: dayNumber(ts), lapses: 0, last: null, seen: 0 };
}

/** 返回新的调度状态（不改动入参）。 */
export function sm2(s, q, ts = Date.now()) {
  if (!(q >= 0 && q <= 5)) throw new RangeError('q must be 0..5');
  const today = dayNumber(ts);
  let { ef, reps, interval, lapses } = { ...newSchedule(ts), ...s };
  if (q < 3) {
    reps = 0; interval = 1; lapses += 1;
  } else {
    reps += 1;
    if (reps === 1) interval = 1;
    else if (reps === 2) interval = 6;
    else interval = Math.round(interval * ef);
    ef = ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    if (ef < MIN_EF) ef = MIN_EF;
  }
  return { ef: Math.round(ef * 1000) / 1000, reps, interval, lapses, due: today + interval, last: today, seen: (s?.seen || 0) + 1 };
}

export const isDue = (card, ts = Date.now()) => (card.sch?.due ?? 0) <= dayNumber(ts);
export const isNew = (card) => !card.sch || card.sch.seen === 0;

/** 每日队列：到期的旧卡（最久未复习优先）+ 限量新卡。 */
export function dailyQueue(cards, { newLimit = 10, ts = Date.now() } = {}) {
  const due = cards.filter(c => !isNew(c) && isDue(c, ts)).sort((a, b) => a.sch.due - b.sch.due);
  const fresh = cards.filter(c => isNew(c)).sort((a, b) => (a.created || 0) - (b.created || 0)).slice(0, newLimit);
  return { due, fresh, all: [...due, ...fresh] };
}
