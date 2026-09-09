// 冒烟：AI 工具导航 /tools（渲染/搜索/外链/免费用角标/响应式/sitemap/llms/导航）
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const TMP_DB = path.resolve(__dirname, '../data/tools.db');
try { fs.unlinkSync(TMP_DB); } catch (_) {}
try { fs.unlinkSync(TMP_DB + '-wal'); } catch (_) {}
try { fs.unlinkSync(TMP_DB + '-shm'); } catch (_) {}
process.env.DB_PATH = 'data/tools.db';
process.env.PORT = '0';
process.env.JWT_SECRET = 'test-secret';
process.env.API_RATE_LIMIT_MAX = '100000';
process.env.WRITE_RATE_LIMIT_MAX = '100000';
process.env.ALLOW_PRIVATE_SSRF = '1';

const app = require('../server');

(async () => {
  const server = app.listen(0, '127.0.0.1', async () => {
    const base = 'http://127.0.0.1:' + server.address().port;
    let fail = 0;
    const ok = (n, c) => { if (c) console.log('  PASS ' + n); else { fail++; console.log('  FAIL ' + n); } };
    const browser = await chromium.launch();
    try {
      // ===== 桌面端 =====
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const csp = [];
      page.on('console', m => { if (m.type() === 'error' && /Content Security Policy|Refused/.test(m.text())) csp.push(m.text().slice(0, 120)); });

      await page.goto(base + '/tools', { waitUntil: 'networkidle' });
      ok('标题 = AI 工具导航', (await page.title()).includes('AI 工具导航'));
      ok('分类 section ≥ 8 个', await page.locator('.tools-cat').count() >= 8);
      ok('工具卡片 ≥ 60 个', await page.locator('.tools-card').count() >= 60);
      ok('分类 chip ≥ 8 个', await page.locator('.tools-chip').count() >= 8);

      // 官网外跳经站内中转：DeepSeek 卡片 → /goto?u=<官网>（同 tab，先看提示再走）
      const ds = page.locator('.tools-card', { hasText: 'DeepSeek' }).first();
      const dsHref = await ds.getAttribute('href');
      const dsTarget = await ds.getAttribute('target');
      ok('DeepSeek 卡片 href 经 /goto 中转', dsHref === '/goto?u=' + encodeURIComponent('https://chat.deepseek.com'));
      ok('中转同 tab 跳转（无 target=_blank）', dsTarget === null);
      // 点卡片 → 中转提示页（域名+警告+3秒倒计时），再点前往 → 302 到官网
      await ds.click();
      await page.waitForURL('**/goto?u=**', { timeout: 5000 });
      ok('点击进中转提示页', (await page.locator('body').textContent()).includes('chat.deepseek.com'));
      const goHref = await page.locator('#gotoGo').getAttribute('href');
      ok('前往按钮指向计数跳转', goHref && goHref.indexOf('/goto/go?u=') === 0);
      // 回到列表继续后续步骤
      await page.goto(base + '/tools', { waitUntil: 'networkidle' });

      // 免费用角标 → /?search=DeepSeek（定位 DeepSeek 卡片所在 wrap 的角标）
      const freeBadge = page.locator('.tools-card-wrap', { hasText: 'DeepSeek' }).locator('.tools-card__free');
      const badgeHref = await freeBadge.getAttribute('href');
      ok('免费用角标跳站内搜索 /?search=DeepSeek', badgeHref === '/?search=DeepSeek');
      ok('免费用角标在卡片外（非嵌套 a）', await page.locator('.tools-card__free').count() >= 7);

      // 搜索过滤：输入 Claude → 只剩 Claude 卡片可见，无匹配 section 隐藏
      await page.fill('#toolsSearch', 'Claude');
      await page.waitForTimeout(200);
      const visibleCards = await page.locator('.tools-card-wrap:visible').count();
      const claudeVisible = await page.locator('.tools-card', { hasText: 'Claude' }).first().isVisible();
      const allMatch = await page.evaluate(() => {
        const q = 'claude';
        return Array.from(document.querySelectorAll('.tools-card-wrap')).filter(w => w.offsetParent !== null)
          .every(w => w.textContent.toLowerCase().includes(q));
      });
      ok('搜索「Claude」后可见卡片均匹配', allMatch && claudeVisible && visibleCards >= 1);
      // 清空恢复
      await page.fill('#toolsSearch', '');
      await page.waitForTimeout(200);
      ok('清空搜索后卡片恢复', await page.locator('.tools-card-wrap:visible').count() >= 60);

      // 导航高亮：/tools 页 AI 工具 active
      const activeNav = await page.evaluate(() => {
        const el = document.querySelector('.nav__link--active');
        return el ? el.textContent.trim() : '';
      });
      ok('导航高亮 AI 工具', activeNav.includes('AI 工具'));

      // CSP 无报错
      ok('无 CSP 报错', csp.length === 0);

      // ===== 移动端 375px =====
      const mob = await browser.newPage({ viewport: { width: 375, height: 720 } });
      await mob.goto(base + '/tools', { waitUntil: 'networkidle' });
      const noHScroll = await mob.evaluate(() => document.documentElement.scrollWidth <= 375 + 1);
      const chipBarScrollable = await mob.evaluate(() => {
        const nav = document.querySelector('.tools-nav');
        return nav && nav.scrollWidth >= nav.clientWidth;
      });
      ok('移动端无横向溢出', noHScroll);
      ok('移动端分类条可横向滚动', chipBarScrollable);

      // ===== SEO：sitemap / llms / 首页导航 =====
      const sitemap = await fetch(base + '/sitemap.xml').then(r => r.text());
      ok('sitemap 含 /tools', sitemap.includes('/tools'));
      const llms = await fetch(base + '/llms.txt').then(r => r.text());
      ok('llms.txt 含 /tools', llms.includes('/tools'));
      const home = await fetch(base + '/').then(r => r.text());
      ok('首页导航含 AI 工具链接', home.includes('href="/tools"'));
      ok('首页页脚含 AI 工具链接', /AI 工具/.test(home) && home.includes('/tools'));

      console.log(fail === 0 ? '\nALL PASS ✓' : '\n' + fail + ' FAILED ✗');
    } catch (e) {
      console.log('SCRIPT ERROR:', e.message);
      fail = 99;
    } finally {
      await browser.close();
      try { server.close(); } catch (_) {}
      try { process.exit(fail ? 1 : 0); } catch (_) {}
    }
  });
})();
