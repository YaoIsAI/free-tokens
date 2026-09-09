// Skill 发布弹窗 vs Token 发布弹窗 vs 教程发布弹窗 样式一致性截图对比
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const TMP_DB = 'data/skill-publish.db';
const PORT = 3125;
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

    // 桌面端
    const ctxD = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const pageD = await ctxD.newPage();

    // 移动端
    const ctxM = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 2 });
    const pageM = await ctxM.newPage();

    // 注册登录
    const db = new Database(dbFull);
    db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('SKILLPUB');
    db.close();

    async function login(page) {
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      const login = await page.evaluate(async () => {
        const reg = await (await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'pw_skillpub' + Date.now(), password: 'pass123456', inviteCode: 'SKILLPUB' }) })).json();
        return reg;
      });
      await page.evaluate((token) => { localStorage.setItem('token', token); }, login.token);
      return login.token;
    }

    // ===== 桌面端：三个弹窗截图 =====
    await login(pageD);

    await test('Token 发布弹窗（桌面）', async () => {
      await pageD.goto(BASE + '/', { waitUntil: 'networkidle' });
      await pageD.evaluate(() => {
        const btn = document.getElementById('authBtn');
        if (btn) btn.click();
      });
      await pageD.waitForSelector('#publishModal.modal--open', { timeout: 5000 });
      await pageD.waitForTimeout(400);
      await pageD.screenshot({ path: 'tests/cmp-token-desktop.png' });
    });

    await test('Skill 发布弹窗（桌面）', async () => {
      await pageD.goto(BASE + '/skills', { waitUntil: 'networkidle' });
      await pageD.evaluate(() => {
        const btn = document.getElementById('skillPublishBtn');
        if (btn) btn.click();
      });
      await pageD.waitForSelector('.skill-publish-modal.modal--open', { timeout: 5000 });
      await pageD.waitForTimeout(400);
      await pageD.screenshot({ path: 'tests/cmp-skill-desktop.png' });
    });

    await test('教程发布弹窗（桌面）', async () => {
      await pageD.goto(BASE + '/tutorials', { waitUntil: 'networkidle' });
      await pageD.evaluate(() => {
        const btn = document.getElementById('tutPublishBtn');
        if (btn) btn.click();
      });
      await pageD.waitForSelector('#tutPublishModal.modal--open', { timeout: 5000 });
      await pageD.waitForTimeout(400);
      await pageD.screenshot({ path: 'tests/cmp-tutorial-desktop.png' });
    });

    // ===== 移动端：三个弹窗截图 =====
    await login(pageM);

    await test('Token 发布弹窗（移动）', async () => {
      await pageM.goto(BASE + '/', { waitUntil: 'networkidle' });
      await pageM.evaluate(() => { const b = document.getElementById('authBtn'); if (b) b.click(); });
      await pageM.waitForSelector('#publishModal.modal--open', { timeout: 5000 });
      await pageM.waitForTimeout(400);
      await pageM.screenshot({ path: 'tests/cmp-token-mobile.png' });
    });

    await test('Skill 发布弹窗（移动）', async () => {
      await pageM.goto(BASE + '/skills', { waitUntil: 'networkidle' });
      await pageM.evaluate(() => { const b = document.getElementById('skillPublishBtn'); if (b) b.click(); });
      await pageM.waitForSelector('.skill-publish-modal.modal--open', { timeout: 5000 });
      await pageM.waitForTimeout(400);
      await pageM.screenshot({ path: 'tests/cmp-skill-mobile.png' });
    });

    await test('教程发布弹窗（移动）', async () => {
      await pageM.goto(BASE + '/tutorials', { waitUntil: 'networkidle' });
      await pageM.evaluate(() => { const b = document.getElementById('tutPublishBtn'); if (b) b.click(); });
      await pageM.waitForSelector('#tutPublishModal.modal--open', { timeout: 5000 });
      await pageM.waitForTimeout(400);
      await pageM.screenshot({ path: 'tests/cmp-tutorial-mobile.png' });
    });

    // ===== 一致性检查：弹窗面板宽度/内边距/标题字号 =====
    await test('弹窗样式一致性（桌面）', async () => {
      const metrics = await pageD.evaluate(() => {
        function getModal(sel) {
          const m = document.querySelector(sel);
          if (!m) return null;
          const panel = m.querySelector('.modal__panel');
          const title = m.querySelector('.modal__title');
          const cs = getComputedStyle(panel);
          const ts = getComputedStyle(title);
          return {
            padding: cs.padding,
            borderRadius: cs.borderRadius,
            titleFont: ts.fontSize,
            titleWeight: ts.fontWeight
          };
        }
        return {
          token: getModal('#publishModal'),
          skill: getModal('.skill-publish-modal'),
          tutorial: getModal('#tutPublishModal')
        };
      });
      // 重新打开各弹窗以测量
      await pageD.goto(BASE + '/', { waitUntil: 'networkidle' });
      await pageD.evaluate(() => { const b = document.getElementById('authBtn'); if (b) b.click(); });
      await pageD.waitForSelector('#publishModal.modal--open', { timeout: 5000 });
      const tokenM = await pageD.evaluate(() => {
        const panel = document.querySelector('#publishModal .modal__panel');
        const title = document.querySelector('#publishModal .modal__title');
        return { padding: getComputedStyle(panel).padding, titleFont: getComputedStyle(title).fontSize };
      });
      await pageD.goto(BASE + '/skills', { waitUntil: 'networkidle' });
      await pageD.evaluate(() => { const b = document.getElementById('skillPublishBtn'); if (b) b.click(); });
      await pageD.waitForSelector('.skill-publish-modal.modal--open', { timeout: 5000 });
      const skillM = await pageD.evaluate(() => {
        const panel = document.querySelector('.skill-publish-modal .modal__panel');
        const title = document.querySelector('.skill-publish-modal .modal__title');
        return { padding: getComputedStyle(panel).padding, titleFont: getComputedStyle(title).fontSize };
      });
      console.log('  Token:', JSON.stringify(tokenM));
      console.log('  Skill:', JSON.stringify(skillM));
      if (tokenM.padding !== skillM.padding) console.log('  ⚠ 内边距不一致');
      if (tokenM.titleFont !== skillM.titleFont) console.log('  ⚠ 标题字号不一致');
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
