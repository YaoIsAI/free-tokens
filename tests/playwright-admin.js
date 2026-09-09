// 后台三功能冒烟：用户注册日历 / 邀请码 Tab / 教程拒绝理由
// 自起服（独立端口 + 临时 DB），管理员登录后逐一验证。
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const TMP_DB = 'data/admin-pw.db';
const PORT = 3115;
const BASE = 'http://localhost:' + PORT;

(async () => {
  const dbFull = path.resolve(ROOT, TMP_DB);
  for (const f of [dbFull, dbFull + '-wal', dbFull + '-shm']) { try { fs.unlinkSync(f); } catch (_) {} }

  const srv = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, DB_PATH: TMP_DB, PORT: String(PORT), JWT_SECRET: 'pw-secret' },
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  srv.stderr.on('data', (c) => { logs += c; });

  const results = [];
  async function test(name, fn) {
    try { await fn(); results.push({ name, status: 'PASS' }); console.log(`✓ ${name}`); }
    catch (e) { results.push({ name, status: 'FAIL', error: e.message }); console.log(`✗ ${name}: ${e.message}`); }
  }

  let browser;
  try {
    for (let i = 0; i < 40; i++) {
      try { const r = await fetch(BASE + '/api/health'); if (r.ok) break; } catch (_) {}
      await new Promise((r) => setTimeout(r, 250));
    }
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();

    // 管理员：注册 → 提升 admin → 登录 → 写入 localStorage
    const db = new Database(dbFull);
    db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('ADMINPW');
    db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('ADMINPW2');
    db.close();
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    const admin = await page.evaluate(async () => {
      const reg = await (await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'pw_admin', password: 'admin123456', inviteCode: 'ADMINPW' }) })).json();
      const login = await (await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'pw_admin', password: 'admin123456' }) })).json();
      return login;
    });
    const db2 = new Database(dbFull);
    db2.prepare("UPDATE users SET role = 'admin' WHERE username = 'pw_admin'").run();
    db2.close();
    const me = await page.evaluate(async (token) => {
      const res = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } });
      const d = await res.json();
      return d.user;
    }, admin.token);
    await page.evaluate(({ token, user }) => {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
    }, { token: admin.token, user: me });
    await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle' });

    await test('用户管理：注册日历渲染并可点日查看', async () => {
      await page.click('.dash__tab[data-tab="users"]');
      await page.waitForSelector('#userCal .points-cal__cell', { timeout: 5000 });
      const hasCount = await page.locator('#userCal .points-cal__cell.has-plus').count();
      if (hasCount < 1) throw new Error('注册日历应标记有注册的日期');
      const monthLabel = await page.locator('.dash__section.points-card .points-card__month').first().textContent();
      const y = new Date().getFullYear();
      if (monthLabel.indexOf(String(y) + '年') === -1) throw new Error('月份标签异常: ' + monthLabel);
      // 点一个有注册的日期 → 弹窗显示 pw_admin
      await page.click('#userCal .points-cal__cell.has-plus');
      await page.waitForSelector('.points-modal__box', { timeout: 5000 });
      const modalText = await page.locator('.points-modal__box').textContent();
      if (modalText.indexOf('pw_admin') === -1) throw new Error('注册用户弹窗应包含 pw_admin');
      await page.screenshot({ path: 'tests/admin-usercal.png' });
      await page.click('.points-modal__close');
    });

    await test('邀请码：未使用/已使用 Tab 分离', async () => {
      await page.click('.dash__tab[data-tab="invites"]');
      await page.waitForSelector('[data-invfilter="unused"]', { timeout: 5000 });
      // 生成 2 个邀请码
      await page.fill('#inviteCount', '2');
      await page.click('#genInviteBtn');
      await page.waitForTimeout(500);
      // 用掉一个：注册一个用户
      await page.evaluate(async () => {
        const codes = await (await fetch('/api/admin/invites', { headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } })).json();
        const unused = codes.find(c => !c.used_by);
        await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'pw_use' + Date.now(), password: 'pass123456', inviteCode: unused.code }) });
      });
      await page.waitForTimeout(400);
      await page.click('.dash__tab[data-tab="invites"]'); // 重新加载
      await page.waitForTimeout(500);
      const unusedText = await page.locator('[data-invfilter="unused"]').textContent();
      const usedText = await page.locator('[data-invfilter="used"]').textContent();
      const mUnused = unusedText.match(/（(\d+)）/);
      const mUsed = usedText.match(/（(\d+)）/);
      if (!mUnused || !mUsed) throw new Error('Tab 计数缺失');
      if (parseInt(mUsed[1], 10) < 1) throw new Error('已使用计数应 ≥1，实际 ' + mUsed[1]);
      // 切到已使用
      await page.click('[data-invfilter="used"]');
      await page.waitForTimeout(300);
      const rowCount = await page.locator('.dash-table tbody tr').count();
      if (rowCount < 1) throw new Error('已使用 Tab 应有记录');
      await page.screenshot({ path: 'tests/admin-invites.png' });
    });

    await test('教程审核：拒绝附理由并展示', async () => {
      // 用普通用户发一篇教程（先经管理员接口生成全新邀请码，避免与其他测试抢占）
      await page.evaluate(async () => {        const token = localStorage.getItem('token');
        const gen = await (await fetch('/api/admin/invites', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ count: 1 }) })).json();
        const code = gen.created && gen.created[0];
        const reg = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'au' + Date.now().toString().slice(-8), password: 'pass123456', inviteCode: code }) });
        const regJ = await reg.json();
        if (!reg.ok) return { gen, regStatus: reg.status, regErr: regJ.error };
        const pub = await fetch('/api/tutorials', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + regJ.token }, body: JSON.stringify({ title: '待拒绝教程', content: '正文内容', category: '教程' }) });
        const pubJ = await pub.json();
        return { gen, regStatus: reg.status, pubStatus: pub.status, pubErr: pubJ.error, pubId: pubJ.id };
      });
      await page.click('.dash__tab[data-tab="tutorials"]');
      try {
        await page.waitForSelector('[data-reject]', { timeout: 5000 });
      } catch (e) {
        const h = await page.evaluate(() => (document.getElementById('dashRoot') || {}).innerHTML || 'NO dashRoot');
        console.log('DASH HTML:', h.slice(0, 2500));
        throw e;
      }
      // 处理 prompt 对话框
      page.once('dialog', async (d) => { await d.accept('与 AI 无关，内容不完整'); });
      await page.click('[data-reject]');
      await page.waitForTimeout(600);
      const tableText = await page.locator('.dash-table').textContent();
      if (tableText.indexOf('已拒绝') === -1) throw new Error('审核列表应显示已拒绝状态');
      if (tableText.indexOf('拒绝理由：与 AI 无关') === -1) throw new Error('审核列表应显示拒绝理由');
      await page.screenshot({ path: 'tests/admin-reject.png' });
    });

    const fails = results.filter((r) => r.status === 'FAIL');
    console.log('\n后台冒烟: ' + (results.length - fails.length) + '/' + results.length + ' 通过');
    process.exitCode = fails.length ? 1 : 0;
  } catch (e) {
    console.log('✗ 冒烟异常: ' + e.message);
    if (logs) console.log('server stderr: ' + logs.slice(-400));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    srv.kill();
  }
})();
