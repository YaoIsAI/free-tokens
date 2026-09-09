const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage();
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.click('#wechatBtn');
  await page.waitForSelector('#wechatModal.modal--open', { timeout: 5000 });
  await page.waitForSelector('#wechatQrContainer img', { timeout: 5000 });
  const src = await page.getAttribute('#wechatQrContainer img', 'src');
  const w = await page.getAttribute('#wechatQrContainer img', 'width');
  const naturalW = await page.$eval('#wechatQrContainer img', i => i.naturalWidth);
  console.log('img src:', src);
  console.log('naturalWidth:', naturalW);
  console.log(naturalW > 0 && src.indexOf('wechat-group.jpg') !== -1 ? 'PASS: 微信群二维码真实图片已加载' : 'FAIL');
  await b.close();
})();
