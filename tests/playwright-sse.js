// SSE 实时推送冒烟：访问者首页收到 item_created → 顶部提示条出现 → 点击加载新卡片
// 自起服（独立端口 + 临时 DB），不依赖外部服务器。
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const TMP_DB = 'data/sse-pw.db';
const PORT = 3110;
const BASE = 'http://localhost:' + PORT;

(async () => {
  const dbFull = path.resolve(ROOT, TMP_DB);
  for (const f of [dbFull, dbFull + '-wal', dbFull + '-shm']) { try { fs.unlinkSync(f); } catch (_) {} }
  const db = new Database(dbFull);
  db.exec('CREATE TABLE IF NOT EXISTS invite_codes (code TEXT PRIMARY KEY, created_by TEXT, used_by TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, used_at DATETIME)');
  db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('SSEPW01');
  db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('SSEPW02');
  db.close();

  const srv = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, DB_PATH: TMP_DB, PORT: String(PORT), JWT_SECRET: 'pw-secret' },
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe']
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
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const visitor = await ctx.newPage();
    const publisher = await ctx.newPage();

    await test('首页加载并渲染提示条（初始隐藏）', async () => {
      await visitor.goto(BASE + '/', { waitUntil: 'networkidle' });
      const pill = visitor.locator('#newItemsPill');
      await pill.waitFor({ state: 'attached', timeout: 5000 });
      const visible = await pill.evaluate((el) => el.classList.contains('is-visible'));
      if (visible) throw new Error('提示条不应初始可见');
    });

    await test('发布新 Token 后卡片静默插入列表顶部（无需点击）', async () => {
      await publisher.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      const reg = await publisher.evaluate(async () => {
        const res = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'sse_pub', password: 'pass123456', inviteCode: 'SSEPW01' }) });
        const d = await res.json();
        if (!res.ok) throw new Error(JSON.stringify(d));
        return d;
      });
      const created = await publisher.evaluate(async (token) => {
        const res = await fetch('/api/items', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ name: 'SSE 静默卡片', url: 'https://example.com/api', category: '对话模型' }) });
        const d = await res.json();
        if (!res.ok) throw new Error(JSON.stringify(d));
        return d;
      }, reg.token);
      if (!created.id) throw new Error('发布失败');

      // 不点任何东西：等待新卡片静默出现在列表顶部
      await visitor.waitForSelector('.card:has-text("SSE 静默卡片")', { timeout: 5000 });
      const first = await visitor.locator('#grid .card').first().locator('.card__name').textContent();
      if (first.indexOf('SSE 静默卡片') === -1) throw new Error('新卡片应位于列表顶部，实际首卡: ' + first);
      const pillShown = await visitor.locator('#newItemsPill').evaluate((el) => el.classList.contains('is-visible'));
      if (pillShown) throw new Error('默认视图下应静默插入，不应出现提示条');
      const statTotal = (await visitor.locator('#statTotal').textContent()).trim();
      if (statTotal !== '1') throw new Error('统计应更新为 1，实际 ' + statTotal);
      await visitor.screenshot({ path: 'tests/sse-silent.png' });
    });

    await test('筛选视图（搜索）下回退为顶部提示条（点击加载）', async () => {
      // 输入搜索词触发筛选视图（searchQ 非空 → 回退提示条）
      await visitor.fill('#heroSearch', '过滤');
      await visitor.waitForTimeout(600); // 300ms 防抖 + 拉取
      const reg2 = await publisher.evaluate(async () => {
        const res = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'sse_pub2', password: 'pass123456', inviteCode: 'SSEPW02' }) });
        const d = await res.json();
        return d;
      });
      const created2 = await publisher.evaluate(async (token) => {
        const res = await fetch('/api/items', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ name: 'SSE 过滤卡片', url: 'https://example.com/chat', category: '对话模型' }) });
        const d = await res.json();
        return d;
      }, reg2.token);
      if (!created2.id) throw new Error('发布失败');

      const pill = visitor.locator('#newItemsPill');
      const t0 = Date.now();
      let shown = false;
      while (Date.now() - t0 < 5000) {
        shown = await pill.evaluate((el) => el.classList.contains('is-visible'));
        if (shown) break;
        await new Promise((r) => setTimeout(r, 150));
      }
      if (!shown) throw new Error('筛选视图下应出现提示条');
      const count = (await pill.locator('.new-items-pill__count').textContent()).trim();
      if (count !== '1') throw new Error('计数应为 1，实际 ' + count);
      await pill.screenshot({ path: 'tests/sse-pill.png' });
      await pill.click();
      await visitor.waitForSelector('.card:has-text("SSE 过滤卡片")', { timeout: 5000 });
      const gone = await pill.evaluate((el) => !el.classList.contains('is-visible'));
      if (!gone) throw new Error('点击后提示条应隐藏');
      await visitor.screenshot({ path: 'tests/sse-home.png', fullPage: false });
    });

    const fails = results.filter((r) => r.status === 'FAIL');
    console.log('\nSSE 冒烟: ' + (results.length - fails.length) + '/' + results.length + ' 通过');
    process.exitCode = fails.length ? 1 : 0;
  } catch (e) {
    console.log('✗ 冒烟异常: ' + e.message);
    if (logs) console.log('server stderr: ' + logs.slice(-500));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    srv.kill();
  }
})();
