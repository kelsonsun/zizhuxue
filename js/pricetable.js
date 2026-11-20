// v1.10 价格表（前后端共用）：大陆年付 ¥168、月付 ¥16.8；其他地区按大陆价 ×2.2，用各商店货币取最接近价位。
// 地区以应用商店地区 / 用户自选为准，绝不按 IP 或手机号区分。看板可以改这张表（服务器覆盖默认值）。
export const MAINLAND_YEAR = 168;
export const MAINLAND_MONTH = 16.8;
export const OTHER_MULT = 2.2;
export const DISCOUNT_PERCENT = 20; // 推荐优惠：双方各 8 折（减 20%），不叠加
export const REWARD_HOLD_DAYS = 30;
export const MONTH_DAYS = 30;
export const YEAR_DAYS = 365;

/** 默认价格表（定稿 2026-11-20）。cents = 最小货币单位（美元分、人民币分、日元 1 圆、韩元 1 圆） */
export const DEFAULT_PRICES = [
  { region: 'CN', name: '中国大陆', currency: 'CNY', symbol: '¥', decimals: 2, year: '168', month: '16.8', yearCents: 16800, monthCents: 1680, storeTax: false },
  { region: 'US', name: '美国', currency: 'USD', symbol: '$', decimals: 2, year: '54.99', month: '5.49', yearCents: 5499, monthCents: 549, storeTax: false },
  { region: 'TW', name: '台湾', currency: 'TWD', symbol: 'NT$', decimals: 0, year: '1790', month: '190', yearCents: 1790, monthCents: 190, storeTax: false },
  { region: 'HK', name: '香港', currency: 'HKD', symbol: 'HK$', decimals: 0, year: '438', month: '43', yearCents: 438, monthCents: 43, storeTax: false },
  { region: 'SG', name: '新加坡', currency: 'SGD', symbol: 'S$', decimals: 2, year: '69.98', month: '6.98', yearCents: 6998, monthCents: 698, storeTax: false },
  { region: 'MY', name: '马来西亚', currency: 'MYR', symbol: 'RM', decimals: 2, year: '229.90', month: '22.90', yearCents: 22990, monthCents: 2290, storeTax: false },
  { region: 'KR', name: '韩国', currency: 'KRW', symbol: '₩', decimals: 0, year: '73000', month: '7400', yearCents: 73000, monthCents: 7400, storeTax: true },
  { region: 'JP', name: '日本', currency: 'JPY', symbol: '¥', decimals: 0, year: '8800', month: '880', yearCents: 8800, monthCents: 880, storeTax: true },
  { region: 'CA', name: '加拿大', currency: 'CAD', symbol: 'C$', decimals: 2, year: '79.99', month: '7.99', yearCents: 7999, monthCents: 799, storeTax: false },
  { region: 'AU', name: '澳大利亚', currency: 'AUD', symbol: 'A$', decimals: 2, year: '82.99', month: '7.99', yearCents: 8299, monthCents: 799, storeTax: true },
  { region: 'GB', name: '英国', currency: 'GBP', symbol: '£', decimals: 2, year: '41.99', month: '3.99', yearCents: 4199, monthCents: 399, storeTax: true },
  { region: 'EU', name: '欧元区', currency: 'EUR', symbol: '€', decimals: 2, year: '49.99', month: '4.99', yearCents: 4999, monthCents: 499, storeTax: true },
  { region: 'OTHER', name: '其他地区', currency: 'USD', symbol: '$', decimals: 2, year: '54.99', month: '5.49', yearCents: 5499, monthCents: 549, storeTax: false, note: '未列出的商店地区先按美元价显示，上架时以商店实际价位为准' },
];

export const PERIODS = { month: { id: 'month', name: '月付', days: MONTH_DAYS }, year: { id: 'year', name: '年付', days: YEAR_DAYS } };

export const rowOf = (table, region) => {
  const t = table && table.length ? table : DEFAULT_PRICES;
  return t.find(r => r.region === region) || t.find(r => r.region === 'OTHER') || t[0];
};

export const periodCents = (row, period) => period === 'month' ? +row.monthCents : +row.yearCents;

/** 8 折：应付 = 原价 × (100-percent)/100，四舍五入到最小货币单位。多次优惠不叠加（只认一次）。 */
export function applyOff(cents, percent = DISCOUNT_PERCENT, alreadyDiscounted = false) {
  if (alreadyDiscounted) return { payCents: Math.round(+cents || 0), percent: 0, stacked: false, rejected: true };
  const p = Math.max(0, Math.min(90, +percent || 0));
  return { payCents: Math.round((+cents || 0) * (100 - p) / 100), percent: p, stacked: false, rejected: false };
}

export function formatCents(cents, row) {
  const d = row.decimals ?? 2, v = (+cents || 0) / (d === 0 ? 1 : 10 ** d);
  const n = d === 0 ? Math.round(v).toLocaleString('en-US') : v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d });
  return (row.symbol || '') + n;
}

export const displayPrice = (row, period) => formatCents(periodCents(row, period), row);

/** 把优惠百分比写成中文折扣：20 → 「8 折」。 */
export function zheLabel(percentOff) {
  const z = (100 - Math.max(0, Math.min(90, +percentOff || 0))) / 10;
  return (Number.isInteger(z) ? String(z) : String(Number(z.toFixed(1)))) + ' 折';
}
