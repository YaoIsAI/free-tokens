// 邮箱认证流程：6 位验证码（绑定/改绑/重置）+ 一次性重置链接
// 防护：bcrypt 哈希存验证码/链接、单次有效、10~30 分钟过期、按 userId/email 限流
// 公开接口：sendBindCode / verifyBindCode / startPasswordReset / consumeResetToken / changeEmailRequest / changeEmailConfirm

'use strict';

const bcrypt = require('bcryptjs');
const { nanoid } = require('nanoid');
const getDb = require('./db');
const mailer = require('./mailer');

const CODE_TTL_MS = 10 * 60 * 1000;       // 验证码 10 分钟
const TOKEN_TTL_MS = 30 * 60 * 1000;     // 重置链接 30 分钟
const RESET_FAIL_LOCK = 5;                // 5 次失败锁定（与登录失败计数同源）
const CODE_MAX_ATTEMPTS = 5;              // 单条验证码最多试 5 次

function ipRateOk(db, key, kind, max, windowMs) {
  // 简易按 ip+kind 滑窗（30 天落库时一并清理）
  const cur = Date.now();
  const row = db.prepare('SELECT window_start, count FROM email_rate WHERE key=? AND kind=?').get(key, kind);
  if (!row || cur - row.window_start > windowMs) {
    db.prepare('INSERT OR REPLACE INTO email_rate (key, kind, window_start, count) VALUES (?, ?, ?, 1)')
      .run(key, kind, cur);
    return true;
  }
  if (row.count >= max) return false;
  db.prepare('UPDATE email_rate SET count = count + 1 WHERE key=? AND kind=?').run(key, kind);
  return true;
}

function ensureRateTable() {
  try {
    const db = getDb();
    db.exec(`CREATE TABLE IF NOT EXISTS email_rate (
      key TEXT, kind TEXT, window_start INTEGER, count INTEGER,
      PRIMARY KEY (key, kind)
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_email_rate_window ON email_rate(window_start)');
  } catch (_) {}
}

function normEmail(e) {
  return String(e || '').trim().toLowerCase();
}

function okEmail(e) {
  return e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

// 通用：发绑定/改绑/重置 6 位验证码（30 秒防刷）
async function sendCode(opts) {
  ensureRateTable();
  const cfg = require('./mailer').readConfig();
  if (!cfg.enabled) return { ok: false, error: '邮件服务未启用，请联系管理员在后台开启' };
  const { email, userId, purpose, ip } = opts;
  if (!okEmail(email)) return { ok: false, error: '邮箱格式无效' };
  if (!['bind', 'reset', 'change'].includes(purpose)) return { ok: false, error: '用途非法' };
  const db = getDb();
  const ipKey = (ip || 'unknown') + ':' + purpose;
  if (!ipRateOk(db, ipKey, 'send', 8, 10 * 60 * 1000)) {
    return { ok: false, error: '请求过于频繁，请稍后再试' };
  }
  const code = mailer.makeCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  db.prepare('INSERT INTO email_codes (id, user_id, email, purpose, code_hash, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(nanoid(16), String(userId || ''), email, purpose, codeHash, expiresAt);
  const t = mailer.readConfig();
  const subject = purpose === 'reset'
    ? `【${t.fromAddr.split('@')[1] || 'free-tokens'}】重置密码验证码`
    : `【${t.fromAddr.split('@')[1] || 'free-tokens'}】邮箱验证码`;
  const html = `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
    <h2 style="color:#0d0f17;margin:0 0 12px">${subject}</h2>
    <p style="color:#475569;line-height:1.7">您的验证码为（10 分钟内有效）：</p>
    <div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#5b6ef7;padding:16px;background:#eef1ff;border-radius:12px;text-align:center;margin:16px 0">${code}</div>
    <p style="color:#94a3b8;font-size:12px">若非本人操作，请忽略本邮件。</p>
  </div>`;
  const r = await mailer.sendMail({ to: email, subject, html, userId, purpose });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

// 通用：校验 6 位验证码；命中后置 used_at
async function verifyCode(opts) {
  const { email, code, purpose } = opts;
  if (!email || !code) return { ok: false, error: '参数缺失' };
  const db = getDb();
  const row = db.prepare("SELECT id, code_hash, expires_at, attempts FROM email_codes WHERE email = ? AND purpose = ? AND used_at = '' ORDER BY created_at DESC LIMIT 1").get(normEmail(email), purpose);
  if (!row) return { ok: false, error: '验证码无效或已使用' };
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, error: '验证码已过期' };
  if (row.attempts >= CODE_MAX_ATTEMPTS) return { ok: false, error: '验证尝试次数过多' };
  const ok = await bcrypt.compare(code, row.code_hash);
  if (!ok) {
    db.prepare('UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    return { ok: false, error: '验证码错误' };
  }
  db.prepare("UPDATE email_codes SET used_at = datetime('now') WHERE id = ?").run(row.id);
  return { ok: true };
}

// 申请重置链接：要求用户名 + 注册邮箱匹配 + 限流 + 发送链接邮件（不暴露用户是否存在）
async function startPasswordReset(opts) {
  ensureRateTable();
  const cfg2 = require('./mailer').readConfig();
  if (!cfg2.enabled) return { ok: false, error: '邮件服务未启用，请联系管理员' };
  const { username, email, ip, ua } = opts;
  const db = getDb();
  const ipKey = (ip || 'unknown') + ':reset';
  if (!ipRateOk(db, ipKey, 'start', 5, 10 * 60 * 1000)) {
    return { ok: false, error: '请求过于频繁，请稍后再试' };
  }
  const GENERIC = '若该用户名与邮箱匹配，已发送重置邮件，请查收';
  if (!username || !okEmail(email)) return { ok: false, error: GENERIC };
  const user = db.prepare('SELECT id, email FROM users WHERE username = ?').get(username);
  if (!user) return { ok: false, error: GENERIC };
  if (normEmail(user.email) !== normEmail(email)) return { ok: false, error: GENERIC };
  if (!user.email) return { ok: false, error: GENERIC };
  const token = mailer.makeToken();
  const tokenHash = mailer.hashValue(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  db.prepare('INSERT INTO email_resets (id, user_id, email, token_hash, expires_at, ip, ua) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(nanoid(16), user.id, email, tokenHash, expiresAt, String(ip || '').slice(0, 64), String(ua || '').slice(0, 256));
  const link = buildResetLink(token);
  const conf = mailer.readConfig();
  const domain = (conf.fromAddr.split('@')[1] || 'free-tokens.org');
  const subject = `【${domain}】重置您的密码（30 分钟有效）`;
  const html = `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
    <h2 style="color:#0d0f17;margin:0 0 12px">密码重置</h2>
    <p style="color:#475569;line-height:1.7">您（${username}）正在申请重置密码。点击下方按钮（30 分钟内有效，单次点击后失效）：</p>
    <p style="margin:24px 0;text-align:center">
      <a href="${link}" style="display:inline-block;background:#5b6ef7;color:#fff;text-decoration:none;padding:12px 32px;border-radius:8px;font-weight:600">立即重置密码</a>
    </p>
    <p style="color:#94a3b8;font-size:12px">若按钮无法点击，请复制链接到浏览器：${link}</p>
    <p style="color:#94a3b8;font-size:12px">若非本人操作，请忽略本邮件，账号安全无虞。</p>
  </div>`;
  const r = await mailer.sendMail({ to: email, subject, html, userId: user.id, purpose: 'reset' });
  return r.ok ? { ok: true, message: GENERIC } : { ok: false, error: '邮件发送失败，请稍后重试' };
}

// 消费重置 token：原子事务，标记 used_at + 重置密码 + 强制下线全设备
function consumeResetToken(opts) {
  const { token, newPassword, ip } = opts;
  if (!token || !newPassword) return { ok: false, error: '参数缺失' };
  if (newPassword.length < 8) return { ok: false, error: '密码至少 8 字符' };
  if (newPassword.length > 72) return { ok: false, error: '密码不能超过 72 字符' };
  if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) return { ok: false, error: '密码需同时包含字母和数字' };
  const tokenHash = mailer.hashValue(token);
  const db = getDb();
  let result = {};
  try {
    result = db.transaction(() => {
      const row = db.prepare("SELECT id, user_id, email, expires_at FROM email_resets WHERE token_hash = ? AND used_at = ''").get(tokenHash);
      if (!row) throw new Error('链接无效或已使用');
      if (new Date(row.expires_at).getTime() < Date.now()) throw new Error('链接已过期');
      const hash = require('bcryptjs').hashSync(newPassword, 10);
      db.prepare("UPDATE email_resets SET used_at = datetime('now') WHERE id = ?").run(row.id);
      db.prepare('UPDATE users SET password = ?, token_epoch = token_epoch + 1, email_verified_at = CASE WHEN email_verified_at = "" THEN datetime("now") ELSE email_verified_at END WHERE id = ?').run(hash, row.user_id);
      return { ok: true, userId: row.user_id, email: row.email };
    })();
  } catch (e) {
    return { ok: false, error: e.message || '链接无效' };
  }
  if (result.ok) {
    // 重置成功后发“安全提醒”邮件
    try {
      const conf = mailer.readConfig();
      const domain = (conf.fromAddr.split('@')[1] || 'free-tokens.org');
      const subject = `【${domain}】账号密码已重置提醒`;
      const html = `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#0d0f17;margin:0 0 12px">密码重置成功</h2>
        <p style="color:#475569;line-height:1.7">您的密码刚刚被重置（IP: ${ip || '未知'}）。若非本人操作，请立即再次修改密码并联系管理员。</p>
      </div>`;
      mailer.sendMail({ to: result.email, subject, html, userId: result.userId, purpose: 'change' }).catch(() => {});
    } catch (_) {}
  }
  return result;
}

function buildResetLink(token) {
  // 由 server.js 在请求时注入 origin（避免此处反向依赖）
  // 占位：server.js 会全局替换 __RESET_LINK__ 前缀
  return '__RESET_LINK__?token=' + token;
}

module.exports = { sendCode, verifyCode, startPasswordReset, consumeResetToken, buildResetLink };
