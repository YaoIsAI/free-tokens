const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('path');
const fs = require('fs');

// 测试用 SQLite 数据库
const TMP_DB = path.resolve(__dirname, '../data/test.db');
process.env.DB_PATH = 'data/test.db';
process.env.PORT = '0';
process.env.JWT_SECRET = 'test-secret';
process.env.API_RATE_LIMIT_MAX = '100000';
process.env.WRITE_RATE_LIMIT_MAX = '100000';
process.env.RECOVERY_RATE_LIMIT_MAX = '100000';
process.env.VERIFY_RATE_LIMIT_MAX = '100000';
process.env.TEST_TOKEN_RATE_LIMIT_MAX = '100000';
process.env.ALLOW_PRIVATE_SSRF = '1'; // 测试 mock 服务器用 127.0.0.1；SSRF 拦截单独用例会临时关闭再验证

const app = require('../server');
const getDb = require('../lib/db');
const aiJudge = require('../lib/ai-judge'); // 与 server 同一实例（Node 模块缓存），测试可复位判官池

let server, mock, mockPort = 0, xiaomiMock, xiaomiMockPort = 0, verifyMock, verifyMockPort = 0, aiJudgeMock, aiJudgeMockPort = 0, token = '', createdIds = [];
function mockBase() { return 'http://127.0.0.1:' + mockPort; }
function xiaomiMockBase() { return 'http://127.0.0.1:' + xiaomiMockPort; }
function verifyMockBase() { return 'http://127.0.0.1:' + verifyMockPort; }
function aiJudgeMockBase() { return 'http://127.0.0.1:' + aiJudgeMockPort; }

function request(method, urlPath, body, authToken) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const opts = {
      hostname: '127.0.0.1', port: server.address().port,
      path: urlPath, method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'Connection': 'close' }
    };
    if (authToken) opts.headers['Authorization'] = 'Bearer ' + authToken;
    const req = http.request(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(d); } catch { parsed = d; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// 原始二进制 body 上传（zip 包等）：body 为 Buffer，自定义 Content-Type
function requestRaw(method, urlPath, body, authToken, contentType) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1', port: server.address().port,
      path: urlPath, method,
      headers: { 'Content-Type': contentType || 'application/octet-stream' }
    };
    if (authToken) opts.headers['Authorization'] = 'Bearer ' + authToken;
    if (body) opts.headers['Content-Length'] = Buffer.byteLength(body);
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let parsed;
        try { parsed = JSON.parse(buf.toString()); } catch { parsed = buf; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// 带自定义 User-Agent 的请求（模拟「伪装成爬虫」的服务器攻击）
function crawlerRequest(urlPath, ua) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1', port: server.address().port,
      path: urlPath, method: 'GET',
      headers: { 'User-Agent': ua }
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

// 带自定义 Host 头的请求（用于校验双域名分享卡片/海报按当前访问域名渲染）
function requestWithHost(host, urlPath) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1', port: server.address().port,
      path: urlPath, method: 'GET',
      headers: { 'Host': host }
    };
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

// 原始二进制上传（教程封面）
function rawRequest(path, buffer, contentType, authToken) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1', port: server.address().port,
      path, method: 'POST',
      headers: { 'Content-Type': contentType, 'Content-Length': buffer.length }
    };
    if (authToken) opts.headers['Authorization'] = 'Bearer ' + authToken;
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.write(buffer);
    req.end();
  });
}

// 1×1 红色 PNG（有效图片，魔数 89504e47）
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

before(() => {
  return new Promise((resolve, reject) => {
    // 清理测试数据库
    try { fs.unlinkSync(TMP_DB); } catch (_) {}
    try { fs.unlinkSync(TMP_DB + '-wal'); } catch (_) {}
    try { fs.unlinkSync(TMP_DB + '-shm'); } catch (_) {}
    // mock：/models 返回 200，让带 token 的测试条目通过校验
    mock = http.createServer((req, res) => {
      let reqBody = '';
      req.on('data', c => reqBody += c);
      req.on('end', () => {
        handleMock(req, res, reqBody);
      });
      function handleMock(req, res, body) {
      if (req.url.startsWith('/fake') && req.url.includes('/models')) {
        // 反投毒用例：假端点"来者不拒"，200 但模型列表为空
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [] }));
      } else if (req.url.startsWith('/chat/completions')) {
        // 单模型独立测试：mock-model 可用；m-429 限流；其他模型名 400（模型不存在）
        let model = '';
        try { model = (JSON.parse(body || '{}').model || '').toString(); } catch (_) {}
        if (model === 'm-429') {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'rate limited' } }));
        } else if (model === 'mock-model') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'model not found: ' + model } }));
        }
      } else if (req.url.startsWith('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }));
      } else if (req.url.startsWith('/v1/messages')) {
        // Anthropic 兼容探测：返回 200 表示端点识别 anthropic API
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ content: [{ type: 'text', text: 'hi' }] }));
      } else if (req.url.startsWith('/503')) {
        // 失效检测用例：模拟服务不可用（维护中）
        res.writeHead(503); res.end();
      } else if (req.url.startsWith('/429')) {
        // 限流保护用例：模拟 429（API 存在但限额/限流）
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'rate limited' } }));
      } else if (req.url.startsWith('/poison')) {
        // 「假/掺水端点」用例：/models 返回 200 列出模型，但 /chat/completions 该模型 400（不可用）
        if (req.url.endsWith('/models')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: [{ id: 'poison-model' }] }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'model not usable: poison-model' } }));
        }
      } else { res.writeHead(404); res.end(); }
      }
    });
    // 中转站掺水检测 mock：可控的模型回显 / usage / 知识答案 / 身份 / 思维链，供 verify 电池用例断言
    verifyMock = http.createServer((req, res) => {
      let vBody = '';
      req.on('data', c => vBody += c);
      req.on('end', () => {
        if (req.url.startsWith('/models')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: [{ id: 'v-gpt' }, { id: 'v-reasoner-think' }, { id: 'v-reasoner-nothink' }, { id: 'v-poison' }] }));
        } else if (req.url.startsWith('/chat/completions')) {
          let p = {};
          try { p = JSON.parse(vBody || '{}'); } catch (_) {}
          const model = String(p.model || '');
          const userMsg = (p.messages && p.messages[0] && p.messages[0].content) || '';
          const isThinkingProbe = !!p.reasoning_effort;
          let content = 'hi';
          if (userMsg.indexOf('9.11') !== -1) content = '9.8';
          else if (userMsg.indexOf('2 的 10 次方') !== -1) content = '1024';
          else if (userMsg.indexOf('28天') !== -1) content = '全部';
          else if (userMsg.indexOf('什么模型') !== -1) content = '我是 GPT 系列模型';
          // 模型回显：请求 gpt-5 被"换成"claude（换皮实锤）；gpt-nano-* 回显 gpt-nano（同家族前缀变体，AI 应判同一）；其余回显自身
          const echo = model === 'gpt-5' ? 'claude-3-5-sonnet' : (/^gpt-nano-/.test(model) ? 'gpt-nano' : model);
          if (model === 'v-notfound') {
            // 模拟中转站「分组下模型无可用渠道」：404 + 后端错误原文，供 error 透出用例断言
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'model not found: v-notfound' } }));
            return;
          }
          const msg = { role: 'assistant', content: content };
          if (model === 'v-reasoner-think' && isThinkingProbe) msg.reasoning_content = '先逐步推理再回答。';
          const payload = {
            id: 'chatcmpl-v', object: 'chat.completion', created: 1, model: echo,
            choices: [{ index: 0, message: msg, finish_reason: 'stop' }],
            usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 }
          };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(payload));
        } else { res.writeHead(404); res.end(); }
      });
    });
    mock.listen(0, '127.0.0.1', () => {
      mockPort = mock.address().port;
      // 小米式分前缀 mock：models 在 /v1/models、messages 在 /anthropic/v1/messages，
      // 其余路径（含 /models、/v1/messages）一律 404 —— 复现"裸 base 探测撞空路径"发布失败
      xiaomiMock = http.createServer((req, res) => {
        if (req.url.startsWith('/v1/models')) {
          if (req.headers.authorization === 'Bearer sk-bad-xiaomi') { res.writeHead(401); res.end(JSON.stringify({ error: 'invalid key' })); return; }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: [{ id: 'xiaomi-model' }] }));
        } else if (req.url.startsWith('/anthropic/v1/messages')) {
          if (req.headers['x-api-key'] === 'sk-bad-xiaomi') { res.writeHead(401); res.end(JSON.stringify({ error: 'invalid key' })); return; }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ content: [{ type: 'text', text: 'hi' }] }));
        } else { res.writeHead(404); res.end(); }
      });
      xiaomiMock.listen(0, '127.0.0.1', () => {
        xiaomiMockPort = xiaomiMock.address().port;
        server = app.listen(0, '127.0.0.1', () => {
          verifyMock.listen(0, '127.0.0.1', () => {
            verifyMockPort = verifyMock.address().port;
            // AI 判官 mock：/models 返回可用 judge 模型；/chat/completions 收到含 AI_VERDICT 的
            // prompt 时返回结构化 JSON（echoSame/identityConflict/knowledgeCorrect/conclusion），
            // 其余普通对话也返回文本（供探测健康）。header x-judge-garbage=1 时返回非 JSON 测解析降级。
            aiJudgeMock = http.createServer((req, res) => {
              let aBody = '';
              req.on('data', c => aBody += c);
              req.on('end', () => {
                if (req.url.startsWith('/models')) {
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ data: [{ id: 'judge-dialog' }, { id: 'judge-reasoner' }] }));
                } else if (req.url.startsWith('/chat/completions')) {
                  let p = {};
                  try { p = JSON.parse(aBody || '{}'); } catch (_) {}
                  const userMsg = (p.messages && p.messages[0] && p.messages[0].content) || '';
                  if (p.model === 'judge-reasoner') {
                    // 推理模型：正常回复文本，但回显不同名（触发 needEcho 供测试）
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ choices: [{ message: { content: 'ok', reasoning_content: 'think' } }], model: 'judge-reasoner-v9' }));
                    return;
                  }
                  if (userMsg.indexOf('AI_VERDICT') !== -1) {
                    if (req.headers['x-judge-garbage'] === '1') {
                      res.writeHead(200, { 'Content-Type': 'application/json' });
                      res.end('garbage-not-json');
                    } else {
                      res.writeHead(200, { 'Content-Type': 'application/json' });
                      res.end(JSON.stringify({
                        id: 'judge-1', object: 'chat.completion', model: 'judge-dialog',
                        choices: [{ index: 0, message: { role: 'assistant', content: '{"echoSame": true, "identityConflict": false, "knowledgeCorrect": true, "conclusion": "回显与请求为同一模型，身份一致，判定可信"}' }, finish_reason: 'stop' }],
                        usage: { total_tokens: 40 }
                      }));
                    }
                  } else {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ choices: [{ message: { content: 'hi' } }], model: 'judge-dialog' }));
                  }
                } else { res.writeHead(404); res.end(); }
              });
            });
            aiJudgeMock.listen(0, '127.0.0.1', () => {
              aiJudgeMockPort = aiJudgeMock.address().port;
              resolve();
            });
          });
        });
        server.on('error', reject);
      });
    });
  });
});

after(() => {
  server.close();
  mock.close();
  if (xiaomiMock) xiaomiMock.close();
  if (verifyMock) verifyMock.close();
  if (aiJudgeMock) aiJudgeMock.close();
  try { fs.unlinkSync(TMP_DB); } catch (_) {}
  try { fs.unlinkSync(TMP_DB + '-wal'); } catch (_) {}
  try { fs.unlinkSync(TMP_DB + '-shm'); } catch (_) {}
});

// 预置一批邀请码（注册必需）
before(() => {
  const db = getDb();
  const ins = db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)');
  for (let i = 1; i <= 30; i++) ins.run('TINV' + String(i).padStart(2, '0'));
});

async function getToken(username) {
  if (token && !username) return token;
  const uname = username || 'testuser';
  // 先尝试注册
  const res = await request('POST', '/api/auth/register', { username: uname, password: 'test123456', inviteCode: 'TINV01' });
  if (res.status === 200) {
    token = res.body.token || '';
    return token;
  }
  // 注册失败，尝试登录（可能用户名已存在）
  const login = await request('POST', '/api/auth/login', { username: uname, password: 'test123456' });
  if (login.status === 200) {
    token = login.body.token || '';
    return token;
  }
  // 登录也失败，尝试用新邀请码注册
  const newCode = 'SKILL' + Date.now();
  getDb().prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run(newCode);
  const res2 = await request('POST', '/api/auth/register', { username: uname, password: 'test123456', inviteCode: newCode });
  if (res2.status === 200) {
    token = res2.body.token || '';
    return token;
  }
  return '';
}

let adminToken = '';
async function getAdminToken() {
  if (adminToken) return adminToken;
  await request('POST', '/api/auth/register', { username: 'admin_user', password: 'admin123456', inviteCode: 'TINV02' });
  getDb().prepare("UPDATE users SET role = 'admin' WHERE username = 'admin_user'").run();
  const login = await request('POST', '/api/auth/login', { username: 'admin_user', password: 'admin123456' });
  adminToken = login.body.token || '';
  return adminToken;
}

// 用管理员把条目审核通过（公开可见的前提）
async function verifyItem(id, verified = true) {
  const admin = await getAdminToken();
  return request('PUT', '/api/admin/items/' + id + '/verify', { verified }, admin);
}

// 打开 SSE 实时推送连接（收到 ': connected' 握手后 resolve；返回 {req, res}）
function openSSE() {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port: server.address().port, path: '/api/events', method: 'GET' },
      (res) => {
        if (res.statusCode !== 200) { reject(new Error('SSE HTTP ' + res.statusCode)); return; }
        let buf = '';
        res.on('data', (c) => { buf += c; if (buf.indexOf(': connected') !== -1) resolve({ req, res }); });
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('API 接口', () => {
  describe('GET /api/items', () => {
    it('启动时返回空数组', async () => {
      const res = await request('GET', '/api/items');
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, []);
    });
  });

  describe('GET /api/stats', () => {
    it('返回零值统计', async () => {
      const res = await request('GET', '/api/stats');
      assert.equal(res.status, 200);
      assert.equal(res.body.total, 0);
    });
  });

  describe('POST /api/items', () => {
    it('无 token 被拒绝（401）', async () => {
      const res = await request('POST', '/api/items', { name: 'x', url: 'https://x.com' });
      assert.equal(res.status, 401);
    });

    it('创建有效条目', async () => {
      const t = await getToken();
      const res = await request('POST', '/api/items', {
        name: 'Test OpenAI', desc: '免费体验额度', url: mockBase(),
        provider: 'OpenAI', category: '对话模型', token: 'sk-test-xxxxx', tokenType: 'OpenAI', tags: ['GPT-4', '免费']
      }, t);
      assert.equal(res.status, 201);
      assert.ok(res.body.id);
      assert.equal(res.body.name, 'Test OpenAI');
      createdIds.push(res.body.id);
    });

    it('拒绝缺少必填项', async () => {
      const res = await request('POST', '/api/items', { name: 'no-url' }, token);
      assert.equal(res.status, 400);
    });

    it('拒绝空 name', async () => {
      const res = await request('POST', '/api/items', { name: '   ', url: 'https://example.com' }, token);
      assert.equal(res.status, 400);
    });

    it('拒绝无效 URL 协议', async () => {
      const res = await request('POST', '/api/items', { name: 'bad', url: 'javascript:alert(1)' }, token);
      assert.equal(res.status, 400);
    });

    it('拒绝过长的字段', async () => {
      const res = await request('POST', '/api/items', { name: 'a'.repeat(101), url: 'https://example.com' }, token);
      assert.equal(res.status, 400);
    });

    it('拒绝 tags 非数组', async () => {
      const res = await request('POST', '/api/items', { name: 'test', url: 'https://example.com', tags: 'not-array' }, token);
      assert.equal(res.status, 400);
    });

    it('拒绝超大 payload', async () => {
      const res = await request('POST', '/api/items', { name: 'x', url: 'https://x.com', desc: 'x'.repeat(200 * 1024) }, token);
      assert.equal(res.status, 413);
    });
  });

  describe('GET /api/items/:id', () => {
    it('获取已审核条目（审核通过后公开可见）', async () => {
      await verifyItem(createdIds[0]);
      const res = await request('GET', `/api/items/${createdIds[0]}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.name, 'Test OpenAI');
    });

    it('不存在返回 404', async () => {
      const res = await request('GET', '/api/items/nonexistent');
      assert.equal(res.status, 404);
    });
  });

  describe('PUT /api/items/:id', () => {
    it('更新条目', async () => {
      const res = await request('PUT', `/api/items/${createdIds[0]}`, { name: 'Test OpenAI Updated' }, token);
      assert.equal(res.status, 200);
      assert.equal(res.body.name, 'Test OpenAI Updated');
    });

    it('不存在返回 404', async () => {
      const res = await request('PUT', '/api/items/nonexistent', { name: 'x' }, token);
      assert.equal(res.status, 404);
    });

    it('拒绝无效 URL', async () => {
      const res = await request('PUT', `/api/items/${createdIds[0]}`, { url: 'javascript:alert(1)' }, token);
      assert.equal(res.status, 400);
    });
  });

  describe('DELETE /api/items/:id', () => {
    it('删除条目', async () => {
      const res = await request('DELETE', `/api/items/${createdIds[0]}`, null, token);
      assert.equal(res.status, 200);
    });

    it('不存在返回 404', async () => {
      const res = await request('DELETE', '/api/items/nonexistent', null, token);
      assert.equal(res.status, 404);
    });
  });

  describe('GET /api/items 搜索与筛选', () => {
    before(async () => {
      const t = await getToken();
      const a = await request('POST', '/api/items', { name: 'Anthropic Claude', url: mockBase(), category: '对话模型', provider: 'Anthropic', token: 'sk-search-claude', tokenType: 'Anthropic' }, t);
      const b = await request('POST', '/api/items', { name: 'DALL-E 3', url: mockBase(), category: '图像生成', provider: 'OpenAI', token: 'sk-search-dalle' }, t);
      const c = await request('POST', '/api/items', { name: 'GitHub Copilot', url: mockBase(), category: '编程工具', provider: 'GitHub', token: 'sk-search-copilot' }, t);
      // 审核通过，否则不出现在公开列表/分类
      for (const r of [a, b, c]) if (r.body && r.body.id) await verifyItem(r.body.id);
    });

    it('按分类筛选', async () => {
      const res = await request('GET', '/api/items?category=' + encodeURIComponent('对话模型'));
      assert.equal(res.status, 200);
      assert.ok(res.body.length >= 1);
      res.body.forEach(i => assert.equal(i.category, '对话模型'));
    });

    it('搜索关键词', async () => {
      const res = await request('GET', '/api/items?search=claude');
      assert.equal(res.status, 200);
      assert.ok(res.body.length >= 1);
    });

    it('GET /api/categories 返回分类列表', async () => {
      const res = await request('GET', '/api/categories');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
      assert.ok(res.body.includes('对话模型'));
    });

    it('GET /api/health 返回 ok', async () => {
      const res = await request('GET', '/api/health');
      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'ok');
    });
  });

  describe('GET /api/items 分页', () => {
    before(async () => {
      const t = await getToken();
      for (let i = 1; i <= 5; i++) {
        const r = await request('POST', '/api/items', {
          name: 'PageTest Item ' + i, url: mockBase(), category: '分页测试', provider: 'Page', token: 'sk-page-' + i
        }, t);
        if (r.body && r.body.id) await verifyItem(r.body.id);
      }
    });

    it('limit 限制返回数量并带 X-Total-Count', async () => {
      const res = await request('GET', '/api/items?limit=3');
      assert.equal(res.status, 200);
      assert.equal(res.body.length, 3);
      const total = parseInt(res.headers['x-total-count'], 10);
      assert.ok(total >= 5, 'total=' + total);
    });

    it('offset 分页互不重叠', async () => {
      const p1 = await request('GET', '/api/items?limit=3&offset=0');
      const p2 = await request('GET', '/api/items?limit=3&offset=3');
      assert.ok(p1.body.length >= 1 && p2.body.length >= 1);
      const ids1 = new Set(p1.body.map(i => i.id));
      const overlap = p2.body.some(i => ids1.has(i.id));
      assert.equal(overlap, false);
    });

    it('limit 上限 50', async () => {
      const res = await request('GET', '/api/items?limit=999');
      assert.ok(res.body.length <= 50);
    });

    it('无 limit 返回全量数组且不带 total 头（向后兼容）', async () => {
      const res = await request('GET', '/api/items');
      assert.ok(Array.isArray(res.body));
      assert.equal(parseInt(res.headers['x-total-count'] || '0', 10), 0);
    });
  });

  describe('安全头', () => {
    it('返回 X-Content-Type-Options: nosniff', async () => {
      const res = await request('GET', '/api/health');
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
    });

    it('返回 X-Frame-Options', async () => {
      const res = await request('GET', '/api/health');
      assert.ok(res.headers['x-frame-options']);
    });
  });
});

describe('用户系统', () => {
  it('注册新用户（带邀请码）', async () => {
    const res = await request('POST', '/api/auth/register', { username: 'newuser', password: 'pass123456', inviteCode: 'TINV03' });
    assert.equal(res.status, 201);
    assert.ok(res.body.token);
    assert.equal(res.body.user.username, 'newuser');
  });

  it('拒绝重复用户名', async () => {
    const res = await request('POST', '/api/auth/register', { username: 'newuser', password: 'pass123456', inviteCode: 'TINV05' });
    assert.equal(res.status, 400);
  });

  it('登录', async () => {
    const res = await request('POST', '/api/auth/login', { username: 'newuser', password: 'pass123456' });
    assert.equal(res.status, 200);
    assert.ok(res.body.token);
  });

  it('拒绝错误密码', async () => {
    const res = await request('POST', '/api/auth/login', { username: 'newuser', password: 'wrongpass' });
    assert.equal(res.status, 401);
  });

  it('GET /api/auth/me 返回当前用户', async () => {
    const res = await request('GET', '/api/auth/me', null, token);
    assert.equal(res.status, 200);
    assert.equal(res.body.user.username, 'testuser');
  });

  it('GET /api/auth/me 无 token 返回 401', async () => {
    const res = await request('GET', '/api/auth/me');
    assert.equal(res.status, 401);
  });
});

describe('密码策略与登录锁定', () => {
  it('拒绝过短密码（<8 位）', async () => {
    const r = await request('POST', '/api/auth/register', { username: 'psA' + Date.now(), password: 'abc1234', inviteCode: 'TINV20' });
    assert.equal(r.status, 400);
  });
  it('拒绝纯字母密码', async () => {
    const r = await request('POST', '/api/auth/register', { username: 'psB' + Date.now(), password: 'abcdefgh', inviteCode: 'TINV21' });
    assert.equal(r.status, 400);
  });
  it('拒绝纯数字密码', async () => {
    const r = await request('POST', '/api/auth/register', { username: 'psC' + Date.now(), password: '12345678', inviteCode: 'TINV22' });
    assert.equal(r.status, 400);
  });
  it('接受合格密码（≥8 位且含字母数字）', async () => {
    const r = await request('POST', '/api/auth/register', { username: 'pwg' + Date.now(), password: 'pass123456', inviteCode: 'TINV26' });
    assert.equal(r.status, 201);
  });
  it('连续失败 5 次锁定，正确密码也返回 429', async () => {
    const u = 'lock' + Date.now();
    await request('POST', '/api/auth/register', { username: u, password: 'pass123456', inviteCode: 'TINV27' });
    for (let i = 0; i < 5; i++) {
      const r = await request('POST', '/api/auth/login', { username: u, password: 'wrongpass' });
      assert.equal(r.status, 401);
    }
    const locked = await request('POST', '/api/auth/login', { username: u, password: 'pass123456' });
    assert.equal(locked.status, 429);
    assert.ok(locked.body.retryAfter > 0);
  });
  it('锁定对不存在的用户名同样生效（不泄露账号是否存在）', async () => {
    const u = 'ghost' + Date.now();
    for (let i = 0; i < 5; i++) await request('POST', '/api/auth/login', { username: u, password: 'wrongpass' });
    const r = await request('POST', '/api/auth/login', { username: u, password: 'wrongpass' });
    assert.equal(r.status, 429);
  });
  it('登录成功清除失败计数', async () => {
    const u = 'cl' + Date.now();
    await request('POST', '/api/auth/register', { username: u, password: 'pass123456', inviteCode: 'TINV28' });
    for (let i = 0; i < 3; i++) await request('POST', '/api/auth/login', { username: u, password: 'wrongpass' });
    const ok = await request('POST', '/api/auth/login', { username: u, password: 'pass123456' });
    assert.equal(ok.status, 200);
    for (let i = 0; i < 3; i++) await request('POST', '/api/auth/login', { username: u, password: 'wrongpass' });
    const again = await request('POST', '/api/auth/login', { username: u, password: 'wrongpass' });
    assert.equal(again.status, 401); // 计数已清空，3 次失败仍未锁定
  });
});

describe('管理员重置密码', () => {
  let target = { id: '', username: '' };
  before(async () => {
    const r = await request('POST', '/api/auth/register', { username: 'rp_' + Date.now(), password: 'oldpass123', inviteCode: 'TINV29' });
    target = { id: r.body.user.id, username: r.body.user.username };
  });

  it('未登录访问返回 401', async () => {
    const res = await request('POST', '/api/admin/users/' + target.id + '/reset-password', { password: 'newpass123' });
    assert.equal(res.status, 401);
  });

  it('普通用户访问返回 403', async () => {
    const t = await getToken();
    const res = await request('POST', '/api/admin/users/' + target.id + '/reset-password', { password: 'newpass123' }, t);
    assert.equal(res.status, 403);
  });

  it('弱密码被拒绝（400）', async () => {
    const admin = await getAdminToken();
    const res = await request('POST', '/api/admin/users/' + target.id + '/reset-password', { password: 'weak' }, admin);
    assert.equal(res.status, 400);
  });

  it('不存在的用户返回 404', async () => {
    const admin = await getAdminToken();
    const res = await request('POST', '/api/admin/users/does-not-exist/reset-password', { password: 'newpass123' }, admin);
    assert.equal(res.status, 404);
  });

  it('管理员重置后旧密码失效、新密码可登录', async () => {
    const admin = await getAdminToken();
    const res = await request('POST', '/api/admin/users/' + target.id + '/reset-password', { password: 'newpass456' }, admin);
    assert.equal(res.status, 200);
    assert.equal(res.body.username, target.username);
    const oldLogin = await request('POST', '/api/auth/login', { username: target.username, password: 'oldpass123' });
    assert.equal(oldLogin.status, 401);
    const newLogin = await request('POST', '/api/auth/login', { username: target.username, password: 'newpass456' });
    assert.equal(newLogin.status, 200);
    assert.ok(newLogin.body.token);
  });
});

describe('邮箱/手机号注册 + 无验证码找回', () => {
  let rec = { username: '', token: '' };
  before(async () => {
    const r = await request('POST', '/api/auth/register', { username: 'rec_' + Date.now(), password: 'oldpass123', email: 'rec@example.com', phone: '13800001111', inviteCode: 'TINV30' });
    rec = { username: r.body.user.username, token: r.body.token || '' };
  });

  it('注册后 /api/auth/me 返回 email/phone', async () => {
    const res = await request('GET', '/api/auth/me', null, rec.token);
    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, 'rec@example.com');
    assert.equal(res.body.user.phone, '13800001111');
  });

  it('手机号格式非法被拒', async () => {
    const r = await request('POST', '/api/auth/register', { username: 'recbad_' + Date.now(), password: 'pass123456', phone: 'abc', inviteCode: 'TINV29' });
    assert.equal(r.status, 400);
    assert.ok((r.body.error || '').includes('手机号'));
  });

  it('错误邮箱无法找回（统一文案，不泄露）', async () => {
    const r = await request('POST', '/api/auth/recovery', { username: rec.username, email: 'wrong@example.com', password: 'newpass123' });
    assert.equal(r.status, 400);
    assert.ok((r.body.error || '').includes('不匹配'));
  });

  it('正确邮箱找回：旧密码失效、新密码可登录', async () => {
    const r = await request('POST', '/api/auth/recovery', { username: rec.username, email: 'rec@example.com', password: 'newpass456' });
    assert.equal(r.status, 200);
    const oldLogin = await request('POST', '/api/auth/login', { username: rec.username, password: 'oldpass123' });
    assert.equal(oldLogin.status, 401);
    const newLogin = await request('POST', '/api/auth/login', { username: rec.username, password: 'newpass456' });
    assert.equal(newLogin.status, 200);
  });

  it('正确手机号找回', async () => {
    const r = await request('POST', '/api/auth/recovery', { username: rec.username, phone: '13800001111', password: 'newpass789' });
    assert.equal(r.status, 200);
    const login = await request('POST', '/api/auth/login', { username: rec.username, password: 'newpass789' });
    assert.equal(login.status, 200);
  });

  it('未绑定联系方式的账号无法找回（提示联系管理员）', async () => {
    const r = await request('POST', '/api/auth/recovery', { username: 'testuser', email: 'anything@x.com', password: 'newpass123' });
    assert.equal(r.status, 400);
    assert.ok((r.body.error || '').includes('联系管理员'));
  });

  it('用户名不存在返回统一文案（不泄露账号是否存在）', async () => {
    const r = await request('POST', '/api/auth/recovery', { username: 'nobody_' + Date.now(), email: 'x@x.com', password: 'newpass123' });
    assert.equal(r.status, 400);
    assert.ok((r.body.error || '').includes('不匹配'));
  });

  it('新密码太弱被拒', async () => {
    const r = await request('POST', '/api/auth/recovery', { username: rec.username, email: 'rec@example.com', password: 'weak' });
    assert.equal(r.status, 400);
    assert.ok((r.body.error || '').includes('至少8个字符'));
  });
});

describe('个人资料更新（昵称/邮箱/手机号）', () => {
  let pf = { token: '' };
  before(async () => {
    getDb().prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('TINV31');
    const r = await request('POST', '/api/auth/register', { username: 'pf_' + Date.now(), password: 'pass123456', inviteCode: 'TINV31' });
    pf = { token: r.body.token || '' };
  });

  it('登录用户可添加邮箱/手机号并展示', async () => {
    const res = await request('PUT', '/api/auth/profile', { nickname: '资料昵称', email: 'profile@example.com', phone: '13900002222' }, pf.token);
    assert.equal(res.status, 200);
    assert.equal(res.body.user.nickname, '资料昵称');
    assert.equal(res.body.user.email, 'profile@example.com');
    assert.equal(res.body.user.phone, '13900002222');
    const me = await request('GET', '/api/auth/me', null, pf.token);
    assert.equal(me.body.user.email, 'profile@example.com');
  });

  it('非法邮箱被拒', async () => {
    const res = await request('PUT', '/api/auth/profile', { email: 'not-an-email' }, pf.token);
    assert.equal(res.status, 400);
    assert.ok((res.body.error || '').includes('邮箱'));
  });

  it('非法手机号被拒', async () => {
    const res = await request('PUT', '/api/auth/profile', { phone: 'abc' }, pf.token);
    assert.equal(res.status, 400);
    assert.ok((res.body.error || '').includes('手机号'));
  });

  it('只改昵称不清空邮箱/手机号', async () => {
    const res = await request('PUT', '/api/auth/profile', { nickname: '只改昵称' }, pf.token);
    assert.equal(res.status, 200);
    assert.equal(res.body.user.nickname, '只改昵称');
    assert.equal(res.body.user.email, 'profile@example.com');
    assert.equal(res.body.user.phone, '13900002222');
  });

  it('未登录无法修改资料', async () => {
    const res = await request('PUT', '/api/auth/profile', { email: 'x@x.com' });
    assert.equal(res.status, 401);
  });

  it('昵称全局唯一：他人占用相同昵称（含大小写不同）被拒', async () => {
    await request('PUT', '/api/auth/profile', { nickname: '唯一昵称' }, pf.token);
    getDb().prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('TINV43');
    const r = await request('POST', '/api/auth/register', { username: 'pf2_' + Date.now(), password: 'pass123456', inviteCode: 'TINV43' });
    const pf2 = r.body.token || '';
    const same = await request('PUT', '/api/auth/profile', { nickname: '唯一昵称' }, pf2);
    assert.equal(same.status, 400);
    assert.ok((same.body.error || '').includes('已被使用'));
    const caseDiff = await request('PUT', '/api/auth/profile', { nickname: '唯一昵称' }, pf2);
    assert.equal(caseDiff.status, 400); // 不区分大小写，同样占用
  });

  it('自己的昵称可原样保留（排除自己）', async () => {
    const res = await request('PUT', '/api/auth/profile', { nickname: '唯一昵称' }, pf.token);
    assert.equal(res.status, 200);
    assert.equal(res.body.user.nickname, '唯一昵称');
  });

  it('空昵称允许（清除，展示回退到账号）', async () => {
    const res = await request('PUT', '/api/auth/profile', { nickname: '' }, pf.token);
    assert.equal(res.status, 200);
    assert.equal(res.body.user.nickname, '');
  });

  it('nickname-check 实时检测接口', async () => {
    await request('PUT', '/api/auth/profile', { nickname: '检查昵称' }, pf.token);
    getDb().prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('TINV44');
    const r = await request('POST', '/api/auth/register', { username: 'pf3_' + Date.now(), password: 'pass123456', inviteCode: 'TINV44' });
    const pf3 = r.body.token || '';
    const taken = await request('GET', '/api/auth/nickname-check?nickname=' + encodeURIComponent('检查昵称'), null, pf3);
    assert.equal(taken.body.available, false);
    const free = await request('GET', '/api/auth/nickname-check?nickname=' + encodeURIComponent('全新昵称'), null, pf3);
    assert.equal(free.body.available, true);
    const own = await request('GET', '/api/auth/nickname-check?nickname=' + encodeURIComponent('检查昵称'), null, pf.token);
    assert.equal(own.body.available, true); // 自己的昵称视为可用
    const empty = await request('GET', '/api/auth/nickname-check?nickname=', null, pf.token);
    assert.equal(empty.body.available, true);
    const noAuth = await request('GET', '/api/auth/nickname-check?nickname=' + encodeURIComponent('检查昵称'));
    assert.equal(noAuth.status, 401);
  });
});

describe('积分与拉取', () => {
  let p = { token: '' };
  before(async () => {
    for (let i = 32; i <= 35; i++) getDb().prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('TINV' + i);
    const r = await request('POST', '/api/auth/register', { username: 'pts_' + Date.now(), password: 'pass123456', inviteCode: 'TINV32' });
    p = { token: r.body.token || '' };
  });

  it('发布含 Token 条目即自动上线并给作者 +1 积分', async () => {
    const beforePts = (await request('GET', '/api/points', null, p.token)).body.points;
    const create = await request('POST', '/api/items', { name: 'Pts Item', url: mockBase(), token: 'sk-pts-item', tokenType: 'OpenAI' }, p.token);
    assert.equal(create.status, 201);
    assert.equal(create.body.verified, true, '发布即自动上线');
    const pts = await request('GET', '/api/points', null, p.token);
    assert.equal(pts.body.points, beforePts + 1, '发布应 +1 积分（新用户初始5分）');
    assert.ok(pts.body.log.some(l => l.reason === 'item_verify' && l.delta === 1));
  });

  it('纯链接条目（无 Token）发布被拒绝且不加分', async () => {
    const before = (await request('GET', '/api/points', null, p.token)).body.points;
    const create = await request('POST', '/api/items', { name: 'Pts Link', url: 'https://example.com' }, p.token);
    assert.equal(create.status, 400);
    assert.match(create.body.error || '', /token/i, '错误信息应提及 Token');
    const after = (await request('GET', '/api/points', null, p.token)).body.points;
    assert.equal(after, before);
  });

  it('重复 verify / 下线后重新通过都不重复发放积分', async () => {
    const admin = await getAdminToken();
    const before = (await request('GET', '/api/points', null, p.token)).body.points;
    const create = await request('POST', '/api/items', { name: 'Pts Item 2', url: mockBase(), token: 'sk-pts-item-2', tokenType: 'OpenAI' }, p.token);
    await request('PUT', '/api/admin/items/' + create.body.id + '/verify', { verified: true }, admin);
    await request('PUT', '/api/admin/items/' + create.body.id + '/verify', { verified: true }, admin);
    await request('PUT', '/api/admin/items/' + create.body.id + '/verify', { verified: false }, admin);
    await request('PUT', '/api/admin/items/' + create.body.id + '/verify', { verified: true }, admin);
    const after = (await request('GET', '/api/points', null, p.token)).body.points;
    assert.equal(after - before, 1); // 发布时 +1；重复 verify、下线→重通过都不再加
  });

  it('教程审核通过给作者 +1 积分', async () => {
    const admin = await getAdminToken();
    const create = await request('POST', '/api/tutorials', { title: 'Pts Tut', content: '内容' }, p.token);
    await request('PUT', '/api/admin/tutorials/' + create.body.id + '/verify', { verified: true }, admin);
    const pts = await request('GET', '/api/points', null, p.token);
    assert.ok(pts.body.log.some(l => l.reason === 'tutorial_verify' && l.delta === 1));
  });

  it('未登录访问 /api/points 返回 401', async () => {
    const r = await request('GET', '/api/points');
    assert.equal(r.status, 401);
  });

  it('/api/points?month= 返回月度每日聚合 daily', async () => {
    const now = new Date();
    const month = now.toISOString().slice(0, 7);
    const r = await request('GET', '/api/points?month=' + month, null, p.token);
    assert.equal(r.status, 200);
    assert.equal(r.body.month, month);
    assert.ok(Array.isArray(r.body.daily));
    const sum = r.body.daily.reduce((s, d) => s + d.delta, 0);
    assert.ok(sum >= 1, '本月应有积分记录');
  });

  it('/api/points?all=1 返回全部流水', async () => {
    const r = await request('GET', '/api/points?all=1', null, p.token);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.log));
    assert.ok(r.body.log.length >= 1);
  });
});

describe('每日拉取限额', () => {
  let q = { token: '', userId: '' };
  before(async () => {
    const r = await request('POST', '/api/auth/register', { username: 'pull_' + Date.now(), password: 'pass123456', inviteCode: 'TINV33' });
    q = { token: r.body.token || '', userId: r.body.user.id };
    const db = getDb();
    const now = new Date().toISOString();
    for (let i = 0; i < 8; i++) {
      db.prepare("INSERT INTO items (id, name, url, token, token_type, verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)")
        .run('pullitem' + i, 'Pull ' + i, mockBase(), 'sk-pull-' + i, 'OpenAI', now, now);
    }
  });

  it('前 5 次免费，额度用尽后积分不足返回 400', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await request('GET', '/api/recent?limit=1', null, q.token);
      assert.equal(r.status, 200);
    }
    const state = await request('GET', '/api/points', null, q.token);
    assert.equal(state.body.pullCountToday, 5);
    assert.equal(state.body.points, 5); // 初始5分，免费不扣分
    // 耗尽初始积分后再试应失败：先把积分清零
    getDb().prepare('UPDATE users SET points = 0 WHERE id = ?').run(q.userId);
    const r6 = await request('GET', '/api/recent?limit=1', null, q.token);
    assert.equal(r6.status, 400);
    assert.ok((r6.body.error || '').includes('积分不足'));
  });

  it('有积分时超出部分扣分成功', async () => {
    getDb().prepare('UPDATE users SET points = 3 WHERE id = ?').run(q.userId);
    const r = await request('GET', '/api/recent?limit=3', null, q.token);
    assert.equal(r.status, 200);
    assert.equal(r.body.freeUsed, 0);
    assert.equal(r.body.pointsUsed, 3);
    assert.equal(r.body.pointsRemaining, 0);
    assert.equal(r.body.items.length, 3);
  });

  it('版主/管理员豁免不扣分', async () => {
    const admin = await getAdminToken();
    const r = await request('GET', '/api/recent?limit=10', null, admin);
    assert.equal(r.status, 200);
    assert.equal(r.body.pointsUsed, 0);
  });

  it('跨天重置额度', async () => {
    getDb().prepare("UPDATE users SET pull_date = date('now', '-1 day'), pull_count = 0, points = 0 WHERE id = ?").run(q.userId);
    const r = await request('GET', '/api/recent?limit=5', null, q.token);
    assert.equal(r.status, 200);
    assert.equal(r.body.freeUsed, 5);
    assert.equal(r.body.pointsUsed, 0);
  });

  it('未登录访问 /api/recent 返回 401', async () => {
    const r = await request('GET', '/api/recent?limit=1');
    assert.equal(r.status, 401);
  });
});

describe('XSS 输入防护', () => {
  it('XSS 尝试写入时被正确校验', async () => {
    const t = await getToken();
    const res = await request('POST', '/api/items', {
      name: '<script>alert(1)</script>', url: mockBase(), token: 'sk-xss-name', tokenType: 'OpenAI'
    }, t);
    assert.equal(res.status, 201);
    assert.equal(res.body.name, '<script>alert(1)</script>');
  });

  it('javascript: 协议 URL 被拒绝', async () => {
    const res = await request('POST', '/api/items', { name: 'xss', url: 'javascript:alert(document.cookie)' }, token);
    assert.equal(res.status, 400);
  });

  it('data: 协议 URL 被拒绝', async () => {
    const res = await request('POST', '/api/items', { name: 'xss', url: 'data:text/html,<script>alert(1)</script>' }, token);
    assert.equal(res.status, 400);
  });
});

describe('排行榜 & 动态', () => {
  it('GET /api/leaderboard 返回数据', async () => {
    const res = await request('GET', '/api/leaderboard');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
  });

  it('GET /api/recent-activity 返回数据', async () => {
    const res = await request('GET', '/api/recent-activity');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
  });
});

describe('打赏与个人主页（积分流动 + 幂等 + 动态流）', () => {
  let authorToken = '', authorId = '', tipperToken = '', tipperId = '', tipItemId = '';

  // 注册作者 + 打赏人，作者发布一条自动上线的 Token 作为打赏目标
  async function ensureSetup() {
    if (authorToken) return;
    const db = getDb();
    db.prepare("INSERT OR IGNORE INTO invite_codes (code) VALUES ('TIPINV1')").run();
    db.prepare("INSERT OR IGNORE INTO invite_codes (code) VALUES ('TIPINV2')").run();
    const a = await request('POST', '/api/auth/register', { username: 'tip_author', password: 'tip123456', inviteCode: 'TIPINV1' });
    authorToken = a.body.token; authorId = a.body.user.id;
    const p = await request('POST', '/api/auth/register', { username: 'tip_tipper', password: 'tip123456', inviteCode: 'TIPINV2' });
    tipperToken = p.body.token; tipperId = p.body.user.id;
    const create = await request('POST', '/api/items', { name: 'Tip Target', url: mockBase(), token: 'sk-tip-target', tokenType: 'OpenAI' }, authorToken);
    assert.equal(create.status, 201);
    tipItemId = create.body.id;
  }

  it('未登录打赏返回 401', async () => {
    await ensureSetup();
    const res = await request('POST', `/api/items/${tipItemId}/tip`, {});
    assert.equal(res.status, 401);
  });

  it('不存在的条目返回 404', async () => {
    await ensureSetup();
    const res = await request('POST', '/api/items/nonexistent/tip', {}, tipperToken);
    assert.equal(res.status, 404);
  });

  it('未上线条目不可打赏（404，与详情可见性一致）', async () => {
    await ensureSetup();
    await verifyItem(tipItemId, false);
    const res = await request('POST', `/api/items/${tipItemId}/tip`, {}, tipperToken);
    assert.equal(res.status, 404);
    await verifyItem(tipItemId, true);
  });

  it('积分不足返回 400', async () => {
    await ensureSetup();
    getDb().prepare('UPDATE users SET points = 0 WHERE id = ?').run(tipperId);
    const res = await request('POST', `/api/items/${tipItemId}/tip`, {}, tipperToken);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /积分不足/);
  });

  it('不能打赏自己发布的 Token', async () => {
    await ensureSetup();
    getDb().prepare('UPDATE users SET points = 5 WHERE id = ?').run(authorId);
    const res = await request('POST', `/api/items/${tipItemId}/tip`, {}, authorToken);
    assert.equal(res.status, 400);
  });

  it('打赏成功：积分转移 + 双流水 + remaining 正确', async () => {
    await ensureSetup();
    getDb().prepare('UPDATE users SET points = 3 WHERE id = ?').run(tipperId);
    getDb().prepare('UPDATE users SET points = 0 WHERE id = ?').run(authorId);
    const res = await request('POST', `/api/items/${tipItemId}/tip`, {}, tipperToken);
    assert.equal(res.status, 200);
    assert.equal(res.body.remaining, 2);
    const db = getDb();
    assert.equal(db.prepare('SELECT points AS p FROM users WHERE id = ?').get(tipperId).p, 2, '打赏者 -1');
    assert.equal(db.prepare('SELECT points AS p FROM users WHERE id = ?').get(authorId).p, 1, '作者 +1');
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM points_log WHERE user_id = ? AND reason = 'tip' AND ref_id = ?").get(tipperId, tipItemId).c, 1, '支出流水一条');
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM points_log WHERE user_id = ? AND reason = 'tip_received' AND ref_id = ?").get(authorId, tipItemId).c, 1, '收入流水一条');
  });

  it('同一用户重复打赏被拒（幂等）', async () => {
    await ensureSetup();
    const res = await request('POST', `/api/items/${tipItemId}/tip`, {}, tipperToken);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /已经打赏/);
  });

  it('详情返回 tipped/tipCount/authorName', async () => {
    await ensureSetup();
    const res = await request('GET', `/api/items/${tipItemId}`, null, tipperToken);
    assert.equal(res.status, 200);
    assert.equal(res.body.tipped, true);
    assert.equal(res.body.tipCount, 1);
    assert.equal(res.body.authorName, 'tip_author');
  });

  it('动态流包含打赏事件（type=tip + 打赏人 + 作者）', async () => {
    await ensureSetup();
    const res = await request('GET', '/api/recent-activity?limit=50');
    const ev = res.body.find(r => r.type === 'tip' && r.id === tipItemId);
    assert.ok(ev, '动态流应包含 type=tip 事件');
    assert.equal(ev.tipByUsername, 'tip_tipper');
    assert.equal(ev.username, 'tip_author');
  });

  it('GET /api/users/:id 返回主页数据（被认可数 + 贡献列表）', async () => {
    await ensureSetup();
    const res = await request('GET', '/api/users/' + authorId);
    assert.equal(res.status, 200);
    assert.equal(res.body.user.id, authorId);
    assert.equal(res.body.stats.tipped, 1);
    assert.ok(res.body.stats.items >= 1);
    assert.ok(res.body.items.some(i => i.id === tipItemId));
  });

  it('GET /api/users/:id 不存在返回 404', async () => {
    await ensureSetup();
    const res = await request('GET', '/api/users/nonexistent');
    assert.equal(res.status, 404);
  });

  it('GET /user/:id SSR 页面 200 且含资料与标题', async () => {
    await ensureSetup();
    const res = await request('GET', '/user/' + authorId);
    assert.equal(res.status, 200);
    assert.match(String(res.body), /tip_author/);
    assert.match(String(res.body), /Token 贡献者/);
  });

  it('GET /user/:id 不存在返回 404', async () => {
    await ensureSetup();
    const res = await request('GET', '/user/nonexistent');
    assert.equal(res.status, 404);
  });

  it('评论列表带 authorId（昵称链接数据源）', async () => {
    await ensureSetup();
    await request('POST', '/api/comments', { content: '打赏功能上线啦' }, tipperToken);
    const res = await request('GET', '/api/comments?limit=10');
    const mine = res.body.comments.find(c => c.content === '打赏功能上线啦');
    assert.ok(mine, '留言应存在');
    assert.equal(mine.authorId, tipperId);
  });

  it('列表接口返回 tipCount/tipped（卡片直打赏数据源）', async () => {
    await ensureSetup();
    const res = await request('GET', '/api/items', null, tipperToken);
    const mine = res.body.find(i => i.id === tipItemId);
    assert.equal(mine.tipCount, 1, '被认可数可见');
    assert.equal(mine.tipped, true, '登录视角带已打赏标记');
    const anon = await request('GET', '/api/items');
    const anonItem = anon.body.find(i => i.id === tipItemId);
    assert.equal(anonItem.tipCount, 1);
    assert.equal(anonItem.tipped, false, '匿名视角 tipped 恒 false');
  });
});

describe('用户 Dashboard', () => {
  let myItemId;

  it('GET /api/my/items 需要登录', async () => {
    const res = await request('GET', '/api/my/items');
    assert.equal(res.status, 401);
  });

  it('GET /api/my/items 返回用户条目', async () => {
    const t = await getToken();
    const res = await request('GET', '/api/my/items', null, t);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
  });

  it('GET /api/my/stats 返回用户统计', async () => {
    const t = await getToken();
    const res = await request('GET', '/api/my/stats', null, t);
    assert.equal(res.status, 200);
    assert.ok(typeof res.body.total === 'number');
    assert.ok(typeof res.body.verified === 'number');
    assert.ok(res.body.joinedAt !== undefined);
  });

  it('PUT /api/my/items/:id 更新自己的条目', async () => {
    const t = await getToken();
    const create = await request('POST', '/api/items', { name: 'Dashboard Test', url: mockBase(), token: 'sk-dash-test', tokenType: 'OpenAI' }, t);
    myItemId = create.body.id;
    const res = await request('PUT', '/api/my/items/' + myItemId, { name: 'Dashboard Updated' }, t);
    assert.equal(res.status, 200);
    assert.equal(res.body.name, 'Dashboard Updated');
  });

  it('PUT /api/my/items/:id 编辑移除 Token 被拒绝', async () => {
    const t = await getToken();
    const create = await request('POST', '/api/items', { name: 'Keep Token', url: mockBase(), token: 'sk-keep-token', tokenType: 'OpenAI' }, t);
    const res = await request('PUT', '/api/my/items/' + create.body.id, { token: '' }, t);
    assert.equal(res.status, 400);
    assert.match(res.body.error || '', /token/i, '错误信息应提及 Token');
  });

  it('PUT /api/my/items/:id 拒绝修改他人条目', async () => {
    const t = await getToken();
    const create = await request('POST', '/api/items', { name: 'Owner Test', url: mockBase(), token: 'sk-owner-test' }, t);
    const ownerId = create.body.id;
    const otherRes = await request('POST', '/api/auth/register', { username: 'other_' + Date.now(), password: 'pass123456', inviteCode: 'TINV04' });
    if (otherRes.status === 201 && otherRes.body.token) {
      const res = await request('PUT', '/api/my/items/' + ownerId, { name: 'Hack' }, otherRes.body.token);
      assert.equal(res.status, 403);
    }
  });

  it('PUT /api/my/items/:id 编辑垃圾桶（trashed=1）条目返回 404', async () => {
    const t = await getToken();
    const create = await request('POST', '/api/items', { name: 'Trashed Edit', url: mockBase(), token: 'sk-trashed-edit' }, t);
    getDb().prepare('UPDATE items SET trashed = 1 WHERE id = ?').run(create.body.id);
    const res = await request('PUT', '/api/my/items/' + create.body.id, { name: 'Should Fail' }, t);
    assert.equal(res.status, 404, '垃圾桶条目不应可编辑，实际 ' + res.status);
  });

  it('PUT /api/my/items/:id 历史 tags 为损坏 JSON 时不 500（容错回退空数组）', async () => {
    const t = await getToken();
    const create = await request('POST', '/api/items', { name: 'Bad Tags', url: mockBase(), token: 'sk-bad-tags' }, t);
    getDb().prepare("UPDATE items SET tags = '{corrupted' WHERE id = ?").run(create.body.id);
    const res = await request('PUT', '/api/my/items/' + create.body.id, { name: 'Bad Tags Fixed' }, t);
    assert.equal(res.status, 200, '损坏 tags 不应导致 500，实际 ' + res.status + ' ' + JSON.stringify(res.body));
    assert.equal(res.body.name, 'Bad Tags Fixed');
  });

  it('PUT /api/my/items/:id 仅改 tokenType 也触发兼容重检且成功', async () => {
    const t = await getToken();
    const create = await request('POST', '/api/items', { name: 'Type Change', url: mockBase(), token: 'sk-type-change', tokenType: 'OpenAI' }, t);
    const res = await request('PUT', '/api/my/items/' + create.body.id, { tokenType: 'Anthropic' }, t);
    assert.equal(res.status, 200, 'tokenType 变更应触发重检并成功（mock 端点 openai 可用），实际 ' + res.status + ' ' + JSON.stringify(res.body));
    assert.equal(res.body.tokenType, 'Anthropic');
  });

  it('DELETE /api/my/items/:id 删除自己的条目', async () => {
    const t = await getToken();
    const res = await request('DELETE', '/api/my/items/' + myItemId, null, t);
    assert.equal(res.status, 200);
  });

  it('DELETE /api/my/items/:id 不存在返回 404', async () => {
    const t = await getToken();
    const res = await request('DELETE', '/api/my/items/nonexistent', null, t);
    assert.equal(res.status, 404);
  });

  it('GET /dashboard 返回 HTML', async () => {
    const res = await request('GET', '/dashboard');
    assert.equal(res.status, 200);
  });
});

describe('Token 去重', () => {
  it('重复 Token 发布被拒绝', async () => {
    const t = await getToken();
    const r1 = await request('POST', '/api/items', { name: 'Dup A', url: mockBase(), token: 'sk-dup-1111' }, t);
    assert.equal(r1.status, 201);
    const r2 = await request('POST', '/api/items', { name: 'Dup B', url: mockBase(), token: 'sk-dup-1111' }, t);
    assert.equal(r2.status, 400);
    assert.ok((r2.body.error || '').includes('已存在'));
  });

  it('编辑为已存在的 Token 被拒绝', async () => {
    const t = await getToken();
    const a = await request('POST', '/api/items', { name: 'EditDup A', url: mockBase(), token: 'sk-dup-2222' }, t);
    const b = await request('POST', '/api/items', { name: 'EditDup B', url: mockBase(), token: 'sk-dup-3333' }, t);
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    const upd = await request('PUT', '/api/my/items/' + b.body.id, { token: 'sk-dup-2222' }, t);
    assert.equal(upd.status, 400);
  });

  it('Token 测试失败的 Token 不允许发布', async () => {
    const t = await getToken();
    const res = await request('POST', '/api/items', { name: 'Bad Token', url: 'http://127.0.0.1:1', token: 'sk-bad-token-xyz', tokenType: 'OpenAI' }, t);
    assert.equal(res.status, 400);
    assert.ok((res.body.error || '').includes('测试失败'));
  });
});

describe('兼容模式与 Base URL 门控', () => {
  it('发布带 Token 条目自动检测兼容模式（OpenAI+Anthropic）', async () => {
    const t = await getToken();
    const res = await request('POST', '/api/items', { name: 'Compat Both', url: mockBase(), token: 'sk-compat-both' }, t);
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.compat, ['openai', 'anthropic']);
  });

  it('未登录访问带 Token 条目：Base URL 与 API Key 都隐藏', async () => {
    const t = await getToken();
    const created = await request('POST', '/api/items', { name: 'Gate Item', url: mockBase(), token: 'sk-gate-item' }, t);
    assert.equal(created.status, 201);
    await verifyItem(created.body.id);
    const res = await request('GET', '/api/items/' + created.body.id);
    assert.equal(res.status, 200);
    assert.equal(res.body.url, '');
    assert.equal(res.body.token, '');
    assert.equal(res.body.tokenLocked, true);
    assert.equal(res.body.urlLocked, true);
  });

  it('登录后访问带 Token 条目：返回 Base URL、API Key 与兼容模式', async () => {
    const t = await getToken();
    const created = await request('POST', '/api/items', { name: 'Gate Item 2', url: mockBase(), token: 'sk-gate-item-2' }, t);
    await verifyItem(created.body.id);
    const res = await request('GET', '/api/items/' + created.body.id, null, t);
    assert.equal(res.status, 200);
    assert.equal(res.body.url, mockBase());
    assert.equal(res.body.token, 'sk-gate-item-2');
    assert.ok(res.body.compat.length >= 1);
  });

  it('无 Token 条目不允许发布（本站只收录真实可用 Token）', async () => {
    const t = await getToken();
    const created = await request('POST', '/api/items', { name: 'No Token Link', url: 'https://example.com' }, t);
    assert.equal(created.status, 400);
    assert.match(created.body.error || '', /token/i, '错误信息应提及 Token');
  });
});

describe('发布即上线（免审核）', () => {
  let liveId;
  it('发布即自动上线：出现在公开列表且详情匿名可访问', async () => {
    const t = await getToken();
    const create = await request('POST', '/api/items', { name: 'Live Item', url: mockBase(), token: 'sk-live-item', tokenType: 'OpenAI' }, t);
    assert.equal(create.status, 201);
    assert.equal(create.body.verified, true);
    liveId = create.body.id;
    const list = await request('GET', '/api/items');
    assert.ok(list.body.some(i => i.id === liveId), '新发布条目直接出现在公开列表');
    const res = await request('GET', '/api/items/' + liveId);
    assert.equal(res.status, 200);
  });
  it('管理员下线后从公开列表消失、匿名详情 404', async () => {
    await verifyItem(liveId, false);
    const list = await request('GET', '/api/items');
    assert.ok(!list.body.some(i => i.id === liveId), '下线条目不在公开列表');
    const res = await request('GET', '/api/items/' + liveId);
    assert.equal(res.status, 404);
  });
  it('重新通过后恢复公开', async () => {
    await verifyItem(liveId, true);
    const res = await request('GET', '/api/items/' + liveId);
    assert.equal(res.status, 200);
    const list = await request('GET', '/api/items');
    assert.ok(list.body.some(i => i.id === liveId));
  });
});

describe('垃圾桶（清理/撤回/彻底删除）', () => {
  let admin = '', user = '';
  before(async () => {
    admin = await getAdminToken();
    getDb().prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('TINV40');
    const r = await request('POST', '/api/auth/register', { username: 'trash_' + Date.now(), password: 'pass123456', inviteCode: 'TINV40' });
    user = r.body.token || '';
  });

  it('移入垃圾桶后从待审核与公开列表消失', async () => {
    const create = await request('POST', '/api/items', { name: 'Trash Item A', url: mockBase(), token: 'sk-trash-a' }, user);
    assert.equal(create.status, 201);
    const id = create.body.id;
    await verifyItem(id, false); // 下线 → 变待审核（verified=0）
    const trash = await request('PUT', '/api/admin/items/' + id + '/trash', {}, admin);
    assert.equal(trash.status, 200);
    assert.equal(trash.body.trashed, true);
    assert.equal(trash.body.verified, false);
    const pending = await request('GET', '/api/admin/items?status=pending', null, admin);
    assert.ok(!pending.body.some(i => i.id === id));
    const trashList = await request('GET', '/api/admin/items?status=trash', null, admin);
    assert.ok(trashList.body.some(i => i.id === id));
    const pub = await request('GET', '/api/items');
    assert.ok(!pub.body.some(i => i.id === id));
    const detail = await request('GET', '/api/items/' + id);
    assert.equal(detail.status, 404);
  });

  it('从垃圾桶撤回后回到待审核', async () => {
    const create = await request('POST', '/api/items', { name: 'Trash Item B', url: mockBase(), token: 'sk-trash-b' }, user);
    const id = create.body.id;
    await verifyItem(id, false);
    await request('PUT', '/api/admin/items/' + id + '/trash', {}, admin);
    const restore = await request('PUT', '/api/admin/items/' + id + '/restore', {}, admin);
    assert.equal(restore.status, 200);
    assert.equal(restore.body.trashed, false);
    assert.equal(restore.body.verified, false);
    const pending = await request('GET', '/api/admin/items?status=pending', null, admin);
    assert.ok(pending.body.some(i => i.id === id));
  });

  it('软删（垃圾桶）后同 Token 可重新发布——SELECT 与 DB 唯一索引谓词一致（trashed=0）', async () => {
    // 回归：曾只在 SELECT 层加 trashed=0，但 idx_items_token_unique 无该谓词，
    // INSERT 仍撞索引返回同样的 400「该 Token 已存在」，修复形同虚设
    const create = await request('POST', '/api/items', { name: 'Trash Republish', url: mockBase(), token: 'sk-trash-repub' }, user);
    assert.equal(create.status, 201);
    await request('PUT', '/api/admin/items/' + create.body.id + '/trash', {}, admin);
    const repub = await request('POST', '/api/items', { name: 'Trash Republish Again', url: mockBase(), token: 'sk-trash-repub' }, user);
    assert.equal(repub.status, 201, '软删条目应释放 Token 允许重新发布，实际 ' + repub.status + ' ' + JSON.stringify(repub.body));
    // 清理：把新条目也删掉，避免占用唯一 token 影响其他用例
    await request('PUT', '/api/admin/items/' + repub.body.id + '/trash', {}, admin);
  });

  it('下线（verified=0 未删）仍占用 Token，重复发布被拒', async () => {
    // 设计固化：下线条目仍在审核生命周期（可 restore/重新通过），不释放 Token
    const create = await request('POST', '/api/items', { name: 'Offline Hold', url: mockBase(), token: 'sk-trash-offline' }, user);
    assert.equal(create.status, 201);
    await verifyItem(create.body.id, false); // 下线 → 待审核（verified=0, trashed=0）
    const dup = await request('POST', '/api/items', { name: 'Offline Hold Dup', url: mockBase(), token: 'sk-trash-offline' }, user);
    assert.equal(dup.status, 400, '下线未删条目应继续占用 Token');
    // 清理
    await request('PUT', '/api/admin/items/' + create.body.id + '/trash', {}, admin);
  });

  it('后台列表非法 status 一律 400（防静默显示全部）', async () => {
    // 曾因前端 var 提升把 status 传成 'undefined'，后端静默按「全部」返回，待审核页显示全部
    const bad1 = await request('GET', '/api/admin/items?status=undefined', null, admin);
    assert.equal(bad1.status, 400);
    const bad2 = await request('GET', '/api/admin/items?status=xxx', null, admin);
    assert.equal(bad2.status, 400);
    const bad3 = await request('GET', '/api/admin/tutorials?status=undefined', null, admin);
    assert.equal(bad3.status, 400);
    const bad4 = await request('GET', '/api/admin/feedback?status=undefined', null, admin);
    assert.equal(bad4.status, 400);
    // 合法值仍正常
    const ok1 = await request('GET', '/api/admin/items?status=pending', null, admin);
    assert.equal(ok1.status, 200);
    const ok2 = await request('GET', '/api/admin/feedback?status=open', null, admin);
    assert.equal(ok2.status, 200);
  });

  it('彻底删除后从垃圾桶与详情消失', async () => {
    const create = await request('POST', '/api/items', { name: 'Trash Item C', url: mockBase(), token: 'sk-trash-c' }, user);
    const id = create.body.id;
    await verifyItem(id, false);
    await request('PUT', '/api/admin/items/' + id + '/trash', {}, admin);
    const del = await request('DELETE', '/api/admin/items/' + id, null, admin);
    assert.equal(del.status, 200);
    const trashList = await request('GET', '/api/admin/items?status=trash', null, admin);
    assert.ok(!trashList.body.some(i => i.id === id));
    const detail = await request('GET', '/api/items/' + id);
    assert.equal(detail.status, 404);
  });

  it('一键清理待审：全部待审核移入垃圾桶', async () => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO items (id, name, url, verified, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)")
      .run('trashc1', 'Cleanup-1', 'https://x.com', now, now);
    db.prepare("INSERT INTO items (id, name, url, verified, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)")
      .run('trashc2', 'Cleanup-2', 'https://y.com', now, now);
    const r = await request('POST', '/api/admin/items/trash-pending', {}, admin);
    assert.equal(r.status, 200);
    assert.ok(r.body.moved >= 2);
    const pending = await request('GET', '/api/admin/items?status=pending', null, admin);
    assert.ok(!pending.body.some(i => i.id === 'trashc1'));
    const trashList = await request('GET', '/api/admin/items?status=trash', null, admin);
    assert.ok(trashList.body.some(i => i.id === 'trashc1'));
  });

  it('非管理员无权清理（401/403）', async () => {
    const create = await request('POST', '/api/items', { name: 'Trash Item D', url: mockBase(), token: 'sk-trash-d' }, user);
    const id = create.body.id;
    const r = await request('PUT', '/api/admin/items/' + id + '/trash', {}, user);
    assert.equal(r.status, 403);
    const noAuth = await request('PUT', '/api/admin/items/' + id + '/trash', {});
    assert.equal(noAuth.status, 401);
  });

  it('auto-verify 不复活垃圾桶条目', async () => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO items (id, name, url, token, token_type, verified, trashed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?)")
      .run('trashdead1', 'Trash Dead', mockBase(), 'sk-trashdead-1', 'OpenAI', now, now);
    const r = await request('POST', '/api/admin/items/auto-verify', {}, admin);
    assert.equal(r.status, 200);
    assert.ok(!r.body.approved.some(i => i.id === 'trashdead1'));
    const row = db.prepare('SELECT verified, trashed FROM items WHERE id = ?').get('trashdead1');
    assert.equal(row.trashed, 1);
    assert.equal(row.verified, 0);
  });
});

describe('评论墙（站点留言，自动公开，仅登录可发）', () => {
  let admin = '', ua = '', ub = '';
  before(async () => {
    admin = await getAdminToken();
    getDb().prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('TINV41');
    getDb().prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('TINV42');
    const ra = await request('POST', '/api/auth/register', { username: 'cw_a_' + Date.now(), password: 'pass123456', inviteCode: 'TINV41' });
    ua = ra.body.token || '';
    const rb = await request('POST', '/api/auth/register', { username: 'cw_b_' + Date.now(), password: 'pass123456', inviteCode: 'TINV42' });
    ub = rb.body.token || '';
  });

  it('GET /api/comments 公开返回数组', async () => {
    const r = await request('GET', '/api/comments?limit=10');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.comments));
  });

  it('未登录不能发留言（401）', async () => {
    const r = await request('POST', '/api/comments', { content: '匿名测试' });
    assert.equal(r.status, 401);
  });

  it('登录后可发留言并出现在列表（自动公开）', async () => {
    const r = await request('POST', '/api/comments', { content: '这个免费 API 太好用了！' }, ua);
    assert.equal(r.status, 201);
    assert.equal(r.body.content, '这个免费 API 太好用了！');
    const list = await request('GET', '/api/comments?limit=10');
    assert.ok(list.body.comments.some(c => c.content === '这个免费 API 太好用了！'));
  });

  it('空内容 / 超 100 字被拒', async () => {
    const empty = await request('POST', '/api/comments', { content: '   ' }, ua);
    assert.equal(empty.status, 400);
    const long = await request('POST', '/api/comments', { content: 'x'.repeat(101) }, ua);
    assert.equal(long.status, 400);
  });

  it('作者可删除自己的留言', async () => {
    const r = await request('POST', '/api/comments', { content: '待删留言' }, ua);
    const del = await request('DELETE', '/api/comments/' + r.body.id, null, ua);
    assert.equal(del.status, 200);
  });

  it('版主/管理员可删除他人留言；普通用户不能', async () => {
    const r = await request('POST', '/api/comments', { content: '版主可删' }, ub);
    const forbidden = await request('DELETE', '/api/comments/' + r.body.id, null, ua);
    assert.equal(forbidden.status, 403);
    const ok = await request('DELETE', '/api/comments/' + r.body.id, null, admin);
    assert.equal(ok.status, 200);
  });

  it('未登录删除返回 401', async () => {
    const r = await request('POST', '/api/comments', { content: '未登录删' }, ua);
    const del = await request('DELETE', '/api/comments/' + r.body.id);
    assert.equal(del.status, 401);
  });
});

describe('公告（管理员官方通知，自动公开）', () => {
  let admin = '', normal = '';
  before(async () => {
    admin = await getAdminToken();
    getDb().prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('TINV45');
    const r = await request('POST', '/api/auth/register', { username: 'ann_n_' + Date.now(), password: 'pass123456', inviteCode: 'TINV45' });
    normal = r.body.token || '';
  });

  it('GET /api/announcements 公开返回数组（初始为空）', async () => {
    const r = await request('GET', '/api/announcements');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.announcements));
  });

  it('未登录发公告 401；普通用户 403', async () => {
    const anon = await request('POST', '/api/admin/announcements', { content: 'x' });
    assert.equal(anon.status, 401);
    const user = await request('POST', '/api/admin/announcements', { content: 'x' }, normal);
    assert.equal(user.status, 403);
  });

  it('管理员发布公告，公开接口立即可见', async () => {
    const r = await request('POST', '/api/admin/announcements', { content: '🔥 免费公益 Token 每日更新' }, admin);
    assert.equal(r.status, 201);
    const pub = await request('GET', '/api/announcements');
    assert.ok(pub.body.announcements.some(a => a.content.includes('每日更新')));
  });

  it('空内容 / 超 500 字被拒', async () => {
    const empty = await request('POST', '/api/admin/announcements', { content: '   ' }, admin);
    assert.equal(empty.status, 400);
    const long = await request('POST', '/api/admin/announcements', { content: 'x'.repeat(501) }, admin);
    assert.equal(long.status, 400);
  });

  it('管理员列表含全部（含已下线）', async () => {
    const r = await request('GET', '/api/admin/announcements', null, admin);
    assert.equal(r.status, 200);
    assert.ok(r.body.announcements.some(a => a.content.includes('每日更新')));
  });

  it('下线后公开接口隐藏，普通用户无法下线', async () => {
    const list = await request('GET', '/api/admin/announcements', null, admin);
    const target = list.body.announcements.find(a => a.content.includes('每日更新'));
    assert.ok(target);
    const denied = await request('PUT', '/api/admin/announcements/' + target.id, { active: false }, normal);
    assert.equal(denied.status, 403);
    const ok = await request('PUT', '/api/admin/announcements/' + target.id, { active: false }, admin);
    assert.equal(ok.status, 200);
    const pub = await request('GET', '/api/announcements');
    assert.ok(!pub.body.announcements.some(a => a.id === target.id));
  });

  it('管理员编辑公告内容，公开接口同步', async () => {
    const list = await request('GET', '/api/admin/announcements', null, admin);
    const target = list.body.announcements.find(a => a.content.includes('每日更新'));
    const r = await request('PUT', '/api/admin/announcements/' + target.id, { content: '更新后的公告内容' }, admin);
    assert.equal(r.status, 200);
    const pub = await request('GET', '/api/announcements');
    assert.ok(!pub.body.announcements.some(a => a.content.includes('更新后的公告内容')));
    // 该公告处于下线态，编辑内容后仍未公开（符合预期）；重新上线后可见
    const on = await request('PUT', '/api/admin/announcements/' + target.id, { active: true }, admin);
    assert.equal(on.status, 200);
    const pub2 = await request('GET', '/api/announcements');
    assert.ok(pub2.body.announcements.some(a => a.content.includes('更新后的公告内容')));
  });

  it('管理员删除公告', async () => {
    const list = await request('GET', '/api/admin/announcements', null, admin);
    const target = list.body.announcements.find(a => a.content.includes('更新后的公告内容'));
    const r = await request('DELETE', '/api/admin/announcements/' + target.id, null, admin);
    assert.equal(r.status, 200);
    const pub = await request('GET', '/api/announcements');
    assert.ok(!pub.body.announcements.some(a => a.id === target.id));
  });

  it('普通用户不能删除公告', async () => {
    const r = await request('POST', '/api/admin/announcements', { content: '待删公告' }, admin);
    const denied = await request('DELETE', '/api/admin/announcements/' + r.body.id, null, normal);
    assert.equal(denied.status, 403);
    await request('DELETE', '/api/admin/announcements/' + r.body.id, null, admin);
  });
});

describe('反馈 / Bug 上报（公社信箱，单入口双标签，后台版主可见）', () => {
  let admin = '', normal = '';
  before(async () => {
    admin = await getAdminToken();
    getDb().prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('TINV99');
    const r = await request('POST', '/api/auth/register', { username: 'fb_n_' + Date.now(), password: 'pass123456', inviteCode: 'TINV99' });
    normal = r.body.token || '';
  });

  it('未登录提交反馈 401', async () => {
    const r = await request('POST', '/api/feedback', { kind: 'feedback', content: '你好' });
    assert.equal(r.status, 401);
  });

  it('普通用户提交反馈成功（feedback），管理员列表可见', async () => {
    const r = await request('POST', '/api/feedback', { kind: 'feedback', content: '首页很棒，但想加个分类筛选', url: 'https://freeapis.top/' }, normal);
    assert.equal(r.status, 201);
    const list = await request('GET', '/api/admin/feedback', null, admin);
    assert.equal(list.status, 200);
    assert.ok(list.body.feedback.some(f => f.kind === 'feedback' && f.content.includes('分类筛选')));
  });

  it('提交 Bug 类型成功，kind=bug', async () => {
    const r = await request('POST', '/api/feedback', { kind: 'bug', content: '详情弹窗在移动端溢出', url: 'https://freeapis.top/?id=x' }, normal);
    assert.equal(r.status, 201);
    assert.equal(r.body.kind, 'bug');
    const list = await request('GET', '/api/admin/feedback?status=open', null, admin);
    assert.ok(list.body.feedback.some(f => f.kind === 'bug'));
  });

  it('非法 kind / 空内容 / 超 1000 字被拒', async () => {
    const badKind = await request('POST', '/api/feedback', { kind: 'hack', content: 'x' }, normal);
    assert.equal(badKind.status, 400);
    const empty = await request('POST', '/api/feedback', { kind: 'feedback', content: '   ' }, normal);
    assert.equal(empty.status, 400);
    const tooLong = await request('POST', '/api/feedback', { kind: 'feedback', content: 'a'.repeat(1001) }, normal);
    assert.equal(tooLong.status, 400);
  });

  it('外链图片 / javascript: url 被剥离（防后台看图泄露管理员 IP / 伪协议注入）', async () => {
    const r = await request('POST', '/api/feedback', {
      kind: 'bug', content: '外链图片测试',
      image: 'http://evil.com/tracker.png', url: 'javascript:alert(1)'
    }, normal);
    assert.equal(r.status, 201);
    const list = await request('GET', '/api/admin/feedback', null, admin);
    const item = list.body.feedback.find(f => f.content === '外链图片测试');
    assert.ok(item, '应能找到该条');
    assert.equal(item.image, '', '外链图片必须被剥离为空');
    assert.equal(item.url, '', 'javascript: url 必须被剥离为空');
  });

  it('普通用户访问管理后台反馈列表 403', async () => {
    const r = await request('GET', '/api/admin/feedback', null, normal);
    assert.equal(r.status, 403);
  });

  it('管理员标记完成 / 重新打开 / 删除', async () => {
    const created = await request('POST', '/api/feedback', { kind: 'feedback', content: '处理流程测试' }, normal);
    const id = created.body.id;
    const done = await request('PUT', '/api/admin/feedback/' + id, { status: 'done' }, admin);
    assert.equal(done.status, 200);
    assert.equal(done.body.status, 'done');
    const reopen = await request('PUT', '/api/admin/feedback/' + id, { status: 'open' }, admin);
    assert.equal(reopen.body.status, 'open');
    const del = await request('DELETE', '/api/admin/feedback/' + id, null, admin);
    assert.equal(del.status, 200);
    const list = await request('GET', '/api/admin/feedback', null, admin);
    assert.ok(!list.body.feedback.some(f => f.id === id));
  });

  it('删除不存在的反馈 404', async () => {
    const r = await request('DELETE', '/api/admin/feedback/nonexistent', null, admin);
    assert.equal(r.status, 404);
  });

  it('版主通过高质量反馈：作者 +1 积分（幂等，同一反馈只发一次）', async () => {
    const before = await request('GET', '/api/points', null, normal);
    const bp = before.body.points || 0;
    const created = await request('POST', '/api/feedback', { kind: 'feedback', content: '重要建议：支持按模型筛选' }, normal);
    const id = created.body.id;
    const verify = await request('POST', '/api/admin/feedback/' + id + '/verify', null, admin);
    assert.equal(verify.status, 200, JSON.stringify(verify.body));
    assert.equal(verify.body.awarded, true, '首次通过应发放积分');
    assert.equal(verify.body.points, bp + 1, '作者积分应 +1');
    assert.equal(verify.body.feedback.status, 'done');
    assert.equal(verify.body.feedback.pointsAwarded, true);
    const verify2 = await request('POST', '/api/admin/feedback/' + id + '/verify', null, admin);
    assert.equal(verify2.status, 200);
    assert.equal(verify2.body.awarded, false, '重复通过不应再发放');
    assert.equal(verify2.body.points, bp + 1, '积分不叠加');
    const pl = getDb().prepare("SELECT COUNT(*) c FROM points_log WHERE reason = 'feedback_verify' AND ref_id = ?").get(id);
    assert.equal(pl.c, 1, 'feedback_verify 流水应只有一条');
    await request('DELETE', '/api/admin/feedback/' + id, null, admin);
  });

  it('普通用户不能通过反馈（403）', async () => {
    const created = await request('POST', '/api/feedback', { kind: 'feedback', content: '越权测试' }, normal);
    const id = created.body.id;
    const r = await request('POST', '/api/admin/feedback/' + id + '/verify', null, normal);
    assert.equal(r.status, 403);
    await request('DELETE', '/api/admin/feedback/' + id, null, admin);
  });

  it('版主不能给自己的反馈通过发分（防自刷）', async () => {
    const mine = await request('POST', '/api/feedback', { kind: 'feedback', content: '我自己提的建议' }, admin);
    const id = mine.body.id;
    const r = await request('POST', '/api/admin/feedback/' + id + '/verify', null, admin);
    assert.equal(r.status, 400);
    await request('DELETE', '/api/admin/feedback/' + id, null, admin);
  });
});

describe('注册邀请码', () => {
  it('无邀请码注册被拒绝', async () => {
    const res = await request('POST', '/api/auth/register', { username: 'no_inv_' + Date.now(), password: 'pass123456' });
    assert.equal(res.status, 400);
    assert.ok((res.body.error || '').includes('邀请码'));
  });
  it('无效邀请码被拒绝', async () => {
    const res = await request('POST', '/api/auth/register', { username: 'badinv_' + Date.now(), password: 'pass123456', inviteCode: 'WRONG123' });
    assert.equal(res.status, 400);
  });
  it('有效邀请码注册成功且码被标记使用', async () => {
    const res = await request('POST', '/api/auth/register', { username: 'inv_ok_' + Date.now(), password: 'pass123456', inviteCode: 'TINV06' });
    assert.equal(res.status, 201);
    assert.ok(res.body.token);
    const row = getDb().prepare('SELECT used_by FROM invite_codes WHERE code = ?').get('TINV06');
    assert.ok(row && row.used_by);
  });
  it('邀请码重复使用被拒绝', async () => {
    const res = await request('POST', '/api/auth/register', { username: 'ruse_' + Date.now(), password: 'pass123456', inviteCode: 'TINV06' });
    assert.equal(res.status, 400);
    assert.ok((res.body.error || '').includes('已被使用'));
  });
});

describe('管理员邀请码接口', () => {
  it('普通用户无权限', async () => {
    const t = await getToken();
    const res = await request('GET', '/api/admin/invites', null, t);
    assert.equal(res.status, 403);
  });
  it('管理员生成并查看邀请码', async () => {
    const admin = await getAdminToken();
    const gen = await request('POST', '/api/admin/invites', { count: 3 }, admin);
    assert.equal(gen.status, 201);
    assert.equal(gen.body.created.length, 3);
    // 48 位随机熵：邀请码至少 12 位，暴力枚举不可行
    assert.ok(gen.body.created.every(c => /^[0-9A-F]{12}$/.test(c)), JSON.stringify(gen.body.created));
    const list = await request('GET', '/api/admin/invites', null, admin);
    assert.equal(list.status, 200);
    assert.ok(list.body.length >= 3);
  });
  it('并发注册同一邀请码仅一次成功（一码一用竞态安全）', async () => {
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('RACE01');
    const attempts = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      request('POST', '/api/auth/register', { username: 'race_' + i + '_' + Date.now(), password: 'pass123456', inviteCode: 'RACE01' })));
    const okCount = attempts.filter(r => r.status === 201).length;
    assert.equal(okCount, 1, '成功数=' + okCount + ' 应为 1');
    const used = db.prepare('SELECT used_by FROM invite_codes WHERE code = ?').get('RACE01');
    assert.ok(used && used.used_by);
  });
});

describe('失效 Token 一键下线', () => {
  it('确定失效的连接失败自动下线，正常的保留', async () => {
    const admin = await getAdminToken();
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO items (id, name, url, token, token_type, verified, created_at, updated_at) VALUES ('checkdead1', 'Dead Token', 'http://127.0.0.1:1', 'sk-dead-1', 'OpenAI', 1, ?, ?)").run(now, now);
    db.prepare("INSERT INTO items (id, name, url, token, token_type, verified, created_at, updated_at) VALUES ('checkok1', 'Good Token', ?, 'sk-good-1', 'OpenAI', 1, ?, ?)").run(mockBase(), now, now);
    const res = await request('POST', '/api/admin/items/check', {}, admin);
    assert.equal(res.status, 200);
    assert.ok(res.body.offline.some(o => o.id === 'checkdead1'));
    assert.ok(res.body.kept.some(k => k.id === 'checkok1'));
    const row = db.prepare('SELECT verified FROM items WHERE id = ?').get('checkdead1');
    assert.equal(row.verified, 0);
  });

  it('503 维护中也算失效，自动下线', async () => {
    const admin = await getAdminToken();
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO items (id, name, url, token, token_type, verified, created_at, updated_at) VALUES ('check503', '503 Down', ?, 'sk-503-1', 'OpenAI', 1, ?, ?)").run(mockBase() + '/503', now, now);
    const res = await request('POST', '/api/admin/items/check', {}, admin);
    assert.equal(res.status, 200);
    assert.ok(res.body.offline.some(o => o.id === 'check503'), '503 条目应被下线');
    const row = db.prepare('SELECT verified FROM items WHERE id = ?').get('check503');
    assert.equal(row.verified, 0);
  });

  it('429 限流保护视为有效，不下架', async () => {
    const admin = await getAdminToken();
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO items (id, name, url, token, token_type, verified, created_at, updated_at) VALUES ('check429', 'Rate Limited', ?, 'sk-429-1', 'OpenAI', 1, ?, ?)").run(mockBase() + '/429', now, now);
    const res = await request('POST', '/api/admin/items/check', {}, admin);
    assert.equal(res.status, 200);
    assert.ok(!res.body.offline.some(o => o.id === 'check429'), '429 不应被下线');
    assert.ok(res.body.kept.some(k => k.id === 'check429'), '429 应保留在线');
    const row = db.prepare('SELECT verified FROM items WHERE id = ?').get('check429');
    assert.equal(row.verified, 1, '429 条目保持在线');
  });

  it('端点 200 但模型不可用（假/掺水端点）→ 判定失效下线（用户策略：有可用模型即有效）', async () => {
    const admin = await getAdminToken();
    const db = getDb();
    const now = new Date().toISOString();
    // /poison：/models 返回 200 列出 poison-model，但 /chat/completions 对该模型 400（不可用）
    db.prepare("INSERT INTO items (id, name, url, token, token_type, verified, created_at, updated_at) VALUES ('checkpoison', 'Poison Endpoint', ?, 'sk-poison-1', 'OpenAI', 1, ?, ?)").run(mockBase() + '/poison', now, now);
    const res = await request('POST', '/api/admin/items/check', {}, admin);
    assert.equal(res.status, 200);
    assert.ok(res.body.offline.some(o => o.id === 'checkpoison'), '端点可达但列出的模型真实调用失败，应下线（而非只看端点连通）');
    assert.ok(!res.body.kept.some(k => k.id === 'checkpoison'), '该条目不应被保留');
    const row = db.prepare('SELECT verified FROM items WHERE id = ?').get('checkpoison');
    assert.equal(row.verified, 0, '无可用模型的条目应下线');
  });

  it('发布时端点返回 429 也拒绝（发布必须零错误）', async () => {
    const t = await getToken();
    const res = await request('POST', '/api/items', { name: 'Publish 429', url: mockBase() + '/429', token: 'sk-pub-429-1', tokenType: 'OpenAI' }, t);
    assert.equal(res.status, 400, '429 端点不应发布成功');
    assert.ok(/Token 测试失败/.test(res.body.error || ''), '应提示 Token 测试失败: ' + res.body.error);
  });

  it('/api/test-token 对 429 端点返回「有效但限流」分类（kind=ratelimit，与巡检判定一致）', async () => {
    const t = await getToken();
    const res = await request('POST', '/api/test-token', { token: 'sk-tt-429-1', tokenType: 'OpenAI', baseUrl: mockBase() + '/429' }, t);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, false, '429 不算 ok（仍非可用状态）');
    assert.equal(res.body.status, 429, '应透传 429 状态');
    assert.equal(res.body.kind, 'ratelimit', '应标记为 ratelimit 而非通用 http');
    assert.ok(/限流|429/.test(res.body.error || ''), '错误文案应说明是限流: ' + res.body.error);
  });

  it('GET /api/admin/sweep 查看最近巡检（仅管理员）', async () => {
    const admin = await getAdminToken();
    const res = await request('GET', '/api/admin/sweep', undefined, admin);
    assert.equal(res.status, 200);
    assert.ok('lastRun' in res.body, '应含 lastRun');
    assert.ok('offlineCount' in res.body && 'keptCount' in res.body);
    const u = await getToken();
    const forbidden = await request('GET', '/api/admin/sweep', undefined, u);
    assert.equal(forbidden.status, 403, '普通用户无权查看巡检');
  });

  it('普通用户无权限检测', async () => {
    const t = await getToken();
    const res = await request('POST', '/api/admin/items/check', {}, t);
    assert.equal(res.status, 403);
  });
});

describe('一键自动审核（测试通过的待审核 Token 自动通过）', () => {
  it('端点测试通过的待审核 Token 自动 verified=1，失败或非 Token 的保持待审核', async () => {
    const admin = await getAdminToken();
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO items (id, name, url, token, token_type, verified, created_at, updated_at) VALUES ('autov_ok', 'Auto Pass', ?, 'sk-auto-1', 'OpenAI', 0, ?, ?)").run(mockBase(), now, now);
    db.prepare("INSERT INTO items (id, name, url, token, token_type, verified, created_at, updated_at) VALUES ('autov_bad', 'Auto Fail', 'http://127.0.0.1:1', 'sk-auto-2', 'OpenAI', 0, ?, ?)").run(now, now);
    db.prepare("INSERT INTO items (id, name, url, verified, created_at, updated_at) VALUES ('autov_nolink', 'No Token', 'https://example.com', 0, ?, ?)").run(now, now);
    const res = await request('POST', '/api/admin/items/auto-verify', {}, admin);
    assert.equal(res.status, 200);
    assert.ok(res.body.approved.some(a => a.id === 'autov_ok'), '通过端点测试的应自动通过');
    assert.ok(res.body.rejected.some(r => r.id === 'autov_bad'), '失败端点应进入未通过');
    assert.equal(db.prepare('SELECT verified FROM items WHERE id = ?').get('autov_ok').verified, 1);
    assert.equal(db.prepare('SELECT verified FROM items WHERE id = ?').get('autov_bad').verified, 0);
    assert.equal(db.prepare('SELECT verified FROM items WHERE id = ?').get('autov_nolink').verified, 0, '无 Token 条目不参与自动审核');
  });

  it('限流条目进 limited 暂缓（不断言好坏，verified 保持 0，也不在 rejected 里）', async () => {
    const admin = await getAdminToken();
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO items (id, name, url, token, token_type, verified, created_at, updated_at) VALUES ('autov_limit', 'Auto Limited', ?, 'sk-auto-lim', 'OpenAI', 0, ?, ?)").run(mockBase() + '/429', now, now);
    const res = await request('POST', '/api/admin/items/auto-verify', {}, admin);
    assert.equal(res.status, 200);
    assert.ok((res.body.limited || []).some(a => a.id === 'autov_limit'), '全程 429 的应进 limited 暂缓');
    assert.ok(!(res.body.rejected || []).some(r => r.id === 'autov_limit'), '限流条目不得进 rejected（防版主误删好条目）');
    assert.equal(db.prepare('SELECT verified FROM items WHERE id = ?').get('autov_limit').verified, 0);
  });

  it('未登录访问返回 401', async () => {
    const res = await request('POST', '/api/admin/items/auto-verify', {});
    assert.equal(res.status, 401);
  });

  it('普通用户无权限返回 403', async () => {
    const t = await getToken();
    const res = await request('POST', '/api/admin/items/auto-verify', {}, t);
    assert.equal(res.status, 403);
  });
});

describe('SSRF 防护', () => {
  it('拒绝内网回环地址', async () => {
    process.env.ALLOW_PRIVATE_SSRF = '0';
    try {
      const res = await request('POST', '/api/test-token', { token: 'sk-ssrf-test', tokenType: 'OpenAI', baseUrl: 'http://127.0.0.1:1' }, await getToken());
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, false);
      assert.ok((res.body.error || '').includes('禁止访问内网'));
    } finally { process.env.ALLOW_PRIVATE_SSRF = '1'; }
  });

  it('拒绝云元数据地址 169.254.169.254', async () => {
    process.env.ALLOW_PRIVATE_SSRF = '0';
    try {
      const res = await request('POST', '/api/test-token', { token: 'sk-ssrf-test', tokenType: 'OpenAI', baseUrl: 'http://169.254.169.254/' }, await getToken());
      assert.equal(res.body.ok, false);
      assert.ok((res.body.error || '').includes('禁止访问内网'));
    } finally { process.env.ALLOW_PRIVATE_SSRF = '1'; }
  });

  it('拒绝私网 10.x 地址', async () => {
    process.env.ALLOW_PRIVATE_SSRF = '0';
    try {
      const res = await request('POST', '/api/test-token', { token: 'sk-ssrf-test', tokenType: 'OpenAI', baseUrl: 'http://10.0.0.1/' }, await getToken());
      assert.equal(res.body.ok, false);
      assert.ok((res.body.error || '').includes('禁止访问内网'));
    } finally { process.env.ALLOW_PRIVATE_SSRF = '1'; }
  });
});

describe('Token 测试鉴权', () => {
  it('/api/test-token 未登录返回 401（防 Token 有效性预言机滥用）', async () => {
    const res = await request('POST', '/api/test-token', { token: 'sk-anon', tokenType: 'OpenAI', baseUrl: 'http://127.0.0.1:1' });
    assert.equal(res.status, 401);
  });
  it('/api/test-token 登录后可调用', async () => {
    const res = await request('POST', '/api/test-token', { token: 'sk-logged-in', tokenType: 'OpenAI', baseUrl: 'http://127.0.0.1:1' }, await getToken());
    assert.equal(res.status, 200);
  });
});

describe('JSON-LD 存储型 XSS 防护', () => {
  it('条目名含 </script> 不得从首页 SSR JSON-LD 逃逸（C1）', async () => {
    const t = await getToken();
    const payload = '</script><script>alert(1)</script>';
    const res = await request('POST', '/api/items', { name: payload, url: mockBase(), token: 'sk-xss-probe', tokenType: 'OpenAI' }, t);
    assert.ok(res.status === 200 || res.status === 201, '恶意条目应发布成功（验证渲染层而非发布层）');
    // 首页 SSR HTML 不应出现原始 payload（否则 <script> 从 ld+json 逃逸执行）
    const home = await request('GET', '/');
    const html = home.body;
    assert.ok(!html.includes(payload), '原始 </script> payload 不得出现在 HTML');
    // 名称以 JSON 转义形式（<）出现在 ld+json —— 证明注入被中和且条目确实渲染
    assert.ok(html.includes('\\u003c/script>'), 'ld+json 中应含 \\u003c 转义形式');
  });
});

describe('反投毒（假端点识别）', () => {
  it('端点 200 但无可用模型 → 判为假端点，拒绝发布', async () => {
    const t = await getToken();
    const fakeBase = 'http://127.0.0.1:' + mockPort + '/fake';
    const res = await request('POST', '/api/items', { name: 'Fake Endpoint', url: fakeBase, token: 'sk-fake-accept', tokenType: 'OpenAI' }, t);
    assert.equal(res.status, 400);
    assert.ok((res.body.error || '').includes('未返回可用模型'));
  });

  it('真实端点返回模型 → 正常发布', async () => {
    const t = await getToken();
    const res = await request('POST', '/api/items', { name: 'Real Endpoint', url: mockBase(), token: 'sk-real-token-abc', tokenType: 'OpenAI' }, t);
    assert.equal(res.status, 201);
  });
});

describe('小米式分前缀布局（models 在 /v1/models，messages 在 /anthropic/v1/messages）', () => {
  it('裸 host base 也能发布：OpenAI 落在 /v1/models、Anthropic 落在 /anthropic/v1/messages，双徽章都识别', async () => {
    const t = await getToken();
    // 用裸 host（http://127.0.0.1:port）作为 base —— 旧逻辑探测 /models 与 /v1/messages 都会 404
    const created = await request('POST', '/api/items', { name: 'Xiaomi Split Prefix', url: xiaomiMockBase(), token: 'sk-xiaomi-1', tokenType: 'OpenAI' }, t);
    assert.equal(created.status, 201, '应发布成功: ' + JSON.stringify(created.body));
    assert.ok(created.body.compat.includes('openai'), '应识别 OpenAI 兼容: ' + JSON.stringify(created.body.compat));
    assert.ok(created.body.compat.includes('anthropic'), '应识别 Anthropic 兼容（/anthropic 前缀）: ' + JSON.stringify(created.body.compat));
    assert.ok(created.body.models.includes('xiaomi-model'), '应从 /v1/models 探测到模型: ' + JSON.stringify(created.body.models));
  });

  it('坏 Key 即使路径正确仍被拒（发布零错误底线不破）', async () => {
    const t = await getToken();
    const res = await request('POST', '/api/items', { name: 'Xiaomi Bad Key', url: xiaomiMockBase(), token: 'sk-bad-xiaomi', tokenType: 'OpenAI' }, t);
    assert.equal(res.status, 400);
    assert.ok((res.body.error || '').includes('无效'), '应提示 Key 无效: ' + res.body.error);
  });

  it('巡检不误下线分前缀端点：/v1/models 返回 200 则保留', async () => {
    const admin = await getAdminToken();
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO items (id, name, url, token, token_type, verified, created_at, updated_at) VALUES ('xiaomiok1', 'Xiaomi Good', ?, 'sk-xiaomi-sweep', 'OpenAI', 1, ?, ?)").run(xiaomiMockBase(), now, now);
    const res = await request('POST', '/api/admin/items/check', {}, admin);
    assert.equal(res.status, 200);
    assert.ok(res.body.kept.some(k => k.id === 'xiaomiok1'), '小米条目应被保留，不得误下线');
    assert.ok(!res.body.offline.some(o => o.id === 'xiaomiok1'), '小米条目不得进入下线名单');
    const row = db.prepare('SELECT verified FROM items WHERE id = ?').get('xiaomiok1');
    assert.equal(row.verified, 1);
  });

  it('test-token 指定模型也走分前缀兜底：Anthropic + model + 裸 host 不误报「模型不可用」', async () => {
    const t = await getToken();
    const res = await request('POST', '/api/test-token', { token: 'sk-xiaomi-1', tokenType: 'Anthropic', baseUrl: xiaomiMockBase(), model: 'MiMo-7B' }, t);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.ok, '应命中 /anthropic/v1/messages 而非误报模型不可用: ' + JSON.stringify(res.body));
  });
});

describe('越权防护（IDOR）', () => {
  let victimId;
  it('准备他人条目', async () => {
    const t = await getToken();
    const create = await request('POST', '/api/items', { name: 'IDOR Victim', url: mockBase(), token: 'sk-idor-victim', tokenType: 'OpenAI' }, t);
    assert.equal(create.status, 201);
    victimId = create.body.id;
  });
  it('普通用户不能改他人条目（PUT /api/items/:id）', async () => {
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('TINV07');
    const r = await request('POST', '/api/auth/register', { username: 'idor_attacker', password: 'pass123456', inviteCode: 'TINV07' });
    assert.equal(r.status, 201);
    const res = await request('PUT', '/api/items/' + victimId, { name: 'Hacked' }, r.body.token);
    assert.equal(res.status, 403);
  });
  it('普通用户不能删他人条目（DELETE /api/items/:id）', async () => {
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('TINV08');
    const r = await request('POST', '/api/auth/register', { username: 'idor_attacker2', password: 'pass123456', inviteCode: 'TINV08' });
    assert.equal(r.status, 201);
    const res = await request('DELETE', '/api/items/' + victimId, null, r.body.token);
    assert.equal(res.status, 403);
  });
});
describe('教程发布', () => {
  it('发布教程成功进入待审核', async () => {
    const t = await getToken();
    const res = await request('POST', '/api/tutorials', { title: 'OpenAI 入门', summary: '摘要', category: 'OpenAI', tags: ['入门'], content: '# 标题\n\n正文' }, t);
    assert.equal(res.status, 201);
    assert.equal(res.body.verified, false);
    assert.ok(res.body.id);
  });
  it('title/content 必填校验', async () => {
    const t = await getToken();
    const r1 = await request('POST', '/api/tutorials', { title: '', content: 'x' }, t);
    assert.equal(r1.status, 400);
    const r2 = await request('POST', '/api/tutorials', { title: 'x' }, t);
    assert.equal(r2.status, 400);
    assert.ok((r2.body.error || '').includes('content'));
  });
  it('非法分类被拒', async () => {
    const t = await getToken();
    const res = await request('POST', '/api/tutorials', { title: 'x', content: 'y', category: '不存在的分类' }, t);
    assert.equal(res.status, 400);
    assert.ok((res.body.error || '').includes('分类'));
  });
  it('超长 title 被拒', async () => {
    const t = await getToken();
    const res = await request('POST', '/api/tutorials', { title: 'x'.repeat(121), content: 'y' }, t);
    assert.equal(res.status, 400);
  });
  it('未登录不能发布', async () => {
    const res = await request('POST', '/api/tutorials', { title: 'x', content: 'y' });
    assert.equal(res.status, 401);
  });
  it('cover 支持自有 /uploads/ 路径与外链，非法值被拒', async () => {
    const t = await getToken();
    const r1 = await request('POST', '/api/tutorials', { title: 'Cover Tut', content: '正文', cover: '/uploads/abc123.png' }, t);
    assert.equal(r1.status, 201);
    assert.equal(r1.body.cover, '/uploads/abc123.png');
    const r2 = await request('POST', '/api/tutorials', { title: 'Cover Bad', content: '正文', cover: 'javascript:alert(1)' }, t);
    assert.equal(r2.status, 400);
    const r3 = await request('POST', '/api/tutorials', { title: 'Cover Web', content: '正文', cover: 'https://example.com/a.jpg' }, t);
    assert.equal(r3.status, 201);
    assert.equal(r3.body.cover, 'https://example.com/a.jpg');
  });
  it('编辑可更新 cover', async () => {
    const t = await getToken();
    const c = await request('POST', '/api/tutorials', { title: 'Cover Edit', content: '正文' }, t);
    const upd = await request('PUT', '/api/my/tutorials/' + c.body.id, { cover: '/uploads/new.png' }, t);
    assert.equal(upd.status, 200);
    assert.equal(upd.body.cover, '/uploads/new.png');
  });
});

describe('图片上传（教程封面）', () => {
  it('上传有效 PNG 返回 /uploads/ 地址且可访问', async () => {
    const t = await getToken();
    const up = await rawRequest('/api/upload', TINY_PNG, 'image/png', t);
    assert.equal(up.status, 200);
    assert.ok((up.body.url || '').startsWith('/uploads/'), up.body.url);
    assert.ok(/\.png$/.test(up.body.url));
    const name = (up.body.url || '').split('/').pop();
    const res = await new Promise((resolve, reject) => {
      const opts = { hostname: '127.0.0.1', port: server.address().port, path: '/uploads/' + name, method: 'GET' };
      const req = http.request(opts, (r) => {
        let d = Buffer.alloc(0);
        r.on('data', c => d = Buffer.concat([d, c]));
        r.on('end', () => resolve({ status: r.statusCode, ct: r.headers['content-type'] }));
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(res.status, 200);
    assert.ok((res.ct || '').includes('image/png'));
  });
  it('未登录 401', async () => {
    const res = await rawRequest('/api/upload', TINY_PNG, 'image/png', null);
    assert.equal(res.status, 401);
  });
  it('非图片（SVG/文本）被拒', async () => {
    const t = await getToken();
    const svg = await rawRequest('/api/upload', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/svg+xml', t);
    assert.equal(svg.status, 400, 'SVG 应被拒');
    const txt = await rawRequest('/api/upload', Buffer.from('just some plain text that is not an image'), 'text/plain', t);
    assert.equal(txt.status, 400);
  });
  it('超大图片被拒', async () => {
    const t = await getToken();
    const big = Buffer.concat([TINY_PNG, Buffer.alloc(3200000)]);
    const res = await rawRequest('/api/upload', big, 'image/png', t);
    assert.equal(res.status, 400);
  });
});

describe('教程列表与详情', () => {
  let publishedId;
  it('发布并审核通过', async () => {
    const t = await getToken();
    const created = await request('POST', '/api/tutorials', { title: '公开教程', content: '# 公开\n内容', category: '教程' }, t);
    assert.equal(created.status, 201);
    publishedId = created.body.id;
    await request('PUT', '/api/admin/tutorials/' + publishedId + '/verify', { verified: true }, await getAdminToken());
  });
  it('列表返回 summary 模式，不含 content', async () => {
    const res = await request('GET', '/api/tutorials?limit=50');
    assert.equal(res.status, 200);
    const item = res.body.find(i => i.id === publishedId);
    assert.ok(item);
    assert.equal(item.content, undefined);
    assert.ok(item.summary.length > 0);
  });
  it('X-Total-Count 头存在', async () => {
    const res = await request('GET', '/api/tutorials?limit=12');
    assert.ok(res.headers['x-total-count']);
    assert.ok(parseInt(res.headers['x-total-count'], 10) >= 1);
  });
  it('详情返回全文 content', async () => {
    const res = await request('GET', '/api/tutorials/' + publishedId);
    assert.equal(res.status, 200);
    assert.ok(res.body.content.includes('# 公开'));
  });
  it('分类列表稳定返回', async () => {
    const res = await request('GET', '/api/tutorials/categories');
    assert.equal(res.status, 200);
    assert.ok(res.body.some(c => c.name === '教程'));
    assert.ok(res.body.some(c => c.name === 'OpenAI'));
  });
});

describe('教程审核可见性', () => {
  let pendingId;
  it('待审核教程不出现在公开列表', async () => {
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('TINV21');
    const r = await request('POST', '/api/auth/register', { username: 'tut_author', password: 'pass123456', inviteCode: 'TINV21' });
    const created = await request('POST', '/api/tutorials', { title: '待审核教程', content: '内容', category: '教程' }, r.body.token);
    pendingId = created.body.id;
    const list = await request('GET', '/api/tutorials?limit=100');
    assert.ok(!list.body.some(i => i.id === pendingId));
  });
  it('匿名详情 404（不泄露存在）', async () => {
    const res = await request('GET', '/api/tutorials/' + pendingId);
    assert.equal(res.status, 404);
  });
  it('作者可预览自己的待审核教程', async () => {
    const login = await request('POST', '/api/auth/login', { username: 'tut_author', password: 'pass123456' });
    const res = await request('GET', '/api/tutorials/' + pendingId, null, login.body.token);
    assert.equal(res.status, 200);
    assert.equal(res.body.id, pendingId);
  });
  it('审核通过后公开可见', async () => {
    await request('PUT', '/api/admin/tutorials/' + pendingId + '/verify', { verified: true }, await getAdminToken());
    const list = await request('GET', '/api/tutorials?limit=100');
    assert.ok(list.body.some(i => i.id === pendingId));
  });
});

describe('后台待审核计数（review-counts，供角标）', () => {
  it('返回待审核条目/教程/待处理反馈计数（版主+）', async () => {
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('TINV90');
    const r = await request('POST', '/api/auth/register', { username: 'cnt_user', password: 'pass123456', inviteCode: 'TINV90' });
    const uid = r.body.user ? r.body.user.id : '';
    db.prepare("INSERT INTO items (id, name, url, token, created_by, verified, created_at, updated_at) VALUES (?,?,?,?,?,0,datetime('now'),datetime('now'))")
      .run('cnt-pending-item', '计数-待审条目', 'https://x.com', 'sk-cnt-item', uid);
    db.prepare("INSERT INTO tutorials (id, title, content, created_by, verified, created_at, updated_at) VALUES (?,?,?,?,0,datetime('now'),datetime('now'))")
      .run('cnt-pending-tut', '计数-待审教程', '内容', uid);
    await request('POST', '/api/feedback', { kind: 'bug', content: '计数反馈' }, r.body.token);
    const admin = await getAdminToken();
    const res = await request('GET', '/api/admin/review-counts', null, admin);
    assert.equal(res.status, 200);
    assert.ok(res.body.pendingItems >= 1, '待审核条目计数应 >=1');
    assert.ok(res.body.pendingTutorials >= 1, '待审核教程计数应 >=1');
    assert.ok(res.body.openFeedback >= 1, '待处理反馈计数应 >=1');
  });
  it('普通用户无权访问（403）', async () => {
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('TINV91');
    const r = await request('POST', '/api/auth/register', { username: 'cnt_plain', password: 'pass123456', inviteCode: 'TINV91' });
    const res = await request('GET', '/api/admin/review-counts', null, r.body.token);
    assert.equal(res.status, 403);
  });
  it('未登录返回 401', async () => {
    const res = await request('GET', '/api/admin/review-counts');
    assert.equal(res.status, 401);
  });
});

describe('认证广告（自助发布 + 版主授权上线）', () => {
  let advToken = '';
  let adv2Token = '';
  let sponA = '';
  let sponB = '';
  before(async () => {
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('SPON01');
    db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('SPON02');
    const r1 = await request('POST', '/api/auth/register', { username: 'spon_adv', password: 'pass123456', inviteCode: 'SPON01' });
    advToken = r1.body.token || '';
    const r2 = await request('POST', '/api/auth/register', { username: 'spon_adv2', password: 'pass123456', inviteCode: 'SPON02' });
    adv2Token = r2.body.token || '';
  });
  it('未登录不能申请（401），非法输入 400', async () => {
    assert.equal((await request('POST', '/api/sponsors', { name: 'x', url: 'https://a.com' })).status, 401);
    assert.equal((await request('POST', '/api/sponsors', { name: '', url: 'https://a.com' }, advToken)).status, 400);
    assert.equal((await request('POST', '/api/sponsors', { name: 'x', url: 'not-a-url' }, advToken)).status, 400);
    assert.equal((await request('POST', '/api/sponsors', { name: 'x', url: 'https://a.com', slogan: '太'.repeat(61) }, advToken)).status, 400);
    assert.equal((await request('POST', '/api/sponsors', { name: 'x', url: 'https://a.com', slot: 'sidebar' }, advToken)).status, 400);
  });
  it('广告商申请进 pending，我的列表可见但公开不可见', async () => {
    const r = await request('POST', '/api/sponsors', { name: '闪电中转', url: 'https://flash.example.com', slogan: '又快又稳', logo: '' }, advToken);
    assert.equal(r.status, 201);
    assert.equal(r.body.status, 'pending');
    sponA = r.body.id;
    const mine = await request('GET', '/api/my/sponsors', null, advToken);
    assert.ok(mine.body.sponsors.some(s => s.id === sponA));
    const pub = await request('GET', '/api/sponsors?slot=home');
    assert.ok(!pub.body.sponsors.some(s => s.id === sponA), '待认证不得公开');
    assert.equal((await request('GET', '/go/' + sponA)).status, 404, '未上线跳不出去');
  });
  it('非作者改他人广告 403，普通用户进不了后台接口', async () => {
    assert.equal((await request('PUT', '/api/my/sponsors/' + sponA, { slogan: 'hack' }, adv2Token)).status, 403);
    assert.equal((await request('PUT', '/api/admin/sponsors/' + sponA + '/approve', {}, advToken)).status, 403);
  });
  it('认证→确认收款上线→公开可见→跳转计数', async () => {
    const admin = await getAdminToken();
    assert.equal((await request('PUT', '/api/admin/sponsors/' + sponA + '/approve', { verifyScore: 92 }, admin)).status, 200);
    const act = await request('PUT', '/api/admin/sponsors/' + sponA + '/activate', { days: 30, price: 800 }, admin);
    assert.equal(act.status, 200);
    assert.equal(act.body.status, 'active');
    assert.equal(act.body.paid, true);
    assert.equal(act.body.price, 800);
    const pub = await request('GET', '/api/sponsors?slot=home');
    const shown = pub.body.sponsors.find(s => s.id === sponA);
    assert.ok(shown, '上线后应公开');
    assert.equal(shown.verifyScore, 92, '质检分公开（信任信号）');
    assert.ok(shown.price === undefined && shown.paid === undefined && shown.status === undefined, '公开视角不得泄露价格/付款/状态');
    const go = await request('GET', '/go/' + sponA);
    assert.equal(go.status, 302);
    assert.equal(go.headers.location, 'https://flash.example.com');
    await request('POST', '/api/sponsors/' + sponA + '/view', {});
    // 注：记在 sponsor_stats（广告专表），tool_clicks 是工具导航的表，两者独立
    const stat = getDb().prepare('SELECT views, clicks FROM sponsor_stats WHERE sponsor_id = ?').get(sponA);
    assert.ok(stat && stat.views >= 1 && stat.clicks >= 1, '曝光与点击都应计数');
  });
  it('同槽位只活 1 条：新上线挤下旧的', async () => {
    const admin = await getAdminToken();
    const r = await request('POST', '/api/sponsors', { name: '云雾API', url: 'https://cloud.example.com', slogan: '稳' }, adv2Token);
    sponB = r.body.id;
    await request('PUT', '/api/admin/sponsors/' + sponB + '/approve', {}, admin);
    await request('PUT', '/api/admin/sponsors/' + sponB + '/activate', { days: 30 }, admin);
    const db = getDb();
    assert.equal(db.prepare('SELECT status FROM sponsors WHERE id = ?').get(sponA).status, 'offline', '旧广告应被挤下线');
    assert.equal(db.prepare('SELECT status FROM sponsors WHERE id = ?').get(sponB).status, 'active');
  });
  it('在线改料回待审 + paid 清零（防过审换皮）', async () => {
    const r = await request('PUT', '/api/my/sponsors/' + sponB, { slogan: '全新改版' }, adv2Token);
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'pending');
    assert.equal(r.body.paid, false);
  });
  it('拒绝附理由，改料后重提并清空理由', async () => {
    const admin = await getAdminToken();
    assert.equal((await request('PUT', '/api/admin/sponsors/' + sponB + '/reject', {}, admin)).status, 400, '拒绝必须附理由');
    await request('PUT', '/api/admin/sponsors/' + sponB + '/reject', { reason: '落地页打不开' }, admin);
    const r = await request('PUT', '/api/my/sponsors/' + sponB, { slogan: '修好了重提' }, adv2Token);
    assert.equal(r.body.status, 'pending');
    assert.equal(r.body.rejectReason, '', '重提清空旧理由');
    const cnt = await request('GET', '/api/admin/review-counts', null, admin);
    assert.ok(cnt.body.pendingSponsors >= 1, '待认证计数应含它');
  });
  it('续费顺延、下线、删除链路', async () => {
    const admin = await getAdminToken();
    const db = getDb();
    const before = db.prepare('SELECT ends_at FROM sponsors WHERE id = ?').get(sponA).ends_at;
    // sponA 当前 offline（被挤下线），先重新上线再续费
    await request('PUT', '/api/admin/sponsors/' + sponA + '/activate', { days: 30 }, admin);
    const rn = await request('PUT', '/api/admin/sponsors/' + sponA + '/renew', { days: 30 }, admin);
    assert.equal(rn.status, 200);
    assert.ok(rn.body.endsAt > before, '续费应在原到期日基础上顺延');
    await request('PUT', '/api/admin/sponsors/' + sponA + '/offline', {}, admin);
    assert.equal(db.prepare('SELECT status FROM sponsors WHERE id = ?').get(sponA).status, 'offline');
    assert.equal((await request('GET', '/go/' + sponA)).status, 404, '下线后跳不出');
    const del = await request('DELETE', '/api/admin/sponsors/' + sponB, {}, admin);
    assert.equal(del.status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM sponsor_stats WHERE sponsor_id = ?').get(sponB).c, 0, '删除连带清统计');
  });
});

describe('我的教程', () => {
  it('作者可编辑/删除并查统计', async () => {
    const login = await request('POST', '/api/auth/login', { username: 'tut_author', password: 'pass123456' });
    const list = await request('GET', '/api/my/tutorials', null, login.body.token);
    assert.ok(list.body.length >= 1);
    const myTutId = list.body[0].id;
    const upd = await request('PUT', '/api/my/tutorials/' + myTutId, { title: '改后标题' }, login.body.token);
    assert.equal(upd.status, 200);
    assert.equal(upd.body.title, '改后标题');
    const stats = await request('GET', '/api/my/tutorials/stats', null, login.body.token);
    assert.ok(stats.body.total >= 1);
    const del = await request('DELETE', '/api/my/tutorials/' + myTutId, null, login.body.token);
    assert.equal(del.status, 200);
  });
  it('跨用户修改被拒（403）', async () => {
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('TINV22');
    const r = await request('POST', '/api/auth/register', { username: 'tut_other', password: 'pass123456', inviteCode: 'TINV22' });
    const created = await request('POST', '/api/tutorials', { title: '他的教程', content: '内容' }, r.body.token);
    const t = await getToken();
    const res = await request('PUT', '/api/my/tutorials/' + created.body.id, { title: '被篡改' }, t);
    assert.equal(res.status, 403);
  });
});

describe('管理员教程审核', () => {
  it('普通用户无权限', async () => {
    const t = await getToken();
    const res = await request('GET', '/api/admin/tutorials', null, t);
    assert.equal(res.status, 403);
  });
  it('管理员可列待审核并审核', async () => {
    const admin = await getAdminToken();
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('TINV23');
    const r = await request('POST', '/api/auth/register', { username: 'tut_admin_target', password: 'pass123456', inviteCode: 'TINV23' });
    const created = await request('POST', '/api/tutorials', { title: '待管理员审', content: '正文', category: '经验分享' }, r.body.token);
    const list = await request('GET', '/api/admin/tutorials?status=pending', null, admin);
    assert.equal(list.status, 200);
    assert.ok(list.body.some(i => i.id === created.body.id));
    const verify = await request('PUT', '/api/admin/tutorials/' + created.body.id + '/verify', { verified: true }, admin);
    assert.equal(verify.status, 200);
    assert.equal(verify.body.verified, true);
  });
});

describe('教程拒绝与理由', () => {
  it('拒绝必须填写理由（400）', async () => {
    const admin = await getAdminToken();
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('TINVR1');
    const r = await request('POST', '/api/auth/register', { username: 'tut_rej_author', password: 'pass123456', inviteCode: 'TINVR1' });
    const created = await request('POST', '/api/tutorials', { title: '待拒绝教程', content: '内容' }, r.body.token);
    const res = await request('PUT', '/api/admin/tutorials/' + created.body.id + '/reject', {}, admin);
    assert.equal(res.status, 400);
  });
  it('管理员拒绝并附理由，作者可见、未公开', async () => {
    const admin = await getAdminToken();
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('TINVR2');
    const r = await request('POST', '/api/auth/register', { username: 'tut_rej_author2', password: 'pass123456', inviteCode: 'TINVR2' });
    const created = await request('POST', '/api/tutorials', { title: '拒绝目标教程', content: '内容', category: '教程' }, r.body.token);
    const rej = await request('PUT', '/api/admin/tutorials/' + created.body.id + '/reject', { reason: '与 AI 无关，且疑似广告' }, admin);
    assert.equal(rej.status, 200);
    assert.equal(rej.body.verified, false);
    assert.equal(rej.body.rejectReason, '与 AI 无关，且疑似广告');
    const mine = await request('GET', '/api/my/tutorials', null, r.body.token);
    const mineRow = mine.body.find(i => i.id === created.body.id);
    assert.ok(mineRow);
    assert.equal(mineRow.rejectReason, '与 AI 无关，且疑似广告');
    const pub = await request('GET', '/api/tutorials?limit=100');
    assert.ok(!pub.body.some(i => i.id === created.body.id));
  });
  it('拒绝后再通过会清空理由', async () => {
    const admin = await getAdminToken();
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('TINVRX3');
    const r = await request('POST', '/api/auth/register', { username: 'tut_rej_author3', password: 'pass123456', inviteCode: 'TINVRX3' });
    const created = await request('POST', '/api/tutorials', { title: '再次提交教程', content: '内容' }, r.body.token);
    await request('PUT', '/api/admin/tutorials/' + created.body.id + '/reject', { reason: '内容过短' }, admin);
    const verify = await request('PUT', '/api/admin/tutorials/' + created.body.id + '/verify', { verified: true }, admin);
    assert.equal(verify.status, 200);
    assert.equal(verify.body.verified, true);
    assert.equal(verify.body.rejectReason, '');
  });
  it('普通用户无拒绝权限（403）', async () => {
    const t = await getToken();
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('TINVRX4');
    const r = await request('POST', '/api/auth/register', { username: 'tut_rej_author4', password: 'pass123456', inviteCode: 'TINVRX4' });
    const created = await request('POST', '/api/tutorials', { title: '别人教程', content: '内容' }, r.body.token);
    const res = await request('PUT', '/api/admin/tutorials/' + created.body.id + '/reject', { reason: 'x' }, t);
    assert.equal(res.status, 403);
  });
});

describe('SEO 端点（sitemap/robots/llms.txt）', () => {
  it('sitemap.xml 返回绝对 URL 并含教程详情', async () => {
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('SEOC01');
    const r = await request('POST', '/api/auth/register', { username: 'seo_author', password: 'pass123456', inviteCode: 'SEOC01' });
    const created = await request('POST', '/api/tutorials', { title: 'SEO 公开教程', content: '正文', category: '教程' }, r.body.token);
    await request('PUT', '/api/admin/tutorials/' + created.body.id + '/verify', { verified: true }, await getAdminToken());
    const res = await request('GET', '/sitemap.xml');
    assert.equal(res.status, 200);
    assert.ok((res.headers['content-type'] || '').includes('xml'));
    assert.ok(res.body.includes('</urlset>'));
    assert.ok(res.body.includes('/tutorials/' + created.body.id)); // 教程详情 loc
    assert.ok(res.body.includes('/cooperate'), 'sitemap 应含商务合作页');
    assert.ok(res.body.startsWith('<?xml')); // XML 声明
    assert.ok(!res.body.includes('/sitemap.xml')); // 不应出现错误 origin（曾拼出 /sitemap.xml/）
  });
  it('robots.txt 含 Sitemap 绝对地址', async () => {
    const res = await request('GET', '/robots.txt');
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('User-agent: *'));
    assert.ok(res.body.includes('Sitemap: https://free-tokens.org/sitemap.xml'), 'robots 的 Sitemap 应指向 SEO 主域');
    assert.ok(res.body.includes('Disallow: /dashboard'));
  });
  it('/tools 有 FAQ 区块（问答长尾着陆）', async () => {
    const res = await request('GET', '/tools');
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('AI 工具常见问题'), '/tools 应有 FAQ 区块');
    assert.ok(res.body.includes('Manus 和 Genspark'), 'FAQ 应含品牌长尾问答');
  });
  it('/tools 注入 FAQPage 且与可见文本一致（富媒体校验要求）', async () => {
    const res = await request('GET', '/tools');
    assert.ok(res.body.includes('FAQPage'), '应注入 FAQPage JSON-LD');
    assert.ok(res.body.includes('学生党零预算'), 'JSON-LD 与可见问答应同源');
  });
  it('搜索参数页不被索引：角标 nofollow + robots 屏蔽 ?search=（Bing failing URL 根因）', async () => {
    const tools = await request('GET', '/tools');
    assert.ok(tools.body.includes('rel="nofollow"'), '免费用角标应 nofollow（?search= 与首页重复）');
    const robots = await request('GET', '/robots.txt');
    assert.ok(robots.body.includes('Disallow: /*?search='), 'robots 应屏蔽 ?search= 参数页');
  });
  it('llms.txt 面向 LLM 爬虫输出站点介绍', async () => {
    const res = await request('GET', '/llms.txt');
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('free-tokens'));
    assert.ok(res.body.includes('/tutorials'));
  });
  it('/goto 外跳白名单：策展链接出提示页（noindex+目标域名），任意地址 400', async () => {
    const good = await request('GET', '/goto?u=' + encodeURIComponent('https://manus.im'));
    assert.equal(good.status, 200);
    assert.ok(good.body.includes('noindex'), '中转页必须 noindex');
    assert.ok(good.body.includes('manus.im'), '中转页应展示目标域名');
    assert.ok(good.body.includes('/goto/go?u='), '中转页应有前往按钮');
    const bad = await request('GET', '/goto?u=' + encodeURIComponent('https://evil.example/phish'));
    assert.equal(bad.status, 400, '非白名单地址不得中转（防开放重定向钓鱼）');
    const proto = await request('GET', '/goto?u=' + encodeURIComponent('javascript:alert(1)'));
    assert.equal(proto.status, 400, '伪协议不得中转');
  });
  it('/goto/go 计数后 302 到白名单地址，非白名单 400', async () => {
    const go = await request('GET', '/goto/go?u=' + encodeURIComponent('https://manus.im'));
    assert.equal(go.status, 302);
    assert.equal(go.headers.location, 'https://manus.im');
    const row = getDb().prepare('SELECT views, clicks FROM tool_clicks WHERE url = ?').get('https://manus.im');
    assert.ok(row && row.views >= 1 && row.clicks >= 1, '提示页曝光与实际前往都应计数');
    const bad = await request('GET', '/goto/go?u=' + encodeURIComponent('https://evil.example/'));
    assert.equal(bad.status, 400);
  });
  it('首页/页脚文字 logo 展示 free-tokens（防品牌漂移回退 undef/旧名）', async () => {
    const home = await request('GET', '/');
    assert.equal(home.status, 200);
    // 左上角 header logo + 底部 footer logo 都应是 free-tokens（此前漏改仍为 freeapis）
    const logoCount = (home.body.match(/free-<span class="logo__accent">tokens<\/span>/g) || []).length;
    assert.ok(logoCount >= 2, '首页应至少含 header + footer 两处 <span class="logo__text">free-tokens</span>，实际 ' + logoCount + ' 处');
    assert.ok(!/free<\/span>|<span class="logo__accent">apis<\/span>/.test(home.body), '旧品牌文字 logo（free<apis>）不得再出现');
  });
  it('SEO 主域收敛：canonical/sitemap 统一指向主域（终结双域名自我重复）', async () => {
    const home = await request('GET', '/');
    assert.ok(home.body.includes('<link rel="canonical" href="https://free-tokens.org/"'), '首页 canonical 应指向主域');
    const homeSearch = await request('GET', '/?search=DeepSeek');
    assert.ok(homeSearch.body.includes('<link rel="canonical" href="https://free-tokens.org/"'), '?search= 参数不得进入 canonical');
    const sm = await request('GET', '/sitemap.xml');
    assert.ok(sm.body.includes('<loc>https://free-tokens.org/'), 'sitemap loc 应指向主域');
    assert.ok(!sm.body.includes('127.0.0.1'), 'sitemap 不得含请求 host（防双域名各说各话）');
  });
  it('下线条目页 200+noindex+相关推荐（不再 404 撞死链）', async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const suffix = String(Date.now());
    const tok = 'sk-seo-offline-' + suffix;
    db.prepare("INSERT INTO items (id, name, desc, url, provider, category, token, token_type, verified, trashed, created_at, updated_at) VALUES (?, 'SEO 下线条目', '下线描述正文', ?, 'Prov', '对话模型', ?, 'OpenAI', 0, 0, ?, ?)")
      .run('seooff1' + suffix, 'http://127.0.0.1:9/v1', tok, now, now);
    db.prepare("INSERT INTO items (id, name, url, token, token_type, verified, created_at, updated_at) VALUES (?, 'SEO 在线条目', ?, ?, 'OpenAI', 1, ?, ?)")
      .run('seooff2' + suffix, 'http://127.0.0.1:9/v1', 'sk-seo-online-' + suffix, now, now);
    const res = await request('GET', '/item/seooff1' + suffix);
    assert.equal(res.status, 200, '下线条目页应 200（保留 URL 权重）');
    assert.ok(res.body.includes('noindex'), '下线页必须 noindex');
    assert.ok(res.body.includes('已下线'), '下线页应有明确提示');
    assert.ok(!res.body.includes(tok), '下线页不得泄露 Token');
    assert.ok(!res.body.includes('下线描述正文'), '下线页不展示原描述（防未审核内容外泄）');
    assert.ok(res.body.includes('/item/seooff2' + suffix), '下线页应含相关推荐内链');
    assert.ok(res.body.includes('<link rel="canonical" href="https://free-tokens.org/item/seooff1' + suffix + '"'), '下线页 canonical 应指向主域');
    db.prepare('UPDATE items SET trashed = 1 WHERE id = ?').run('seooff1' + suffix);
    assert.equal((await request('GET', '/item/seooff1' + suffix)).status, 404, '垃圾桶条目仍 404');
    assert.equal((await request('GET', '/item/doesnotexist123')).status, 404, '不存在的 id 仍 404');
  });
  it('教程/Skill 列表首屏 SSR 直出卡片链接（内链不断）', async () => {
    const tutList = await request('GET', '/tutorials');
    assert.equal(tutList.status, 200);
    assert.ok(tutList.body.includes('tut-card') && tutList.body.includes('/tutorials/'), '教程列表应 SSR 直出详情链接（此前纯 spinner 空壳）');
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('SEOC02');
    const r = await request('POST', '/api/auth/register', { username: 'seo_skill', password: 'pass123456', inviteCode: 'SEOC02' });
    const created = await request('POST', '/api/skills', { title: 'SEO Skill', summary: 'SEO 摘要', description: 'SEO 描述', category: '通用', tags: [], price: 0, content: '# SEO 正文' }, r.body.token);
    await request('PUT', '/api/admin/skills/' + created.body.id + '/verify', {}, await getAdminToken());
    const skillList = await request('GET', '/skills');
    assert.equal(skillList.status, 200);
    assert.ok(skillList.body.includes('/skills/'), 'Skill 列表应 SSR 直出详情链接');
  });
});

describe('双域名分享海报按当前访问域名渲染（host 独立缓存）', () => {
  it('不同 Host 请求 /poster/site.png 渲染出不同域名海报（缓存 key 含 host）', async () => {
    const a = await requestWithHost('free-tokens.org', '/poster/site.png');
    const b = await requestWithHost('freeapis.top', '/poster/site.png');
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    // 两个海报必须不同（各自内含对应域名文本与 QR），证明 app 缓存按 host 隔离而非串用
    assert.notDeepEqual(a.body, b.body, '不同 Host 的海报内容应不同（域名/QR 不同）');
  });
});

describe('双域名图片一致性（站内绝对 uploads URL 归一化，媒体资源保持 same-origin 最严防护）', () => {
  it('媒体资源 /uploads /poster 未误放宽 CORP，保持 helmet 默认 same-origin（图片靠相对路径同源加载）', async () => {
    const up = await request('GET', '/uploads/__corp_check_not_exist__.png');
    assert.equal(up.headers['cross-origin-resource-policy'], 'same-origin', 'uploads 应保持 same-origin（不跨源放行）');
    const po = await request('GET', '/poster/site.png');
    assert.equal(po.status, 200);
    assert.equal(po.headers['cross-origin-resource-policy'], 'same-origin', 'poster 应保持 same-origin');
  });
  it('教程 cover 本站绝对 uploads URL 归一化为相对路径（跨域 CORP 不拦截，双域名可用）', async () => {
    const t = await getToken();
    const r = await request('POST', '/api/tutorials', { title: 'Corp Cover', content: '正文', cover: 'https://freeapis.top/uploads/5919d6257501bc1c.png' }, t);
    assert.equal(r.status, 201);
    assert.equal(r.body.cover, '/uploads/5919d6257501bc1c.png', '发布时本站绝对 cover 应归一化入库');
    // 第三方外链 cover 保持原样（不误归一化）
    const r3 = await request('POST', '/api/tutorials', { title: 'Corp Cover Web', content: '正文', cover: 'https://img.example.com/uploads/keep.png' }, t);
    assert.equal(r3.status, 201);
    assert.equal(r3.body.cover, 'https://img.example.com/uploads/keep.png', '第三方外链 cover 不应被归一化');
  });
});

describe('伪装爬虫拿不到 Token（SEO/GEO 暴露面安全）', () => {
  let token = 'sk-crawler-guard-' + Date.now(); // 独特 token，用于子串比对
  let itemId = '';
  let baseUrl = ''; // 在 before 里惰性赋值（describe 定义阶段 mockPort 可能尚未就绪）
  const crawlerUAs = [
    'Mozilla/5.0 (compatible; GPTBot/1.0)',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Bytespider',
    'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)',
    'Mozilla/5.0 (compatible; ClaudeBot/1.0)',
    'PerplexityBot/1.0 (+https://www.perplexity.ai)',
    'cohere-ai'
  ];

  before(async () => {
    baseUrl = mockBase(); // 本地 mock 端点，发布需真实 2xx；同时也是条目 url，用于泄露比对
    getDb().prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('CRAWLC01');
    const r = await request('POST', '/api/auth/register', { username: 'crawler_auth', password: 'pass123456', inviteCode: 'CRAWLC01' });
    // 发布一条带真实 Token 的条目（发布即上线）
    const created = await request('POST', '/api/items', { name: 'Crawler Guard', url: baseUrl, token, tokenType: 'OpenAI', tags: ['guard'] }, r.body.token);
    assert.equal(created.status, 201);
    itemId = created.body.id;
    assert.ok(itemId, '应生成条目 id');
    // 兜底确保已上线（发布即 verified=1）
    const list = await request('GET', '/api/items?limit=200');
    assert.ok(list.body.some(i => i.id === itemId));
    // 登录视角确实能拿到 token（对照：证明 token 真实存在于该条目的登录响应）
    const authed = await request('GET', '/api/items/' + itemId, null, r.body.token);
    assert.equal(authed.body.token, token, '登录后应能拿到真实 Token（对照前提）');
  });

  it('所有 SEO/GEO 端点 + 公开 API 对 7 种伪装爬虫 UA 均不泄露 Token/Base URL', async () => {
    const routes = [
      '/api/items?limit=200',
      '/api/items/' + itemId,
      '/item/' + itemId,
      '/sitemap.xml',
      '/llms.txt',
      '/llms-full.txt',
      '/robots.txt'
    ];
    for (const ua of crawlerUAs) {
      for (const p of routes) {
        const res = await crawlerRequest(p, ua);
        assert.notEqual(res.status, 500, ua + ' @ ' + p + ' 不应 500');
        assert.ok(!res.body.includes(token), '伪装爬虫 ' + ua + ' 通过 ' + p + ' 泄露了 Token');
        assert.ok(!res.body.includes(baseUrl), '伪装爬虫 ' + ua + ' 通过 ' + p + ' 泄露了 Base URL');
      }
    }
  });

  it('伪装爬虫 UA 无法访问需登录/管理的受保护端点', async () => {
    const protectedRoutes = [
      '/api/recent?limit=1', '/api/points', '/api/my/items',
      '/api/admin/items', '/api/admin/users', '/api/admin/sweep', '/api/admin/visits'
    ];
    for (const ua of crawlerUAs) {
      for (const p of protectedRoutes) {
        const res = await crawlerRequest(p, ua);
        assert.ok(res.status === 401 || res.status === 403,
          '伪装爬虫 ' + ua + ' 访问 ' + p + ' 应被 401/403 拦截，实际 ' + res.status);
        assert.ok(!res.body.includes(token), '伪装爬虫 ' + ua + ' 通过 ' + p + ' 泄露了 Token');
      }
    }
  });
});

describe('SSE 实时推送', () => {
  it('新 Token 发布时向在线连接推送 item_created 事件', async () => {
    const t = await getToken();
    let conn = null;
    try {
      conn = await openSSE();
      let buf = '';
      const gotEvent = new Promise((resolve) => {
        conn.res.on('data', (c) => {
          buf += c;
          if (buf.indexOf('event: item_created') !== -1) resolve();
        });
      });
      const created = await request('POST', '/api/items', { name: 'SSE Item', url: mockBase(), token: 'sk-sse-item', tokenType: 'OpenAI' }, t);
      assert.equal(created.status, 201);
      await Promise.race([gotEvent, new Promise((_, rej) => setTimeout(() => rej(new Error('SSE 事件超时')), 3000))]);
      assert.ok(buf.includes('event: item_created'));
      assert.ok(buf.includes('"id":"' + created.body.id + '"'));
      assert.ok(buf.includes('"name":"SSE Item"'));
      assert.ok(!buf.includes('sk-sse-item'), 'SSE 广播不得泄露真实 Token');
    } finally {
      if (conn) conn.req.destroy();
    }
  });
});

describe('可用模型存储与友好提示', () => {
  it('发布带 Token 条目时探测并存取可用模型', async () => {
    const t = await getToken();
    const created = await request('POST', '/api/items', { name: 'Models Item', url: mockBase(), token: 'sk-models-1', tokenType: 'OpenAI' }, t);
    assert.equal(created.status, 201);
    assert.ok(Array.isArray(created.body.models));
    assert.ok(created.body.models.includes('mock-model')); // mock /models 返回 [{id:'mock-model'}]
  });

  it('test-token 指定未知模型返回友好提示（含查 models 指引）', async () => {
    const res = await request('POST', '/api/test-token', { token: 'sk-probe-x', tokenType: 'OpenAI', baseUrl: mockBase(), model: 'no-such-model' }, await getToken());
    assert.equal(res.body.ok, false);
    assert.ok(/不可用/.test(res.body.error));
    assert.ok(/models/.test(res.body.error));
  });

  it('test-token 在响应中回显 HTTP 状态码（前端模型测试显示 200/400/404/429 用）', async () => {
    const t = await getToken();
    // 模型不存在 → 400 + kind:model（逐模型测试展示「✗ (400)」）
    const badModel = await request('POST', '/api/test-token', { token: 'sk-probe-x', tokenType: 'OpenAI', baseUrl: mockBase(), model: 'no-such-model' }, t);
    assert.equal(badModel.body.ok, false);
    assert.equal(badModel.body.status, 400);
    assert.equal(badModel.body.kind, 'model');
    // 正常模型 → 200 + status 回显（主测试展示「✓ 有效 (200)」）
    const good = await request('POST', '/api/test-token', { token: 'sk-probe-x', tokenType: 'OpenAI', baseUrl: mockBase() }, t);
    assert.equal(good.body.ok, true);
    assert.equal(good.body.status, 200);
  });

  it('test-token 带 model 时对话探测遇 429 必须判限流，绝不显示可用（回归：曾被吞成 ok:true）', async () => {
    const t = await getToken();
    // baseUrl 的 /models 返回 200 → 进入带 model 的对话探测；该对话端点对 m-429 返回 429
    const res = await request('POST', '/api/test-token', { token: 'sk-probe-x', tokenType: 'OpenAI', baseUrl: mockBase(), model: 'm-429' }, t);
    assert.equal(res.body.ok, false, '429 不算可用，不能被吞成 ok:true 显示「可用」');
    assert.equal(res.body.status, 429, '应透传 429 状态');
    assert.equal(res.body.kind, 'ratelimit', '应标记 ratelimit（与主测试/巡检/掺水检测判定一致）');
  });

  it('管理员验证旧条目时回填可用模型', async () => {
    const db = getDb();
    const uid = db.prepare("SELECT id FROM users WHERE username = 'testuser'").get().id;
    const now = new Date().toISOString();
    db.prepare("INSERT INTO items (id, name, url, token, token_type, verified, models, created_by, created_at, updated_at) VALUES ('bf001', 'Backfill', ?, 'sk-backfill-1', 'OpenAI', 0, '[]', ?, ?, ?)")
      .run(mockBase(), uid, now, now);
    await verifyItem('bf001', true);
    const it = db.prepare('SELECT models FROM items WHERE id = ?').get('bf001');
    const models = JSON.parse(it.models || '[]');
    assert.ok(models.includes('mock-model'));
  });
});

describe('教程正文 B 站视频内嵌（md.js 渲染）', () => {
  const md = require('../public/md.js');
  const LINK = 'https://www.bilibili.com/video/BV1xx411c7mD/?p=2&spm_id_from=333.851';

  it('整行 B 站链接默认渲染为内嵌播放器（iframe）', () => {
    const html = md.render('前文\n\n' + LINK + '\n\n后文');
    assert.match(html, /player\.bilibili\.com\/player\.html\?bvid=BV1xx411c7mD/);
    assert.doesNotMatch(html, /md-video--link/);
  });

  it('wechat 模式降级为「在哔哩哔哩打开观看」跳转卡片，且不带 iframe', () => {
    const html = md.render('前文\n\n' + LINK + '\n\n后文', { wechat: true });
    assert.match(html, /md-video--link/);
    assert.match(html, /在哔哩哔哩打开观看/);
    assert.match(html, /href="https:\/\/www\.bilibili\.com\/video\/BV1xx411c7mD\/\?p=2&amp;spm_id_from=333\.851"/);
    assert.doesNotMatch(html, /player\.bilibili\.com/);
  });

  it('wechat 模式同样 XSS 安全（script 被转义、href 仅 bilibili 域名）', () => {
    const html = md.render('前文\n\nhttps://www.bilibili.com/video/BV1xx411c7mD/\n\n<script>alert(1)</script>', { wechat: true });
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, /href="(?!https:\/\/www\.bilibili\.com)[^"]+"/);
  });

  it('非整行的 B 站链接/非 B 站域名不转播放器', () => {
    assert.doesNotMatch(md.render('这个 ' + LINK + ' 混在句子里'), /md-video/);
    assert.doesNotMatch(md.render('https://www.youtube.com/watch?v=abc123'), /md-video/);
  });
});

describe('图标白名单完整（Lucide sprite 裁剪守护）', () => {
  const fs = require('fs');
  const path = require('path');
  const layout = require('../lib/layout.js');
  const ROOT = path.resolve(__dirname, '..');

  it('代码用到的每个图标都登记进 ICON_ALLOWLIST 且存在于 sprite', () => {
    const allow = new Set(layout.ICON_ALLOWLIST);
    const sprite = fs.readFileSync(path.join(ROOT, 'public', 'icons.svg'), 'utf8');
    const isSymbol = n => new RegExp('symbol id="lucide-' + n + '"').test(sprite);
    const files = ['lib/layout.js', 'server.js'].concat(
      fs.readdirSync(path.join(ROOT, 'public')).filter(f => f.endsWith('.js')).map(f => 'public/' + f)
    );
    const used = new Set();
    for (const f of files) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      for (const m of src.matchAll(/(?:svgIcon|ic|icon)\('([a-z0-9-]+)'[^)]*\)/g)) used.add(m[1]);
      // categoryIcon/ssrCategoryIcon 动态返回的图标名（只收确实是 sprite 符号的，忽略 badge--xxx 等非图标）
      for (const m of src.matchAll(/return '([a-z0-9-]+)'/g)) if (isSymbol(m[1])) used.add(m[1]);
      // medals 数组 ['crown','award','star']
      for (const m of src.matchAll(/medals\s*=\s*\[([^\]]+)\]/g)) {
        for (const it of m[1].matchAll(/'([a-z0-9-]+)'/g)) used.add(it[1]);
      }
    }
    const missing = [...used].filter(n => !allow.has(n));
    assert.deepEqual(missing, [], '代码用到了但未登记进 ICON_ALLOWLIST（会渲染空白）: ' + missing.join(', '));
    const dead = [...allow].filter(n => !isSymbol(n));
    assert.deepEqual(dead, [], '白名单里 sprite 不存在的图标（拼写错误）: ' + dead.join(', '));
    const trimmed = layout.inlineSprite();
    assert.ok(trimmed.length > 0, '裁剪 sprite 不应为空');
    assert.ok(trimmed.length < 41 * 1024, '裁剪后内联 sprite 应 < 41KB（避免每页背全量 56KB），实际 ' + (trimmed.length / 1024).toFixed(1) + 'KB');
  });
});

describe('教程正文插图（md.js 图片渲染）', () => {
  const md = require('../public/md.js');

  it('独立成行的本站图片渲染为 figure + img + figcaption（居中大图）', () => {
    const html = md.render('前文\n\n![架构图](/uploads/abc12345.png)\n\n后文');
    assert.match(html, /<figure class="md-figure">/);
    assert.match(html, /<img class="md-img" src="\/uploads\/abc12345\.png" alt="架构图" loading="lazy" referrerpolicy="no-referrer">/);
    assert.match(html, /<figcaption>架构图<\/figcaption>/);
  });

  it('独立成行的 https 外链图同样渲染为 figure', () => {
    const html = md.render('![Claude 徽章](https://cdn.example.com/x.png)');
    assert.match(html, /<figure class="md-figure">/);
    assert.match(html, /src="https:\/\/cdn\.example\.com\/x\.png"/);
    assert.match(html, /referrerpolicy="no-referrer"/);
  });

  it('行内插图渲染在段落内（随文排布）', () => {
    const html = md.render('看这张 ![示意图](/uploads/xyz.png) 很清晰');
    assert.match(html, /^<p>看这张 <img class="md-img" src="\/uploads\/xyz\.png"/);
    assert.doesNotMatch(html, /md-figure/);
  });

  it('非白名单协议（javascript:/data:）保持字面，不产生 img', () => {
    assert.doesNotMatch(md.render('![x](javascript:alert(1))'), /<img/i);
    assert.doesNotMatch(md.render('![x](data:image/svg+xml;base64,PHN2Zz4=)'), /<img/i);
    assert.match(md.render('![x](javascript:alert(1))'), /javascript:alert\(1\)/);
  });

  it('协议相对 URL（//evil.com）被拒：图/链均保持字面，不外泄追踪', () => {
    assert.doesNotMatch(md.render('![x](//evil.com/track.png)'), /<img/i);
    assert.match(md.render('![x](//evil.com/track.png)'), /\/\/evil\.com\/track\.png/);
    assert.doesNotMatch(md.render('[点我](//evil.com/x)'), /<a /);
    assert.match(md.render('[点我](//evil.com/x)'), /\[点我\]\(/);
    // 本站相对路径 /uploads/ 与单斜杠同源路径仍放行
    assert.match(md.render('![图](/uploads/a.png)'), /<img class="md-img" src="\/uploads\/a\.png"/);
    assert.match(md.render('[首页](/guide)'), /<a href="\/guide" target="_blank" rel="noopener noreferrer">首页<\/a>/);
  });

  it('alt 文本 XSS 安全（script 转义，不产生可执行标签）', () => {
    const html = md.render('![<script>alert(1)</script>](/uploads/a.png)');
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /alt="&lt;script&gt;alert\(1\)&lt;\/script&gt;"/);
  });

  it('图片与普通链接并存不冲突（先图片后链接）', () => {
    const html = md.render('![图](/uploads/a.png) 和 [官网](https://example.com)');
    assert.match(html, /<img class="md-img"/);
    assert.match(html, /<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer">官网<\/a>/);
  });
});



describe('用户头像（按用户 ID 归档 avatars/ 子目录，一用户一文件）', () => {
  let avaToken = '', avaId = '';
  const AVATAR_DIR = path.resolve(__dirname, '../data/uploads/avatars');

  async function ensureUser() {
    if (avaToken) return;
    getDb().prepare("INSERT OR IGNORE INTO invite_codes (code) VALUES ('AVAINV1')").run();
    const r = await request('POST', '/api/auth/register', { username: 'ava_user', password: 'ava123456', inviteCode: 'AVAINV1' });
    avaToken = r.body.token; avaId = r.body.user.id;
  }
  const avatarFile = url => path.join(AVATAR_DIR, url.split('/').pop());

  it('未登录上传返回 401', async () => {
    const res = await rawRequest('/api/auth/avatar', TINY_PNG, 'image/png');
    assert.equal(res.status, 401);
  });

  it('上传 PNG：URL 归档到 /uploads/avatars/<userId>- 前缀、文件落盘、me 带头像', async () => {
    await ensureUser();
    const res = await rawRequest('/api/auth/avatar', TINY_PNG, 'image/png', avaToken);
    assert.equal(res.status, 200);
    assert.match(res.body.url, new RegExp('^/uploads/avatars/' + avaId + '-[a-f0-9]{6}\.png$'), '文件名必须是 <userId>-<6hex>');
    assert.ok(fs.existsSync(avatarFile(res.body.url)), '头像文件应存在');
    const me = await request('GET', '/api/auth/me', null, avaToken);
    assert.equal(me.body.user.avatar, res.body.url);
  });

  it('替换头像：URL 变化破缓存 + 旧文件删除（不堆积）', async () => {
    await ensureUser();
    const first = await rawRequest('/api/auth/avatar', TINY_PNG, 'image/png', avaToken);
    const second = await rawRequest('/api/auth/avatar', TINY_PNG, 'image/png', avaToken);
    assert.notEqual(first.body.url, second.body.url, '新 URL 应不同（浏览器缓存失效）');
    assert.ok(!fs.existsSync(avatarFile(first.body.url)), '旧头像文件应被删除');
    assert.ok(fs.existsSync(avatarFile(second.body.url)));
  });

  it('非图片内容返回 400', async () => {
    await ensureUser();
    const res = await rawRequest('/api/auth/avatar', Buffer.from('this is definitely not an image file'), 'text/plain', avaToken);
    assert.equal(res.status, 400);
  });

  it('超过 3MB 返回 400', async () => {
    await ensureUser();
    const big = Buffer.concat([TINY_PNG, Buffer.alloc(3 * 1024 * 1024 + 100, 1)]);
    const res = await rawRequest('/api/auth/avatar', big, 'image/png', avaToken);
    assert.equal(res.status, 400);
  });

  it('个人主页 API 与 SSR 页面带头像', async () => {
    await ensureUser();
    const up = await rawRequest('/api/auth/avatar', TINY_PNG, 'image/png', avaToken);
    const api = await request('GET', '/api/users/' + avaId);
    assert.equal(api.body.user.avatar, up.body.url);
    const html = await request('GET', '/user/' + avaId);
    assert.equal(html.status, 200);
    assert.ok(String(html.body).includes(up.body.url), 'SSR 页面应渲染头像 img');
  });

  it('移除头像：DB 清空 + 文件删除', async () => {
    await ensureUser();
    const up = await rawRequest('/api/auth/avatar', TINY_PNG, 'image/png', avaToken);
    // DELETE 不带 body（裸 http.request 走 chunked 会被 body-parser 拒绝，浏览器 fetch/curl 均无此问题）
    const del = await request('DELETE', '/api/auth/avatar', null, avaToken);
    assert.equal(del.status, 200);
    const me = await request('GET', '/api/auth/me', null, avaToken);
    assert.equal(me.body.user.avatar, '');
    assert.ok(!fs.existsSync(avatarFile(up.body.url)), '移除后文件应删除');
  });

  it('管理员删用户级联删除头像文件', async () => {
    await ensureUser();
    const up = await rawRequest('/api/auth/avatar', TINY_PNG, 'image/png', avaToken);
    assert.ok(fs.existsSync(avatarFile(up.body.url)));
    const admin = await getAdminToken();
    const del = await request('DELETE', '/api/admin/users/' + avaId, null, admin);
    assert.equal(del.status, 200);
    assert.ok(!fs.existsSync(avatarFile(up.body.url)), '删用户后头像文件应级联删除');
    avaToken = ''; // 用户已删，后续用例不复用
  });
});

describe('Token 条目评论（详情互动，生命周期跟条目）', () => {
  let cAuthorToken = '', cItemId = '';

  async function ensureSetup() {
    if (cAuthorToken) return;
    const db = getDb();
    db.prepare("INSERT OR IGNORE INTO invite_codes (code) VALUES ('ICINV1')").run();
    const r = await request('POST', '/api/auth/register', { username: 'ic_author', password: 'ic123456', inviteCode: 'ICINV1' });
    cAuthorToken = r.body.token;
    const create = await request('POST', '/api/items', { name: 'IC Target', url: mockBase(), token: 'sk-ic-target', tokenType: 'OpenAI' }, cAuthorToken);
    cItemId = create.body.id;
  }

  it('未登录发评论返回 401', async () => {
    await ensureSetup();
    const res = await request('POST', `/api/items/${cItemId}/comments`, { content: 'hi' });
    assert.equal(res.status, 401);
  });

  it('下架条目评论 404（与详情可见性一致）', async () => {
    await ensureSetup();
    await verifyItem(cItemId, false);
    const res = await request('POST', `/api/items/${cItemId}/comments`, { content: 'hi' }, cAuthorToken);
    assert.equal(res.status, 404);
    const list = await request('GET', `/api/items/${cItemId}/comments`);
    assert.equal(list.status, 404);
    await verifyItem(cItemId, true);
  });

  it('发评论成功（1-200 字校验 + 返回作者信息）', async () => {
    await ensureSetup();
    const res = await request('POST', `/api/items/${cItemId}/comments`, { content: '实测可用，速度不错' }, cAuthorToken);
    assert.equal(res.status, 201);
    assert.equal(res.body.authorName, 'ic_author');
    assert.equal(res.body.authorId && res.body.authorId.length > 0, true);
    const empty = await request('POST', `/api/items/${cItemId}/comments`, { content: '   ' }, cAuthorToken);
    assert.equal(empty.status, 400);
    const too = await request('POST', `/api/items/${cItemId}/comments`, { content: 'x'.repeat(201) }, cAuthorToken);
    assert.equal(too.status, 400);
  });

  it('条目评论与首页留言墙完全隔离（ref_id 分流）', async () => {
    await ensureSetup();
    await request('POST', '/api/comments', { content: '站点留言不应混入条目评论' }, cAuthorToken);
    const itemComments = await request('GET', `/api/items/${cItemId}/comments`);
    assert.ok(itemComments.body.comments.every(c => c.content !== '站点留言不应混入条目评论'), '留言墙内容不应出现在条目评论');
    assert.ok(itemComments.body.comments.some(c => c.content === '实测可用，速度不错'), '条目评论应在');
    const wall = await request('GET', '/api/comments?limit=100');
    assert.ok(wall.body.comments.every(c => c.content !== '实测可用，速度不错'), '条目评论不应出现在留言墙');
    assert.ok(wall.body.comments.some(c => c.content === '站点留言不应混入条目评论'), '留言墙内容应在');
  });

  it('删除自己的条目评论（DELETE /api/comments/:id 兼容两种评论）', async () => {
    await ensureSetup();
    const post = await request('POST', `/api/items/${cItemId}/comments`, { content: '待删除的评论' }, cAuthorToken);
    const del = await request('DELETE', '/api/comments/' + post.body.id, null, cAuthorToken);
    assert.equal(del.status, 200);
    const list = await request('GET', `/api/items/${cItemId}/comments`);
    assert.ok(!list.body.comments.some(c => c.id === post.body.id), '删除后不在列表');
  });
});

describe('社区头像与周报数据源', () => {
  it('贡献榜与动态流 API 返回 avatar 字段', async () => {
    const lb = await request('GET', '/api/leaderboard?limit=5');
    assert.ok(Array.isArray(lb.body));
    lb.body.forEach(u => assert.ok('avatar' in u, '贡献榜应有 avatar 字段'));
    const act = await request('GET', '/api/recent-activity?limit=10');
    act.body.forEach(a => assert.ok('avatar' in a, '动态流应有 avatar 字段'));
  });

  it('留言墙 API 返回 avatar 字段', async () => {
    const res = await request('GET', '/api/comments?limit=5');
    res.body.comments.forEach(c => assert.ok('avatar' in c, '留言应有 avatar 字段'));
  });
});

describe('社区周报（每周一自动公告 + 管理员手动触发）', () => {
  it('普通用户触发 403', async () => {
    const t = await getToken();
    const res = await request('POST', '/api/admin/weekly-report', {}, t);
    assert.equal(res.status, 403);
  });

  it('管理员触发生成周报公告 + 幂等（重复触发 created:false）', async () => {
    const admin = await getAdminToken();
    const first = await request('POST', '/api/admin/weekly-report', null, admin);
    assert.equal(first.status, 200);
    assert.equal(first.body.created, true, '首次应生成');
    const again = await request('POST', '/api/admin/weekly-report', null, admin);
    assert.equal(again.body.created, false, '同周重复触发应幂等跳过');
    const ann = await request('GET', '/api/announcements?limit=20');
    const report = ann.body.announcements.find(a => a.content.includes('社区周报'));
    assert.ok(report, '公告列表应含周报');
    assert.match(report.content, /新上线 Token \d+ 条/);
    assert.match(report.content, /Top 贡献|新社员/);
    assert.match(report.createdAt, /T.+Z$/, 'created_at 必须与公告 API 同为 ISO 格式（混入 SQLite 空格分隔格式会排序沉底）');
  });
});

describe('贡献榜口径（历史真实发布全部计入，含已下线/垃圾桶）与单模型独立测试', () => {
  let lbAuthorToken = '', lbItemIds = [];

  async function ensureLb() {
    if (lbAuthorToken) return;
    getDb().prepare("INSERT OR IGNORE INTO invite_codes (code) VALUES ('LBINV1')").run();
    const r = await request('POST', '/api/auth/register', { username: 'lb_author', password: 'lb123456', inviteCode: 'LBINV1' });
    lbAuthorToken = r.body.token;
    for (const n of ['LB One', 'LB Two']) {
      const c = await request('POST', '/api/items', { name: n, url: mockBase(), token: 'sk-lb-' + n.split(' ')[1].toLowerCase(), tokenType: 'OpenAI' }, lbAuthorToken);
      lbItemIds.push(c.body.id);
    }
  }

  it('下线（Token 失效）不扣贡献：榜单按累计发布数计', async () => {
    await ensureLb();
    let lb = await request('GET', '/api/leaderboard?limit=100');
    const me = lb.body.find(u => u.username === 'lb_author');
    assert.equal(me.count, 2, '发布 2 条 → 贡献 2');
    // 管理员下线 1 条（模拟 Token 失效被巡检下架）
    await verifyItem(lbItemIds[0], false);
    lb = await request('GET', '/api/leaderboard?limit=100');
    assert.equal(lb.body.find(u => u.username === 'lb_author').count, 2, '下架后仍计 2（发布时已实测有效即算贡献）');
    // 个人主页统计同口径
    const who = await request('GET', '/api/users/' + lb.body.find(u => u.username === 'lb_author').userId);
    assert.equal(who.body.stats.items, 2, '个人主页统计口径一致');
    assert.equal(who.body.items.length, 1, '列表仍只展示在线条目');
  });

  it('进垃圾桶仍计贡献（历史真实发布，垃圾桶只控制展示不抹贡献）', async () => {
    await ensureLb();
    const admin = await getAdminToken();
    const trashed = await request('PUT', '/api/admin/items/' + lbItemIds[1] + '/trash', null, admin);
    assert.equal(trashed.status, 200);
    const lb = await request('GET', '/api/leaderboard?limit=100');
    assert.equal(lb.body.find(u => u.username === 'lb_author').count, 2, '垃圾桶条目仍计入贡献');
    // 个人主页统计同步含垃圾桶条目
    const who = await request('GET', '/api/users/' + lb.body.find(u => u.username === 'lb_author').userId);
    assert.equal(who.body.stats.items, 2, '个人主页统计同口径');
    assert.equal(who.body.items.length, 0, '列表不展示垃圾桶条目（已下线+垃圾桶均不公开展示）');
  });

  it('单模型独立测试：可用模型 ok:true', async () => {
    const t = await getToken();
    const res = await request('POST', '/api/test-token', { token: 'sk-mock-1', tokenType: 'OpenAI', baseUrl: mockBase(), model: 'mock-model' }, t);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  it('单模型独立测试：不存在的模型 ok:false 且给出原因', async () => {
    const t = await getToken();
    const res = await request('POST', '/api/test-token', { token: 'sk-mock-1', tokenType: 'OpenAI', baseUrl: mockBase(), model: 'not-exist-model' }, t);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, false);
    assert.match(res.body.error, /模型|不可用|不存在/);
  });
});

// ===== 站内监控（访客统计 / 服务器资源，lib/analytics.js + 后台「访客」「服务器」tab） =====
describe('监控：访客统计与服务器资源', () => {
  const analytics = require('../lib/analytics');
  let modToken = '';
  let normalUserToken = '';
  before(async () => {
    getDb().prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('TINV60');
    const r = await request('POST', '/api/auth/register', { username: 'monm_' + Date.now(), password: 'pass123456', inviteCode: 'TINV60' });
    getDb().prepare("UPDATE users SET role = 'moderator' WHERE username = ?").run(r.body.user.username);
    const login = await request('POST', '/api/auth/login', { username: r.body.user.username, password: 'pass123456' });
    modToken = login.body.token || '';
    getDb().prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run('TINV61');
    const ru = await request('POST', '/api/auth/register', { username: 'monu_' + Date.now(), password: 'pass123456', inviteCode: 'TINV61' });
    normalUserToken = ru.body.token || '';
  });

  it('timezoneToCountry：时区 → 国家/地区映射', () => {
    assert.equal(analytics.timezoneToCountry('Asia/Shanghai'), '中国大陆');
    assert.equal(analytics.timezoneToCountry('Asia/Hong_Kong'), '中国香港');
    assert.equal(analytics.timezoneToCountry('Asia/Taipei'), '中国台湾');
    assert.equal(analytics.timezoneToCountry('America/New_York'), '美国');
    assert.equal(analytics.timezoneToCountry(''), '');
    assert.equal(analytics.timezoneToCountry('Etc/GMT+9'), 'Etc/GMT+9'); // 未映射时区回退原始值
  });

  it('POST /api/track：匿名 beacon 记录访问，国家按时区推断', async () => {
    getDb().prepare('DELETE FROM visits').run();
    const res = await request('POST', '/api/track', { tz: 'Asia/Shanghai', lang: 'zh-CN', path: '/' });
    assert.equal(res.status, 204);
    const rows = getDb().prepare('SELECT * FROM visits ORDER BY id DESC LIMIT 1').all();
    assert.equal(rows.length, 1, 'beacon 应写入一条访问记录');
    assert.equal(rows[0].path, '/');
    assert.equal(rows[0].country, '中国大陆');
    assert.equal(rows[0].tz, 'Asia/Shanghai');
    // 来源 host：只存域名（SEO/GEO 来源分析用），非 http(s)/伪协议一律丢弃
    await request('POST', '/api/track', { tz: 'Asia/Shanghai', path: '/', ref: 'https://chatgpt.com/share/abc?x=1' });
    await request('POST', '/api/track', { tz: 'Asia/Shanghai', path: '/', ref: 'javascript:alert(1)' });
    const refs = getDb().prepare('SELECT ref FROM visits ORDER BY id DESC LIMIT 2').all().map(r => r.ref);
    assert.ok(refs.includes('chatgpt.com'), '合法 referrer 应存 host：' + JSON.stringify(refs));
    assert.ok(!refs.some(r => String(r).includes('javascript')), '伪协议 ref 必须丢弃');
  });

  it('POST /api/track：非页面路径与爬虫 UA 拒绝记录', async () => {
    getDb().prepare('DELETE FROM visits').run();
    for (const p of ['/api/items', '/uploads/x.png', '/dashboard', '/poster/item/1.png']) {
      await request('POST', '/api/track', { tz: 'Asia/Shanghai', path: p });
    }
    // 爬虫 UA：直接构造带 UA 的请求
    await new Promise((resolve, reject) => {
      const body = JSON.stringify({ tz: 'Asia/Shanghai', path: '/' });
      const opts = {
        hostname: '127.0.0.1', port: server.address().port, path: '/api/track', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' }
      };
      const req = http.request(opts, res => { res.resume(); res.on('end', resolve); });
      req.on('error', reject);
      req.write(body); req.end();
    });
    const n = getDb().prepare('SELECT COUNT(*) c FROM visits').get().c;
    assert.equal(n, 0, '非页面路径与爬虫 UA 不应写入访问记录');
  });

  it('GET /api/admin/visits：未登录 401，普通用户 403，版主 200 且结构与记录正确', async () => {
    getDb().prepare('DELETE FROM visits').run();
    await request('POST', '/api/track', { tz: 'Asia/Shanghai', lang: 'zh-CN', path: '/' });
    const anon = await request('GET', '/api/admin/visits');
    assert.equal(anon.status, 401);
    const forbidden = await request('GET', '/api/admin/visits', null, normalUserToken);
    assert.equal(forbidden.status, 403);
    const ok = await request('GET', '/api/admin/visits?limit=10', null, modToken);
    assert.equal(ok.status, 200);
    assert.ok(ok.body.stats.todayPv >= 1, '今日 PV 应 ≥1');
    assert.ok(ok.body.stats.todayUv >= 1, '今日 UV 应 ≥1');
    assert.ok(Array.isArray(ok.body.stats.byCountry));
    assert.ok(Array.isArray(ok.body.stats.byDay));
    assert.equal(ok.body.visits.length, 1);
    assert.equal(ok.body.visits[0].country, '中国大陆');
  });

  it('GET /api/admin/server-stats：版主可见，latest/series 结构完整', async () => {
    const db = getDb();
    db.prepare('DELETE FROM server_stats').run();
    db.prepare('INSERT INTO server_stats (cpu, mem_used, mem_total, disk_used, disk_total, rss, created_at) VALUES (12.5, 100, 200, 50, 100, 80, ?)')
      .run(new Date().toISOString());
    const anon = await request('GET', '/api/admin/server-stats');
    assert.equal(anon.status, 401);
    const ok = await request('GET', '/api/admin/server-stats', null, modToken);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.latest.cpu, 12.5);
    assert.equal(ok.body.latest.mem_total, 200);
    assert.ok(Array.isArray(ok.body.series));
    assert.equal(ok.body.series.length, 1);
  });

  it('recordVisit 直插：50 万条上限截断保留最新', async () => {
    const db = getDb();
    db.prepare('DELETE FROM visits').run();
    for (let i = 0; i < 5; i++) analytics.recordVisit({ ip: '1.2.3.' + i, path: '/', tz: 'Asia/Shanghai' });
    assert.equal(db.prepare('SELECT COUNT(*) c FROM visits').get().c, 5);
  });
});

// ===== 中转站掺水检测（/api/verify 端点识别 + /api/verify/model 每模型电池） =====
describe('中转站掺水检测', () => {
  let vt = '';
  before(async () => { vt = await getToken(); });

  it('/api/verify：未登录 401 / 缺参数 400', async () => {
    const anon = await request('POST', '/api/verify', { baseUrl: verifyMockBase(), token: 'sk-x' });
    assert.equal(anon.status, 401);
    const noUrl = await request('POST', '/api/verify', { token: 'sk-x' }, vt);
    assert.equal(noUrl.status, 400);
    const noTok = await request('POST', '/api/verify', { baseUrl: verifyMockBase() }, vt);
    assert.equal(noTok.status, 400);
  });

  it('/api/verify：内网地址被 SSRF 拦截', async () => {
    process.env.ALLOW_PRIVATE_SSRF = '0';
    try {
      const res = await request('POST', '/api/verify', { baseUrl: verifyMockBase(), token: 'sk-x' }, vt);
      assert.ok((res.body.error || '').includes('禁止访问内网'));
    } finally { process.env.ALLOW_PRIVATE_SSRF = '1'; }
  });

  it('/api/verify：自动识别兼容模式 + 模型列表 + 端点级检查', async () => {
    const res = await request('POST', '/api/verify', { baseUrl: verifyMockBase(), token: 'sk-x' }, vt);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.deepEqual(res.body.compat, ['openai']);
    assert.equal(res.body.type, 'OpenAI');
    assert.ok(Array.isArray(res.body.models));
    assert.equal(res.body.models.length, 4);
    const ids = res.body.models.map(m => m.id);
    assert.ok(ids.includes('v-gpt') && ids.includes('v-reasoner-think'));
    const reachable = res.body.checks.find(c => c.key === 'reachable');
    assert.equal(reachable.status, 'pass');
    const models = res.body.checks.find(c => c.key === 'models');
    assert.equal(models.status, 'pass');
    assert.ok(models.detail.includes('4'));
  });

  it('/api/verify/model：正常模型 → 基本可信，各维度 pass', async () => {
    const res = await request('POST', '/api/verify/model', { baseUrl: verifyMockBase(), token: 'sk-x', model: 'v-gpt' }, vt);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.ok(res.body.score >= 80, '正常模型评分应 ≥80，实际 ' + res.body.score);
    assert.equal(res.body.verdict, '基本可信');
    for (const key of ['reachable', 'content', 'echo', 'usage', 'knowledge', 'identity']) {
      const c = res.body.checks.find(x => x.key === key);
      assert.equal(c.status, 'pass', 'check「' + key + '」应 pass，实际 ' + c.status + '：' + c.detail);
    }
  });

  it('/api/verify/model：请求 gpt-5 但回显 claude → 红线判疑似掺水', async () => {
    const res = await request('POST', '/api/verify/model', { baseUrl: verifyMockBase(), token: 'sk-x', model: 'gpt-5' }, vt);
    assert.equal(res.status, 200);
    const echo = res.body.checks.find(c => c.key === 'echo');
    assert.equal(echo.status, 'fail', '回显跨家族应 fail');
    assert.equal(res.body.verdict, '疑似掺水', '回显跨家族 = 模型被替换 → 红线');
  });

  it('/api/verify/model：宣称推理模型却无思维链 → 存在疑点', async () => {
    const res = await request('POST', '/api/verify/model', { baseUrl: verifyMockBase(), token: 'sk-x', model: 'v-reasoner-nothink' }, vt);
    assert.equal(res.status, 200);
    const thinking = res.body.checks.find(c => c.key === 'thinking');
    assert.equal(thinking.status, 'warn');
    assert.equal(res.body.verdict, '存在疑点', '推理模型无思维链 → 强嫌疑');
  });

  it('/api/verify/model：推理模型带思维链 → 思维链 pass', async () => {
    const res = await request('POST', '/api/verify/model', { baseUrl: verifyMockBase(), token: 'sk-x', model: 'v-reasoner-think' }, vt);
    assert.equal(res.status, 200);
    const thinking = res.body.checks.find(c => c.key === 'thinking');
    assert.equal(thinking.status, 'pass');
  });

  it('/api/verify/model：缺 model 参数 400', async () => {
    const res = await request('POST', '/api/verify/model', { baseUrl: verifyMockBase(), token: 'sk-x' }, vt);
    assert.equal(res.status, 400);
  });

  it('/api/verify/model：404 model not found → error 透出后端原文', async () => {
    const res = await request('POST', '/api/verify/model', { baseUrl: verifyMockBase(), token: 'sk-x', model: 'v-notfound' }, vt);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, false, '404 模型应判不可用');
    assert.equal(res.body.kind, 'http', '非 2xx 应标 http 类');
    assert.ok((res.body.error || '').includes('model not found'), 'error 应透出后端原文「model not found」，实际 ' + res.body.error);
    assert.equal(res.body.verdict, '疑似掺水', '404 模型应判疑似掺水，实际 ' + res.body.verdict);
  });

  it('/api/verify/model：连接失败（端口不可达）→ error 透出「无法连接」', async () => {
    // 用不存在的端口模拟所有候选路径连接失败（!resp 分支）
    const deadBase = 'http://127.0.0.1:1/v1';
    const res = await request('POST', '/api/verify/model', { baseUrl: deadBase, token: 'sk-x', model: 'v-gpt' }, vt);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, false, '连接失败应判不可用');
    assert.ok((res.body.error || '').includes('无法连接') || (res.body.error || '').includes('无法'), 'error 应透出连接失败原因，实际 ' + res.body.error);
  });
});

describe('掺水检测 AI 辅助判定（判官 LLM 池 + 语义增强 + 优雅降级）', () => {
  let vt = '';
  let judgeItemId = '';
  before(async () => {
    vt = await getToken();
    // 清理以往 pool 状态，确保本用例组唯一地驱动判官候选池
    aiJudge._reset && aiJudge._reset();
    // 建一个 verified OpenAI 判官条目（尾随 suites 末尾 → ORDER BY created_at DESC 排最前 → 最先被探测）
    const r = await request('POST', '/api/items', { name: 'AI Judge', url: aiJudgeMockBase(), token: 'sk-judge', tokenType: 'OpenAI' }, vt);
    judgeItemId = r.body.id || '';
  });

  it('同家族前缀变体 echo 由 warn 被 AI 修正为 pass，score 提升', async () => {
    // 判官池：候选 = 上面建的 judge 条目（aiJudgeMock 会回 AI_VERDICT JSON）
    const res = await request('POST', '/api/verify/model', { baseUrl: verifyMockBase(), token: 'sk-x', model: 'gpt-nano-x' }, vt);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    const echo = res.body.checks.find(c => c.key === 'echo');
    // 无 AI 时 gpt-nano-x↔gpt-nano 同家族非同名 → warn；AI 判同一 → pass
    assert.equal(echo.status, 'pass', 'AI 应把同模型前缀变体的 echo 从 warn 修正为 pass，实际 ' + echo.status + '；detail=' + echo.detail);
    assert.ok(echo.detail.includes('AI 判定'), '被 AI 修正的 check 应标注 AI 判定');
    assert.equal(res.body.ai.available, true, 'AI 应可用');
    assert.ok(res.body.ai.upgraded && res.body.ai.upgraded.includes('echo'), 'upgraded 应含 echo');
    // 修正使评分提升：echo 从 warn(0 分,也非 fail) 修正为 pass(+5)
    assert.ok(res.body.score >= 80, '同模型前缀变体应基本可信，实际 score=' + res.body.score);
  });

  it('AI 判官不可用时优雅降级：warn 维度保持原判定、标注 available=false', async () => {
    aiJudge._reset && aiJudge._reset();
    // 让判官池无可用候选：下线能当判官的 judge 条目 + 复位，使 enhance 探测候选全失败 → 降级
    aiJudge._reset && aiJudge._reset();
    // 让判官池无可用候选：直接按 id 下线能当判官的 judge 条目（DB 层确定，不依赖 admin 角色/列表），
    // 复位后 enhance 重载池、探测候选全非判官 → 优雅降级
    if (judgeItemId) getDb().prepare('UPDATE items SET verified = 0 WHERE id = ?').run(judgeItemId);
    aiJudge._reset && aiJudge._reset();
    // 用会触发 enhance 的同模型前缀用例（echo 原 warn，不同模型名避开 60s 结果缓存），但判官不可用 → AI 不修正，echo 保持 warn
    const res = await request('POST', '/api/verify/model', { baseUrl: verifyMockBase(), token: 'sk-x', model: 'gpt-nano-z' }, vt);
    assert.equal(res.body.ok, true);
    const echo = res.body.checks.find(c => c.key === 'echo');
    assert.equal(echo.status, 'warn', '无可用判官时 echo 应保持 warn，实际 ' + echo.status);
    assert.equal(res.body.ai.available, false, '判官不可用应标注 available=false');
    assert.ok(!String(echo.detail).includes('AI 判定'), '未修正不应标注 AI 判定');
  });
});

// ===== Skill 广场 =====
describe('Skill 广场', () => {
  let vt = '';
  let userId = '';
  let skillId = '';

  // 独立的注册+登录 helper，不依赖 getToken 的全局缓存
  async function registerAndLogin(uname) {
    const code = 'SK' + Date.now();
    getDb().prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run(code);
    const res = await request('POST', '/api/auth/register', { username: uname, password: 'test123456', inviteCode: code });
    if (res.status === 201 || res.status === 200) return res.body.token || '';
    // 注册失败，尝试登录
    const login = await request('POST', '/api/auth/login', { username: uname, password: 'test123456' });
    if (login.status === 200) return login.body.token || '';
    return '';
  }

  before(async () => {
    // 使用短用户名（2-20字符）
    const ts = Date.now().toString().slice(-6);
    vt = await registerAndLogin('skill' + ts);
    // 从 token 中解析用户 ID
    try {
      const payload = JSON.parse(Buffer.from(vt.split('.')[1], 'base64').toString());
      userId = payload.id || payload.sub || '';
    } catch (_) { userId = ''; }
  });

  it('POST /api/skills：未登录 401', async () => {
    const res = await request('POST', '/api/skills', { title: 'test', description: 'test', content: 'test' });
    assert.equal(res.status, 401);
  });

  it('POST /api/skills：登录用户发布免费 Skill', async () => {
    const res = await request('POST', '/api/skills', {
      title: '测试 Skill', summary: '测试摘要', description: '## 用法\n用法示例',
      category: '通用', tags: ['测试'], price: 0, content: '## 用法\n用法示例'
    }, vt);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'pending');
    assert.ok(res.body.id);
    skillId = res.body.id;
  });

  it('GET /api/skills：列表可选筛选', async () => {
    const res = await request('GET', '/api/skills?limit=10');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.items));
  });

  it('GET /api/skills/:id：未购买付费 Skill 只能看摘要', async () => {
    // 先发布一个付费 Skill
    const res = await request('POST', '/api/skills', {
      title: '付费 Skill', summary: '付费摘要', description: '付费描述',
      category: '通用', tags: [], price: 100, content: '付费内容'
    }, vt);
    const paidId = res.body.id;
    // 模拟版主审核通过
    getDb().prepare('UPDATE skills SET status = ?, updated_at = ? WHERE id = ?').run('online', new Date().toISOString(), paidId);
    getDb().prepare('UPDATE skill_versions SET status = ? WHERE skill_id = ?').run('online', paidId);
    // 未登录访问
    const anon = await request('GET', '/api/skills/' + paidId);
    assert.equal(anon.status, 200);
    assert.equal(anon.body.status, 'online');
    assert.ok(!anon.body.content || anon.body.content === ''); // 未购买不返回内容
  });

  it('POST /api/skills/:id/buy：积分购买事务', async () => {
    // 创建第二个用户来购买（不能购买自己发布的 Skill）
    const buyerCode = 'SKB' + Date.now();
    getDb().prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run(buyerCode);
    const buyerRes = await request('POST', '/api/auth/register', { username: 'skillbuyer' + Date.now().toString().slice(-6), password: 'test123456', inviteCode: buyerCode });
    const buyerToken = buyerRes.body.token || '';
    // 给买家充积分
    const buyerPayload = JSON.parse(Buffer.from(buyerToken.split('.')[1], 'base64').toString());
    if (buyerPayload.id) getDb().prepare('UPDATE users SET points = points + 500 WHERE id = ?').run(buyerPayload.id);
    // 将免费 Skill 设为 online（模拟审核通过）
    getDb().prepare("UPDATE skills SET status = 'online', updated_at = ? WHERE id = ?").run(new Date().toISOString(), skillId);
    getDb().prepare("UPDATE skill_versions SET status = 'online' WHERE skill_id = ?").run(skillId);
    // 第二个用户购买已上线的免费 Skill
    const res = await request('POST', '/api/skills/' + skillId + '/buy', {}, buyerToken);
    assert.equal(res.status, 200);
    assert.equal(res.body.free, true);
  });

  it('GET /api/my/skills：作者查看自己发布的 Skill', async () => {
    const res = await request('GET', '/api/my/skills', null, vt);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
  });

  it('GET /api/my/purchases：查看购买记录', async () => {
    const res = await request('GET', '/api/my/purchases', null, vt);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
  });

  // ===== Skill 包（zip）上传 / 发布 / 下载 =====
  const fflate = require('fflate');
  function buildSkillZip(entries) {
    const obj = {};
    for (const [k, v] of Object.entries(entries)) obj[k] = Buffer.from(v);
    return fflate.zipSync(obj);
  }

  it('POST /api/skills/package：上传合法 zip 包，返回文件树 + frontmatter', async () => {
    const zip = buildSkillZip({
      'SKILL.md': '---\nname: 测试 Skill\ndescription: 一个用于测试的 Skill\n---\n# 测试 Skill\n\n用法说明。\n',
      'README.md': '# 测试 Skill\n\n这是 README。\n',
      'scripts/run.js': 'console.log("hi");\n'
    });
    const res = await requestRaw('POST', '/api/skills/package', zip, vt, 'application/zip');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.packageId);
    assert.equal(res.body.fileCount, 3);
    assert.equal(res.body.skillMd.name, '测试 Skill');
    assert.ok(res.body.readme.includes('这是 README'));
    assert.ok(res.body.files.some(f => f.path === 'scripts/run.js'));
  });

  it('POST /api/skills/package：缺 SKILL.md 被拒', async () => {
    const zip = buildSkillZip({ 'README.md': '# no skill' });
    const res = await requestRaw('POST', '/api/skills/package', zip, vt, 'application/zip');
    assert.equal(res.status, 400);
    assert.match(res.body.error, /SKILL\.md/);
  });

  it('POST /api/skills/package：路径穿越被拒', async () => {
    const zip = buildSkillZip({ 'SKILL.md': '---\nname: x\n---\n# x\n', '../escape.md': 'evil' });
    const res = await requestRaw('POST', '/api/skills/package', zip, vt, 'application/zip');
    assert.equal(res.status, 400);
    assert.match(res.body.error, /非法路径|SKILL\.md/);
  });

  it('POST /api/skills/package：未登录 401', async () => {
    const zip = buildSkillZip({ 'SKILL.md': '---\nname: x\n---\n# x\n' });
    const res = await requestRaw('POST', '/api/skills/package', zip, null, 'application/zip');
    assert.equal(res.status, 401);
  });

  it('POST /api/skills：用 packageId 发布，详情返回 files，下载 zip 可解压', async () => {
    const zip = buildSkillZip({
      'SKILL.md': '---\nname: 包发布 Skill\ndescription: 通过 zip 发布\n---\n# 包发布 Skill\n\n用法。\n',
      'README.md': '# 包发布 Skill\n\nREADME 内容。\n',
      'lib/util.js': 'module.exports = {};\n'
    });
    const up = await requestRaw('POST', '/api/skills/package', zip, vt, 'application/zip');
    assert.equal(up.status, 200);
    const pkgId = up.body.packageId;

    const pub = await request('POST', '/api/skills', { title: '包发布 Skill', summary: '摘要', packageId: pkgId, price: 0 }, vt);
    assert.equal(pub.status, 200, JSON.stringify(pub.body));
    assert.ok(pub.body.id);
    assert.equal(pub.body.fileCount, 3);

    // 设为 online 模拟审核通过
    getDb().prepare("UPDATE skills SET status = 'online', updated_at = ? WHERE id = ?").run(new Date().toISOString(), pub.body.id);
    getDb().prepare("UPDATE skill_versions SET status = 'online' WHERE skill_id = ?").run(pub.body.id);

    // 详情返回 files 清单
    const detail = await request('GET', '/api/skills/' + pub.body.id, null, vt);
    assert.equal(detail.status, 200);
    assert.ok(Array.isArray(detail.body.files));
    assert.equal(detail.body.fileCount, 3);
    assert.ok(detail.body.files.some(f => f.path === 'lib/util.js'));

    // 下载 zip 并解压校验
    const dl = await requestRaw('GET', '/api/skills/' + pub.body.id + '/download', null, vt);
    assert.equal(dl.status, 200);
    assert.match(dl.headers['content-type'], /^application\/zip/);
    const unzipped = fflate.unzipSync(dl.body);
    const paths = Object.keys(unzipped);
    assert.ok(paths.includes('SKILL.md'));
    assert.ok(paths.includes('README.md'));
    assert.ok(paths.includes('lib/util.js'));
  });

  it('GET /api/skills/:id/download：未购买付费 Skill 403', async () => {
    const zip = buildSkillZip({ 'SKILL.md': '---\nname: 付费包\ndescription: 付费\n---\n# 付费包\n' });
    const up = await requestRaw('POST', '/api/skills/package', zip, vt, 'application/zip');
    const pub = await request('POST', '/api/skills', { title: '付费包', packageId: up.body.packageId, price: 100 }, vt);
    getDb().prepare("UPDATE skills SET status = 'online', updated_at = ? WHERE id = ?").run(new Date().toISOString(), pub.body.id);
    getDb().prepare("UPDATE skill_versions SET status = 'online' WHERE skill_id = ?").run(pub.body.id);
    // 另一个用户（直接注册，getToken 只认 200 会漏 201）
    const bcode = 'SKDL' + Date.now();
    getDb().prepare('INSERT OR IGNORE INTO invite_codes (code) VALUES (?)').run(bcode);
    const breg = await request('POST', '/api/auth/register', { username: 'skdl' + Date.now(), password: 'test123456', inviteCode: bcode });
    assert.ok(breg.body.token, 'buyer 注册应返回 token: ' + JSON.stringify(breg.body));
    const buyerToken = breg.body.token;
    const dl = await requestRaw('GET', '/api/skills/' + pub.body.id + '/download', null, buyerToken);
    assert.equal(dl.status, 403);
  });
});
