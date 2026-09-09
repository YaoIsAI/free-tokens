# AGENT.md �?free-tokens Token公益�?全局接管指南

> **给任何接手本项目�?AI Agent / 开发�?*：读完本文件即可完整接管本项目——项目定位、技术栈、架构、全部功能、CLI、部署、服务器访问、排障、测试、回滚，一条不漏�?
> 本文件是**项目唯一权威入口**，随代码维护，最后更新：2026-08-18�?
> 建议新会话第一步：读本文件 �?�?`CLAUDE.md`（AI 操作速查）→ �?`DEPLOYMENT-SOP.md`（部�?SOP 细节）�?

---

## 1. 这是什么项�?

**free-tokens · Token公益�?* —�?免费大模�?API Token 信息聚合平台�?

- **定位**：把群里/社区里免费分享的 AI 大模�?API Key（OpenAI/Anthropic/千问/Grok/MiniMax 等）聚合起来，做成可搜索、人人可发布（众创）、有 CLI 的公益站�?
- **品牌**：free-tokens（页面头�?logo �?sparkles 星星，页脚连续拼�?`free-tokens`）。双域名均为品牌入口：`free-tokens.org`（新主品牌域名，Cloudflare DNS-only + Let's Encrypt）与 `freeapis.top`；可经两域名任一访问同一应用；SEO 主域收敛：canonical / sitemap / JSON-LD / llms.txt / 分享链接统一指向 `https://free-tokens.org`（防双域名自我重复），分享海�?/ 二维�?/ og:image（功能性、就近抓取）继续跟随当前请求域名�?
- **商业模式**：免�?Token 引流 �?帮厂商宣�?+ 出教�?�?积累用户 �?广告/增值收入支撑运维（当前站点保持纯净，无广告位）�?
- **内容规则**：Token 是公开公益 key，多人共用、寿命有限（"用不了就是被用完�?）。本站负责聚�?+ 失效清理（发布即自动上线，核心是众创），不保证永久可用�?

### 关键产品决策（本会话确立，务必延续）

| 决策 | 说明 |
|------|------|
| Token 脱敏 | 详情弹窗 Token 只显示首4+`••••••••`+�?，点复制/点框才拿到真实�?|
| 登录才能�?Token | 未登录用户详情弹窗只显示"登录后可查看 API Token"+登录按钮，后端不返回真实 token |
| 登录才能�?Base URL | �?Token 条目未登录时 Base URL（`url`）同样隐藏（`urlLocked`），登录才显�?Base URL / API Key / 可用模型 |
| 兼容模式检�?| 发布/编辑时对 Token 端点探测 OpenAI / Anthropic 兼容，通过者写�?`compat` 并在卡片/详情展示徽章 |
| 审核可见�?| **发布即上线（仅收真实可用 Token�?*：本�?*只收录真实可�?Token**——发�?编辑必须�?`url`（API Base URL�? `token` 且端点测试通过（零错误），**纯链�?�?Token 条目一律拒绝（400�?*；通过即自动公开无需人工审核；版�?管理员仍可下�?删除（下�?回到不公开）；**教程保留版主审核** |
| Token 去重 | 发布/编辑�?Token 全局唯一，重复返�?400 |
| Token 发布校验 | 发布/编辑�?Token 时，先用 `url`（API base_url）做有效性测试，**必须真实返回 2xx（零错误�?*才允许发布；429 限流/用量保护等任何非 2xx 同样拒绝 |
| 失效自动下线 | 手动一键检测（后台按钮�?`cli admin check`�? **定时自动巡检（默认每 6 小时�?*共用判定：明确失效（401/403 无效 key、连接失败�?04�?03、任何非 2xx）自动下线回待审核；**429 限流保护视为有效不下�?* |
| AI 工具导航 | `/tools` �?123 �?AI 官网导航：按分类（对�?图像/视频/编程/音频/办公/搜索/智能�?设计/写作）列出主�?AI 产品，每�?= **真实品牌 logo**（自托管 `public/tools-icons/` 白底芯片，无则回退渐变首字母）+ 名称 + 一句话 + 官网直达；顶部搜索过�?+ 吸顶分类条滚动高亮；有站内免�?Token 的产品带「免费用」角�?�?`/?search=` 引流（首页支持该深链自动搜索过滤；角�?rel=nofollow + robots 屏蔽 `?search=`，防参数重复页污染索引）。数�?= 站长策展静态配�?`data/ai-tools.js`（增删工具改该文件），无 DB/审核 |
| AI 教程共同发布 | `/tutorials` 社区 AI 教程（Markdown�?*标题浮在封面上的杂志风卡�?*+独立详情；封面区有图显示图、无图用分类渐变+图标占位，左上浮分类徽章、底部浮白色标题，封面下方仅简介）。封面来源：网页发布/编辑表单**上传**（`POST /api/upload`，存 `data/uploads/`）或**外链**；CLI �?`upload <本地�?` �?`/uploads/xxx.png` �?`tutorial add/edit --cover` 填该地址�?https 外链；旧教程可在「我的教程」编辑补封面�?*正文支持插图**：Markdown `![说明](/uploads/xxx.png)` �?`![说明](https://外链)`（`md.js` 渲染，协议白名单 https:/本站，独立成行居中大图、行内随文，`loading=lazy` + `referrerpolicy=no-referrer`）。版主审核通过才公开�?*教程正文里独立成行的 B 站视频链�?*（`bilibili.com/video/BVxxx`）自动渲染成在线播放器（16:9 响应�?iframe，CSP `frame-src` 白名单放�?`player.bilibili.com`）；**微信内置浏览器无法内�?bilibili 播放�?*——服务端微信 UA + 浏览器端 `navigator` 双重检测，自动降级为「在哔哩哔哩打开观看」跳转卡片，桌面/普通手机仍内嵌 |
| 注册邀请码 | 网页+CLI+API 注册全强制邀请码，每码用一次，管理员生�?|
| 密码找回 | 注册时可�?*邮箱/手机�?*（选填，用于验证与找回），注册后可在后台「编辑资料」或 CLI `profile -e/--phone` 补填/修改�?*无验证码自助找回**：凭「用户名 + 注册邮箱/手机号」匹配即可重设密码（`POST /api/auth/recovery`、CLI `recover`、登录弹�?忘记密码"）——邮�?手机号≈弱密码，用找回专用限流（5�?10�?IP�? 复用登录锁定兜底�?*未填联系方式的账�?*靠管理员重置（`admin reset-password` + 后台钥匙按钮）恢复；**不做** Google 一键登录（大陆被墙 + 邀请码边界冲突�?|
| 微信二维�?| 真实群二维码图片，弹窗四步引导「加微信 �?发暗�?free-tokens �?向群�?管理员索取邀请码 �?回注册页粘贴」，备注"free-tokens，Token公益�? |
| 暗色主题 | 浅色/深色双主题，本地持久�?+ 跟随系统 |
| 积分激�?| 闭环激励：发布**�?Token** 的条目即自动上线并给作�?+1�?*教程审核通过**给作�?+1（`lib/points.js` �?`awardPointsOnce`，幂等防重复，流�?`points_log`）；CLI `recent` 拉取 API Key **每日免费 5 �?*，超出每次扣 1 积分（`GET /api/recent` 计费）；版主/管理员豁免；拉取限制**只作用于 CLI `recent`**（网页详情仍直接显示�?Key，按用户选择不限制） |

---

## 2. 技术栈与架�?

### 技术栈
- **后端**：Node.js（≥18，生�?v22.22.3�? Express。无数据�?ORM�?
- **数据�?*：SQLite（better-sqlite3 原生模块，WAL 模式）。文�?`data/app.db`（`DB_PATH` 可覆盖）�?
- **鉴权**：JWT（jsonwebtoken�? 天过期），密�?bcryptjs�?
- **安全**：helmet（含 CSP nonce）、express-rate-limit（接口级 + 写级）、请求体 50kb 限制�?
- **响应压缩**：在 **Nginx**（gzip level 5 + proxy_cache 微缓�?30s，`freeapis` 区）�?*Express 不做压缩**�?026-08-15 移除逐响�?compression，消除并�?CPU 瓶颈）——改性能相关代码先看 Nginx 配置�?
- **前端**：纯原生 JS + CSS�?*服务端渲染布局工厂** `lib/layout.js`，无前端框架、无构建步骤�?
- **图标**：Lucide sprite 单个 SVG，`lib/layout.js` 启动�?*内联进每个页�?HTML**（`<use href="#lucide-xxx">` 同文档引用），无外部 sprite 请求�?
- **分享卡片/OG �?*：`lib/og-card.js` �?`@napi-rs/canvas`（打�?Noto Sans CJK 字体�? `qrcode` 动态生成——分享海�?`/poster/*`、动�?OG �?`/og/*`、站点默�?OG `public/og-image.png`�?
- **宣传海报**：`scripts/gen-posters-html.js`（HTML+CSS flex �?`宣传物料/海报-src/posters.html` �?Playwright 截图；每张构图独立、两种比例用 `--sc` 变量独立调号、自带溢出检测）。早�?canvas �?`scripts/gen-promo-posters.js` 已被取代，仅作历史保留�?
- **CLI**：commander，全自包�?tarball 分发（见 §8）�?

### 安全加固�?026-08 已落地，接手勿回退�?
- **SSRF 防护**：`testWithBaseUrl` 对自定义 `base_url` �?DNS 解析 + 私网/回环/链路本地/元数�?IP 拦截，`redirect:'manual'` 不回显响应体。测试可�?`ALLOW_PRIVATE_SSRF=1` 放开（仅测试）�?
- **IDOR 防护**：`PUT/DELETE /api/items/:id` �?`canModifyItem` 所有权校验�?
- **反代限流**：`app.set('trust proxy', 1)`（必须部署在单层 Nginx 之后）�?
- **JWT**：生产缺�?`JWT_SECRET` fail-fast；`verify` 限定 `HS256`�?
- **XSS**：`esc()` 转义 `& < > " '` 五种字符（app.js + layout.js）�?
- **邀请码**：事务内条件 UPDATE 保证一码仅用一次�?
- **邀请码�?*：生成用 `crypto.randomBytes(6)`�?8 �?/ 12 位十六进制），暴力枚举空�?~2.8e14，配合按 IP 写限�?30/分，无法破解�?
- **匿名门控**：所有条目响应经 `mapItem(item, !!req.user)`，未登录 token/url 返回空串 + `urlLocked`/`tokenLocked`；待审核条目匿名 404；贡献榜/动�?统计不�?token 列�?
- **登录锁定**：同一账号连续失败 �? 次锁�?15 分钟（`lib/auth.js` 内存态，按用户名；成功登录清除；对不存在用户名同样计数，避免泄露账号存在；用户不存在时用�?bcrypt 抹平响应时差）�?
- **密码策略**：注册密码需 �? 位且同时含字母和数字（`register` 校验 + 前端 placeholder/提示同步）�?
- **JSON-LD 注入防护**�?026-08-15）：`lib/layout.js` �?JSON-LD 里的 `<` 编码�?`<`（`JSON.stringify(o).replace(/</g,'\\u003c')`），封堵 `</script>` 逃逸型存储�?XSS（条目名/教程标题注入首页/详情 SSR）�?
- **CSP nonce**�?026-08-15）：`script-src` 移除 `'unsafe-inline'`，改为每请求随机 nonce；全�?3 处内联脚本（主题预绘 `layout.js`、`/cli`、`/guide`）均�?nonce。保�?`script-src-attr 'none'`（禁内联事件）�?
- **监听绑定**�?026-08-15）：`app.listen(PORT, '127.0.0.1')`，仅本机监听，配�?Nginx 反代，不再绑�?0.0.0.0�?
- **Host 头白名单**�?026-08-15）：`absUrl` 只认 `freeapis.top`/`free-tokens.org`/`localhost`/`127.0.0.1`/服务�?IP，恶�?Host 不进�?canonical/OG/海报二维码绝对地址�?
- **JWT 密钥强度**�?026-08-15）：生产 `JWT_SECRET` 长度 <32 字节直接拒绝启动�?
- **Token 测试鉴权**�?026-08-15）：`/api/test-token` 需登录（防无鉴�?Token 有效性预言机滥用）�?
- **og/poster 图片缓存**�?026-08-17）：og/item、og/tutorial、poster/* �?canvas 光栅化是 CPU 重活，加 `ogImageCache` LRU 内存缓存�?00 条，key �?`updated_at` 条目变更自动失效），防「伪造爬�?UA 遍历 id 触发无限 canvas 渲染」DoS 放大�?
- **双域名图片一致�?= 全相对路�?+ 入库归一�?*�?026-08-18）：helmet 默认全站 `Cross-Origin-Resource-Policy: same-origin`，若教程里存了另一域名的绝对本站图（如 `https://freeapis.top/uploads/x.png`），�?free-tokens.org 页面加载属跨源会被浏览器拦（`ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`）→ 图片裂�?*根治方案（不放宽 CORP�?*：发�?编辑教程时把本站绝对 uploads URL 归一化为相对 `/uploads/...`（`normalizeUploadUrl`，覆�?freeapis.top/free-tokens.org/localhost+端口，第三方外链不动），存量一次性迁移为相对 �?全站图片 URL 恒为相对，任何域名（含未来增减）都同源加载、永不触发跨域�?*CORP 保持 helmet 默认 same-origin**（最严，媒体资源未误放宽）；`mapTutorial` 与前�?`md.js`/`tutorial.js` 渲染层再归一化兜底（防绕过发布直接改�?手工插绝�?URL）�?
- **掺水检�?AI 辅助判定（判�?LLM 池）**�?026-08-18）：`lib/ai-judge.js` �?*平台自有有效 token 当判�?LLM**（候选池 = items verified + openai 兼容，`AI_JUDGE_*` 环境变量控制；自动探�?故障切换/冷却熔断/可用判官缓存刷新），对掺水检测的语义信号（模型回�?身份自报/知识答案）做结构化判断，**有把握时�?echo/identity �?warn 修正�?pass 并上修评�?*（只升不降、绝不触�?redEcho/redId/redThink 红线），不破坏规则判定。安全：判官 token 仅存模块内存，`enhance()` 只接�?*脱敏文本信号**（绝不含任何用户 token 明文）；判官会话健康校验要求能回 AI_VERDICT 结构�?JSON（防把只能回文本的非判官端点当判官）；判官按**完整 base URL** 排除自引用（非仅 hostname）；判官池全部不可用/解析失败/超并�?�?优雅降级回纯规则并标�?`available:false`；`/api/verify/model` 结果 60s 短缓存（`verifyModelCache`）减少重复打判官�?
- **robots.txt AI �?Disallow**�?026-08-17）：robots 语义里具�?UA 组优先于 `*` 组，故每个显式放行的 AI bot 组（GPTBot/ClaudeBot/…）必须带与 `*` 相同�?`Disallow: /api/ /dashboard /download/`，否�?`Allow: /` 会覆盖掉 `*` 组的禁止�?
- **SSRF 端口钉死**�?026-08-17）：`curlFetch` �?`--resolve` 改用 URL 实际连接端口（含自定义端口，`u.port` 取显式端口、否则按协议 80/443），�?isBlockedHost 校验�?curl 对非标准端口重新解析导致 DNS rebinding 绕到内网�?
- **访客统计 session 去重**�?026-08-17）：前端 `track.js` �?`sessionStorage`（`freeapis_tracked`）记录本标签页会话已上报 path，同会话�?path 只上报一次（对齐 umami/plausible 主流「会�?独立访客」口径，抑制猛刷同页虚增）；服务�?`recordVisit` **不做** (ip,path) 去重保持 PV 准确，防刷靠 `trackLimiter(120/�?IP)`�?

### 架构�?
```
用户浏览�?
   �? https://free-tokens.org / https://freeapis.top:443
   �?
Nginx (aaPanel, Let's Encrypt ECC 证书)  proxy_pass
   �?
127.0.0.1:3001 ── pm2: token-charity ── Express ── better-sqlite3 (data/app.db, WAL)
                      �?
                      ├─ 服务端渲染页面：/  /guide  /cli  /dashboard
                      ├─ JSON API�?api/*
                      └─ 静态资源：public/*（带内容哈希 ?v=�?
```

### 目录结构（当前真实）
```
├── server.js              # Express 服务（路�?+ 服务端渲染页面）
├── cli.js                 # CLI 工具（版本单一来源：program.version�?
├── lib/
�?  ├── db.js              # SQLite 连接 + 建表/迁移（getDb�?
�?  ├── auth.js            # JWT 认证、register/login、角色中间件
�?  ├── points.js          # 积分/拉取逻辑（awardPoints / getPointsState / consumePulls�?
�?  ├── layout.js          # 页面布局工厂（head/header/footer/modals/page�? sprite 内联
�?  ├── analytics.js       # 站内极简分析组件（访客统�?beacon + 服务器资�?60s 采样，零依赖，组件化可复用）
�?  └── og-card.js         # 分享卡片/OG �?二维码海报生成（poster / ogCard / render�?
├── data/
�?  └── ai-tools.js        # AI 工具导航策展数据�?tools 页，站长维护，增删工具改此文件）
├── public/
�?  ├── index.html         # 首页�?
�?  ├── app.js             # 前端逻辑（列�?详情/登录/发布/主题/脱敏/自动测试/CC Switch�?
�?  ├── dash.js            # 管理后台脚本（已�?server.js 外置，可 lint�?
�?  ├── tools.js           # /tools 导航页脚本（搜索过滤 + 吸顶分类条滚动高亮）
�?  ├── tutorial.js        # 教程页脚本（发布/编辑表单 + 封面上传组件接入�?
�?  ├── upload.js          # 可复用图片上传组件（点击/拖拽/Ctrl+V 三合一，window.Uploader.create�?
�?  ├── md.js              # Markdown 渲染器（esc-first，插�?B 站视�?微信降级�?
�?  ├── track.js           # 站内访客统计 beacon（layout.js 注入所�?HTML 页，sendBeacon 上报时区/语言�?
�?  ├── styles.css         # 设计系统�?-c-* 令牌 + 暗色覆盖�?
�?  ├── icons.svg          # Lucide sprite（脚�?scripts/build-icons.js 维护�?
�?  ├── tools-icons/       # /tools 品牌 logo（自托管 SVG/PNG，scripts/download-tools-icons.js 批量下载�?
�?  ├── wechat-group.jpg   # 微信群二维码（真实图，替换后 bump app.js �??v=�?
�?  └── download/          # CLI tarball（freeapis-cli-*.tgz，打包脚本自动清理旧版）
├── scripts/
�?  ├── build-cli-package.js  # 打包自托�?CLI tarball
�?  ├── build-icons.js        # Lucide sprite 构建（icons.svg�?
�?  ├── check.js              # 零依赖语法检查（npm run check�?
�?  ├── deploy.sh             # 一键部署（--precheck 先跑测试；打包排�?宣传物料�?
�?  ├── backup.sh             # 每日 SQLite 热备份（加服务器 crontab�?
�?  ├── healthcheck.sh        # 健康检�?+ 告警（加服务�?crontab�?
�?  ├── gen-og-image.js       # 站点默认 OG �?1200×630（public/og-image.png�?
�?  ├── gen-posters-html.js   # 宣传海报生成（HTML+CSS �?�?Playwright 截图，自带溢出检测）
�?  ├── gen-promo-posters.js  # 早期 canvas 版海报生成器（v2，已�?gen-posters-html.js 取代�?
�?  ├── download-tools-icons.js  # /tools 品牌 logo 批量下载（自托管，维护用�?
�?  └── check-tools-links.js     # /tools 官网链接巡检�?xx/3xx=OK�?03/429=风控、其�?DEAD�?
├── 宣传物料/                # 公众�?小红书推广物料（文章/海报/文案，见 宣传物料/README.md�?
├── .gitea/workflows/ci.yml   # Gitea Actions CI（需激�?runner�?
├── .env.example              # 环境变量示例
├── data/                  # SQLite 数据库（app.db，git 忽略�? 迁移脚本
├── tests/                 # 测试（api/cli/cli-e2e/playwright，见 §12�?
├── CLAUDE.md              # AI 操作速查
├── AGENT.md               # 本文件（全局接管指南�?
├── CHANGELOG.md           # 项目变更日志
├── CHANGELOG-SCHEMA.md    # 数据�?schema 变更日志�?026-08-06 迁移�?
├── DEPLOYMENT-SOP.md      # 部署运维 SOP
├── ADMIN-ACCOUNT.md       # 管理员账号记�?
└── SECURITY-REVIEW-REPORT.md  # 安全加固结论报告（分维度评分/修复清单/遗留项）
```

---

## 3. 生产环境（服务器 + 域名�?

| 项目 | �?|
|------|----|
| 公网地址 | `https://free-tokens.org`（SEO 主域，canonical/sitemap/JSON-LD/分享链接统一指向它）�?`https://freeapis.top`（双域名均可访问同一应用；海�?二维�?og:image 跟随当前请求域名�?|
| 服务器公�?IP | `your.server.ip`（AWS ap-southeast-2 悉尼�?|
| SSH | `ssh -i ~/.ssh/your_key root@your.server.ip` |
| 本应用监�?| `127.0.0.1:3001`（仅内网，Nginx 反代，不开额外外网端口�?|
| 代码目录 | `/www/wwwroot/freeapis.top/` |
| 数据�?| `/www/wwwroot/freeapis.top/data/app.db` |
| 进程守护 | pm2，名 `token-charity` |
| 反向代理 | `/www/server/panel/vhost/nginx/freeapis.top.conf` |
| SSL 证书 | `/www/server/panel/vhost/cert/freeapis.top/`（Let's Encrypt ECC，acme.sh 自动续期�?|
| DNS | `freeapis.top` �?DNS �?*阿里�?*（不在服务器 AWS 账号下），域名变更需手动在阿里云操作 |
| OS | Amazon Linux 2023（dnf 包管理），Node v22.22.3，npm 10.9.8，pm2 7.0.1 |

### 铁律（接手必读）
1. 本应用监�?`3001`，绝不与同服务器 `3002`（geowiki.pro 业务）冲突�?
2. **绝不修改**同服务器其他应用：geowiki.pro、g.freeapis.top�?x-ui）�?4321/2096�?x-ui）�?5036（aaPanel）�?
3. �?Nginx 前先 `/www/server/nginx/sbin/nginx -t`，重载用 `/etc/init.d/nginx reload`（不�?`systemctl`）�?
4. 服务器内存仅 **1.9GB**，避免加重型服务�?
5. 服务�?*无法访问**本地 Gitea（`192.168.31.85` 内网 IP），代码只能本地上传�?

### 生产 `.env`（`/www/wwwroot/freeapis.top/.env`，权�?600�?
```
PORT=3001
DB_PATH=data/app.db
JWT_SECRET=<openssl rand -hex 32 强随机�?
```
> ⚠️ `.env` 不上传、不�?git，保留服务器现有值�?

---

## 4. 用户与权限系�?

- **角色**：`user`（默认）/ `moderator`（可审核条目�? `admin`（全部权限，含用户管理、邀请码）�?
- 权限判定：JWT payload �?id/username，中间件每次�?`getUserRole` 查库比对（改角色即时生效）�?
- 注册�?*必须填邀请码**（`invite_codes` 表），无�?错码/重复码都 400。邀请码由管理员在后�?邀请码"tab �?`cli admin invite` 生成，每码仅用一次（事务保证用户名冲突回滚不废码）�?
- 昵称：用户可设昵称（�?0 字），展示名优先昵称回退账号�?
- 管理员账号见 §11�?

---

## 5. 全部功能清单（现状）

**游客可看**
- 首页：分�?tab 筛选、大搜索框、卡片瀑布�?*贡献�?+ 最新动态（含打赏事件「xx 认可�?yy」，侧栏�?HTML SSR 直出不等�?JS�?*�?*底部评论�?*（横向滚动留言弹幕，带小头像）�?*Banner 下方公告�?*（管理员官方通知滚动 + **每周一自动社区周报**，无公告自动隐藏）、站点统�?
- 详情弹窗：脱�?Token（登录后可看真实值）、自动测试并展示可用模型列表�?*复制完整配置**（按 `compat`/`tokenType` 生成 OpenAI/Anthropic/Gemini 可粘�?env 块）�?*一键导�?CC Switch**（`ccswitch://` 深链，未唤起自动复制 Key + 手动粘贴兜底；旁�?`?` 说明面板含自检与便携版修复脚本下载�?
- **一键分�?*：Token 卡片 / 详情弹窗 / 教程文章均带分享按钮，点击打开**二维码卡片弹�?*（统一弹窗，不自动调系统分享——Windows/桌面 `navigator.share` 会弹系统分享 UI 而看不到我们设计的卡片；「系统分享」保留在弹窗内手动点）。弹窗展�?`/poster/item/:id.png`、`/poster/tutorial/:id.png`、`/poster/site.png`�?00×800 紧凑 3:4 卡片，底部展�?*当前访问域名** `free-tokens.org`/`freeapis.top`）；「复制整张卡片」把整张图复制进剪贴板（`ClipboardItem` PNG），不支持则回退下载；另有「复制链�?+ 系统分享」。分享到微信�?`/og/item/:id.png`、`/og/tutorial/:id.png` 动态生�?1200×630 品牌 OG �?
- `/guide` 教程页、`/cli` CLI 使用页、`/tutorials` AI 教程列表（杂志风卡片 + 详情页）、`/tools` AI 工具官网导航（好 123 式，97 个工�?+ 搜索 + 分类跳转、外跳经站内提示页）、微信加群弹�?
- **个人主页 `/user/:id`**（SSR）：头像（上传图/回退首字母）+ 四格统计（贡�?Token/通过教程/获得认可/积分�? 贡献条目与教程卡片；**点贡献的 Token 卡片原地打开详情弹窗**（不跳首页、URL 不变，关闭仍在主页——详情弹窗簇已提升到 app.js IIFE 顶层全站可用）；详情弹窗发布者、贡献榜、评论墙昵称均可点入

**登录用户**
- 查看/复制真实 Token、发布条目（发布即自动上线）、我的发布（含已下线的）、编�?删除自己的条目、编辑资料（昵称/邮箱/手机号，用于找回密码�?*头像上传**——头像本身即触发器，点击/拖拽/Ctrl+V 粘贴三合一即传即生效，PNG/JPG/WebP/GIF �?MB，按用户 ID 归档 `uploads/avatars/<userId>-<6hex>.<ext>` 一用户一文件换即替换，头部菜�?个人主页/后台/贡献�?动态流/评论墙全站展示，未设置或图片失效回退首字母）
- **评论�?*：在首页「大家说」发表站点留言（≤100 字，自动公开），可删自己的留言
- **Token 评论**：详情弹窗内「评�?· 实测交流」区�?-200 字，登录可发/可删自己的）——与留言墙共�?`comments` 表按 `ref_id` 分流�?*生命周期跟条目走**（下�?删除�?404 不可见，重新上线恢复�?
- **公社信箱**：首�?footer「公社信箱」提交反�?Bug（双标签），可附图片（共用组�?`public/upload.js`，点�?拖拽/粘贴三合一，走 `/api/upload`；教程封面同组件）与相关页面
- 发布�?Token 时会自动做有效性测试，失败拒绝
- **积分**：发布含 Token 条目即上�?+1、教程审核通过 +1；CLI `recent` 拉取每日免费 5 次，超出�?1 积分/次（后台看余�?额度/积分明细�?
- **打赏**：Token 卡片上与详情弹窗内均可「�?打赏 1 积分」给发布者（仅已上线非本人条目、同用户同条目幂等一次——DB 级部分唯一索引兜底；卡片钮显示被认可计数、本人视角绿色徽标；打赏事件并入首页动态流�?

**版主/管理员（管理后台 `/dashboard#admin`�?*
- 条目管理：新条目自动上线无需审核；按待审�?已通过/垃圾�?全部筛选，通过验证 / 下线�?取消验证，回到不公开�? 移入垃圾�?/ 撤回 / 彻底删除；「一键清理待审」把全部待审核移入垃圾桶
- **检测失效并下线**：一键测试全部已发布 Token，明确失效（401/403、连接失败�?04�?03）自动下线；429 限流保护视为有效不下架�?*定时自动巡检（默认每 6 小时，SWEEP_INTERVAL_HOURS 可调�?*使用同一判定
- **一键自动审�?*：一键测试全部待审核且含 Token 的条目，端点测试通过的直接自动通过（新条目已免审核，主要用于历史遗留）
- 用户管理（仅 admin）：改角色、删用户（级联删条目�?
- 邀请码（仅 admin）：生成、列表、复制、使用状�?
- **反馈管理**（版�?，后台「反馈」tab）：查看用户反馈/Bug（含图片/相关页面）、按 全部/待处�?已处�?筛选、标记完�?重新打开�?*通过高质量反馈给作�?+1 积分（幂等）**、删除（删除时清理本站上传图片）
- **站内监控**（版�?，后台「访客」「服务器」两�?tab，组件化 `lib/analytics.js` 零依赖）�?*访客统计**——`track.js` beacon（sendBeacon POST `/api/track`，与 Nginx proxy_cache 兼容：POST 不被缓存命中，页面缓存时仍精确记录）采集 IP/UA/页面/时区/语言/来源 host（document.referrer，只存域名；SEO 看搜索引擎、GEO �?chatgpt.com �?AI 引用），时区→国�?地区（免费零依赖，公益站访客几乎全中国，Asia/Shanghai 即区分大�?港澳�?海外）；**会话级去�?*——前�?`sessionStorage` 记录本标签页会话已上�?path，同会话同路径只上报一次（umami/plausible 主流口径，抑制猛刷同页虚增，服务端保�?PV 精确 + `trackLimiter 120/�?IP` 防刷）；概览数字卡片（今�?PV/UV�?4h PV、近 7 �?PV�? 国家分布 + 7 日趋�?+ 最近访问明细（含来源列�? 来源 TOP + 热门页面，纯 CSS 柱条不引图表库；**最近访问时间按东八区显�?*（`dash.js` `bjTime`，`getUTC*`+8h，不依赖管理员浏览器时区）�?*服务器监�?*——每 60s 采样 CPU（os.cpus 差值）/内存/磁盘（df -kP�?Node RSS �?`server_stats`，后台数字卡�?+ CPU/内存曲线，「服务器」tab �?*手动刷新按钮**（无自动轮询，点刷新看最新）。隐私：IP 仅版�?可见，保�?30 天滚动清理（启动 + 每日巡检窗口兜底），不写日志文件

**CLI（AI Agent / 人工�?*：见 §8

---

## 6. API 端点一�?

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/api/health` | �?| 健康检�?|
| GET | `/api/stats` | �?| 站点统计（仅统计已审核） |
| GET | `/api/items` | 可�?| 列表 `?category=&search=&sort=&limit=&offset=`（仅 verified=1；`limit`/`offset` 分页 + `X-Total-Count` 总数头；未登�?token 为空+locked；每项带 `tipCount` 被认可数，登录视角另�?`tipped` 是否已打赏） |
| GET | `/api/items/:id` | 可�?| 详情（新条目直接公开；已下线/未上线的匿名 404，仅作�?版主/管理员可见；�?`authorName`/`tipped`（当前用户是否已打赏�?`tipCount`（被认可次数）） |
| POST | `/api/items/:id/tip` | Bearer | 打赏 1 积分给发布者（仅已上线且非本人条目；幂等：同用户同条目仅一次；双流�?`tip` -1 / `tip_received` +1�?|
| POST | `/api/items` | Bearer | 发布（去�?+ token 有效性测试，通过�?*自动上线**，无需审核�?|
| GET | `/api/my/items` | Bearer | 我的发布（含已下线的�?|
| GET | `/api/my/stats` | Bearer | 我的统计 |
| GET | `/api/points` | Bearer | 积分余额 + 每日额度 + 最近流水（`?month=YYYY-MM` 按天聚合每日净增减，`?all=1` 返回完整流水�?|
| GET | `/api/recent?limit=N` | Bearer | 拉取最�?API Key（每日免�?5 次，超出�?1 积分/次；版主/管理员豁免） |
| PUT | `/api/my/items/:id` | Bearer | 编辑自己的条�?|
| DELETE | `/api/my/items/:id` | Bearer | 删除自己的条�?|
| GET | `/api/leaderboard` | �?| 贡献榜（**历史真实发布全部计入**：发布时已实测有效即算贡献，Token 失效/下架/进垃圾桶都不抹除——垃圾桶只控制展示不控制贡献�?|
| GET | `/api/categories` | �?| 分类（仅已审核） |
| GET | `/api/recent-activity` | �?| 最新动态（发布事件 + 打赏事件 `type=tip`，带打赏�?`tipByUsername/tipByNickname`�?|
| GET | `/api/comments?limit=N` | �?| 评论墙留言列表（最�?N 条，自动公开；带 `authorId` 供昵称链�?`/user/:id`�?|
| GET | `/api/users/:id` | �?| 个人主页数据（资料含 `avatar` + 被认可数 + 贡献条目 + 已通过教程；页面渲染在 `/user/:id` SSR�?|
| POST | `/api/auth/avatar` | Bearer | 上传头像（原始二进制 PNG/JPG/WebP/GIF �?MB；存 `data/uploads/avatars/<userId>-<6hex>.<ext>` 按用户归档，换头像即替换删旧文件�?|
| DELETE | `/api/auth/avatar` | Bearer | 移除头像（清 DB + 删文件，回退字母头像�?|
| POST | `/api/comments` | Bearer | 发表留言 `{content}`�?-100 字，自动公开�?|
| DELETE | `/api/comments/:id` | Bearer | 删除留言/评论（作者本人或 moderator+，兼容两种） |
| GET | `/api/items/:id/comments` | �?| Token 条目评论（仅已上线条目；生命周期跟条目：下架 404 不可见，重新上线恢复�?|
| POST | `/api/items/:id/comments` | Bearer | 发表条目评论 `{content}`�?-200 字，详情弹窗互动区） |
| POST | `/api/admin/weekly-report` | Bearer + admin | 手动触发社区周报（幂等；每周一 08:00 东八区自动生成） |
| GET | `/api/announcements?limit=N` | �?| 公告列表（最�?N 条，仅显示中，自动公开�?|
| GET | `/api/admin/announcements` | Bearer + admin | 全部公告（含已下线） |
| POST | `/api/admin/announcements` | Bearer + admin | 发布公告 `{content}`�?-500 字） |
| PUT | `/api/admin/announcements/:id` | Bearer + admin | 编辑/上线下线 `{content?, active?}` |
| DELETE | `/api/admin/announcements/:id` | Bearer + admin | 删除公告 |
| POST | `/api/feedback` | Bearer | 提交反馈/Bug `{kind:feedback\|bug, content, url?, image?}`（content 1-1000 字；image 仅允许本�?`/uploads/<16hex>.<ext>`，外链自动剥离；登录+写限流防 spam�?|
| GET | `/api/admin/feedback` | moderator+ | 反馈列表 `?status=open\|done`（后台「反馈」tab�?|
| PUT | `/api/admin/feedback/:id` | moderator+ | 标记完成/重开 `{status:done\|open}` |
| DELETE | `/api/admin/feedback/:id` | moderator+ | 删除反馈（并清理关联本站图片�?|
| POST | `/api/admin/feedback/:id/verify` | moderator+ | 通过反馈为高质量，作�?+1 积分（幂等，同一反馈仅一次） |
| GET | `/api/events` | �?| SSE 实时推送（�?Token 上线即时推送；首页无筛选时静默插入新卡片，有筛选时浮现提示条） |
| GET | `/api/auth/me` | Bearer | 当前用户（含 role/nickname�?|
| GET | `/api/auth/nickname-check?nickname=` | Bearer | 昵称实时可用性检测（他人占用=不可用；自己的昵�?空视为可用） |
| PUT | `/api/auth/profile` | Bearer | 修改昵称/邮箱/手机�?`{nickname?,email?,phone?}`（缺省不动、空串清除）�?*昵称全站唯一**（非空、不区分大小写，`GET /api/auth/nickname-check` 实时检测） |
| POST | `/api/auth/register` | �?| `{username,password,email?,phone?,inviteCode}` 邀请码必填，邮�?手机号选填 |
| POST | `/api/auth/login` | �?| `{username,password}` |
| POST | `/api/auth/recovery` | �?| 无验证码找回 `{username,email?,phone?,password}`（凭用户�?注册联系方式，重找回限流 5�?10�?IP + 失败计入登录锁定�?|
| POST | `/api/test-token` | Bearer | `{token,tokenType,baseUrl?,model?}`（需登录；baseUrl 测自定义厂商端点，SSRF 拦截�?*�?`model` 时对指定模型发真实对话探�?*——详情弹窗「可用模�?· 逐个实测」每模型独立测试即用它，区分「端点通但模型名不存在」）�?*响应回显上游 HTTP `status`**（成�?实际 2xx �?200�?01/403→`kind:'auth'`�?29→`kind:'ratelimit'`�?00/404+model→`kind:'model'`、连接失败→`status:0`）——前端模�?主测试据此显�?(200)/(400)/(404)/(429)/(连接失败) |
| POST | `/api/verify` | Bearer | 中转站掺水检测·端点识�?`{baseUrl,token,tokenType?}`：自动识别兼容模�?模型列表+端点级检查（可达/协议/模型列表/反投毒）；Token 用后即焚不落库；专用限流 10/�?IP |
| POST | `/api/verify/model` | Bearer | 中转站掺水检测·单模型电池 `{baseUrl,token,tokenType?,model}`：对话可�?返回结构/model回显/usage/知识基准/身份一致�?思维链痕�?�?评分 0-100 + 判定（≥80 基本可信 / 60-79 存在疑点 / <60 疑似掺水；回显或身份跨家族冲�?红线直接疑似掺水，宣称推理模型无思维�?存在疑点�?|
| GET | `/api/admin/users` | admin | 全部用户 |
| PUT | `/api/admin/users/:id/role` | admin | 改角�?|
| DELETE | `/api/admin/users/:id` | admin | 删除用户（级联删条目�?|
| POST | `/api/admin/users/:id/reset-password` | admin | 重置密码 `{password}`（校验同注册，清除登录锁定） |
| GET | `/api/admin/items` | moderator+ | 全部条目 `?status=pending|verified|trash`（trash=垃圾桶） |
| PUT | `/api/admin/items/:id/verify` | moderator+ | 验证 `{verified:true}` / 下线 `{verified:false}` |
| PUT | `/api/admin/items/:id/trash` | moderator+ | 移入垃圾桶（强制 verified=0�?|
| PUT | `/api/admin/items/:id/restore` | moderator+ | 从垃圾桶撤回（回待审核） |
| DELETE | `/api/admin/items/:id` | moderator+ | 彻底删除（硬删，不可恢复�?|
| POST | `/api/admin/items/trash-pending` | moderator+ | 一键清理：全部待审核移入垃圾桶 |
| POST | `/api/admin/items/check` | moderator+ | 检测失�?Token：明确失效（401/403/连接失败/404/503 等）自动下线�?29 视为有效不下�?|
| GET | `/api/admin/sweep` | admin | 最近一次巡检结果（定时自动巡检（默认每 6 小时�? 手动检测共用） |
| POST | `/api/admin/items/auto-verify` | moderator+ | 一键自动审核：对待审核�?Token 条目逐个真实问答，有可用模型才通过�?29 限流�?limited 暂缓，不�?rejected；与巡检互斥 409�?|
| GET | `/api/sponsors?slot=` | �?| 投放中的广告（安全字段；同槽位只取最�?1 条的列表�?|
| POST | `/api/sponsors` | Bearer | 广告商申�?`{name,url,slogan?,logo?}`（进待认证） |
| GET/PUT | `/api/my/sponsors…` | Bearer | 我的广告（含数据）；改料（在线改敏感项回待审+paid 清零�? 下线自己 |
| GET | `/go/:id` | �?| 跳转计数�?302（仅投放中） |
| POST | `/api/sponsors/:id/view` | �?| 曝光计数 |
| GET | `/api/admin/sponsors` | moderator+ | 全部广告 `?status=`（含数据；读时归档过期） |
| PUT | `/api/admin/sponsors/:id/approve\|reject\|activate\|offline\|renew` | moderator+ | 认证（可附质检分）/ 拒绝（理由必填）/ 确认收款并上线（同槽位单活，`{days,price?}`�? 下线 / 续费 |
| DELETE | `/api/admin/sponsors/:id` | moderator+ | 彻底删除（含统计�?|
| GET | `/api/admin/review-counts` | moderator+ | 待审核计�?`{pendingItems, pendingTutorials, openFeedback}`（后�?导航角标用） |
| GET | `/api/admin/invites` | admin | 邀请码列表 |
| POST | `/api/admin/invites` | admin | 生成邀请码 `{count}`�?-50�?|
| GET | `/api/tutorials` | �?| 教程列表 `?category=&limit=&offset=`（仅已审核，无正文） |
| GET | `/api/tutorials/categories` | �?| 教程分类统计 |
| GET | `/api/tutorials/:id` | �?| 教程详情（Markdown 正文；未审核仅作�?版主可见�?|
| POST | `/api/tutorials` | Bearer | 发布教程 `{title,content,summary?,category?,tags?,cover?}`（进待审核） |
| POST | `/api/upload` | Bearer | 图片上传（教程封面）：原始二进制 body，PNG/JPG/WebP/GIF �?MB、每�?�?0 张，返回 `{url:'/uploads/x.png'}`；存 `data/uploads/`（部�?tar 排除�?|
| GET | `/api/my/tutorials` | Bearer | 我的教程 |
| GET | `/api/my/tutorials/stats` | Bearer | 我的教程统计 |
| PUT/DELETE | `/api/my/tutorials/:id` | Bearer | 编辑/删除自己的教�?|
| GET | `/api/admin/tutorials` | moderator+ | 教程审核列表 `?status=` |
| PUT | `/api/admin/tutorials/:id/verify` | moderator+ | 通过/下线教程（通过时清空拒绝理由） |
| PUT | `/api/admin/tutorials/:id/reject` | moderator+ | 拒绝教程并附理由 `{reason}`�?-200 字），理由作者可�?|
| GET | `/api/skills` | 可�?| Skill 列表 `?category=&search=&sort=&free=&paid=&limit=&offset=`（仅 online，服务端分页 + `X-Total-Count`；登录视角带 `purchased`�?|
| GET | `/api/skills/categories` | �?| Skill 分类统计（仅 online�?|
| GET | `/api/skills/:id` | 可�?| Skill 详情（非 online 仅作�?版主可见；`content` 仅免�?已购/作�?版主返回�?|
| GET | `/api/skills/:id/content` | Bearer | Skill 内容受控读取（免费登录即得；付费需购买；返�?`{version, content, sha256}` + `X-Skill-Version`/`X-Skill-Sha256` 头，`no-store`，计�?downloads�?|
| POST | `/api/skills` | Bearer | 发布 Skill `{title, content, summary?, description?, category?, tags?, price?, packageId?}`（进待审核；content �?00000 字、price �?0000；`packageId` 模式�?zip 包、自动解�?SKILL.md frontmatter + 文件树；自动内容安全扫描 `scanSkillContent` �?scan_report�?|
| POST | `/api/skills/package` | Bearer | 上传 Skill zip 包（raw body �?0MB，解压校验：文件数≤200/单文件≤2MB/总≤20MB/路径穿越拦截/必须�?SKILL.md；支�?GitHub 式顶层目录；返回 `{packageId, files, skillMd, readme, scanReport}`�?|
| GET | `/api/skills/:id/download` | Bearer | 下载完整�?zip（权限同 content：免费登录即得、付费需购买；`Content-Disposition` 附件 + `X-Skill-Version`�?|
| POST | `/api/skills/:id/buy` | Bearer | 购买 Skill（`lib/points.js purchaseSkill` 事务：校�?扣买�?加作�?0% 抽成/�?purchase + 两条流水；免�?Skill 直接授权；幂等） |
| PUT | `/api/my/skills/:id` | Bearer | 编辑自己�?Skill（content 变更 �?新版本重新审核，status �?pending�?|
| DELETE | `/api/my/skills/:id` | Bearer | 下架自己�?Skill（status=offline�?|
| GET | `/api/my/skills` | Bearer | 我发布的 Skill |
| GET | `/api/my/purchases` | Bearer | 我的购买记录 |
| GET | `/api/skills/:id/reviews` | �?| Skill 评论列表（最�?50�?|
| POST | `/api/skills/:id/reviews` | Bearer | 发表/更新 Skill 评论 `{rating 1-5, content �?00字}`（不能评自己的；`UNIQUE(skill_id,user_id)` upsert�?|
| GET | `/api/admin/skills` | moderator+ | Skill 审核列表 `?status=pending|online|rejected|offline`（空=全部�?|
| PUT | `/api/admin/skills/:id/verify` | moderator+ | 通过 Skill（作�?+1 积分 `skill_verify` 幂等�?|
| PUT | `/api/admin/skills/:id/reject` | moderator+ | 拒绝 Skill `{reason}`�?-200 字，理由作者可见） |
| PUT | `/api/admin/skills/:id/offline` | moderator+ | 版主下架 Skill |
| POST | `/api/track` | �?| 访客统计 beacon：页面加载后浏览器上�?`{tz,lang,path,ref}`（ref=来源页完�?referrer，服务端只存 host，非 http(s) 丢弃），IP/UA 由服务端补全（`req.ip`），时区→国�?地区；专用限�?120/�?IP，非页面路径/爬虫 UA 拒绝记录 |
| GET | `/api/admin/visits` | moderator+ | 访客统计（`lib/analytics.js`）：概览 todayPv/todayUv/h24Pv/weekPv + byCountry/byPath/byDay 聚合 + 最近访问列�?`?limit=`（≤200�?|
| GET | `/api/admin/server-stats` | moderator+ | 服务器资源：最近一次采样（CPU%/内存/磁盘/Node RSS�? 最�?60 点序列（60s/�?�?1 小时窗口�?|

> 服务端渲染页面：`GET /`、`/tutorials`、`/tutorials/:id`、`/guide`、`/cli`、`/tools`、`/dashboard`（后者含内嵌 dashScript 管理后台 SPA）�?
> 限流：接口级 300/分（`API_RATE_LIMIT_MAX` 可覆盖）、写�?30/分（`WRITE_RATE_LIMIT_MAX` 可覆盖）——测试里调高避免误伤�?

### 6.1 SEO / GEO（搜索引�?+ LLM 爬虫可见性）
- `/sitemap.xml`：首�?教程/指南/CLI + 全部已审核教程详情（`<lastmod>`），绝对 URL�?
- `/robots.txt`：`Allow: /`，`Disallow: /dashboard /api/ /download/`，指�?sitemap�?
- `/llms.txt`：站点定�?+ 关键内容 + 核心链接，供 GPTBot/PerplexityBot/ClaudeBot 抓取�?
- `/cli-agent.txt`�?*AI Agent 接管纯文本指�?*（CLI 全命�?+ `--json` 约定 + 版本号），任�?Agent 抓取即可自助接管；与 `/cli` 页「AI 引导提示」复制按�?*同一来源**（server.js `buildAgentPrompt()`），改命令必须同步它�?
- 页面级：`canonical`、Open Graph / Twitter Card、JSON-LD（WebSite/Article/ItemList）、`og:image`（`/og-image.png`�?200×630，由 `scripts/gen-og-image.js` 生成）�?
- **动�?OG / 海报**：`/og/item/:id.png`、`/og/tutorial/:id.png`�?200×630 品牌卡，含内容标题，Noto Sans CJK）；首页 `?id=` 与教程详情页自动注入对应 `og:title/desc/image`；分享海�?`/poster/item/:id.png`、`/poster/tutorial/:id.png`、`/poster/site.png`�?00×800，低饱和流光 + 底部展示**当前访问域名** `free-tokens.org`/`freeapis.top` + 二维码）。前�?`posterUrlFor()` 自动按请�?URL 选端点，失败回退 `/api/qrcode`�?
- **SSR**：教程详情页与首页条目卡片服务端渲染，无 JS 爬虫也能读到内容；`/dashboard` �?`noindex`�?
- 维护点：部署后清 Nginx 代理缓存（见 §9 步骤 4.5）；改静态资源记得保留内容哈�?`?v=`�?

---

## 7. 数据库结构（SQLite，WAL�?

文件 `data/app.db`。`lib/db.js` 启动时建表（`CREATE TABLE IF NOT EXISTS` 幂等�? 迁移（`PRAGMA table_info` + `ALTER TABLE` 补列）�?*建表/补列在进程启动即执行**（`server.js` �?`app.listen` 前调�?`getDb()`）�?

```sql
users(id TEXT PK, username TEXT UNIQUE, password TEXT, nickname TEXT DEFAULT '',
      email TEXT DEFAULT '', phone TEXT DEFAULT '',
      role TEXT DEFAULT 'user' CHECK(role IN ('user','moderator','admin')),
      points INTEGER DEFAULT 0, pull_date TEXT DEFAULT '', pull_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP);

items(id TEXT PK, name TEXT, desc TEXT, url TEXT, provider TEXT, category TEXT,
      token TEXT, token_type TEXT, tags TEXT DEFAULT '[]',
      compat TEXT DEFAULT '[]', models TEXT DEFAULT '[]',
      created_by TEXT REFERENCES users(id), verified INTEGER DEFAULT 0, trashed INTEGER DEFAULT 0,
      created_at DATETIME, updated_at DATETIME);

invite_codes(code TEXT PK, created_by TEXT, used_by TEXT,
             created_at DATETIME DEFAULT CURRENT_TIMESTAMP, used_at DATETIME);

tutorials(id TEXT PK, title TEXT NOT NULL, summary TEXT DEFAULT '', content TEXT NOT NULL,
          category TEXT DEFAULT '教程', tags TEXT, cover TEXT DEFAULT '',
          created_by TEXT REFERENCES users(id), verified INTEGER DEFAULT 0,
          reject_reason TEXT DEFAULT '', created_at DATETIME, updated_at DATETIME);

-- ===== Skill 广场�? 张表�?026-08-18 加）=====
skills(id TEXT PK, slug TEXT UNIQUE NOT NULL, author_id TEXT REFERENCES users(id),
       title TEXT NOT NULL, summary TEXT DEFAULT '', description TEXT DEFAULT '',
       category TEXT DEFAULT '通用', tags TEXT DEFAULT '[]', cover TEXT DEFAULT '',
       price INTEGER DEFAULT 0,
       status TEXT DEFAULT 'pending' CHECK(status IN ('draft','pending','rejected','online','offline')),
       current_version TEXT DEFAULT '', downloads INTEGER DEFAULT 0, copies INTEGER DEFAULT 0,
       created_at/updated_at TEXT);
-- 正文不落 skills 表：内容存文�?data/skill-files/<versionId>/SKILL.md（部�?tar 排除，同 uploads�?
-- status: pending=待审�?/ online=已上�?/ rejected=已拒�?/ offline=已下架（作者下架或版主下架�?
-- price: 0=免费（登录即可读内容），>0=积分交易（购买后授权�?% 抽成作者全额获得）

skill_versions(id TEXT PK, skill_id TEXT REFERENCES skills(id), version TEXT NOT NULL,
               content_path TEXT NOT NULL, resources_json TEXT DEFAULT '[]',
               sha256 TEXT DEFAULT '', scan_report TEXT DEFAULT '',
               status TEXT DEFAULT 'pending' CHECK(status IN ('pending','rejected','online')),
               reject_reason TEXT DEFAULT '', reviewed_by TEXT, reviewed_at TEXT, created_at TEXT);
-- 版本化：编辑 content �?新版本记�?+ status �?pending 重新审核；sha256 供完整性校验；
-- scan_report = scanSkillContent 内容安全扫描结果（危险命�?隐藏 Unicode/内网链接，仅 warn 不拦截）

skill_purchases(id TEXT PK, skill_id TEXT REFERENCES skills(id), buyer_id TEXT REFERENCES users(id),
                version_at_buy TEXT, price INTEGER NOT NULL, created_at TEXT);
-- 购买记录（永久授权）；购买事务见 lib/points.js purchaseSkill（扣买家/加作�?双流水，任一失败回滚�?

skill_audit_log(id TEXT PK, skill_id TEXT, action TEXT CHECK(action IN ('submit','verify','reject','offline','online','delete')),
                version TEXT, detail TEXT, operator_id TEXT, created_at TEXT);
-- 操作审计：提�?审核/拒绝/上下架全记录

skill_reviews(id TEXT PK, skill_id TEXT, user_id TEXT, rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
              content TEXT DEFAULT '', created_at TEXT, UNIQUE(skill_id, user_id));
-- 评论 + 评分 1-5，upsert（一人一评可改）；不能评自己�?Skill

skill_reports(id TEXT PK, skill_id TEXT, reporter_id TEXT,
              type TEXT CHECK(type IN ('malicious','copyright','false','invalid','privacy')),
              content TEXT NOT NULL, status TEXT DEFAULT 'open' CHECK(status IN ('open','done')),
              handled_by TEXT, handle_note TEXT, created_at TEXT);
-- 举报（恶�?版权/虚假/无效/隐私），版主处理（表已建，处理端点未实现�?

comments(id TEXT PK, user_id TEXT REFERENCES users(id), content TEXT NOT NULL,
         ref_id TEXT DEFAULT '',  -- ''=首页留言墙；条目id=Token 详情评论（idx_comments_ref 索引�?
         created_at DATETIME DEFAULT CURRENT_TIMESTAMP);

announcements(id TEXT PK, content TEXT NOT NULL, created_by TEXT REFERENCES users(id),
              active INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);

feedback(id TEXT PK, user_id TEXT REFERENCES users(id), kind TEXT NOT NULL DEFAULT 'feedback'
         CHECK(kind IN ('feedback','bug')), content TEXT NOT NULL, image TEXT DEFAULT '',
         url TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done')),
         created_at DATETIME DEFAULT CURRENT_TIMESTAMP);

points_log(id TEXT PK, user_id TEXT REFERENCES users(id), delta INTEGER,
           reason TEXT, ref_id TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
-- reason 取值：item_verify/tutorial_verify/feedback_verify（发放，幂等�?pull（拉取消耗）/
--             tip（打赏支�?-1�?tip_received（被打赏 +1）——ref_id=对应条目/反馈 id

visits(id INTEGER PK AUTOINCREMENT, ip TEXT, ua TEXT, path TEXT, tz TEXT, country TEXT, lang TEXT, created_at TEXT);
-- 站内访客统计（lib/analytics.js beacon 采集；IP 属个人数据，仅版�?后台可见，保�?30 天）

server_stats(id INTEGER PK AUTOINCREMENT, cpu REAL, mem_used/mem_total/disk_used/disk_total/rss INTEGER, created_at TEXT);
-- 服务器资源采样（lib/analytics.js �?60s 写一次；内存/磁盘为字节，cpu �?%�?
```

**社区相关索引**（`lib/db.js` 启动迁移自动建）：`idx_points_log_tip_unique`（`(user_id, ref_id) WHERE reason='tip'`，打赏幂�?DB 兜底）、`idx_points_log_reason_ref`（`(reason, ref_id)`，打赏计�?动态流防全表扫）、`idx_comments_ref`（`(ref_id, created_at)`，条目评论按条目取列表）、`users.avatar` 列（头像 URL，空=未设置回退首字母）。Skill 广场：`skills.slug` UNIQUE（表级）、`idx_skills_category/status_created/author`、`idx_skill_versions_skill(skill_id, version)`、`idx_skill_purchases_buyer(buyer_id)` + `idx_skill_purchases_unique(skill_id, buyer_id)`（购买幂�?DB 兜底�?026-08-19 补建）、`skill_reviews UNIQUE(skill_id, user_id)`（表级，一人一评）、`idx_skill_reports_status(status)`�?

**审核语义**：`items.verified` 1=公开�?*发布即置 1 自动上线**），0=下线/未上线（不公开）�?下线" = 管理员把 verified �?1 改回 0；下线的可重新通过（改�?1）。`items.trashed` 1=垃圾桶（软删除，强制 verified=0，从所有公开视图与待审核列表隐藏，可撤回或彻底删除）。`tutorials.verified` 语义相同，但教程**保留版主审核**（发布默�?0，审核通过�?1）�?
**关键约束**：`items.token` �?*全局唯一索引**（`idx_items_token_unique`，`WHERE token != ''`�?026-08-15 加）——DB 级并发去重兜底，POST 捕获 `SQLITE_CONSTRAINT` 返回 400 友好提示（应用层先查后插仍保留，双保险）；WAL `journal_size_limit=4MB` + 每次巡检�?`wal_checkpoint(TRUNCATE)`；备份用 SQLite 热备�?`.backup`�?
**兼容字段**：`items.compat` JSON 数组 `["openai"]` / `["anthropic"]` / `["openai","anthropic"]`，发布时�?Token 端点自动探测写入；老数据无 compat 时按 `token_type` 兜底推断�?
**响应门控**：`GET /api/items` 未登录时�?Token 条目�?`url`/`token` 为空、`urlLocked`/`tokenLocked` �?true；CLI `recent` 已改�?`GET /api/recent`（需登录 + 每日额度/积分计费）�?

---

## 8. CLI 完整说明 + 打包部署

### 8.1 命令速查（全部支�?`--json` 输出�?

```bash
# 基础
node cli.js ping                    # 连通�?
node cli.js stats                   # 站点统计

# 认证
node cli.js register -u <�? -p <�? -c <邀请码> [-e <邮箱>] [--phone <手机�?]   # 注册（邀请码必填，邮�?手机号选填便于找回�?
node cli.js login -u <�? -p <�?                  # 登录
node cli.js login -t <已有token>                   # 直接 token 接入（AI Agent�?
node cli.js whoami                  # 当前用户/角色/昵称
node cli.js recover -u <�? -e <邮箱> -p <新密>     # 忘记密码：凭用户�?注册邮箱/手机号重设（无验证码�?
node cli.js profile [-n <昵称>] [-e <邮箱>] [--phone <手机�?]   # 查看/修改昵称、邮箱、手机号（用于找回）

# 发布与管�?
node cli.js add -n <名称> -u <链接> -t <Token> [选项]   # 发布（必�?--token �?--url API base_url，测试通过即自动上线；纯链接条目不予发布）
node cli.js my / my --stats                        # 我的发布/统计
node cli.js recent [-n 数量]                       # 拉取最�?API Key（每日免�?5 次，超出每次�?1 积分；版�?管理员豁免）
node cli.js points                                  # 积分余额 / 今日免费额度 / 积分明细（发布含 Token 即上�?+1，教程审核通过 +1�?
node cli.js edit <id> [--name --url --desc --provider --category --token --token-type --tags]
node cli.js delete <id>            # 删除自己发布�?

# 浏览/搜索
node cli.js list [-c 分类] [-s 关键词]
node cli.js search <关键�?
node cli.js import <文件.json>     # 批量导入

# Token 测试
node cli.js test-token <token> -t <类型> [-u <base_url>] [-m <模型>]
node cli.js verify-relay -u <base_url> -t <token> [-T <类型>] [-m <模型>]   # 中转站掺水检测（对应 /verify �?+ /api/verify）：输入任意 Base URL+Key 自动识别兼容模式+模型列表；带 -m 对单个模型做掺水检测（评分+逐项：对�?回显/usage/知识/身份/思维链）

# 审核（版�?�?
node cli.js audit [--status pending|verified|all]
node cli.js verify <id> / unverify <id>

# 用户管理（admin�?
node cli.js admin users
node cli.js admin role <id> -r <moderator|admin|user>
node cli.js admin delete <id>
node cli.js admin reset-password <id> <新密�?   # 重置密码（≥8位含字母数字，清除登录锁定）

# 邀请码（admin�?
node cli.js admin invite [数量]    # 生成（默�?，最�?0�?
node cli.js admin invites          # 列表+使用状�?

# 失效检测（版主+�?
node cli.js admin check            # 明确失效�?01/403/连接失败/404/503）自动下线；429 限流视为有效不下架；定时自动巡检（默认每 6 小时）同判定

# 公告（admin，首页公告栏滚动显示，自动公开�?
node cli.js admin announcements                 # 查看全部公告及显示状�?
node cli.js admin announcement add "公告内容"    # 发布公告
node cli.js admin announcement toggle <id>       # 上线/下线
node cli.js admin announcement delete <id>       # 删除（不可恢复）

# 教程（版�?审核�?
node cli.js admin tutorials [--status pending|verified|all]
node cli.js admin tutorial-verify <id> / admin tutorial-unverify <id>

# Skill 广场（发�?浏览/购买，版�?审核�?
node cli.js skill add --title <t> [--zip <压缩�?] [--summary][--category][--tags][--price 0][--cover 封面图URL] --content <md> | --file <x.md>
node cli.js skill list [-c <分类>] [-s <关键�?] [--free|--paid]
node cli.js skill search <关键�?
node cli.js skill view <id> / skill my / skill edit <id> [--title --content --file --cover ...] / skill delete <id>
node cli.js skill buy <id> / skill purchases
node cli.js skill-admin list [--status pending|online|rejected|offline|all]   # 版主+
node cli.js skill-admin verify <id> / skill-admin reject <id> -r "理由"       # 版主+
```

`add` 完整参数：`--name/-n`（必填）、`--url/-u`（必填，API base_url）、`--desc/-d`、`--provider/-p`、`--category/-c`、`--token/-t`（必填，纯链接不予发布）、`--token-type`、`--tags`�?

教程命令：`upload <图片路径>`（传本地�?�?`/uploads/xxx.png`，供封面/插图）、`tutorial add --title <t> [--summary][--category][--tags][--cover /uploads/xxx.png �?https://外链] --content <md> | --file <x.md>`、`tutorial list [-c <分类>] [-s <关键�?] [-n <数量>]`、`tutorial search <关键�?`、`tutorial my`、`tutorial view <id>`、`tutorial edit <id> [--title ... --cover ...]`、`tutorial delete <id>`（发布进待审核；`tutorial search`/`list -s` 按标�?摘要搜索已公开教程；正文支�?`![说明](/uploads/xxx.png)` �?`![说明](https://外链)` 插图）�?

Skill 命令：`skill add --title <t> [--zip <压缩�?] [--summary][--category 通用|提示词|工具集|开发|测试|其他][--tags][--price 积分][--cover 封面图URL] --content <md> | --file <x.md>`（发布进待审核；`--zip` 上传 GitHub 风格 zip 包推荐，根目录需�?SKILL.md；`--cover` �?`/uploads/xxx.png` �?`https://...` 外链；price 0=免费�?0 用积分交易�?% 抽成作者全额获得）、`skill list [-c 分类] [-s 关键词] [--free|--paid]`、`skill search <关键�?`、`skill view <id>`（免�?已购/作者可见全文）、`skill my`、`skill edit <id> [--title --content --file --cover ...]`、`skill delete <id>`（下架）、`skill buy <id>`（扣积分、永久授权）、`skill purchases`；审�?`skill-admin list [--status pending|online|rejected|offline|all]`、`skill-admin verify <id>`、`skill-admin reject <id> -r "理由"`（版�?）�?

`--json` 格式：成�?`{"ok":true,"data":...}`，失�?`{"ok":false,"error":"..."}`�?

### 8.2 连接目标
- 默认�?`http://localhost:3000`�?
- 指向远程：`export TOKEN_API=https://freeapis.top`�?
- 认证 token �?`~/.token-charity-auth`�?

### 8.3 公共 CLI 包（自托�?npm tarball，用户机安装�?
```bash
npm install -g https://freeapis.top/download/freeapis-cli-0.23.0.tgz
freeapis-cli ping
npx https://freeapis.top/download/freeapis-cli-0.23.0.tgz ping   # 免安�?
```

### 8.4 发版流程（改 CLI 后必做）
1. �?`cli.js` �?`program.version('x.y.z')` —�?**版本单一来源**�?
2. `node scripts/build-cli-package.js` �?重新生成 `public/download/freeapis-cli-<ver>.tgz`�?*自动清理旧版�?*，内�?commander 全自包含）�?
3. 随正常部署上传（tarball �?`public/download/`，在 tar 打包范围内）�?
4. ⚠️ tarball �?`public/download/`�?*不要**�?`public/cli/`（会遮蔽 `/cli` 教程路由）�?

#### 8.4.1 CLI 文档同步清单（新�?改动命令后必改，避免文档�?CLI 脱节�?
| 文件 | 需同步内容 |
|------|-----------|
| `server.js` `/cli` 教程�?| 命令示例（含 `add` 全参数）、版本号�?.15.0 �?新版本）�?*`buildAgentPrompt()` AI 引导提示**（新�?改命令要同步进去——它�?`/cli` 页「复制给任意 AI Agent」按钮与 `/cli-agent.txt` 抓取端点�?*单一来源**�?|
| `CLAUDE.md` | CLI 命令速查、`--json` 说明、API 表（若加接口�?|
| `AGENT.md` | CLI 命令列表（�?.1）、产品决策表、API 表、本清单版本�?|
| `DEPLOYMENT-SOP.md` | 公共安装指令版本号、�?.1 发版说明 |
| `ADMIN-ACCOUNT.md` | 安装指令版本�?|
| `tests/cli-e2e.js` / `tests/api.test.js` | 新命令加 e2e/API 用例 |

---

## 9. 部署（新版本上线�?

> 服务器无法访问本�?Gitea，代码本地上传。完整细节见 `DEPLOYMENT-SOP.md` §10�?

```bash
# 1. 本地打包（排�?node_modules/.git/*.db/*.png/.env/tests�?
cd <本地项目根目�?
tar --exclude='node_modules' --exclude='.git' --exclude='*.db' \
    --exclude='*.db-wal' --exclude='*.db-shm' --exclude='tests/*.png' \
    --exclude='.env' --exclude='tests' -czf /tmp/token-app.tar.gz .

# 2. 上传解压
scp -i ~/.ssh/your_key /tmp/token-app.tar.gz root@your.server.ip:/tmp/
ssh -i ~/.ssh/your_key root@your.server.ip \
  'cd /www/wwwroot/freeapis.top && tar -xzf /tmp/token-app.tar.gz && chown -R root:root .'

# 3. 依赖变了才跑：npm install --omit=dev

# 4. 重启 + 验证
ssh -i ~/.ssh/your_key root@your.server.ip \
  'pm2 restart token-charity && sleep 2 && curl -s http://127.0.0.1:3001/api/health'

# 4.5 �?Nginx 代理缓存（改静态资源后必做；缓存区 freeapis，见 §13.1�?
ssh -i ~/.ssh/your_key root@your.server.ip \
  'rm -rf /www/server/nginx/cache/freeapis/* && nginx -t && /etc/init.d/nginx reload'
```

> ⚠️ `.env`、`*.db` 不上传（保留生产配置和数据）�?
> ⚠️ `data/uploads/`（教程封面图）在部署 tar 中排除，**不随发布覆盖**，生产服务器上持续累积�?
> ⚠️ **发布即上�?*：新条目发布即自动公开，无需审核。从"审核�?改为"发布即上�?的部署需一次性回填存量待审核条目：`sqlite3 .../data/app.db "UPDATE items SET verified = 1 WHERE verified = 0;"`�?*不要写进代码**，否则每次重启强制公开所有条目）�?

### 部署后必跑验证清�?
```bash
curl -s http://127.0.0.1:3001/api/health     # {"status":"ok"}
curl -sI https://freeapis.top/ | head -1      # 200
curl -s https://freeapis.top/api/stats        # JSON
curl -sI https://geowiki.pro/ | head -1       # 回归 200
curl -sI https://g.freeapis.top/ic6qPkSPRba2jA5msX/ | head -1  # 回归 200 (3x-ui)
pm2 list                                      # token-charity online
```

---

## 10. 回滚

- 应用代码：重新上传上一版代�?�?`pm2 restart token-charity`�?
- 数据库：�?`.backup` 备份恢复（sqlite3 读回）�?
- Nginx：改前备份，`nginx -t` 报错拦截，`reload` 失败不中断旧进程�?
- 原则：先备份、小步验证、异常即回滚�?

---

## 11. 管理员账号（敏感�?

| 项目 | �?|
|------|----|
| 用户�?| `tc_admin_1a43d3` |
| 密码 | `CHANGE_ME_32+_RANDOM`（⚠�?建议登录后改密） |
| 用户ID | `3Jj6Ze3hFP` |
| 角色 | admin |

- 登录入口：https://free-tokens.org �?https://freeapis.top ；管理后�?`/dashboard#admin`�?
- 服务器安全副本：`/root/.token-charity-admin`（权�?600）�?
- 提升任意用户�?admin：注册后 `sqlite3 .../data/app.db "UPDATE users SET role='admin' WHERE username='<�?';"`�?
- ⚠️ 注册现在需要邀请码，用管理后台"邀请码"tab �?`cli admin invite` 生成�?

---

## 12. 测试

```bash
# 主测试套件（npm test = 文档守护 11 + API 312 + CLI 11 + CLI e2e 37 = 371 项）
# 文档守护（doc-consistency）在最前：CLI 版本号六处同�?/ Nginx 缓存路径 / 唯一索引 / 测试数量算术等关键事实，
# 防文档与代码脱节（外�?AI 接管依赖文档准确），文档漂移直接 fail
npm test

# 全栈浏览器测试（需先本地起服，playwright-full 主套件）
DB_PATH=data/pwfull.db PORT=3000 node server.js &
DB_PATH=data/pwfull.db node tests/playwright-full.js

# 功能冒烟（各脚本自起服，独立端口 + 临时 DB）：
node tests/playwright-admin.js      # 后台三功能（用户注册日历/邀请码 Tab/教程拒绝理由�?
node tests/playwright-banner.js     # 首页 Banner 双列紧凑 + 全宽搜索�?
node tests/playwright-slogan.js     # 首页口号 + 免责声明弹窗
node tests/playwright-sse.js        # SSE 实时推送（提示�?�?点击加载新卡片）
node tests/playwright-uploader.js   # 可复用上传组件（三处上传�?× 点�?拖拽/粘贴 + 外链互斥�?
node tests/playwright-tools.js      # AI 工具导航�?tools 分类/搜索/外链/免费用角�?移动�?sitemap/llms�?
node tests/playwright-ccswitch.js   # CC Switch + 复制完整配置（门�?深链/双格式块/兜底面板/说明面板�?
node tests/playwright-verify.js     # 掺水检测冒烟：/verify 独立页表�?登录门控/端点识别模型列表/单模型评�?checks/移动�?CSP + 详情弹窗模型列表行「掺水检测」按钮（复用现有模型行，data-model-verify �?verifyModelRow �?/api/verify/model，行内显示评�?判定�? 主测�?HTTP 状态码 (200)（含本地 mock 端点�?
node tests/playwright-feedback-drop.js  # 反馈图片拖拽上传
node tests/smoke-announcements.js   # 公告（API + CLI + 首页公告栏）
node tests/smoke-share.js           # 一键分�?+ OG/海报
node tests/smoke-tutorial.js        # 教程（发�?封面/详情�?

# 文档一致性守护已并入 npm test（tests/doc-consistency.js�?1 项，可单独跑：node --test tests/doc-consistency.js�?

# 其他 ad-hoc 脚本（浏览器验证单功能）：tests/mask-test.js、gate-test.js、wx-qr-check.js、check-all.js、audit-full.js �?
```

**测试要点（接手别踩坑�?*
- 测试�?`data/test.db`，启动时�?`require('../lib/db')` 直插邀请码（注册必需）�?
- `api.test.js` 内置 mock HTTP 服务器（`/models` 返回 200），�?token 的条目用 `mockBase()` �?url 才能通过发布校验�?
- 测试调高了限流上限：`API_RATE_LIMIT_MAX`/`WRITE_RATE_LIMIT_MAX` 环境变量（server.js 读取）�?
- playwright 脚本注册时用 better-sqlite3 直插邀请码（`DB_PATH` 需与服务端一致）；`page.evaluate` 只收单参数（多参数要包成对象）�?
- 用户�?�?0 字符（测试里别拼太长时间戳）�?

---

## 13. 踩坑记录（完整）

### 13.1 Nginx 代理缓存导致"部署后看不到新内�? ⚠️（最常见�?
- 现象：新代码已传、pm2 已重启，但公网仍见旧页面/旧图标�?
- 根因：Nginx `proxy_cache freeapis` 微缓存（30s，缓存目�?`/www/server/nginx/cache/freeapis`）按 URL 缓存；带 `Authorization` 头或 `/api/events` SSE 自动绕过（BYPASS）�?
- 规避：部署后 `rm -rf /www/server/nginx/cache/freeapis/* && nginx -t && /etc/init.d/nginx reload`�?
- 排查：对�?`curl -s URL` �?`curl -s "URL?v=x"`，带参数新、不带旧 �?缓存命中（响应头 `X-Cache-Status` 可见 MISS/HIT/BYPASS）�?
- 根治：图�?sprite 已内联进 HTML（无外部请求），styles/app 引用带内容哈希；仍建议每次部署清缓存�?

### 13.2 Windows curl �?`-w` 误报 HTTP 000 ⚠️
- mingw curl �?`-w` 会返�?000；`-o /tmp` 不识�?Unix 路径�?
- �?`curl -sI <url> | head -1` �?`curl -s <url>` 看响应体，别依赖 `-w`�?

### 13.3 Windows CRLF 导致 JSON 注册失败 ⚠️
- Git Bash `echo > file` �?`\r`，上�?Linux 后密码含 `\r` �?"请求�?JSON 格式无效"�?
- 上传�?`tr -d '\r' < f > f2 && mv f2 f`�?

### 13.4 注册/测试脚本全被 429（限流）误伤
- 写级限流 30/分，测试大量写请求瞬间打满�?
- 修复：`server.js` 限流上限支持环境变量覆盖（`API_RATE_LIMIT_MAX`/`WRITE_RATE_LIMIT_MAX`），测试�?100000�?

### 13.5 playwright `page.evaluate` 多参数报�?"Too many arguments"
- Playwright evaluate 只接受单参数，传多个要包对象：`page.evaluate(async ({a,b})=>{}, {a, b})`�?

### 13.6 邀请码强制注册（破坏性变更）
- �?无邀请码"升级后，所有注册（网页/CLI/脚本）都必须带邀请码，否�?400�?
- 测试/脚本需预置 `invite_codes` 记录�?

### 13.7 审核制改"发布即上�?需一次性回�?verified
- �?审核�?改为"发布即上�?后，存量待审核条目（verified=0）不会自动公开；部署时执行一�?`UPDATE items SET verified = 1 WHERE verified = 0`（用户已确认）。不要写进代码�?

### 13.8 Token 生命周期：key 会突然失�?
- 公益 key 会被消�?回收（实�?astrdark 从可用变�?403）。`cli admin check` 定期清理�?key�?
- 2026-08 策略调整�?*明确失效**才算失效—�?01/403/连接失败�?04�?03 维护中自动下线（回不公开可重新通过）；**429 限流/用量保护视为有效不下�?*。新�?*定时自动巡检**全部在线 Token�?026-08-19 起默认每 6 小时，SWEEP_INTERVAL_HOURS 可调）�?

### 13.9 发布�?Token 必须�?API base_url
- `url` 字段对带 Token 条目�?API 端点（如 `https://x-api.cfd/v1`），不是官网首页；否则发布时有效性测试会失败被拒�?
- Anthropic 兼容端点测试用默认模型名，若某端点要求特定模型（�?MiniMax-M3）可能需要加 `model` 字段支持（暂未实现）�?

### 13.10 better-sqlite3 / 内存等杂�?
- Amazon Linux x64 + Node22 直接下载预编译二进制，无需编译工具�?
- `lib/db.js` 自动�?`data/` 目录�?
- 服务器内存仅 1.9GB，pm2 可用 `--max-memory-restart 200M` 兜底�?

### 13.11 内联脚本模板字符串插�?Bug�?cli 页「复�?AI 引导提示」按钮失效）⚠️
- **现象**：按钮点击无反应（电脑端、移动端都不复制）�?
- **根因**：`server.js` `/cli` 路由的内联脚本里 `var CLI_AGENT_PROMPT = <JSON.stringify(AGENT_PROMPT_TEXT)>;` 少了 `${...}`，模板字符串�?`<JSON.stringify(...)>` 当字面量输出 �?浏览器得�?`var CLI_AGENT_PROMPT = <JSON.stringify(...)>;` **SyntaxError** �?整个内联 `<script>` 死亡（`copyAllGuide` 从未定义、`addEventListener` 未绑定）�?
- **规避**：模板字符串里做插值必须写 `${JSON.stringify(...)}`；改完用 headless 浏览器实测点击（Playwright 开 `clipboard-read/write` 权限 �?`page.click('#copyAllBtn')` �?`navigator.clipboard.readText()` 校验内容），或至�?`curl` 页面�?`new Function(内联脚本)` 确认能解析�?

### 13.12 宣传海报：两种比例必须分开调版 + 程序化溢出检�?⚠️
- **现象**�?:1 方形海报排版错乱（文字挤/溢出）——早�?canvas 版用一套自适应缩放代码同时�?3:4 �?1:1，竖版调好的 1:1 没单独调过�?
- **规避**：海�?HTML+CSS（flex）渲染，`.sq`�?080×1080）与 `.tall`�?242×1656）分块、`--sc` CSS 变量按比例独立调号；每张构图独立（不共用模板，避�?改分辨率"感）�?*AI 无法直接看图** �?�?Playwright `el.evaluate` 比对 `scrollHeight`/`clientHeight` 做程序化溢出检测（>1px 即告警），最后请用户亲眼确认。二维码只放最后一张转化海报（07），避免平台判营销/限流�?

### 13.13 公众号文章样式必须行内（宣传物料）⚠�?
### 13.14 �?Node http.request �?chunked 请求体被 body-parser 拒绝 ⚠️�?026-08-16�?
- **现象**：Node `http.request` �?DELETE �?body 且不�?Content-Length（chunked 传输）时，经 `express.raw` 的路由直�?400 断连；浏览器 fetch/curl 正常�?
- **规避**：测试脚�?DELETE 不带 body。详�?SOP §11.16�?
### 13.15 Windows 跨进程文件交换不要用 /tmp ⚠️�?026-08-16�?
- **现象**：Git Bash �?`/tmp` �?Python/Node 解析�?`/tmp`（`C:	mp`）不是同一目录，跨进程传文件静默丢失�?
- **规避**：用项目内相对路径。详�?SOP §11.15�?
### 13.16 DB 时间戳格式必须统一 toISOString，勿依赖 SQLite DEFAULT ⚠️�?026-08-17�?
- **现象**：`INSERT` 不传 `created_at` �?SQLite DEFAULT 产出 `2026-08-16 16:07:21`（空格分隔），而既有代码用 `toISOString()`（`T` 分隔）——两种格式混存时 `ORDER BY created_at` 按字符串比较（空�?< `T`），空格格式的行**永远沉底**（首期社区周报排序错乱实测）�?
- **规避**：所有写�?DB 的时间戳一律显�?`new Date().toISOString()`，新�?INSERT 带时间列必须显式传值；修存量：`UPDATE ... SET created_at = REPLACE(created_at,' ','T') || '.000Z' WHERE created_at LIKE '____-__-__ __:__:__'`�?
- 微信公众号编辑器会剥离外�?CSS/`<style>`/`<script>`，只保留**行内 style**；图片不能外链（须在编辑器手动上传）；正文超链接被剥离（用编辑器「原文链接」字段填 `https://freeapis.top`）�?
- `宣传物料/公众号推广文�?html` 所有样式一律内联；发布步骤 / 改配�?/ 换数据见 `宣传物料/README.md`�?

### 13.17 每日巡检/定时任务必须按东八区判断，勿用服务器本地时区 ⚠️�?026-08-17�?
- **现象**：`startNightlySweep` 原用 `now.getHours() === 0` �?*服务器本地时�?*判断每日 24:00。而生产服务器系统时区�?**UTC**（`timedatectl` 显示 n/a UTC），导致实际�?**UTC 0 �?= 北京时间�?8 �?*跑巡检（晚�?8 小时�?026-08-15~17 日志证据：全�?`00:00 UTC`）�?
- **规避**：任何「每�?24:00 / 零点」类定时逻辑一律东八区偏移判断：`const bj = new Date(Date.now() + 8*3600e3); if (bj.getUTCHours() === 0 && bj.getUTCMinutes() < 10 ...)`（与社区周报 `cnDate()` 同口径）。排查生产定时任务时间点�?`timedatectl` 确认服务器时区�?

### 13.18 测试�?`const baseUrl = mockBase()` 勿在 describe 定义阶段求�?⚠️�?026-08-17�?
- **现象**：`mockPort` 是全局 before 异步 `server.listen(0, cb)` 回调里赋值的；若测试 describe �?**定义阶段**（describe 回调体，先于任何 hook 执行）就 `const baseUrl = mockBase()`，此�?`mockPort` 还是 0 �?发布/请求全打�?`127.0.0.1:0` �?「连接失败�?00�?
- **规避**：基�?mock 端口�?URL 一律在 `before` hook �?`it()` 回调�?*惰性求�?*（`baseUrl = mockBase()`），不要作为 describe 级常量。既有用例多是在 `it()` 内才�?`mockBase()`，没问题�?

### 13.19 grep 空字符串恒匹配造成安全测试假阳�?⚠️�?026-08-17�?
- **现象**：排查「伪装爬虫泄�?Token」时，用 `if echo "$resp" | grep -qF "$TOKPRE"` 判定泄露——一�?`$TOKPRE` 因上游取数失败为空串，`grep -qF ""` **恒匹配成�?*，所有端点误报「❌ 泄露」（连需登录 401/404 的端点都报），制造安全恐慌�?
- **规避**：子串比对前先判空——`if [ -n "$TOKPRE" ] && echo "$resp" | grep -qF "$TOKPRE"`；并确保�?token 的命令在应用目录（`cd /www/wwwroot/freeapis.top && node -e "require('better-sqlite3')"`）执行，否则 require 失败返回空�?
 
---

## 14. 接手后建议操作清�?

1. 读完本文�?+ `CLAUDE.md` + `DEPLOYMENT-SOP.md`�?
2. 本地 `npm install` + `node --test tests/api.test.js tests/cli.test.js` 确认基线绿�?
3. 连生�?`export TOKEN_API=https://freeapis.top && node cli.js login -t <admin token 或账号密�?` �?`node cli.js stats` / `node cli.js admin invites` 确认连通�?
4. 有改动就�?§9 部署，部署后�?§9 验证清单 + 清缓存�?
5. �?CLI 后按 §8.4 发版（bump 版本 + 重新打包 + 部署）�?
6. 涉及审核可见性变更时，注意一次性回填�?
7. 需要权限时：普通测试用注册+邀请码；管理操作用管理员账号�?

---

## 15. 相关文档索引

| 文档 | 内容 |
|------|------|
| `CLAUDE.md` | AI 操作速查（CLI/API/DB），新会话常�?|
| `AGENT.md` | 本文件，全局接管指南 |
| `DEPLOYMENT-SOP.md` | 部署/运维/排障 SOP 细节 |
| `ADMIN-ACCOUNT.md` | 管理员账�?|
| `CHANGELOG.md` | 项目变更日志（按日期分组�?|
| `CHANGELOG-SCHEMA.md` | 数据�?schema 变更日志�?026-08-06 迁移�?|
| `宣传物料/README.md` | 公众�?小红书推广物料使用说�?|
| 服务器级 SOP | 本地 `C:\Users\yao\Desktop\aapanel-server\`（全服务器应用，未随本项目提交） |

---

## 16. 宣传物料（公众号 / 小红书推广，2026-08 起）

**核心公益口号：Token 就是力量**。所有物料在项目�?`宣传物料/` 文件夹，使用说明、发布步骤见 `宣传物料/README.md`（公众号文章需**行内 style**、图片手动上传，�?§13.13）�?

| 物料 | 说明 |
|------|------|
| `公众号推广文�?html` | v4 导演剪辑版，�?5000 汉字，第一人称 AI�?+ 当代互联网梗 + 3 场群�?+ 情感锚点「贡献伟大，无需多言�? **🎁 AI Agent 自助注册彩蛋**（深色复制块，读者复制给任意 AI Agent 即可自助注册进站�?|
| `文章头图.png` / `站点OG封面.png` | 1200×630 品牌�?|
| `站点二维码海�?png` | 600×800 扫码直达 freeapis.top |
| `微信群二维码.jpg` | 群码（过期则�?`public/wechat-group.jpg`�?|
| `海报/` | **7 张海�?× 2 尺寸**（`-3x4` 小红�?1242×1656 / `-1x1` 方形 1080×1080）：定位/口号/贡献伟大/开�?用爱发电/角色/加入双码。HTML+CSS flex + Playwright 截图，二维码只在 07 出现 |
| `海报-src/posters.html` | 海报源文件；重生�?`node scripts/gen-posters-html.js`（自带溢出检测，�?§13.12�?|
| `小红�?朋友圈文�?md` | 每张海报配套文案（小红书标题/正文/标签 + 朋友圈配文） |

**Token 来源口径（勿写成"纯官方免费额�?�?*：多元——① 厂商官方免费额度；② 社区成员自费购买后的捐赠；③ 互联网上的开源分享。底色是**开源精�?/ Copyleft**�?有能力的贡献，需要的人受�?；Free = 免费 + 自由）；不卖 Key、不做中转、不搞会员、不转售牟利�?
