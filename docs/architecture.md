# 总体架构

> 最后更新：2026-09-11

## 目录

- [1. 分层总览](#1-分层总览)
- [2. 请求生命周期](#2-请求生命周期)
- [3. 领域事件与订阅关系](#3-领域事件与订阅关系)
- [4. 插件系统与扩展点](#4-插件系统与扩展点)
- [5. 目录结构说明](#5-目录结构说明)

## 1. 分层总览

Laravel 风格的「框架层 + 插件层 + 领域服务层 + 路由层」，依赖方向自上而下、单向：

```
app/        路由层：页面(RSC) + API 路由（薄壳，只做参数解析与权限）
lib/        领域服务：auth / media / markdown / moderation / settings / i18n / seo / tokens …
plugins/    内置功能插件：notifications / webhooks / moderation / mcp / export
core/       框架层：config / events / hooks / queue / routes / errors / workers / container / plugins
db/         Drizzle schema + 迁移入口 + 种子
components/themes  UI 组件（shadcn 风格）与博客主题包
```

核心原则：

- **core 不依赖 plugins/lib/app**（惰性 `import()` 除外），插件通过 `PluginContext` 拿到全部能力；
- **一切副作用挂领域事件**（`core/events`），路由层只写业务主数据 + `emit()`，通知/Webhook/审核全部由事件驱动；
- **插件就是扩展点的第一使用者**：通知、Webhook、审核、MCP、导出都不是 core，全部以内置插件实现，用于验证扩展缝是否够用。

### core/ 各模块

| 模块 | 职责 |
| --- | --- |
| `core/config.ts` | env 配置仓库（读一次，getter 访问）；运行时可调设置在 DB `settings` 表 |
| `core/events.ts` | Emittery 类型化事件总线（`AppEventPayloads` 是全平台可观察事实的唯一定义） |
| `core/hooks.ts` | hookable 全局钩子（action/filter） |
| `core/queue.ts` | pg-boss 门面 + 类型化作业负载（`queue.send` / `queue.work`） |
| `core/workers.ts` | 队列 worker 注册（邮件/审核/导出/Webhook 投递），由 instrumentation 启动 |
| `core/routes.ts` | 命名路由注册表（避免硬编码 URL） |
| `core/errors.ts` | `AppError` + HTTP 状态码映射（`toErrorResponse`） |
| `core/plugins/` | 插件契约（`types.ts`）与管理器（`registry.ts`） |
| `core/container.ts` | 服务容器/门面（app.db / app.events / app.queue …） |

## 2. 请求生命周期

当前**没有 edge middleware**：安全响应头由 `next.config.ts` 的 `headers()` 统一下发；子域名访问走 `/sub/[subdomain]/[[...path]]` 路由段 + `ROOT_DOMAIN` 解析，而非域名重写。

### 2.1 页面（RSC）

```
浏览器 → cluster master accept → 某个 worker 的 Next.js server
  → RSC 渲染：页面顶部调用守卫
      requireUser()     cookie mb_session → sessions 表（sha256 哈希比对）
                        未登录 → /auth/login；pending2fa → 2FA 挑战；未验证邮箱 → /auth/verify
      requirePageRole(action)  再叠加 RBAC（如 admin.ops 仅 admin），失败 redirect
  → 服务层（lib/*）查库 → 渲染 HTML
```

`getAuth` 用 React `cache()` 按请求去重，一次渲染只查一次会话。定时封禁（`bannedUntil`）在会话解析处拦截。

### 2.2 API 路由

```
fetch → src/app/api/**/route.ts
  withApi(req, h)       公开端点：仅做 Origin 同源校验（CSRF）
  withUser(req, h)      + 登录（apiUser：会话有效、2FA 已过、邮箱已验证）
  withAdmin(req, h)     + role === "admin"
  withPermission(req, "admin.ops", h)   通用 RBAC（permissions.ts 的 PERMISSIONS 表）
  → handler：zod 解析参数（parseOrThrow）→ 服务层 → ok(data)
  → 错误统一走 AppError → toErrorResponse → { error } + 合适的状态码
```

写请求（非 GET/HEAD/OPTIONS）在 wrapper 最前面做 `assertSameOrigin`：浏览器请求的 `Origin` 必须与 `Host` 一致；curl/MCP 等无 Origin 的客户端放行，改由 Bearer token 认证（见 [api.md](./api.md)）。

### 2.3 异步路径（领域事件 → 队列）

```
路由/服务层 emit("post:published", …)
  └→ Emittery 总线（进程内，同步分发）
       ├→ notifications 插件：写 notifications 表 + queue.send("mail.send")
       └→ webhooks 插件：写 webhook_deliveries + queue.send("webhook.deliver")
pg-boss（同一 PG，pgboss.job 表）→ 各 worker 竞争消费（instrumentation 每 worker 注册 worker）
```

跨 worker 的事件不广播：事件只在本进程内生效，跨进程协作一律经过数据库/队列表（这是 cluster 模型下无共享内存的必然选择，见 [concurrency.md](./concurrency.md)）。

## 3. 领域事件与订阅关系

`core/events.ts` 的 `AppEventPayloads` 完整清单（括号内为当前订阅方）：

**用户域**

| 事件 | 载荷要点 | 订阅方 |
| --- | --- | --- |
| `user:registered` | userId/email/username/invitedBy | notifications（欢迎+验证邮件） |
| `user:login` | userId/ip | 安全审计预留 |
| `user:followed` / `user:unfollowed` | follower/followee | notifications（被关注提醒） |
| `user:mentioned` | userIds/target/excerpt | notifications（@提醒） |

**内容域**

| 事件 | 载荷要点 | 订阅方 |
| --- | --- | --- |
| `post:submitted` | postId/needReview | moderation 插件（入审核流水线/`moderation.review` 队列） |
| `post:published` | postId/slug/title/type | notifications（粉丝订阅）、webhooks |
| `post:approved` / `post:rejected` | postId/reason | notifications（作者）、webhooks |
| `post:liked` / `post:reposted` | actor/author | notifications、webhooks |
| `comment:created` | postId/replyTo/excerpt | notifications（作者+被回复人）、webhooks |
| `comment:liked` | commentId/actor | notifications |
| `message:created` | sender/receiver/excerpt | notifications（私信提醒） |

**系统/运营域**

| 事件 | 载荷要点 | 订阅方 |
| --- | --- | --- |
| `moderation:review.completed` | approved/by(keyword\|llm\|manual) | moderation 内部（驱动 approved/rejected 事件） |
| `media:uploaded` | mediaId/userId | 预留（缩略图/病毒扫描挂点） |
| `webhook:delivery.failed` | webhookId/event/error | webhooks 插件（failCount 累计） |
| `user:warned` / `user:banned` / `user:unbanned` | byAdminId/reason | notifications |
| `verification:approved` / `verification:rejected` | type/label/reason | notifications（认证徽章结果） |

新增事件的流程：在 `AppEventPayloads` 加类型化键 → 业务处 `emit()` → 插件里 `ctx.events.on()` 订阅。禁止在路由里直接写通知/Webhook 副作用。

## 4. 插件系统与扩展点

一个插件 = `{ name, description, version, register(ctx) }`，在 `instrumentation.ts`（每 server 进程一次）里由 `bootPlugins()` 顺序注册。内置五个：

| 插件 | 能力 |
| --- | --- |
| `plugins/notifications.ts` | 站内信/邮件/（可扩展）频道；每用户偏好覆盖（`users.notificationPrefs`） |
| `plugins/webhooks.ts` | 用户订阅事件子集；HMAC-SHA256 签名投递（`X-MyBlogs-Signature: v1=…`）；失败重试 |
| `plugins/moderation.ts` | 关键词黑名单（block/warn）→ LLM 审核（OpenAI 兼容）→ 人工队列 |
| `plugins/mcp.ts` | 12 个 MCP 工具（posts/media/feed/profile），Bearer token + scopes |
| `plugins/export.ts` | Markdown+媒体 ZIP 打包导出（GDPR） |

四类**注册型扩展点**（`core/plugins/types.ts`）：

```ts
registerChannel(channel)        // 通知频道（如未来的短信/飞书）
registerMcpTool(tool)           // MCP 工具（name/description/inputSchema/scopes/handler）
registerWidget(widget)          // 用户主页侧栏组件
registerAdminSection(section)   // 管理面板区块
```

四类**机制型扩展点**：

- **领域事件**（上文第 3 节）——观察业务事实；
- **hookable 钩子**（`core/hooks.ts`）——修改渲染产物：`post:render`（正文 HTML 过滤）、`post:excerpt`、`feed:query`、`user:deleting`、`sidebar:widgets`、`admin:menu`、`mcp:tools`、`notification:channels`；
- **主题包**（`themes/registry.ts`）——`registerTheme(theme)` 自注册，`users.theme` 存增量覆盖（id/options/customCss），详见 theme-system.md（并行产出中）；
- **队列作业**（`core/queue.ts`）——`JobPayloads` 中新增作业类型 + `core/workers.ts` 注册处理器。

新增插件的完整步骤：`src/plugins/` 建文件 → 在 `core/plugins/registry.ts` 的 `PLUGINS` 数组追加 → `register()` 里订阅事件/注册扩展点。第三方插件无需改 core，即可获得与内置插件同等的接入面。

## 5. 目录结构说明

```
src/
├── instrumentation.ts        # 每 worker 进程启动：bootPlugins + startWorkers
├── core/                     # 框架层（见第 1 节表格）
├── plugins/                  # 内置插件（见第 4 节表格）
├── db/                       # schema.ts / index.ts(连接池) / migrate.ts / seed.ts
├── lib/                      # 领域服务
│   ├── auth/                 # session(guards) / password / totp / oauth / invite
│   ├── permissions.ts        # RBAC：PERMISSIONS 表 + requirePageRole / withPermission
│   ├── http.ts               # withApi/withUser/withAdmin + assertSameOrigin(CSRF) + ok()
│   ├── media.ts              # sharp → WebP 管线（头像512²/封面1920w/正文2000w）
│   ├── tokens.ts             # mbt_ API 令牌 + scopes
│   ├── moderation.ts         # 关键词扫描 + LLM 审核 + pendingReviewCount
│   ├── settings.ts           # DB 设置仓库（SETTINGS_DEFAULTS + admin 可调）
│   ├── rate-limit.ts         # 进程内固定窗口限流（多 worker 各自独立）
│   ├── markdown/ seo/ i18n/  # 渲染管线 / SEO 元数据 / 中英双语文案
│   └── mcp-transport.ts      # MCP Streamable HTTP（stateless，每 POST 一次握手）
├── themes/                   # 主题包注册表 + packs/classic、packs/ink
├── components/               # ui/(shadcn 风格) admin/ social/ editor/ markdown/ …
└── app/
    ├── (营销/社区) /          # 首页(双模式)、explore、topics、u/[username]、p/[id]
    ├── auth/ write/ settings/ messages/ notifications/
    ├── sub/[subdomain]/      # 子域名入口（[[...path]] 通配 + 独立 feed.xml）
    ├── admin/                # 后台：dashboard/articles/moderation/comments/reports/
    │                         #       verification/users/settings/**ops**（运维面板）
    └── api/                  # REST（分组见 docs/api.md）+ /api/health + /api/mcp
scripts/
├── cluster-server.mjs        # cluster 多进程启动器（master/worker、优雅排水）
└── load-test.mjs             # 零依赖压测（mixed/read/health/--show-workers）
storage/
├── media/<uid前2>/<前2>/<uid>/xx.webp   # 用户媒体（sharp 归一化 WebP）
└── exports/<requestId>.zip              # 导出归档
```

相关文档：[concurrency.md](./concurrency.md)（多进程与容量）、[operations.md](./operations.md)（部署运维）、[schema.md](./schema.md)（数据模型）、[api.md](./api.md)（接口与 MCP）。
