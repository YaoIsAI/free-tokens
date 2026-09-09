// 验证：详情弹窗 token 脱敏 + 自动测试展示模型列表
const { chromium } = require('playwright');
const BASE = 'http://localhost:3000';

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });

  // 打开第一张卡片详情（有 token 的条目）
  await page.waitForSelector('.card', { timeout: 5000 });
  await page.click('.card');
  await page.waitForSelector('#testTokenBtn', { timeout: 5000 });

  // 1. 检查 token 脱敏
  const maskedText = await page.textContent('.token-masked');
  const realToken = await page.getAttribute('.token-masked', 'data-token');
  console.log('masked 显示:', JSON.stringify(maskedText));
  console.log('真实值长度:', realToken.length);
  const isMasked = maskedText.includes('•') && !maskedText.includes(realToken.slice(0, 20));
  console.log('[1] token 已脱敏:', isMasked ? 'PASS' : 'FAIL');

  // 2. 自动测试 + 模型列表（等待异步完成）
  await page.waitForSelector('#modelList .tag', { timeout: 15000 }).catch(() => {});
  const modelChips = await page.$$eval('#modelList .tag', els => els.map(e => e.textContent));
  console.log('[2] 自动模型列表:', modelChips.length ? modelChips.slice(0, 5).join(', ') : '(空，测试不可用则无)');

  // 3. 点击复制 → 剪贴板应为真实值
  await page.click('.token-box .copy-btn');
  await page.waitForTimeout(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  console.log('[3] 复制获取真实值:', clip === realToken ? 'PASS' : ('FAIL (clip=' + String(clip).slice(0, 10) + ')'));

  await browser.close();
})();
