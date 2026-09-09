// 冒烟：中转站掺水检测 /verify（表单渲染/登录门控/端点识别模型列表/单模型掺水检测评分/移动端/CSP）
const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');

const TMP_DB = path.resolve(__dirname, '../data/verifypw.db');
try { fs.unlinkSync(TMP_DB); } catch (_) {}
try { fs.unlinkSync(TMP_DB + '-wal'); } catch (_) {}
try { fs.unlinkSync(TMP_DB + '-shm'); } catch (_) {}
process.env.DB_PATH = 'data/verifypw.db';
process.env.PORT = '0';
process.env.JWT_SECRET = 'test-secret';
process.env.API_RATE_LIMIT_MAX = '100000';
process.env.WRITE_RATE_LIMIT_MAX = '100000';
process.env.VERIFY_RATE_LIMIT_MAX = '100000';
process.env.ALLOW_PRIVATE_SSRF = '1';

const app = require('../server');
const getDb = require('../lib/db');

// 本地 OpenAI 兼容 mock：供 /verify 页面探测（/models + /chat/completions，知识题/身份/思维链可判定）
const verifyMock = http.createServer((req, res) => {
  let b = '';
  req.on('data', c => b += c);
  req.on('end', () => {
    if (req.url.startsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'mock-verify' }, { id: 'mock-reasoner' }, { id: 'mock-alias' }] }));
    } else if (req.url.startsWith('/chat/completions')) {
      let p = {}; try { p = JSON.parse(b || '{}'); } catch (_) {}
      const model = String(p.model || '');
      const userMsg = (p.messages && p.messages[0] && p.messages[0].content) || '';
      const isThinking = !!p.reasoning_effort;
      let content = 'hi';
      if (userMsg.indexOf('9.11') !== -1) content = '9.8';
      else if (userMsg.indexOf('2 的 10 次方') !== -1) content = '1024';
      else if (userMsg.indexOf('28天') !== -1) content = '全部';
      else if (userMsg.indexOf('什么模型') !== -1) content = '我是 GPT 系列模型';
      const msg = { role: 'assistant', content: content };
      if (model === 'mock-reasoner' && isThinking) msg.reasoning_content = '推理过程…';
      // mock-alias 回显别名（同义不同名 → echo warn，触发 AI 辅助判定段渲染，供折叠交互回归）
      const echo = model === 'mock-alias' ? 'mock-verify' : model;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'v', object: 'chat.completion', created: 1, model: echo,
        choices: [{ index: 0, message: msg, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 }
      }));
    } else { res.writeHead(404); res.end(); }
  });
});

(async () => {
  const server = app.listen(0, '127.0.0.1', async () => {
    const base = 'http://127.0.0.1:' + server.address().port;
    verifyMock.listen(0, '127.0.0.1', async () => {
      const mockBase = 'http://127.0.0.1:' + verifyMock.address().port;
      let fail = 0;
      const ok = (n, c) => { if (c) console.log('  PASS ' + n); else { fail++; console.log('  FAIL ' + n); } };
      try {
        // 注册用户拿 token（页面 API 走 Bearer）
        getDb().prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('PW01');
        const reg = await fetch(base + '/api/auth/register', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'pw_verify', password: 'test123456', inviteCode: 'PW01' })
        });
        const regJson = await reg.json();
        const token = regJson.token || '';
        const browser = await chromium.launch();
        try {
          const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
          const csp = [];
          page.on('console', m => { if (m.type() === 'error' && /Content Security Policy|Refused to/.test(m.text())) csp.push(m.text().slice(0, 120)); });
          await page.addInitScript((t) => { localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify({ username: 'pw_verify', role: 'user' })); }, token);

          await page.goto(base + '/verify', { waitUntil: 'networkidle' });
          ok('标题 = 中转站掺水检测', (await page.title()).includes('中转站掺水检测'));
          ok('检测卡片表单存在（组件挂载）', await page.locator('#verifyRelayMount .verify-form').count() === 1);
          ok('Base URL / API Key 输入框存在', await page.locator('#verifyRelayMount .verify-url').count() === 1 && await page.locator('#verifyRelayMount .verify-token').count() === 1);
          ok('导航「掺水检测」高亮', await page.locator('.nav__link--active', { hasText: '掺水检测' }).count() === 1);
          ok('API Key 默认掩码（type=password）', await page.locator('#verifyRelayMount .verify-token').getAttribute('type') === 'password');

          // 首页：掺水检测入口条位于 banner 数字统计卡片（.hero__stats）之后
          await page.goto(base + '/', { waitUntil: 'networkidle' });
          ok('首页 banner 内掺水检测入口存在', await page.locator('.verify-entry').count() === 1);
          const statsBox = await page.locator('.hero__stats').boundingBox();
          const entryBox = await page.locator('.verify-entry').boundingBox();
          ok('入口条在数字统计卡片下方（entry.top > stats.bottom - 4px）', !!statsBox && !!entryBox && entryBox.y >= (statsBox.y + statsBox.height - 4));
          ok('首页入口条与统计卡片同宽（避免明显错位）', !!statsBox && !!entryBox && Math.abs(statsBox.width - entryBox.width) < 24);

          // 回到 /verify 页继续端点识别
          await page.goto(base + '/verify', { waitUntil: 'networkidle' });

          // 端点识别 → 模型列表
          await page.fill('#verifyRelayMount .verify-url', mockBase);
          await page.fill('#verifyRelayMount .verify-token', 'sk-pw-test');
          await page.click('#verifyRelayMount .verify-submit');
          await page.waitForSelector('.model-row', { timeout: 15000 });
          ok('端点识别渲染模型行', await page.locator('.model-row').count() >= 1);
          ok('识别出 mock-verify', (await page.locator('#verifyRelayMount .verify-model-list').textContent()).includes('mock-verify'));

          // 单模型掺水检测 → 评分 + 判定 + 逐项 checks（报告渲染进该行 .model-row__report）
          await page.locator('[data-verify-model="mock-verify"]').click();
          await page.waitForSelector('.verify-score', { timeout: 15000 });
          const scoreTxt = await page.locator('#verifyRelayMount .model-row__report').first().textContent();
          ok('渲染评分卡（数字+判定）', /\d+/.test(scoreTxt) && /基本可信|存在疑点|疑似掺水/.test(scoreTxt));
          ok('渲染逐项 checks 行', await page.locator('.verify-check').count() >= 4);
          ok('mock-verify 判定基本可信', scoreTxt.includes('基本可信'));

          // 推理模型 mock-reasoner：思维链 pass（等新模型名进入详情，避免命中上一模型残留评分卡）
          await page.locator('[data-verify-model="mock-reasoner"]').click();
          await page.waitForFunction(() => { var r = document.querySelectorAll('#verifyRelayMount .model-row__report'); for (var i = 0; i < r.length; i++) { if (r[i].textContent.includes('mock-reasoner')) return true; } return false; }, { timeout: 15000 });
          ok('推理模型思维链 check 渲染', (await page.locator('#verifyRelayMount .model-row__report').nth(1).textContent()).includes('思维链'));

          // 别名模型 mock-alias：echo warn → AI 辅助判定段渲染且可展开（折叠交互回归）
          await page.locator('[data-verify-model="mock-alias"]').click();
          await page.waitForSelector('#verifyRelayMount .model-row__report:not(.is-collapsed) .verify-ai__head', { timeout: 30000 });
          ok('AI 辅助判定段渲染', true);
          await page.locator('#verifyRelayMount .model-row__report:not(.is-collapsed) .verify-ai__head').first().click();
          ok('AI 辅助判定可展开', await page.locator('#verifyRelayMount .model-row__report:not(.is-collapsed) .verify-ai__body:not(.is-collapsed)').count() >= 1);

          // 无 CSP 报错
          ok('无 CSP 报错', csp.length === 0);

          // ==== 详情弹窗：逐模型「掺水检测」按钮直接复用现有模型列表行（不另起第二套展示）====
          // 发布一条指向 verifyMock 的条目（发布即上线、登录可见 token → 详情模型列表行有「掺水检测」按钮）
          const pub = await fetch(base + '/api/items', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ name: 'PwVerify Item', url: mockBase, token: 'sk-pw-detail', tokenType: 'OpenAI', tags: [] })
          });
          const pubJson = await pub.json();
          ok('发布条目成功', pub.status === 201 && !!pubJson.id);
          if (pub.status === 201) {
            await page.goto(base + '/?id=' + pubJson.id, { waitUntil: 'networkidle' });
            // 不再有独立的 top-bar 掺水检测按钮/独立挂载；掺水检测直接进模型行
            ok('详情无独立顶栏按钮/独立挂载（全并进模型行）', (await page.locator('#verifyRelayBtn').count()) === 0 && (await page.locator('#verifyRelayMount').count()) === 0 && (await page.locator('#testTokenBtn').count()) === 0);
            // 模型行拆分为「可用性」（真实问答）+「掺水」（质量评分）两个独立按钮 + 「提醒」众测
            ok('模型行有「可用性」按钮', await page.locator('.model-row [data-model-check]').count() >= 1);
            ok('模型行有「掺水」按钮', await page.locator('.model-row [data-model-verify]').count() >= 1);
            ok('模型行有「提醒」众测按钮', await page.locator('.model-row [data-model-flag]').count() >= 1);
            ok('模型行仍有「复制」按钮', await page.locator('.model-row [data-model-copy]').count() >= 1);
            ok('有「一键测可用性」批量按钮', await page.locator('#checkAllModels').count() === 1);
            // 点「可用性」→ 真实问答 verdict（✓可用+状态码），不跑掺水
            await page.locator('.model-row [data-model-check]').first().click();
            await page.waitForFunction(() => { var r = document.querySelector('.model-row .model-row__result'); return r && /可用|限流|不可用|连接失败/.test(r.textContent); }, { timeout: 20000 });
            const availResult = await page.locator('.model-row .model-row__result').first().textContent();
            ok('可用性给出真实问答 verdict', /可用/.test(availResult));
            // 点「掺水」→ 评分判定 + 行下展开完整报告（含评分卡与逐项 checks）
            await page.locator('.model-row [data-model-verify]').first().click();
            await page.waitForFunction(() => { var r = document.querySelector('.model-row .model-row__result'); return r && /基本可信|存在疑点|疑似掺水|限流|不可用|无法连接/.test(r.textContent); }, { timeout: 30000 });
            const rowResult = await page.locator('.model-row .model-row__result').first().textContent();
            ok('行内显示掺水判定', /基本可信|存在疑点|疑似掺水/.test(rowResult));
            await page.waitForSelector('.model-row__report:not(.is-collapsed)', { timeout: 10000 });
            ok('行下展开完整掺水报告（含评分卡）', await page.locator('.model-row__report:not(.is-collapsed) .verify-score').count() >= 1);
            ok('报告含逐维度 checks（对话/回显/知识/身份/思维链）', await page.locator('.model-row__report:not(.is-collapsed) .verify-check').count() >= 4);
            // 再点「掺水」→ 收起报告卡片（不重复请求）
            await page.locator('.model-row [data-model-verify]').first().click();
            ok('再点收起报告卡片', await page.locator('.model-row__report.is-collapsed').count() >= 1);
            // 别名模型行：掺水跑出 AI 判定段，且详情弹窗里点得开（此前绑定缺失点不动）
            await page.locator('.model-row [data-model-verify="mock-alias"]').click();
            await page.waitForSelector('.model-row__report:not(.is-collapsed) .verify-ai__head', { timeout: 30000 });
            ok('详情弹窗渲染 AI 辅助判定段', true);
            await page.locator('.model-row__report:not(.is-collapsed) .verify-ai__head').first().click();
            ok('详情弹窗 AI 判定可展开', await page.locator('.model-row__report:not(.is-collapsed) .verify-ai__body:not(.is-collapsed)').count() >= 1);
            // 知识问答每题留痕（答对也有问→答行，不止汇总）
            ok('知识问答逐题有反馈', (await page.locator('.model-row__report:not(.is-collapsed)').first().textContent()).includes('9.8'));
            // 众测打架回归：路人失败 vs 我的成功 —— 我的置顶“我·”，路人降为“最近·”，不再并排混淆
            getDb().prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('PW02');
            const reg2 = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'pw_verify2', password: 'test123456', inviteCode: 'PW02' }) });
            const t2 = (await reg2.json()).token || '';
            await fetch(base + '/api/items/' + pubJson.id + '/model-probe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t2 }, body: JSON.stringify({ model: 'mock-verify', ok: false, status: 404 }) });
            await page.goto(base + '/?id=' + pubJson.id, { waitUntil: 'networkidle' });
            await page.waitForSelector('.model-row', { timeout: 15000 });
            await page.waitForFunction(() => { var e = document.querySelector('[data-model-crowd="mock-verify"]'); return e && e.textContent.trim().length > 0; }, { timeout: 10000 });
            const crowd0 = await page.locator('[data-model-crowd="mock-verify"]').textContent();
            ok('路人失败显示为“最近·✗”（无我·）', /最近/.test(crowd0) && /✗|不可用/.test(crowd0) && !/我·/.test(crowd0));
            await page.locator('.model-row [data-model-check="mock-verify"]').click();
            await page.waitForFunction(() => { var e = document.querySelector('[data-model-crowd="mock-verify"]'); return e && /我·/.test(e.textContent); }, { timeout: 10000 });
            const crowd1 = await page.locator('[data-model-crowd="mock-verify"]').textContent();
            ok('我的实测置顶（我·✓可用在前）', /我·/.test(crowd1) && /✓可用/.test(crowd1) && crowd1.indexOf('我·') < crowd1.indexOf('最近'));
            ok('路人历史保留不断舍（仍有“最近·”）', /最近/.test(crowd1));
          }

          // 移动端：375px 单列，卡片不溢出
          const m = await browser.newPage({ viewport: { width: 375, height: 800 } });
          await m.addInitScript((t) => { localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify({ username: 'pw_verify', role: 'user' })); }, token);
          await m.goto(base + '/verify', { waitUntil: 'networkidle' });
          const cardWidth = await m.locator('.verify-card').evaluate(el => el.getBoundingClientRect().width);
          const noHScroll = await m.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
          ok('移动端卡片单列不溢出（card=' + Math.round(cardWidth) + 'px）', cardWidth <= 375 && noHScroll);
          await m.close();
        } finally {
          await browser.close();
        }
      } catch (e) {
        fail++; console.log('  ERROR ' + e.message);
      } finally {
        server.close();
        if (server.closeAllConnections) server.closeAllConnections();
        verifyMock.close();
        try { fs.unlinkSync(TMP_DB); } catch (_) {}
        try { fs.unlinkSync(TMP_DB + '-wal'); } catch (_) {}
        try { fs.unlinkSync(TMP_DB + '-shm'); } catch (_) {}
        console.log(fail ? '\nPlaywright verify: FAIL ' + fail : '\nPlaywright verify: PASS');
        process.exit(fail ? 1 : 0);
      }
    });
  });
})();
