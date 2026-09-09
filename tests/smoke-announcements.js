// 公告功能冒烟：API + CLI + 首页公告栏渲染
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { spawn, execFileSync } = require('child_process');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const TMP_DB = 'data/ann-pw.db';
const TMP_HOME = path.resolve(__dirname, 'tmp-home-ann');
const PORT = 3140;
const BASE = 'http://localhost:' + PORT;

(async () => {
  const dbFull = path.resolve(ROOT, TMP_DB);
  for (const f of [dbFull, dbFull + '-wal', dbFull + '-shm']) { try { fs.unlinkSync(f); } catch (_) {} }
  try { fs.rmSync(TMP_HOME, { recursive: true, force: true }); } catch (_) {}
  fs.mkdirSync(TMP_HOME, { recursive: true });
  const db = new Database(dbFull);
  db.exec(`CREATE TABLE IF NOT EXISTS invite_codes (code TEXT PRIMARY KEY, created_by TEXT, used_by TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, used_at DATETIME)`);
  db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('ANN01');
  const cliEnv = { ...process.env, TOKEN_API: BASE, HOME: TMP_HOME };
  const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, DB_PATH: TMP_DB, PORT: String(PORT), JWT_SECRET: 's' }, cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; srv.stderr.on('data', c => logs += c);
  const results = [];
  async function test(name, fn) {
    try { await fn(); results.push({ name, status: 'PASS' }); console.log(`✓ ${name}`); }
    catch (e) { results.push({ name, status: 'FAIL', error: e.message }); console.log(`✗ ${name}: ${e.message}`); }
  }
  let browser;
  try {
    for (let i = 0; i < 40; i++) { try { const r = await fetch(BASE + '/api/health'); if (r.ok) break; } catch (_) {} await new Promise(r => setTimeout(r, 250)); }

    await test('公开公告接口 200 且返回数组（初始空）', async () => {
      const r = await fetch(BASE + '/api/announcements');
      if (r.status !== 200) throw new Error('应 200，实际 ' + r.status);
      const d = await r.json();
      if (!Array.isArray(d.announcements)) throw new Error('应返回 announcements 数组');
    });

    await test('未登录发公告返回 401', async () => {
      const r = await fetch(BASE + '/api/admin/announcements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'x' }) });
      if (r.status !== 401) throw new Error('未登录应 401，实际 ' + r.status);
    });

    await test('CLI 注册普通用户，越权发公告被拒', async () => {
      execFileSync(process.execPath, ['cli.js', 'register', '-u', 'annuser1', '-p', 'Passw0rd1', '-c', 'ANN01'], { env: cliEnv, cwd: ROOT, stdio: 'pipe' });
      let denied = false;
      try {
        execFileSync(process.execPath, ['cli.js', 'admin', 'announcement', 'add', '越权公告'], { env: cliEnv, cwd: ROOT, stdio: 'pipe' });
      } catch (e) {
        denied = true;
        const out = String(e.stderr || '');
        if (!out.includes('403') && !out.includes('权限')) throw new Error('应 403/权限不足，输出: ' + out.slice(0, 120));
      }
      if (!denied) throw new Error('普通用户发公告应被拒绝，但成功了');
    });

    // 提升该用户为 admin（直接改 DB）
    db.prepare("UPDATE users SET role='admin' WHERE username='annuser1'").run();

    await test('CLI 管理员发布公告', async () => {
      execFileSync(process.execPath, ['cli.js', 'admin', 'announcement', 'add', '🔥 免费公益 Token 每日更新'], { env: cliEnv, cwd: ROOT, stdio: 'pipe' });
    });

    await test('公开接口能看到新公告', async () => {
      const d = await (await fetch(BASE + '/api/announcements')).json();
      if (!d.announcements.some(a => a.content.includes('每日更新'))) throw new Error('公开公告里找不到新发布内容');
    });

    await test('CLI admin announcements 列表（--json）', async () => {
      const out = String(execFileSync(process.execPath, ['cli.js', 'admin', 'announcements', '--json'], { env: cliEnv, cwd: ROOT, stdio: 'pipe' }));
      const parsed = JSON.parse(out);
      if (!parsed.ok || !parsed.data.some(a => a.content.includes('每日更新'))) throw new Error('列表异常');
    });

    await test('首页公告栏 SSR 渲染 + 双列 banner', async () => {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(BASE + '/', { waitUntil: 'networkidle' });
      const bar = page.locator('#annBar');
      await bar.waitFor({ state: 'visible', timeout: 3000 });
      const text = await bar.textContent();
      if (!text.includes('每日更新')) throw new Error('公告栏没渲染公告内容');
      if (!text.includes('全部')) throw new Error('公告栏缺少「全部」按钮');
      await page.screenshot({ path: 'tests/ann-bar.png' });
    });

    await test('点击「全部」打开公告弹窗', async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(BASE + '/', { waitUntil: 'networkidle' });
      await page.click('#annMoreBtn');
      const modal = page.locator('#listModal');
      await modal.waitFor({ state: 'visible', timeout: 3000 });
      const body = await modal.textContent();
      if (!body.includes('每日更新')) throw new Error('公告弹窗没内容');
      await page.screenshot({ path: 'tests/ann-modal.png' });
    });

    await test('CLI 下线公告后公开接口隐藏', async () => {
      const list = JSON.parse(String(execFileSync(process.execPath, ['cli.js', 'admin', 'announcements', '--json'], { env: cliEnv, cwd: ROOT, stdio: 'pipe' }))).data;
      const target = list.find(a => a.content.includes('每日更新'));
      if (!target) throw new Error('找不到目标公告');
      execFileSync(process.execPath, ['cli.js', 'admin', 'announcement', 'toggle', target.id], { env: cliEnv, cwd: ROOT, stdio: 'pipe' });
      const pub = await (await fetch(BASE + '/api/announcements')).json();
      if (pub.announcements.some(a => a.id === target.id)) throw new Error('下线后仍公开');
    });

    await test('CLI 删除公告', async () => {
      const list = JSON.parse(String(execFileSync(process.execPath, ['cli.js', 'admin', 'announcements', '--json'], { env: cliEnv, cwd: ROOT, stdio: 'pipe' }))).data;
      for (const a of list) {
        execFileSync(process.execPath, ['cli.js', 'admin', 'announcement', 'delete', a.id], { env: cliEnv, cwd: ROOT, stdio: 'pipe' });
      }
      const pub = await (await fetch(BASE + '/api/announcements')).json();
      if (pub.announcements.length) throw new Error('删除后仍有公开公告');
    });

    const fails = results.filter(r => r.status === 'FAIL');
    console.log('\n冒烟: ' + (results.length - fails.length) + '/' + results.length + ' 通过');
    process.exitCode = fails.length ? 1 : 0;
  } catch (e) {
    console.log('✗ 异常: ' + e.message);
    if (logs) console.log('stderr: ' + logs.slice(-300));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    srv.kill();
    try { db.close(); } catch (_) {}
    try { fs.rmSync(TMP_HOME, { recursive: true, force: true }); } catch (_) {}
    for (const f of [dbFull, dbFull + '-wal', dbFull + '-shm']) { try { fs.unlinkSync(f); } catch (_) {} }
  }
})();
