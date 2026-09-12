# 数据模型（Schema）

> 最后更新：2026-09-11

Source of truth：`src/db/schema.ts`（Drizzle，PostgreSQL）。本文是导读，字段冲突时以代码为准。

## 目录

- [1. ER 总览](#1-er-总览)
- [2. 核心表速览](#2-核心表速览)
- [3. 关键约束与索引](#3-关键约束与索引)
- [4. jsonb 字段形状](#4-jsonb-字段形状)
- [5. 枚举与状态机](#5-枚举与状态机)
- [6. 迁移管理规范](#6-迁移管理规范)

## 1. ER 总览

```
users ──┬─< oauth_accounts            users ──< invites(creator/usedBy)
        ├─< sessions                  users 1:1 totp_secrets
        ├─< auth_tokens
        ├─< collections ──< posts（collection_id, set null）
        ├─< posts ──┬─< comments ──< likes(comment)
        │           ├─< likes(post)      （复合主键去重）
        │           ├─< reposts          （user+post 唯一）
        │           ├─> post_topics >── topics
        │           └─< reports(target)  （多态：post|comment|user）
        ├─< follows（follower/followee 复合主键，自参照）
        ├─< blocks（blocker/blocked 复合主键）
        ├─< conversations >─< messages
        ├─< notifications（actor_id = 触发者，set null）
        ├─< media（path 指向 storage/media）
        ├─< webhooks ──< webhook_deliveries
        ├─< api_tokens（MCP Bearer）
        ├─< verification_requests（认证申请）
        └─< export_jobs（导出任务）

platform：settings(key-value) / keywords(审核黑名单) / mod_logs(管理审计)
queue：pgboss.job（pg-boss 自管 schema，LIST(name) 分区，业务只读）
```

软删除约定：仅 `users.deletedAt`（账号删除走 `user:deleting` 钩子级联清理）；内容删除为硬删除，靠 `mod_logs` 审计。

## 2. 核心表速览

| 域 | 表 | 用途 / 要点 |
| --- | --- | --- |
| 身份 | `users` | 账号主档；`role(user/admin)`、`tier`（会员钩子）、`theme/appearance/widgets`（个性化）、`subdomain`、`notificationPrefs`、`bannedUntil`（限时封禁） |
| | `oauth_accounts` | provider + providerAccountId 唯一；首登自动注册 |
| | `sessions` | sha256(tokenHash) 会话；`pending2fa` 标记强制 2FA 挑战前状态；ip/ua 审计 |
| | `auth_tokens` | 邮箱验证 / 密码重置一次性令牌（type 区分，usedAt 消费标记） |
| | `totp_secrets` | TOTP 密钥 + 恢复码哈希数组 |
| | `invites` | 邀请码（`site.inviteRequired` 开启时注册必需） |
| 内容 | `collections` | 用户合集（合集话题页 `/u/x/collections/[slug]`） |
| | `posts` | 文章+短动态（`type`）；`status` 状态机；`label` 内容标注；`moderation` 审核痕迹；标题计数列（views/like/comment/repost，避免聚合查询）；GIN 全文索引 |
| | `topics` / `post_topics` | 全站话题 + 多对多 |
| | `media` | WebP 媒体元数据（宽高/体积/kind），`path` 相对 storage/media |
| 社交 | `likes` / `reposts` / `follows` / `blocks` | 复合主键天然防重；计数冗余在 posts 行上 |
| | `comments` | 两级回复（replyToCommentId/replyToUserId），status: visible/hidden/deleted |
| 私信 | `conversations` / `messages` | 会话对唯一（userAId<userBId 规范化）；`lastMessageAt` 排序 |
| 平台 | `notifications` | key 标识事件类型；`readAt` 已读；payload jsonb |
| | `webhooks` / `webhook_deliveries` | 订阅 + 每次投递留痕（status/responseCode/attempts/error） |
| | `api_tokens` | MCP/REST Bearer 令牌：prefix 供展示、sha256 哈希、scopes 数组、revokedAt 撤销 |
| | `verification_requests` | 认证申请：类型/铭牌/附件，approved 后写入 `users.verified` |
| | `settings` | 站点设置 KV（key 主键，value jsonb），默认值在 `src/lib/settings.ts` |
| | `keywords` | 审核关键词：severity block/warn，word 唯一 |
| | `reports` | 举报：多态 target(post/comment/user)，status open/resolved/dismissed |
| | `mod_logs` | 管理操作审计（adminId/action/target/note） |
| | `export_jobs` | GDPR 导出：queued→building→done/failed，产物在 storage/exports |

## 3. 关键约束与索引

设计原则：**列表查询走复合索引，计数走冗余列，唯一性靠约束不靠查询**。

| 表 | 索引/约束 | 支撑的查询 |
| --- | --- | --- |
| users | `users_email_key`、`users_username_key`、`users_subdomain_key`（均唯一）；`users_created_at_idx` | 登录、主页、子域名解析、admin 列表 |
| posts | `posts_author_slug_key`（authorId+slug 唯一）；`posts_author_status_idx`；`posts_published_idx`；`posts_status_idx`；`posts_search_idx`（GIN，`to_tsvector('simple', title||content)`） | `/u/x/posts/[slug]`、作者工作台、信息流时间线、`search_posts` |
| sessions | `sessions_token_key` 唯一 + `sessions_user_idx` | 每请求会话校验（哈希点查） |
| likes/follows/blocks | 复合主键 + target/被关注者二级索引 | 防重插入、反向列表 |
| comments | `comments_post_idx`（postId+createdAt） | 文章评论区时间线 |
| messages | `messages_conversation_idx` | 会话内消息分页 |
| webhook_deliveries | `webhook_deliveries_hook_idx` | 投递历史 |
| media | `media_user_idx`（userId+createdAt） | 媒体库分页 |
| notifications | `notifications_user_idx` | 通知中心 |

外键策略：用户删除（`user:deleting` 流程）以 `ON DELETE CASCADE` 为主；展示性引用（notifications.actorId、posts.collectionId、comments.replyToUserId）用 `SET NULL` 保内容不丢。

## 4. jsonb 字段形状

TS 类型即契约（schema.ts 中 `$type<>`），此处记录形状与语义：

| 字段 | 形状 | 说明 |
| --- | --- | --- |
| `users.theme` | `{ id?: string; options?: Record<string,unknown>; customCss?: string }` | 主题包 id + 增量覆盖（缺省回落包默认），customCss 追加注入。详见 theme-system.md（并行产出中） |
| `users.appearance` | `{ homeBg?/postBg?/accent?: string\|null; fontFamily?: string\|null; fontSize?: "sm"\|"md"\|"lg"\|null }` | 个人页外观，默认 `{}` |
| `users.widgets` | `string[]` | 侧栏组件白名单（WidgetDef.id） |
| `users.verified` | `{ type; label; approvedAt } \| null` | 认证徽章，仅审核通过后写入 |
| `users.notificationPrefs` | `Record<eventKey, channel[]>` | 每事件覆盖频道集（如 `{"comment.created":["database"]}`）；空 = 站点默认 |
| `posts.moderation` | `{ keyword?: {severity; hits[]}; llm?: {approved; score?; reason?}; reviewedAt?; reviewedBy? }` | 审核流水线痕迹：关键词命中、LLM 结论、人工复核 |
| `posts.label` + `sourceUrl/sourceName` | `varchar(24)`：`original\|ai_assisted\|repost\|opinion` | 内容标注（详见 content-labels.md，并行产出中） |
| `verification_requests.attachments` | `string[]` | media 相对路径数组 |
| `webhooks.events` | `string[]` | 订阅的事件名白名单 |
| `api_tokens.scopes` | `string[]` | `posts:read / posts:write / media:read / media:write / comments:read / feed:read / profile:read` |
| `settings.value` | `unknown` | 形状由 `SETTINGS_DEFAULTS` 对应键约束（zod 不直查库，读侧收敛类型） |
| `totp_secrets.recovery_codes` | `string[]` | sha256 哈希，用一条删一条 |

jsonb 写入纪律：**读-改-写要整体覆盖**（避免并发丢字段），或用 `jsonb_set`；新增字段必须可缺省（旧数据无该键）。

## 5. 枚举与状态机

```
user_role:    user → admin（仅人工/seed 提升）
user_status:  active ⇄ suspended → deleted
post_status:  draft → pending_review → published        （article 主链）
                                     ↘ rejected → (修改后重新 submit)
              visibility: public | followers
post_type:    article | short（短动态默认跳过 pending_review，除非命中审核）
report:       open → resolved | dismissed
export_job:   queued → building → done | failed
pgboss.state: created → active → completed | failed(retry 循环) | expired | cancelled
```

## 6. 迁移管理规范

- 生成：`pnpm db:generate`（drizzle-kit diff `src/db/schema.ts` → `drizzle/*.sql`）；
- 应用：`pnpm db:migrate`（`src/db/migrate.ts`，按序执行并记录 journal）；
- 铁律：迁移文件入库存后不可修改；删除列分两步（先停写、后删列）；给大表加索引用 `CREATE INDEX CONCURRENTLY`（手写 SQL 迁移）；
- pg-boss 表不进 drizzle 管理（其内部迁移自管），运维侧只读监控（见 operations.md 第 6 节）；
- 环境推进：本地验证 → staging 演练 → 生产（前先备份，见 operations.md 第 4 节）。
