// v1.9 收费配置（kelson 改这里就行，不用动别的代码）。改完运行 node tools/build.js 再上传。
// ———— 免费试用：按“学习次数”算，不按天数 ————
// 一次 = 一段连续的学习，不限时长：不管做了多少组、学了多久都只算一次；
//        停下超过 SESSION_GAP_MIN 分钟（没有任何学习操作）再开始学，才算新的一次（从最后一次学习操作起算的滑动窗口）。
//        这段学习里至少完成一组复习 / 测验 / 练习（≥ MIN_ANSWERS 题）或学完课文一段才计入；只打开 App、查词、拍照、导入、看材料都不算。
export const TRIAL_USES = 7;           // 试用次数（kelson 2026-11-19 定为 7 次）
export const SESSION_GAP_MIN = 30;     // 停下多少分钟（没有学习操作）以后再学算新的一次
export const MIN_ANSWERS = 3;          // 一组练习至少答几题才算一次（太少不算，也不扣）
// ———— 试用限制开关（价格定了再开）————
// TRIAL_ENFORCED = false（现在）：照常记录每次学习，但不拦任何功能，也不显示“试用用完 / 还剩几次”；激活入口照常可用。
// 打开的那天（推荐做法）：TRIAL_ENFORCED 改成 true，同时把 TRIAL_SINCE 填成当天日期，例如 '2027-01-15'——
//   只有这天及以后的学习算进 7 次，每个人（包括老用户）都从这天起有完整的 7 次，不会一开就已经用完；
//   以前的学习照常记着（以后想改起算日期也能算），只是不算进试用。
export const TRIAL_ENFORCED = false;
export const TRIAL_SINCE = '';         // 起算日期 'YYYY-MM-DD'；空 = 从 v1.9 上线（2026-11-20）起算
export const TRIAL_LAUNCH = '2026-11-20';
export const TRIAL_TAGLINE = `免费试用${TRIAL_USES}次，每次不限时长`; // 会员页、首页试用信息处显示的提示语
export const WARN_REMAINING = 3;       // 剩几次时在首页提醒
// ———— 激活码 ————
export const RENEW_WARN_DAYS = 7;      // 到期前几天开始提醒续费
export const REVOKED_SERIALS = [];     // 作废的激活码编号（退款 / 泄露），例：[12, 35]
// ———— 价格与付款（kelson 和 O 记定好后填；空着 = 显示“价格待定”）————
export const PRICES = [
  { plan: 'basic', name: '基础版', price: '', period: '', desc: '全部学习功能；AI 用你自己的接口' },
  { plan: 'ai', name: '含 AI 版', price: '', period: '', desc: '基础版 + 提供 AI 服务（AI 服务上线后生效）' },
];
export const PAY = {
  url: '',        // 付款 / 购买页链接（如小店、收款页）；空 = 不显示按钮
  contact: '',    // 联系方式（如 微信号：xxx / 邮箱）；空 = 显示“购买方式即将公布”
  note: '付款后会收到一个激活码，粘贴到「我的 → 会员与激活」即可。',
};
// ———— 商店版（Google Play / App Store 等）————
// 商店构建（ZZX_CHANNEL=store node tools/build.js）里：不显示私域价格、付款链接和联系方式（商店规定数字内容要走商店内购）。
export const STORE = {
  showCodeEntry: false,  // 商店版是否显示“输入激活码”（默认不显示）
  enforceTrial: false,   // 商店版是否限制试用次数（接入商店内购之前保持 false，免得用户没有付费途径）
};
