// 部署配置（不发网络请求就能知道有没有同步服务器）：
// 静态托管（GitHub Pages 等）没有同步服务器 → SYNC_AVAILABLE=false，「我的 → 云同步」显示“未开通”，不放会报错的按钮。
// 以后开通正式同步服务器：只改这里——SYNC_AVAILABLE = true，SYNC_URL = 'https://你的同步服务器/api/v1/'（网页版、安卓、电脑客户端都会默认用它）。
// 自建同步服务器（sync-server/server.js 同端口提供应用）会自动把这个文件改写成 true + 它的 PUBLIC_URL。
export const SYNC_AVAILABLE = false;
export const SYNC_URL = '';
// v1.6 反馈收件邮箱：「反馈问题/建议」里“用邮件发送”的收件人。还没定 → 留空（邮件 App 打开后自己填收件人）。定了只改这里。
export const FEEDBACK_EMAIL = '';
