# free-tokens · Token公益站 — AI Agent 操作指南

> **接手本项目请先读 `AGENT.md`（全局接管指南）**：覆盖项目定位、架构、全部功能、CLI 打包部署、AWS 服务器访问、踩坑、回滚、测试。
> 本文件是新会话常驻的操作速查。部署细节见 `DEPLOYMENT-SOP.md`，账号见 `ADMIN-ACCOUNT.md`。

## 项目概述

免费大模型 Token 信息聚合平台（品牌 free-tokens，定位 Token公益站）。Express + SQLite，CLI 工具支持人类和 AI Agent 操作。生产环境：https://free-tokens.org 和 https://freeapis.top（双域名均可访问）。

> **微信公众号/小红书推广物料**在项目根 `宣传物料/` 文件夹（公众号文章、7 张海报 × 2 尺寸、配套文案），使用说明见 `宣传物料/README.md`；品牌核心口号「Token 就是力量」。

## 快速启动

```bash
npm start                    # 启动服务器 http://localhost:3000
```

## CLI 命令速查

**公共安装（用户机，连 freeapis.top）：** `npm install -g https://freeapis.top/download/freeapis-cli-0.23.0.tgz`，然后用 `freeapis-cli <命令>`。
**自托管（本仓库内）：** `node cli.js <命令>`（默认连 localhost:3000，可用 `TOKEN_API` 覆盖指向远程）。

所有命令支持 `--json` 输出模式。注册/登录后 token 自动保存到 `~/.token-charity-auth`。

> 打包脚本：`scripts/build-cli-package.js`（产出 `public/download/freeapis-cli-*.tgz`，内联 commander，全自包含，发版后需重新 `node scripts/build-cli-package.js` 并部署）。
> ⚠️ **CLI 变更必须同步全部 CLI 文档**（`/cli` 教程页含 `CLI_AGENT_PROMPT`、`CLAUDE.md`、`AGENT.md`、`DEPLOYMENT-SOP.md`、`ADMIN-ACCOUNT.md` 的版本号/命令），否则视为发版未完成——标准化清单见 `AGENT.md §8.4.1` 与 `DEPLOYMENT-SOP.md §9.1`。

```bash
# 基础连接
node cli.js ping                                                    # 测试连通性
node cli.js stats                                                   # 站点统计

# 认证
node cli.js register -u <用户名> -p <密码> -c <邀请码> [-e <邮箱>] [--phone <手机号>]  # 注册（需邀请码，自动保存 token；邮箱/手机号选填便于找回）
node cli.js login -u <用户名> -p <密码>                              # 登录（自动保存 token）
node cli.js recover -u <用户名> -e <邮箱> -p <新密码>                  # 忘记密码：凭用户名+注册邮箱/手机号重设（无验证码）

# 发布与管理
node cli.js add -n <名称> -u <API base_url> -t <Token> [选项]        # 发布条目（必填 --token 与 --url；纯链接条目不予发布）
node cli.js my                                                      # 查看我的发布
node cli.js my --stats                                              # 我的统计
node cli.js recent [-n 数量]                                       # 拉取最近 API Key（每日免费 5 次，超出每次扣 1 积分；版主/管理员豁免）
node cli.js points                                                  # 积分余额/今日免费额度/积分明细（发布 Token/教程审核通过 +1）
node cli.js checkin [--status]                                      # 每日签到（每日一次 +1，连击7天+2/30天+5；--status 仅查看）
node cli.js edit <id> [--name --url --desc --provider --category --token --token-type --tags]  # 编辑
node cli.js delete <id>                                             # 删除

# 搜索与浏览
node cli.js list                                                    # 全部条目
node cli.js list -c <分类>                                          # 按分类
node cli.js list -s <关键词>                                        # 搜索
node cli.js search <关键词>                                         # 搜索
node cli.js view <id>                                              # 查看详情（含 token/models/tip数；已登录可见真实地址）
node cli.js user <id>                                              # 查看用户主页（贡献/被认可数）
node cli.js announcements [-n 数量]                                # 公告列表（公开）
node cli.js tip <id>                                               # 打赏 1 积分给作者（仅已上线非本人，幂等一次）

# 评论与反馈
node cli.js comment list [-n 数量] [--item <id>]                   # 留言墙/条目评论列表
node cli.js comment add <内容> [--item <id>]                       # 发表评论（默认留言墙，--item 发到条目；1-200字）
node cli.js comment delete <id>                                    # 删除评论（作者/版主+）
node cli.js feedback add <内容> [--kind feedback|bug] [--url <网址>] [--image <图片>]  # 提交反馈/Bug（可附图，需登录）
node cli.js admin feedback list [--status open|done|all]           # 反馈列表（版主+）
node cli.js admin feedback verify <id>                             # 通过并给作者+1（版主+，幂等）
node cli.js admin feedback delete <id>                             # 删除反馈（版主+）

# 批量操作
node cli.js import <文件.json>                                      # 批量导入

# Token 测试
node cli.js test-token <token值> -t <类型> [-u <base_url>] [-m <模型>]   # 测试 Token 有效性（-u 测自定义厂商端点，-m 给 Anthropic 兼容指定模型）
node cli.js verify-relay -u <base_url> -t <token> [-T <类型>] [-m <模型>]  # 中转站掺水检测：输入任意 Base URL+Key 自动识别模型；带 -m 对单个模型做掺水检测（评分+逐项结论：对话/回显/usage/知识/身份/思维链）

# 图片上传（教程封面 / 正文插图共用）
node cli.js upload <图片路径>                                           # 上传本地图片（PNG/JPG/WebP/GIF ≤3MB，每日 20 张）→ 返回 /uploads/xxx.png（供 --cover 封面或正文 ![alt](地址) 插图）

# 教程（AI 教程，社区共同发布，Markdown 正文）
node cli.js tutorial add --title <标题> [--category --tags --summary --cover 封面图URL] --content <正文> | --file <x.md>  # 发布教程（进待审核；--cover 填 cli upload 得到的 /uploads/xxx.png 或 https 外链）
node cli.js tutorial list [-c <分类>] [-s <关键词>] [-n 数量]              # 已公开教程（可按分类/关键词筛选）
node cli.js tutorial search <关键词>                                       # 搜索已公开教程（按标题/摘要）
node cli.js tutorial my                                                 # 我的教程
node cli.js tutorial view <id>                                          # 查看教程全文
node cli.js tutorial edit <id> [--title --content --file --cover ...]           # 编辑（--cover 传空 '' 可移除封面）
node cli.js tutorial delete <id>                                        # 删除
node cli.js admin tutorials [--status pending|verified|all]             # 教程审核列表（版主+）
node cli.js admin tutorial-verify <id> / admin tutorial-unverify <id>   # 通过/下线教程（版主+）

# Skill 广场（AI Agent Skill，社区发布，Markdown 正文，可定价用积分交易）
node cli.js skill add --title <标题> [--zip <压缩包>] [--summary --category --tags --price 0 --cover 封面图URL] --content <正文> | --file <x.md>  # 发布 Skill（--zip 上传 GitHub 风格 zip 包推荐，根目录需含 SKILL.md；--cover 传 /uploads/xxx.png 或 https 外链；--content/--file 传 Markdown；price 0=免费，>0 用积分交易，0% 抽成作者全额获得）
node cli.js skill list [-c <分类>] [-s <关键词>] [--free|--paid]          # 已公开 Skill
node cli.js skill search <关键词>                                       # 搜索已公开 Skill
node cli.js skill view <id>                                            # 查看详情（免费/已购/作者可见全文）
node cli.js skill my                                                   # 我的 Skill
node cli.js skill edit <id> [--title --content --file --cover ...]           # 编辑（--cover 传空 '' 可移除封面）
node cli.js skill delete <id>                                          # 下架自己的 Skill
node cli.js skill buy <id>                                             # 用积分购买付费 Skill（永久授权）
node cli.js skill purchases                                            # 我购买的 Skill
node cli.js skill-admin list [--status pending|online|rejected|offline|all]  # Skill 审核列表（版主+）
node cli.js skill-admin verify <id>                                    # 通过 Skill（版主+）
node cli.js skill-admin reject <id> -r <理由>                          # 拒绝 Skill（版主+，需附理由）

# 身份 / Token 接入
node cli.js whoami                                                    # 当前用户与角色
node cli.js login -t <已有token>                                      # 直接用 token（免账号密码，适合 AI Agent）
node cli.js profile [-n <昵称>] [-e <邮箱>] [--phone <手机号>]       # 查看/修改昵称、邮箱、手机号（邮箱手机号用于找回）

# 审核（版主/管理员）
node cli.js audit                                                     # 待审核条目
node cli.js audit --status verified                                   # 已通过
node cli.js audit --status all                                        # 全部
node cli.js verify <id>                                               # 通过验证
node cli.js unverify <id>                                             # 取消验证

# 用户管理（仅管理员）
node cli.js admin users                                               # 列出全部用户
node cli.js admin role <id> -r <moderator|admin|user>                 # 修改角色
node cli.js admin delete <id>                                         # 删除用户及其条目
node cli.js admin reset-password <id> <新密码>                        # 重置用户密码（≥8位含字母数字，清除登录锁定）

# 邀请码（仅管理员）— 入群后发给新用户，注册必填，每码仅用一次
node cli.js admin invite [数量]                                        # 生成邀请码（默认1，最多50）
node cli.js admin invites                                              # 查看邀请码及使用状态

# 失效检测（版主/管理员）— 一键测试全部已发布条目，明确失效（无效 key/连接失败/404/503）自动下线；429 限流保护视为有效不下架
node cli.js admin check                                                 # 定时自动巡检（默认每 6 小时，SWEEP_INTERVAL_HOURS 可调）全部在线 Token

# 公告（仅管理员）— 首页公告栏滚动显示，自动公开
node cli.js admin announcements                                          # 查看全部公告及显示状态
node cli.js admin announcement add "公告内容"                            # 发布公告
node cli.js admin announcement toggle <id>                               # 上线/下线公告
node cli.js admin announcement delete <id>                               # 删除公告（不可恢复）
```

> 角色：`user`（默认）/ `moderator`（可审核条目）/ `admin`（全部权限，含用户管理）。权限不足时后端返回 403 错误。
> **发布即上线（仅收真实可用 Token）**：本站**只收录真实可用 Token**——发布/编辑条目必须带 `url`（API Base URL）+ `token`，且经**端点测试通过（零错误）**（含去重、OpenAI/Anthropic 兼容检测）才允许，**纯链接/无 Token 条目一律拒绝**（400）。通过即自动公开，无需人工审核；版主/管理员仍可随时**下线/删除**（下线=回到不公开，可重新通过）。**AI 教程仍走版主审核**（`/tutorials`）。
> **新 Token 实时推送**：任何条目发布/审核通过自动上线时，`/api/events`（SSE）立即向首页所有在线访客推送 `item_created`（含完整公开条目与**可用模型**，绝不带 Token）。首页**无分类/搜索筛选时静默把新卡片插到列表顶部**（带高亮动画，无需手动刷新）；有筛选时回退为顶部「＋N 条新 Token」提示条，点击加载。
> **首页公告栏**：Banner 下方的独立滚动条，展示管理员发布的官方公告（`announcements` 表，自动公开）。无公告时整条自动隐藏；悬停暂停滚动，点「全部」弹窗看完整列表。后台「公告」tab 或 `cli admin announcement` 管理。
> **公社信箱（反馈/Bug）**：首页 footer「公社信箱」入口，弹窗内「反馈建议 / 抓个虫」双标签，可附图片（**点击选择 / 拖拽 / Ctrl+V 粘贴三合一**，走共用组件 `public/upload.js` → `/api/upload`；教程封面同组件）与相关页面 URL。仅登录可发（写限流防 spam）；`image` 后端强制只能是本站上传文件 `/uploads/<16hex>.<ext>`（外链图片自动剥离，防后台看图向第三方泄露管理员 IP）；内容 ≤1000 字、`url` 仅 http(s)（后台以纯文本展示，防点击外链泄露版主 IP）。版主+在后台「反馈」tab 查看/标记完成/**通过并给作者 +1 积分**（`POST /api/admin/feedback/:id/verify`，幂等）/删除（删除时清理本站图片）。
> **Token 去重**：发布/编辑时 Token 值全局唯一，重复会被拒绝。
> **Token 必填**：发布/编辑条目必须带 `token` 与 `url`（API Base URL），缺任一即拒绝（400）；编辑不允许移除 Token。发布时用 `url` 对它做有效性测试，**必须真实返回 2xx（零错误）才允许发布**——429 限流/用量保护等任何非 2xx 同样拒绝（区别于巡检时 429 视为有效）。
> **兼容模式检测**：发布/编辑时对 Token 端点自动探测 OpenAI / Anthropic 两种兼容模式，通过的存入 `compat` 字段并在卡片/详情展示对应徽章（支持一种只显示一种，都不支持则拒绝发布）。**自动适配分前缀布局**（如小米：OpenAI `models` 在 `/v1/models`、Anthropic `messages` 在 `/anthropic/v1/messages`）——对每个模式按多个候选路径逐一探测（`{base}` 路径 + host 根 `/v1/` 与 `/anthropic/` 兜底），首个真实 2xx 即算通过；发布/编辑仍要求零错误，429 在巡检视为有效、在发布仍拒绝。
> **Base URL 登录门控**：含 Token 的条目，未登录时 `url`（Base URL）与 `token` 均不可见（`urlLocked`/`tokenLocked`），需登录才显示 Base URL、API Key、可用模型。登录后详情按钮行有「**复制完整配置**」（按 `compat`/`tokenType` 生成 OpenAI/Anthropic/Gemini 可粘贴 env 块，Base URL 与 API Key 仍可点击单独复制）、「**测试**」与「**导入 CC Switch**」（`ccswitch://` 深链一键导入，未唤起自动复制 Key + 手动粘贴兜底）。
> **每日自动巡检（24:00）**：服务器本地时区每天 00:00–00:10 自动测试全部在线 Token（进程内零依赖调度，重启可补跑），**明确失效**（无效 key 401/403、连接失败、404、503 等任何非 2xx）自动下线回待审核；**429 限流保护视为有效不下架**（API 存在只是限额）。巡检结果存内存，管理后台或 `GET /api/admin/sweep` 可查看最近一次；`cli admin check` 手动一键检测与巡检共用同一判定逻辑。
> **失效自动下线**：管理后台"条目审核"的一键"检测失效并下线"（`cli admin check`）与**每日 24:00 自动巡检**共用同一判定：**明确失效**（无效 key 401/403、连接失败、404、503 维护中、任何非 2xx）自动下线回待审核；**429 限流保护视为有效不下架**（API 存在只是限额）。发布时则严格，任何非 2xx（含 429）都拒绝。
> **注册邀请码**：所有新注册（网页/CLI/API）必须填邀请码，无码或无效码返回 400。码为 48 位随机熵（12 位十六进制，`crypto.randomBytes(6)`），事务内一码一用，并发抢码仅一次成功。
> **登录安全**：密码需 ≥8 位且同时含字母和数字（注册时校验）；同一账号连续登录失败 ≥5 次锁定 15 分钟（按账号，内存态，成功登录清除计数；锁定对不存在的用户名同样生效，不泄露账号是否存在）。**管理员可重置任意用户密码**（`admin reset-password <id> <新密码>` 或管理后台「用户管理」钥匙按钮），重置后清除该账号登录锁定。
> **无验证码找回**：注册时可填**邮箱/手机号**（选填，用于验证与找回）。忘记密码时凭「用户名 + 注册邮箱/手机号」匹配即可重设（`POST /api/auth/recovery`、CLI `recover`、登录弹窗「忘记密码」）。找回专用限流（5次/10分/IP）+ 失败计入登录锁定；**未填联系方式的账号**无法自助找回，需联系管理员重置。邮箱/手机号≈弱密码，勿外泄。
> **AI 工具导航（`/tools`）**：好 123 式 AI 官网导航——按分类列出市面主流 AI 产品（对话/图像/视频/编程/音频/办公/搜索/智能体/设计/写作），每张卡片 = **品牌真实 logo 图标 + 名称 + 一句话描述 + 官网直达**（`target=_blank rel="noopener noreferrer"`）。卡片图标：`data/ai-tools.js` 里每个工具可填 `logo`（`public/tools-icons/<文件名>`，**自托管真实品牌图标**，SVG/PNG/ICO 混合，白底 contain 展示）；没填的自动回退为**品牌渐变首字母图标**（`.tools-avatar--g0..g5`）。logo 加载失败时 `public/tools.js` 隐藏 img 露出字母（CSP 禁内联 onerror，用 JS 监听兜底）。顶部搜索框按名称/用途过滤；分类吸顶 chip 条 + 滚动高亮 + 平滑跳转；有站内免费 Token 的产品卡片带「免费用」角标 → `/?search=<产品>` 引流（角标 rel=nofollow + robots 屏蔽，防重复页）。**数据 = 站长策展静态配置 `data/ai-tools.js`**（增删工具改该文件即可，无 DB/审核；新工具要真实 logo 先放图到 `public/tools-icons/` 再填 `logo`，批量下载脚本 `scripts/download-tools-icons.js`）；纯 SSR + 客户端过滤，无外部请求、不改 CSP；`public/tools.js` 负责搜索/滚动。
> **AI 教程**：`/tutorials` 是社区共同发布的 AI 教程（Markdown 正文，**标题浮在封面上的杂志风卡片列表** + 独立文章详情页）。列表卡片：封面区（16:9）作背景层——有 `cover` 显示真实图、无图则用**分类配色渐变 + 图标**占位（`tutorial.js` 的 `coverFor` + CSS `.tut-card__cover--g0..g5`），左上角浮分类徽章、**底部浮起白色标题**（自动加渐变遮罩保证可读）；封面下方仅简介（摘要 + 标签 + 作者/日期）。封面来源三选一：网页「发布教程」表单**本地上传**（走共用组件 `public/upload.js`，点击/拖拽/粘贴三合一 → `POST /api/upload`）或**粘贴外链**；CLI 先 `upload <本地图>` 拿 `/uploads/xxx.png` 再 `tutorial add/edit --cover` 填该地址或 https 外链；旧教程可去「我的教程」点**编辑**补封面。**正文支持插图**：Markdown `![说明](/uploads/xxx.png)` 或 `![说明](https://外链)`（`public/md.js` 渲染，图片协议白名单 `https:` 或本站 `/`，独立成行自动居中大图、行内插图随文排布，`loading=lazy` + `referrerpolicy=no-referrer` 防外链追踪）。发布进待审核；版主/管理员在后台「教程审核」tab（或 `cli admin tutorials` + `admin tutorial-verify`）审核通过后公开，**拒绝时可填理由**（作者在「我的教程」可见，便于修改后重新提交；再通过会自动清空理由）。审核标准：与 AI 相关、信息准确、无广告推广、无重复、内容完整。**教程正文里独立成行的 B 站视频链接**（`bilibili.com/video/BVxxx`）由 `public/md.js` 自动渲染成在线播放器（16:9 响应式 iframe，CSP `frame-src` 白名单放行 `player.bilibili.com`；仅整行裸链接触发，正文里的普通链接仍是链接）。**微信内置浏览器（XWeb/WKWebView）无法内嵌 bilibili 播放器**——服务端检测微信 UA（`MicroMessenger`/`Weixin`）+ 浏览器端 `navigator.userAgent` 双重兜底，自动降级为「在哔哩哔哩打开观看」跳转卡片（点击打开 B 站视频页，手机端引导打开 App）；桌面/普通手机浏览器仍是内嵌播放器。

### add 完整参数

```
--name, -n       名称（必填）
--url, -u        链接（必填；本站只收录真实可用 Token，恒填 API base_url，如 https://x-api.cfd/v1）
--desc, -d       描述
--provider, -p   提供商
--category, -c   分类（对话模型/图像生成/视频工具/编程工具/聚合平台/其他）
--token, -t      Token 值（必填；填了会先做有效性测试，测试不通过拒绝发布；纯链接条目不予发布）
--token-type     Token 类型（OpenAI/Anthropic/Gemini/OpenAI兼容）
--tags           标签（逗号分隔）
```

### --json 输出格式

成功：`{"ok": true, "data": ...}`
失败：`{"ok": false, "error": "..."}`

```bash
# Agent 全自动流程（注册需邀请码，用管理员在后台生成或用已有账号）
node cli.js --json login -t <已有token>                  # 或 register -u xxx -p xxx -c <邀请码>
node cli.js --json add -n "DeepSeek免费" -u https://platform.deepseek.com -p DeepSeek -c 对话模型
node cli.js --json my
node cli.js --json edit <id> --name "更新名称"
node cli.js --json delete <id>
```

## API 端点

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/api/health` | 无 | 健康检查 |
| GET | `/api/stats` | 无 | 站点统计 |
| GET | `/api/items` | 可选 | 列表 `?category=&search=&sort=&limit=&offset=`（`limit`/`offset` 服务端分页并返回 `X-Total-Count` 总数头；不传则全量返回；每项含 `compat` 与 `models`（可用模型，发布时探测并存）、`tipCount` 被认可数，登录视角另带 `tipped`） |
| GET | `/api/items/:id` | 无 | 详情（带 `authorName`/`tipped`/`tipCount`） |
| POST | `/api/items/:id/tip` | Bearer | 打赏 1 积分给发布者（仅已上线非本人；幂等一次） |
| POST | `/api/items` | Bearer | 发布 |
| GET | `/api/my/items` | Bearer | 我的发布 |
| GET | `/api/my/stats` | Bearer | 我的统计 |
| GET | `/api/points` | Bearer | 积分余额 + 每日额度 + 最近流水（`?month=YYYY-MM` 按天聚合每日净增减，`?all=1` 返回完整流水） |
| GET | `/api/checkin` | Bearer | 签到状态 `?month=YYYY-MM`（今日是否已签、连击天数、累计、日历） |
| POST | `/api/checkin` | Bearer | 每日签到（每日一次 +1，连击7天+2/30天+5；幂等） |
| GET | `/api/recent?limit=N` | Bearer | 拉取最近 API Key（每日免费 5 次，超出扣 1 积分/次；版主/管理员豁免） |
| PUT | `/api/my/items/:id` | Bearer | 编辑 |
| DELETE | `/api/my/items/:id` | Bearer | 删除 |
| GET | `/api/leaderboard` | 无 | 贡献榜（历史真实发布全部计入：含已下线/垃圾桶） |
| GET | `/api/categories` | 无 | 分类 |
| GET | `/api/comments?limit=N` | 无 | 评论墙留言列表（最新 N 条，自动公开；带 `authorId`） |
| GET | `/api/users/:id` | 无 | 个人主页数据（资料含 `avatar` + 被认可数 + 贡献条目 + 已通过教程） |
| POST | `/api/auth/avatar` | Bearer | 上传头像（PNG/JPG/WebP/GIF ≤3MB，按用户 ID 归档 avatars/，替换制） |
| DELETE | `/api/auth/avatar` | Bearer | 移除头像 |
| POST | `/api/comments` | Bearer | 发表留言 `{content}`（1-100 字，自动公开） |
| DELETE | `/api/comments/:id` | Bearer | 删除留言/评论（作者本人或版主+） |
| GET | `/api/items/:id/comments` | 无 | Token 条目评论（仅已上线条目） |
| POST | `/api/items/:id/comments` | Bearer | 发表条目评论 `{content}`（1-200 字） |
| POST | `/api/admin/weekly-report` | Bearer + admin | 手动触发社区周报（幂等） |
| GET | `/api/announcements?limit=N` | 无 | 公告列表（最新 N 条，仅显示中，自动公开） |
| GET | `/api/admin/announcements` | Bearer + admin | 全部公告（含已下线，后台管理） |
| POST | `/api/admin/announcements` | Bearer + admin | 发布公告 `{content}`（1-500 字，自动公开） |
| PUT | `/api/admin/announcements/:id` | Bearer + admin | 编辑公告 / 上线下线 `{content?, active?}` |
| DELETE | `/api/admin/announcements/:id` | Bearer + admin | 删除公告（不可恢复） |
| POST | `/api/feedback` | Bearer | 提交反馈/Bug `{kind:feedback\|bug, content, url?, image?}`（content 1-1000 字；image 仅允许本站上传文件 `/uploads/<16hex>.<ext>`，外链图片自动剥离；登录+写限流防 spam） |
| GET | `/api/admin/feedback` | Bearer + moderator | 反馈列表 `?status=open\|done`（后台「反馈」tab，内容/url 全转义） |
| PUT | `/api/admin/feedback/:id` | Bearer + moderator | 标记完成/重新打开 `{status:done\|open}` |
| DELETE | `/api/admin/feedback/:id` | Bearer + moderator | 删除反馈（并清理关联的本站上传图片） |
| POST | `/api/admin/feedback/:id/verify` | Bearer + moderator | 通过反馈为高质量，作者 +1 积分（幂等，同一反馈仅一次；后台「反馈」tab 奖章按钮） |
| GET | `/api/events` | 无 | SSE 实时推送（新 Token 上线即时推送；首页无筛选时静默插入新卡片，有筛选时浮现提示条） |
| GET | `/api/auth/me` | Bearer | 当前用户（含 role/nickname） |
| PUT | `/api/auth/profile` | Bearer | 修改资料 `{nickname?,email?,phone?}`（缺省不动、空串清除，校验同注册；用于找回密码）。**昵称全站唯一**：非空昵称全局唯一（不区分大小写，`/api/auth/nickname-check?nickname=` 可实时检测可用性） |
| POST | `/api/auth/register` | 无 | `{username, password, email?, phone?, inviteCode}`（邀请码必填，邮箱/手机号选填） |
| POST | `/api/auth/login` | 无 | `{username, password}` |
| POST | `/api/auth/recovery` | 无 | 无验证码找回 `{username, email?, phone?, password}`（凭用户名+注册联系方式；找回限流 5次/10分/IP + 失败计入登录锁定） |
| POST | `/api/test-token` | Bearer | `{token, tokenType, baseUrl?, model?}`（需登录；`baseUrl` 测自定义厂商端点，SSRF 拦截；带 `model` 即对指定模型独立实测） |
| POST | `/api/verify` | Bearer | 中转站掺水检测·端点识别 `{baseUrl, token, tokenType?}`：自动识别兼容模式+模型列表+端点级检查（可达/协议/模型列表/反投毒）；Token 用后即焚不落库 |
| POST | `/api/verify/model` | Bearer | 中转站掺水检测·单模型电池 `{baseUrl, token, tokenType?, model}`：对话可达/返回结构/model回显/usage/知识基准/身份一致性/思维链痕迹 → 评分 0-100 + 判定（基本可信/存在疑点/疑似掺水）+ 逐项 checks |
| GET | `/api/admin/users` | Bearer + admin | 全部用户 |
| PUT | `/api/admin/users/:id/role` | Bearer + admin | 改角色 |
| DELETE | `/api/admin/users/:id` | Bearer + admin | 删除用户 |
| POST | `/api/admin/users/:id/reset-password` | Bearer + admin | 重置密码 `{password}`（校验同注册，清除登录锁定） |
| GET | `/api/admin/items` | Bearer + moderator | 全部条目 `?status=pending|verified|trash|all`（trash=垃圾桶） |
| PUT | `/api/admin/items/:id/verify` | Bearer + moderator | 验证/取消（下线=回不公开） |
| PUT | `/api/admin/items/:id/trash` | Bearer + moderator | 移入垃圾桶（强制下线，不在待审核显示） |
| PUT | `/api/admin/items/:id/restore` | Bearer + moderator | 从垃圾桶撤回（回待审核，可重新通过） |
| DELETE | `/api/admin/items/:id` | Bearer + moderator | 彻底删除（不可恢复） |
| POST | `/api/admin/items/trash-pending` | Bearer + moderator | 一键清理：全部待审核条目移入垃圾桶 |
| GET | `/api/admin/invites` | Bearer + admin | 邀请码列表（含使用状态） |
| POST | `/api/admin/invites` | Bearer + admin | 生成邀请码 `{count}`（1-50） |
| POST | `/api/admin/items/check` | Bearer + moderator | 检测失效 Token：明确失效（无效 key/连接失败/404/503 等）自动下线，429 限流视为有效不下架 |
| GET | `/api/admin/sweep` | Bearer + admin | 查看最近一次巡检结果（定时自动巡检（默认每 6 小时）+ 一键检测共用的判定） |
| POST | `/api/admin/items/auto-verify` | Bearer + moderator | 一键自动审核：对待审核含 Token 条目逐个真实问答，有可用模型才通过（429 限流进 limited 暂缓，不进 rejected；与巡检互斥 409） |
| GET | `/api/sponsors?slot=` | 无 | 投放中的广告（安全字段） |
| POST | `/api/sponsors` | Bearer | 广告商申请（进待认证） |
| GET/PUT | `/api/my/sponsors…` | Bearer | 我的广告（含数据）；改料/下线自己（在线改敏感项回待审） |
| GET | `/go/:id` | 无 | 跳转计数后 302（仅投放中） |
| GET | `/api/admin/sponsors` | Bearer + moderator | 全部广告（含数据） |
| PUT/DELETE | `/api/admin/sponsors/:id/…` | Bearer + moderator | 认证/拒绝/确认收款上线（同槽位单活）/下线/续费/删除 |
| GET | `/api/admin/review-counts` | Bearer + moderator | 待审核计数（后台/导航角标用）：`{pendingItems, pendingTutorials, openFeedback}` |
| GET | `/api/tutorials` | 无 | 教程列表 `?category=&search=&limit=&offset=`（仅已审核，无正文） |
| GET | `/api/tutorials/categories` | 无 | 教程分类统计 |
| GET | `/api/tutorials/:id` | 无 | 教程详情（含 Markdown 正文；未审核仅作者/版主/管理员可见） |
| POST | `/api/tutorials` | Bearer | 发布教程 `{title,content,summary?,category?,tags?,cover?}`（进待审核；`cover` 为 `/uploads/...` 或 http(s) 图片链接） |
| POST | `/api/upload` | Bearer | 图片上传（教程封面）：原始二进制 body（`Content-Type: image/*`），PNG/JPG/WebP/GIF ≤3MB，每日每用户 ≤20 张，返回 `{url:'/uploads/xxx.png'}`；文件存 `data/uploads/`（部署 tar 排除，不随发布覆盖） |
| GET | `/api/my/tutorials` | Bearer | 我的教程 |
| GET | `/api/my/tutorials/stats` | Bearer | 我的教程统计 |
| PUT/DELETE | `/api/my/tutorials/:id` | Bearer | 编辑/删除自己的教程 |
| GET | `/api/admin/tutorials` | Bearer + moderator | 教程审核列表 `?status=` |
| PUT | `/api/admin/tutorials/:id/verify` | Bearer + moderator | 通过/下线教程（通过时清空拒绝理由） |
| PUT | `/api/admin/tutorials/:id/reject` | Bearer + moderator | 拒绝教程并附理由 `{reason}`（1-200 字），理由作者可见 |
| GET | `/api/skills` | 可选 | Skill 列表 `?category=&search=&sort=&free=&paid=&limit=&offset=`（仅 online，服务端分页 + `X-Total-Count`；登录视角带 `purchased`） |
| GET | `/api/skills/categories` | 无 | Skill 分类统计（仅 online） |
| GET | `/api/skills/:id` | 可选 | Skill 详情（非 online 仅作者/版主可见；`content` 仅免费/已购/作者/版主返回） |
| GET | `/api/skills/:id/content` | Bearer | Skill 内容受控读取（免费登录即得；付费需购买；返回 `{version, content, sha256}`，`no-store`，计数 downloads） |
| POST | `/api/skills` | Bearer | 发布 Skill `{title, content, summary?, description?, category?, tags?, price?, packageId?}`（进待审核；content ≤100000 字、price ≤10000；`packageId` 模式传 zip 包、自动解析 SKILL.md frontmatter + 文件树；自动内容安全扫描存 skill_versions.scan_report） |
| POST | `/api/skills/package` | Bearer | 上传 Skill zip 包（raw body ≤10MB，解压校验：文件数≤200/单文件≤2MB/总≤20MB/路径穿越拦截/必须含 SKILL.md；支持 GitHub 式顶层目录；返回 `{packageId, files, skillMd, readme, scanReport}`） |
| GET | `/api/skills/:id/download` | Bearer | 下载完整包 zip（权限同 content：免费登录即得、付费需购买；`Content-Disposition` 附件 + `X-Skill-Version`） |
| POST | `/api/skills/:id/buy` | Bearer | 购买 Skill（`lib/points.js purchaseSkill` 事务：扣买家/加作者 0% 抽成/写 purchase + 双流水；免费直接授权；幂等） |
| PUT | `/api/my/skills/:id` | Bearer | 编辑自己的 Skill（content 变更 → 新版本重新审核，status 回 pending） |
| DELETE | `/api/my/skills/:id` | Bearer | 下架自己的 Skill（status=offline） |
| GET | `/api/my/skills` | Bearer | 我发布的 Skill |
| GET | `/api/my/purchases` | Bearer | 我的购买记录 |
| GET | `/api/skills/:id/reviews` | 无 | Skill 评论列表（最新 50） |
| POST | `/api/skills/:id/reviews` | Bearer | 发表/更新 Skill 评论 `{rating 1-5, content ≤200字}`（不能评自己的；`UNIQUE(skill_id,user_id)` upsert） |
| GET | `/api/admin/skills` | Bearer + moderator | Skill 审核列表 `?status=pending\|online\|rejected\|offline`（空=全部） |
| PUT | `/api/admin/skills/:id/verify` | Bearer + moderator | 通过 Skill（作者 +1 积分 `skill_verify` 幂等） |
| PUT | `/api/admin/skills/:id/reject` | Bearer + moderator | 拒绝 Skill `{reason}`（1-200 字，理由作者可见） |
| PUT | `/api/admin/skills/:id/offline` | Bearer + moderator | 版主下架 Skill |
| POST | `/api/track` | 无 | 访客统计 beacon：页面加载后浏览器上报 `{tz,lang,path,ref}`（ref=来源页 referrer，服务端只存 host），IP/UA 服务端补全（`req.ip`），时区→国家/地区；专用限流 120/分/IP，非页面路径/爬虫 UA 拒绝 |
| GET | `/api/admin/visits` | Bearer + moderator | 访客统计（`lib/analytics.js`）：todayPv/todayUv/h24Pv/weekPv + 国家/路径/按天聚合 + 最近访问列表 `?limit=` |
| GET | `/api/admin/server-stats` | Bearer + moderator | 服务器资源：最近一次采样（CPU%/内存/磁盘/RSS）+ 最近 60 点序列（60s/次） |

> **SEO / GEO 端点**（服务端渲染路由，面向搜索引擎与 LLM 爬虫）：
> - `/sitemap.xml`（含首页/教程/指南/CLI + 全部已审核教程详情，绝对 URL）
> - `/robots.txt`（Allow `/`；Disallow `/dashboard` `/api/` `/download/`；指向 sitemap）
> - `/llms.txt`（站点定位 + 关键内容 + 核心链接，供 GPTBot/PerplexityBot/ClaudeBot 等抓取）
> - `/cli-agent.txt`（**AI Agent 接管纯文本指引**：完整 CLI 命令 + `--json` 约定 + 版本，抓取即可自助接管操作；`/cli` 页「AI 引导提示」复制按钮与它是同一来源）
> - **一键分享 + 专属缩略图**：Token 卡片 / 详情弹窗 / 教程文章均带分享按钮，点击**统一打开二维码卡片弹窗**（不自动调系统分享——Windows/桌面端 `navigator.share` 会弹系统分享 UI 而看不到我们设计的卡片；「系统分享」保留在弹窗内手动点）。弹窗展示 `/poster/item/:id.png`、`/poster/tutorial/:id.png`、`/poster/site.png`（600×800 紧凑 3:4 卡片，`lib/og-card.js` 的 `poster()`，低饱和浅色流光背景取自首页 banner aurora 四色 + 深靛蓝文字，底部醒目展示**当前访问的域名**（free-tokens.org 或 freeapis.top，随请求 Host 决定），QR 内容为页面绝对地址）。「复制整张卡片」把整张图片复制进剪贴板（`ClipboardItem` PNG），粘贴到微信聊天即完整卡片；浏览器不支持复制图片时自动回退为下载；另有「复制链接 + 系统分享」。前端 `posterUrlFor()` 自动按 URL 选端点，失败回退 `/api/qrcode`。分享到微信时，`/og/item/:id.png`、`/og/tutorial/:id.png` 动态生成 1200×630 品牌卡片（`lib/og-card.js`，含内容标题，打包 Noto Sans CJK 字体）；首页 `?id=` 与教程详情页自动注入对应 `og:title/desc/image`（`head()` 用 `opts.image`）。
> - 页面级 SEO：`<link rel="canonical">`（全站统一指向 SEO 主域 `https://free-tokens.org`，`CANONICAL_ORIGIN` 可覆盖；海报/二维码/og:image 跟随当前域）、Open Graph / Twitter Card meta、JSON-LD（WebSite/Article/ItemList/CollectionPage）、`og:image`（`/og-image.png` 1200×630）；教程详情页、首页条目、教程/Skill 列表首屏已**服务端渲染（SSR）**，无 JS 爬虫也可读到全文与详情链接；下线条目页 200 + 已下线提示 + `noindex`（不再 404 撞死链），待审核教程/未上线 Skill 与 `/dashboard` 设置 `noindex`，不存在的教程/Skill id 硬 404。

## 数据库

SQLite (better-sqlite3, WAL 模式)，文件 `data/app.db`（`DB_PATH` 可覆盖）。WAL `journal_size_limit=4MB` 防无限膨胀 + 每次巡检后 `wal_checkpoint(TRUNCATE)` 归零；`items.token` 全局唯一索引（DB 级并发去重兜底）。**响应压缩在 Nginx（gzip level 5 + proxy_cache 微缓存 30s，`freeapis` 区）**，Express 不做压缩——改性能相关代码先看 Nginx。

```sql
-- users 表
CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE, password TEXT, email TEXT DEFAULT '', phone TEXT DEFAULT '', nickname TEXT DEFAULT '', avatar TEXT DEFAULT '', role TEXT DEFAULT 'user' CHECK(role IN ('user','moderator','admin')), points INTEGER DEFAULT 0, pull_date TEXT DEFAULT '', pull_count INTEGER DEFAULT 0, token_epoch INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP); -- avatar=/uploads/avatars/<uid>-<6hex>.<ext>

-- items 表
CREATE TABLE items (id TEXT PRIMARY KEY, name TEXT, desc TEXT, url TEXT, provider TEXT, category TEXT, token TEXT, token_type TEXT, tags TEXT, compat TEXT DEFAULT '[]', models TEXT DEFAULT '[]', created_by TEXT REFERENCES users(id), verified INTEGER DEFAULT 0, created_at DATETIME, updated_at DATETIME);

-- invite_codes 表（注册邀请码）
CREATE TABLE invite_codes (code TEXT PRIMARY KEY, created_by TEXT, used_by TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, used_at DATETIME);

-- tutorials 表（AI 教程，Markdown 正文；cover=封面图 URL，可空）
CREATE TABLE tutorials (id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT DEFAULT '', content TEXT NOT NULL, category TEXT DEFAULT '教程', tags TEXT, created_by TEXT REFERENCES users(id), verified INTEGER DEFAULT 0, reject_reason TEXT DEFAULT '', cover TEXT DEFAULT '', created_at DATETIME, updated_at DATETIME);

-- points_log 表（积分流水：发布奖励 +1 / 拉取消耗 -1）
CREATE TABLE points_log (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), delta INTEGER, reason TEXT, ref_id TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);

-- comments 表（ref_id 分流：''=首页留言墙；条目 id=Token 详情评论，生命周期跟条目）
CREATE TABLE comments (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), content TEXT NOT NULL, ref_id TEXT DEFAULT '', created_at DATETIME DEFAULT CURRENT_TIMESTAMP);

-- feedback 表（公社信箱：反馈/Bug 上报，单入口双标签，仅登录可发，版主+后台处理；points_awarded=版主通过并给作者 +1 积分的标记）
CREATE TABLE feedback (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), kind TEXT DEFAULT 'feedback', content TEXT NOT NULL, image TEXT DEFAULT '', url TEXT DEFAULT '', status TEXT DEFAULT 'open', points_awarded INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);

-- Skill 广场 6 张表（2026-08-18 加；正文不落库，存 data/skill-files/<versionId>/SKILL.md，部署 tar 排除）
CREATE TABLE skills (id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, author_id TEXT REFERENCES users(id), title TEXT NOT NULL, summary TEXT DEFAULT '', description TEXT DEFAULT '', category TEXT DEFAULT '通用', tags TEXT DEFAULT '[]', cover TEXT DEFAULT '', price INTEGER DEFAULT 0, status TEXT DEFAULT 'pending' CHECK(status IN ('draft','pending','rejected','online','offline')), current_version TEXT DEFAULT '', downloads INTEGER DEFAULT 0, copies INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE skill_versions (id TEXT PRIMARY KEY, skill_id TEXT REFERENCES skills(id), version TEXT NOT NULL, content_path TEXT NOT NULL, resources_json TEXT DEFAULT '[]', sha256 TEXT DEFAULT '', scan_report TEXT DEFAULT '', status TEXT DEFAULT 'pending' CHECK(status IN ('pending','rejected','online')), reject_reason TEXT DEFAULT '', reviewed_by TEXT REFERENCES users(id), reviewed_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE skill_purchases (id TEXT PRIMARY KEY, skill_id TEXT REFERENCES skills(id), buyer_id TEXT REFERENCES users(id), version_at_buy TEXT, price INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));  -- + idx_skill_purchases_unique(skill_id,buyer_id) 购买幂等
CREATE TABLE skill_audit_log (id TEXT PRIMARY KEY, skill_id TEXT REFERENCES skills(id), action TEXT NOT NULL CHECK(action IN ('submit','verify','reject','offline','online','delete')), version TEXT, detail TEXT DEFAULT '', operator_id TEXT REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE skill_reviews (id TEXT PRIMARY KEY, skill_id TEXT REFERENCES skills(id), user_id TEXT REFERENCES users(id), rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), content TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(skill_id, user_id));
CREATE TABLE skill_reports (id TEXT PRIMARY KEY, skill_id TEXT REFERENCES skills(id), reporter_id TEXT REFERENCES users(id), type TEXT NOT NULL CHECK(type IN ('malicious','copyright','false','invalid','privacy')), content TEXT NOT NULL, status TEXT DEFAULT 'open' CHECK(status IN ('open','done')), handled_by TEXT REFERENCES users(id), handle_note TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));  -- 举报表已建，处理端点未实现
```

> **积分系统**：发布**含 Token** 的条目即自动上线并给作者 +1、**教程审核通过**给作者 +1、**反馈被版主通过为高质量**给作者 +1（`lib/points.js` 的 `awardPointsOnce`，幂等防重复，流水进 `points_log`；反馈通过 `reason='feedback_verify'` + `ref_id=feedback.id`）；**打赏**（人→人积分流动）：打赏者 -1（`reason='tip'`）/ 发布者 +1（`reason='tip_received'`），同用户同条目幂等一次（`idx_points_log_tip_unique` DB 兜底）；CLI `recent` 拉取 API Key **每日免费 5 次**（`users.pull_date/pull_count` 按天懒重置），超出每次扣 1 积分（`consumePulls`）；版主/管理员豁免；拉取限制**只作用于 CLI `recent`**（网页详情不限制，按用户选择）。

> 角色：`user`（默认） / `moderator`（可审核条目） / `admin`（全部权限）。管理员经 `/dashboard#admin` 进入管理后台。
> 审核：仅 `verified=1` 条目进入公开首页/列表；`/api/items/:id` 对未审核条目仅作者/版主/管理员可见。
> 注册：需邀请码（`invite_codes` 表），管理员在后台"邀请码"tab 或 `cli admin invite` 生成。

## 项目结构

```
├── server.js              # Express 服务（路由 + 服务端渲染页面）
├── cli.js                 # CLI 工具（版本单一来源）
├── data/
│   └── ai-tools.js        # AI 工具导航策展数据（/tools 页，站长维护，增删工具改此文件）
├── lib/
│   ├── db.js              # SQLite 连接 + 建表/迁移
│   ├── auth.js            # JWT 认证 / 注册登录 / 角色中间件
│   ├── layout.js          # 页面布局工厂 + Lucide sprite 内联
│   ├── points.js          # 积分/拉取逻辑
│   └── og-card.js         # 分享卡片/OG 图/二维码海报生成（@napi-rs/canvas）
├── public/
│   ├── index.html         # 首页壳
│   ├── app.js             # 前端逻辑
│   ├── upload.js          # 可复用图片上传组件（点击/拖拽/Ctrl+V 粘贴三合一，window.Uploader.create）
│   ├── dash.js            # 管理后台脚本（外置，可 lint/单测）
│   ├── styles.css         # 设计系统（含暗色主题）
│   ├── icons.svg          # Lucide sprite
│   ├── wechat-group.jpg   # 微信群二维码
│   └── download/          # CLI tarball（freeapis-cli-*.tgz）
├── scripts/
│   ├── build-cli-package.js  # 打包自托管 CLI tarball
│   ├── check.js              # 零依赖语法检查（npm run check）
│   ├── deploy.sh             # 一键部署（--precheck 先跑测试；打包排除 宣传物料）
│   ├── backup.sh             # 每日 SQLite 热备份
│   ├── healthcheck.sh        # 健康检查 + 告警
│   ├── gen-og-image.js       # 站点默认 OG 图 1200×630
│   ├── gen-posters-html.js   # 宣传海报生成（HTML+CSS 源 → Playwright 截图，自带溢出检测）
│   └── gen-promo-posters.js  # 早期 canvas 版海报生成器（v2，已由 gen-posters-html.js 取代）
├── 宣传物料/                # 微信公众号/小红书推广物料（海报/文案/公众号文章，见 宣传物料/README.md）
├── .gitea/workflows/ci.yml   # Gitea Actions CI
├── .env.example              # 环境变量示例
├── tests/                 # 测试（api/cli/cli-e2e/playwright）
├── AGENT.md               # 全局接管指南（新会话先读）
├── CLAUDE.md              # 本文件（操作速查）
├── CHANGELOG.md           # 项目变更日志
├── CHANGELOG-SCHEMA.md    # 数据库 schema 变更日志（2026-08-06 迁移）
├── DEPLOYMENT-SOP.md      # 部署运维 SOP
├── ADMIN-ACCOUNT.md       # 管理员账号
└── SECURITY-REVIEW-REPORT.md  # 安全加固结论报告
```

## 测试

```bash
npm test          # 全量：文档守护(11) + API(312) + CLI(11) + CLI e2e(37) = 371 项（doc-consistency 在最前，防文档与代码脱节）
npm run check     # 零依赖语法检查
npm run ci        # check + 全量测试（CI/发布前置门槛）
# playwright 全栈/冒烟（各脚本自起服或用临时 DB）：
#   playwright-full.js  全栈主套件：先 DB_PATH=data/pwfull.db PORT=3000 node server.js 起服，
#                       再 DB_PATH=data/pwfull.db node tests/playwright-full.js
#   playwright-admin.js  后台三功能冒烟（用户注册日历/邀请码 Tab/教程拒绝理由）
#   playwright-banner.js 首页 Banner 双列紧凑 + 全宽搜索条冒烟
#   playwright-slogan.js 首页口号 + 免责声明弹窗冒烟
#   playwright-sse.js    SSE 实时推送冒烟（提示条 → 点击加载新卡片）
#   playwright-uploader.js  可复用上传组件冒烟（三处上传点：反馈弹窗/发布封面/编辑封面 × 点选/拖拽/粘贴 + 外链互斥 + 关窗不触发）
#   playwright-tools.js  AI 工具导航冒烟（/tools 分类渲染/搜索过滤/官网外链/免费用角标/移动端/sitemap/llms）
#   playwright-ccswitch.js  CC Switch + 复制完整配置冒烟（未登录不可见 / 已登录 data 属性与 ccswitch:// 深链 / 复制完整配置双格式块 / 唤起失败复制兜底面板 / i 说明面板含自检与修复脚本）
#   smoke-announcements.js  公告冒烟（API + CLI + 首页公告栏）
```
