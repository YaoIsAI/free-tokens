const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  const errors = [];
  page.on('pageerror', err => { errors.push(err.message); console.log('JS错误:', err.message); });
  page.on('console', msg => { if (msg.type() === 'error') console.log('Console:', msg.text()); });

  const BASE = 'http://localhost:3000';

  // Test all pages
  for (const [name, path] of [['首页', '/'], ['教程', '/guide'], ['CLI', '/cli'], ['Dashboard', '/dashboard']]) {
    console.log(`\n=== ${name} (${path}) ===`);
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // Check basic rendering
    const title = await page.title();
    console.log('标题:', title);

    // Check clickable elements
    const links = await page.$$eval('a[href]', els => els.map(e => e.getAttribute('href')).filter(h => h && h !== '#'));
    const buttons = await page.$$eval('button, .btn', els => els.length);
    console.log('链接数:', links.length, '按钮数:', buttons);

    // Check for broken links (internal only)
    for (const href of links) {
      if (href.startsWith('/') && !href.includes('#')) {
        const resp = await page.goto(BASE + href, { waitUntil: 'domcontentloaded' }).catch(() => null);
        if (resp) {
          const status = resp.status();
          if (status !== 200) console.log('  损坏链接:', href, '→', status);
        }
      }
    }

    // CLI page: test copy button
    if (name === 'CLI') {
      const copyBtns = await page.$$eval('.copy-btn', els => els.length);
      console.log('复制按钮数:', copyBtns);
      if (copyBtns > 0) {
        await page.click('.copy-btn');
        await page.waitForTimeout(500);
        const btnText = await page.textContent('.copy-btn');
        console.log('点击后按钮文字:', btnText);
      }
    }

    // Dashboard: check tabs
    if (name === 'Dashboard') {
      const dashContent = await page.textContent('#dashRoot').catch(() => 'MISSING');
      console.log('Dashboard内容:', dashContent?.substring(0, 100));
    }
  }

  console.log('\n=== JS错误汇总 ===');
  console.log(errors.length > 0 ? errors.join('\n') : '无JS错误');

  await browser.close();
})();
