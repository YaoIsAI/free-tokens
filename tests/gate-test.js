const { chromium } = require('playwright');
const BASE = 'http://localhost:3000';
const TOKEN = process.argv[2] || '';

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });

  // === 未登录状态 ===
  let page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.card', { timeout: 5000 });
  await page.click('.card');
  await page.waitForSelector('.token-lock', { timeout: 5000 });
  const hasMasked = await page.$('.token-masked');
  const lockText = await page.textContent('.token-lock');
  console.log('[未登录] 显示锁定提示:', JSON.stringify(lockText.trim()));
  console.log('[未登录] 无脱敏 token 框:', hasMasked === null ? 'PASS' : 'FAIL');

  // 点"登录"链接 → 打开登录弹窗
  await page.click('#tokenLoginLink');
  await page.waitForSelector('#authModal.modal--open', { timeout: 5000 });
  console.log('[未登录] 点击登录 → 登录弹窗打开: PASS');

  // === 登录状态（注入 token 后刷新） ===
  page = await ctx.newPage();
  await page.addInitScript((t) => {
    localStorage.setItem('token', t);
    localStorage.setItem('user', JSON.stringify({ id: 'x', username: 'gateowner' }));
  }, TOKEN);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.card', { timeout: 5000 });
  await page.click('.card');
  await page.waitForSelector('.token-masked', { timeout: 5000 });
  const masked = await page.textContent('.token-masked');
  const real = await page.getAttribute('.token-masked', 'data-token');
  console.log('[登录] masked:', JSON.stringify(masked), '| real len:', real.length);
  await page.click('.token-box .copy-btn');
  await page.waitForTimeout(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  console.log('[登录] 复制真实值:', clip === real ? 'PASS' : 'FAIL');

  await b.close();
})();
