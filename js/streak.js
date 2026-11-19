// v1.7 连续打卡 + 每日目标 + 每日一句（纯函数，可单测）。
// 打卡规则：一天里“作答”（复习 / 测验每答一题算 1，含不会、模糊）+ 完成“每日一句”（算 1）达到每日目标，这天就算打卡。
// 连续天数：从今天往回数连续打卡的天；今天还没达标时从昨天往回数（今天还有机会，不算断）。
export const GOALS = [5, 10, 20, 30];
export const DEFAULT_GOAL = 10;

/** 每天的作答数：Map(day → n)。复习日志里撤销 / 恢复记录不算；每日一句完成的那天 +1 */
export function dayCounts(reviews = [], dailyLog = {}) {
  const m = new Map();
  for (const r of reviews) { if (!r || r.day == null || r.mode === 'undo' || r.choice === 'restore') continue; m.set(r.day, (m.get(r.day) || 0) + 1); }
  for (const [d, x] of Object.entries(dailyLog || {})) if (x?.done) m.set(+d, (m.get(+d) || 0) + 1);
  return m;
}
/** 打卡信息：{today, goal, met, left, streak, best, total, frozenN, week:[{day, n, met, frozen}]（最近 7 天，旧→新）}
 *  frozen：用“连胜冻结（冰块）”保住的日子（Set 或数组），算连续，但不算“打卡天数” */
export function streakInfo(counts, today, goal = DEFAULT_GOAL, frozen = []) {
  const g = Math.max(1, +goal || DEFAULT_GOAL); const fz = new Set(frozen); const met = d => (counts.get(d) || 0) >= g; const ok = d => met(d) || fz.has(d);
  const n = counts.get(today) || 0;
  let streak = 0; for (let d = met(today) ? today : today - 1; ok(d); d--) streak++;
  const days = [...counts.keys()].filter(met).sort((a, b) => a - b); const all = [...new Set([...days, ...fz])].filter(d => d <= today).sort((a, b) => a - b);
  let best = 0, run = 0, prev = null; for (const d of all) { run = prev != null && d === prev + 1 ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  const week = Array.from({ length: 7 }, (_, i) => { const d = today - 6 + i; return { day: d, n: counts.get(d) || 0, met: met(d), frozen: !met(d) && fz.has(d) }; });
  return { today: n, goal: g, met: met(today), left: Math.max(0, g - n), streak, best: Math.max(best, streak), total: days.length, frozenN: [...fz].filter(d => d <= today).length, week };
}
const hash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const words = s => (String(s || '').match(/[A-Za-z][A-Za-z'’-]*/g) || []).length;
/**
 * 每日一句：从用户自己的材料里挑（不用示例材料，除非只有示例）；4–30 个词，优先有中文的；同一天结果固定；
 * 最近出现过的（recent，句子 id 列表）尽量不重复。sents：[{id, en, zh, materialId, title, idx}]
 */
export function pickDaily(sents, day, recent = []) {
  const own = sents.filter(s => !s.sample); const base = (own.length ? own : sents).filter(s => s.en && words(s.en) >= 4 && words(s.en) <= 30);
  if (!base.length) return null;
  const withZh = base.filter(s => s.zh && s.zh.trim()); const pool0 = withZh.length ? withZh : base;
  const seen = new Set(recent); const pool = pool0.filter(s => !seen.has(s.id)).length ? pool0.filter(s => !seen.has(s.id)) : pool0;
  const sorted = pool.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return sorted[hash('daily:' + day) % sorted.length];
}
