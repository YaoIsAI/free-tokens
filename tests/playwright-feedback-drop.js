// 聚焦冒烟：公社信箱图片上传三合一（点击 / 拖拽 / 粘贴）
// 用法：先 DB_PATH=data/fbdrop.db PORT=3101 node server.js 起服，再
//       DB_PATH=data/fbdrop.db node tests/playwright-feedback-drop.js
const { chromium } = require('playwright');
const path = require('path');
const Database = require('better-sqlite3');

const BASE = process.env.BASE || 'http://localhost:3101';
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '../data/app.db');

// 1x1 透明 PNG（通过 magic number 校验）
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const results = [];

  async function test(name, fn) {
    try { await fn(); results.push({ name, status: 'PASS' }); console.log(`✓ ${name}`); }
    catch (e) { results.push({ name, status: 'FAIL', error: e.message }); console.log(`✗ ${name}: ${e.message}`); }
  }

  // 注册用户并注入 localStorage（复用 playwright-test.js 模式）
  const db = new Database(DB_PATH);
  const code = 'FBD' + Math.random().toString(36).slice(2, 8).toUpperCase();
  db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run(code);
  db.close();
  const username = 'fbu' + Math.floor(Math.random() * 1e6);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const reg = await page.evaluate(async ({ username, code }) => {
    const r = await fetch('/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'pass123456', inviteCode: code })
    });
    const d = await r.json();
    return { ok: r.ok, data: d };
  }, { username, code });
  if (!reg.ok) throw new Error('注册失败: ' + JSON.stringify(reg.data));
  await page.evaluate((d) => {
    localStorage.setItem('token', d.token);
    localStorage.setItem('user', JSON.stringify(d.user));
  }, reg.data);
  await page.goto(BASE, { waitUntil: 'networkidle' });

  // 打开公社信箱弹窗
  await test('打开公社信箱弹窗', async () => {
    await page.click('#footerFeedback');
    await page.waitForSelector('#feedbackModal.modal--open', { timeout: 3000 });
  });

  await test('拖拽区渲染提示文案 + 虚线类', async () => {
    const hint = await page.textContent('.fb-img__hint');
    if (!hint || !hint.includes('点击选择') || !hint.includes('拖拽') || !hint.includes('粘贴')) {
      throw new Error('提示文案不符: ' + hint);
    }
    const zoneBorder = await page.$eval('.fb-img__zone', el => getComputedStyle(el).borderTopStyle);
    if (zoneBorder !== 'dashed') throw new Error('拖拽区不是虚线: ' + zoneBorder);
  });

  await test('入口1 点击浏览上传（setInputFiles）', async () => {
    const bytes = Buffer.from(PNG_B64, 'base64');
    await page.setInputFiles('#fbFile', { name: 'click.png', mimeType: 'image/png', buffer: bytes });
    await page.waitForSelector('#fbPreview img', { timeout: 5000 });
    const val = await page.$eval('#fbImgVal', el => el.value);
    if (!val || !/^\/uploads\/[a-f0-9]{16}\.png$/.test(val)) throw new Error('上传 URL 非法: ' + val);
    await page.click('#fbImgClear');
    const cleared = await page.$eval('#fbImgVal', el => el.value);
    if (cleared !== '') throw new Error('移除后未清空');
  });

  await test('入口2 拖拽上传（drop 事件）', async () => {
    await page.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const file = new File([bytes], 'drop.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const ev = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
      document.getElementById('fbDrop').dispatchEvent(ev);
    }, PNG_B64);
    await page.waitForSelector('#fbPreview img', { timeout: 5000 });
    const val = await page.$eval('#fbImgVal', el => el.value);
    if (!/^\/uploads\/[a-f0-9]{16}\.png$/.test(val)) throw new Error('拖拽上传 URL 非法: ' + val);
    await page.click('#fbImgClear');
  });

  await test('入口3 剪贴板粘贴上传（paste 事件）', async () => {
    await page.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const file = new File([bytes], 'paste.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      document.dispatchEvent(ev);
    }, PNG_B64);
    await page.waitForSelector('#fbPreview img', { timeout: 5000 });
    const val = await page.$eval('#fbImgVal', el => el.value);
    if (!/^\/uploads\/[a-f0-9]{16}\.png$/.test(val)) throw new Error('粘贴上传 URL 非法: ' + val);
    await page.click('#fbImgClear');
  });

  await test('粘贴非图片文本不拦截', async () => {
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(['你好'], 'a.txt', { type: 'text/plain' }));
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      document.dispatchEvent(ev);
    });
    await page.waitForTimeout(300);
    const previewed = await page.$('#fbPreview img');
    // 文本粘贴不应触发上传/预览
    if (previewed) throw new Error('文本粘贴误触发了上传');
  });

  const passed = results.filter(r => r.status === 'PASS').length;
  console.log(`\n通过: ${passed}/${results.length}`);
  await browser.close();
  process.exit(results.some(r => r.status === 'FAIL') ? 1 : 0);
})();
