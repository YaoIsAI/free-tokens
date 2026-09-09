const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.resolve(__dirname, '..', process.env.DB_PATH || 'data/app.db');

let db;

function getDb() {
  if (db) return db;
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // WAL 上限 4MB：防 WAL 无限膨胀（曾实测 WAL 4MB ≈ 主库 14×，卡 1000 页 autocheckpoint 阈值），
  // 配合 server.js 的定时 wal_checkpoint(TRUNCATE) 让 WAL 保持小而稳定
  db.pragma('journal_size_limit = 4194304');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      nickname TEXT DEFAULT '',
      email TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      role TEXT DEFAULT 'user' CHECK(role IN ('user', 'moderator', 'admin')),
      points INTEGER DEFAULT 0,
      pull_date TEXT DEFAULT '',
      pull_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      desc TEXT DEFAULT '',
      url TEXT NOT NULL,
      provider TEXT DEFAULT '',
      category TEXT DEFAULT '其他',
      token TEXT DEFAULT '',
      token_type TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      compat TEXT DEFAULT '[]',
      models TEXT DEFAULT '[]',
      created_by TEXT REFERENCES users(id),
      verified INTEGER DEFAULT 0,
      trashed INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
    CREATE INDEX IF NOT EXISTS idx_items_created_at ON items(created_at);
    CREATE INDEX IF NOT EXISTS idx_items_created_by ON items(created_by);
    CREATE INDEX IF NOT EXISTS idx_items_verified_created ON items(verified, created_at);

    CREATE TABLE IF NOT EXISTS invite_codes (
      code TEXT PRIMARY KEY,
      created_by TEXT,
      used_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      used_at TEXT
    );

    CREATE TABLE IF NOT EXISTS tutorials (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT DEFAULT '',
      content TEXT NOT NULL,
      category TEXT DEFAULT '教程',
      tags TEXT DEFAULT '[]',
      created_by TEXT REFERENCES users(id),
      verified INTEGER DEFAULT 0,
      reject_reason TEXT DEFAULT '',
      cover TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_tutorials_category ON tutorials(category);
    CREATE INDEX IF NOT EXISTS idx_tutorials_verified_created ON tutorials(verified, created_at);

    CREATE TABLE IF NOT EXISTS points_log (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      delta INTEGER NOT NULL,
      reason TEXT,
      ref_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_points_log_user ON points_log(user_id, created_at);

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_comments_created ON comments(created_at);
    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      created_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(active, created_at);

    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      kind TEXT NOT NULL DEFAULT 'feedback' CHECK(kind IN ('feedback','bug')),
      content TEXT NOT NULL,
      image TEXT DEFAULT '',
      url TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done')),
      points_awarded INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at);

    -- 站内极简访客统计（lib/analytics.js 写入；IP 属个人数据，仅版主+后台可见，保留 30 天）
    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT DEFAULT '',
      ua TEXT DEFAULT '',
      path TEXT DEFAULT '',
      tz TEXT DEFAULT '',
      country TEXT DEFAULT '',
      lang TEXT DEFAULT '',
      ref TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_visits_created ON visits(created_at);
    CREATE INDEX IF NOT EXISTS idx_visits_country ON visits(country);

    -- 服务器资源采样（lib/analytics.js 每 60s 写入一次；cpu %、内存/磁盘字节、进程 RSS）
    CREATE TABLE IF NOT EXISTS server_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cpu REAL DEFAULT 0,
      mem_used INTEGER DEFAULT 0,
      mem_total INTEGER DEFAULT 0,
      disk_used INTEGER DEFAULT 0,
      disk_total INTEGER DEFAULT 0,
      rss INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_server_stats_created ON server_stats(created_at);

    -- 工具导航外跳统计（/tools 经 /goto 中转提示页：views=提示页曝光，clicks=实际前往；只记计数不记人）
    CREATE TABLE IF NOT EXISTS tool_clicks (
      url TEXT PRIMARY KEY,
      views INTEGER NOT NULL DEFAULT 0,
      clicks INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 认证广告（赞助商自助发布 + 版主/管理员授权上线；费用线下结算，线上只认 paid 位）
    -- status: pending=待认证 / qualified=已认证待付款 / active=投放中 / rejected=已拒绝 / offline=已下线 / expired=已到期
    CREATE TABLE IF NOT EXISTS sponsors (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      logo TEXT DEFAULT '',
      slogan TEXT DEFAULT '',
      slot TEXT DEFAULT 'home',
      price INTEGER DEFAULT 0,
      paid INTEGER NOT NULL DEFAULT 0,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','qualified','active','rejected','offline','expired')),
      reject_reason TEXT DEFAULT '',
      verify_score INTEGER DEFAULT 0,
      starts_at TEXT DEFAULT '',
      ends_at TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sponsors_status ON sponsors(status, slot);
    CREATE INDEX IF NOT EXISTS idx_sponsors_user ON sponsors(user_id);

    -- 广告展示/点击流水（按天聚合；只记计数不记人）
    CREATE TABLE IF NOT EXISTS sponsor_stats (
      id TEXT PRIMARY KEY,
      sponsor_id TEXT REFERENCES sponsors(id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      views INTEGER NOT NULL DEFAULT 0,
      clicks INTEGER NOT NULL DEFAULT 0,
      UNIQUE(sponsor_id, day)
    );
    CREATE INDEX IF NOT EXISTS idx_sponsor_stats_sponsor ON sponsor_stats(sponsor_id, day);
  `);

  // 迁移：为已存在的 users 表补 nickname 列
  try {
    const cols = db.prepare('PRAGMA table_info(users)').all();
    if (!cols.some(c => c.name === 'nickname')) {
      db.exec(`ALTER TABLE users ADD COLUMN nickname TEXT DEFAULT ''`);
    }
    // 积分系统三列（发布奖励 / 每日拉取额度）
    if (!cols.some(c => c.name === 'points')) {
      db.exec(`ALTER TABLE users ADD COLUMN points INTEGER DEFAULT 0`);
    }
    if (!cols.some(c => c.name === 'pull_date')) {
      db.exec(`ALTER TABLE users ADD COLUMN pull_date TEXT DEFAULT ''`);
    }
    if (!cols.some(c => c.name === 'pull_count')) {
      db.exec(`ALTER TABLE users ADD COLUMN pull_count INTEGER DEFAULT 0`);
    }
    // JWT 吊销纪元：密码重置/找回时 +1，旧 token 的 epoch 不匹配即失效（防泄露 token 在改密后继续可用）
    if (!cols.some(c => c.name === 'token_epoch')) {
      db.exec(`ALTER TABLE users ADD COLUMN token_epoch INTEGER DEFAULT 0`);
    }
    // 头像 URL（/uploads/avatars/<userId>-<6hex>.<ext>；空串 = 未设置，展示回退首字母）
    if (!cols.some(c => c.name === 'avatar')) {
      db.exec(`ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT ''`);
    }
  } catch (e) { /* ignore */ }

  // 迁移：visits 表补 ref 列（来源 host，用于 SEO/GEO 来源分析；老库无此列）
  try {
    const vcols = db.prepare('PRAGMA table_info(visits)').all();
    if (!vcols.some(c => c.name === 'ref')) {
      db.exec(`ALTER TABLE visits ADD COLUMN ref TEXT DEFAULT ''`);
    }
  } catch (e) { /* ignore */ }

  // 迁移：昵称全局唯一（非空、不区分大小写）——先给历史重复昵称加数字后缀，再建唯一索引
  try {
    const dups = db.prepare(`SELECT LOWER(nickname) AS n FROM users WHERE nickname != '' GROUP BY LOWER(nickname) HAVING COUNT(*) > 1`).all();
    for (const d of dups) {
      const rows = db.prepare('SELECT id, nickname FROM users WHERE nickname = ? COLLATE NOCASE ORDER BY created_at').all(d.n);
      rows.forEach((r, i) => {
        if (i > 0) db.prepare('UPDATE users SET nickname = ? WHERE id = ?').run(r.nickname + '_' + (i + 1), r.id);
      });
    }
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nickname_unique ON users(nickname COLLATE NOCASE) WHERE nickname != ''`);
  } catch (e) { /* ignore */ }

  // 迁移：为已存在的 items 表补 compat 列（OpenAI/Anthropic 兼容检测结果）
  try {
    const icols = db.prepare('PRAGMA table_info(items)').all();
    if (!icols.some(c => c.name === 'compat')) {
      db.exec(`ALTER TABLE items ADD COLUMN compat TEXT DEFAULT '[]'`);
    }
    if (!icols.some(c => c.name === 'trashed')) {
      db.exec(`ALTER TABLE items ADD COLUMN trashed INTEGER DEFAULT 0`);
    }
    if (!icols.some(c => c.name === 'models')) {
      db.exec(`ALTER TABLE items ADD COLUMN models TEXT DEFAULT '[]'`);
    }
  } catch (e) { /* ignore */ }

  // 迁移：items.token 唯一索引（发布去重的 DB 级兜底，堵「先查后插 + await 让出事件循环」的并发双插竞态）
  // 谓词含 trashed = 0：垃圾桶条目释放 Token 允许重新发布；下线（verified=0 未删）仍在审核生命周期、继续占用
  // 历史重复 token 保留最早一条，其余置空（置空即回待审核，发布规则已禁无 token 条目）
  try {
    const dups = db.prepare(`SELECT token FROM items WHERE token != '' AND trashed = 0 GROUP BY token HAVING COUNT(*) > 1`).all();
    for (const d of dups) {
      const rows = db.prepare('SELECT id FROM items WHERE token = ? AND trashed = 0 ORDER BY created_at, rowid').all(d.token);
      rows.forEach((r, i) => { if (i > 0) db.prepare("UPDATE items SET token = '' WHERE id = ?").run(r.id); });
    }
    // 旧索引（无 trashed 谓词）会拦截软删 Token 重新发布，检测到旧定义即重建
    const idx = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_items_token_unique'`).get();
    if (idx && !/trashed/i.test(idx.sql || '')) db.exec(`DROP INDEX idx_items_token_unique`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_items_token_unique ON items(token) WHERE token != '' AND trashed = 0`);
  } catch (e) { /* ignore */ }

  // 迁移：tutorials.created_by 索引（/api/my/tutorials 目前是唯一全表扫，数据量上来后变慢）
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tutorials_created_by ON tutorials(created_by, created_at)`);
  } catch (e) { /* ignore */ }

  // 迁移：为已存在的 tutorials 表补 reject_reason 列（教程审核拒绝理由）
  try {
    const tcols = db.prepare('PRAGMA table_info(tutorials)').all();
    if (!tcols.some(c => c.name === 'reject_reason')) {
      db.exec(`ALTER TABLE tutorials ADD COLUMN reject_reason TEXT DEFAULT ''`);
    }
  } catch (e) { /* ignore */ }

  // 迁移：为已存在的 tutorials 表补 cover 列（教程封面图 URL）
  try {
    const tcols2 = db.prepare('PRAGMA table_info(tutorials)').all();
    if (!tcols2.some(c => c.name === 'cover')) {
      db.exec(`ALTER TABLE tutorials ADD COLUMN cover TEXT DEFAULT ''`);
    }
  } catch (e) { /* ignore */ }

  // 迁移：为已存在的 feedback 表补 points_awarded 列（版主「通过并 +1 积分」标记，幂等防重复发放）
  try {
    const fcols = db.prepare('PRAGMA table_info(feedback)').all();
    if (!fcols.some(c => c.name === 'points_awarded')) {
      db.exec(`ALTER TABLE feedback ADD COLUMN points_awarded INTEGER DEFAULT 0`);
    }
  } catch (e) { /* ignore */ }

  // 迁移：comments 补 ref_id 列（'' = 首页留言墙；条目 id = Token 详情评论，生命周期跟条目走）
  try {
    const ccols = db.prepare('PRAGMA table_info(comments)').all();
    if (!ccols.some(c => c.name === 'ref_id')) {
      db.exec(`ALTER TABLE comments ADD COLUMN ref_id TEXT DEFAULT ''`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_comments_ref ON comments(ref_id, created_at)`);
  } catch (e) { /* ignore */ }

  // 迁移：打赏幂等的 DB 级兜底——同一用户对同一条目只允许一条 reason='tip' 流水
  //（与 idx_items_token_unique 同思路：接口有前置 SELECT 检查，索引堵住任何并发重复路径）
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_points_log_tip_unique ON points_log(user_id, ref_id) WHERE reason = 'tip'`);
  } catch (e) { /* ignore */ }

  // 迁移：动态流/打赏计数按 reason+ref_id 查 points_log（无索引时是全表扫，数据量上来后线性变慢）
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_points_log_reason_ref ON points_log(reason, ref_id)`);
  } catch (e) { /* ignore */ }
  // 迁移：查看扣分幂等（同一用户同一卡片仅扣一次，后续免费）
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_points_log_view_unique ON points_log(user_id, ref_id) WHERE reason = 'view'`);
  } catch (e) { /* ignore */ }

  // 迁移：Skill 广场（P0）
  db.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      author_id TEXT REFERENCES users(id),
      title TEXT NOT NULL,
      summary TEXT DEFAULT '',
      description TEXT DEFAULT '',
      category TEXT DEFAULT '通用',
      tags TEXT DEFAULT '[]',
      cover TEXT DEFAULT '',
      price INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending' CHECK(status IN ('draft','pending','rejected','online','offline')),
      current_version TEXT DEFAULT '',
      downloads INTEGER DEFAULT 0,
      copies INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS skill_versions (
      id TEXT PRIMARY KEY,
      skill_id TEXT REFERENCES skills(id),
      version TEXT NOT NULL,
      content_path TEXT NOT NULL,
      resources_json TEXT DEFAULT '[]',
      sha256 TEXT DEFAULT '',
      scan_report TEXT DEFAULT '',
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','rejected','online')),
      reject_reason TEXT DEFAULT '',
      reviewed_by TEXT REFERENCES users(id),
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS skill_purchases (
      id TEXT PRIMARY KEY,
      skill_id TEXT REFERENCES skills(id),
      buyer_id TEXT REFERENCES users(id),
      version_at_buy TEXT,
      price INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS skill_audit_log (
      id TEXT PRIMARY KEY,
      skill_id TEXT REFERENCES skills(id),
      action TEXT NOT NULL CHECK(action IN ('submit','verify','reject','offline','online','delete')),
      version TEXT,
      detail TEXT DEFAULT '',
      operator_id TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS skill_reviews (
      id TEXT PRIMARY KEY,
      skill_id TEXT REFERENCES skills(id),
      user_id TEXT REFERENCES users(id),
      rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
      content TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(skill_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS skill_reports (
      id TEXT PRIMARY KEY,
      skill_id TEXT REFERENCES skills(id),
      reporter_id TEXT REFERENCES users(id),
      type TEXT NOT NULL CHECK(type IN ('malicious','copyright','false','invalid','privacy')),
      content TEXT NOT NULL,
      status TEXT DEFAULT 'open' CHECK(status IN ('open','done')),
      handled_by TEXT REFERENCES users(id),
      handle_note TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);
    CREATE INDEX IF NOT EXISTS idx_skills_status_created ON skills(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_skills_author ON skills(author_id);
    CREATE INDEX IF NOT EXISTS idx_skill_versions_skill ON skill_versions(skill_id, version);
    CREATE INDEX IF NOT EXISTS idx_skill_purchases_buyer ON skill_purchases(buyer_id);
    CREATE INDEX IF NOT EXISTS idx_skill_reviews_skill ON skill_reviews(skill_id);
    CREATE INDEX IF NOT EXISTS idx_skill_reports_status ON skill_reports(status);
  `);

  // 迁移：模型测活众测记录（详情弹窗「检测」结果 + 「标记不可用」众测，2026-08-20 加）
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS model_probes (
        id TEXT PRIMARY KEY,
        item_id TEXT REFERENCES items(id),
        model TEXT NOT NULL,
        ok INTEGER NOT NULL,
        status INTEGER DEFAULT 0,
        latency_ms INTEGER DEFAULT 0,
        source TEXT DEFAULT 'user',
        user_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_model_probes_item ON model_probes(item_id, model, created_at);
    `);
  } catch (e) { /* ignore */ }

  // 迁移：skill_purchases 购买幂等唯一索引（purchaseSkill 注释声称的 DB 兜底，2026-08-19 补建）
  // 先清历史重复（保留最早一笔），再建唯一索引；已存在则跳过
  try {
    const dups = db.prepare(`SELECT skill_id, buyer_id FROM skill_purchases GROUP BY skill_id, buyer_id HAVING COUNT(*) > 1`).all();
    for (const d of dups) {
      const rows = db.prepare('SELECT id FROM skill_purchases WHERE skill_id = ? AND buyer_id = ? ORDER BY created_at, rowid').all(d.skill_id, d.buyer_id);
      rows.forEach((r, i) => { if (i > 0) db.prepare('DELETE FROM skill_purchases WHERE id = ?').run(r.id); });
    }
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_purchases_unique ON skill_purchases(skill_id, buyer_id)`);
  } catch (e) { /* ignore */ }

  // 迁移：每日签到（2026-09-06）：users 补签到两列 + checkins 台账
  try {
    const ucols = db.prepare('PRAGMA table_info(users)').all();
    if (!ucols.some(c => c.name === 'checkin_date')) {
      db.exec(`ALTER TABLE users ADD COLUMN checkin_date TEXT DEFAULT ''`);
    }
    if (!ucols.some(c => c.name === 'checkin_streak')) {
      db.exec(`ALTER TABLE users ADD COLUMN checkin_streak INTEGER DEFAULT 0`);
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS checkins (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        checkin_date TEXT NOT NULL,
        streak INTEGER NOT NULL DEFAULT 1,
        points INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, checkin_date)
      );
      CREATE INDEX IF NOT EXISTS idx_checkins_user_date ON checkins(user_id, checkin_date);
    `);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_points_log_checkin_unique ON points_log(user_id, ref_id) WHERE reason = 'checkin'`);
  } catch (e) { /* ignore */ }

  // 迁移：AI 判官专用配置（2026-09-08）：单行表，管理员一键挑选平台可用 Token 当判官
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_judge_config (
        id TEXT PRIMARY KEY,
        base_url TEXT NOT NULL,
        token TEXT NOT NULL,
        model TEXT NOT NULL,
        updated_by TEXT REFERENCES users(id),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  } catch (e) { /* ignore */ }

  return db;
}

module.exports = getDb;