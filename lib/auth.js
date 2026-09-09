const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { nanoid } = require('nanoid');
const getDb = require('./db');

// 生产必须显式配置 JWT_SECRET；未配置时：生产直接失败，非生产用随机临时密钥（重启失效）
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET 未设置：生产环境必须配置强随机值');
  }
  JWT_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[auth] 未设置 JWT_SECRET，已生成临时随机密钥（重启后所有登录失效）');
}
// 生产强制强随机密钥：<32 字节直接拒绝启动（防弱密钥被爆破伪造 JWT）
if (process.env.NODE_ENV === 'production' && JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET 长度不足：生产环境必须使用 ≥32 字节的强随机值（openssl rand -hex 32）');
}

// 登录时用户不存在也用它对 bcrypt.compare，抹平时间差防止枚举用户名
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer-dummy-password', 10);

function createToken(user) {
  // epoch = 密码纪元：密码重置/找回时 +1，旧 token 的 epoch 不匹配即 401（JWT 吊销机制）
  const db = getDb();
  const row = db.prepare('SELECT token_epoch FROM users WHERE id = ?').get(user.id);
  const epoch = row ? (row.token_epoch || 0) : 0;
  return jwt.sign({ id: user.id, username: user.username, epoch }, JWT_SECRET, { expiresIn: '7d' });
}

// ===== 登录失败锁定（按账号，内存态，单进程适用） =====
// 连续失败 >= 5 次锁定 15 分钟；成功登录清空；锁定对任意用户名一致（不泄露账号是否存在）
const LOGIN_FAIL_LIMIT = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const loginFails = new Map(); // username -> { count, lockUntil }

function recordLoginFail(username) {
  const now = Date.now();
  const e = loginFails.get(username);
  if (!e || (e.lockUntil && now > e.lockUntil)) {
    loginFails.set(username, { count: 1, lockUntil: 0 });
    return;
  }
  e.count += 1;
  if (e.count >= LOGIN_FAIL_LIMIT) { e.lockUntil = now + LOGIN_LOCK_MS; e.count = 0; }
  loginFails.set(username, e);
  if (loginFails.size > 10000) {
    let removed = 0;
    for (const k of loginFails.keys()) { loginFails.delete(k); if (++removed >= 5000) break; }
  }
}

function loginLockRemainingMs(username) {
  const e = loginFails.get(username);
  if (!e || !e.lockUntil) return 0;
  const remain = e.lockUntil - Date.now();
  return remain > 0 ? remain : 0;
}

function clearLoginFails(username) { loginFails.delete(username); }

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }); } catch (e) { return null; }
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '请先登录' });
  }
  const payload = verifyToken(header.slice(7));
  if (!payload) return res.status(401).json({ error: '登录已过期，请重新登录' });
  // JWT 吊销：密码已变更（epoch 前进）的旧 token 一律拒绝
  const db = getDb();
  const row = db.prepare('SELECT token_epoch FROM users WHERE id = ?').get(payload.id);
  if (!row || (payload.epoch || 0) !== (row.token_epoch || 0)) {
    return res.status(401).json({ error: '登录状态已失效（密码已变更），请重新登录' });
  }
  req.user = payload;
  next();
}

function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    const payload = verifyToken(header.slice(7));
    if (payload) req.user = payload;
  }
  next();
}

// 密码策略：至少 8 位、同时包含字母和数字、≤72 位（bcrypt 上限）
function validatePassword(password) {
  if (!password) return '密码不能为空';
  if (password.length < 8) return '密码至少8个字符';
  if (password.length > 72) return '密码不能超过72个字符';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return '密码需同时包含字母和数字';
  return null;
}

async function register(username, password, email = '', phone = '', inviteCode) {
  if (!username || !password) return { error: '用户名和密码必填' };
  if (username.length < 2 || username.length > 20) return { error: '用户名需2-20个字符' };
  const pwErr = validatePassword(password);
  if (pwErr) return { error: pwErr };
  const emailClean = String(email || '').trim().toLowerCase();
  const phoneClean = String(phone || '').trim();
  if (emailClean && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailClean)) return { error: '邮箱格式无效' };
  if (phoneClean && !/^\+?[0-9]{5,20}$/.test(phoneClean)) return { error: '手机号格式无效' };
  if (!inviteCode) return { error: '请提供邀请码（入群后向管理员索取）' };

  const code = String(inviteCode).trim();
  const db = getDb();
  const inv = db.prepare('SELECT code, created_by FROM invite_codes WHERE code = ?').get(code);
  if (!inv) return { error: '邀请码无效' };

  const hash = await bcrypt.hash(password, 10);
  const id = nanoid(10);

  // 事务内原子消耗邀请码：INSERT 用户 + 条件 UPDATE（used_by IS NULL），
  // 若码已被并发占用则 changes=0 抛错回滚，保证一码仅用一次
  // 新用户初始 5 积分（可看 5 张卡片，之后需发布赚分）
  const run = db.transaction(() => {
    db.prepare('INSERT INTO users (id, username, password, email, phone, points) VALUES (?, ?, ?, ?, ?, 5)')
      .run(id, username, hash, emailClean, phoneClean);
    const upd = db.prepare("UPDATE invite_codes SET used_by = ?, used_at = datetime('now') WHERE code = ? AND used_by IS NULL")
      .run(id, code);
    if (upd.changes !== 1) throw new Error('INVITE_USED');
  });

  try {
    run();
  } catch (e) {
    if (e.message === 'INVITE_USED') return { error: '邀请码已被使用' };
    if (e.message.includes('UNIQUE')) return { error: '用户名已存在' };
    throw e;
  }

  // 邀请裂变记录：邀请码创建者即邀请人，被邀人首发 Token 上线后邀请人 +1（见 POST /api/items）。
  // 此处不直接发分（防注册机刷分），只保留 created_by→used_by 链路供后续幂等发放。
  const user = { id, username, nickname: '', role: 'user' };
  return { user, token: createToken(user) };
}

async function login(username, password) {
  const remain = loginLockRemainingMs(username);
  if (remain > 0) {
    return { error: '登录失败次数过多，请稍后再试', locked: true, retryAfter: Math.ceil(remain / 1000) };
  }
  const db = getDb();
  const row = db.prepare('SELECT id, username, nickname, password, role FROM users WHERE username = ?').get(username);
  if (!row) {
    // 用假 bcrypt 对比抹平时间差，避免通过响应时差枚举用户名
    await bcrypt.compare(password, DUMMY_HASH);
    recordLoginFail(username);
    return { error: '用户名或密码错误' };
  }
  const ok = await bcrypt.compare(password, row.password);
  if (!ok) {
    recordLoginFail(username);
    return { error: '用户名或密码错误' };
  }
  clearLoginFails(username);
  const user = { id: row.id, username: row.username, nickname: row.nickname || '', role: row.role || 'user' };
  return { user, token: createToken(user) };
}

// 管理员重置用户密码：校验同注册，重哈希后落库，并清除该账号的登录锁定
async function resetPassword(username, newPassword) {
  const pwErr = validatePassword(newPassword);
  if (pwErr) return { error: pwErr };
  const db = getDb();
  const user = db.prepare('SELECT id, username FROM users WHERE username = ?').get(username);
  if (!user) return { error: '用户不存在' };
  const hash = await bcrypt.hash(newPassword, 10);
  // 密码变更：纪元 +1 吊销该用户全部旧 token（含可能已泄露的）
  db.prepare('UPDATE users SET password = ?, token_epoch = token_epoch + 1 WHERE username = ?').run(hash, username);
  clearLoginFails(username);
  return { user: { id: user.id, username: user.username } };
}

// 统一找回失败文案（不区分"用户名不存在/未绑联系方式/联系方式不匹配"，避免枚举账号）
const RECOVERY_GENERIC_ERROR = '用户名或注册联系方式不匹配，无法找回（未填邮箱/手机号的账号请联系管理员重置密码）';

// 无验证码自助找回：凭「用户名 + 注册时填的邮箱/手机号」匹配成功即可重设密码。
// 邮箱/手机号相当于弱密码——用找回专用限流 + 复用登录锁定（失败计入 5 次/15 分钟）兜底。
async function recoverPassword(username, email, phone, newPassword) {
  if (!username) return { error: RECOVERY_GENERIC_ERROR };
  const remain = loginLockRemainingMs(username);
  if (remain > 0) {
    return { error: '找回尝试过于频繁，请稍后再试', locked: true, retryAfter: Math.ceil(remain / 1000) };
  }
  const pwErr = validatePassword(newPassword);
  if (pwErr) return { error: pwErr };

  const providedEmail = String(email || '').trim().toLowerCase();
  const providedPhone = String(phone || '').trim();
  if (!providedEmail && !providedPhone) return { error: '请填写注册时使用的邮箱或手机号（至少填一个）' };

  const db = getDb();
  const row = db.prepare('SELECT id, username, email, phone FROM users WHERE username = ?').get(username);
  if (!row) { recordLoginFail(username); return { error: RECOVERY_GENERIC_ERROR }; }

  const storedEmail = String(row.email || '').trim().toLowerCase();
  const storedPhone = String(row.phone || '').trim();
  if (!storedEmail && !storedPhone) { recordLoginFail(username); return { error: RECOVERY_GENERIC_ERROR }; }

  const match = (providedEmail && storedEmail && providedEmail === storedEmail) ||
                (providedPhone && storedPhone && providedPhone === storedPhone);
  if (!match) { recordLoginFail(username); return { error: RECOVERY_GENERIC_ERROR }; }

  const hash = await bcrypt.hash(newPassword, 10);
  // 密码变更：纪元 +1 吊销该用户全部旧 token（含可能已泄露的）
  db.prepare('UPDATE users SET password = ?, token_epoch = token_epoch + 1 WHERE username = ?').run(hash, username);
  clearLoginFails(username);
  return { user: { id: row.id, username: row.username } };
}

function getContributions(userId) {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as count FROM items WHERE created_by = ?').get(userId);
  return row ? row.count : 0;
}

function getLeaderboard(limit = 10) {
  const db = getDb();
  return db.prepare(
    `SELECT u.username, u.id as userId, COUNT(*) as count
     FROM items i
     JOIN users u ON i.created_by = u.id
     WHERE i.created_by IS NOT NULL
     GROUP BY i.created_by
     ORDER BY count DESC
     LIMIT ?`
  ).all(limit);
}

function getUserRole(userId) {
  const db = getDb();
  const row = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
  return row ? row.role : null;
}

function isAdmin(userId) {
  return getUserRole(userId) === 'admin';
}

function isModerator(userId) {
  const role = getUserRole(userId);
  return role === 'admin' || role === 'moderator';
}

// Middleware: require admin role
function adminMiddleware(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  if (!isAdmin(req.user.id)) return res.status(403).json({ error: '需要管理员权限' });
  next();
}

// Middleware: require moderator or admin role
function moderatorMiddleware(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  if (!isModerator(req.user.id)) return res.status(403).json({ error: '需要管理员或版主权限' });
  next();
}

// Middleware: require specific role (factory function)
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '请先登录' });
    if (getUserRole(req.user.id) !== role) return res.status(403).json({ error: `需要 ${role} 权限` });
    next();
  };
}

// Check if user can modify item (owner or moderator/admin)
function canModifyItem(userId, itemOwnerId) {
  if (userId === itemOwnerId) return true;
  return isModerator(userId);
}

module.exports = {
  register, login, resetPassword, recoverPassword, validatePassword, authMiddleware, optionalAuth, getContributions, getLeaderboard,
  getUserRole, isAdmin, isModerator, adminMiddleware, moderatorMiddleware, requireRole, canModifyItem
};