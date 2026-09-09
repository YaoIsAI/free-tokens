// CC Switch 一键导入冒烟：详情弹窗内「导入 CC Switch」按钮的登录门控 + 数据正确性 + 未安装兜底
// 自起服（独立端口 + 临时 DB）。种入一条 verified 且带 token/url/compat 的条目。
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const TMP_DB = 'data/ccswitch-pw.db';
const PORT = 3140;
const BASE = 'http://localhost:' + PORT;

(async () => {
  const dbFull = path.resolve(ROOT, TMP_DB);
  for (const f of [dbFull, dbFull + '-wal', dbFull + '-shm']) { try { fs.unlinkSync(f); } catch (_) {} }
  const db = new Database(dbFull);
  db.exec('CREATE TABLE IF NOT EXISTS invite_codes (code TEXT PRIMARY KEY, created_by TEXT, used_by TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, used_at DATETIME)');
  db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('CCPW01');
  db.close();

  const srv = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, DB_PATH: TMP_DB, PORT: String(PORT), JWT_SECRET: 'cc-switch-secret' },
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  srv.stderr.on('data', (c) => { logs += c; });

  const results = [];
  async function test(name, fn) {
    try { await fn(); results.push({ name, status: 'PASS' }); console.log(`✓ ${name}`); }
    catch (e) { results.push({ name, status: 'FAIL', error: e.message }); console.log(`✗ ${name}: ${e.message}`); }
  }

  let browser;
  try {
    for (let i = 0; i < 40; i++) {
      try { const r = await fetch(BASE + '/api/health'); if (r.ok) break; } catch (_) {}
      await new Promise((r) => setTimeout(r, 250));
    }
    // 服务启动后（表已建）再种入带 token/url/compat 的 verified 条目
    const db2 = new Database(dbFull);
    db2.prepare("INSERT OR IGNORE INTO items (id, name, desc, url, provider, category, token, token_type, tags, compat, models, verified, created_at, updated_at) VALUES ('ccswitch1', 'Anthropic 公益', '公益中转', 'https://relay.example.com/v1', '公益', '对话模型', 'sk-cc-demo-123', 'Anthropic', '[]', '[\"anthropic\",\"openai\"]', '[\"claude-sonnet-4-5\"]', 1, datetime('now'), datetime('now'))").run();
    db2.close();
    browser = await chromium.launch({ headless: true });

    // ---------- 未登录 ----------
    const anonCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const anon = await anonCtx.newPage();
    await test('未登录：详情弹窗不显示「导入 CC Switch」按钮，且 API Key 锁定', async () => {
      await anon.goto(BASE + '/', { waitUntil: 'networkidle' });
      await anon.locator('.card[data-id="ccswitch1"], [data-item-id="ccswitch1"], .card').first().click({ timeout: 5000 });
      await anon.waitForSelector('#modal.modal--open', { timeout: 5000 });
      await anon.waitForSelector('#modal .token-lock', { timeout: 5000 });
      const btnCount = await anon.locator('#modal [data-action="ccswitch"]').count();
      if (btnCount !== 0) throw new Error('未登录不应出现 CC Switch 按钮（count=' + btnCount + '）');
    });

    // ---------- 注册并注入登录态 ----------
    const reg = await (async () => {
      const r = await fetch(BASE + '/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'cc_pub', password: 'pass123456', inviteCode: 'CCPW01' })
      });
      if (!r.ok) throw new Error('register failed: ' + r.status);
      return await r.json();
    })();

    const userCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await userCtx.addInitScript(({ tok, usr }) => {
      localStorage.setItem('token', tok);
      localStorage.setItem('user', JSON.stringify(usr));
    }, { tok: reg.token, usr: reg.user });
    const page = await userCtx.newPage();

    await test('已登录：详情弹窗显示「导入 CC Switch」且 data 属性完整', async () => {
      await page.goto(BASE + '/', { waitUntil: 'networkidle' });
      await page.locator('.card').first().click({ timeout: 5000 });
      await page.waitForSelector('#modal.modal--open', { timeout: 5000 });
      const btn = page.locator('#modal [data-action="ccswitch"]');
      await btn.waitFor({ state: 'attached', timeout: 5000 });
      const attrs = await btn.evaluate((el) => ({
        name: el.getAttribute('data-name'),
        url: el.getAttribute('data-url'),
        token: el.getAttribute('data-token'),
        compat: el.getAttribute('data-compat'),
        tokentype: el.getAttribute('data-tokentype'),
        model: el.getAttribute('data-model')
      }));
      if (attrs.name !== 'Anthropic 公益') throw new Error('name 错误: ' + attrs.name);
      if (attrs.url !== 'https://relay.example.com/v1') throw new Error('url 错误: ' + attrs.url);
      if (attrs.token !== 'sk-cc-demo-123') throw new Error('token 错误: ' + attrs.token);
      if (attrs.compat !== 'anthropic,openai') throw new Error('compat 错误: ' + attrs.compat);
      if (attrs.tokentype !== 'Anthropic') throw new Error('tokentype 错误: ' + attrs.tokentype);
      if (attrs.model !== 'claude-sonnet-4-5') throw new Error('model 错误: ' + attrs.model);
      // 按 compat 推导目标 app=claude（Anthropic 优先）；期望值用 URLSearchParams 编码（空格→+）
      const exp = new URLSearchParams();
      exp.set('resource', 'provider'); exp.set('app', 'claude'); exp.set('name', 'Anthropic 公益');
      exp.set('endpoint', 'https://relay.example.com/v1'); exp.set('apiKey', 'sk-cc-demo-123'); exp.set('model', 'claude-sonnet-4-5');
      const expected = 'ccswitch://v1/import?' + exp.toString();
      const link = await page.evaluate(() => {
        const b = document.querySelector('#modal [data-action="ccswitch"]');
        const compat = (b.getAttribute('data-compat') || '').split(',');
        const tt = String(b.getAttribute('data-tokentype') || '').toLowerCase();
        let app = 'codex';
        if (compat.indexOf('anthropic') !== -1) app = 'claude';
        else if (compat.indexOf('gemini') !== -1) app = 'gemini';
        else if (compat.indexOf('openai') !== -1) app = 'codex';
        else if (tt.indexOf('anthropic') !== -1) app = 'claude';
        else if (tt.indexOf('gemini') !== -1) app = 'gemini';
        const p = new URLSearchParams();
        p.set('resource', 'provider'); p.set('app', app); p.set('name', b.getAttribute('data-name') || '');
        p.set('endpoint', b.getAttribute('data-url') || ''); p.set('apiKey', b.getAttribute('data-token') || '');
        const m = b.getAttribute('data-model'); if (m) p.set('model', m);
        return 'ccswitch://v1/import?' + p.toString();
      });
      if (link !== expected) throw new Error('深链不匹配\n期望: ' + expected + '\n实际: ' + link);
    });

    await test('已登录：复制完整配置按钮生成 OpenAI+Anthropic 双格式块（含 URL/Key/模型）', async () => {
      await page.locator('#modal [data-action="copyfull"]').waitFor({ state: 'attached', timeout: 5000 });
      await page.evaluate(() => {
        window.__copiedFull = '';
        navigator.clipboard.writeText = (t) => { window.__copiedFull = t; return Promise.resolve(); };
      });
      await page.locator('#modal [data-action="copyfull"]').click();
      await page.waitForTimeout(200);
      const copied = await page.evaluate(() => window.__copiedFull || '');
      if (!copied) throw new Error('剪贴板未写入完整配置');
      const need = ['https://relay.example.com/v1', 'sk-cc-demo-123', 'claude-sonnet-4-5',
        'OPENAI_BASE_URL=', 'OPENAI_API_KEY=', 'ANTHROPIC_BASE_URL=', 'ANTHROPIC_AUTH_TOKEN='];
      for (const s of need) if (copied.indexOf(s) === -1) throw new Error('复制内容缺少: ' + s + '\n实际:\n' + copied);
    });

    await test('点击按钮：未唤起时显示复制导入兜底面板（自动复制 Key + 重试），不抛 JS 错误', async () => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.locator('#modal [data-action="ccswitch"]').click();
      await page.waitForSelector('#ccFallback', { timeout: 4000 });
      const visible = await page.locator('#ccFallback').isVisible();
      if (!visible) throw new Error('兜底面板未显示');
      const fbText = await page.locator('#ccFallback').textContent();
      if (!/API Key/.test(fbText)) throw new Error('兜底面板缺少引导文案: ' + fbText);
      const copyBtn = await page.locator('#ccFallback .copy-btn').count();
      const retryBtn = await page.locator('#ccFallback #ccRetry').count();
      if (copyBtn !== 1) throw new Error('兜底面板缺少「复制 Key」按钮');
      if (retryBtn !== 1) throw new Error('兜底面板缺少「重试唤起」按钮');
      // 点重试应再次唤起（不抛错）
      await page.locator('#ccFallback #ccRetry').click();
      await page.waitForTimeout(300);
      if (errors.length) throw new Error('页面 JS 错误: ' + errors.join('; '));
    });

    await test('i 说明按钮：点击展开说明面板（含自检与修复脚本下载）', async () => {
      await page.locator('#modal [data-action="cchelp"]').click();
      const help = page.locator('#ccHelp');
      await help.waitFor({ state: 'visible', timeout: 3000 });
      const txt = await help.textContent();
      if (!/ccswitch:\/\//.test(txt)) throw new Error('说明面板缺少协议说明: ' + txt.slice(0, 80));
      const diagBtn = await page.locator('#ccHelp [data-action="ccdiag"]').count();
      const batLink = await page.locator('#ccHelp a[href="/download/cc-switch-register.bat"]').count();
      if (diagBtn !== 1) throw new Error('缺少「检测本地 CC Switch」按钮');
      if (batLink !== 1) throw new Error('缺少「下载一键修复脚本」链接');
      // 关闭再点一次可收起
      await page.locator('#modal [data-action="cchelp"]').click();
      const hidden = await help.evaluate((el) => el.style.display === 'none');
      if (!hidden) throw new Error('再次点击应收起说明面板');
    });
  } catch (e) {
    console.log('FATAL:', e.message);
    if (logs) console.log('SERVER LOG:', logs.slice(-800));
  } finally {
    if (browser) await browser.close();
    srv.kill();
    for (const f of [dbFull, dbFull + '-wal', dbFull + '-shm']) { try { fs.unlinkSync(f); } catch (_) {} }
  }

  const failed = results.filter((r) => r.status === 'FAIL');
  console.log(failed.length ? `\nFAIL: ${failed.length}/${results.length}` : `\nALL PASS ✓ (${results.length})`);
  process.exit(failed.length ? 1 : 0);
})();
