const { nanoid } = require('nanoid');
const getDb = require('./db');

// 每日免费拉取额度：5 次/天；超出后每次扣 1 积分（版主/管理员豁免）
const FREE_PULLS_PER_DAY = 5;

// "今天"按东八区（UTC+8）算：用户主体在中国，服务器在悉尼（UTC+10），
// 若按服务器/UTC 切日会出现"上午额度还没重置"的困惑
function todayStr() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
function yesterdayStr() {
  return new Date(Date.now() + 8 * 3600 * 1000 - 86400 * 1000).toISOString().slice(0, 10);
}
function checkinPoints(streak) {
  if (streak % 30 === 0) return 6; // 30天里程碑：1+5
  if (streak % 7 === 0) return 3; // 7天连击：1+2
  return 1;
}

// 发放/扣除积分：事务内写流水 + 更新余额（userId 为空则跳过）
function awardPoints(userId, delta, reason, refId) {
  if (!userId) return;
  const db = getDb();
  db.transaction(() => {
    db.prepare('INSERT INTO points_log (id, user_id, delta, reason, ref_id) VALUES (?, ?, ?, ?, ?)')
      .run(nanoid(10), userId, delta, reason || '', refId || '');
    db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(delta, userId);
  })();
}

// 幂等发放：原子化（INSERT OR IGNORE 依赖部分唯一索引兜底并发双发）
function awardPointsOnce(userId, delta, reason, refId) {
  if (!userId) return;
  const db = getDb();
  try {
    db.transaction(() => {
      const res = db.prepare('INSERT OR IGNORE INTO points_log (id, user_id, delta, reason, ref_id) VALUES (?, ?, ?, ?, ?)')
        .run(nanoid(10), userId, delta, reason || '', refId || '');
      if (res.changes === 0) return;
      db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(delta, userId);
    })();
  } catch (_) {
    // 索引兜底已防重，忽略
  }
}

// 当前积分/额度状态（懒重置：日期变了按 0 计，不落库）
function getPointsState(userId) {
  const db = getDb();
  const user = db.prepare('SELECT points, pull_date, pull_count FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  const today = todayStr();
  const pullCountToday = user.pull_date === today ? (user.pull_count || 0) : 0;
  return {
    points: user.points || 0,
    freePullsPerDay: FREE_PULLS_PER_DAY,
    pullDate: today,
    pullCountToday,
    freeLeftToday: Math.max(0, FREE_PULLS_PER_DAY - pullCountToday)
  };
}

// 拉取计费：原子化（SELECT+校验在事务内重做，防并发穿透）
function consumePulls(userId, count, isStaff) {
  if (!userId || count <= 0) {
    return { freeUsed: 0, pointsUsed: 0, pointsRemaining: 0, freeLeftToday: FREE_PULLS_PER_DAY };
  }
  const db = getDb();
  let result = null;
  let err = null;
  try {
    db.transaction(() => {
      const user = db.prepare('SELECT points, pull_date, pull_count FROM users WHERE id = ?').get(userId);
      if (!user) { err = { error: '用户不存在' }; throw new Error('__ABORT__'); }
      if (isStaff) {
        result = { freeUsed: count, pointsUsed: 0, pointsRemaining: user.points || 0, freeLeftToday: FREE_PULLS_PER_DAY };
        return;
      }
      const today = todayStr();
      const pullCountToday = user.pull_date === today ? (user.pull_count || 0) : 0;
      const points = user.points || 0;
      const freeLeft = Math.max(0, FREE_PULLS_PER_DAY - pullCountToday);
      const freeUsed = Math.min(count, freeLeft);
      const need = count - freeUsed;
      if (need > points) { err = { error: `积分不足：本次需 ${need} 积分，当前 ${points} 分；发布 Token/教程/Skill、邀请、测评可得积分` }; throw new Error('__ABORT__'); }
      const newCount = pullCountToday + count;
      const newPoints = points - need;
      for (let i = 0; i < need; i++) {
        db.prepare('INSERT INTO points_log (id, user_id, delta, reason, ref_id) VALUES (?, ?, ?, ?, ?)')
          .run(nanoid(10), userId, -1, 'pull', 'recent');
      }
      const upd = db.prepare('UPDATE users SET points = ?, pull_date = ?, pull_count = ? WHERE id = ? AND points >= ?')
        .run(newPoints, today, newCount, userId, need);
      if (upd.changes === 0 && need > 0) { err = { error: '积分不足' }; throw new Error('__ABORT__'); }
      result = { freeUsed, pointsUsed: need, pointsRemaining: newPoints, freeLeftToday: Math.max(0, FREE_PULLS_PER_DAY - newCount) };
    })();
  } catch (e) {
    if (err) return err;
    if (e.message === '__ABORT__') return err || { error: '操作失败' };
    throw e;
  }
  return result || { error: '操作失败' };
}

// 查看扣费：首次查看一张卡片扣 1 积分（按卡去重，已扣过的不再扣；作者/版主豁免）
function consumeView(userId, itemId, isStaff, isAuthor) {
  if (!userId || !itemId) return { error: '参数缺失' };
  if (isStaff || isAuthor) return { cost: 0, already: false, exempt: true };
  const db = getDb();
  try {
    return db.transaction(() => {
      const existed = db.prepare("SELECT id FROM points_log WHERE user_id = ? AND reason = 'view' AND ref_id = ?").get(userId, itemId);
      if (existed) return { cost: 0, already: true };
      const user = db.prepare('SELECT points FROM users WHERE id = ?').get(userId);
      if (!user) throw new Error('USER_NOT_FOUND');
      const points = user.points || 0;
      if (points < 1) throw new Error('INSUFFICIENT');
      db.prepare('INSERT INTO points_log (id, user_id, delta, reason, ref_id) VALUES (?, ?, ?, ?, ?)')
        .run(nanoid(10), userId, -1, 'view', itemId);
      db.prepare('UPDATE users SET points = points - 1 WHERE id = ?').run(userId);
      const after = db.prepare('SELECT points FROM users WHERE id = ?').get(userId);
      return { cost: 1, pointsRemaining: after ? after.points : points - 1 };
    })();
  } catch (e) {
    if (e.message === 'USER_NOT_FOUND') return { error: '用户不存在' };
    if (e.message === 'INSUFFICIENT') {
      const u = getDb().prepare('SELECT points FROM users WHERE id = ?').get(userId);
      const have = u ? (u.points || 0) : 0;
      return { error: '积分不足：查看一张卡片需 1 积分，当前 ' + have + ' 分；发布 Token/教程/Skill、邀请、测评可得积分', need: 1, have };
    }
    if (String(e.message).includes('UNIQUE') || String(e.message).includes('unique')) {
      return { cost: 0, already: true };
    }
    throw e;
  }
}

// Skill 购买（0% 平台抽成）：事务内完成校验 + 扣买家 + 加作者 + 写 purchase + 写两条流水
// 任一失败整体回滚；唯一索引 (skill_id, buyer_id) 兜底并发重复购买
function purchaseSkill(skillId, buyerId) {
  if (!skillId || !buyerId) return { error: '参数缺失' };
  const db = getDb();
  let result = {};
  try {
    result = db.transaction(() => {
      const skill = db.prepare('SELECT id, author_id, price, status, current_version FROM skills WHERE id = ?').get(skillId);
      if (!skill) throw new Error('Skill 不存在');
      if (skill.status !== 'online') throw new Error('该 Skill 当前不可购买');
      if (skill.author_id === buyerId) throw new Error('不能购买自己发布的 Skill');
      if (!skill.current_version) throw new Error('该 Skill 暂无可购买版本');

      // 免费 Skill 不产生购买流水，直接授权
      if (skill.price <= 0) {
        const exist = db.prepare('SELECT id FROM skill_purchases WHERE skill_id = ? AND buyer_id = ?').get(skillId, buyerId);
        if (!exist) {
          db.prepare('INSERT INTO skill_purchases (id, skill_id, buyer_id, version_at_buy, price) VALUES (?, ?, ?, ?, ?)')
            .run(nanoid(10), skillId, buyerId, skill.current_version, 0);
        }
        return { price: 0, version: skill.current_version, free: true };
      }

      // 付费 Skill：校验余额
      const buyer = db.prepare('SELECT points FROM users WHERE id = ?').get(buyerId);
      if (!buyer || buyer.points < skill.price) {
        throw new Error(`积分不足：需 ${skill.price} 积分，当前 ${buyer ? buyer.points : 0} 分`);
      }

      // 已购买则幂等返回（不重复扣费）
      const exist = db.prepare('SELECT id FROM skill_purchases WHERE skill_id = ? AND buyer_id = ?').get(skillId, buyerId);
      if (exist) {
        return { price: skill.price, version: skill.current_version, free: false, already: true };
      }

      // 扣买家
      db.prepare('UPDATE users SET points = points - ? WHERE id = ?').run(skill.price, buyerId);
      db.prepare('INSERT INTO points_log (id, user_id, delta, reason, ref_id) VALUES (?, ?, ?, ?, ?)')
        .run(nanoid(10), buyerId, -skill.price, 'skill_buy', skillId);

      // 加作者（0% 抽成，全额到账）
      db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(skill.price, skill.author_id);
      db.prepare('INSERT INTO points_log (id, user_id, delta, reason, ref_id) VALUES (?, ?, ?, ?, ?)')
        .run(nanoid(10), skill.author_id, skill.price, 'skill_sell', skillId);

      // 写购买记录（永久授权）
      db.prepare('INSERT INTO skill_purchases (id, skill_id, buyer_id, version_at_buy, price) VALUES (?, ?, ?, ?, ?)')
        .run(nanoid(10), skillId, buyerId, skill.current_version, skill.price);

      return { price: skill.price, version: skill.current_version, free: false };
    })();
  } catch (e) {
    return { error: e.message };
  }
  return result;
}

// 签到状态（是否已签、连击数、上次日期、本月日历）
function getCheckinState(userId) {
  const db = getDb();
  const user = db.prepare('SELECT points, checkin_date, checkin_streak FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  const today = todayStr();
  const yesterday = yesterdayStr();
  const checkedToday = user.checkin_date === today;
  const streak = user.checkin_streak || 0;
  // 本月已签日期（用于日历打点）
  const month = today.slice(0, 7);
  const rows = db.prepare("SELECT checkin_date, streak, points FROM checkins WHERE user_id = ? AND checkin_date LIKE ? || '%' ORDER BY checkin_date").all(userId, month);
  const calendar = rows.map(r => r.checkin_date);
  // 总签到天数
  const totalRow = db.prepare('SELECT COUNT(*) as c FROM checkins WHERE user_id = ?').get(userId);
  return {
    today,
    checkedToday,
    streak: checkedToday ? streak : (user.checkin_date === yesterday ? streak : 0),
    lastCheckinDate: user.checkin_date || '',
    points: user.points || 0,
    calendar,
    total: totalRow ? totalRow.c : 0,
    month
  };
}

// 每日签到：事务内 幂等 + 连击 + 发分 + 写台账
function doCheckin(userId) {
  if (!userId) return { error: '参数缺失' };
  const db = getDb();
  const today = todayStr();
  const yesterday = yesterdayStr();
  try {
    return db.transaction(() => {
      const user = db.prepare('SELECT points, checkin_date, checkin_streak FROM users WHERE id = ?').get(userId);
      if (!user) throw new Error('用户不存在');
      if (user.checkin_date === today) {
        // 已签到：幂等返回，不重复发分
        const row = db.prepare('SELECT points, streak FROM checkins WHERE user_id = ? AND checkin_date = ?').get(userId, today);
        return { already: true, checkedToday: true, streak: user.checkin_streak || 0, points: row ? row.points : 1, today };
      }
      const baseStreak = user.checkin_date === yesterday ? (user.checkin_streak || 0) : 0;
      const newStreak = baseStreak + 1;
      const pts = checkinPoints(newStreak);
      // 幂等：points_log 唯一索引兜底
      const existed = db.prepare("SELECT id FROM points_log WHERE user_id = ? AND reason = 'checkin' AND ref_id = ?").get(userId, today);
      if (existed) {
        // 已有流水但 users 未更新（极罕见中断）：补 users
        db.prepare('UPDATE users SET checkin_date = ?, checkin_streak = ? WHERE id = ?').run(today, newStreak, userId);
        return { already: true, checkedToday: true, streak: newStreak, points: pts, today };
      }
      db.prepare('INSERT INTO points_log (id, user_id, delta, reason, ref_id) VALUES (?, ?, ?, ?, ?)')
        .run(nanoid(10), userId, pts, 'checkin', today);
      db.prepare('UPDATE users SET points = points + ?, checkin_date = ?, checkin_streak = ? WHERE id = ?')
        .run(pts, today, newStreak, userId);
      // 台账（IGNORE 防并发双插）
      db.prepare('INSERT OR IGNORE INTO checkins (id, user_id, checkin_date, streak, points) VALUES (?, ?, ?, ?, ?)')
        .run(nanoid(10), userId, today, newStreak, pts);
      const after = db.prepare('SELECT points FROM users WHERE id = ?').get(userId);
      return { ok: true, checkedToday: true, streak: newStreak, points: pts, today, pointsTotal: after ? after.points : (user.points || 0) + pts };
    })();
  } catch (e) {
    if (String(e.message).includes('UNIQUE') || String(e.message).includes('unique')) {
      const u = db.prepare('SELECT checkin_streak, checkin_date FROM users WHERE id = ?').get(userId);
      return { already: true, checkedToday: true, streak: u ? (u.checkin_streak || 0) : 0, today };
    }
    return { error: e.message };
  }
}

module.exports = { FREE_PULLS_PER_DAY, todayStr, yesterdayStr, checkinPoints, awardPoints, awardPointsOnce, getPointsState, getCheckinState, doCheckin, consumePulls, consumeView, purchaseSkill };
