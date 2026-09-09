// CLI 端到端测试（独立脚本）：启动真实 server + 异步 spawn `node cli.js` 验证
// 关键：必须用异步 spawn（同步 spawnSync 会阻塞事件循环，导致同进程 server 无法响应）
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const TMP_DB = path.resolve(__dirname, '../data/cli-e2e.db');
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-home-'));
// 清理旧测试库，保证可重复运行
try { fs.unlinkSync(TMP_DB); } catch (_) {}
try { fs.unlinkSync(TMP_DB + '-wal'); } catch (_) {}
try { fs.unlinkSync(TMP_DB + '-shm'); } catch (_) {}
process.env.DB_PATH = 'data/cli-e2e.db';
process.env.PORT = '0';
process.env.JWT_SECRET = 'test-secret';
process.env.API_RATE_LIMIT_MAX = '100000';
process.env.WRITE_RATE_LIMIT_MAX = '100000';
process.env.ALLOW_PRIVATE_SSRF = '1';

const app = require('../server');
const getDb = require('../lib/db');
const CLI = path.resolve(__dirname, '../cli.js');

let pass = 0, fail = 0, baseUrl = '', verifyMockUrl = '';
function ok(name) { pass++; console.log('  ✓ ' + name); }
function bad(name, msg) { fail++; console.log('  ✗ ' + name + ': ' + msg); }

// 中转站掺水检测 mock：verify 命令探测用的本地 OpenAI 兼容端点（/models + /chat/completions）
const verifyMock = http.createServer((req, res) => {
  let b = '';
  req.on('data', c => b += c);
  req.on('end', () => {
    if (req.url.startsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'mock-verify' }] }));
    } else if (req.url.startsWith('/chat/completions')) {
      let p = {}; try { p = JSON.parse(b || '{}'); } catch (_) {}
      const m = String(p.model || 'mock-verify');
      const userMsg = (p.messages && p.messages[0] && p.messages[0].content) || '';
      let content = 'hi';
      if (userMsg.indexOf('9.11') !== -1) content = '9.8';
      else if (userMsg.indexOf('2 的 10 次方') !== -1) content = '1024';
      else if (userMsg.indexOf('28天') !== -1) content = '全部';
      else if (userMsg.indexOf('什么模型') !== -1) content = '我是 mock-verify 模型';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'v', object: 'chat.completion', created: 1, model: m,
        choices: [{ index: 0, message: { role: 'assistant', content: content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 }
      }));
    } else { res.writeHead(404); res.end(); }
  });
});

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn('node', [CLI, ...args], {
      env: { ...process.env, TOKEN_API: baseUrl, HOME: TMP_HOME }
    });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); resolve({ exit: 143, out: out + err }); }, 10000);
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    child.on('close', (code) => { clearTimeout(timer); resolve({ exit: code, out: out + err }); });
  });
}

async function main(verifyMockUrl) {
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('CLIE2E01');

  let r = await runCli(['--json', 'ping']);
  try { const d = JSON.parse(r.out); (r.exit === 0 && d.ok) ? ok('ping') : bad('ping', r.out.slice(0, 80)); }
  catch { bad('ping', r.out.slice(0, 80)); }

  r = await runCli(['--json', 'register', '-u', 'clie2e_user', '-p', 'pass123456', '-c', 'CLIE2E01']);
  try { const d = JSON.parse(r.out); (r.exit === 0 && d.ok && d.data.user && d.data.token) ? ok('register 带码成功返回 user/token') : bad('register', r.out.slice(0, 80)); }
  catch { bad('register', r.out.slice(0, 80)); }

  r = await runCli(['--json', 'register', '-u', 'nobody', '-p', 'pass123456']);
  (r.exit !== 0 && r.out.includes('邀请码')) ? ok('register 缺邀请码被拒') : bad('register 缺邀请码', 'exit=' + r.exit + ' ' + r.out.slice(0, 80));

  r = await runCli(['--json', 'login', '-t', 'invalid-token-xxxx']);
  (r.exit !== 0 && r.out.includes('验证失败')) ? ok('login -t 无效 token 失败且退出非 0') : bad('login -t 无效 token', 'exit=' + r.exit + ' ' + r.out.slice(0, 80));

  r = await runCli(['--json', 'add', '-n', 'CLI E2E 纯链接', '-u', 'https://example.com', '-p', '测试', '-c', '其他']);
  (r.exit !== 0 && /token/i.test(r.out)) ? ok('add 无 Token 被拒绝（本站只收录真实可用 Token）') : bad('add 无 Token 被拒', 'exit=' + r.exit + ' ' + r.out.slice(0, 80));

  // 发布只收真实可用 Token；为 my/recent 造一条已验证的 Token 条目（直接入库，绕开真实端点）
  const uid = getDb().prepare("SELECT id FROM users WHERE username='clie2e_user'").get();
  getDb().prepare("INSERT OR REPLACE INTO items (id,name,desc,url,provider,category,token,token_type,compat,created_by,verified,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,datetime('now'),datetime('now'))")
    .run('recent-e2e-1', 'CLI E2E Token 条目', '', 'https://api.example.com/v1', '测试', '其他', 'sk-recent-e2e-token', 'OpenAI', '["openai"]', uid.id);

  r = await runCli(['--json', 'my', '--stats']);
  try { const d = JSON.parse(r.out); (r.exit === 0 && d.ok && typeof d.data.total === 'number' && d.data.total >= 1) ? ok('my --stats') : bad('my --stats', r.out.slice(0, 80)); }
  catch { bad('my --stats', r.out.slice(0, 80)); }

  r = await runCli(['--json', 'recent']);
  try { const d = JSON.parse(r.out); (r.exit === 0 && d.ok && Array.isArray(d.data.items) && d.data.items.some(i => i.token === 'sk-recent-e2e-token')) ? ok('recent 获取最近 API Key') : bad('recent', r.out.slice(0, 80)); }
  catch { bad('recent', r.out.slice(0, 80)); }

  r = await runCli(['--json', 'points']);
  try { const d = JSON.parse(r.out); (r.exit === 0 && d.ok && typeof d.data.points === 'number' && d.data.freePullsPerDay === 5) ? ok('points 查看余额/额度') : bad('points', r.out.slice(0, 80)); }
  catch { bad('points', r.out.slice(0, 80)); }

  getDb().prepare("UPDATE users SET role='admin' WHERE username='clie2e_user'").run();
  r = await runCli(['--json', 'admin', 'invite', '2']);
  try { const d = JSON.parse(r.out); (r.exit === 0 && d.ok && d.data.created.length === 2) ? ok('admin invite 生成') : bad('admin invite', r.out.slice(0, 80)); }
  catch { bad('admin invite', r.out.slice(0, 80)); }

  r = await runCli(['--json', 'admin', 'check']);
  try { const d = JSON.parse(r.out); (r.exit === 0 && d.ok && Array.isArray(d.data.offline)) ? ok('admin check') : bad('admin check', r.out.slice(0, 80)); }
  catch { bad('admin check', r.out.slice(0, 80)); }

  // 教程：--file 发布 → my → 管理员审核 → view
  const tutMd = path.join(os.tmpdir(), 'cli-e2e-tut.md');
  fs.writeFileSync(tutMd, '# CLI E2E 教程\n\n正文内容，支持 **加粗** 和 `代码`。\n\n- 列表项\n');
  r = await runCli(['--json', 'tutorial', 'add', '--title', 'CLI E2E 教程', '--category', '教程', '--cover', '/uploads/e2e.png', '--file', tutMd]);
  try { const d = JSON.parse(r.out); (r.exit === 0 && d.ok && d.data.id && d.data.verified === false && d.data.cover === '/uploads/e2e.png') ? ok('tutorial add --file 发布（含 --cover）') : bad('tutorial add', r.out.slice(0, 80)); }
  catch { bad('tutorial add', r.out.slice(0, 80)); }

  // 本站绝对 cover URL（如换域名前存储的 / https://freeapis.top/uploads/x.png）由服务器归一化为相对，
  // 双域名下图片都按当前域名同源加载、不触发 CORP 跨域拦截
  r = await runCli(['--json', 'tutorial', 'add', '--title', 'CLI 绝对封面', '--category', '教程', '--cover', 'https://freeapis.top/uploads/e2e_abs.png', '--file', tutMd]);
  try { const d = JSON.parse(r.out); (r.exit === 0 && d.ok && d.data.cover === '/uploads/e2e_abs.png') ? ok('tutorial add 本站绝对 cover 归一化为相对') : bad('tutorial add 绝对 cover', r.out.slice(0, 100)); }
  catch { bad('tutorial add 绝对 cover', r.out.slice(0, 100)); }

  r = await runCli(['--json', 'tutorial', 'my']);
  try { const d = JSON.parse(r.out); (r.exit === 0 && d.ok && Array.isArray(d.data) && d.data.length >= 1) ? ok('tutorial my') : bad('tutorial my', r.out.slice(0, 80)); }
  catch { bad('tutorial my', r.out.slice(0, 80)); }

  const tutRow = getDb().prepare("SELECT id FROM tutorials WHERE title='CLI E2E 教程'").get();
  r = await runCli(['--json', 'admin', 'tutorial-verify', '--', tutRow.id]);
  try { const d = JSON.parse(r.out); (r.exit === 0 && d.ok && d.data.verified === true) ? ok('admin tutorial-verify 审核通过') : bad('admin tutorial-verify', r.out.slice(0, 80)); }
  catch { bad('admin tutorial-verify', r.out.slice(0, 80)); }

  r = await runCli(['--json', 'tutorial', 'view', '--', tutRow.id]);
  try { const d = JSON.parse(r.out); (r.exit === 0 && d.ok && d.data.content.includes('加粗')) ? ok('tutorial view 读全文') : bad('tutorial view', r.out.slice(0, 80)); }
  catch { bad('tutorial view', r.out.slice(0, 80)); }

  r = await runCli(['--json', 'tutorial', 'list']);
  try { const d = JSON.parse(r.out); (r.exit === 0 && d.ok && Array.isArray(d.data) && d.data.length >= 1) ? ok('tutorial list') : bad('tutorial list', r.out.slice(0, 80)); }
  catch { bad('tutorial list', r.out.slice(0, 80)); }

  r = await runCli(['--json', 'tutorial', 'search', 'E2E']);
  try { const d = JSON.parse(r.out); (r.exit === 0 && d.ok && Array.isArray(d.data) && d.data.some(t => t.id === tutRow.id)) ? ok('tutorial search 命中') : bad('tutorial search', r.out.slice(0, 80)); }
  catch { bad('tutorial search', r.out.slice(0, 80)); }

  r = await runCli(['--json', 'tutorial', 'list', '--search', 'E2E']);
  try { const d = JSON.parse(r.out); (r.exit === 0 && d.ok && Array.isArray(d.data) && d.data.some(t => t.id === tutRow.id)) ? ok('tutorial list --search 命中') : bad('tutorial list --search', r.out.slice(0, 80)); }
  catch { bad('tutorial list --search', r.out.slice(0, 80)); }

  // id 可能以 - 开头（nanoid 字符集含 -），用 -- 分隔避免 commander 当 option 解析（同 view 的规避）
  r = await runCli(['--json', 'tutorial', 'edit', '--cover', 'https://example.com/new-cover.jpg', '--', tutRow.id]);
  try { const d = JSON.parse(r.out); (r.exit === 0 && d.ok && d.data.cover === 'https://example.com/new-cover.jpg') ? ok('tutorial edit --cover 更新封面') : bad('tutorial edit --cover', r.out.slice(0, 80)); }
  catch { bad('tutorial edit --cover', r.out.slice(0, 80)); }

  r = await runCli(['--json', 'tutorial', 'edit', '--cover=', '--', tutRow.id]);
  try { const d = JSON.parse(r.out); (r.exit === 0 && d.ok && d.data.cover === '') ? ok('tutorial edit --cover= 移除封面') : bad('tutorial edit --cover 清空', r.out.slice(0, 80)); }
  catch { bad('tutorial edit --cover 清空', r.out.slice(0, 80)); }
  try { fs.unlinkSync(tutMd); } catch (_) {}

  r = await runCli(['--json', 'audit', '--status', 'bogus']);
  (r.exit !== 0 && r.out.includes('pending / verified / all')) ? ok('audit 非法 --status 被拒') : bad('audit 非法 status', 'exit=' + r.exit + ' ' + r.out.slice(0, 80));

  // 管理员重置密码
  db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('CLIE2E02');
  r = await runCli(['--json', 'register', '-u', 'reset_target', '-p', 'oldpass123', '-c', 'CLIE2E02']);
  let rpId = '';
  try { const d = JSON.parse(r.out); if (r.exit === 0 && d.ok && d.data.user) rpId = d.data.user.id; } catch (_) {}
  if (!rpId) { bad('admin reset-password 前置注册', r.out.slice(0, 80)); }
  else {
    // register 覆盖了本地 token（reset_target），先重新登录回管理员
    r = await runCli(['--json', 'login', '-u', 'clie2e_user', '-p', 'pass123456']);
    try { const d = JSON.parse(r.out); (r.exit === 0 && d.ok && d.data.user.role === 'admin') ? ok('重置前重登管理员') : bad('重置前重登管理员', r.out.slice(0, 80)); }
    catch { bad('重置前重登管理员', r.out.slice(0, 80)); }

    r = await runCli(['--json', 'admin', 'reset-password', rpId, 'newpass456']);
    try { const d = JSON.parse(r.out); (r.exit === 0 && d.ok && d.data.username === 'reset_target') ? ok('admin reset-password 重置成功') : bad('admin reset-password', r.out.slice(0, 80)); }
    catch { bad('admin reset-password', r.out.slice(0, 80)); }

    r = await runCli(['--json', 'admin', 'reset-password', rpId, 'weak']);
    (r.exit !== 0 && r.out.includes('密码')) ? ok('admin reset-password 弱密码被拒') : bad('admin reset-password 弱密码', 'exit=' + r.exit + ' ' + r.out.slice(0, 80));

    r = await runCli(['--json', 'login', '-u', 'reset_target', '-p', 'newpass456']);
    try { const d = JSON.parse(r.out); (r.exit === 0 && d.ok && d.data.user.username === 'reset_target') ? ok('重置后新密码可登录') : bad('重置后新密码登录', r.out.slice(0, 80)); }
    catch { bad('重置后新密码登录', r.out.slice(0, 80)); }
  }

  // 无验证码找回密码：注册带邮箱 → recover 改密 → 新密码登录
  db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('CLIE2E03');
  r = await runCli(['--json', 'register', '-u', 'recover_user', '-p', 'oldpass123', '-c', 'CLIE2E03', '--email', 'rec@cli.com']);
  try { const d = JSON.parse(r.out); (r.exit === 0 && d.ok && d.data.user.username === 'recover_user') ? ok('register --email 注册成功') : bad('register --email', r.out.slice(0, 80)); }
  catch { bad('register --email', r.out.slice(0, 80)); }

  r = await runCli(['--json', 'recover', '-u', 'recover_user', '-e', 'rec@cli.com', '-p', 'newpass456']);
  try { const d = JSON.parse(r.out); (r.exit === 0 && d.ok && d.data.user.username === 'recover_user') ? ok('recover 邮箱找回重置成功') : bad('recover', r.out.slice(0, 80)); }
  catch { bad('recover', r.out.slice(0, 80)); }

  r = await runCli(['--json', 'login', '-u', 'recover_user', '-p', 'newpass456']);
  try { const d = JSON.parse(r.out); (r.exit === 0 && d.ok && d.data.user.username === 'recover_user') ? ok('找回后新密码可登录') : bad('找回后登录', r.out.slice(0, 80)); }
  catch { bad('找回后登录', r.out.slice(0, 80)); }

  r = await runCli(['--json', 'recover', '-u', 'recover_user', '-e', 'wrong@cli.com', '-p', 'newpass789']);
  (r.exit !== 0 && r.out.includes('不匹配')) ? ok('recover 错误邮箱被拒') : bad('recover 错误邮箱', 'exit=' + r.exit + ' ' + r.out.slice(0, 80));

  // profile 更新邮箱/手机号（当前登录用户为 recover_user）
  r = await runCli(['--json', 'profile', '-e', 'pro@cli.com', '--phone', '13700001111']);
  try { const d = JSON.parse(r.out); (r.exit === 0 && d.ok && d.data.email === 'pro@cli.com' && d.data.phone === '13700001111') ? ok('profile 设置邮箱/手机号') : bad('profile 设置邮箱', r.out.slice(0, 80)); }
  catch { bad('profile 设置邮箱', r.out.slice(0, 80)); }

  r = await runCli(['--json', 'profile']);
  try { const d = JSON.parse(r.out); (r.exit === 0 && d.ok && d.data.email === 'pro@cli.com') ? ok('profile 查看显示邮箱') : bad('profile 查看', r.out.slice(0, 80)); }
  catch { bad('profile 查看', r.out.slice(0, 80)); }

  // 图片上传（cli upload）：真 PNG 成功返回 /uploads/xxx.png；非图片被拒
  const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const pngPath = path.join(TMP_HOME, 'cover.png');
  const txtPath = path.join(TMP_HOME, 'bad.txt');
  fs.writeFileSync(pngPath, TINY_PNG);
  fs.writeFileSync(txtPath, 'not an image');
  r = await runCli(['--json', 'upload', pngPath]);
  try {
    const d = JSON.parse(r.out);
    (r.exit === 0 && d.ok && d.data.url && /^\/uploads\/[0-9a-f]{16}\.png$/.test(d.data.url))
      ? ok('upload 上传 PNG 返回 /uploads/xxx.png') : bad('upload', r.out.slice(0, 80));
    if (d.ok && d.data.url) { try { fs.unlinkSync(path.resolve(__dirname, '../data/uploads/' + path.basename(d.data.url))); } catch (_) {} }
  } catch { bad('upload', r.out.slice(0, 80)); }
  r = await runCli(['--json', 'upload', txtPath]);
  (r.exit !== 0 && r.out.includes('仅支持')) ? ok('upload 非图片被拒') : bad('upload 非图片', 'exit=' + r.exit + ' ' + r.out.slice(0, 80));
  r = await runCli(['--json', 'upload', path.join(TMP_HOME, 'missing.png')]);
  (r.exit !== 0 && r.out.includes('读取文件失败')) ? ok('upload 不存在的文件被拒') : bad('upload 缺失文件', 'exit=' + r.exit + ' ' + r.out.slice(0, 80));

  // 中转站掺水检测：本地 mock 端点 → verify-relay 端点识别模型；-m 单模型掺水检测
  r = await runCli(['--json', 'verify-relay', '-u', verifyMockUrl, '-t', 'sk-verify-test']);
  try {
    const d = JSON.parse(r.out);
    (r.exit === 0 && d.ok && Array.isArray(d.data.models) && d.data.models.some(m => m.id === 'mock-verify') && Array.isArray(d.data.checks))
      ? ok('verify-relay 端点识别模型列表') : bad('verify-relay', r.out.slice(0, 80));
  } catch { bad('verify-relay', r.out.slice(0, 80)); }

  r = await runCli(['--json', 'verify-relay', '-u', verifyMockUrl, '-t', 'sk-verify-test', '-m', 'mock-verify']);
  try {
    const d = JSON.parse(r.out);
    (r.exit === 0 && d.ok && typeof d.data.score === 'number' && d.data.score >= 80 && d.data.verdict === '基本可信' && Array.isArray(d.data.checks))
      ? ok('verify-relay -m 单模型掺水检测（评分+判定+逐项）') : bad('verify-relay -m', r.out.slice(0, 80));
  } catch { bad('verify-relay -m', r.out.slice(0, 80)); }

  r = await runCli(['--json', 'verify-relay']);
  (r.exit !== 0) ? ok('verify-relay 缺必填 -u/-t 被拒') : bad('verify-relay 缺 -u/-t', 'exit=' + r.exit + ' ' + r.out.slice(0, 80));

  console.log(`\nCLI e2e: ${pass}/${pass + fail} 通过`);
  process.exit(fail ? 1 : 0);
}

const server = app.listen(0, '127.0.0.1', async () => {
  baseUrl = 'http://127.0.0.1:' + server.address().port;
  console.log('CLI 端到端测试');
  verifyMock.listen(0, '127.0.0.1', async () => {
    verifyMockUrl = 'http://127.0.0.1:' + verifyMock.address().port;
    try { await main(verifyMockUrl); }
    finally {
      server.close();
      if (server.closeAllConnections) server.closeAllConnections();
      verifyMock.close();
      try { fs.unlinkSync(TMP_DB); } catch (_) {}
      try { fs.unlinkSync(TMP_DB + '-wal'); } catch (_) {}
      try { fs.unlinkSync(TMP_DB + '-shm'); } catch (_) {}
      try { fs.rmSync(TMP_HOME, { recursive: true, force: true }); } catch (_) {}
    }
  });
});
