// 轻量语法检查：对所有 JS 源文件跑 node --check，作为 CI / 提交前门槛（零依赖）
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = walk(path.resolve(__dirname, '..'));
let failed = 0;
for (const f of files) {
  try {
    execSync(`node --check "${f}"`, { stdio: 'pipe' });
  } catch (e) {
    failed++;
    console.error('语法错误: ' + f);
    console.error(e.stderr ? e.stderr.toString() : e.message);
  }
}

if (failed) {
  console.error(`\n${failed} 个文件存在语法错误`);
  process.exit(1);
}
console.log(`✓ 语法检查通过（${files.length} 个 JS 文件）`);
