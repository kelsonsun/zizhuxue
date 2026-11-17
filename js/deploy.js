// 部署配置（不发网络请求就能知道有没有同步服务器）：
// 静态托管（GitHub Pages 等）没有同步服务器 → false，「我的 → 云同步」显示“未开通”，不放会报错的按钮。
// 自建同步服务器（sync-server/server.js 同端口提供应用）会把这个文件改写成 true。
export const SYNC_AVAILABLE = false;
