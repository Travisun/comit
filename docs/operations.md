# 部署与运维

> 最后更新：2026-09-16

## 目录

- [1. 环境变量全表](#1-环境变量全表)
- [2. 启动方式](#2-启动方式)
- [3. 数据库迁移流程](#3-数据库迁移流程)
- [4. 备份与恢复](#4-备份与恢复)
- [5. 日志规范](#5-日志规范)
- [6. 监控建议](#6-监控建议)
- [7. 常见问题](#7-常见问题)

## 1. 环境变量全表

`.env.example` 逐项说明（**加粗**为生产必填/必改）：

### App

| 变量 | 示例/默认 | 说明 |
| --- | --- | --- |
| **`APP_URL`** | `http://localhost:3000` | 对外访问基址，用于邮件链接、OAuth 回调、RSS 链接生成 |
| **`ROOT_DOMAIN`** | `localhost` | 子域名模式的根域（`alice.blog.example.com` → `blog.example.com`） |
| **`AUTH_SECRET`** | （无安全默认） | 会话/令牌签名密钥；生产必须换 32+ 位随机串，轮换会使全站会话失效 |
| `NODE_ENV` | `development` | 生产设 `production`（影响 cookie `secure`、Next 编译产物） |

### Database

| 变量 | 示例 | 说明 |
| --- | --- | --- |
| **`DATABASE_URL`** | `postgres://blog:***@localhost:5433/myblogs` | 唯一数据库连接串；业务表 + pg-boss 队列表共用；docker-compose 映射 5433 |
| `PGPOOL_MAX` | `10` | 每 worker 连接池上限，见 concurrency.md 容量公式 |
| `WEB_CONCURRENCY` | `2` | cluster worker 数（`start:cluster` 专用） |
| `UV_THREADPOOL_SIZE` | `8` | 每 worker libuv 线程池（cluster-server 注入） |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | 监听端口与地址（cluster-server 读取） |
| `WORKER_ID` | （运行时注入） | cluster master 注入的 worker 编号，勿手工设置；`/api/admin/health` 与运维面板展示用（公开 `/api/health` 探针不再返回） |

### SMTP（邮件）

| 变量 | 说明 |
| --- | --- |
| `SMTP_HOST` | 为空则禁用邮件发送（`config.mail.enabled`）；本地开发用 Mailpit `localhost` |
| `SMTP_PORT` | 默认 587；Mailpit 场景 1025 |
| `SMTP_SECURE` | `true` 时走隐式 TLS（465），否则 STARTTLS/明文 |
| `SMTP_USER` / `SMTP_PASS` | 认证凭据 |
| `MAIL_FROM` | 发件人，如 `"MyBlogs <no-reply@example.com>"` |

### OAuth / SSO（均为可选，空 = 不启用；后台 `site.sso.*` 开关另行控制入口展示）

| 变量 | 说明 |
| --- | --- |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth，回调 `<APP_URL>/api/auth/oauth/callback/github` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth，同上 |
| `X_CLIENT_ID` / `X_CLIENT_SECRET` | X(Twitter) OAuth，同上 |
| `DISCOURSE_SSO_URL` / `DISCOURSE_SSO_SECRET` | 以 Discourse 为 SSO Provider（我们是 client） |
| `CF_ACCESS_TEAM` / `CF_ACCESS_AUD` | Cloudflare Access Zero Trust JWT 登录 |

### Queue

| 变量 | 说明 |
| --- | --- |
| `QUEUE_CONCURRENCY` | 预留（当前 batchSize=1）；队列复用 `DATABASE_URL`，无独立配置 |

### Storage（媒体附件）

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `STORAGE_DRIVER` | 可选（默认 `local`） | 新上传的写入驱动：`local`（落 `./storage/media`）/ `r2`（Cloudflare R2 S3 API）。只影响新写入：每行 `media.storage` 记录自己的驱动，读/删按行分派，可随时切换（混存兼容）。`r2` 但配置缺失时 fail-safe 回落 local（站点照常起，打一条 `[storage]` error） |
| `R2_ACCOUNT_ID` | `r2` 必填 | Cloudflare 账号 ID（构成 `https://<accountId>.r2.cloudflarestorage.com` 端点）；永不入日志，报错统一脱敏为 `«account»` |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | `r2` 必填 | R2 API Token 签发的 S3 凭据（仅服务端持有，永不打印） |
| `R2_BUCKET` | `r2` 必填 | 桶名；**桶必须专用**（只放本应用媒体对象，见下） |
| `R2_PUBLIC_BASE_URL` | 可选 | 公开基址（自定义域或 r2.dev，无尾斜杠）。配置即「公开桶」形态：新上传图片 `url` 直连 R2/CDN（对象写入带 `Cache-Control: public, max-age=31536000, immutable`）；不配即「私有桶」，全部经应用路由转发 |

两种部署形态（`media.storage` 按行分派，切换驱动不影响存量行）：

| 形态 | 配置 | 读取路径 | 取舍 |
| --- | --- | --- | --- |
| 公开桶 | r2 四件套 + `R2_PUBLIC_BASE_URL` | 新行直连 R2/CDN（immutable 缓存）；存量 local 行与「配公开域之前的旧 r2 行」仍走 `/api/media/file` 应用转发（`url` 是读时按行解析的，不回填 DB） | 省应用带宽；代价是桶公开可读 |
| 私有桶 | 仅 r2 四件套 | 全部经 `/api/media/file` GetObject 流式转发（不整块进内存） | 桶不暴露；应用扛带宽/并发。路由带键形状守卫（`isMediaObjectKey`，非媒体键形状一律 404）兜底防「桶内混入非媒体对象被应用公开」，但**桶必须专用**仍应作为运维纪律 |

R2 删除失败的兜底：删除走「先删 DB 行、后删对象」；对象删除遇 R2 配置不可用（driver 切走/env 清空）不再静默跳过，而是入队 `storage.delete`（pg-boss）持久重试；队列也不可用时打 `[storage]` error 提示人工清理（含 key）。

已知取舍（`/admin/ops` 的 storage `SUM(size)` 与真实桶用量存在合理偏差）：

- 「配公开域之前」的旧 r2 行仍走应用转发，直连收益只对新行生效；
- `SUM(size)` 只统计 media 行的 WebP 归一后体积：不含 DB 行已删、对象尚在的补偿重试窗口（秒级），不含历史上已丢失 DB 行的孤儿对象，也不含本地 `storage/`（导出 zip 等非媒体产物）；
- R2 侧 multipart 残留/生命周期规则不计入该数字。

## 2. 启动方式

| 命令 | 场景 |
| --- | --- |
| `pnpm dev` | 开发，单进程，HMR；不适合压测 |
| `pnpm build && pnpm start` | 生产单进程（`next start`），小站够用 |
| `pnpm build && pnpm start:cluster` | 生产多进程（推荐），参数见 concurrency.md |
| `pnpm start:cluster:2` | 快速以 2 worker 启动的便捷脚本 |

顺序：`docker compose up -d` → `.env` 就绪 → `pnpm db:migrate` →（首次）`pnpm db:seed` → build → start。

## 3. 数据库迁移流程

```
修改 src/db/schema.ts
  → pnpm db:generate     # drizzle-kit 对比生成版本化 SQL 到 drizzle/
  → 检查 drizzle/*.sql   # 尤其删列/改类型，必要手写 backfill
  → pnpm db:migrate      # tsx src/db/migrate.ts 顺序应用未执行的迁移
```

规范：

- 迁移文件**只增不改**：已提交环境的迁移文件禁止编辑，回滚靠新迁移；
- pg-boss 的 schema（`pgboss.*`）由 pg-boss 自管迁移，不进 drizzle 目录；
- 破坏性迁移前先看第 4 节备份；
- `pnpm db:studio` 可视化检查；`pnpm db:seed` 只用于开发/演示（幂等性以 seed 脚本实现为准）。

## 4. 备份与恢复

备份对象 = PostgreSQL 数据卷 + `storage/` 目录（媒体与导出文件不在库里）。

```bash
# 每日全量（cron 示例，保留 14 天）
docker exec myblogs-postgres pg_dump -U blog -d myblogs -Fc \
  > /backup/myblogs-$(date +%F).dump
find /backup -name 'myblogs-*.dump' -mtime +14 -delete

# storage/ 用 rsync 增量
rsync -a --delete storage/ /backup/myblogs-storage/
```

恢复演练（每季度一次）：

```bash
docker exec -i myblogs-postgres pg_restore -U blog -d myblogs --clean --if-exists < myblogs-2026-09-11.dump
rsync -a /backup/myblogs-storage/ storage/
```

要点：

- `-Fc` 自定义格式支持单表恢复与并行恢复；
- 队列表 `pgboss.job` 会一并备份，恢复后未完成任务自动继续消费（幂等性由各 worker 保证）；
- 生产建议另加 WAL 归档（`archive_mode` + `pgBackRest`/`wal-g`）实现时点恢复，RPO≈0。

## 5. 日志规范

统一 stdout（容器收集友好），前缀约定：

| 前缀 | 来源 | 典型内容 |
| --- | --- | --- |
| `[cluster]` | cluster-server.mjs | fork/重生/排水（`worker 3 pid=123 serving :3000`） |
| `[queue]` / `[queue:<name>]` | core/queue.ts | pg-boss 错误、单任务失败（将重试） |
| `[workers]` | core/workers.ts | 队列 worker 注册完成 |
| `[plugins]` | core/plugins/registry.ts | `booted: mcp@1.0.0` / 启动失败 |
| `[moderation]` | lib/moderation.ts | LLM 审核失败 |
| `[storage]` | lib/storage | 驱动回落 error、删除容忍 warn、R2 清理补偿入队失败 error |
| `[db]` | src/db/index.ts | 连接池错误（空闲连接被断开等） |
| `[instrumentation]` | instrumentation.ts | 引导失败（插件/worker 启动异常） |

约定：错误必带上下文 id（postId/webhookId/jobId）；禁止打印 token/密码/邮箱全文；启动日志可作为容器 readiness 的辅助信号（`serving :PORT` + `[workers] queue workers registered`）。

## 6. 监控建议

**探针**

- `GET /api/health` → `{status:"ok"\|"degraded"}`（HTTP 200/503）：LB/uptime 无鉴权探活，公开响应已收敛为最小形态（不泄露版本/进程/驱动信息）；
- `GET /api/admin/health`（admin.ops 鉴权）→ `{ok, version, worker, pid, uptimeSec, limiter, storage, ts}`：完整健康快照 + worker 轮转观测（压测脚本 `--show-workers`，需 `MB_ADMIN_COOKIE` 环境变量携带 admin 会话 Cookie）；
- 登录态管理页 `/admin/ops`：进程（RSS/heap/uptime）、DB 核心表行数、`pgboss.job` 按 queue×state 深度、内容健康、storage 体积，只读无轮询。

**告警阈值建议**

| 指标 | 黄 | 红 |
| --- | --- | --- |
| 队列待处理（created+retry，`pgboss.job`） | > 10 | > 50 |
| 队列 failed/cancelled | > 0 | > 20 |
| `/api/health` 探针失败 | 1 次 | 连续 3 次（剥流量） |
| worker RSS | > 768MB | > 1.5GB（配合重启策略） |
| PG 活跃连接 | > 公式上限 80% | > 95% |

队列深度查询（告警脚本可直接用）：

```sql
select name, state, count(*) from pgboss.job
where state in ('created','retry','active','failed')
group by 1, 2 order by 1;
```

黄色=观察（可能只是突发流量）；红色=动作：检查 worker 存活 → 看失败任务 `output/dead_letter` → 按需扩 `WEB_CONCURRENCY`（守容量公式）。

## 7. 常见问题

**端口占用 `EADDRINUSE`**
`lsof -ti :3000`（或 `:3001`）找到占用进程；开发态常见是上一个 `next dev` 未退。换端口：`PORT=3100 pnpm start:cluster`（同时改 `APP_URL`）。

**收不到邮件**
本地开发用 Mailpit：`docker compose up -d mailpit`，`.env` 设 `SMTP_HOST=localhost SMTP_PORT=1025`，收件箱在 http://localhost:8025。生产排查顺序：`SMTP_HOST` 是否为空（空=禁用）→ 队列 `mail.send` 是否积压（/admin/ops）→ 任务失败日志 `[queue:mail.send]`。

**子域名模式本地测试**
`ROOT_DOMAIN=localhost` + 后台开启 `site.subdomains`；浏览器访问 `alice.lvh.me:3000`（lvh.me 解析到 127.0.0.1），或 hosts 加 `127.0.0.1 alice.localhost` 后访问 `alice.localhost:3000`。生产需 LB/反代把 `*.ROOT_DOMAIN` 指到本服务，并把 `APP_URL`、cookie domain 配置对齐。

**2FA 卡住无法登录后台**
`site.force2fa` 默认开启：登录后必须完成 TOTP 绑定/挑战。丢码用恢复码；管理员可在后台用户管理关闭单用户 2FA 或重置。

**队列积压但日志无错误**
多为 worker 未启动（`[workers] queue workers registered` 缺失）或 PG 连接池耗尽（`[db] pool error`）。先用 /admin/ops 确认队列分组深度，再查 concurrency.md 公式。

**压测数据异常**
确认压的是 build 产物（`start:cluster`）而非 dev；`mixed` 模式依赖种子数据（用户 alice、文章 slug `token`），未 seed 时这两类请求会 404，属预期失败归类。
