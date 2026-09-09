# free-tokens

<p align="center">
  <a href="https://free-tokens.org"><img src="./public/screenshot.png" width="720" alt="free-tokens Token公益站 - 线上首页实拍"></a>
  <br>
  <em>线上体验：<a href="https://free-tokens.org">free-tokens.org</a>（SEO 主域） · <a href="https://freeapis.top">freeapis.top</a>（备用）</em>
</p>

<p align="center">
  <a href="https://free-tokens.org"><img src="https://img.shields.io/badge/线上-free--tokens.org-5b6ef7?style=for-the-badge" alt="free-tokens.org"></a>
  <a href="https://freeapis.top"><img src="https://img.shields.io/badge/备用-freeapis.top-8b5cf6?style=for-the-badge" alt="freeapis.top"></a>
  <img src="https://img.shields.io/badge/Node-%3E%3D18-339933?style=flat-square&logo=node.js" alt="Node >=18">
  <img src="https://img.shields.io/badge/SQLite-WAL-003B57?style=flat-square&logo=sqlite" alt="SQLite">
  <img src="https://img.shields.io/badge/License-Copyleft-blue?style=flat-square" alt="Copyleft">
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square" alt="PRs welcome">
</p>

> **Token 公益站** — 把散落在各家的免费大模型 Token 聚到一处：线上 `free-tokens.org / freeapis.top` 已是完整可用的公益站；本仓库是其**应用代码骨架**，欢迎开发者共建工具导航、检测算法、模板与体验，把这个公益站做得更好。

## 站点预览

<p align="center">
  <img src="./public/screenshot.png" width="720" alt="free-tokens 线上首页实拍">
  <br>
  <em>上图来自线上 <a href="https://free-tokens.org">free-tokens.org</a> · <a href="https://freeapis.top">freeapis.top</a> 真实运营环境</em>
</p>

> **本站点是什么**：线上是运营中的完整公益站，含数百条真实 Token、贡献榜、社区评论；本仓库 `clone` 下来仅含应用代码与工具导航策展（97 款），本地 `npm start` 是一个**空白骨架**（无 Token 数据、无用户）—— 这正是开源的目的：让开发者专注改进应用本身，共同把站点做得更好。

## 目录

- [为什么要开源](#为什么要开源)
- [快速开始](#快速开始)
- [CLI 一键接入](#cli-一键接入)
- [特性](#特性)
- [Web 功能导览](#web-功能导览)
- [API 概览](#api-概览)
- [积分规则](#积分规则)
- [项目结构](#项目结构)
- [技术栈](#技术栈)
- [测试](#测试)
- [本地预览](#本地预览)
- [文档导航](#文档导航)
- [宣传物料](#宣传物料)
- [贡献指南](#贡献指南)
- [开源精神](#开源精神)

## 为什么要开源

- **线上站点 = 完整公益站**：`free-tokens.org / freeapis.top` 由站长运营，含数百条 Token、用户、积分、贡献榜与社区生态，已稳定运行
- **本仓库 = 应用骨架**：`git clone` 后是一份**空白的、纯净的**应用代码，无线上数据、无依赖部署；本地 `npm start` 仅有 97 款 AI 工具导航、若干教程占位与空数据库
- **共建方式**：开发者 `Fork → 改进代码 → 提 PR`，运营侧 `fetch public-main → 审核 → 合并 → 上线`；你贡献的每行代码最终都会回到 `free-tokens.org` 服务真实用户

> 本仓库**不是**线上数据的镜像、**不是**部署脚本包、**不是**生产副本；它是一份可以被任意人拉下来本地改进、并由站长统一吸收合并的开放源码。

## 快速开始

```bash
npm install
npm start            # http://localhost:3000  本地骨架即跑
```

```bash
# 发布一条 Token（--token 必填，--url 填 API base_url）
node cli.js add --name "xxx" --url "https://xxx" --provider "xxx" --category "对话模型" \
  --token "sk-xxx" --token-type "OpenAI" --tags "GPT-4o,免费"
```

> 上手 30 秒：`clone` → `npm install` → `npm start`，本地跑出与线上同 UI 的空白骨架。

## CLI 一键接入

```bash
npm install -g https://freeapis.top/download/freeapis-cli-0.23.0.tgz
freeapis-cli ping
freeapis-cli --json login -t <已有token>   # 或 register -u xxx -p xxx -c <邀请码>
freeapis-cli list -s "gpt-4o"
freeapis-cli view <id>
freeapis-cli recent -n 5                   # 每日免费 5 次
```

全量命令与 `--json` 见 `CLAUDE.md` / `AGENT.md` / 线上 `/cli` 与 `/cli-agent.txt`。

## 特性

- **每条都实测** — 发布时对 `base_url` 做真实探测（OpenAI/Anthropic 双兼容自动识别），不通过拒绝；发布即上线
- **失效自动清理** — 定时巡检（默认 6h）+ 每日 00:00，明确失效自动下线，429 限流视为有效
- **众创** — 人人可发布（Token 免审即公开），AI 教程走版主审核；`发布即得积分`
- **积分闭环** — 注册 +5，看卡 1 分/张按卡去重，`recent` 每日 5 次免费后 1 分/条，签到/打赏/邀请/Skill 交易均入账，详见 `/points`
- **AI Agent 原生** — 全局 `freeapis-cli` 支持 `--json`、`TOKEN_API` 自托管
- **社区** — 贡献榜 / 动态流（含打赏）/ 个人主页 / 打赏流动 / 评论 / 留言墙 / 公告 + 周报 / 头像 / 邀请码
- **AI 工具导航 `/tools`** — 97 款主流 AI 官网直达，分类吸顶，站内有 Token 的带“免费用”角标
- **掺水检测 `/verify`** — 输入任意 Base URL + Key 自动识别协议与模型，5 维电池 + AI 判官只升不降
- **分享卡片** — 动态生成 `1200×630` OG 与 `1080×1440` 海报，按域渲染
- **Skill 广场 `/skills`** — 社区 Skill 发布/审核/版本化 / 0% 抽成交易
- **安全** — Helmet/CSP/nonce、SSRF 内网拦截、限流、邀请码一码一用、登录锁定、Token 去重索引

## Web 功能导览

| 页面 | 路径 | 亮点 |
|------|------|------|
| 首页 | `/` | 搜索/分类/排序/分页、SSE 实时新卡、公告滚动、贡献榜与动态流 SSR |
| 工具导航 | `/tools` | 97 款 AI 官网、分类吸顶、免费用角标 |
| 掺水检测 | `/verify` | 端点识别 + 单模型 5 维检测 + AI 判官 |
| 教程 | `/tutorials` | Markdown + 封面上传 + B 站自适应 |
| Skill 广场 | `/skills` | 发布/审核/购买（积分，0%抽成） |
| 积分规则 | `/points` | 可视化，表格去技术码，移动端友好 |
| CLI 指南 | `/cli` | 人类/Agent 双视角 |
| 指南 | `/guide` | OpenAI/Anthropic 接入示例 |

## API 概览

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| `GET` | `/api/health` `/api/stats` | 无 | 探活/统计 |
| `GET` | `/api/items?category=&search=&limit=&offset=` | 可选 | 列表（分页） |
| `GET` | `/api/items/:id` | 可选 | 详情（未登录锁 url/token） |
| `POST` | `/api/items` | Bearer | 发布（需真 Token） |
| `GET` | `/api/points` | Bearer | 积分余额/流水 |
| `GET` | `/api/recent?limit=N` | Bearer | 拉取最近 Key（5 免费/日） |
| `POST` | `/api/checkin` | Bearer | 每日签到（1/3/6） |

完整表见 `CLAUDE.md` 与 `server.js`。

## 积分规则

> 详见 [`POINTS.md`](./POINTS.md) 与 [`/points`](https://free-tokens.org/points)

- **得**：注册 +5、发布 Token +1、教程/ Skill/反馈过审 +1、邀请 +1、被打赏 +1、Skill 售出 +price、签到 +1（7 天+2、30 天+5）
- **耗**：看卡 1 分/张（同卡仅首扣）、`recent` 超 5 条后 1 分/条、打赏 1 分、购买 Skill 按价
- **免费**：`recent` 每天 5 条（UTC+8 自然日），版主豁免

## 项目结构

```
├── server.js              # Express + SSR 页面 + API
├── cli.js                 # CLI 单一来源
├── lib/                   # db.js / auth.js / layout.js / points.js / og-card.js / analytics.js
├── public/                # 前端（app.js / dash.js / styles.css / upload.js / md.js / checkin.js / sponsor.js）
├── data/ai-tools.js       # 工具导航策展（97 款，可被 PR 更新）
├── scripts/               # build-cli-package / check
├── tests/                 # doc-consistency / api / cli / cli-e2e / playwright-*
└── .github/workflows/ci.yml
```

## 技术栈

| 层 | 选型 | 说明 |
|----|------|------|
| 运行时 | Node.js 18+ · Express 4 | 单进程，`pm2` 友好 |
| 数据 | SQLite `better-sqlite3` · WAL | 单文件，`data/*.db` 本地自建空库 |
| 认证 | JWT `jsonwebtoken` · `bcryptjs` | `HS256`，登录锁定 5 次/15 分钟 |
| 安全 | `helmet` · `express-rate-limit` · `csp/nonce` · SSRF 内网拦截 | 邀请码一码一用，Token 去重索引 |
| 前端 | 原生 JS + `Lucide` sprite 内联 + 布局工厂 | 无框架，SSR 直出 |
| CLI | `commander` 全自包含 `tgz` | `TOKEN_API` 自托管，`--json` 供 Agent |
| 图像 | `@napi-rs/canvas` + `qrcode` | `og-card.js` 动态 OG/海报，按域渲染 |

## 测试

```bash
npm run check     # 语法检查（~231 文件）
npm test          # 文档守护(11) + API(312) + CLI(11) + CLI e2e(37) = 371 项
npm run ci        # check + test
```

## 本地预览

```bash
cp .env.example .env   # 首次必填 JWT_SECRET=openssl rand -hex 32
npm install && npm start
# http://localhost:3000 即一份空白骨架：97 款工具导航、教程占位、空数据库
# 与线上 free-tokens.org 相比，本地无真实 Token/用户/贡献榜，这是开源的预期状态
```

> 本地默认不包含线上数据库；贡献者关注应用代码本身，运营侧维护线上数据与部署。

## 文档导航

| 文档 | 内容 |
|------|------|
| `AGENT.md` | 全局接管指南 |
| `CLAUDE.md` | AI 操作速查 |
| `POINTS.md` | 积分规则源码级 |
| `CONTRIBUTING.md` | 贡献指南 |
| `CHANGELOG.md` | 变更日志 |

## 宣传物料

`宣传物料/`：公众号长文 + **7 张海报 × 2 尺寸**（小红书 3:4 `1242×1656` + 方形 `1080×1080`）、配套文案、头图/OG。改后 `node scripts/gen-posters-html.js` 重生成。

## 贡献指南

1. Fork & `git clone`，`npm install`
2. 改动走分支，`npm run ci` 全绿再提 PR
3. 新增接口/页面请补 `seoCacheHtml` / `canonicalUrl` / 用例
4. CLI 发版：改 `cli.js:65` 后 `node scripts/build-cli-package.js`

> 我们的目标不是更多功能，而是更稳定、更好用、更值得信赖 —— 任何一处文案、一行样式、一个测试都是贡献。

## 开源精神

Linux 和 Git 是这样长下来的，我们的 Token 公社也是。**Free = 免费 + 自由**。有能力的贡献，需要的人受益——我为人人，人人为我。

<p align="center">
  <sub>© 2026 free-tokens · Token公益站 · 人人可发布 · 永久免费</sub>
</p>
