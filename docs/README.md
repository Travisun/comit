# comit.sh 文档中心

> 最后更新：2026-09-21

介于个人博客与社区之间的多用户写作平台（品牌名 comit.sh，品牌手册见 [brand.md](./brand.md)）。技术栈：Next.js 16（App Router）+ React 19 + TypeScript strict + Tailwind v4 + Drizzle/PostgreSQL + pg-boss。

## 目录

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| [brand.md](./brand.md) | 品牌手册：comit.sh 命名与四处语源叙事、语调规范、文案 do/don't、色彩 #f6821f 与排版引用关系 | ✅ |
| [positioning.md](./positioning.md) | 定位策划案：竞争格局与占位、平台故事三幕、四类人群、社区文化五条、氛围设定、文案示例库与落地清单 | ✅ |
| [architecture.md](./architecture.md) | 总体架构：分层、请求生命周期、领域事件、插件扩展点、目录结构 | ✅ |
| [concurrency.md](./concurrency.md) | 并发与扩容设计：cluster 模型、关键参数公式、压测方法 | ✅ |
| [operations.md](./operations.md) | 部署与运维：环境变量全表、迁移、备份、日志、监控、FAQ | ✅ |
| [schema.md](./schema.md) | 数据模型：核心表 ER、约束与索引、jsonb 字段形状、迁移规范 | ✅ |
| [api.md](./api.md) | REST API 全表、认证方式（Cookie / Bearer mbt_）、MCP 工具清单 | ✅ |
| [product-features.md](./product-features.md) | 产品功能总览：双模式首页、社交、私信、审核、导出、MCP…… | ✅ |
| [roadmap.md](./roadmap.md) | 演进路线：付费会员、Redis、对象存储、WebSocket……（基于现有钩子） | ✅ |
| [theme-system.md](./theme-system.md) | 主题系统专题（主题包注册、options/customCss 增量覆盖） | ✅ |
| [roles-permissions.md](./roles-permissions.md) | 角色与认证专题（RBAC、会话、TOTP、OAuth/SSO） | ✅ |
| [admin-guide.md](./admin-guide.md) | 后台管理手册（审核台、用户管理、站点设置） | ✅ |
| [notifications.md](./notifications.md) | 通知系统专题（多频道、偏好、队列投递） | ✅ |
| [content-labels.md](./content-labels.md) | 内容标注专题（original/ai_assisted/repost/opinion） | ✅ |
| [frontend-architecture.md](./frontend-architecture.md) | 前端架构：RSC/客户端边界、数据流与状态模型 | ✅ |
| [design-system.md](./design-system.md) | 控制台设计规范（白纸 + 发丝线 + 留白，对齐 Stripe Dashboard） | ✅ |
| [extensions.md](./extensions.md) | 扩展开发指南：插件引导、生命周期与注册点 | ✅ |
| [deploy-baota.md](./deploy-baota.md) | 宝塔面板部署：nginx 反代 + 宿主机已有 PostgreSQL/Redis | ✅ |
| [runbook-dev-cache.md](./runbook-dev-cache.md) | Runbook：dev 依赖实例与编译缓存竞态故障（module factory） | ✅ |
| [acceptance.md](./acceptance.md) | 平台能力面验收审计报告（服务端 + 客户端 + 扩展体系） | ✅ |
| [notifications-blueprint.md](./notifications-blueprint.md) | 通知与激励体系蓝图（站内已落地；邮件分层/摘要为规划） | 🚧 规划 |

> 除 `notifications-blueprint.md` 末段属规划外，其余文档均与当前实现对齐。

## 快速开始（摘要）

```bash
docker compose up -d          # PostgreSQL(:5433) + Mailpit(:8025 收信 UI)
pnpm install
cp .env.example .env          # 按需修改，逐项说明见 docs/operations.md
pnpm db:migrate               # drizzle-kit 生成 + 应用 SQL 迁移
SEED_ADMIN_PASSWORD=devpass123 pnpm db:seed        # 管理员（口令见左/环境变量）
SEED_ADMIN_PASSWORD=devpass123 pnpm db:seed --demo # 追加演示用户与内容
pnpm dev                      # 开发模式 http://localhost:3000
```

生产/压测启动（cluster 多进程）：

```bash
pnpm build
WEB_CONCURRENCY=4 PGPOOL_MAX=10 pnpm start:cluster   # 默认端口 3000，可用 PORT 覆盖
node scripts/load-test.mjs http://localhost:3001 30 20 mixed   # 内置压测，见 docs/concurrency.md
```

- 管理员：`admin@myblogs.local`，口令取自 `SEED_ADMIN_PASSWORD`（或 `ADMIN_PASSWORD`）环境变量；交互式开发未提供时随机生成一次性口令并打印在 seed 输出中（首次登录强制绑定 TOTP）
- 运维面板：登录 admin 后访问 `/admin/ops`（进程/数据库/队列/内容健康只读快照）
- 健康探针：`GET /api/health` → `{status: "ok" | "degraded"}`（HTTP 200/503，供 LB/uptime 无鉴权探活；细节收敛）
- 健康快照：`GET /api/admin/health`（admin.ops 鉴权）→ `{ok, version, worker, pid, uptimeSec, limiter, storage, ts}`

## 架构一图

```
                         ┌────────────────────────────────────────────────┐
                         │            node scripts/cluster-server.mjs      │
                         │  master：fork/看护 worker，SIGTERM 优雅排水      │
                         └───────┬───────────────┬───────────────┬─────────┘
                        fork     │               │               │
                    ┌────────────▼───┐ ┌─────────▼──────┐ ┌──────▼─────────┐
   HTTP 请求 ──────▶│ worker 1       │ │ worker 2       │ │ worker N       │
   (keep-alive 65s) │ Next.js SSR    │ │ Next.js SSR    │ │ Next.js SSR    │
                    │ + pg-boss 消费 │ │ + pg-boss 消费 │ │ + pg-boss 消费 │
                    │ PGPOOL_MAX=10  │ │                │ │                │
                    └───────┬────────┘ └───────┬────────┘ └──────┬─────────┘
                            │  drizzle（竞争连接池）│               │
                         ┌──▼───────────────────▼───────────────▼──┐
                         │        PostgreSQL (:5433)                │
                         │  业务表 + pgboss.job 队列表（竞争消费）   │
                         │  mail.send / webhook.deliver /           │
                         │  moderation.review / export.build        │
                         └──────────────────────────────────────────┘
                            ▲                    ▲
                    storage/media（sharp→WebP）  SMTP(Mailpit)/Webhook 回源

  进程内骨架（每 worker 一份）：core/events(Emittery) + core/hooks(hookable)
  + core/plugins(通知频道/MCP工具/组件/管理区块) + themes(主题包) + lib(领域服务)
```

各层职责与扩展点见 [architecture.md](./architecture.md)；容量参数与扩容路径见 [concurrency.md](./concurrency.md)。
