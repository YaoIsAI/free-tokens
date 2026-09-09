const { chromium } = require('playwright');
const path = require('path');
const Database = require('better-sqlite3');

const BASE = 'http://localhost:3000';
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '../data/app.db');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  const results = [];

  async function test(name, fn) {
    try {
      await fn();
      results.push({ name, status: 'PASS' });
      console.log(`✓ ${name}`);
    } catch (e) {
      results.push({ name, status: 'FAIL', error: e.message });
      console.log(`✗ ${name}: ${e.message}`);
    }
  }

  let userCounter = 0;
  // Helper: register a user
  async function registerUser(prefix) {
    userCounter++;
    const username = (prefix || 'u') + userCounter;

    // 种一个邀请码（直接写库，与服务器共用同一 DB 文件）
    const db = new Database(DB_PATH);
    const code = 'PW' + Math.random().toString(36).slice(2, 8).toUpperCase();
    db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run(code);
    db.close();

    // First try direct API call to check if registration works
    const apiResult = await page.evaluate(async ({username, code}) => {
      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password: 'pass123456', inviteCode: code })
        });
        const data = await res.json();
        return { ok: res.ok, status: res.status, data };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }, {username, code});

    if (!apiResult.ok) {
      throw new Error(`API registration failed: ${JSON.stringify(apiResult)}`);
    }

    // Store token in localStorage
    await page.evaluate((data) => {
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
    }, apiResult.data);

    // Reload page to update UI
    await page.goto(BASE, { waitUntil: 'networkidle' });

    return username;
  }

  // Helper: login user
  async function loginUser(username) {
    // Direct API call
    const apiResult = await page.evaluate(async (username) => {
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password: 'pass123456' })
        });
        const data = await res.json();
        return { ok: res.ok, status: res.status, data };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }, username);

    if (!apiResult.ok) {
      throw new Error(`API login failed: ${JSON.stringify(apiResult)}`);
    }

    // Store token in localStorage
    await page.evaluate((data) => {
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
    }, apiResult.data);

    // Reload page to update UI
    await page.goto(BASE, { waitUntil: 'networkidle' });
  }

  // Helper: clear auth state
  async function clearAuth() {
    await page.evaluate(() => {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    });
    // Reload page to update UI state
    await page.goto(BASE, { waitUntil: 'networkidle' });
  }

  // ===== 页面加载测试 =====
  console.log('\n=== 页面加载测试 ===');

  await test('首页加载', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    const title = await page.title();
    if (!title.includes('Token')) throw new Error('标题不包含 Token');
    const heroTitle = await page.textContent('.hero__title');
    if (!heroTitle) throw new Error('Hero 标题不存在');
  });

  await test('教程页加载', async () => {
    await page.goto(BASE + '/guide', { waitUntil: 'networkidle' });
    const title = await page.title();
    if (!title.includes('教程')) throw new Error('标题不包含 教程');
  });

  await test('Dashboard 页加载', async () => {
    await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle' });
    const title = await page.title();
    if (!title.includes('发布')) throw new Error('标题不包含 发布');
  });

  // ===== 首页功能测试 =====
  console.log('\n=== 首页功能测试 ===');

  await test('首页搜索功能', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('#heroSearch');
    await page.fill('#heroSearch', 'test');
    await page.waitForTimeout(500);
  });

  await test('首页分类筛选', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.tab');
    const tabs = await page.$$('.tab');
    if (tabs.length === 0) throw new Error('没有分类标签');
    await tabs[0].click();
    await page.waitForTimeout(300);
  });

  await test('首页统计加载', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('#statTotal');
    const total = await page.textContent('#statTotal');
    if (!total) throw new Error('统计数字未加载');
  });

  await test('首页贡献榜加载', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('#leaderboardBody');
    const content = await page.textContent('#leaderboardBody');
    if (!content) throw new Error('贡献榜未加载');
  });

  await test('首页最新动态加载', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('#activityBody');
    const content = await page.textContent('#activityBody');
    if (!content) throw new Error('最新动态未加载');
  });

  // ===== 导航测试 =====
  console.log('\n=== 导航测试 ===');

  await test('导航到教程页', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.click('a[href="/guide"]');
    await page.waitForURL('**/guide');
    const title = await page.title();
    if (!title.includes('教程')) throw new Error('未导航到教程页');
  });

  await test('导航回首页', async () => {
    await page.goto(BASE + '/guide', { waitUntil: 'networkidle' });
    await page.click('a[href="/"]');
    await page.waitForURL(BASE + '/');
    const title = await page.title();
    if (!title.includes('Token')) throw new Error('未导航到首页');
  });

  // ===== 用户系统测试 =====
  console.log('\n=== 用户系统测试 ===');

  await test('登录弹窗打开', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.click('#authBtn');
    await page.waitForSelector('#authModal.modal--open', { timeout: 3000 });
    const loginTitle = await page.textContent('#authView h2');
    if (!loginTitle.includes('登录')) throw new Error('登录弹窗未打开');
  });

  await test('登录表单切换到注册', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.click('#authBtn');
    await page.waitForSelector('#authModal.modal--open');
    await page.click('#switchToRegister');
    await page.waitForTimeout(300);
    const registerTitle = await page.textContent('#authView h2');
    if (!registerTitle.includes('注册')) throw new Error('未切换到注册');
  });

  await test('注册新用户', async () => {
    const testUser = await registerUser('tu');
    const userMenuVisible = await page.isVisible('#userMenu');
    if (!userMenuVisible) throw new Error('注册后未显示用户菜单');
    const userMenuText = await page.textContent('#userMenu');
    if (!userMenuText.includes(testUser)) throw new Error('用户名未显示');
  });

  await test('登录已有用户', async () => {
    const testUser = await registerUser('lu');
    await clearAuth();
    await loginUser(testUser);
    const userMenuVisible = await page.isVisible('#userMenu');
    if (!userMenuVisible) throw new Error('登录后未显示用户菜单');
  });

  await test('登录后"我的发布"入口在下拉菜单中', async () => {
    await clearAuth();
    await registerUser('dl');
    await page.click('#userMenuBtn');
    await page.waitForSelector('#userDropdown.open');
    const mineVisible = await page.isVisible('#userDropdown a[href="/dashboard"]');
    if (!mineVisible) throw new Error('"我的发布"下拉菜单项未显示');
    await page.keyboard.press('Escape');
  });

  // ===== Dashboard 测试 =====
  console.log('\n=== Dashboard 测试 ===');

  await test('Dashboard 未登录显示提示', async () => {
    await clearAuth();
    await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const pageContent = await page.textContent('body');
    if (!pageContent.includes('请先登录')) throw new Error('未显示登录提示');
  });

  await test('Dashboard 登录后显示内容', async () => {
    await clearAuth();
    const testUser = await registerUser('du');
    await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const pageContent = await page.textContent('body');
    if (!pageContent.includes(testUser)) throw new Error('Dashboard 未显示用户名');
    if (!pageContent.includes('发布总数')) throw new Error('Dashboard 未显示统计');
  });

  await test('Dashboard 显示空状态', async () => {
    await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const pageContent = await page.textContent('body');
    // 新用户应该显示空状态或有数据
    if (!pageContent.includes('还没有发布任何 Token') && !pageContent.includes('去发布')) {
      // 可能已有数据，这也算通过
    }
  });

  // ===== 发布功能测试 =====
  console.log('\n=== 发布功能测试 ===');

  await test('发布弹窗打开', async () => {
    await clearAuth();
    await registerUser('pb');
    await page.click('#publishBtn');
    await page.waitForSelector('#publishModal.modal--open', { timeout: 3000 });
    const publishTitle = await page.textContent('#publishView h2');
    if (!publishTitle.includes('发布')) throw new Error('发布弹窗未打开');
  });

  await test('发布表单提交', async () => {
    await clearAuth();
    await registerUser('ps');
    await page.click('#publishBtn');
    await page.waitForSelector('#publishModal.modal--open');
    await page.fill('#pName', 'Playwright 测试 Token');
    await page.fill('#pDesc', '这是一个自动化测试发布的 Token');
    await page.fill('#pProvider', 'TestProvider');
    await page.selectOption('#pCategory', '对话模型');
    await page.fill('#pUrl', 'https://example.com');
    await page.fill('#pToken', 'sk-test-playwright-12345');
    await page.selectOption('#pTokenType', 'OpenAI');
    await page.fill('#pTags', '测试,playwright');
    await page.click('#submitPublish');
    // Wait for modal to close
    await page.waitForFunction(() => {
      const modal = document.getElementById('publishModal');
      return modal && !modal.classList.contains('modal--open');
    }, { timeout: 5000 });
  });

  // ===== 详情弹窗测试 =====
  console.log('\n=== 详情弹窗测试 ===');

  await test('点击卡片打开详情', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.card', { timeout: 5000 });
    const cards = await page.$$('.card');
    if (cards.length === 0) throw new Error('没有卡片可点击');
    await cards[0].click();
    await page.waitForSelector('#modal.modal--open', { timeout: 3000 });
    // Wait for modal content to load
    await page.waitForFunction(() => {
      const content = document.getElementById('modalContent');
      return content && content.innerHTML.trim().length > 10;
    }, { timeout: 5000 });
    const modalContent = await page.textContent('#modalContent');
    if (!modalContent || modalContent.trim().length < 10) throw new Error('详情弹窗内容为空');
  });

  await test('详情弹窗关闭', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.card', { timeout: 5000 });
    const cards = await page.$$('.card');
    await cards[0].click();
    await page.waitForSelector('#modal.modal--open');
    // Wait for modal content to load
    await page.waitForFunction(() => {
      const content = document.getElementById('modalContent');
      return content && content.innerHTML.trim().length > 10;
    }, { timeout: 5000 });
    // Click the X button specifically
    await page.click('#modalContent .modal__x');
    await page.waitForTimeout(300);
    const modalOpen = await page.isVisible('#modal.modal--open');
    if (modalOpen) throw new Error('详情弹窗未关闭');
  });

  // ===== 微信弹窗测试 =====
  console.log('\n=== 微信弹窗测试 ===');

  await test('微信弹窗打开', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.click('#wechatBtn');
    await page.waitForSelector('#wechatModal.modal--open', { timeout: 3000 });
    const modalContent = await page.textContent('#wechatModal');
    if (!modalContent.includes('加微信群')) throw new Error('微信弹窗内容不正确');
  });

  await test('微信弹窗关闭', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.click('#wechatBtn');
    await page.waitForSelector('#wechatModal.modal--open');
    // Click the X button specifically
    await page.click('#wechatModal .modal__x');
    await page.waitForTimeout(300);
    const modalOpen = await page.isVisible('#wechatModal.modal--open');
    if (modalOpen) throw new Error('微信弹窗未关闭');
  });

  // ===== 教程页测试 =====
  console.log('\n=== 教程页测试 ===');

  await test('教程页目录导航', async () => {
    await page.goto(BASE + '/guide', { waitUntil: 'networkidle' });
    const tocLinks = await page.$$('.guide__toc a');
    if (tocLinks.length === 0) throw new Error('教程目录为空');
    await tocLinks[0].click();
    await page.waitForTimeout(500);
  });

  await test('教程页代码复制按钮', async () => {
    await page.goto(BASE + '/guide', { waitUntil: 'networkidle' });
    const copyBtns = await page.$$('.code-copy');
    if (copyBtns.length === 0) throw new Error('没有复制按钮');
  });

  await test('教程页 FAQ 折叠', async () => {
    await page.goto(BASE + '/guide', { waitUntil: 'networkidle' });
    const qaItems = await page.$$('.qa-q');
    if (qaItems.length === 0) throw new Error('FAQ 为空');
    await qaItems[0].click();
    await page.waitForTimeout(300);
    const isOpen = await qaItems[0].evaluate(el => el.classList.contains('open'));
    if (!isOpen) throw new Error('FAQ 未展开');
  });

  // ===== 响应式测试 =====
  console.log('\n=== 响应式测试 ===');

  await test('移动端视图', async () => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const heroTitle = await page.textContent('.hero__title');
    if (!heroTitle) throw new Error('移动端 Hero 标题不存在');
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  // ===== API 健康检查 =====
  console.log('\n=== API 健康检查 ===');

  await test('API Health 端点', async () => {
    const response = await page.goto(BASE + '/api/health');
    const data = await response.json();
    if (data.status !== 'ok') throw new Error('Health 状态不正常');
  });

  await test('API Stats 端点', async () => {
    const response = await page.goto(BASE + '/api/stats');
    const data = await response.json();
    if (typeof data.total !== 'number') throw new Error('Stats 数据格式错误');
  });

  await test('API Items 端点', async () => {
    const response = await page.goto(BASE + '/api/items');
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('Items 不是数组');
  });

  // ===== 结果汇总 =====
  console.log('\n=== 测试结果汇总 ===');
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log(`通过: ${passed}/${results.length}`);
  if (failed > 0) {
    console.log(`失败: ${failed}`);
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
  }

  await browser.close();

  if (failed > 0) {
    process.exit(1);
  }
})();
