// 首页口号 + 免责声明弹窗冒烟
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const TMP_DB = 'data/slogan-pw.db';
const PORT = 3120;
const BASE = 'http://localhost:' + PORT;

(async () => {
  const dbFull = path.resolve(ROOT, TMP_DB);
  for (const f of [dbFull, dbFull + '-wal', dbFull + '-shm']) { try { fs.unlinkSync(f); } catch (_) {} }
  const db = new Database(dbFull);
  db.exec('CREATE TABLE IF NOT EXISTS invite_codes (code TEXT PRIMARY KEY, created_by TEXT, used_by TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, used_at DATETIME)');
  db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('SLG01');
  db.close();
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
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

    await test('首页 banner 内渲染口号「Token 就是力量！」', async () => {
      await page.goto(BASE + '/', { waitUntil: 'networkidle' });
      const title = await page.locator('.hero__slogan').textContent();
      if (title.replace(/\s/g, '') !== 'Token就是力量！') throw new Error('口号不符: ' + title);
      // 旧的独立口号带应已移除
      const oldBand = await page.locator('.slogan').count();
      if (oldBand !== 0) throw new Error('旧 slogan 独立带应移除');
      const heroHas = await page.locator('.hero__glass .hero__slogan').count();
      if (heroHas !== 1) throw new Error('口号应在 banner 内');
    });

    await test('footer 免责声明与按钮同一水平行且可查看详情', async () => {
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      const text = await page.locator('.footer__disclaimer-text').textContent();
      if (!text.includes('聚合平台') || !text.includes('不提供')) throw new Error('摘要缺失');
      const link = page.locator('#disclaimerOpen');
      if (!(await link.isVisible())) throw new Error('查看详情按钮不可见');
      // 桌面端：文本与按钮垂直区间重叠 = 同一水平行
      const tb = await page.locator('.footer__disclaimer-text').boundingBox();
      const lb = await link.boundingBox();
      if (!tb || !lb) throw new Error('boundingBox 缺失');
      if (!((tb.y <= lb.y + lb.height) && (lb.y <= tb.y + tb.height))) {
        throw new Error('文本与按钮不在同一水平行: text.y=' + Math.round(tb.y) + ' btn.y=' + Math.round(lb.y));
      }
    });

    await test('点击打开完整免责声明弹窗，可关闭', async () => {
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await page.click('#disclaimerOpen');
      const modal = page.locator('#disclaimerModal');
      await modal.waitFor({ state: 'visible', timeout: 3000 });
      const body = await modal.locator('.disclaimer-body').textContent();
      for (const kw of ['平台性质', '内容来源', '使用风险', '第三方服务', '合规使用', '知识产权', '法律适用', '联系与反馈']) {
        if (!body.includes(kw)) throw new Error('完整声明缺章节: ' + kw);
      }
      await page.screenshot({ path: 'tests/disclaimer-modal.png' });
      await page.click('#disclaimerModal .modal__x');
      await modal.waitFor({ state: 'hidden', timeout: 3000 });
      await page.screenshot({ path: 'tests/home-slogan.png' });
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
    for (const f of [dbFull, dbFull + '-wal', dbFull + '-shm']) { try { fs.unlinkSync(f); } catch (_) {} }
  }
})();
