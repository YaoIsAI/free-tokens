// 文档一致性守护测试：防止文档与代码脱节（外部 AI 接管依赖文档准确）
// 校验：CLI 版本号六处同步（cli.js/CLAUDE.md/AGENT.md/SOP/ADMIN-ACCOUNT.md/server.js + tgz 存在）、
//       Nginx 缓存路径、token 唯一索引、测试数量算术一致、playwright 脚本清单真实存在。
// 新增事实类文档约定时请在此补守护，让人工同步纪律变成 CI 门槛。
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const cliSrc = read('cli.js');
const agentMd = read('AGENT.md');
const claudeMd = read('CLAUDE.md');
const sopMd = read('DEPLOYMENT-SOP.md');
const adminMd = read('ADMIN-ACCOUNT.md');
const readmeMd = read('README.md');
const serverJs = read('server.js');
const dbJs = read('lib/db.js');

const m = cliSrc.match(/\.version\('(\d+\.\d+\.\d+)'\)/);
const CLI_VERSION = m && m[1];
const TGZ = `freeapis-cli-${CLI_VERSION}.tgz`;

describe('文档一致性守护', () => {

  describe('CLI 版本号同步（单一来源 cli.js）', () => {
    it('cli.js 能解析出版本号', () => {
      assert.ok(CLI_VERSION, 'cli.js 未找到 .version(\'x.y.z\')');
    });

    it('五份文档 + server.js 引用的 tarball 版本与 cli.js 一致', () => {
      for (const [name, src] of [['CLAUDE.md', claudeMd], ['AGENT.md', agentMd], ['DEPLOYMENT-SOP.md', sopMd], ['ADMIN-ACCOUNT.md', adminMd], ['server.js', serverJs]]) {
        const refs = src.match(/freeapis-cli-\d+\.\d+\.\d+\.tgz/g) || [];
        assert.ok(refs.length > 0, `${name} 未引用 freeapis-cli-<ver>.tgz`);
        for (const ref of refs) {
          assert.equal(ref, TGZ, `${name} 版本脱节：${ref} ≠ cli.js ${TGZ}（发版后须按 AGENT.md §8.4.1 同步全部文档）`);
        }
      }
    });

    it(`public/download/${TGZ} 存在（发版后须重新打包）`, () => {
      assert.ok(fs.existsSync(path.join(ROOT, 'public/download', TGZ)), `缺少 ${TGZ}，请运行 node scripts/build-cli-package.js`);
    });
  });

  describe('运维关键事实（曾发生过文档漂移）', () => {
    it('AGENT.md 无旧 Nginx 缓存路径 proxy_cache_dir', () => {
      assert.ok(!agentMd.includes('proxy_cache_dir'), 'AGENT.md 仍含旧缓存路径 proxy_cache_dir（实际为 /www/server/nginx/cache/freeapis）');
    });

    it('AGENT.md 与 DEPLOYMENT-SOP.md 均含现行缓存路径 cache/freeapis', () => {
      assert.ok(agentMd.includes('cache/freeapis'), 'AGENT.md 缺现行 Nginx 缓存路径 cache/freeapis');
      assert.ok(sopMd.includes('cache/freeapis'), 'DEPLOYMENT-SOP.md 缺现行 Nginx 缓存路径 cache/freeapis');
    });

    it('AGENT.md 不再声称 token 无唯一索引', () => {
      assert.ok(!agentMd.includes('无唯一索引'), 'AGENT.md 仍称 token 无唯一索引（lib/db.js 已有 idx_items_token_unique）');
      assert.ok(dbJs.includes('idx_items_token_unique'), 'lib/db.js 唯一索引 idx_items_token_unique 消失，请同步更新 AGENT.md §7 并调整本守护');
      assert.ok(agentMd.includes('idx_items_token_unique'), 'AGENT.md §7 应提及 idx_items_token_unique');
    });

    it('AGENT.md 不再把 compression 列为 Express 中间件', () => {
      assert.ok(!/、compression[、。]/.test(agentMd), 'AGENT.md 技术栈仍列 compression（已移除，压缩在 Nginx）');
      assert.ok(agentMd.includes('Express 不做压缩'), 'AGENT.md 应说明「Express 不做压缩」（压缩在 Nginx）');
    });
  });

  describe('测试数量一致（AGENT.md ↔ README.md ↔ CLAUDE.md，算术自洽）', () => {
    const RE_AGENT = /文档守护 (\d+) \+ API (\d+) \+ CLI (\d+) \+ CLI e2e (\d+) = (\d+) 项/;
    const RE_OTHER = /文档守护\((\d+)\) \+ API\((\d+)\) \+ CLI\((\d+)\) \+ CLI e2e\((\d+)\) = (\d+) 项/;

    it('AGENT.md 测试数量算术正确', () => {
      const am = agentMd.match(RE_AGENT);
      assert.ok(am, 'AGENT.md 未找到测试数量描述（npm test = 文档守护 x + API x + CLI x + CLI e2e x = x 项）');
      const nums = am.slice(1).map(Number);
      assert.equal(nums[0] + nums[1] + nums[2] + nums[3], nums[4], `AGENT.md 测试数量算术不符：${am[0]}`);
    });

    it('README.md / CLAUDE.md 测试数量与 AGENT.md 一致，且与实际测试文件 it() 数相符（防加用例后文档忘同步）', () => {
      const am = agentMd.match(RE_AGENT);
      for (const [name, src] of [['README.md', readmeMd], ['CLAUDE.md', claudeMd]]) {
        const om = src.match(RE_OTHER);
        assert.ok(om, `${name} 未找到测试数量描述（文档守护(x) + API(x) + CLI(x) + CLI e2e(x) = x 项）`);
        for (let i = 1; i <= 5; i++) {
          assert.equal(am[i], om[i], `AGENT.md 与 ${name} 测试数量不一致（第 ${i} 个数字 ${am[i]} ≠ ${om[i]}）`);
        }
      }
      // 与实际测试文件对照：API/CLI/守护的 it() 数必须与文档声称一致
      const countIts = (f) => (fs.readFileSync(path.join(ROOT, 'tests', f), 'utf8').match(/^\s*it\(/gm) || []).length;
      const nums = am.slice(1).map(Number);
      assert.equal(nums[0], countIts('doc-consistency.js'), `文档声称文档守护 ${nums[0]} 项，但 tests/doc-consistency.js 实际 ${countIts('doc-consistency.js')} 个 it()`);
      assert.equal(nums[1], countIts('api.test.js'), `文档声称 API ${nums[1]} 项，但 tests/api.test.js 实际 ${countIts('api.test.js')} 个 it()（新增用例后须同步三份文档）`);
      assert.equal(nums[2], countIts('cli.test.js'), `文档声称 CLI ${nums[2]} 项，但 tests/cli.test.js 实际 ${countIts('cli.test.js')} 个 it()`);
    });
  });

  describe('文档提及的测试脚本真实存在', () => {
    it('AGENT.md §12 列出的 playwright/smoke 脚本都在 tests/ 目录', () => {
      const scripts = ['playwright-full.js', 'playwright-admin.js', 'playwright-banner.js', 'playwright-slogan.js',
        'playwright-sse.js', 'playwright-uploader.js', 'playwright-tools.js', 'playwright-ccswitch.js',
        'playwright-feedback-drop.js', 'smoke-announcements.js', 'smoke-share.js', 'smoke-tutorial.js'];
      for (const s of scripts) {
        assert.ok(fs.existsSync(path.join(ROOT, 'tests', s)), `tests/${s} 不存在（AGENT.md §12 已列出）`);
        assert.ok(agentMd.includes(s), `AGENT.md §12 缺 tests/${s}（新增冒烟脚本须同步清单）`);
      }
    });
  });

  describe('API 文档覆盖抽查（新端点须同步两份 API 表）', () => {
    it('关键端点在 AGENT.md 与 CLAUDE.md 的 API 表均有记录', () => {
      const endpoints = ['/api/admin/review-counts', '/api/admin/feedback', '/api/events', '/api/upload', '/api/tutorials'];
      for (const ep of endpoints) {
        assert.ok(agentMd.includes(ep), `AGENT.md API 表缺 ${ep}`);
        assert.ok(claudeMd.includes(ep), `CLAUDE.md API 表缺 ${ep}`);
      }
    });
  });

});
