# 贡献指南 · free-tokens

> **一句话**：`Fork → 分支 → 改 `data/ai-tools.js` 或 `public/*` → `npm run ci 全绿 → PR`

## 0. 本仓库定位

- **公开仓 `free-tokens` = 最小可跑纯站**（无密钥、无部署脚本、无 `data/*.db`、`宣传物料/`），`cp .env.example .env && npm start` 即起
- **全量仓 Gitea `token-charity-station` = 含运维**（仅维护者可见，`DEPLOYMENT-SOP.md`/`ADMIN-ACCOUNT.md` 等），贡献者无需关心

## 1. 本地起服

```bash
cp .env.example .env   # 填 JWT_SECRET=openssl rand -hex 32
npm install
npm start              # http://localhost:3000
npm run ci             # 提交前必过：check + 371 项测试
```

## 2. 三类零门槛首 PR（`Good first issue`）

| 任务 | 只改 1 文件 | 校验 |
|------|-------------|------|
| 加一条 AI 工具 | `data/ai-tools.js` 加 `{name,url,desc,logo}` + 图放 `public/tools-icons/` | `npm run ci` |
| 修一个错别字 | `README.md / POINTS.md` | `npm run check` |
| 优化一张卡片文案 | `public/app.js` 或 `lib/og-card.js` 文案 | 截图 + `npm run ci` |

## 3. 分支与 PR

```bash
git checkout -b feat/add-tool-xxx
git commit -m "feat(tools): add xxx"
git push origin feat/add-tool-xxx
# 去 GitHub 发 PR 到 public-main，标题含 feat/fix/docs 前缀
```

- 一个 PR 只做一件事，附截图/录屏（移动端需 375px 截）
- `AGENT.md` 是 AI 接管手册，你的 AI 也能自助

## 4. 审核与上线

- 你：`git fetch github public-main` 看伙伴更新
- 维护者：本地 `git fetch origin public-main && git checkout public-main && git log --oneline -10` 审核
- 维护者：`git checkout main && git merge public-main --no-ff` 合到全量，再 `bash scripts/deploy.sh` 直连服务器部署（贡献者无需部署权限）

## 5. 禁止事项

- 不提交 `.env` / `data/*.db` / `public/download/*.tgz` / 明文 `sk-` / 真实 `ghp_`
- 不直接改 `main` 分支，不带密钥的 `--force`

## 6. 引流与 SEO（顺便帮站）

- README 与 PR 描述中可带 `https://free-tokens.org` 外链（`rel=nofollow` 除外），`sitemap.xml` 会自动收录你新增的 `/tools` 条目，长尾词反哺主站
