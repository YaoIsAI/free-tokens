// 站内极简分析组件（umami 替代方案）——零外部依赖，纯 better-sqlite3 + Node 内置模块。
// 组件化设计：导出纯函数，任何路由/子应用可 require 复用，不耦合任何单一页面——
// 后台「访客/服务器」tab 只是它的消费方之一（dash.js → /api/admin/visits、/api/admin/server-stats）。
//
// 采集链路（与 Nginx proxy_cache 30s 微缓存兼容）：
//   public/track.js（layout.js 注入所有 HTML 页）→ 页面加载后 sendBeacon POST /api/track
//   POST 请求不会被 Nginx 缓存命中（页面缓存时仍能精确记录），IP/UA 由服务端补全，浏览器只补时区/语言。
// 隐私：IP 属个人数据，仅版主+后台可见；保留 30 天定时清理；不写日志文件、不落第三方。
const os = require('os');
const { execFile } = require('child_process');
const getDb = require('./db');

// ===== GeoIP 极简方案：浏览器时区 → 国家/地区 =====
// 免费零依赖（不引 MaxMind/外部 IP API）；公益站访客几乎全中国，Asia/Shanghai 即区分大陆/港澳台/海外。
// 需要更精确的 IP 定位时再换 mmdb 本地库（见 AGENT.md §5 监控决策），本组件查询函数无需改动。
const TZ_COUNTRY = {
  'Asia/Shanghai': '中国大陆', 'Asia/Urumqi': '中国大陆', 'Asia/Chongqing': '中国大陆',
  'Asia/Harbin': '中国大陆', 'Asia/Hong_Kong': '中国香港', 'Asia/Macau': '中国澳门',
  'Asia/Taipei': '中国台湾',
  'Asia/Singapore': '新加坡', 'Asia/Tokyo': '日本', 'Asia/Seoul': '韩国',
  'Asia/Bangkok': '泰国', 'Asia/Kuala_Lumpur': '马来西亚', 'Asia/Jakarta': '印度尼西亚',
  'Asia/Manila': '菲律宾', 'Asia/Ho_Chi_Minh': '越南', 'Asia/Kolkata': '印度',
  'Asia/Dhaka': '孟加拉国', 'Asia/Karachi': '巴基斯坦', 'Asia/Colombo': '斯里兰卡',
  'Asia/Dubai': '阿联酋', 'Asia/Riyadh': '沙特阿拉伯', 'Asia/Tehran': '伊朗',
  'Asia/Istanbul': '土耳其', 'Asia/Jerusalem': '以色列', 'Asia/Kathmandu': '尼泊尔',
  'Asia/Tbilisi': '格鲁吉亚', 'Asia/Almaty': '哈萨克斯坦', 'Asia/Tashkent': '乌兹别克斯坦',
  'Australia/Sydney': '澳大利亚', 'Australia/Melbourne': '澳大利亚', 'Australia/Brisbane': '澳大利亚',
  'Australia/Perth': '澳大利亚', 'Australia/Adelaide': '澳大利亚', 'Australia/Darwin': '澳大利亚',
  'Pacific/Auckland': '新西兰',
  'America/Los_Angeles': '美国', 'America/New_York': '美国', 'America/Chicago': '美国',
  'America/Denver': '美国', 'America/Phoenix': '美国', 'America/Seattle': '美国',
  'America/Anchorage': '美国', 'America/Indiana/Indianapolis': '美国', 'America/Honolulu': '美国',
  'America/Toronto': '加拿大', 'America/Vancouver': '加拿大', 'America/Montreal': '加拿大',
  'America/Edmonton': '加拿大', 'America/Sao_Paulo': '巴西', 'America/Mexico_City': '墨西哥',
  'America/Bogota': '哥伦比亚', 'America/Buenos_Aires': '阿根廷', 'America/Lima': '秘鲁',
  'America/Santiago': '智利', 'America/Caracas': '委内瑞拉', 'America/Panama': '巴拿马',
  'Europe/London': '英国', 'Europe/Paris': '法国', 'Europe/Berlin': '德国',
  'Europe/Madrid': '西班牙', 'Europe/Rome': '意大利', 'Europe/Amsterdam': '荷兰',
  'Europe/Zurich': '瑞士', 'Europe/Stockholm': '瑞典', 'Europe/Moscow': '俄罗斯',
  'Europe/Kiev': '乌克兰', 'Europe/Warsaw': '波兰', 'Europe/Lisbon': '葡萄牙',
  'Europe/Prague': '捷克', 'Europe/Vienna': '奥地利', 'Europe/Brussels': '比利时',
  'Europe/Dublin': '爱尔兰', 'Europe/Oslo': '挪威', 'Europe/Helsinki': '芬兰',
  'Europe/Athens': '希腊', 'Europe/Bucharest': '罗马尼亚', 'Europe/Budapest': '匈牙利',
  'Africa/Cairo': '埃及', 'Africa/Lagos': '尼日利亚', 'Africa/Johannesburg': '南非',
  'Africa/Nairobi': '肯尼亚', 'Africa/Casablanca': '摩洛哥',
  'UTC': '海外(未知)', 'Etc/UTC': '海外(未知)', 'Etc/GMT': '海外(未知)'
};

function timezoneToCountry(tz) {
  if (!tz) return '';
  if (TZ_COUNTRY[tz]) return TZ_COUNTRY[tz];
  const region = String(tz).split('/')[0];
  if (region === 'America') return '美洲(未细分)';
  if (region === 'Europe') return '欧洲(未细分)';
  if (region === 'Asia') return '亚洲(未细分)';
  if (region === 'Africa') return '非洲(未细分)';
  if (region === 'Australia') return '澳大利亚';
  return String(tz); // 罕见时区直接显示原始值，管理员可自行补充映射
}

// ===== 访客记录 =====
// 上限 50 万行：超出删最旧（阈值内不常触发，避免每次插入都做删除）
const MAX_VISITS = 500000;
let visitCount = null;
// 去重说明：会话级去重由前端 public/track.js 完成（sessionStorage 同会话同 path 只上报一次，
// 抑制「同一访客刷新同一页」虚增），服务端不做 (ip,path) 去重以保持 PV 口径精确，
// 防刷靠 /api/track 的 trackLimiter（120/分/IP）兜底。与 umami/plausible 主流口径一致。
function recordVisit({ ip, ua, path, tz, lang, ref } = {}) {
  try {
    const db = getDb();
    const country = timezoneToCountry(tz || '');
    db.prepare(
      'INSERT INTO visits (ip, ua, path, tz, country, lang, ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      String(ip || '').slice(0, 64),
      String(ua || '').slice(0, 300),
      String(path || '').slice(0, 200),
      String(tz || '').slice(0, 64),
      country,
      String(lang || '').slice(0, 16),
      String(ref || '').slice(0, 64),
      new Date().toISOString() // 统一 ISO（T 分隔），避免与 SQLite DEFAULT 空格格式混存导致排序错乱（见 AGENT.md §13.16）
    );
    // 批量淘汰：仅每 100 次插入再做 COUNT，避免热路径全表扫
    visitCount = (visitCount === null ? db.prepare('SELECT COUNT(*) c FROM visits').get().c : visitCount) + 1;
    if (visitCount % 100 === 0 && visitCount > MAX_VISITS) {
      const n2 = db.prepare('SELECT COUNT(*) c FROM visits').get().c;
      visitCount = n2;
      if (n2 > MAX_VISITS) {
        db.prepare('DELETE FROM visits WHERE id IN (SELECT id FROM visits ORDER BY id ASC LIMIT ?)').run(n2 - MAX_VISITS);
        visitCount = MAX_VISITS;
      }
    } else if (visitCount > MAX_VISITS) {
      // 内存计数已超但未到 100 次边界，仍需删（极罕见）
      db.prepare('DELETE FROM visits WHERE id IN (SELECT id FROM visits ORDER BY id ASC LIMIT ?)').run(visitCount - MAX_VISITS);
      visitCount = MAX_VISITS;
    }
  } catch (e) { /* 采集中间件不得阻塞页面，失败静默 */ }
}

// ===== 后台查询 =====
function queryVisits(limit = 50) {
  const db = getDb();
  const n = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  return db.prepare(
    'SELECT ip, path, tz, country, lang, ref, created_at, ua FROM visits ORDER BY id DESC LIMIT ?'
  ).all(n);
}

function queryStats() {
  const db = getDb();
  const now = Date.now();
  const iso = ms => new Date(ms).toISOString();
  // 「今日」按东八区切日（站点受众在中国）：北京 0 点 = UTC 前一天 16:00
  const bjDate = new Date(now + 8 * 3600e3).toISOString().slice(0, 10);
  const todayStart = iso(new Date(bjDate + 'T00:00:00.000Z').getTime() - 8 * 3600e3);
  const dayAgo = iso(now - 24 * 3600e3);
  const weekAgo = iso(now - 7 * 86400e3);
  const monthAgo = iso(now - 30 * 86400e3);
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  return {
    todayPv: one('SELECT COUNT(*) c FROM visits WHERE created_at >= ?', todayStart).c,
    todayUv: one('SELECT COUNT(DISTINCT ip) c FROM visits WHERE created_at >= ? AND ip != ?', todayStart, '').c,
    h24Pv: one('SELECT COUNT(*) c FROM visits WHERE created_at >= ?', dayAgo).c,
    weekPv: one('SELECT COUNT(*) c FROM visits WHERE created_at >= ?', weekAgo).c,
    byCountry: db.prepare(
      `SELECT CASE WHEN country = '' THEN '未知' ELSE country END AS country, COUNT(*) c
       FROM visits WHERE created_at >= ? GROUP BY country ORDER BY c DESC LIMIT 15`
    ).all(monthAgo),
    byPath: db.prepare(
      `SELECT CASE WHEN path = '' THEN '(未知)' ELSE path END AS path, COUNT(*) c
       FROM visits WHERE created_at >= ? GROUP BY path ORDER BY c DESC LIMIT 12`
    ).all(monthAgo),
    // 来源 TOP（SEO 看 google/baidu/bing，GEO 看 chatgpt.com/claude.ai/perplexity.ai 等 AI 引用；
    // ref 为空=直接访问/无 referrer；只存 host，天然防第三方敏感 query 进库）
    byRef: db.prepare(
      `SELECT CASE WHEN ref = '' THEN '(直接访问)' ELSE ref END AS ref, COUNT(*) c
       FROM visits WHERE created_at >= ? GROUP BY ref ORDER BY c DESC LIMIT 15`
    ).all(monthAgo),
    byDay: db.prepare(
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*) c
       FROM visits WHERE created_at >= ? GROUP BY day ORDER BY day`
    ).all(weekAgo)
  };
}

// ===== 服务器资源采样（60s 一次，零依赖：os 模块 + df 复用已有 execFile） =====
function cpuSnapshot() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    for (const t in c.times) total += c.times[t];
    idle += c.times.idle;
  }
  return { idle, total };
}

function sampleServer() {
  return new Promise(resolve => {
    const a = cpuSnapshot();
    setTimeout(() => {
      const b = cpuSnapshot();
      const totalDelta = b.total - a.total;
      const cpu = totalDelta > 0 ? Math.round(((totalDelta - (b.idle - a.idle)) / totalDelta) * 1000) / 10 : 0;
      const memTotal = os.totalmem();
      const memUsed = memTotal - os.freemem();
      const rss = process.memoryUsage().rss;
      // 磁盘：df -kP 固定 POSIX 格式（单行不折行），列 = 设备/总量/已用/可用/挂载点
      execFile('df', ['-kP', '/'], { timeout: 5000 }, (err, stdout) => {
        let diskUsed = 0;
        let diskTotal = 0;
        if (!err) {
          const line = String(stdout).split('\n').find(l => l.trim() && !/^Filesystem\b/.test(l));
          if (line) {
            const cols = line.trim().split(/\s+/);
            if (cols.length >= 3) {
              diskTotal = parseInt(cols[1], 10) || 0;
              diskUsed = parseInt(cols[2], 10) || 0;
            }
          }
        }
        // 磁盘单位统一转字节（df -k 输出 KB）
        try {
          getDb().prepare(
            'INSERT INTO server_stats (cpu, mem_used, mem_total, disk_used, disk_total, rss, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).run(cpu, memUsed, memTotal, diskUsed * 1024, diskTotal * 1024, rss, new Date().toISOString());
        } catch (e) { /* 非致命 */ }
        resolve({ cpu, memUsed, memTotal, diskUsed: diskUsed * 1024, diskTotal: diskTotal * 1024, rss, ts: new Date().toISOString() });
      });
    }, 150);
  });
}

function queryServer() {
  const db = getDb();
  const latest = db.prepare('SELECT * FROM server_stats ORDER BY id DESC LIMIT 1').get() || null;
  // 极速版：5s/次，取 120 点 ≈ 10 分钟窗口（原 60s/60点=1h），柱状更实时
  const series = db.prepare(
    'SELECT cpu, mem_used, mem_total, rss, created_at FROM server_stats ORDER BY id DESC LIMIT 120'
  ).all().reverse();
  return { latest, series };
}

// ===== 数据保留：30 天滚动清理（启动 + 每日采样周期兜底触发） =====
const RETENTION_DAYS = 30;
function retention() {
  try {
    const db = getDb();
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400e3).toISOString();
    db.prepare('DELETE FROM visits WHERE created_at < ?').run(cutoff);
    db.prepare('DELETE FROM server_stats WHERE created_at < ?').run(cutoff);
  } catch (e) { /* 非致命 */ }
}

// ===== 采样调度（server.js 启动时调用一次，极速版 5s） =====
let samplerStarted = false;
function startSampler(intervalMs = 5 * 1000) {
  if (samplerStarted) return;
  samplerStarted = true;
  retention(); // 启动即清理一次（重启兜底，避免长期积压）
  // 立即采一次，保证重启后 5s 内就有首点（原 60s 需等 1 分钟）
  try { sampleServer(); } catch (e) {}
  setInterval(() => {
    try { sampleServer(); } catch (e) { /* 非致命 */ }
  }, intervalMs).unref();
}

module.exports = {
  timezoneToCountry,
  recordVisit,
  queryVisits,
  queryStats,
  sampleServer,
  queryServer,
  retention,
  startSampler
};
