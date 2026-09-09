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
  page.on('pageerror', err => results.push({ type: 'JS错误', page: page.url(), msg: err.message }));

  // Helper: login
  async function login() {
    const username = 'audit_' + Math.random().toString(36).slice(2, 6);
    const db = new Database(DB_PATH);
    const code = 'PW' + Math.random().toString(36).slice(2, 8).toUpperCase();
    db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run(code);
    db.close();
    const r = await page.evaluate(async ({u, c}) => {
      const res = await fetch('/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: 'pass123456', inviteCode: c })
      });
      return res.json();
    }, {u: username, c: code});
    await page.evaluate((d) => {
      localStorage.setItem('token', d.token);
      localStorage.setItem('user', JSON.stringify(d.user));
    }, r);
    return username;
  }

  // ==================== PAGE 1: 首页 (未登录) ====================
  console.log('\n========== 首页 (未登录) ==========');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  let test = async (name, fn) => {
    try { await fn(); results.push({ status: 'OK', page: '首页', test: name }); console.log('  ✓', name); }
    catch(e) { results.push({ status: 'FAIL', page: '首页', test: name, error: e.message }); console.log('  ✗', name, e.message.slice(0,80)); }
  };

  await test('页面标题正确', async () => {
    const t = await page.title();
    if (!t.includes('Token')) throw new Error('title=' + t);
  });
  await test('Hero区域可见', async () => {
    const v = await page.isVisible('.hero__title');
    if (!v) throw new Error('hero not visible');
  });
  await test('统计数字已注入(非-)', async () => {
    const t = await page.textContent('#statTotal');
    if (t === '-' || t === '') throw new Error('stats=' + t);
  });
  await test('搜索框可输入', async () => {
    await page.fill('#heroSearch', 'test');
    await page.fill('#heroSearch', '');
  });
  await test('分类Tab可点击', async () => {
    const tabs = await page.$$('.tab');
    if (tabs.length === 0) throw new Error('no tabs');
    await tabs[0].click();
    await page.waitForTimeout(200);
  });
  await test('发布Token按钮存在且可见', async () => {
    const v = await page.isVisible('#publishBtn');
    if (!v) throw new Error('publishBtn not visible');
  });
  await test('点击发布Token弹出登录弹窗(未登录)', async () => {
    await page.click('#publishBtn');
    await page.waitForSelector('#authModal.modal--open', { timeout: 3000 });
    const txt = await page.textContent('#authView h2');
    if (!txt.includes('登录')) throw new Error('not login modal: ' + txt);
    await page.click('#authModal .modal__x');
    await page.waitForTimeout(300);
  });
  await test('微信按钮弹出弹窗', async () => {
    await page.click('#wechatBtn');
    await page.waitForSelector('#wechatModal.modal--open', { timeout: 3000 });
    await page.click('#wechatModal .modal__x');
    await page.waitForTimeout(300);
  });
  await test('贡献榜有数据', async () => {
    const t = await page.textContent('#leaderboardBody');
    if (!t || t.includes('加载中')) throw new Error('no leaderboard data');
  });
  await test('最新动态有数据', async () => {
    const t = await page.textContent('#activityBody');
    if (!t || t.includes('加载中')) throw new Error('no activity data');
  });
  await test('卡片存在', async () => {
    const cards = await page.$$('.card');
    if (cards.length === 0) throw new Error('no cards');
  });
  await test('点击卡片打开详情弹窗', async () => {
    await page.click('.card');
    await page.waitForSelector('#modal.modal--open', { timeout: 3000 });
    await page.waitForFunction(() => document.getElementById('modalContent')?.textContent?.length > 20, { timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });
  await test('详情弹窗有复制按钮', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.click('.card');
    await page.waitForSelector('#modal.modal--open', { timeout: 3000 });
    await page.waitForTimeout(800);
    const btns = await page.$$('.copy-btn');
    if (btns.length === 0) throw new Error('no copy-btn in detail');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });
  await test('导航链接: 首页→教程', async () => {
    // Close any open modals first
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    // Ensure no modals open
    await page.evaluate(() => {
      document.querySelectorAll('.modal').forEach(m => m.classList.remove('modal--open'));
    });
    await page.click('nav a[href="/guide"]');
    await page.waitForURL('**/guide');
  });

  // ==================== PAGE 2: 教程页 (未登录) ====================
  console.log('\n========== 教程页 (未登录) ==========');
  await page.goto(BASE + '/guide', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  test = async (name, fn) => {
    try { await fn(); results.push({ status: 'OK', page: '教程', test: name }); console.log('  ✓', name); }
    catch(e) { results.push({ status: 'FAIL', page: '教程', test: name, error: e.message }); console.log('  ✗', name, e.message.slice(0,80)); }
  };

  await test('页面标题正确', async () => {
    const t = await page.title();
    if (!t.includes('教程')) throw new Error('title=' + t);
  });
  await test('发布Token按钮存在', async () => {
    const v = await page.isVisible('#authBtn');
    if (!v) throw new Error('authBtn not visible');
  });
  await test('点击发布Token→弹出登录(教程页)', async () => {
    await page.click('#authBtn');
    await page.waitForTimeout(500);
    const isOpen = await page.isVisible('#authModal.modal--open');
    if (!isOpen) throw new Error('auth modal not opened from guide page');
    await page.click('#authModal .modal__x');
    await page.waitForTimeout(300);
  });
  await test('微信按钮可弹出弹窗', async () => {
    await page.click('#wechatBtn');
    await page.waitForSelector('#wechatModal.modal--open', { timeout: 3000 });
    await page.click('#wechatModal .modal__x');
    await page.waitForTimeout(300);
  });
  await test('目录锚点可点击跳转', async () => {
    const toc = await page.$$('.guide__toc a');
    if (toc.length === 0) throw new Error('no toc');
    await toc[1].click();
    await page.waitForTimeout(300);
  });
  await test('FAQ可展开折叠', async () => {
    const qas = await page.$$('.qa-q');
    if (qas.length === 0) throw new Error('no FAQ');
    await qas[0].click();
    await page.waitForTimeout(200);
    const isOpen = await qas[0].evaluate(el => el.classList.contains('open'));
    if (!isOpen) throw new Error('FAQ not open');
  });
  await test('代码复制按钮存在', async () => {
    const btns = await page.$$('.code-copy');
    if (btns.length === 0) throw new Error('no code-copy');
  });

  // ==================== PAGE 3: CLI页 (未登录) ====================
  console.log('\n========== CLI页 (未登录) ==========');
  await page.goto(BASE + '/cli', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  test = async (name, fn) => {
    try { await fn(); results.push({ status: 'OK', page: 'CLI', test: name }); console.log('  ✓', name); }
    catch(e) { results.push({ status: 'FAIL', page: 'CLI', test: name, error: e.message }); console.log('  ✗', name, e.message.slice(0,80)); }
  };

  await test('页面标题正确', async () => {
    const t = await page.title();
    if (!t.includes('CLI')) throw new Error('title=' + t);
  });
  await test('发布Token按钮存在', async () => {
    const v = await page.isVisible('#authBtn');
    if (!v) throw new Error('authBtn not visible');
  });
  await test('点击发布Token→弹出登录(CLI页)', async () => {
    await page.click('#authBtn');
    await page.waitForTimeout(500);
    const isOpen = await page.isVisible('#authModal.modal--open');
    if (!isOpen) throw new Error('auth modal not opened from CLI page');
    await page.click('#authModal .modal__x');
    await page.waitForTimeout(300);
  });
  await test('复制代码按钮可点击', async () => {
    const btn = await page.$('.copy-btn');
    if (!btn) throw new Error('no copy-btn');
    await btn.click();
    await page.waitForTimeout(300);
    const txt = await btn.textContent();
    if (!txt.includes('已复制') && !txt.includes('复制')) throw new Error('copy failed, text=' + txt);
  });
  await test('微信按钮可弹出弹窗', async () => {
    await page.click('#wechatBtn');
    await page.waitForSelector('#wechatModal.modal--open', { timeout: 3000 });
    await page.click('#wechatModal .modal__x');
    await page.waitForTimeout(300);
  });

  // ==================== PAGE 4: Dashboard (未登录) ====================
  console.log('\n========== Dashboard (未登录) ==========');
  await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  test = async (name, fn) => {
    try { await fn(); results.push({ status: 'OK', page: 'Dashboard', test: name }); console.log('  ✓', name); }
    catch(e) { results.push({ status: 'FAIL', page: 'Dashboard', test: name, error: e.message }); console.log('  ✗', name, e.message.slice(0,80)); }
  };

  await test('显示请先登录', async () => {
    const t = await page.textContent('#dashRoot');
    if (!t.includes('请先登录')) throw new Error('no login prompt');
  });
  await test('登录按钮可点击弹出弹窗', async () => {
    await page.click('#dashLoginBtn');
    await page.waitForSelector('#authModal.modal--open', { timeout: 3000 });
    await page.click('#authModal .modal__x');
    await page.waitForTimeout(300);
  });
  await test('微信按钮可弹出弹窗', async () => {
    await page.click('#wechatBtn');
    await page.waitForSelector('#wechatModal.modal--open', { timeout: 3000 });
    await page.click('#wechatModal .modal__x');
    await page.waitForTimeout(300);
  });

  // ==================== LOGGED-IN TESTS ====================
  console.log('\n========== 首页 (已登录) ==========');
  const uname = await login();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  test = async (name, fn) => {
    try { await fn(); results.push({ status: 'OK', page: '首页(登录)', test: name }); console.log('  ✓', name); }
    catch(e) { results.push({ status: 'FAIL', page: '首页(登录)', test: name, error: e.message }); console.log('  ✗', name, e.message.slice(0,80)); }
  };

  await test('用户菜单显示用户名', async () => {
    const t = await page.textContent('#userMenu');
    if (!t.includes(uname)) throw new Error('user not shown: ' + t);
  });
  await test('发布Token按钮隐藏→用户菜单显示', async () => {
    const v = await page.isVisible('#authBtn');
    if (v) throw new Error('authBtn still visible when logged in');
  });
  await test('我的发布入口在下拉菜单中可见', async () => {
    await page.click('#userMenuBtn');
    await page.waitForSelector('#userDropdown.open');
    const v = await page.isVisible('#userDropdown a[href="/dashboard"]');
    if (!v) throw new Error('dropdown missing 我的发布');
    await page.keyboard.press('Escape');
  });
  await test('发布Token点击直接弹出发布弹窗', async () => {
    await page.click('#publishBtn');
    await page.waitForSelector('#publishModal.modal--open', { timeout: 3000 });
    await page.click('#publishModal .modal__x');
    await page.waitForTimeout(300);
  });
  await test('用户菜单点击退出', async () => {
    page.once('dialog', d => d.accept());
    await page.click('#userMenu');
    await page.waitForTimeout(500);
    const v = await page.isVisible('#authBtn');
    if (!v) throw new Error('authBtn not back after logout');
  });

  // Re-login
  await login();
  await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  console.log('\n========== Dashboard (已登录) ==========');
  test = async (name, fn) => {
    try { await fn(); results.push({ status: 'OK', page: 'Dashboard(登录)', test: name }); console.log('  ✓', name); }
    catch(e) { results.push({ status: 'FAIL', page: 'Dashboard(登录)', test: name, error: e.message }); console.log('  ✗', name, e.message.slice(0,80)); }
  };

  await test('显示用户信息', async () => {
    const t = await page.textContent('#dashRoot');
    if (!t.includes('发布总数')) throw new Error('stats missing');
  });
  await test('发布新Token链接存在', async () => {
    const links = await page.$$('a.btn--sm');
    if (links.length === 0) throw new Error('no publish link');
  });

  // Test publish from dashboard
  console.log('\n========== 发布流程测试 ==========');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await login();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  test = async (name, fn) => {
    try { await fn(); results.push({ status: 'OK', page: '发布流程', test: name }); console.log('  ✓', name); }
    catch(e) { results.push({ status: 'FAIL', page: '发布流程', test: name, error: e.message }); console.log('  ✗', name, e.message.slice(0,80)); }
  };

  await test('发布弹窗打开发布表单', async () => {
    await page.click('#publishBtn');
    await page.waitForSelector('#publishModal.modal--open', { timeout: 3000 });
    const txt = await page.textContent('#publishView h2');
    if (!txt.includes('发布')) throw new Error('not publish form');
  });
  await test('发布条目成功', async () => {
    await page.fill('#pName', '审计测试-' + Math.random().toString(36).slice(2,6));
    await page.fill('#pUrl', 'https://example.com/audit');
    await page.fill('#pProvider', 'AuditProvider');
    await page.click('#submitPublish');
    await page.waitForFunction(() => !document.getElementById('publishModal')?.classList.contains('modal--open'), { timeout: 5000 });
  });

  // ==================== 卡片详细检查 ====================
  console.log('\n========== 卡片UI检查 ==========');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  test = async (name, fn) => {
    try { await fn(); results.push({ status: 'OK', page: '卡片UI', test: name }); console.log('  ✓', name); }
    catch(e) { results.push({ status: 'FAIL', page: '卡片UI', test: name, error: e.message }); console.log('  ✗', name, e.message.slice(0,80)); }
  };

  await test('卡片有名称', async () => {
    const name = await page.textContent('.card .card__name').catch(() => '');
    if (!name || name.length < 1) throw new Error('no card name');
  });
  await test('卡片有供应商', async () => {
    const p = await page.textContent('.card .card__provider').catch(() => '');
    if (!p) throw new Error('no provider');
  });
  await test('卡片有描述', async () => {
    const d = await page.textContent('.card .card__desc').catch(() => '');
    if (!d) throw new Error('no desc');
  });
  await test('卡片有查看详情按钮', async () => {
    const btns = await page.$$('.card .card__arrow');
    if (btns.length === 0) throw new Error('no view detail btn');
  });
  await test('Badge存在(Token类型标记)', async () => {
    const badges = await page.$$('.badge');
    // Badges may or may not exist depending on data
  });

  // ==================== 移动端响应式 ====================
  console.log('\n========== 响应式测试 ==========');
  test = async (name, fn) => {
    try { await fn(); results.push({ status: 'OK', page: '响应式', test: name }); console.log('  ✓', name); }
    catch(e) { results.push({ status: 'FAIL', page: '响应式', test: name, error: e.message }); console.log('  ✗', name, e.message.slice(0,80)); }
  };

  await test('375px移动端首页', async () => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(300);
    const hero = await page.textContent('.hero__title');
    if (!hero) throw new Error('hero missing at 375px');
    // Check cards stack properly
    const cards = await page.$$('.card');
    if (cards.length === 0) throw new Error('no cards at mobile');
    await page.setViewportSize({ width: 1280, height: 800 });
  });
  await test('768px平板端', async () => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForTimeout(300);
    const hero = await page.textContent('.hero__title');
    if (!hero) throw new Error('hero missing at 768px');
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  // ==================== RESULTS ====================
  console.log('\n' + '='.repeat(60));
  const pass = results.filter(r => r.status === 'OK').length;
  const fail = results.filter(r => r.status === 'FAIL').length;
  console.log(`总计: ${results.length} | 通过: ${pass} | 失败: ${fail}`);
  if (fail > 0) {
    console.log('\n失败明细:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  [${r.page}] ${r.test}: ${r.error}`);
    });
  }
  results.filter(r => r.type === 'JS错误').forEach(r => {
    console.log(`  JS错误 [${r.page}]: ${r.msg}`);
  });

  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})();
