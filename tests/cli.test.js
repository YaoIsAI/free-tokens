const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'cli.js');
const TMP_DATA = path.resolve(ROOT, 'data/test-tokens.json');

// 设置测试环境
process.env.TOKEN_API = 'http://localhost:0';
process.env.API_KEY = '';

function cli(args) {
  const result = spawnSync('node', [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 10000,
    env: { ...process.env }
  });
  return {
    code: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

describe('CLI 工具', () => {

  describe('token --help', () => {
    it('显示帮助信息', () => {
      const r = cli(['--help']);
      assert.equal(r.code, 0);
      assert.ok(r.stdout.includes('add'));
      assert.ok(r.stdout.includes('list'));
      assert.ok(r.stdout.includes('search'));
      assert.ok(r.stdout.includes('delete'));
      assert.ok(r.stdout.includes('stats'));
      assert.ok(r.stdout.includes('ping'));
    });
  });

  describe('token ping', () => {
    it('服务器未启动返回错误', () => {
      const r = cli(['ping']);
      assert.notEqual(r.code, 0);
      assert.ok(r.stderr.length > 0 || r.stdout.includes('ok'), '应该报错');
    });
  });

  describe('token add 缺少必填项', () => {
    it('缺少 name 和 url 报错', () => {
      const r = cli(['add']);
      assert.notEqual(r.code, 0);
      assert.ok(r.stderr.includes('缺少必填项'), '应该报错');
    });
  });

  describe('token list', () => {
    it('服务器未启动返回错误', () => {
      const r = cli(['list']);
      assert.notEqual(r.code, 0);
      assert.ok(r.stderr.length > 0, 'stderr should have error message');
    });
  });

  describe('token stats', () => {
    it('服务器未启动返回错误', () => {
      const r = cli(['stats']);
      assert.notEqual(r.code, 0);
      assert.ok(r.stderr.length > 0, 'stderr should have error message');
    });
  });

  describe('token search', () => {
    it('服务器未启动返回错误', () => {
      const r = cli(['search', 'test']);
      assert.notEqual(r.code, 0);
      assert.ok(r.stderr.length > 0, 'stderr should have error message');
    });
  });

  describe('token delete', () => {
    it('服务器未启动返回错误', () => {
      const r = cli(['delete', 'xxx']);
      assert.notEqual(r.code, 0);
      assert.ok(r.stderr.length > 0, 'stderr should have error message');
    });
  });

  describe('token import 文件不存在', () => {
    it('返回错误', () => {
      const r = cli(['import', 'nonexistent.json']);
      assert.notEqual(r.code, 0);
      assert.ok(r.stderr.includes('读取文件失败'), '应该报错');
    });
  });

  describe('skill add 缺少必填项', () => {
    it('缺少 title 报错', () => {
      const r = cli(['skill', 'add']);
      assert.notEqual(r.code, 0);
      assert.ok(r.stderr.includes('请提供 --title 标题'), '应该报错');
    });
    it('缺少内容和 zip 报错', () => {
      const r = cli(['skill', 'add', '--title', '测试']);
      assert.notEqual(r.code, 0);
      assert.ok(r.stderr.includes('请提供 --zip 压缩包，或 --content 内容 / --file 文件'), '应该报错');
    });
    it('zip 文件不存在报错', () => {
      const r = cli(['skill', 'add', '--title', '测试', '--zip', 'nonexistent.zip']);
      assert.notEqual(r.code, 0);
      assert.ok(r.stderr.includes('压缩包上传失败') || r.stderr.includes('读取文件失败'), '应该报错');
    });
  });
});