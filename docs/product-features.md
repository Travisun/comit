# 产品功能总览

> 最后更新：2026-09-11

面向使用者/产品视角的功能地图；每节标注实现入口，细节链接专题文档。

## 目录

- [1. 双模式首页](#1-双模式首页)
- [2. 长文与短动态](#2-长文与短动态)
- [3. 合集与话题](#3-合集与话题)
- [4. 社交互动](#4-社交互动)
- [5. 私信](#5-私信)
- [6. 邀请码与注册控制](#6-邀请码与注册控制)
- [7. 子域名个人站](#7-子域名个人站)
- [8. RSS](#8-rss)
- [9. Webhook](#9-webhook)
- [10. MCP 开放接口](#10-mcp-开放接口)
- [11. 内容审核流](#11-内容审核流)
- [12. 数据导出与 GDPR](#12-数据导出与-gdpr)
- [13. 强制 2FA 与账号安全](#13-强制-2fa-与账号安全)
- [14. SSO / OAuth 登录](#14-sso--oauth-登录)
- [15. 平台化能力专题](#15-平台化能力专题)

## 1. 双模式首页

站点设置 `site.mode` 一键切换：

- **multi（多用户社区）**：首页是社区信息流（聚合已发布公开内容），配 `/explore` 探索与 `/topics/[slug]` 话题页；
- **single（单用户博客）**：首页即指定账号（`site.singleUser`）的个人博客，适合「主站就是我的博客」的用法。

实现：`src/lib/settings.ts`（`isMultiUserMode`）+ 首页 RSC 按模式分支渲染。

## 2. 长文与短动态

同一 `posts` 表，`type = article | short`：

- **article**：slug URL、封面图、摘要、目录、KaTeX 公式、Mermaid 图表、Shiki 代码高亮、GFM；
- **short**：轻量动态（类似微博），默认免审直接发布（除非命中审核策略）。

Markdown 管线：unified（remark/rehype）+ `rehype-sanitize` 白名单净化，预览与正式渲染共用一套（`/api/markdown/preview`），所见即所得。

## 3. 合集与话题

- **合集（collections）**：用户自建的内容序列，`/u/[username]/collections/[slug]`，文章可归属（`collectionId`），适合教程系列；
- **话题（topics）**：全站横向标签，多对多（`post_topics`），`/topics/[slug]` 聚合页。

## 4. 社交互动

关注（follows）、点赞（posts/comments）、转发（reposts + 280 字评论）、两级评论回复、@提及（正文/评论解析 → `user:mentioned` 事件）。计数冗余在 posts 行（views/likeCount/commentCount/repostCount），列表页零聚合。拉黑（blocks）后双端不可见。

## 5. 私信

点对点会话（conversations 唯一对去重）+ 消息表；支持图片（走媒体管线）。受 `users.dmEnabled` 开关与拉黑关系约束；新消息走 `message:created` 事件 → 站内信/邮件提醒。入口 `/messages`。

## 6. 邀请码与注册控制

`site.registrationOpen` 总开关；`site.inviteRequired` 开启后注册必须携带有效邀请码（invites 表记录 creator/usedBy，形成邀请链）。用户可在设置页生成邀请码。

## 7. 子域名个人站

开启 `site.subdomains` 后，用户可认领 `alice.ROOT_DOMAIN`（`users.subdomain`，可配一次性锁定）。访问 `/sub/[subdomain]/[[...path]]` 呈现该用户的完整博客（含独立 `/sub/[subdomain]/feed.xml`）。本地测试：`lvh.me:3000` 或 hosts 配 `*.localhost`（见 operations.md FAQ）。

## 8. RSS

三路输出：全站 `/feed.xml`、用户 `/u/[username]/feed.xml`、子域名 `/sub/[subdomain]/feed.xml`；用户级 `rssEnabled` 可关闭。生成用 `feed` 库，查询条件可被 `feed:query` 钩子过滤（插件可收窄信息流）。

## 9. Webhook

用户订阅平台事件的出站推送（`webhooks.events` 白名单）：投递带 `X-MyBlogs-Event`、`X-MyBlogs-Timestamp`、`X-MyBlogs-Signature: v1=HMAC-SHA256(secret, ts.payload)`；15s 超时，失败进队列重试（指数退避），每次投递留痕于 `webhook_deliveries`（状态/响应码/错误），连续失败累计 `failCount`。测试按钮发送样例事件。

## 10. MCP 开放接口

`/api/mcp`：Model Context Protocol over Streamable HTTP，Bearer `mbt_` 令牌 + scopes 最小授权。12 个工具覆盖文章读写、搜索、媒体、信息流、资料（工具清单与 curl 示例见 [api.md](./api.md)）。可在 Claude 等支持 MCP 的客户端中直接「让 AI 管理你的博客」。

## 11. 内容审核流

`site.moderation.reviewMode = off | llm | manual`：

```
提交(post:submitted) → 关键词扫描（block=直接拒 / warn=标记）
   → reviewMode=llm：OpenAI 兼容接口打分（失败按 llmFailMode open/closed 放行或拦截）
   → 需人工：进入 pending_review 队列 → 管理员批准/驳回（附理由）
全程痕迹写入 posts.moderation；结果事件（approved/rejected）驱动通知与 Webhook。
```

关键词黑名单后台可管理（支持批量导入），LLM 提示词/模型/温度后台可配并可测试连通性。

## 12. 数据导出与 GDPR

用户发起全量导出（`export.build` 队列异步打包）：文章（Markdown 源）+ 媒体 + 元数据为 ZIP（`archiver`），完成后 `storage/exports/<requestId>.zip`，限时下载，定时清理（`export.cleanup`）。任务状态机 queued→building→done/failed 全程可查。

## 13. 强制 2FA 与账号安全

- `site.force2fa` 默认开启：登录后强制绑定 TOTP（otplib），挑战支持恢复码（一次性，哈希存储）；
- 会话全量 DB 化：设备/会话列表、远程注销、改密踢会话；
- 密码哈希 + 一次性令牌（验证/重置均 sha256 落库限时消费）；
- 限时封禁（`bannedUntil`）在会话解析层拦截。角色与认证细节见 roles-permissions.md（并行产出中）。

## 14. SSO / OAuth 登录

GitHub / Google / X OAuth（Arctic 实现，回调自动建号绑定 `oauth_accounts`）；Discourse SSO（作为 client 接入论坛账号体系）；Cloudflare Access JWT（Zero Trust 内网免密登录）。各渠道后台 `site.sso.*` 开关控制入口展示。凭据见 operations.md 环境变量表。

## 15. 平台化能力专题

| 能力 | 简述 | 专题文档 |
| --- | --- | --- |
| 主题系统 | 主题包注册 + `users.theme` 增量覆盖（options/customCss），classic/ink 内置 | theme-system.md（并行产出中） |
| 角色与认证 | RBAC 权限表（admin/editor/user）、会话、TOTP、OAuth/SSO 全链路 | roles-permissions.md（并行产出中） |
| 后台管理 | 仪表盘/内容/评论/举报/认证/用户/设置/运维八大工作台 | admin-guide.md（并行产出中） |
| 通知系统 | 事件驱动 + 多频道（站内信/邮件/Webhook）+ 每用户偏好覆盖 | notifications.md（并行产出中） |
| 内容标注 | original / ai_assisted / repost / opinion 四类来源标注 | content-labels.md（并行产出中） |
| 运维面板 | `/admin/ops`：进程/DB/队列/内容健康/存储只读快照 | 本仓库 [operations.md](./operations.md)、[concurrency.md](./concurrency.md) |
