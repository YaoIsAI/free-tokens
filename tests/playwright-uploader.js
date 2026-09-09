// 冒烟：可复用上传组件三合一在三个上传点都生效（点选/拖拽/粘贴/allowUrl/关窗不触发）
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const TMP_DB = path.resolve(__dirname, '../data/uploader.db');
try { fs.unlinkSync(TMP_DB); } catch (_) {}
try { fs.unlinkSync(TMP_DB + '-wal'); } catch (_) {}
try { fs.unlinkSync(TMP_DB + '-shm'); } catch (_) {}
process.env.DB_PATH = 'data/uploader.db';
process.env.PORT = '0';
process.env.JWT_SECRET = 'test-secret';
process.env.API_RATE_LIMIT_MAX = '100000';
process.env.WRITE_RATE_LIMIT_MAX = '100000';
process.env.ALLOW_PRIVATE_SSRF = '1';

const app = require('../server');
const getDb = require('../lib/db');

(async () => {
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('UP01');
  const server = app.listen(0, '127.0.0.1', async () => {
    const base = 'http://127.0.0.1:' + server.address().port;
    let fail = 0;
    const ok = (name, cond) => { if (cond) console.log('  PASS ' + name); else { fail++; console.log('  FAIL ' + name); } };
    const browser = await chromium.launch();
    try {
      const reg = await fetch(base + '/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'uprobot', password: 'pass123456', inviteCode: 'UP01' })
      }).then(r => r.json());
      const { token, user } = reg;
      // 造一篇带封面的教程，供后台编辑弹窗测初始值
      await fetch(base + '/api/tutorials', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ title: '上传组件测试', content: '正文', category: '经验分享', cover: 'https://example.com/cov.png' })
      }).then(r => r.json());

      const page = await browser.newPage();
      let uploadReqs = 0;
      page.on('request', r => { if (r.url().includes('/api/upload')) uploadReqs++; });
      await page.addInitScript(({ t, u }) => {
        localStorage.setItem('token', t);
        localStorage.setItem('user', JSON.stringify(u));
      }, { t: token, u: user });

      // ===== 1) 反馈弹窗 · 点选上传 =====
      await page.goto(base + '/', { waitUntil: 'networkidle' });
      await page.click('#footerFeedback');
      await page.waitForSelector('#fbUploadMount .uploader__zone', { timeout: 5000 });
      await page.setInputFiles('#fbUploadMount .uploader__zone input[type=file]',
        { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from(PNG_B64, 'base64') });
      await page.waitForSelector('#fbUploadMount .uploader__preview img', { timeout: 8000 });
      const fbVal = await page.inputValue('#fbImgVal');
      ok('反馈弹窗点选上传 → fbImgVal=/uploads/16hex.png', /^\/uploads\/[a-f0-9]{16}\.png$/.test(fbVal));
      ok('反馈弹窗预览出现', (await page.$('#fbUploadMount .uploader__preview img')) !== null);

      // ===== 2) 反馈弹窗 · 粘贴上传（先清空再粘贴） =====
      await page.click('#fbUploadMount .uploader__clear');
      await page.evaluate((b64) => {
        const dt = new DataTransfer();
        dt.items.add(new File([Uint8Array.from(atob(b64), function (c) { return c.charCodeAt(0); })], 'p.png', { type: 'image/png' }));
        document.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
      }, PNG_B64);
      await page.waitForSelector('#fbUploadMount .uploader__preview img', { timeout: 8000 });
      const fbVal2 = await page.inputValue('#fbImgVal');
      ok('反馈弹窗粘贴上传 → fbImgVal 更新', /^\/uploads\/[a-f0-9]{16}\.png$/.test(fbVal2) && fbVal2 !== fbVal);

      // ===== 3) 关窗后 Ctrl+V 不触发上传 =====
      await page.click('button[data-action="close-feedback"]');
      await page.waitForSelector('#feedbackModal:not(.modal--open)', { state: 'attached', timeout: 5000 });
      const before = uploadReqs;
      await page.evaluate(() => {
        const dt = new DataTransfer();
        dt.items.add(new File([new Uint8Array([1, 2, 3])], 'x.png', { type: 'image/png' }));
        document.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
      });
      await page.waitForTimeout(600);
      ok('弹窗关闭时粘贴不触发上传（无 /api/upload 请求）', uploadReqs === before);

      // ===== 4) 教程发布表单 · 拖拽封面上传 + allowUrl 互斥 =====
      await page.goto(base + '/tutorials', { waitUntil: 'networkidle' });
      await page.click('#tutPublishBtn');
      await page.waitForSelector('#tutCoverMount .uploader__zone', { timeout: 5000 });
      ok('发布表单渲染了外链 URL 输入框（allowUrl）', (await page.$('#tutCoverMount .uploader__url')) !== null);
      // 外链互斥：填 URL → cover=URL，无上传
      await page.fill('#tutCoverMount .uploader__url', 'https://img.example.com/cover.png');
      const coverUrlVal = await page.inputValue('#tutCoverVal');
      ok('填外链 URL → tutCoverVal=该 URL', coverUrlVal === 'https://img.example.com/cover.png');
      ok('填 URL 后无预览上传图', (await page.$('#tutCoverMount .uploader__preview img')) !== null);
      // 拖拽上传 → cover=/uploads，URL 被清空
      await page.evaluate((b64) => {
        const zone = document.querySelector('#tutCoverMount .uploader__zone');
        const dt = new DataTransfer();
        dt.items.add(new File([Uint8Array.from(atob(b64), function (c) { return c.charCodeAt(0); })], 'd.png', { type: 'image/png' }));
        zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      }, PNG_B64);
      await page.waitForSelector('#tutCoverMount .uploader__preview img', { timeout: 8000 });
      const coverVal = await page.inputValue('#tutCoverVal');
      const coverUrlAfter = await page.inputValue('#tutCoverMount .uploader__url');
      ok('拖拽上传 → tutCoverVal=/uploads/16hex.png', /^\/uploads\/[a-f0-9]{16}\.png$/.test(coverVal));
      ok('上传后外链 URL 被清空（互斥）', coverUrlAfter === '');

      // ===== 5) 后台编辑封面 · 挂载 + 初始值 =====
      await page.goto(base + '/dashboard', { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-tutedit]', { timeout: 8000 });
      await page.click('[data-tutedit]');
      await page.waitForSelector('#teCoverMount .uploader__zone', { timeout: 5000 });
      const teVal = await page.inputValue('#teCoverVal');
      ok('编辑弹窗挂载 uploader', (await page.$('#teCoverMount .uploader__zone')) !== null);
      ok('编辑弹窗初始值 = 已有封面 URL', teVal === 'https://example.com/cov.png');
      ok('编辑弹窗初始预览出现', (await page.$('#teCoverMount .uploader__preview img')) !== null);

      console.log(fail === 0 ? '\nALL PASS ✓' : '\n' + fail + ' FAILED ✗');
    } catch (e) {
      console.log('SCRIPT ERROR:', e.message);
      fail = 99;
    } finally {
      await browser.close();
      try { server.close(); } catch (_) {}
      try { db.close(); } catch (_) {}
      try { fs.unlinkSync(TMP_DB); } catch (_) {}
      try { fs.unlinkSync(TMP_DB + '-wal'); } catch (_) {}
      try { fs.unlinkSync(TMP_DB + '-shm'); } catch (_) {}
      process.exit(fail ? 1 : 0);
    }
  });
})();
