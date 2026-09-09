const { chromium } = require('playwright');
const path = require('path');
const Database = require('better-sqlite3');

const BASE = 'http://localhost:3000';
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '../data/app.db');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  // 种子：一条已审核示例条目，保证首页有卡片（待审核条目不进公开网格）
  try {
    const sdb = new Database(DB_PATH);
    sdb.prepare("INSERT OR IGNORE INTO items (id, name, desc, url, provider, category, token, token_type, tags, verified, created_at, updated_at) VALUES ('seeddemo1', '种子示例', 'demo', 'https://example.com', 'Seed', '对话模型', 'sk-seed-demo-123', 'OpenAI', '[]', 1, datetime('now'), datetime('now'))").run();
    sdb.close();
  } catch (_) {}

  let pass = 0, fail = 0;
  async function test(name, fn) {
    try {
      await fn();
      pass++;
      console.log(`✓ ${name}`);
    } catch (e) {
      fail++;
      console.log(`✗ ${name}: ${e.message.slice(0, 120)}`);
    }
  }

  const rand = () => Math.random().toString(36).slice(2, 8);
  let token, username;

  // Helper: register via API, store in localStorage, reload
  async function setupAuth() {
    username = 'u_' + rand();
    // 种一个邀请码（直接写库，与服务器共用同一 DB 文件）
    const db = new Database(DB_PATH);
    const code = 'PW' + rand().toUpperCase();
    db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run(code);
    db.close();
    const result = await page.evaluate(async ({u, c}) => {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: 'pass123456', inviteCode: c })
      });
      return res.json();
    }, {u: username, c: code});
    token = result.token;
    await page.evaluate(({t, u}) => {
      localStorage.setItem('token', t);
      localStorage.setItem('user', JSON.stringify({ id: 'x', username: u }));
    }, {t: token, u: username});
    await page.goto(BASE, { waitUntil: 'networkidle' });
  }

  // ========== 页面加载 ==========
  console.log('\n=== 页面加载 ===');
  await test('首页加载', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    const t = await page.title();
    if (!t.includes('Token')) throw new Error('title=' + t);
  });
  await test('教程页加载', async () => {
    await page.goto(BASE + '/guide', { waitUntil: 'networkidle' });
    const t = await page.title();
    if (!t.includes('教程')) throw new Error('title=' + t);
  });
  await test('Dashboard 页加载', async () => {
    await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle' });
    const t = await page.title();
    if (!t.includes('发布')) throw new Error('title=' + t);
  });

  // ========== 首页功能 ==========
  console.log('\n=== 首页功能 ===');
  await test('搜索输入', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.fill('#heroSearch', 'test');
  });
  await test('?search= 深链：自动填充搜索框并过滤出匹配 Token（/tools 免费用角标 + JSON-LD SearchAction 指向）', async () => {
    await page.goto(BASE + '/?search=' + encodeURIComponent('种子示例'), { waitUntil: 'networkidle' });
    const val = await page.inputValue('#heroSearch');
    if (val !== '种子示例') throw new Error('搜索框未按深链自动填充: ' + JSON.stringify(val));
    await page.waitForSelector('.card[data-id="seeddemo1"]', { timeout: 5000 });
  });
  await test('分类 Tab 存在', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    const tabs = await page.$$('.tab');
    if (tabs.length === 0) throw new Error('no tabs');
  });
  await test('统计数字加载', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.getElementById('statTotal')?.textContent !== '-', { timeout: 5000 });
  });
  await test('贡献榜面板', async () => {
    const html = await page.innerHTML('#leaderboardBody');
    if (!html) throw new Error('empty');
  });
  await test('最新动态面板', async () => {
    const html = await page.innerHTML('#activityBody');
    if (!html) throw new Error('empty');
  });

  // ========== 导航 ==========
  console.log('\n=== 导航 ===');
  await test('首页→教程', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.click('a[href="/guide"]');
    await page.waitForURL('**/guide');
  });
  await test('教程→首页', async () => {
    await page.goto(BASE + '/guide', { waitUntil: 'networkidle' });
    await page.click('a[href="/"]');
    await page.waitForURL(BASE + '/');
  });

  // ========== 认证 (UI) ==========
  console.log('\n=== 认证 UI ===');
  await test('登录弹窗打开/关闭', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.click('#headerLoginBtn');
    await page.waitForSelector('#authModal.modal--open', { timeout: 3000 });
    await page.click('#authModal .modal__x');
    await page.waitForTimeout(300);
    if (await page.isVisible('#authModal.modal--open')) throw new Error('not closed');
  });
  await test('注册弹窗打开/关闭', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.click('#headerLoginBtn');
    await page.waitForSelector('#authModal.modal--open');
    await page.click('#switchToRegister');
    await page.waitForTimeout(200);
    const h = await page.textContent('#authView h2');
    if (!h.includes('注册')) throw new Error('not register view');
    await page.click('#authModal .modal__x');
    await page.waitForTimeout(300);
    if (await page.isVisible('#authModal.modal--open')) throw new Error('not closed');
  });

  // ========== 认证 (API + UI) ==========
  console.log('\n=== 认证 API+UI ===');
  await test('注册后导航栏更新', async () => {
    await setupAuth();
    const userMenu = await page.textContent('#userMenu');
    if (!userMenu.includes(username)) throw new Error('user not shown: ' + userMenu);
    // "我的发布"入口收敛到用户下拉菜单中，头部不再有独立按钮
    await page.click('#userMenuBtn');
    await page.waitForSelector('#userDropdown.open');
    const mineVisible = await page.isVisible('#userDropdown a[href="/dashboard"]');
    if (!mineVisible) throw new Error('dropdown missing 我的发布');
    await page.keyboard.press('Escape');
  });
  await test('退出登录', async () => {
    await page.evaluate(() => {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    const loginVisible = await page.isVisible('#headerLoginBtn');
    if (!loginVisible) throw new Error('login button not shown after logout');
    const publishHidden = await page.isHidden('#authBtn');
    if (!publishHidden) throw new Error('publish button still visible after logout');
  });

  // ========== Dashboard ==========
  console.log('\n=== Dashboard ===');
  await test('未登录显示登录提示', async () => {
    await page.evaluate(() => { localStorage.removeItem('token'); localStorage.removeItem('user'); });
    await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle' });
    const text = await page.textContent('#dashRoot');
    if (!text.includes('请先登录')) throw new Error('no login prompt');
  });
  await test('登录后显示用户信息', async () => {
    await setupAuth();
    await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const text = await page.textContent('#dashRoot');
    if (!text.includes(username)) throw new Error('user not shown');
    if (!text.includes('发布总数')) throw new Error('stats missing');
  });
  await test('空状态显示', async () => {
    await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const text = await page.textContent('#dashRoot');
    if (!text.includes('发布总数')) throw new Error('no stats');
  });

  // ========== 发布 ==========
  console.log('\n=== 发布 ===');
  await test('发布弹窗打开', async () => {
    await setupAuth();
    await page.click('#authBtn');
    await page.waitForSelector('#publishModal.modal--open', { timeout: 3000 });
  });
  await test('发布弹窗关闭', async () => {
    await setupAuth();
    await page.click('#authBtn');
    await page.waitForSelector('#publishModal.modal--open');
    await page.click('#publishModal .modal__x');
    await page.waitForTimeout(300);
    if (await page.isVisible('#publishModal.modal--open')) throw new Error('not closed');
  });
  await test('发布 Token 必填校验（纯链接/无 Token 拒绝，弹窗不关闭）', async () => {
    await setupAuth();
    await page.click('#authBtn');
    await page.waitForSelector('#publishModal.modal--open');
    await page.fill('#pName', 'PW测试' + rand());
    await page.fill('#pUrl', 'https://example.com/' + rand());
    await page.fill('#pProvider', 'TestProvider');
    await page.click('#submitPublish');
    // 本站只收录真实可用 Token：无 Token → 客户端校验拒绝，弹窗保持打开
    await page.waitForTimeout(400);
    const stillOpen = await page.evaluate(() => document.getElementById('publishModal')?.classList.contains('modal--open'));
    if (!stillOpen) throw new Error('无 Token 的纯链接条目不应发布成功');
    const toast = await page.textContent('.toast').catch(() => '');
    if (!toast || toast.indexOf('Token') === -1) throw new Error('缺少 Token 必填提示: ' + toast);
  });
  await test('一键粘贴智能填充：env 块粘贴后自动填 base_url/API_KEY/类型', async () => {
    await setupAuth();
    await page.click('#authBtn');
    await page.waitForSelector('#publishModal.modal--open');
    await page.locator('#pSmartPaste').fill('OPENAI_BASE_URL=https://x-api.cfd/v1\nOPENAI_API_KEY=sk-pw-smart-12345678\nOPENAI_MODEL=gpt-4o');
    await page.locator('#pSmartPaste').dispatchEvent('paste');
    await page.waitForTimeout(300);
    const url = await page.inputValue('#pUrl');
    const tok = await page.inputValue('#pToken');
    const tt = await page.inputValue('#pTokenType');
    if (url !== 'https://x-api.cfd/v1') throw new Error('URL 未填充: ' + url);
    if (tok !== 'sk-pw-smart-12345678') throw new Error('Token 未填充: ' + tok);
    if (tt !== 'OpenAI兼容') throw new Error('类型未选择: ' + tt);
    const boxVal = await page.inputValue('#pSmartPaste');
    if (boxVal !== '') throw new Error('粘贴框未清空: ' + boxVal);
  });

  // ========== 详情弹窗 ==========
  console.log('\n=== 详情弹窗 ===');
  await test('点击卡片打开详情', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.card', { timeout: 5000 });
    await page.click('.card');
    await page.waitForSelector('#modal.modal--open', { timeout: 3000 });
    await page.waitForFunction(() => document.getElementById('modalContent')?.textContent?.length > 20, { timeout: 5000 });
  });
  await test('详情弹窗 ESC 关闭', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.card', { timeout: 5000 });
    await page.click('.card');
    await page.waitForSelector('#modal.modal--open');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    if (await page.isVisible('#modal.modal--open')) throw new Error('not closed');
  });

  // ========== 微信弹窗 ==========
  console.log('\n=== 微信弹窗 ===');
  await test('微信弹窗打开', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.click('#wechatBtn');
    await page.waitForSelector('#wechatModal.modal--open', { timeout: 3000 });
  });
  await test('微信弹窗 ESC 关闭', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.click('#wechatBtn');
    await page.waitForSelector('#wechatModal.modal--open');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    if (await page.isVisible('#wechatModal.modal--open')) throw new Error('not closed');
  });

  // ========== 教程页 ==========
  console.log('\n=== 教程页 ===');
  await test('目录锚点跳转', async () => {
    await page.goto(BASE + '/guide', { waitUntil: 'networkidle' });
    const links = await page.$$('.guide__toc a');
    if (links.length === 0) throw new Error('no toc links');
    await links[1].click();
    await page.waitForTimeout(500);
  });
  await test('FAQ 点击展开', async () => {
    await page.goto(BASE + '/guide', { waitUntil: 'networkidle' });
    const qas = await page.$$('.qa-q');
    if (qas.length === 0) throw new Error('no faq');
    await qas[0].click();
    await page.waitForTimeout(300);
    const isOpen = await qas[0].evaluate(el => el.classList.contains('open'));
    if (!isOpen) throw new Error('not opened');
  });
  await test('FAQ 再次点击折叠', async () => {
    await page.goto(BASE + '/guide', { waitUntil: 'networkidle' });
    const qas = await page.$$('.qa-q');
    await qas[0].click();
    await page.waitForTimeout(200);
    await qas[0].click();
    await page.waitForTimeout(200);
    const isOpen = await qas[0].evaluate(el => el.classList.contains('open'));
    if (isOpen) throw new Error('still open');
  });
  await test('代码块复制按钮存在', async () => {
    await page.goto(BASE + '/guide', { waitUntil: 'networkidle' });
    const btns = await page.$$('.code-copy');
    if (btns.length === 0) throw new Error('no copy buttons');
  });

  // ========== 响应式 ==========
  console.log('\n=== 响应式 ===');
  await test('移动端 375px', async () => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    const title = await page.textContent('.hero__title');
    if (!title) throw new Error('hero missing');
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  // ========== API ==========
  console.log('\n=== API ===');
  await test('所有 API 端点', async () => {
    const results = await page.evaluate(async () => {
      const endpoints = ['/api/health', '/api/stats', '/api/items', '/api/leaderboard', '/api/categories', '/api/recent-activity'];
      const out = {};
      for (const ep of endpoints) {
        try {
          const r = await fetch(ep);
          out[ep] = { status: r.status, data: await r.json() };
        } catch (e) {
          out[ep] = { error: e.message };
        }
      }
      return out;
    });
    if (results['/api/health'].data.status !== 'ok') throw new Error('health bad');
    if (typeof results['/api/stats'].data.total !== 'number') throw new Error('stats bad');
    if (!Array.isArray(results['/api/items'].data)) throw new Error('items bad');
    if (!Array.isArray(results['/api/leaderboard'].data)) throw new Error('leaderboard bad');
    if (!Array.isArray(results['/api/categories'].data)) throw new Error('categories bad');
    if (!Array.isArray(results['/api/recent-activity'].data)) throw new Error('recent-activity bad');
  });
  await test('GET /dashboard (页面)', async () => {
    const r = await page.goto(BASE + '/dashboard');
    const html = await r.text();
    if (!html.includes('我的发布')) throw new Error('dashboard html missing');
  });
  await test('GET /guide (页面)', async () => {
    const r = await page.goto(BASE + '/guide');
    const html = await r.text();
    if (!html.includes('使用教程')) throw new Error('guide html missing');
  });

  // ========== Dashboard API ==========
  console.log('\n=== Dashboard API ===');
  await test('GET /api/my/items (需登录)', async () => {
    await page.evaluate(() => { localStorage.removeItem('token'); });
    const r = await page.goto(BASE + '/api/my/items');
    const text = await r.text();
  });
  await test('GET /api/my/items + stats (已登录)', async () => {
    await setupAuth();
    const result = await page.evaluate(async (t) => {
      const itemsRes = await fetch('/api/my/items', { headers: { 'Authorization': 'Bearer ' + t } });
      const statsRes = await fetch('/api/my/stats', { headers: { 'Authorization': 'Bearer ' + t } });
      return {
        items: { status: itemsRes.status, data: await itemsRes.json() },
        stats: { status: statsRes.status, data: await statsRes.json() }
      };
    }, token);
    if (result.items.status !== 200) throw new Error('items status=' + result.items.status);
    if (!Array.isArray(result.items.data)) throw new Error('items not array');
    if (result.stats.status !== 200) throw new Error('stats status=' + result.stats.status);
    if (typeof result.stats.data.total !== 'number') throw new Error('stats bad');
  });

  // ========== 结果 ==========
  console.log(`\n${'='.repeat(40)}`);
  console.log(`通过: ${pass}/${pass + fail}  失败: ${fail}`);
  if (fail > 0) process.exitCode = 1;

  await browser.close();
})();
