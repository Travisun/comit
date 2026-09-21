# 并发与扩容设计

> 最后更新：2026-09-11

## 目录

- [1. Cluster 模型](#1-cluster-模型)
- [2. 关键参数表与容量公式](#2-关键参数表与容量公式)
- [3. Keep-alive 与超时调优](#3-keep-alive-与超时调优)
- [4. 优雅停机](#4-优雅停机)
- [5. 限流现状与升级路径](#5-限流现状与升级路径)
- [6. 压测方法与建议基准](#6-压测方法与建议基准)
- [7. 扩容路径](#7-扩容路径)

## 1. Cluster 模型

`scripts/cluster-server.mjs` 在单个 Node 进程树上组织多 worker：

```
master（不入流量路径）
 │  fork × WEB_CONCURRENCY，每个 worker 注入 WORKER_ID / UV_THREADPOOL_SIZE
 ├─ worker 1 ── Next.js SSR http server (共享监听 socket，内核级 accept 分发)
 │           └─ pg-boss client(池 max=5) ── 竞争消费 pgboss.job
 ├─ worker 2 ── 同上
 └─ worker N ── 同上
        全部 worker ── 各自独立 pg 连接池（PGPOOL_MAX，默认 10）──▶ PostgreSQL
```

- **共享监听 socket**：cluster 模块让所有 worker accept 同一端口，操作系统负责分发，天然轮转；
- **队列竞争消费**：pg-boss 用 `SELECT … FOR UPDATE SKIP LOCKED` 语义取任务，N 个 worker = N 个竞争消费者，吞吐随 worker 数近线性；
- **无共享内存**：事件总线、插件注册表、限流桶都是每进程一份；跨进程协作只靠数据库（会话表、队列表）。这也意味着**限流阈值是 per-worker 的**（见第 5 节）；
- **worker 崩溃自愈**：master 监听 `exit` 事件自动重生（WORKER_ID 取模复用）；正在执行的队列任务因 pg-boss 的租约/重试机制被其他 worker 接管。

## 2. 关键参数表与容量公式

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `WEB_CONCURRENCY` | `min(4, cores-1)` | worker 进程数。SSR 是 CPU 密集型，一般 ≤ 物理核数；队列消费也随之扩展 |
| `UV_THREADPOOL_SIZE` | 8（每 worker） | libuv 线程池，fs/crypto/shark 之外的重 IO 路径受益；sharp 用自建线程池不受此影响 |
| `PGPOOL_MAX` | 10（每 worker） | Drizzle/pg 连接池上限（`src/db/index.ts`） |
| pg-boss 内部池 | 5（每 worker，固定） | `core/queue.ts` 中 `new PgBoss({ max: 5 })` |
| `QUEUE_CONCURRENCY` | 3（预留） | 目前 worker 以 batchSize=1 消费；该值保留在 config 供后续并发消费使用 |
| Postgres `max_connections` | 100（PG 默认） | 上限来源 |

**容量公式（必须满足）**：

```
WEB_CONCURRENCY × (PGPOOL_MAX + 5)  <  max_connections × 0.8
        例：4 × (10 + 5) = 60 < 80 ✓
```

留 20% 余量给迁移、psql 人工操作和 pg-boss 维护查询。若需要更多 worker，优先降 PGPOOL_MAX（SSR 读多写少，10 已宽裕）或提高 `max_connections`（每连接 ~5-10MB PG 内存）。

**推荐配置**：

| 场景 | WEB_CONCURRENCY | PGPOOL_MAX |
| --- | --- | --- |
| 4 核小机器 | 3 | 10 |
| 8 标准核 | 4–6 | 10 |
| 压测/突发 | 6–8 | 8（防池总和超限） |

## 3. Keep-alive 与超时调优

`cluster-server.mjs` 中每 worker 的 http server：

| 参数 | 值 | 理由 |
| --- | --- | --- |
| `keepAliveTimeout` | 65s | 高于常见 LB/CDN 空闲超时（ALB 60s、Nginx 默认 75s 需对齐），避免 LB 复用已被服务端关闭的连接导致 502 |
| `headersTimeout` | 66s | 略大于 keep-alive，防 keep-alive 竞态 |
| `requestTimeout` | 120s | 单请求总预算（上传大图 + LLM 审核回环的兜底） |

前置反代的经验法则：**反代 `proxy_read_timeout` > 应用 `requestTimeout`**；反代到 Node 之间保持 HTTP/1.1 + keep-alive，否则每次请求都要重建 TCP/TLS。

## 4. 优雅停机

```
SIGTERM → master：disconnect 所有 worker（停止派发新请求），10s 后强退
        → worker：server.close() 等待在途请求完成，8s 强退兜底
```

队列侧不需要额外排水：pg-boss 任务有租约与重试（retryLimit=3、指数退避），worker 被杀后任务自动回到 `retry` 状态被其他 worker 取走。发布流程建议：`SIGTERM` → 等 worker 全退 → 起新版本 → master 退出由进程管理器（systemd/docker/pm2）重启。

## 5. 限流现状与升级路径

现状（`src/lib/rate-limit.ts`）：**进程内固定窗口计数器**（Map + 周期清理，上限 1 万 key）。含义：

- 多 worker 部署时每个 worker 独立计数，实际阈值 = 单 worker 阈值 × WEB_CONCURRENCY；
- 对「防爆破登录」这类安全限流，等效阈值被放大 N 倍，需按公式预缩配额：`limit_per_worker = 目标limit / WEB_CONCURRENCY`。

升级路径（当出现多机或需要精确全局限流时）：

1. **Redis 固定/滑动窗口**：`INCR key + EXPIRE`（固定窗口）或 `INCR`+`ZREMRANGEBYSCORE`（滑动窗口）；接口签名保持 `rateLimit(key, limit, windowMs)` 不变，实现替换为 Redis 调用 + 本地短 TTL 缓存兜底；
2. **Redis 令牌桶**（平滑突发）：Lua 脚本原子扣减，`refillRate/burst` 两参数；登录、注册、邮件类端点用更紧的桶；
3. 失败降级：Redis 不可用时回退进程内计数（可用性优先）。

## 6. 压测方法与建议基准

零依赖压测脚本（Node 24 内置 fetch，keep-alive 复用）：

```bash
# 常规压测：30s、20 并发、mixed 流量模型
node scripts/load-test.mjs http://localhost:3001 30 20 mixed

# 只打首页（RSC 渲染路径天花板）
node scripts/load-test.mjs http://localhost:3001 30 50 read

# 纯健康检查（进程/网络层吞吐，不含 DB）
node scripts/load-test.mjs http://localhost:3001 10 20 health

# 验证 cluster 轮转：另开终端，每秒打印响应的 worker 字段
node scripts/load-test.mjs --show-workers http://localhost:3001
```

流量模型 `mixed`：60% 首页 / 20% 全站 RSS / 10% 用户主页 / 10% 文章详情页（种子用户 alice 的已发布文章 `token`）。输出总请求、成功率、RPS、avg/P50/P95/P99、状态码分布与失败归类；每 5s 打印进度行；SIGINT 打印部分统计。

**建议基准（8 标准核 / 4 worker / 本地 PG，量级参考而非 SLA）**：

| 指标 | 及格 | 良好 |
| --- | --- | --- |
| mixed RPS | > 150 | > 400 |
| P95（mixed） | < 300ms | < 120ms |
| read 模式 RPS | > 250 | > 600 |
| 失败率 | 0 | 0 |
| P99 抖动 | 无 >2s 长尾 | — |

压测时的检查清单：`watch curl -s :3000/api/health`（探活 200/503；worker 轮转观测看 `--show-workers`，其走鉴权端点 `/api/admin/health`）、`/admin/ops` 队列深度（>10 黄/>50 红）、PG `pg_stat_activity` 连接数是否逼近公式上限、worker 进程 CPU 是否打满（打满则增 WEB_CONCURRENCY，PG 打满则先优化再扩容）。

## 7. 扩容路径

按瓶颈顺序演进，不要跳级：

1. **纵向 + 多 worker**（现状支持）：加核 → 提高 `WEB_CONCURRENCY`，遵守第 2 节公式；
2. **多机 + LB**：无状态 SSR 可直接水平复制；需要：LB keep-alive 对齐（第 3 节）、`/api/health` 作为健康检查、ADMIN/限流阈值重新评估（限流升级为 Redis，见第 5 节）。PG 单实例仍共享；
3. **读写分离**：Drizzle 侧引入只读副本（`DATABASE_URL_RO` + 读路径走副本）；注意会话读在登录瞬间要求主库一致性；
4. **Redis 缓存层**：热点聚合（首页信息流、explore、settings 表）加旁路缓存 + 事件失效（复用领域事件做 invalidation）；
5. **对象存储（S3/R2）**：`storage/media` 上移。当前 `media.path` 是相对路径且统一经 `/api/media/file/[...path]` 输出——把 `mediaAbsPath` 换成签名 URL 生成即可，业务代码零改动；
6. **队列外移**：pg-boss 依赖 PG，PG 成为瓶颈时可评估外移（但与事务性入队冲突，通常先用 1–5 步）。

回环提醒：每一步扩容后重跑第 6 节压测，记录 RPS/P95 基线，防止「扩了但没快」。
