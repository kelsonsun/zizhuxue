// v1.7 打卡 / 奖励的存取（本机 meta）：连续天数（自动用冰块）、领星星钻石、达标与里程碑检查。
import * as db from './db.js';
import * as K from './streak.js';
import * as R from './rewards.js';
import { dayNumber } from './sm2.js';
import { settings } from './state.js';

export const getWallet = async () => ({ ...R.newWallet(), ...(await db.meta.get('wallet', {})) });
export const saveWallet = w => db.meta.set('wallet', w);
export const getFreeze = async () => ({ freezes: R.FREEZE_START, frozen: [], ...(await db.meta.get('freeze', {})) });
export const saveFreeze = st => db.meta.set('freeze', st);
/** 现在的打卡状态；断了的日子自动用冰块补（会写回）。返回 {info, freeze, used, today} */
export async function streakNow() {
  const [revs, log] = await Promise.all([db.reviews.all(), db.meta.get('dailyLog', {})]);
  const today = dayNumber(); const goal = settings.dailyGoal || K.DEFAULT_GOAL; const counts = K.dayCounts(revs, log);
  const { st, used } = R.applyFreezes(counts, goal, today, await getFreeze());
  if (used.length) { await saveFreeze(st); await db.meta.set('freezeNote', { day: today, used }); }
  return { info: K.streakInfo(counts, today, goal, st.frozen), freeze: st, used, today };
}
/** 领奖（防刷规则见 rewards.js）。返回 {got:{s,d}, why, wallet} */
export async function grant(opts) {
  const r = R.award(await getWallet(), { day: dayNumber(), ...opts });
  if (r.got.s || r.got.d) await saveWallet(r.wallet);
  return r;
}
/** 做完一件事后：今天达标就领“达标奖”；到了里程碑（每段连续每个节点一次）就领里程碑奖并返回主题 */
export async function afterProgress() {
  const { info, today } = await streakNow(); let goalGot = null, milestone = null;
  if (info.met) {
    const g = await grant({ kind: 'goal', label: '今日目标达成' }); if (g.got.s) goalGot = g.got;
    if (R.isMilestone(info.streak)) {
      const m = await grant({ kind: 'milestone', key: R.milestoneKey(info.streak, today), ms: info.streak, label: `连续 ${info.streak} 天里程碑` });
      if (m.got.s) milestone = { ...R.milestoneTheme(info.streak), got: m.got };
    }
  }
  return { info, goalGot, milestone };
}
export async function buyFreeze() { const r = R.buyFreeze(await getWallet(), await getFreeze()); await saveWallet(r.wallet); await saveFreeze(r.st); return r; }
