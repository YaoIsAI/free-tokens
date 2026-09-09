#!/usr/bin/env node
const { Command } = require('commander');
const fs = require('fs');

const BASE_URL = process.env.TOKEN_API || 'http://localhost:3000';
const program = new Command();

program.option('--json', 'JSON 输出模式（适合 AI Agent）');

// 读取本地缓存的 token
function getToken() {
  try {
    const f = process.env.HOME || process.env.USERPROFILE;
    const p = require('path').join(f, '.token-charity-auth');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (_) {}
  return {};
}

function saveToken(data) {
  const f = require('path').join(process.env.HOME || process.env.USERPROFILE, '.token-charity-auth');
  // 0600：文件含登录 JWT，仅属主可读（Windows 上 chmod 语义弱化但无害）
  fs.writeFileSync(f, JSON.stringify(data, null, 2), 'utf-8', { mode: 0o600 });
  try { fs.chmodSync(f, 0o600); } catch (_) {}
}

// 结构化输出
function ok(data) {
  if (program.opts().json) console.log(JSON.stringify({ ok: true, data }));
  else console.log(data);
}
function fail(msg) {
  if (program.opts().json) console.log(JSON.stringify({ ok: false, error: msg }));
  else console.error('✗', msg);
  process.exit(1);
}

async function api(method, path, body, opts = {}) {
  const headers = {};
  const t = getToken();
  if (t.token) headers['Authorization'] = 'Bearer ' + t.token;
  const reqOpts = { method, headers };
  if (body != null) {
    if (opts.raw) {
      reqOpts.body = body;
      if (opts.contentType) headers['Content-Type'] = opts.contentType;
    } else {
      headers['Content-Type'] = 'application/json';
      reqOpts.body = JSON.stringify(body);
    }
  }
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, reqOpts);
  } catch (e) {
    throw new Error(`无法连接服务器 ${BASE_URL}（可用 TOKEN_API 环境变量指向其他地址）`);
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data.error || data.raw || `HTTP ${res.status}`);
  return data;
}

program.name('token').description('Token公益站 CLI（支持 --json 模式）').version('0.23.0');

// ===== 注册 =====
program
  .command('register')
  .description('注册账号（需邀请码，入群后向管理员索取；可附邮箱/手机号便于找回）')
  .option('-u, --username <username>', '用户名')
  .option('-p, --password <password>', '密码')
  .option('-c, --code <inviteCode>', '邀请码（必填）')
  .option('-e, --email <email>', '邮箱（选填，忘记密码时找回用）')
  .option('--phone <phone>', '手机号（选填，忘记密码时找回用）')
  .action(async (opts) => {
    if (!opts.username || !opts.password) fail('请提供 --username 和 --password');
    if (!opts.code) fail('请提供 --code 邀请码（入群后向管理员索取）');
    try {
      const data = await api('POST', '/api/auth/register', { username: opts.username, password: opts.password, email: opts.email || '', phone: opts.phone || '', inviteCode: opts.code });
      saveToken(data);
      if (program.opts().json) { ok(data); return; }
      ok(`注册成功，欢迎 ${data.user.username}`);
    } catch (e) { fail(e.message); }
  });

// ===== 找回密码（无验证码，凭用户名 + 注册邮箱/手机号） =====
program
  .command('recover')
  .description('忘记密码：凭用户名 + 注册邮箱/手机号重设密码（无需验证码）')
  .option('-u, --username <username>', '用户名')
  .option('-e, --email <email>', '注册时填的邮箱')
  .option('--phone <phone>', '注册时填的手机号')
  .option('-p, --password <password>', '新密码（至少8位，含字母和数字）')
  .action(async (opts) => {
    if (!opts.username) fail('请提供 --username');
    if (!opts.email && !opts.phone) fail('请提供 --email 或 --phone（注册时填写的联系方式，二选一）');
    if (!opts.password) fail('请提供 --password 新密码');
    try {
      const data = await api('POST', '/api/auth/recovery', { username: opts.username, email: opts.email || '', phone: opts.phone || '', password: opts.password });
      if (program.opts().json) { ok(data); return; }
      ok('密码已重置，请用新密码登录');
    } catch (e) { fail(e.message); }
  });

// ===== 登录 =====
program
  .command('login')
  .description('登录账号（可用 -t 直接使用已有 token）')
  .option('-u, --username <username>', '用户名')
  .option('-p, --password <password>', '密码')
  .option('-t, --token <token>', '直接用已有 token（免账号密码，适合 AI Agent 接入）')
  .action(async (opts) => {
    if (opts.token) {
      try {
        // 直接用传入 token 验证，验证通过才保存（不覆盖已有有效 token）
        const res = await fetch(`${BASE_URL}/api/auth/me`, { headers: { 'Authorization': 'Bearer ' + opts.token } });
        const text = await res.text();
        let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
        if (!res.ok) throw new Error(data.error || data.raw || `HTTP ${res.status}`);
        saveToken({ token: opts.token });
        ok(`已保存 token，当前用户: ${data.user.username}（角色: ${data.user.role}）`);
      } catch (e) {
        fail('token 验证失败: ' + e.message);
      }
      return;
    }
    if (!opts.username || !opts.password) fail('请提供 --username 和 --password，或用 --token');
    try {
      const data = await api('POST', '/api/auth/login', { username: opts.username, password: opts.password });
      saveToken(data);
      if (program.opts().json) { ok(data); return; }
      ok(`登录成功，欢迎 ${data.user.username}`);
    } catch (e) { fail(e.message); }
  });

// ===== 当前用户 =====
program
  .command('whoami')
  .description('显示当前登录用户与角色')
  .action(async () => {
    try {
      const me = await api('GET', '/api/auth/me');
      if (program.opts().json) { ok(me.user); return; }
      console.log('昵称: ' + (me.user.nickname || '（未设置，显示账号）'));
      console.log('用户名: ' + me.user.username);
      console.log('角色: ' + (me.user.role || 'user'));
    } catch (e) { fail(e.message); }
  });

// ===== 个人资料（昵称/邮箱/手机号） =====
program
  .command('profile')
  .description('查看/修改个人资料（昵称/邮箱/手机号，邮箱手机号用于找回密码）')
  .option('-n, --nickname <nickname>', '设置昵称（留空则清除，显示账号）')
  .option('-e, --email <email>', '设置邮箱（留空则清除）')
  .option('--phone <phone>', '设置手机号（留空则清除）')
  .action(async (opts) => {
    try {
      if (opts.nickname !== undefined || opts.email !== undefined || opts.phone !== undefined) {
        const body = {};
        if (opts.nickname !== undefined) body.nickname = opts.nickname;
        if (opts.email !== undefined) body.email = opts.email;
        if (opts.phone !== undefined) body.phone = opts.phone;
        const updated = await api('PUT', '/api/auth/profile', body);
        if (program.opts().json) { ok(updated.user); return; }
        ok('资料已更新：昵称=' + (updated.user.nickname || '（未设置）') + ' 邮箱=' + (updated.user.email || '（未填）') + ' 手机号=' + (updated.user.phone || '（未填）'));
        return;
      }
      const me = await api('GET', '/api/auth/me');
      if (program.opts().json) { ok(me.user); return; }
      console.log('昵称: ' + (me.user.nickname || '（未设置，显示账号）'));
      console.log('用户名: ' + me.user.username);
      console.log('邮箱: ' + (me.user.email || '（未填）'));
      console.log('手机号: ' + (me.user.phone || '（未填）'));
      console.log('修改资料: ' + 'freeapis-cli profile -n "我的昵称" -e "you@mail.com" --phone "13800001111"');
    } catch (e) { fail(e.message); }
  });

// ===== 审核（版主/管理员） =====
program
  .command('audit')
  .alias('review')
  .description('查看待审核/已通过条目（需版主/管理员权限）')
  .option('--status <status>', 'pending / verified / all', 'pending')
  .action(async (opts) => {
    try {
      if (!['pending', 'verified', 'all'].includes(opts.status)) fail('--status 只能是 pending / verified / all');
      const status = opts.status;
      const items = await api('GET', '/api/admin/items' + (status === 'all' ? '' : '?status=' + status));
      if (program.opts().json) { ok(items); return; }
      if (!items.length) { console.log(status === 'pending' ? '（空）没有待审核条目' : '（空）没有条目'); return; }
      items.forEach(i => {
        const tag = i.verified ? '✓已通过' : '待审核';
        console.log('  ' + i.name + ' [' + tag + ']');
        console.log('    id: ' + i.id + ' | ' + (i.category || '-') + ' | ' + (i.provider || '-') + ' | 作者: ' + (i.authorName || i.author_name || '?'));
        if (i.desc) console.log('    ' + String(i.desc).slice(0, 80));
        if (i.token) console.log('    token: ' + String(i.token).slice(0, 40) + (i.token.length > 40 ? '…' : ''));
        console.log('');
      });
    } catch (e) { fail(e.message); }
  });

program
  .command('verify <id>')
  .description('通过条目验证（需版主/管理员权限）')
  .action(async (id) => {
    try {
      const data = await api('PUT', '/api/admin/items/' + id + '/verify', { verified: true });
      if (program.opts().json) { ok(data); return; }
      ok('已通过: ' + data.name);
    } catch (e) { fail(e.message); }
  });

program
  .command('unverify <id>')
  .description('取消条目验证（需版主/管理员权限）')
  .action(async (id) => {
    try {
      const data = await api('PUT', '/api/admin/items/' + id + '/verify', { verified: false });
      if (program.opts().json) { ok(data); return; }
      ok('已取消验证: ' + data.name);
    } catch (e) { fail(e.message); }
  });

// ===== 管理后台（管理员） =====
const adminCmd = program.command('admin').description('管理后台：用户管理（需管理员权限）');

adminCmd
  .command('users')
  .description('列出全部用户')
  .action(async () => {
    try {
      const users = await api('GET', '/api/admin/users');
      if (program.opts().json) { ok(users); return; }
      users.forEach(u => {
        console.log('  ' + u.username + ' [' + u.role + ']  id:' + u.id + (u.created_at ? '  加入:' + u.created_at : ''));
      });
    } catch (e) { fail(e.message); }
  });

adminCmd
  .command('role <id>')
  .description('修改用户角色')
  .option('-r, --role <role>', 'user / moderator / admin')
  .action(async (id, opts) => {
    if (!['user', 'moderator', 'admin'].includes(opts.role)) fail('角色必须是 user / moderator / admin');
    try {
      const u = await api('PUT', '/api/admin/users/' + id + '/role', { role: opts.role });
      if (program.opts().json) { ok(u); return; }
      ok('已设置 ' + u.username + ' 的角色为 ' + u.role);
    } catch (e) { fail(e.message); }
  });

adminCmd
  .command('delete <id>')
  .description('删除用户及其全部条目（不能删除自己）')
  .action(async (id) => {
    try {
      const u = await api('DELETE', '/api/admin/users/' + id);
      if (program.opts().json) { ok(u); return; }
      ok('已删除用户: ' + u.username);
    } catch (e) { fail(e.message); }
  });

adminCmd
  .command('reset-password <id> <newpass>')
  .description('重置用户密码（新密码至少8位、含字母和数字；用 admin users 查 id）')
  .action(async (id, newpass) => {
    try {
      const u = await api('POST', '/api/admin/users/' + id + '/reset-password', { password: newpass });
      if (program.opts().json) { ok(u); return; }
      ok('已重置 ' + u.username + ' 的密码（请把新密码告知该用户）');
    } catch (e) { fail(e.message); }
  });

adminCmd
  .command('invites')
  .description('列出全部邀请码及使用状态')
  .action(async () => {
    try {
      const codes = await api('GET', '/api/admin/invites');
      if (program.opts().json) { ok(codes); return; }
      if (!codes.length) { console.log('（空）还没有邀请码，用 admin invite <数量> 生成'); return; }
      codes.forEach(c => {
        console.log('  ' + c.code + (c.used_by ? '  [已使用 ' + (c.used_at || '') + ']' : '  [未使用]') + '  生成:' + (c.created_at || ''));
      });
    } catch (e) { fail(e.message); }
  });

adminCmd
  .command('invite [count]')
  .description('生成邀请码（默认 1 个，最多 50）')
  .action(async (count) => {
    const n = Math.min(Math.max(parseInt(count, 10) || 1, 1), 50);
    try {
      const data = await api('POST', '/api/admin/invites', { count: n });
      if (program.opts().json) { ok(data); return; }
      data.created.forEach(code => console.log('  ' + code));
      ok(`已生成 ${data.created.length} 个邀请码（复制发给新用户，每个只能用一次）`);
    } catch (e) { fail(e.message); }
  });

adminCmd
  .command('check')
  .description('检测失效 Token：测试所有已发布条目，只要无法正常访问的自动下线（含 429/503）')
  .action(async () => {
    try {
      const data = await api('POST', '/api/admin/items/check', {});
      if (program.opts().json) { ok(data); return; }
      console.log(`检测 ${data.checked} 个已发布条目`);
      if (data.offline.length) {
        console.log('已下线（无法正常访问）:');
        data.offline.forEach(o => console.log('  ' + o.name + '  ' + (o.reason || '')));
      } else {
        console.log('没有失效的 Token');
      }
    } catch (e) { fail(e.message); }
  });

adminCmd
  .command('announcements')
  .description('列出全部公告及显示状态（管理员）')
  .action(async () => {
    try {
      const data = await api('GET', '/api/admin/announcements');
      if (program.opts().json) { ok(data.announcements || []); return; }
      const list = data.announcements || [];
      if (!list.length) { console.log('（空）还没有公告，用 admin announcement add "内容" 发布'); return; }
      list.forEach(a => {
        console.log('  ' + (a.active ? '[显示中]' : '[已下线]') + ' ' + a.content.slice(0, 60) + (a.content.length > 60 ? '…' : '') + '   ' + (a.createdAt || '') + '  id:' + a.id);
      });
    } catch (e) { fail(e.message); }
  });

const announcementCmd = adminCmd.command('announcement').description('公告管理（管理员）：发布/上线下线/删除');

announcementCmd
  .command('add <content>')
  .description('发布公告（立即在首页公告栏滚动显示）')
  .action(async (content) => {
    try {
      const a = await api('POST', '/api/admin/announcements', { content: content });
      if (program.opts().json) { ok(a); return; }
      ok('公告已发布: ' + a.content.slice(0, 40) + '（id: ' + a.id + '）');
    } catch (e) { fail(e.message); }
  });

announcementCmd
  .command('toggle <id>')
  .description('上线/下线公告（切换显示状态）')
  .action(async (id) => {
    try {
      const list = (await api('GET', '/api/admin/announcements')).announcements || [];
      const cur = list.find(a => a.id === id);
      if (!cur) fail('公告不存在: ' + id);
      const a = await api('PUT', '/api/admin/announcements/' + id, { active: !cur.active });
      if (program.opts().json) { ok(a); return; }
      ok('公告已' + (a.active ? '上线（显示中）' : '下线'));
    } catch (e) { fail(e.message); }
  });

announcementCmd
  .command('delete <id>')
  .description('删除公告（不可恢复）')
  .action(async (id) => {
    try {
      const a = await api('DELETE', '/api/admin/announcements/' + id);
      if (program.opts().json) { ok(a); return; }
      ok('公告已删除: ' + id);
    } catch (e) { fail(e.message); }
  });

adminCmd
  .command('tutorials')
  .description('列出教程（待审核/已通过/全部，版主/管理员）')
  .option('--status <status>', 'pending / verified / all', 'pending')
  .action(async (opts) => {
    try {
      if (!['pending', 'verified', 'all'].includes(opts.status)) fail('--status 只能是 pending / verified / all');
      const status = opts.status;
      const items = await api('GET', '/api/admin/tutorials' + (status === 'all' ? '' : '?status=' + status));
      if (program.opts().json) { ok(items); return; }
      if (!items.length) { console.log(status === 'pending' ? '（空）没有待审核教程' : '（空）没有教程'); return; }
      items.forEach(t => {
        console.log('  ' + t.title + (t.verified ? ' [✓已通过]' : ' [待审核]'));
        console.log('    id: ' + t.id + ' | ' + (t.category || '-') + ' | 作者: ' + (t.authorName || '?'));
        if (t.summary) console.log('    ' + t.summary.slice(0, 80));
        console.log('');
      });
    } catch (e) { fail(e.message); }
  });

adminCmd
  .command('tutorial-verify <id>')
  .description('通过教程审核（版主/管理员）')
  .action(async (id) => {
    try {
      const t = await api('PUT', '/api/admin/tutorials/' + id + '/verify', { verified: true });
      if (program.opts().json) { ok(t); return; }
      ok('已通过教程审核: ' + t.title);
    } catch (e) { fail(e.message); }
  });

adminCmd
  .command('tutorial-unverify <id>')
  .description('取消教程审核（下线，版主/管理员）')
  .action(async (id) => {
    try {
      const t = await api('PUT', '/api/admin/tutorials/' + id + '/verify', { verified: false });
      if (program.opts().json) { ok(t); return; }
      ok('已下线教程: ' + t.title);
    } catch (e) { fail(e.message); }
  });

// ===== 发布 =====
program
  .command('add')
  .description('发布一条免费 Token（必填 --token 与 --url API base_url，自动测试通过后上线）')
  .option('-n, --name <name>', '名称')
  .option('-d, --desc <desc>', '描述')
  .option('-u, --url <url>', 'API base_url（厂商端点，必填，如 https://x-api.cfd/v1）')
  .option('-p, --provider <provider>', '提供商')
  .option('-c, --category <category>', '分类', '其他')
  .option('-t, --token <token>', 'Token 值（必填，本站只收录真实可用 Token）')
  .option('--token-type <type>', 'Token 类型（OpenAI / Anthropic / Gemini / OpenAI兼容）')
  .option('--tags <tags>', '标签，逗号分隔')
  .action(async (opts) => {
    if (!opts.name || !opts.url) fail('缺少必填项: --name 和 --url');
    if (!opts.token) fail('发布必须提供 --token（本站只收录真实可用 Token）');
    try {
      const data = await api('POST', '/api/items', {
        name: opts.name, desc: opts.desc || '', url: opts.url,
        provider: opts.provider || '', category: opts.category,
        token: opts.token || '', tokenType: opts.tokenType || '',
        tags: opts.tags ? opts.tags.split(',').map(s => s.trim()) : []
      });
      if (program.opts().json) { ok(data); return; }
      ok(`发布成功: ${data.name} (id: ${data.id})`);
    } catch (e) { fail(e.message); }
  });

// ===== 编辑 =====
program
  .command('edit <id>')
  .description('编辑自己发布的条目')
  .option('-n, --name <name>', '名称')
  .option('-d, --desc <desc>', '描述')
  .option('-u, --url <url>', '链接（发布带 Token 时填 API base_url，否则填官网/领取链接）')
  .option('-p, --provider <provider>', '提供商')
  .option('-c, --category <category>', '分类')
  .option('-t, --token <token>', 'Token 值')
  .option('--token-type <type>', 'Token 类型')
  .option('--tags <tags>', '标签，逗号分隔')
  .action(async (id, opts) => {
    try {
      const body = {};
      if (opts.name !== undefined) body.name = opts.name;
      if (opts.desc !== undefined) body.desc = opts.desc;
      if (opts.url !== undefined) body.url = opts.url;
      if (opts.provider !== undefined) body.provider = opts.provider;
      if (opts.category !== undefined) body.category = opts.category;
      if (opts.token !== undefined) body.token = opts.token;
      if (opts.tokenType !== undefined) body.tokenType = opts.tokenType;
      if (opts.tags !== undefined) body.tags = opts.tags.split(',').map(s => s.trim());
      if (Object.keys(body).length === 0) fail('至少提供一个要修改的字段');
      const data = await api('PUT', '/api/my/items/' + id, body);
      if (program.opts().json) { ok(data); return; }
      ok(`已更新: ${data.name}`);
    } catch (e) { fail(e.message); }
  });

// ===== 导入 =====
program
  .command('import <file>')
  .description('从 JSON 文件批量导入')
  .action(async (file) => {
    let items;
    try { items = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch (e) { fail('读取文件失败: ' + e.message); }
    if (!Array.isArray(items)) items = [items];
    let okc = 0, failc = 0;
    const failures = [];
    for (const item of items) {
      try { await api('POST', '/api/items', item); okc++; }
      catch (e) { failc++; failures.push({ item: item.name || 'untitled', error: e.message }); }
    }
    const result = { total: items.length, imported: okc, failed: failc, failures };
    if (program.opts().json) { ok(result); return; }
    if (failc) fail(`完成: ${okc}/${items.length} 条, ${failc} 失败`);
    ok(`完成: ${okc}/${items.length} 条`);
  });

// ===== 列出 =====
program
  .command('list')
  .alias('ls')
  .description('列出所有条目')
  .option('-c, --category <category>', '按分类筛选')
  .option('-s, --search <keyword>', '搜索关键词')
  .action(async (opts) => {
    try {
      const params = new URLSearchParams();
      if (opts.category) params.set('category', opts.category);
      if (opts.search) params.set('search', opts.search);
      const items = await api('GET', '/api/items' + (params.toString() ? '?' + params.toString() : ''));
      if (program.opts().json) {
        ok(items);
      } else {
        if (!items.length) { console.log('（空）还没有数据'); return; }
        console.log(`共 ${items.length} 条：\n`);
        items.forEach(i => {
          const tag = i.tokenType ? '[' + i.tokenType + ']' : '';
          console.log('  ' + i.name + ' ' + tag);
          console.log('    id: ' + i.id + ' | ' + (i.category || '-') + ' | ' + (i.provider || '-') + ' | ' + i.url);
          if (i.desc) console.log('    ' + i.desc);
          console.log('');
        });
      }
    } catch (e) { fail(e.message); }
  });

// ===== 最近发布（拉取 API Key，每日免费 5 次，超出扣积分） =====
program
  .command('recent')
  .description('拉取最近发布的 API Key（每日免费 5 次，超出后每次扣 1 积分；版主/管理员豁免）')
  .option('-n, --count <count>', '条数（默认 5，最多 20）', '5')
  .action(async (opts) => {
    const n = Math.min(Math.max(parseInt(opts.count, 10) || 5, 1), 20);
    try {
      const data = await api('GET', '/api/recent?limit=' + n);
      const items = data.items || [];
      if (!items.length) { console.log('（空）还没有已发布的 API Key'); return; }
      const keyItems = items.filter(i => i.token).slice(0, n);
      if (!keyItems.length) { console.log('（空）还没有已发布的 API Key'); return; }
      if (program.opts().json) {
        ok({ items: keyItems, freeUsed: data.freeUsed, pointsUsed: data.pointsUsed, pointsRemaining: data.pointsRemaining, freeLeftToday: data.freeLeftToday });
        return;
      }
      keyItems.forEach(function(i) {
        console.log('  ' + i.name + (i.tokenType ? ' [' + i.tokenType + ']' : ''));
        console.log('    Base URL: ' + (i.url || '-'));
        console.log('    API Key:  ' + (i.token || '-'));
        if (i.compat && i.compat.length) {
          console.log('    兼容: ' + i.compat.map(function(c) { return c === 'openai' ? 'OpenAI 兼容' : 'Anthropic 兼容'; }).join(' / '));
        }
        console.log('');
      });
      console.log('本次拉取 ' + keyItems.length + ' 个：免费 ' + data.freeUsed + ' 次 + 积分 ' + data.pointsUsed + ' 个；今日剩余免费 ' + data.freeLeftToday + '/5，剩余积分 ' + data.pointsRemaining);
    } catch (e) { fail(e.message); }
  });

// ===== 积分（余额 / 每日额度 / 明细） =====
program
  .command('points')
  .description('查看积分余额、每日免费拉取额度与积分明细')
  .action(async () => {
    try {
      const d = await api('GET', '/api/points');
      if (program.opts().json) { ok(d); return; }
      console.log('积分余额: ' + d.points);
      console.log('今日免费拉取: ' + d.pullCountToday + '/' + d.freePullsPerDay + '（剩余 ' + d.freeLeftToday + '）');
      console.log('—— 积分明细（最近） ——');
      if (!d.log || !d.log.length) { console.log('（暂无记录）发布 Token/教程/Skill 审核通过 +1，邀请/测评/首单有奖，拉取超额/查看 -1'); return; }
      var reasonLabel = { item_verify: '发布 Token', tutorial_verify: '教程通过', skill_verify: 'Skill 通过', skill_first_sale: 'Skill 首单', skill_review: 'Skill 测评', feedback_verify: '反馈认可', invite: '邀请奖励', pull: '拉取消耗', view: '查看 Token', tip: '打赏支出', tip_received: '被打赏', skill_buy: '购买 Skill', skill_sell: 'Skill 售出', checkin: '每日签到' };
      d.log.forEach(function(l) {
        var label = (reasonLabel[l.reason] || (l.delta > 0 ? '奖励' : '消耗')) + ' ' + (l.delta > 0 ? '+' : '') + l.delta;
        console.log('  ' + label + '  ' + String(l.created_at || '').slice(0, 19));
      });
    } catch (e) { fail(e.message); }
  });

// ===== 每日签到 =====
program
  .command('checkin')
  .description('每日签到打卡（每日一次 +1 积分，连击 7 天额外 +2，30 天额外 +5）')
  .option('-s, --status', '仅查看签到状态和日历，不执行签到')
  .action(async (opts) => {
    try {
      if (opts.status) {
        const s = await api('GET', '/api/checkin');
        if (program.opts().json) { ok(s); return; }
        console.log('今日: ' + s.today + (s.checkedToday ? ' ✓ 已签到' : ' ○ 未签到'));
        console.log('连续签到: ' + s.streak + ' 天 | 累计: ' + s.total + ' 天 | 积分: ' + s.points);
        if (s.lastCheckinDate) console.log('上次签到: ' + s.lastCheckinDate);
        console.log('本月签到: ' + (s.calendar && s.calendar.length ? s.calendar.join(', ') : '（本月暂无）'));
        return;
      }
      const r = await api('POST', '/api/checkin', {});
      if (program.opts().json) { ok(r); return; }
      if (r.already) console.log('今日已签到 · 连续 ' + r.streak + ' 天');
      else console.log('签到成功 +' + r.points + ' 积分 · 连续 ' + r.streak + ' 天 · 总积分 ' + r.pointsTotal);
    } catch (e) { fail(e.message); }
  });

// ===== 我的发布 =====
program
  .command('my')
  .description('查看我的发布条目和统计')
  .option('-s, --stats', '仅显示统计')
  .action(async (opts) => {
    try {
      if (opts.stats) {
        const stats = await api('GET', '/api/my/stats');
        if (program.opts().json) { ok(stats); return; }
        console.log(`发布总数: ${stats.total}\n已验证: ${stats.verified}\n待验证: ${stats.total - stats.verified}`);
        return;
      }
      const [items, stats] = await Promise.all([
        api('GET', '/api/my/items'),
        api('GET', '/api/my/stats')
      ]);
      if (program.opts().json) {
        ok({ items, stats });
      } else {
        console.log(`发布总数: ${stats.total} | 已验证: ${stats.verified} | 待验证: ${stats.total - stats.verified}\n`);
        if (!items.length) { console.log('还没有发布任何 Token'); return; }
        items.forEach(i => {
          const tag = i.tokenType ? '[' + i.tokenType + ']' : '';
          console.log('  ' + i.name + ' ' + tag + (i.verified ? ' ✓' : ''));
          console.log('    id: ' + i.id + ' | ' + (i.category || '-') + ' | ' + (i.provider || '-'));
          if (i.desc) console.log('    ' + i.desc.slice(0, 80));
          console.log('');
        });
      }
    } catch (e) { fail(e.message); }
  });

// ===== 图片上传（教程封面 / 正文插图） =====
program
  .command('upload <file>')
  .description('上传本地图片到本站（PNG/JPG/WebP/GIF，≤3MB，每日 20 张），返回 /uploads/xxx.png——供教程 --cover 封面或正文插图 ![alt](地址) 使用')
  .action(async (file) => {
    let buf;
    try { buf = fs.readFileSync(file); } catch (e) { fail('读取文件失败: ' + e.message); }
    const ext = require('path').extname(file).toLowerCase().replace('.', '');
    const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }[ext];
    if (!mime) fail('仅支持 PNG/JPG/WebP/GIF 图片');
    if (buf.length > 3 * 1024 * 1024) fail('图片过大，请压缩到 3MB 以内');
    const t = getToken();
    if (!t.token) fail('请先登录（freeapis-cli login -u 用户名 -p 密码，或 login -t <token>）');
    let res;
    try {
      res = await fetch(`${BASE_URL}/api/upload`, { method: 'POST', headers: { 'Content-Type': mime, 'Authorization': 'Bearer ' + t.token }, body: buf });
    } catch (e) { fail('无法连接服务器 ' + BASE_URL); }
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!res.ok) fail(data.error || data.raw || `HTTP ${res.status}`);
    if (program.opts().json) { ok(data); return; }
    ok(`上传成功: ${data.url}`);
    console.log('  · 作为教程封面：--cover ' + data.url);
    console.log('  · 作为正文插图：![图片说明](' + data.url + ')');
  });

// ===== 教程（社区共同发布，Markdown 正文） =====
const tutorialCmd = program.command('tutorial').description('教程管理：发布/浏览/管理 AI 教程');

tutorialCmd
  .command('add')
  .description('发布一篇教程（--content 传 Markdown 正文，或 --file 读本地 .md 文件，长文推荐用 --file）')
  .option('--title <title>', '标题（必填）')
  .option('--summary <summary>', '摘要（可选，默认取正文前 120 字）')
  .option('--category <category>', '分类（教程/API 接入/OpenAI/Anthropic/Gemini/DeepSeek/Moonshot/通义千问/大模型科普/经验分享/其他）', '教程')
  .option('--tags <tags>', '标签，逗号分隔')
  .option('--content <content>', '正文（Markdown）')
  .option('--file <file>', '从本地 .md 文件读取正文（与 --content 二选一）')
  .option('--cover <cover>', '封面图：先 freeapis-cli upload 本地图片拿到 /uploads/xxx.png，或填 https://... 外链（可选，不填用分类渐变封面）')
  .action(async (opts) => {
    if (!opts.title) fail('请提供 --title 标题');
    let content = opts.content;
    if (opts.file) {
      try { content = fs.readFileSync(opts.file, 'utf-8'); } catch (e) { fail('读取文件失败: ' + e.message); }
    }
    if (!content || !content.trim()) fail('请提供 --content 正文或 --file 文件');
    try {
      const data = await api('POST', '/api/tutorials', {
        title: opts.title, summary: opts.summary || '', category: opts.category,
        tags: opts.tags ? opts.tags.split(',').map(s => s.trim()) : [],
        cover: opts.cover || '',
        content
      });
      if (program.opts().json) { ok(data); return; }
      ok(`教程已发布: ${data.title} (id: ${data.id})，等待版主审核`);
    } catch (e) { fail(e.message); }
  });

tutorialCmd
  .command('list')
  .description('列出已公开的教程（可按分类/关键词筛选）')
  .option('-c, --category <category>', '按分类筛选')
  .option('-s, --search <keyword>', '按标题/摘要搜索关键词')
  .option('-n, --count <count>', '条数（默认 20，最多 50）', '20')
  .action(async (opts) => {
    const n = Math.min(Math.max(parseInt(opts.count, 10) || 20, 1), 50);
    try {
      const params = new URLSearchParams({ limit: String(n) });
      if (opts.category) params.set('category', opts.category);
      if (opts.search) params.set('search', opts.search);
      const items = await api('GET', '/api/tutorials?' + params.toString());
      if (program.opts().json) { ok(items); return; }
      if (!items.length) { console.log('（空）没有匹配的教程'); return; }
      items.forEach(t => {
        console.log('  ' + t.title + ' [' + (t.category || '-') + ']');
        console.log('    id: ' + t.id + ' | 作者: ' + (t.authorName || '?') + ' | ' + String(t.createdAt || '').slice(0, 10));
        if (t.summary) console.log('    ' + t.summary.slice(0, 80));
        console.log('');
      });
    } catch (e) { fail(e.message); }
  });

tutorialCmd
  .command('search <keyword>')
  .description('按标题/摘要搜索已公开的教程')
  .action(async (keyword) => {
    try {
      const items = await api('GET', '/api/tutorials?search=' + encodeURIComponent(keyword) + '&limit=50');
      if (program.opts().json) { ok(items); return; }
      if (!items.length) { console.log('没有找到包含 "' + keyword + '" 的教程'); return; }
      items.forEach(t => console.log('  ' + t.title + ' [' + (t.category || '-') + '] - id: ' + t.id));
    } catch (e) { fail(e.message); }
  });

tutorialCmd
  .command('my')
  .description('查看我发布的教程')
  .action(async () => {
    try {
      const items = await api('GET', '/api/my/tutorials');
      if (program.opts().json) { ok(items); return; }
      if (!items.length) { console.log('还没有发布任何教程'); return; }
      items.forEach(t => {
        console.log('  ' + t.title + (t.verified ? ' ✓已通过' : ' 待审核'));
        console.log('    id: ' + t.id + ' | ' + (t.category || '-') + ' | ' + String(t.createdAt || '').slice(0, 10));
        console.log('');
      });
    } catch (e) { fail(e.message); }
  });

tutorialCmd
  .command('view <id>')
  .description('查看一篇教程全文（Markdown）')
  .action(async (id) => {
    try {
      const t = await api('GET', '/api/tutorials/' + id);
      if (program.opts().json) { ok(t); return; }
      console.log(t.title + '  [' + (t.category || '-') + ']');
      console.log('作者: ' + (t.authorName || '?') + ' | ' + String(t.createdAt || '').slice(0, 10) + (t.verified ? '' : '（待审核）'));
      if (t.cover) console.log('封面: ' + t.cover);
      console.log('\n' + t.content);
    } catch (e) { fail(e.message); }
  });

tutorialCmd
  .command('edit <id>')
  .description('编辑自己发布的教程')
  .option('--title <title>', '标题')
  .option('--summary <summary>', '摘要')
  .option('--category <category>', '分类')
  .option('--tags <tags>', '标签，逗号分隔')
  .option('--content <content>', '正文（Markdown）')
  .option('--file <file>', '从本地 .md 文件读取正文')
  .option('--cover <cover>', '封面图：freeapis-cli upload 得到的 /uploads/xxx.png 或 https://... 外链（传空值可移除封面）')
  .action(async (id, opts) => {
    try {
      const body = {};
      if (opts.title !== undefined) body.title = opts.title;
      if (opts.summary !== undefined) body.summary = opts.summary;
      if (opts.category !== undefined) body.category = opts.category;
      if (opts.tags !== undefined) body.tags = opts.tags.split(',').map(s => s.trim());
      if (opts.file) { try { body.content = fs.readFileSync(opts.file, 'utf-8'); } catch (e) { fail('读取文件失败: ' + e.message); } }
      else if (opts.content !== undefined) body.content = opts.content;
      if (opts.cover !== undefined) body.cover = opts.cover;
      if (Object.keys(body).length === 0) fail('至少提供一个要修改的字段');
      const data = await api('PUT', '/api/my/tutorials/' + id, body);
      if (program.opts().json) { ok(data); return; }
      ok('已更新: ' + data.title);
    } catch (e) { fail(e.message); }
  });

tutorialCmd
  .command('delete <id>')
  .description('删除自己发布的一篇教程')
  .action(async (id) => {
    try {
      await api('DELETE', '/api/my/tutorials/' + id);
      if (program.opts().json) { ok({ id }); return; }
      ok('已删除: ' + id);
    } catch (e) { fail(e.message); }
  });

// ===== Skill 广场 =====
const skillCmd = program.command('skill').description('Skill 广场：发布/浏览/购买 AI Agent Skill');

skillCmd
  .command('add')
  .description('发布一个 Skill（--zip 上传压缩包推荐，或 --content 传正文，或 --file 读本地 .md）')
  .option('--title <title>', '标题（必填）')
  .option('--summary <summary>', '摘要（可选）')
  .option('--description <description>', '描述（可选，Markdown）')
  .option('--category <category>', '分类（通用/提示词/工具集/开发/测试/其他）', '通用')
  .option('--tags <tags>', '标签，逗号分隔')
  .option('--price <price>', '价格（积分，0 表示免费）', '0')
  .option('--cover <cover>', '封面图 URL（/uploads/... 或 https://...）')
  .option('--zip <zip>', '上传 zip 压缩包（推荐，根目录需含 SKILL.md）')
  .option('--content <content>', 'Skill 内容（Markdown）')
  .option('--file <file>', '从本地 .md 文件读取内容（与 --content 二选一）')
  .action(async (opts) => {
    if (!opts.title) fail('请提供 --title 标题');
    let packageId = '';
    if (opts.zip) {
      try {
        const buf = fs.readFileSync(opts.zip);
        if (buf.length > 10 * 1024 * 1024) fail('压缩包不能超过 10MB');
        const upload = await api('POST', '/api/skills/package', buf, { raw: true, contentType: 'application/zip' });
        packageId = upload.packageId;
        if (program.opts().json) {
          // json 模式下继续走发布流程
        } else {
          console.log('  已上传压缩包: ' + (upload.fileCount || '?') + ' 个文件，' + (upload.totalKB || '?') + ' KB');
        }
      } catch (e) { fail('压缩包上传失败: ' + e.message); }
    }
    let content = opts.content;
    if (opts.file) {
      try { content = fs.readFileSync(opts.file, 'utf-8'); } catch (e) { fail('读取文件失败: ' + e.message); }
    }
    if (!packageId && (!content || !content.trim())) fail('请提供 --zip 压缩包，或 --content 内容 / --file 文件');
    try {
      const data = await api('POST', '/api/skills', {
        title: opts.title, summary: opts.summary || '', description: opts.description || '',
        category: opts.category, tags: opts.tags ? opts.tags.split(',').map(s => s.trim()) : [],
        price: parseInt(opts.price, 10) || 0, cover: opts.cover || '', content: content || '', packageId
      });
      if (program.opts().json) { ok(data); return; }
      ok(`Skill 已发布: ${data.title} (id: ${data.id})，等待版主审核`);
    } catch (e) { fail(e.message); }
  });

skillCmd
  .command('list')
  .description('列出已公开的 Skill（可按分类/关键词筛选）')
  .option('-c, --category <category>', '按分类筛选')
  .option('-s, --search <keyword>', '按标题/摘要搜索关键词')
  .option('--free', '只看免费')
  .option('--paid', '只看付费')
  .option('-n, --count <count>', '条数（默认 20，最多 100）', '20')
  .action(async (opts) => {
    const n = Math.min(Math.max(parseInt(opts.count, 10) || 20, 1), 100);
    try {
      const params = new URLSearchParams({ limit: String(n) });
      if (opts.category) params.set('category', opts.category);
      if (opts.search) params.set('search', opts.search);
      if (opts.free) params.set('free', '1');
      if (opts.paid) params.set('paid', '1');
      const data = await api('GET', '/api/skills?' + params.toString());
      const items = data.items || data;
      if (program.opts().json) { ok(items); return; }
      if (!items.length) { console.log('（空）没有匹配的 Skill'); return; }
      items.forEach(s => {
        const price = s.price > 0 ? s.price + ' 积分' : '免费';
        console.log('  ' + s.title + ' [' + (s.category || '-') + '] - ' + price);
        console.log('    id: ' + s.id + ' | 作者: ' + (s.authorName || '?') + ' | ' + String(s.createdAt || '').slice(0, 10));
        if (s.summary) console.log('    ' + s.summary.slice(0, 80));
        console.log('');
      });
    } catch (e) { fail(e.message); }
  });

skillCmd
  .command('search <keyword>')
  .description('按标题/摘要搜索已公开的 Skill')
  .action(async (keyword) => {
    try {
      const data = await api('GET', '/api/skills?search=' + encodeURIComponent(keyword) + '&limit=50');
      const items = data.items || data;
      if (program.opts().json) { ok(items); return; }
      if (!items.length) { console.log('没有找到包含 "' + keyword + '" 的 Skill'); return; }
      items.forEach(s => console.log('  ' + s.title + ' [' + (s.category || '-') + '] - id: ' + s.id));
    } catch (e) { fail(e.message); }
  });

skillCmd
  .command('my')
  .description('查看我发布的 Skill')
  .action(async () => {
    try {
      const items = await api('GET', '/api/my/skills');
      if (program.opts().json) { ok(items); return; }
      if (!items.length) { console.log('还没有发布任何 Skill'); return; }
      items.forEach(s => {
        const status = s.status === 'online' ? ' ✓已上线' : s.status === 'pending' ? ' 待审核' : s.status === 'rejected' ? ' 已拒绝' : ' 已下架';
        console.log('  ' + s.title + status);
        console.log('    id: ' + s.id + ' | ' + (s.category || '-') + ' | ' + String(s.createdAt || '').slice(0, 10));
        console.log('');
      });
    } catch (e) { fail(e.message); }
  });

skillCmd
  .command('view <id>')
  .description('查看一个 Skill 详情（含内容，需登录且已购买/免费/作者）')
  .action(async (id) => {
    try {
      const s = await api('GET', '/api/skills/' + id);
      if (program.opts().json) { ok(s); return; }
      console.log(s.title + '  [' + (s.category || '-') + '] - ' + (s.price > 0 ? s.price + ' 积分' : '免费'));
      console.log('作者: ' + (s.authorName || '?') + ' | ' + String(s.createdAt || '').slice(0, 10) + (s.status === 'online' ? '' : '（' + s.status + '）'));
      if (s.cover) console.log('封面: ' + s.cover);
      if (s.content) console.log('\n' + s.content);
      else console.log('\n（需购买后才能查看完整内容）');
    } catch (e) { fail(e.message); }
  });

skillCmd
  .command('edit <id>')
  .description('编辑自己发布的 Skill')
  .option('--title <title>', '标题')
  .option('--summary <summary>', '摘要')
  .option('--description <description>', '描述')
  .option('--category <category>', '分类')
  .option('--tags <tags>', '标签，逗号分隔')
  .option('--price <price>', '价格（积分）')
  .option('--cover <cover>', '封面图 URL（/uploads/... 或 https://...，传空字符串可移除）')
  .option('--content <content>', '内容（Markdown）')
  .option('--file <file>', '从本地 .md 文件读取内容')
  .action(async (id, opts) => {
    try {
      const body = {};
      if (opts.title !== undefined) body.title = opts.title;
      if (opts.summary !== undefined) body.summary = opts.summary;
      if (opts.description !== undefined) body.description = opts.description;
      if (opts.category !== undefined) body.category = opts.category;
      if (opts.tags !== undefined) body.tags = opts.tags.split(',').map(s => s.trim());
      if (opts.price !== undefined) body.price = parseInt(opts.price, 10) || 0;
      if (opts.cover !== undefined) body.cover = opts.cover;
      if (opts.file) { try { body.content = fs.readFileSync(opts.file, 'utf-8'); } catch (e) { fail('读取文件失败: ' + e.message); } }
      else if (opts.content !== undefined) body.content = opts.content;
      if (Object.keys(body).length === 0) fail('至少提供一个要修改的字段');
      const data = await api('PUT', '/api/my/skills/' + id, body);
      if (program.opts().json) { ok(data); return; }
      ok('已更新: ' + data.title + '（重新审核中）');
    } catch (e) { fail(e.message); }
  });

skillCmd
  .command('delete <id>')
  .description('下架自己发布的一个 Skill')
  .action(async (id) => {
    try {
      await api('DELETE', '/api/my/skills/' + id);
      if (program.opts().json) { ok({ id }); return; }
      ok('已下架: ' + id);
    } catch (e) { fail(e.message); }
  });

skillCmd
  .command('buy <id>')
  .description('用积分购买一个付费 Skill（0% 平台抽成，作者全额获得）')
  .action(async (id) => {
    try {
      const data = await api('POST', '/api/skills/' + id + '/buy');
      if (program.opts().json) { ok(data); return; }
      if (data.free) ok('已获得免费 Skill: ' + id);
      else ok('购买成功！已扣除 ' + data.price + ' 积分，作者全额获得');
    } catch (e) { fail(e.message); }
  });

skillCmd
  .command('purchases')
  .description('查看我购买的 Skill')
  .action(async () => {
    try {
      const items = await api('GET', '/api/my/purchases');
      if (program.opts().json) { ok(items); return; }
      if (!items.length) { console.log('还没有购买任何 Skill'); return; }
      items.forEach(p => {
        console.log('  ' + (p.title || p.skill_id) + ' - ' + (p.price > 0 ? p.price + ' 积分' : '免费'));
        console.log('    购买于: ' + String(p.created_at || '').slice(0, 10));
        console.log('');
      });
    } catch (e) { fail(e.message); }
  });

// Skill 审核命令（版主+）
const skillAdminCmd = program.command('skill-admin').description('Skill 审核管理（版主+）');

skillAdminCmd
  .command('list')
  .description('列出待审核/已上线/已拒绝的 Skill')
  .option('-s, --status <status>', '状态筛选：pending/online/rejected/offline/all', 'pending')
  .action(async (opts) => {
    try {
      const params = new URLSearchParams();
      if (opts.status && opts.status !== 'all') params.set('status', opts.status);
      const data = await api('GET', '/api/admin/skills?' + params.toString());
      if (program.opts().json) { ok(data); return; }
      if (!data.length) { console.log('（空）没有匹配的 Skill'); return; }
      data.forEach(s => {
        const status = s.status === 'online' ? ' ✓已上线' : s.status === 'pending' ? ' 待审核' : s.status === 'rejected' ? ' 已拒绝' : ' 已下架';
        console.log('  ' + s.title + status);
        console.log('    id: ' + s.id + ' | 作者: ' + (s.authorName || '?') + ' | ' + String(s.createdAt || '').slice(0, 10));
        if (s.price > 0) console.log('    价格: ' + s.price + ' 积分');
        console.log('');
      });
    } catch (e) { fail(e.message); }
  });

skillAdminCmd
  .command('verify <id>')
  .description('通过一个 Skill 审核')
  .action(async (id) => {
    try {
      await api('PUT', '/api/admin/skills/' + id + '/verify');
      if (program.opts().json) { ok({ id, status: 'online' }); return; }
      ok('已通过审核: ' + id);
    } catch (e) { fail(e.message); }
  });

skillAdminCmd
  .command('reject <id>')
  .description('拒绝一个 Skill（需附理由）')
  .option('-r, --reason <reason>', '拒绝理由（1-200 字）', '')
  .action(async (id, opts) => {
    try {
      const reason = opts.reason || '内容不符合要求';
      await api('PUT', '/api/admin/skills/' + id + '/reject', { reason });
      if (program.opts().json) { ok({ id, status: 'rejected', reason }); return; }
      ok('已拒绝: ' + id + '（理由: ' + reason + '）');
    } catch (e) { fail(e.message); }
  });

// ===== 单条详情 / 用户 / 公告 / 打赏 =====
program
  .command('view <id>')
  .description('查看单条 Token 详情（公开或自己的未审核）')
  .action(async (id) => {
    try {
      const item = await api('GET', '/api/items/' + encodeURIComponent(id));
      if (program.opts().json) { ok(item); return; }
      console.log('名称: ' + item.name);
      console.log('URL: ' + (item.url || '-'));
      console.log('提供商: ' + (item.provider || '-'));
      console.log('分类: ' + (item.category || '-'));
      console.log('Token类型: ' + (item.tokenType || '-'));
      if (item.models && item.models.length) console.log('可用模型: ' + item.models.slice(0, 8).join(', '));
      if (item.desc) console.log('描述: ' + item.desc);
      console.log('验证: ' + (item.verified ? '已上线' : '待审核') + (item.tipCount ? ' · 被认可 ' + item.tipCount + ' 次' : ''));
    } catch (e) { fail(e.message); }
  });

program
  .command('user <id>')
  .description('查看用户主页（贡献/教程/被认可数）')
  .action(async (id) => {
    try {
      const data = await api('GET', '/api/users/' + encodeURIComponent(id));
      if (program.opts().json) { ok(data); return; }
      const u = data.user || {};
      console.log('用户: ' + (u.nickname || u.username || id) + ' (' + u.username + ')');
      console.log('角色: ' + (u.role || 'user') + ' | 积分: ' + (u.points || 0));
      console.log('贡献 Token: ' + (data.stats ? data.stats.items : 0) + ' | 通过教程: ' + (data.stats ? data.stats.tutorials : 0) + ' | 被认可: ' + (data.tipCount || 0));
      if (data.items && data.items.length) {
        console.log('—— 贡献条目 ——');
        data.items.slice(0, 10).forEach(function(it){ console.log('  ' + it.name + ' (' + (it.verified ? '已上线' : '待审核') + ') - ' + it.id); });
      }
    } catch (e) { fail(e.message); }
  });

program
  .command('announcements')
  .description('查看首页公告（公开）')
  .option('-n, --limit <n>', '数量', '10')
  .action(async (opts) => {
    try {
      const n = parseInt(opts.limit, 10) || 10;
      const data = await api('GET', '/api/announcements?limit=' + n);
      const list = Array.isArray(data) ? data : (data.announcements || data || []);
      if (program.opts().json) { ok(list); return; }
      if (!list.length) { console.log('暂无公告'); return; }
      list.forEach(function(a){ console.log('  ' + String(a.createdAt||a.created_at||'').slice(0,10) + '  ' + a.content.slice(0,120)); });
    } catch (e) { fail(e.message); }
  });

program
  .command('tip <id>')
  .description('打赏 1 积分给条目作者（仅已上线非本人，幂等一次）')
  .action(async (id) => {
    try {
      const data = await api('POST', '/api/items/' + encodeURIComponent(id) + '/tip', {});
      if (program.opts().json) { ok(data); return; }
      console.log('已打赏 ' + id + (data.tipCount ? ' · 被认可 ' + data.tipCount + ' 次' : ''));
    } catch (e) { fail(e.message); }
  });

const commentCmd = program.command('comment').description('评论：留言墙/条目评论');
commentCmd
  .command('list')
  .description('查看评论（默认留言墙，--item <id> 查看条目评论）')
  .option('-n, --limit <n>', '数量', '20')
  .option('--item <id>', '条目 id（指定则查看该条目的评论）')
  .action(async (opts) => {
    try {
      const n = parseInt(opts.limit, 10) || 20;
      const url = opts.item ? '/api/items/' + encodeURIComponent(opts.item) + '/comments?limit=' + n : '/api/comments?limit=' + n;
      const data = await api('GET', url);
      const list = Array.isArray(data) ? data : (data.comments || data || []);
      if (program.opts().json) { ok(list); return; }
      if (!list || !list.length) { console.log('暂无评论'); return; }
      list.forEach(function(c){ console.log('  [' + String(c.createdAt||c.created_at||'').slice(0,16) + '] ' + (c.authorName||c.username||'?') + ': ' + c.content + ' (' + c.id + ')'); });
    } catch (e) { fail(e.message); }
  });
commentCmd
  .command('add <content>')
  .description('发表评论（默认留言墙，--item <id> 发到条目）')
  .option('--item <id>', '条目 id')
  .action(async (content, opts) => {
    try {
      const url = opts.item ? '/api/items/' + encodeURIComponent(opts.item) + '/comments' : '/api/comments';
      const data = await api('POST', url, { content });
      if (program.opts().json) { ok(data); return; }
      console.log('已发表: ' + (data.id || 'ok') + ' — ' + content.slice(0,60));
    } catch (e) { fail(e.message); }
  });
commentCmd
  .command('delete <id>')
  .description('删除一条评论（作者或版主）')
  .action(async (id) => {
    try {
      await api('DELETE', '/api/comments/' + encodeURIComponent(id));
      if (program.opts().json) { ok({ id }); return; }
      console.log('已删除: ' + id);
    } catch (e) { fail(e.message); }
  });

const feedbackCmd = program.command('feedback').description('公社信箱：反馈/Bug 上报（需登录）');
feedbackCmd
  .command('add <content>')
  .description('提交反馈/Bug')
  .option('-k, --kind <kind>', '类型 feedback|bug', 'feedback')
  .option('--url <url>', '相关页面 URL')
  .option('--image <path>', '附带图片本地路径（PNG/JPG/WebP/GIF ≤3MB）')
  .action(async (content, opts) => {
    try {
      let image = '';
      if (opts.image) {
        const fs2 = require('fs'), path2 = require('path');
        const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
        const ext = path2.extname(opts.image).toLowerCase();
        const mime = mimeMap[ext] || 'image/png';
        const buf = fs2.readFileSync(opts.image);
        if (buf.length > 3 * 1024 * 1024) throw new Error('图片超过 3MB');
        const t = getToken();
        if (!t.token) throw new Error('请先登录');
        const res = await fetch(`${BASE_URL}/api/upload`, { method: 'POST', headers: { 'Content-Type': mime, 'Authorization': 'Bearer ' + t.token }, body: buf });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || '图片上传失败');
        image = d.url || '';
      }
      const body = { kind: opts.kind === 'bug' ? 'bug' : 'feedback', content, url: opts.url || '', image };
      const data = await api('POST', '/api/feedback', body);
      if (program.opts().json) { ok(data); return; }
      console.log('已提交反馈' + (data.id ? ' ' + data.id : '') + ' — ' + content.slice(0,60) + (image ? ' [图:' + image + ']' : ''));
    } catch (e) { fail(e.message); }
  });

// 管理员：反馈审核（版主+）
const adminFeedbackCmd = adminCmd.command('feedback').description('反馈审核（版主+）：查看/通过加分/删除');
adminFeedbackCmd
  .command('list')
  .description('查看反馈列表')
  .option('-s, --status <status>', '状态 open|done|all', 'open')
  .action(async (opts) => {
    try {
      const s = (opts.status === 'done' ? 'done' : opts.status === 'all' ? 'all' : 'open');
      const q = s === 'all' ? '' : '?status=' + s;
      const data = await api('GET', '/api/admin/feedback' + q);
      const list = Array.isArray(data) ? data : (data.feedback || data || []);
      if (program.opts().json) { ok(list); return; }
      if (!list || !list.length) { console.log('暂无反馈 (' + s + ')'); return; }
      list.forEach(function(f){ console.log('  [' + f.status + '] ' + f.kind + ' ' + String(f.createdAt||f.created_at||'').slice(0,16) + ' ' + f.content.slice(0,80) + ' (' + f.id + ')'); });
    } catch (e) { fail(e.message); }
  });
adminFeedbackCmd
  .command('verify <id>')
  .description('通过并给作者 +1 积分（幂等）')
  .action(async (id) => {
    try {
      const data = await api('POST', '/api/admin/feedback/' + encodeURIComponent(id) + '/verify', {});
      if (program.opts().json) { ok(data); return; }
      console.log('已通过并加分: ' + id);
    } catch (e) { fail(e.message); }
  });
adminFeedbackCmd
  .command('delete <id>')
  .description('删除一条反馈')
  .action(async (id) => {
    try {
      await api('DELETE', '/api/admin/feedback/' + encodeURIComponent(id));
      if (program.opts().json) { ok({ id }); return; }
      console.log('已删除反馈: ' + id);
    } catch (e) { fail(e.message); }
  });

// ===== 搜索 =====
program
  .command('search <keyword>')
  .description('搜索条目')
  .action(async (keyword) => {
    try {
      const items = await api('GET', '/api/items?search=' + encodeURIComponent(keyword));
      if (program.opts().json) { ok(items); return; }
      if (!items.length) { console.log('没有找到包含 "' + keyword + '" 的条目'); return; }
      items.forEach(i => console.log('  ' + i.name + ' - ' + i.url));
    } catch (e) { fail(e.message); }
  });

// ===== 删除 =====
program
  .command('delete <id>')
  .alias('rm')
  .description('删除一条自己发布的条目')
  .action(async (id) => {
    try {
      await api('DELETE', '/api/my/items/' + id);
      if (program.opts().json) { ok({ id }); return; }
      ok('已删除: ' + id);
    } catch (e) { fail(e.message); }
  });

// ===== 统计 =====
program
  .command('stats')
  .description('查看站点统计')
  .action(async () => {
    try {
      const data = await api('GET', '/api/stats');
      if (program.opts().json) { ok(data); return; }
      console.log('总条目: ' + data.total + '\n分类数: ' + data.categories + '\n提供商数: ' + data.providers);
    } catch (e) { fail(e.message); }
  });

// ===== 测试 Token =====
program
  .command('test-token <token>')
  .description('测试 Token 是否可用')
  .option('-t, --type <type>', '类型（OpenAI / Anthropic / Gemini）', 'OpenAI')
  .option('-u, --url <url>', '自定义 base_url（厂商端点，如 https://x-api.cfd/v1）')
  .option('-m, --model <model>', '模型名（测试 Anthropic 兼容端点时建议提供）')
  .action(async (tokenVal, opts) => {
    try {
      const body = { token: tokenVal, tokenType: opts.type };
      if (opts.url) body.baseUrl = opts.url;
      if (opts.model) body.model = opts.model;
      const data = await api('POST', '/api/test-token', body);
      if (program.opts().json) {
        // 顶层 ok 反映 token 是否有效，避免外层 ok:true 与内层 data.ok:false 语义冲突
        if (data.ok) { ok(data); return; }
        fail(data.error || 'Token 无效');
      }
      if (data.ok) {
        console.log('Token 有效');
        console.log('  端点: ' + (data.endpoint || '-'));
        if (data.url) console.log('  地址: ' + data.url);
        if (data.models && data.models.length) console.log('  可用模型: ' + data.models.map(function(m) { return m.id || m.name || m; }).join(', ').slice(0, 300));
      } else {
        console.log('Token 无效: ' + (data.error || '未知错误'));
      }
    } catch (e) { fail(e.message); }
  });

// ===== 中转站掺水检测 =====
// 输入任意中转站 Base URL + API Key：不指定 -m 只识别端点+模型列表；指定 -m 对该模型做掺水检测（评分+逐项结论）
// 注意：`verify <id>` 已被"条目审核通过"占用，本命令命名 verify-relay（对应 /verify 页 + /api/verify）
program
  .command('verify-relay')
  .description('中转站掺水检测：识别模型换皮 / 高配低卖 / 伪装推理模型')
  .requiredOption('-u, --url <url>', '中转站 Base URL（如 https://api.example.com/v1）')
  .requiredOption('-t, --token <token>', 'API Key')
  .option('-T, --type <type>', '类型（OpenAI / Anthropic，不填自动识别）')
  .option('-m, --model <model>', '模型名（指定则对该模型做掺水检测，否则只识别端点+模型列表）')
  .action(async (opts) => {
    try {
      const body = { baseUrl: opts.url, token: opts.token };
      if (opts.type) body.tokenType = opts.type;
      const json = program.opts().json;
      const mark = function (c) { return c.status === 'pass' ? '✓' : (c.status === 'warn' ? '⚠' : '✗'); };
      if (opts.model) {
        body.model = opts.model;
        const data = await api('POST', '/api/verify/model', body);
        if (!data.ok) { fail(data.error || '检测失败'); return; }
        if (json) { ok({ model: data.model, score: data.score, verdict: data.verdict, latencyMs: data.latencyMs, checks: data.checks }); return; }
        console.log('模型「' + data.model + '」评分 ' + data.score + ' / 判定: ' + data.verdict + '（' + (data.latencyMs || 0) + 'ms）');
        (data.checks || []).forEach(function (c) { console.log('  ' + mark(c) + ' ' + c.label + ' — ' + c.detail); });
      } else {
        const data = await api('POST', '/api/verify', body);
        if (!data.ok) { fail(data.error || '端点检测失败'); return; }
        if (json) { ok({ compat: data.compat, type: data.type, models: data.models, checks: data.checks }); return; }
        console.log('兼容模式: ' + (data.compat || []).join(' + ') + '（' + (data.type || '-') + '）');
        console.log('识别模型 ' + (data.models || []).length + ' 个: ' + (data.models || []).map(function (m) { return m.id || m.name || m; }).join(', ').slice(0, 300));
        (data.checks || []).forEach(function (c) { console.log('  ' + mark(c) + ' ' + c.label + ' — ' + c.detail); });
        console.log('提示: 对单个模型做掺水检测，加 -m <模型名>');
      }
    } catch (e) { fail(e.message); }
  });

// ===== Ping =====
program
  .command('ping')
  .description('检查服务器连通性')
  .action(async () => {
    try {
      const data = await api('GET', '/api/health');
      if (program.opts().json) { ok({ status: 'ok', uptime: data.uptime, version: program.version() }); return; }
      ok('服务器连接正常 (uptime: ' + Math.round(data.uptime) + 's)');
    } catch (e) { fail(e.message); }
  });

program.parse();
