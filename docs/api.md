# REST API 与 MCP

> 最后更新：2026-09-16

## 目录

- [1. 认证方式](#1-认证方式)
- [2. CSRF 约定](#2-csrf-约定)
- [3. API 分组总表](#3-api-分组总表)
- [4. MCP 端点与工具清单](#4-mcp-端点与工具清单)
- [5. 调用示例](#5-调用示例)

## 1. 认证方式

| 方式 | 凭据 | 适用 | 实现 |
| --- | --- | --- | --- |
| 会话 Cookie | `mb_session`（httpOnly、SameSite=Lax、生产 secure） | 浏览器同源 fetch | `lib/auth/session.ts`：token sha256 后比对 `sessions` 表；`pending2fa` 或邮箱未验证的会话被 `apiUser()` 拒绝 |
| Bearer API 令牌 | `Authorization: Bearer mbt_<prefix>_<secret>` | MCP / 脚本 / 第三方集成 | `lib/tokens.ts`：仅存 sha256 哈希；带 `scopes` 最小授权；可随时撤销 |

**Scopes 表**（创建令牌时勾选，MCP 工具声明所需 scope，缺则 403）：

| Scope | 允许 |
| --- | --- |
| `posts:read` | 读自己的文章、搜索/信息流 |
| `posts:write` | 创建/更新/删除文章 |
| `media:read` | 列出自己的媒体 |
| `media:write` | 上传/删除媒体 |
| `comments:read` | 读文章评论 |
| `feed:read` | 读社区信息流 |
| `profile:read` | 读公开资料与统计 |

登录/2FA 流程涉及的端点（`/api/auth/*`）仅接受会话方式；API 令牌在设置页「API/MCP」创建，只显示一次完整 token。

## 2. CSRF 约定

所有写请求（非 GET/HEAD/OPTIONS）在 wrapper 层（`lib/http.ts#assertSameOrigin`）校验：

- 浏览器请求：`Origin` 头存在时，其 host 必须等于 `Host`，否则 403（跨站请求被拒绝）；
- 非浏览器客户端（curl/MCP）：无 `Origin` 放行，凭 Bearer token 或会话 cookie（如需 cookie 方式请显式带 `Origin`）。

配套的浏览器侧防线：cookie `SameSite=Lax` 本身阻断跨站 POST 携带。

统一响应：成功 `ok(data)` → 200 + JSON；失败 `{ "error": "中文/English 说明" }` + 映射状态码（401 未登录 / 403 权限或跨站 / 404 / 422 参数 / 429 限流）。

## 3. API 分组总表

> 覆盖到组与权限级别；查询参数（limit/offset、状态过滤等）以各路由文件内的 zod 为准。权限列：`公开`｜`登录`｜`Admin/Editor`（RBAC）。

### Auth（/api/auth）

| 方法 路径 | 权限 | 说明 |
| --- | --- | --- |
| POST /api/auth/register | 公开 | 邮箱+用户名+密码注册（可要求邀请码）；发验证邮件 |
| POST /api/auth/login | 公开 | 密码登录；开 2FA 时返回挑战态 |
| POST /api/auth/logout | 公开 | 注销当前会话 |
| GET /api/auth/verify | 公开 | 邮箱验证令牌消费 |
| POST /api/auth/forgot · /api/auth/reset | 公开 | 忘记密码 / 重置 |
| POST /api/auth/resend-verification | 公开 | 重发验证邮件 |
| POST /api/auth/2fa/setup · confirm | 登录 | 绑定 TOTP（返回 otpauth+二维码）/ 确认开启 |
| POST /api/auth/2fa/challenge | 登录(pending) | 2FA 挑战（也接受恢复码） |
| GET /api/auth/oauth/[provider] · /callback/[provider] | 公开 | GitHub/Google/X OAuth 跳转与回调 |
| GET /api/auth/sso/discourse · /callback | 公开 | Discourse SSO |
| GET /api/auth/cf-access | 公开 | Cloudflare Access JWT 登录 |

### Me（/api/me）

| 方法 路径 | 权限 | 说明 |
| --- | --- | --- |
| GET/PUT /api/me/profile | 登录 | 资料读写（displayName/bio/links…） |
| PUT /api/me/appearance | 登录 | 外观覆盖（appearance jsonb） |
| GET/PUT /api/me/subdomain | 登录 | 子域名申请/修改（一次性锁可配） |
| POST /api/me/password | 登录 | 改密（撤其他会话） |
| GET /api/me/security | 登录 | 安全概览（2FA 状态/会话列表） |
| POST /api/me/recovery-codes | 登录 | 重新生成恢复码 |
| DELETE /api/me/sessions | 登录 | 注销指定/其他会话 |
| DELETE /api/me | 登录 | 注销账号（user:deleting 钩子级联清理） |
| GET/POST /api/me/invites | 登录 | 邀请码列表/生成 |
| GET/PUT /api/me/notifications | 登录 | 通知偏好读写 |
| GET/POST /api/me/tokens · DELETE /api/me/tokens/[id] | 登录 | API 令牌管理（创建时返回明文一次） |
| GET/POST /api/me/webhooks · PATCH/DELETE /api/me/webhooks/[id] | 登录 | Webhook CRUD |
| POST /api/me/webhooks/[id]/test | 登录 | 发送测试投递 |

### Posts / Collections / Topics

| 方法 路径 | 权限 | 说明 |
| --- | --- | --- |
| POST /api/posts | 登录 | 新建草稿/动态 |
| GET/PUT/DELETE /api/posts/[id] | 登录 | 详情（作者或管理员）/ 更新 / 删除 |
| POST /api/posts/[id]/submit | 登录 | 提交发布（触发审核流水线 post:submitted） |
| GET /api/posts/topics | 登录 | 话题字典 |
| GET/POST /api/posts/collections | 登录 | 合集列表/创建 |

### Media

| 方法 路径 | 权限 | 说明 |
| --- | --- | --- |
| POST /api/media/upload | 登录 | 上传图片（sharp→WebP，kind: inline/avatar/cover/featured） |
| GET/DELETE /api/media | 登录 | 媒体库列表/删除（删行+删文件；文件删除失败经 `storage.delete` 队列补偿） |
| POST /api/media/alt | 登录 | 更新替代文本 |
| GET /api/media/file/[...path] | 公开 | 媒体读取（缓存头；R2 回源前校验媒体键形状，非媒体对象 404） |

上传响应（`POST /api/media/upload`）字段说明：

- `storage`：实际落盘驱动（`local` | `r2`），即写入 `media.storage` 的值；
- `url` 三态：
  1. 公开桶（r2 + `R2_PUBLIC_BASE_URL`）→ `${R2_PUBLIC_BASE_URL}/${path}`，直连 R2/CDN；
  2. 私有桶（r2 未配公开域）→ 应用路由 `/api/media/file/${path}`（流式转发）；
  3. local 驱动 → 应用路由 `/api/media/file/${path}`（本地盘读取）。

其余字段：`id/path/width/height/size/filename/mime`（`path` 为 posix 对象键，`mime` 恒 `image/webp`）。

### Social

| 方法 路径 | 权限 | 说明 |
| --- | --- | --- |
| POST /api/likes | 登录 | 点赞/取消（post 或 comment，幂等切换） |
| POST /api/follows | 登录 | 关注/取关 |
| POST /api/blocks | 登录 | 拉黑/取消 |
| POST /api/reposts | 登录 | 转发（带 280 字评论） |
| POST/GET/DELETE /api/comments | 登录 | 发表/列表/删除评论 |
| GET /api/comments/viewer | 登录 | 我在文章下的评论 |

### Messages / Notifications

| 方法 路径 | 权限 | 说明 |
| --- | --- | --- |
| GET /api/messages/conversations | 登录 | 会话列表 |
| GET/POST /api/messages/[userId] | 登录 | 与某用户的历史/发私信（dmEnabled 关闭则 403） |
| GET /api/notifications | 登录 | 通知列表（分页） |
| POST /api/notifications/read · /read-all | 登录 | 标记已读/全部已读 |

### Reports / Export / Feed / 其他

| 方法 路径 | 权限 | 说明 |
| --- | --- | --- |
| POST /api/reports | 登录 | 举报 post/comment/user |
| GET/POST /api/export | 登录 | 导出任务列表 / 发起（queue: export.build） |
| GET /api/export/[id] · /download | 登录 | 任务状态 / 下载 ZIP |
| GET /api/feed | 公开 | 信息流分页（explore 用） |
| GET /api/feed.xml、/u/[username]/feed.xml、/sub/[subdomain]/feed.xml | 公开 | RSS（个人可关 rssEnabled） |
| POST /api/markdown/preview | 登录 | Markdown 预览渲染（同一管线，防 XSS） |
| GET /api/health | 公开 | 健康探针（无鉴权、无 DB） |

### Admin（/api/admin，RBAC 见 lib/permissions.ts）

| 方法 路径 | 权限 | 说明 |
| --- | --- | --- |
| GET /api/admin/stats | admin+editor | 仪表盘统计 + 最近用户/内容 |
| GET /api/admin/posts · POST /[id]/approve · /[id]/reject · DELETE /[id] | admin+editor（admin.moderate） | 内容审核台 |
| GET /api/admin/comments · PATCH/DELETE /api/admin/comments/[id] | admin+editor | 评论管理（隐藏/恢复/删除） |
| GET/POST /api/admin/keywords · /bulk · DELETE /[id] | admin+editor | 关键词黑名单 |
| GET /api/admin/moderation/queue | admin+editor | 待人工审核队列 |
| POST /api/admin/moderation/llm · /llm/test | admin | LLM 审核配置 / 连通性测试 |
| GET /api/admin/reports · POST /[id] | admin+editor | 举报处理（resolve/dismiss） |
| GET /api/admin/users · PATCH /[id] | admin | 用户管理（角色/封禁/解封） |
| GET/POST /api/admin/settings | admin | 站点设置（settings KV） |
| GET /api/admin/ops | admin（admin.ops） | 运维快照：进程/DB 计数/队列深度/内容健康/存储（只读） |

## 4. MCP 端点与工具清单

端点：`/api/mcp`（MCP Streamable HTTP，**stateless**——每 POST 一条 JSON-RPC 消息，GET 返回服务信息页）。认证必须 Bearer 令牌，无会话回退。服务名 `myblogs-mcp@1.0.0`。

工具（12 个，均作用于**令牌属主**账号，scope 不符返回 403）：

| 工具 | Scope | 说明 |
| --- | --- | --- |
| `list_my_posts` | posts:read | 自己的文章+动态，最新优先 |
| `get_post` | posts:read | 按 id 取全文 markdown |
| `create_article` | posts:write | 新建文章并进入审核流水线 |
| `update_post` | posts:write | 更新 title/content/summary |
| `delete_post` | posts:write | 永久删除自己的文章 |
| `search_posts` | posts:read | 全站已发布内容关键词搜索（GIN 全文索引） |
| `get_feed` | feed:read | 社区信息流（最近公开已发布） |
| `list_my_media` | media:read | 自己的媒体库 |
| `delete_media` | media:write | 删除媒体文件 |
| `list_post_comments` | comments:read | 某文章的评论 |
| `get_profile` | profile:read | 用户公开资料 |
| `get_stats` | profile:read | 用户内容统计 |

## 5. 调用示例

```bash
# ① 探活 & MCP 服务信息（无需鉴权）
curl -s http://localhost:3000/api/health
curl -s http://localhost:3000/api/mcp

# ② 列出工具（tools/list）
TOKEN="mbt_xxxxxx_yyyyyyyy"
curl -s http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# ③ 调用工具（tools/call）：搜索已发布文章
curl -s http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call",
       "params":{"name":"search_posts","arguments":{"query":"设计系统"}}}'

# ④ 调用工具：创建文章（走审核流水线）
curl -s http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call",
       "params":{"name":"create_article",
                 "arguments":{"title":"Hello MCP","content":"# Hi\n正文","summary":"摘要"}}}'

# ⑤ 运维快照（需要 admin 会话 cookie）
curl -s http://localhost:3000/api/admin/ops -H "Cookie: mb_session=<...>"

# ⑥ 带 Origin 的会话写请求（浏览器同源 fetch 自动携带）
curl -s http://localhost:3000/api/likes \
  -H "Cookie: mb_session=<...>" -H "Origin: http://localhost:3000" \
  -H "Content-Type: application/json" \
  -d '{"targetType":"post","targetId":"<uuid>"}'
```

JSON-RPC 错误约定：`-32001` 未授权（token 无效）、`-32700` 解析错误、工具内错误透传在 `result.isError` + `content` 文本。
