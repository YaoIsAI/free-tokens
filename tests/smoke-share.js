// 一键分享 + 动态 OG 缩略图冒烟
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const TMP_DB = 'data/share-pw.db';
const PORT = 3180;
const BASE = 'http://localhost:' + PORT;

(async () => {
  const dbFull = path.resolve(ROOT, TMP_DB);
  for (const f of [dbFull, dbFull + '-wal', dbFull + '-shm']) { try { fs.unlinkSync(f); } catch (_) {} }
  const db = new Database(dbFull);
  db.exec(`CREATE TABLE IF NOT EXISTS invite_codes (code TEXT PRIMARY KEY, created_by TEXT, used_by TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, used_at DATETIME)`);
  db.exec(`CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, name TEXT, desc TEXT, url TEXT, provider TEXT, category TEXT, token TEXT, token_type TEXT, tags TEXT, compat TEXT DEFAULT '[]', models TEXT DEFAULT '[]', created_by TEXT, verified INTEGER DEFAULT 0, created_at DATETIME, updated_at DATETIME)`);
  db.exec(`CREATE TABLE IF NOT EXISTS tutorials (id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT DEFAULT '', content TEXT NOT NULL, category TEXT DEFAULT '教程', tags TEXT, created_by TEXT, verified INTEGER DEFAULT 0, created_at DATETIME, updated_at DATETIME)`);
  db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('SHR01');
  const now = new Date().toISOString();
  db.prepare('INSERT INTO items (id, name, desc, url, provider, category, token, token_type, verified, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,1,?,?)')
    .run('itm1', 'DeepSeek 免费 Token', '聊天/代码都强，公益发放', 'https://api.deepseek.com/v1', 'DeepSeek', '对话模型', 'sk-xxx', 'OpenAI', now, now);
  db.prepare('INSERT INTO tutorials (id, title, summary, content, category, verified, created_at, updated_at) VALUES (?,?,?,?,?,1,?,?)')
    .run('tut1', '用 Python 三步接入 OpenAI 兼容接口', '一篇实战教程，免费 Token 也能跑通', '# 教程\n\n正文内容。', 'AI 入门', now, now);
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

    await test('GET /og/item/:id.png 返回 PNG', async () => {
      const r = await fetch(BASE + '/og/item/itm1.png');
      if (r.status !== 200) throw new Error('status ' + r.status);
      const ct = r.headers.get('content-type') || '';
      if (!ct.includes('image/png')) throw new Error('content-type: ' + ct);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.slice(0, 4).toString('hex') !== '89504e47') throw new Error('非 PNG');
      console.log('  → item og', buf.length, 'bytes');
    });

    await test('GET /og/tutorial/:id.png 返回 PNG', async () => {
      const r = await fetch(BASE + '/og/tutorial/tut1.png');
      if (r.status !== 200) throw new Error('status ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.slice(0, 4).toString('hex') !== '89504e47') throw new Error('非 PNG');
      console.log('  → tut og', buf.length, 'bytes');
    });

    await test('GET /poster/site.png 返回 PNG（二维码海报）', async () => {
      const r = await fetch(BASE + '/poster/site.png');
      if (r.status !== 200) throw new Error('status ' + r.status);
      const ct = r.headers.get('content-type') || '';
      if (!ct.includes('image/png')) throw new Error('content-type: ' + ct);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.slice(0, 4).toString('hex') !== '89504e47') throw new Error('非 PNG');
      console.log('  → site poster', buf.length, 'bytes');
    });

    await test('GET /poster/item/:id.png + /poster/tutorial/:id.png 返回 PNG', async () => {
      for (const p of ['/poster/item/itm1.png', '/poster/tutorial/tut1.png']) {
        const r = await fetch(BASE + p);
        if (r.status !== 200) throw new Error(p + ' status ' + r.status);
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.slice(0, 4).toString('hex') !== '89504e47') throw new Error(p + ' 非 PNG');
        console.log('  →', p, buf.length, 'bytes');
      }
    });

    await test('POST /poster/item/notfound.png 返回 404', async () => {
      const r = await fetch(BASE + '/poster/item/notfound.png');
      if (r.status !== 404) throw new Error('status ' + r.status);
    });

    await test('首页 ?id= 注入条目专属 og 标签', async () => {
      const html = await (await fetch(BASE + '/?id=itm1')).text();
      if (!html.includes('og:image" content="' + BASE + '/og/item/itm1.png')) throw new Error('og:image 未注入');
      if (!html.includes('og:title" content="DeepSeek 免费 Token')) throw new Error('og:title 未注入');
    });

    await test('教程详情页注入专属 og + 分享按钮', async () => {
      const html = await (await fetch(BASE + '/tutorials/tut1')).text();
      if (!html.includes('og:image" content="' + BASE + '/og/tutorial/tut1.png')) throw new Error('教程 og:image 未注入');
      if (!html.includes('class="tut-share"')) throw new Error('教程分享按钮缺失');
      if (!html.includes('data-share-url="https://free-tokens.org/tutorials/tut1"')) throw new Error('分享 URL 缺失（应为 SEO 主域）');
    });

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await test('首页卡片有分享按钮，点击打开分享弹窗（复制+二维码）', async () => {
      await page.goto(BASE + '/', { waitUntil: 'networkidle' });
      const card = page.locator('.card').first();
      await card.waitFor({ state: 'visible', timeout: 3000 });
      const shareBtn = card.locator('.card__share');
      if (await shareBtn.count() === 0) throw new Error('卡片分享按钮缺失');
      await shareBtn.click();
      const modal = page.locator('#listModal');
      await modal.waitFor({ state: 'visible', timeout: 3000 });
      const body = await modal.textContent();
      if (!body.includes('分享')) throw new Error('分享弹窗未打开');
      if (!body.includes('复制图片')) throw new Error('缺复制图片按钮');
      if (!body.includes('复制链接')) throw new Error('缺复制链接按钮');
      // 海报图加载（二维码海报，非回退 dataURL）
      await page.waitForSelector('.share-panel__poster-img', { timeout: 4000 }).catch(function() { throw new Error('海报未加载'); });
      const posterSrc = await page.getAttribute('.share-panel__poster-img', 'src');
      if (!posterSrc || posterSrc.indexOf('/poster/item/itm1.png') === -1) throw new Error('海报 src 不对: ' + posterSrc);
      await page.screenshot({ path: 'tests/share-modal.png' });
      // 卡片分享不触发详情弹窗
      if (await page.locator('#modal.modal--open').count() > 0) throw new Error('点分享不应打开详情弹窗');
    });

    await test('教程详情页分享按钮可点开弹窗', async () => {
      await page.goto(BASE + '/tutorials/tut1', { waitUntil: 'domcontentloaded' });
      await page.click('.tut-share');
      const modal = page.locator('#listModal');
      await modal.waitFor({ state: 'visible', timeout: 3000 });
      const body = await modal.textContent();
      if (!body.includes('用 Python 三步接入')) throw new Error('分享弹窗标题不对');
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
