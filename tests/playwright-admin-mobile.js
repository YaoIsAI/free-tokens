// 后台管理移动端适配截图验证：管理员登录 → 各 Tab 移动端截图
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const TMP_DB = 'data/admin-mobile.db';
const PORT = 3120;
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
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();

    const db = new Database(dbFull);
    db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('ADMINMB');
    db.close();
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    const admin = await page.evaluate(async () => {
      const reg = await (await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'pw_mbadmin', password: 'admin123456', inviteCode: 'ADMINMB' }) })).json();
      const login = await (await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'pw_mbadmin', password: 'admin123456' }) })).json();
      return login;
    });
    const db2 = new Database(dbFull);
    db2.prepare("UPDATE users SET role = 'admin' WHERE username = 'pw_mbadmin'").run();
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

    const tabs = ['mine', 'users', 'audit', 'tutorials', 'skills', 'invites', 'announcements', 'feedback', 'visits', 'server'];
    for (const tab of tabs) {
      await test('Tab ' + tab + ' 移动端截图', async () => {
        await page.click('.dash__tab[data-tab="' + tab + '"]');
        await page.waitForTimeout(800);
        await page.screenshot({ path: 'tests/admin-mobile-' + tab + '.png', fullPage: true });
        // 检查标签栏是否溢出视口
        const overflow = await page.evaluate(() => {
          const tabs = document.querySelector('.dash__tabs');
          if (!tabs) return false;
          const rect = tabs.getBoundingClientRect();
          return rect.right > window.innerWidth + 1 || rect.left < -1;
        });
        if (overflow) throw new Error('标签栏溢出视口');
      });
    }

    // 检查表格是否可横向滚动（不溢出）
    await test('条目审核表格移动端不溢出', async () => {
      await page.click('.dash__tab[data-tab="audit"]');
      await page.waitForTimeout(800);
      const tableOverflow = await page.evaluate(() => {
        const table = document.querySelector('.dash-table');
        if (!table) return false;
        const rect = table.getBoundingClientRect();
        return rect.right > window.innerWidth + 1;
      });
      if (tableOverflow) throw new Error('表格溢出视口（应横向滚动）');
    });

  } catch (e) {
    console.error('FATAL:', e.message);
    console.error(logs.slice(-2000));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    srv.kill();
    for (const f of [dbFull, dbFull + '-wal', dbFull + '-shm']) { try { fs.unlinkSync(f); } catch (_) {} }
  }

  const failed = results.filter(r => r.status === 'FAIL');
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) { console.log('失败:', failed.map(f => f.name).join(', ')); process.exitCode = 1; }
})();
