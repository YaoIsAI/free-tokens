// 站内极简访客统计 beacon（umami 式）——由 lib/layout.js 注入所有 SSR HTML 页。
// 页面加载后上报一次：只发时区/语言/路径，IP 与 UA 由服务端 /api/track 补全（服务器视角更可信）。
// - 与 Nginx proxy_cache 微缓存兼容：POST /api/track 不会被缓存命中，页面命中缓存时仍能精确记录
// - 跳过管理后台（员工流量不入统计）；CSP connect-src 'self' 已放行同源请求
// - 任何失败都不影响页面（统计是附加能力，不是页面依赖）
//
// 会话级去重（对齐 umami/plausible 主流「会话=独立访客」口径）：
//   sessionStorage 存本标签页会话内已上报过的 path 集合，同一会话同一 path 只上报一次。
//   这样「同一访客疯狂刷新同一页」只会记第一次（一次会话），避免虚增 PV/访问次数。
//   每个标签页独立 sessionStorage = 独立会话，符合「一个浏览会话一个访问」的语义。
//   服务端 /api/track 另有 (ip, path) 时间窗去重作兜底，防绕过前端或 JS 禁用。
(function () {
  'use strict';
  try {
    var path = location.pathname;
    if (path === '/dashboard' || path.indexOf('/dashboard') === 0 || path.indexOf('/api/') === 0) return;

    // 会话级去重：同一标签页会话内，同一 path 只上报一次
    var SESSION_KEY = 'freeapis_tracked';
    var tracked = {};
    try { tracked = JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}'); } catch (e) { /* 解析失败按空处理 */ }
    if (tracked[path]) return; // 本会话已上报过该页，跳过
    tracked[path] = 1;
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(tracked)); } catch (e) { /* 存储失败忽略 */ }

    var payload = JSON.stringify({
      tz: (window.Intl && Intl.DateTimeFormat) ? Intl.DateTimeFormat().resolvedOptions().timeZone : '',
      lang: (navigator.language || '').slice(0, 16),
      path: path.slice(0, 200),
      // 来源 host（document.referrer）：SEO 看 google/baidu/bing，GEO 看 chatgpt.com/perplexity.ai 等 AI 引用；
      // 只传完整 referrer，host 提取在服务端做（省字节且口径统一），无来源时为空串
      ref: (document.referrer || '').slice(0, 200)
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/track', new Blob([payload], { type: 'application/json' }));
    } else if (window.fetch) {
      fetch('/api/track', { method: 'POST', body: new Blob([payload], { type: 'application/json' }), keepalive: true, credentials: 'omit' }).catch(function () {});
    } else {
      var x = new XMLHttpRequest();
      x.open('POST', '/api/track', true);
      x.setRequestHeader('Content-Type', 'application/json');
      x.send(payload);
    }
  } catch (e) { /* 统计失败不影响页面 */ }
})();
