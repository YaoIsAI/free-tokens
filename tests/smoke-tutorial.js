// 教程封面：杂志风卡片 + 渐变占位 + 详情封面 + 上传冒烟
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const TMP_DB = 'data/tut-pw.db';
const PORT = 3182;
const BASE = 'http://localhost:' + PORT;
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

(async () => {
  const dbFull = path.resolve(ROOT, TMP_DB);
  for (const f of [dbFull, dbFull + '-wal', dbFull + '-shm']) { try { fs.unlinkSync(f); } catch (_) {} }
  const db = new Database(dbFull);
  db.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE, password TEXT, email TEXT DEFAULT '', phone TEXT DEFAULT '', role TEXT DEFAULT 'user', points INTEGER DEFAULT 0, pull_date TEXT DEFAULT '', pull_count INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.exec(`CREATE TABLE IF NOT EXISTS invite_codes (code TEXT PRIMARY KEY, created_by TEXT, used_by TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, used_at DATETIME)`);
  db.exec(`CREATE TABLE IF NOT EXISTS tutorials (id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT DEFAULT '', content TEXT NOT NULL, category TEXT DEFAULT '教程', tags TEXT DEFAULT '[]', created_by TEXT, verified INTEGER DEFAULT 0, reject_reason TEXT DEFAULT '', cover TEXT DEFAULT '', created_at TEXT, updated_at TEXT)`);
  db.prepare('INSERT INTO invite_codes (code) VALUES (?)').run('TUT1');
  const now = new Date().toISOString();
  db.prepare('INSERT INTO users (id, username, password, role) VALUES (?,?,?,?)').run('u1', 'tutuser', 'x', 'admin');
  db.prepare('INSERT INTO tutorials (id, title, summary, content, category, tags, created_by, verified, cover, created_at, updated_at) VALUES (?,?,?,?,?,?,?,1,?,?,?)')
    .run('tutc1', '带封面教程', '这张卡片有真实封面图', '# 正文', 'OpenAI', '["openai"]', 'u1', '/uploads/SEED.png', now, now);
  db.prepare('INSERT INTO tutorials (id, title, summary, content, category, tags, created_by, verified, created_at, updated_at) VALUES (?,?,?,?,?,?,?,1,?,?)')
    .run('tutc2', '渐变占位教程', '这张卡片无图，用分类渐变占位', '# 正文', 'Anthropic', '["claude"]', 'u1', now, now);
  db.close();
  const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, DB_PATH: TMP_DB, PORT: String(PORT), JWT_SECRET: 's', API_RATE_LIMIT_MAX: '100000', WRITE_RATE_LIMIT_MAX: '100000' }, cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; srv.stderr.on('data', c => logs += c);
  // 放一张真实封面图到 uploads 目录
  try { fs.mkdirSync(path.resolve(ROOT, 'data/uploads'), { recursive: true }); fs.writeFileSync(path.resolve(ROOT, 'data/uploads/SEED.png'), TINY_PNG); } catch (_) {}
  const results = [];
  async function test(name, fn) {
    try { await fn(); results.push({ name, status: 'PASS' }); console.log('✓ ' + name); }
    catch (e) { results.push({ name, status: 'FAIL', error: e.message }); console.log('✗ ' + name + ': ' + e.message); }
  }
  let browser;
  try {
    for (let i = 0; i < 40; i++) { try { const r = await fetch(BASE + '/api/health'); if (r.ok) break; } catch (_) {} await new Promise(r => setTimeout(r, 250)); }

    let AUTH = '';
    await test('POST /api/upload 上传 PNG 返回 /uploads/ 地址', async () => {
      // 登录或注册一个用户拿 token
      let tok = '';
      const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'uptut', password: 'Pass1234' }) });
      if (login.ok) tok = (await login.json()).token;
      else {
        const reg = await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'uptut', password: 'Pass1234', inviteCode: 'TUT1' }) });
        if (!reg.ok) throw new Error('注册失败 ' + reg.status);
        tok = (await reg.json()).token;
      }
      if (!tok) throw new Error('拿不到 token');
      AUTH = tok;
      const up = await fetch(BASE + '/api/upload', { method: 'POST', headers: { 'Content-Type': 'image/png', 'Authorization': 'Bearer ' + tok }, body: TINY_PNG });
      if (up.status !== 200) throw new Error('status ' + up.status + ' ' + (await up.text()));
      const d = await up.json();
      if (!/^\/uploads\/.+\.png$/.test(d.url)) throw new Error('url 不对: ' + d.url);
    });

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

    await test('列表页：有封面卡显示 img，无封面卡显示渐变占位', async () => {
      await page.goto(BASE + '/tutorials', { waitUntil: 'networkidle' });
      await page.locator('.tut-card').first().waitFor({ state: 'visible', timeout: 5000 });
      const cards = page.locator('.tut-card');
      const n = await cards.count();
      if (n < 2) throw new Error('卡片数量不对: ' + n);
      let hasImgCover = false, hasGradCover = false;
      for (let i = 0; i < n; i++) {
        const c = cards.nth(i);
        const cls = await c.getAttribute('class');
        if (await c.locator('.tut-card__cover-img').count() > 0) hasImgCover = true;
        if (/\btut-card__cover--g\d\b/.test(cls) && await c.locator('.tut-card__cover-img').count() === 0) hasGradCover = true;
        if (await c.locator('.tut-card__cover-icon').count() > 0 && await c.locator('.tut-card__cover-img').count() === 0) hasGradCover = true;
      }
      if (!hasImgCover) throw new Error('缺少带图片的封面卡');
      if (!hasGradCover) throw new Error('缺少渐变占位封面卡');
      // 标题应浮在封面区（.tut-card__cover 内）
      const overlayTitles = await page.locator('.tut-card__cover .tut-card__title').count();
      if (overlayTitles < 1) throw new Error('标题未浮在封面上');
      // 封面应有分类徽章
      if (await page.locator('.tut-card__cover .tut-card__badge').count() < 1) throw new Error('封面缺少分类徽章');
      // 底部发布者/时间独立一行且不换行（y 坐标一致）
      const foot = page.locator('.tut-card__foot').first();
      if (await foot.count() === 0) throw new Error('缺少底部发布者/时间条');
      const ay = await page.evaluate(() => {
        const f = document.querySelector('.tut-card__foot');
        if (!f) return null;
        const a = f.querySelector('.tut-card__author');
        const d = f.querySelector('.tut-card__date');
        if (!a || !d) return null;
        const ar = a.getBoundingClientRect(), dr = d.getBoundingClientRect();
        return { sameRow: Math.abs(ar.top - dr.top) < 2, wrapped: dr.top > ar.top + 4 };
      });
      if (!ay || !ay.sameRow) throw new Error('发布者/时间未在同一行: ' + JSON.stringify(ay));
      await page.screenshot({ path: 'tests/tut-list.png', fullPage: false });
    });

    await test('详情页：有 cover 显示封面图', async () => {
      await page.goto(BASE + '/tutorials/tutc1', { waitUntil: 'networkidle' });
      const img = page.locator('.tut-detail__cover');
      if (await img.count() === 0) throw new Error('详情页缺少封面图');
      const src = await img.getAttribute('src');
      if (src.indexOf('/uploads/SEED.png') === -1) throw new Error('封面 src 不对: ' + src);
    });

    await test('详情页：无 cover 不渲染封面区', async () => {
      await page.goto(BASE + '/tutorials/tutc2', { waitUntil: 'networkidle' });
      if (await page.locator('.tut-detail__cover').count() > 0) throw new Error('无 cover 不应显示封面');
    });

    await test('发布弹窗含封面控件', async () => {
      await page.goto(BASE + '/tutorials', { waitUntil: 'networkidle' });
      await page.evaluate(function (t) { window.TokenApp.setAuth(t, { id: 'uptut', username: 'uptut', role: 'user' }); }, AUTH);
      await page.click('#tutPublishBtn');
      const modal = page.locator('#tutPublishModal');
      await modal.waitFor({ state: 'visible', timeout: 4000 });
      const body = await modal.textContent();
      if (!body.includes('上传图片')) throw new Error('缺少上传图片按钮');
      if (!body.includes('封面图')) throw new Error('缺少封面图字段');
      if (await page.locator('#tutCoverFile').count() === 0) throw new Error('缺少 file input');
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
    try { fs.unlinkSync(path.resolve(ROOT, 'data/uploads/SEED.png')); } catch (_) {}
  }
})();
