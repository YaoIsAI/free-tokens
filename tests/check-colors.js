const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Check publish button contrast
  const pubBtn = await page.locator('#publishBtn');
  const pubBg = await pubBtn.evaluate(el => window.getComputedStyle(el).backgroundColor);
  const pubColor = await pubBtn.evaluate(el => window.getComputedStyle(el).color);
  console.log('发布Token按钮:', '\n  background:', pubBg, '\n  color:', pubColor);

  // Check card arrow (view detail button)
  const cardArrow = await page.locator('.card__arrow').first();
  const arrowBg = await cardArrow.evaluate(el => window.getComputedStyle(el).backgroundColor);
  const arrowColor = await cardArrow.evaluate(el => window.getComputedStyle(el).color);
  console.log('查看详情按钮:', '\n  background:', arrowBg, '\n  color:', arrowColor);

  // Screenshot for visual verification
  await page.screenshot({ path: 'C:/Users/yao/Desktop/token公益站/tests/screenshot-home.png', fullPage: false });
  console.log('\n截屏已保存到 tests/screenshot-home.png');

  // Open detail modal and check copy buttons
  await page.click('.card');
  await page.waitForSelector('#modal.modal--open', { timeout: 3000 });
  await page.waitForTimeout(800);

  const copyBtns = await page.$$eval('.copy-btn', els => els.length);
  console.log('详情弹窗复制按钮:', copyBtns);
  for (let i = 0; i < Math.min(copyBtns, 3); i++) {
    const txt = await page.locator('.copy-btn').nth(i).textContent();
    const bg = await page.locator('.copy-btn').nth(i).evaluate(el => window.getComputedStyle(el).backgroundColor);
    const clr = await page.locator('.copy-btn').nth(i).evaluate(el => window.getComputedStyle(el).color);
    console.log(`  按钮${i+1} "${txt}": bg=${bg}, color=${clr}`);
  }

  await page.screenshot({ path: 'C:/Users/yao/Desktop/token公益站/tests/screenshot-modal.png', fullPage: false });
  console.log('弹窗截屏已保存');

  await browser.close();
})();
