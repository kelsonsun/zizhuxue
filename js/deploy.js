// 部署配置（不发网络请求就能知道有没有同步服务器）：
// 静态托管（GitHub Pages 等）没有同步服务器 → SYNC_AVAILABLE=false，「我的 → 云同步」显示“未开通”，不放会报错的按钮。
// 以后开通正式同步服务器：只改这里——SYNC_AVAILABLE = true，SYNC_URL = 'https://你的同步服务器/api/v1/'（网页版、安卓、电脑客户端都会默认用它）。
// 自建同步服务器（sync-server/server.js 同端口提供应用）会自动把这个文件改写成它自己的配置（.env 的 WEB_SYNC / PUBLIC_URL）。
// v1.9.2：云同步（要邮件验证码，SMTP 配好之前不开）和「匿名统计 / 反馈」分开配置：
//   SYNC_AVAILABLE = false 时云同步仍显示“未开通”；TELEMETRY_URL / FEEDBACK_URL 单独指向 zizhuxue.com，
//   所以 zizhuxue.com 和已经发出去的 kelsonsun.github.io/zizhuxue/ 打开都报到同一个管理看板，反馈也直接存进服务器。
//   本机 / 局域网地址（localhost、127.0.0.1…）打开的网页和自动化测试浏览器默认不往公网报（见 js/endpoint.js），不污染真实数据。
export const SYNC_AVAILABLE = false;
export const SYNC_URL = '';
export const API_BASE = 'https://zizhuxue.com/api/v1/';
export const TELEMETRY_URL = API_BASE + 'telemetry'; // 留空 = 不上报
export const FEEDBACK_URL = API_BASE + 'feedback';   // 留空 = 反馈只能用邮件 / 复制 / 分享发出去
// v1.9.4 内置 AI：没填自己密钥的用户经服务器代理用 AI（密钥只在服务器上）。留空 = 没有内置 AI（只能自己填密钥）。
export const AI_URL = API_BASE + 'ai/';
// v1.10 付费与推荐（价格、邀请、优惠码、下单）。留空 = 没有服务器，价格页仍显示默认价格表，但不能邀请 / 核销。
export const BILLING_URL = API_BASE + 'billing/';
// v1.6 反馈收件邮箱：「反馈问题/建议」里“用邮件发送”的收件人。还没定 → 留空（邮件 App 打开后自己填收件人）。定了只改这里。
export const FEEDBACK_EMAIL = '';
