# 演进路线（Roadmap）

> 最后更新：2026-09-11

原则：**基于代码中已预留的钩子排期，务实不空谈**。每项标注：现状锚点 → 第一步改动 → 验收信号。

## 目录

- [1. 付费会员（tiers）](#1-付费会员tiers)
- [2. Redis 限流与缓存](#2-redis-限流与缓存)
- [3. 对象存储（S3/R2）媒体后端](#3-对象存储s3r2媒体后端)
- [4. 全文检索增强](#4-全文检索增强)
- [5. WebSocket 实时通知](#5-websocket-实时通知)
- [6. 移动端 PWA](#6-移动端-pwa)
- [7. i18n 扩展](#7-i18n-扩展)
- [8. 插件市场设想](#8-插件市场设想)

## 1. 付费会员（tiers）

- **现状锚点**：`users.tier`（int，默认 1=VIP1）已在 schema 落地并注释「upgrade hooks live in src/lib/tiers.ts」——`src/lib/tiers.ts` 尚未创建，这正是预留的接入缝。
- **第一步**：新建 `src/lib/tiers.ts`（`getTierLimits(tier): { mediaQuota, subdomain, themes, dmQuota }` + `assertTier(userId, feature)`），在媒体上传配额、主题包解锁、子域名功能处挂钩；购买侧先接「兑换码」人工通道，再接 Stripe Checkout（webhook 事件 → `tier` 更新 + 领域事件 `user:tier.changed`）。
- **验收**：限额在 `/api/media/upload` 生效；tier 变更走事件（通知/Webhook 可订阅）；/admin/users 可手工调级。

## 2. Redis 限流与缓存

- **现状锚点**：`src/lib/rate-limit.ts` 明确注释「swap for Redis when scaling horizontally」，接口签名 `rateLimit(key, limit, windowMs)` 稳定；多 worker 下阈值线性放大（docs/concurrency.md 第 5 节）。
- **第一步**：实现 `redis-rate-limit.ts`（INCR+EXPIRE 固定窗口起步，敏感端点用 Lua 令牌桶），按 env `REDIS_URL` 自动启用、故障回退进程内；第二步给热点读（首页信息流、settings、explore）加旁路缓存，复用领域事件做失效（`post:published` 等 → DEL key）。
- **验收**：压测（scripts/load-test.mjs）下多 worker 限流阈值精确一致；缓存命中后 mixed P95 下降 ≥30%。

## 3. 对象存储（S3/R2）媒体后端

- **现状锚点**：媒体读写已收敛到 `src/lib/media.ts`：`STORAGE_ROOT`、`mediaAbsPath()`、`deleteMediaFile()` 三个缝；`media.path` 是相对路径；输出统一走 `/api/media/file/[...path]`。
- **第一步**：抽 `MediaBackend` 接口（local / s3 两实现），上传改为流式转 WebP 后 `PutObject`；读取按 `S3_PUBLIC_URL` 直连或预签名 URL（私有桶）；迁移脚本双写 + 回填。
- **验收**：`BACKEND=s3` 下上传/删除/导出打包全通；本地后端回归不变；/admin/ops 存储卡在对象存储模式下展示桶用量（或明确标注 N/A）。

## 4. 全文检索增强

- **现状锚点**：`posts_search_idx`（GIN + `to_tsvector('simple', …)`）已存在，MCP `search_posts` 与站内搜索已跑通。
- **第一步**：中文分词——`simple` 对中文不切词，先上 `pg_jieba`/`zhparser` 扩展（docker 镜像内启用），迁移重建索引为 `to_tsvector('chinese_zh', …)`；检索 ranking 用 `ts_rank` + publishedAt 权重。数据量级破百万再评估外部引擎（Meilisearch/ES），避免过早引入第二存储。
- **验收**：中文查询召回明显改善；search_posts 压测 P95 < 100ms。

## 5. WebSocket 实时通知

- **现状锚点**：通知已事件驱动（Emittery + notifications 表 + 队列），前端是轮询/刷新；cluster 多进程意味着「进程内 bus 无法触达其他 worker 上的长连接」。
- **第一步**：standalone WS 网关（独立进程，`ws` 库）订阅 PostgreSQL `LISTEN pgboss.job`-风格通道或直接 `LISTEN notifications`（触发器 NOTIFY），按 userId 鉴权（复用会话表）后推新通知计数；Next 侧仅发 `publish`。
- **验收**：双 worker 部署下 A 发评论，B 页面 <1s 收到红点；断线重连后以 `GET /api/notifications` 对账。

## 6. 移动端 PWA

- **现状锚点**：全站响应式（admin 导航移动端横滑条已适配）；媒体已全量 WebP；API 无状态。
- **第一步**：`next-pwa` 或手写 SW：app shell 预缓存 + 阅读页 stale-while-revalidate；`manifest.json` + 安装引导；离线只读（文章缓存）。
- **验收**：Lighthouse PWA 项达标；弱网下二次打开 <1s 可读。

## 7. i18n 扩展

- **现状锚点**：双语基建已全量就位：`users.locale`、`lib/i18n`（zh/en 字典 + `useI18n`）、邮件双语模板、LocalizedText（zh/en 成对出现在插件扩展点类型中）。
- **第一步**：补第三语言只需三步——新增字典文件、`LOCALES` 注册、翻译邮件模板；内容侧多语言超出范围（每篇帖子单语言），可探索按字段 `titleI18n` jsonb 的可选方案。
- **验收**：切 locale 后管理后台与事务邮件无中文残留。

## 8. 插件市场设想

- **现状锚点**：插件契约（`core/plugins/types.ts`）+ globalThis 注册表 + `bootPlugins()` 惰性加载已验证扩展缝；主题包 `registerTheme` 同构。
- **第一步**：本地插件目录约定（`plugins.local/<name>/{index.ts,manifest.json}`，manifest 声明权限：事件订阅面/注册点/所需 scope），registry 启动时扫描加载；管理后台「插件」页只读列表（名称/版本/权限面）。**不做**远程动态加载（供应链风险），分发以 npm 包 + 显式安装为主。
- **验收**：示例插件（如「评论命令行彩蛋」）不改 core 代码即接入；卸载 = 移目录。

## 排期建议

| 季度 | 主题 |
| --- | --- |
| 近期 | 1 tiers 兑换码通道 · 2 Redis 限流 · 7 i18n 补齐 |
| 中期 | 3 对象存储 · 4 中文检索 · 6 PWA |
| 远期 | 5 WS 网关 · 8 插件目录 + 市场 |

每项合并后同步更新本文件状态与 [architecture.md](./architecture.md) 的相关小节。
