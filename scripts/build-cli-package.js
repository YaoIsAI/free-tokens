// Build the self-hosted FreeAPIs CLI npm package.
// Produces: public/download/freeapis-cli-<version>.tgz
// Install anywhere with:  npm install -g https://freeapis.top/download/freeapis-cli-<version>.tgz
// The tarball bundles commander (zero-dep) so install needs no npm registry access.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const STAGE = path.join(ROOT, '.cli-package');
const OUT_DIR = path.join(ROOT, 'public', 'download'); // NOT public/cli — that shadows the /cli guide route via express.static

// Version is read from cli.js (single source of truth) so the npm package
// version always matches what `freeapis-cli --version` reports.
const PKG_NAME = 'freeapis-cli';

// 1. Staging dir + read version from cli.js
const cliSrc = fs.readFileSync(path.join(ROOT, 'cli.js'), 'utf8');
const verMatch = cliSrc.match(/\.version\('([0-9]+\.[0-9]+\.[0-9]+)'\)/);
if (!verMatch) { console.error('cannot find .version() in cli.js'); process.exit(1); }
const VERSION = verMatch[1];

// Remove any previously built tarballs of this package so old versions don't linger
fs.mkdirSync(OUT_DIR, { recursive: true });
for (const f of fs.readdirSync(OUT_DIR, { recursive: true }).filter(f => f.startsWith(PKG_NAME + '-'))) {
  fs.rmSync(path.join(OUT_DIR, f), { force: true });
}

fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(path.join(STAGE, 'node_modules'), { recursive: true });

// 2. cli.js — production default endpoint + freeapis-cli command name
let cli = cliSrc;
cli = cli.replace(
  "const BASE_URL = process.env.TOKEN_API || 'http://localhost:3000';",
  "const BASE_URL = process.env.TOKEN_API || 'https://freeapis.top';"
);
cli = cli.replace(
  "program.name('token').description('Token公益站 CLI（支持 --json 模式）')",
  "program.name('freeapis-cli').description('free-tokens Token公益站 CLI（支持 --json 模式）')"
);
fs.writeFileSync(path.join(STAGE, 'cli.js'), cli);

// 3. package.json
fs.writeFileSync(path.join(STAGE, 'package.json'), JSON.stringify({
  name: PKG_NAME,
  version: VERSION,
  description: 'free-tokens · Token公益站 CLI — 免费大模型 Token 导航',
  license: 'MIT',
  bin: { [PKG_NAME]: './cli.js' },
  main: 'cli.js',
  engines: { node: '>=18' },
  dependencies: { commander: '^11.1.0' },
  bundleDependencies: ['commander']
}, null, 2));

// 4. Bundle commander (zero-dep) so the tarball is fully self-contained
const cmdSrc = path.join(ROOT, 'node_modules', 'commander');
const cmdDst = path.join(STAGE, 'node_modules', 'commander');
if (!fs.existsSync(cmdSrc)) { console.error('commander not installed; run npm install first'); process.exit(1); }
try { execSync(`cp -r "${cmdSrc}" "${cmdDst}"`); } catch (_) { fs.cpSync(cmdSrc, cmdDst, { recursive: true }); }

// 5. npm pack → tarball (pack in cwd, then move to OUT_DIR — avoids
//    --pack-destination path issues with non-ASCII paths on Windows)
const packOut = execSync('npm pack --json', { cwd: STAGE, encoding: 'utf8' }).trim();
const packJson = JSON.parse(packOut);
const tarball = packJson[0].filename;
fs.renameSync(path.join(STAGE, tarball), path.join(OUT_DIR, tarball));
const outFile = path.join(OUT_DIR, tarball);
if (!fs.existsSync(outFile)) { console.error('npm pack failed'); process.exit(1); }

// 6. Cleanup staging
fs.rmSync(STAGE, { recursive: true, force: true });

const url = `https://freeapis.top/download/${tarball}`;
const sizeKb = (fs.statSync(outFile).size / 1024).toFixed(1);
console.log('Built ' + path.relative(ROOT, outFile) + ' (' + sizeKb + ' KB)');
console.log('Install:  npm install -g ' + url);
console.log('No-install use:  npx ' + url + ' ping');
