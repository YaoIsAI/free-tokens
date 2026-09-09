// 首页 Banner 双列紧凑 + 独立全宽搜索条（搜索框 + 发布按钮同一行）冒烟
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const TMP_DB = 'data/banner-pw.db';
const PORT = 3130;
const BASE = 'http://localhost:' + PORT;

(async () => {
  const dbFull = path.resolve(ROOT, TMP_DB);
  for (const f of [dbFull, dbFull + '-wal', dbFull + '-shm']) { try { fs.unlinkSync(f); } catch (_) {} }
  const db = new Database(dbFull);
  db.exec('CREATE TABLE IF NOT EXISTS invite_codes (code TEXT PRIMARY KEY, created_by TEXT, used_by TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, used_at DATETIME)');
  db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('BNR01');
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
    await test('桌面端：Banner 双列变窄 + 搜索/发布同一行 + 数据卡分段面板', async () => {
      await page.goto(BASE + '/', { waitUntil: 'networkidle' });
      const glass = page.locator('.hero__glass');
      await glass.waitFor({ state: 'visible', timeout: 3000 });
      const box = await glass.boundingBox();
      if (!box) throw new Error('hero__glass boundingBox 缺失');
      console.log(`  → hero 高度 ${Math.round(box.height)}px (目标 < 300px)`);
      if (box.height > 300) throw new Error('Banner 仍然过高: ' + Math.round(box.height) + 'px');
      // 搜索条在 Banner 下方
      const searchBar = await page.locator('#heroSearchBar').boundingBox();
      if (!(searchBar.y > box.y + box.height)) throw new Error('搜索条应在 Banner 下方');
      // 发布按钮与搜索框同一行（垂直区间重叠），且在搜索框右侧
      const inputBox = await page.locator('#heroSearch').boundingBox();
      const pubBox = await page.locator('#heroPublishBtn').boundingBox();
      if (!inputBox || !pubBox) throw new Error('input/pub boundingBox 缺失');
      const sameRow = (pubBox.y <= inputBox.y + inputBox.height) && (inputBox.y <= pubBox.y + pubBox.height);
      if (!sameRow) throw new Error('发布按钮未与搜索框同一行: input.y=' + Math.round(inputBox.y) + ' btn.y=' + Math.round(pubBox.y));
      if (!(pubBox.x >= inputBox.x + inputBox.width)) throw new Error('发布按钮应在搜索框右侧');
      // 按钮与搜索框高度一致、顶部对齐（视觉统一）
      console.log(`  → input 高 ${Math.round(inputBox.height)}px, btn 高 ${Math.round(pubBox.height)}px, y 差 ${Math.round(pubBox.y - inputBox.y)}px`);
      if (Math.abs(inputBox.height - pubBox.height) > 2) throw new Error('按钮与搜索框高度不一致: input=' + Math.round(inputBox.height) + ' btn=' + Math.round(pubBox.height));
      if (Math.abs(inputBox.y - pubBox.y) > 2) throw new Error('按钮与搜索框未顶部对齐');
      // Banner 右列只剩数据卡：发布按钮不在 Banner 内
      if (!(pubBox.y > box.y + box.height)) throw new Error('发布按钮应移出 Banner');
      await page.screenshot({ path: 'tests/banner-desktop.png' });
    });

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await test('移动端：纵向堆叠，发布按钮换行到搜索框下方', async () => {
      await mobile.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      const inputBox = await mobile.locator('#heroSearch').boundingBox();
      const pubBox = await mobile.locator('#heroPublishBtn').boundingBox();
      if (!inputBox || !pubBox) throw new Error('boundingBox 缺失');
      if (!(pubBox.y > inputBox.y + inputBox.height)) throw new Error('移动端发布按钮应换行到搜索框下方');
      await mobile.screenshot({ path: 'tests/banner-mobile.png' });
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
