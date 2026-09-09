# 积分规则 · Token公益站

> 积分是本站的贡献账本：**获取 = 贡献，消耗 = 使用**。所有流水写入 `points_log`，可在 `我的积分` 中查看。

## 0. 一句话总结

- **初始 5 分**（注册即得，可先看 5 张卡）
- **看卡 1 分/张**（首看扣、已看免费、作者/版主免）
- **拉取 `recent` 每天免费 5 次**，超出 1 分/条
- 贡献（发布/审核/签到/打赏等）可赚分，闭环循环

## 1. 如何获取积分

| 行为 | 积分 | 触发时机 | 去重/说明 |
|------|------|----------|-----------|
| 注册 | **+5** | `POST /api/auth/register` 成功 | 新用户 `users.points=5`（`lib/auth.js:125`） |
| 发布 Token（含 Token 的条目） | **+1** | 发布并自动上线 `verified=1` | `item_verify`，`awardPointsOnce` 按 `(user,reason,itemId)` 去重（下线重过不重复） |
| 教程审核通过 | **+1** | 版主 `PUT /api/admin/tutorials/:id/verify` 通过 | `tutorial_verify` 去重 |
| Skill 审核通过 | **+1** | 版主通过 Skill | `skill_verify` |
| Skill 首单售出 | **+1** | 你的 Skill 完成第一笔 `skill_buy` | `skill_first_sale` |
| Skill 被好评 | **+1** | 他人对你的 Skill 评分 `POST /skills/:id/reviews` | `skill_review`（不能自评） |
| 反馈被认可 | **+1** | 版主 `POST /api/admin/feedback/:id/verify` 标记高质量 | `feedback_verify`，每条反馈仅一次 |
| 邀请奖励 | **+1** | 你生成的邀请码 `invite_codes` 被新用户使用注册 | `invite`（一码一用） |
| 被打赏 | **+1** | 他人 `POST /api/items/:id/tip` 打赏你的卡 | `tip_received`（打赏者扣 1，你得 1） |
| 购买 Skill 售出 | **+price** | 他人购买你的付费 Skill | `skill_sell`，0% 抽成全额到账 |
| 每日签到 | **+1 / +3 / +6** | `POST /api/checkin` | 连续 1-6 天 +1，**第 7 天 +3（含+2 bonus），第 30 天 +6（含+5）**（`checkinPoints`），断签重置 |

> 版主/管理员发布同样可得发布奖励；所有发放均幂等（`points_log UNIQUE(user_id,reason,ref_id)` 兜底并发）。

## 2. 如何消耗积分

| 行为 | 消耗 | 免费额度/去重 | 接口 | 备注 |
|------|------|---------------|------|------|
| **查看 Token 详情**（看卡） | **1 分/张** | 按卡去重：同一用户同一 `itemId` 仅首看扣 1，后续免费 | `POST /api/items/:id/view` 间接 via `consumeView` | 列表 `GET /api/items` 永远不返真 `token/url`，防绕过；作者/版主/管理员豁免 |
| **CLI 拉取 `recent`** | **1 分/条** | **每天免费 5 条**（超出才扣） | `GET /api/recent?limit=N` | `N=1~20`，按实际返回 `items.length` 计费；版主/管理员豁免 |
| 打赏他人 | **1 分/次** | 同卡对同作者仅一次（幂等） | `POST /api/items/:id/tip` | 需已上线非本人；积分不足 400 |
| 购买付费 Skill | **price 分** | 免费 Skill 0 分直接授权；已购幂等不重复扣 | `POST /api/skills/:id/buy` | 失败事务回滚 |

> 除上述外，**浏览首页/搜索/看教程/Skill 列表/公告等均不消耗积分**。

## 3. 每日额度与重置

- `recent` 的 5 次免费按 **东八区自然日（UTC+8）** 切日（`lib/points.js:9 todayStr`），服务器在悉尼（UTC+10）但对用户按北京时间重置，次日 0 点恢复 5 次。
- 实现为**懒重置**：`users.pull_date/pull_count` 仅在 `consumePulls/getPointsState` 时比对 `today`，非定时任务。
- 查询：`GET /api/points` 返 `points/pullCountToday/freeLeftToday(0~5)`；CLI `node cli.js points` / `--json` 同步。

## 4. 豁免

- 版主 `moderator` / 管理员 `admin`：`view` 与 `recent` 均 **不计次不扣分**（`isStaff` 直返）。
- 作者本人看自己的卡：`view` 免扣（`isAuthor`）。

## 5. 示例

- 新用户 A 注册 5 分 → 看 5 张不同卡各 1 分 → 余 0 分 → 第 6 张卡需先赚分（发布 1 条 +1 后即可看）。
- A 今日 `recent -n 3`（前3条免费）→ 再 `recent -n 5`（剩2免费+3分，需3分，不足则 400）。
- A 连续签到 7 天：6×1 + 第7天3 = 9 分。
- A 被打赏 2 次 + 教程过审 1 次 = +3。

## 6. 在哪查看

- 网页：右上角头像 → 积分余额；`我的积分` 弹窗/ `GET /api/points?all=1` 看明细（`reason` 中文映射见 `cli.js:564`/`dash.js:51`）；签到按钮 `checkin --status` 看连击。
- CLI：`node cli.js points`（余额/今日免费/流水）、`node cli.js checkin` / `checkin --status`、`node cli.js recent` 返 `freeUsed/pointsUsed/freeLeftToday/pointsRemaining`。

## 7. FAQ

**Q: 看列表会扣分吗？** 不会。仅点进详情（需真 `token/url`）才触发 `view` 扣分。

**Q: 同一张卡反复看会重复扣吗？** 不会。`idx_points_log_view_unique WHERE reason='view'` 保证一人一卡仅一次。

**Q: 5 次免费是按账号还是按 IP？** 按账号 `users.pull_count`，与 IP 无关。

**Q: 积分可以交易/提现吗？** 不可。仅站内流动（打赏、Skill 交易 0% 抽成）。

**Q: 403/400 时扣分吗？** 不扣。仅 `200` 成功且 `freeUsed < count` 时才事务扣分；`already:true` 也不扣。

---
*文档版本：2026-09-09 · 源码单一真相：`lib/points.js` + `server.js:2877` + `lib/auth.js:125` · 页面 `/points` 实时同步。*
