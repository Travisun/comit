# 服务器部署指南（宝塔面板 + 已有 PostgreSQL/Redis）

目标拓扑：**宝塔 nginx（SSL/反代） → Docker 化应用（127.0.0.1:3000） → 宿主机已有 PostgreSQL / Redis（127.0.0.1）**。

数据库与 Redis 不容器化，直接复用服务器已有实例；应用本体用 [docker-compose.server.yml](../docker-compose.server.yml) 部署（`network_mode: host` + migrate one-shot）。

---

## 0. 前置检查（服务器上执行一次）

```bash
docker --version          # ≥ 20.10（host 网络与 compose v2）
docker compose version
psql -U postgres -c "select version();"   # 确认 PG 可用与版本
redis-cli ping            # PONG（有密码则 redis-cli -a '密码' ping）
```

## 1. 准备数据库与 Redis

**PostgreSQL — 建专库专号**（不要复用超级用户）：

```sql
CREATE USER myblogs WITH PASSWORD '强密码';
CREATE DATABASE myblogs OWNER myblogs;
-- pg-boss 会在库内自建 pgboss schema，属主即可，无需额外授权
```

> 宝塔装的 PG 通常只监听 `127.0.0.1`。本方案用 host 网络模式，容器直连 `127.0.0.1`，**无需改 `listen_addresses` / `pg_hba.conf`**。若你坚持用 bridge 网络（不推荐本场景），才需要把监听放开到 docker 子网并加 `host all all 172.17.0.0/16 md5`。

**Redis**：已有实例直接用。若有密码，`REDIS_URL` 写 `redis://:密码@127.0.0.1:6379/0`。Redis 仅作限流一级驱动，挂了应用自动降级到 PG/内存桶，不阻塞业务。

## 2. 拉代码 + 配置

```bash
cd /www/wwwroot            # 或你的代码目录
git clone <repo> myblogs && cd myblogs
cp .env.server.example .env
vim .env                   # 填 APP_URL / DATABASE_URL / REDIS_URL / AUTH_SECRET
openssl rand -base64 48    # 生成 AUTH_SECRET
```

`.env` 权限收紧：`chmod 600 .env`。

## 3. 构建与启动

```bash
docker compose -f docker-compose.server.yml build
docker compose -f docker-compose.server.yml up -d
docker compose -f docker-compose.server.yml ps        # migrate 应 exited (0)
curl -fsS http://127.0.0.1:3000/api/health            # {"ok":true,...}
```

首次部署（可选）初始化种子数据（管理员/站点内容演示，见 `src/db/seed.ts`）：

```bash
docker compose -f docker-compose.server.yml run --rm migrate pnpm db:seed
```

## 4. 宝塔 nginx 反向代理

面板 → 网站 → 添加站点（域名）→ SSL 证书签发（Let's Encrypt）→ 反向代理，或直接在站点配置文件写入：

```nginx
# 站点 server{} 内
client_max_body_size 20m;   # 应用上传上限 10MB，留余量

location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;            # TRUST_PROXY=nginx 依赖
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
    proxy_buffering off;                                 # SSE 实时流（/api/realtime/stream）必需
    proxy_cache off;
}

# 更精细：只对 SSE 关缓冲（与上面的全局二选一）
# location /api/realtime/ {
#     proxy_pass http://127.0.0.1:3000;
#     proxy_http_version 1.1;
#     proxy_set_header Connection "";
#     proxy_buffering off;
#     proxy_read_timeout 3600s;
# }
```

要点：

- **`X-Real-IP` 必传**：应用 `TRUST_PROXY=nginx` 按它解析真实 IP，登录限流/审计都靠它；
- **`proxy_buffering off`**：站内实时通知走 SSE，缓冲会让消息成批延迟到达；
- **`client_max_body_size`**：小于应用上传上限会导致大图上传 413；
- 反代后访问站点确认登录、发帖、图片上传、实时通知四处正常。

## 5. 日常更新（发布新版本）

```bash
cd /www/wwwroot/comit
git pull
docker compose -f docker-compose.server.yml build
# 显式跑迁移（幂等），再滚动重启应用
docker compose -f docker-compose.server.yml run --rm migrate
docker compose -f docker-compose.server.yml up -d app
curl -fsS http://127.0.0.1:3000/api/health
```

回滚：`git checkout <上一个tag/commit>` 后重复上述步骤（迁移仅向前，回滚代码前先确认无破坏性迁移）。

## 6. 数据持久化与备份

- `uploads`（用户图片）/ `exports`（导出包）为命名卷：`docker volume ls` 查看；
- 定期备份（宝塔计划任务）：
  ```bash
  # 数据库
  pg_dump -U myblogs myblogs | gzip > /www/backup/myblogs-$(date +%F).sql.gz
  # 上传文件卷
  docker run --rm -v myblogs_uploads:/data -v /www/backup:/backup alpine \
    tar czf /backup/uploads-$(date +%F).tar.gz -C /data .
  ```

## 7. 常见问题

| 现象 | 原因/处理 |
| --- | --- |
| 容器连不上 PG（ECONNREFUSED） | 没用 host 网络模式，或 PG 只监听 socket；确认 `network_mode: host` 且 `DATABASE_URL=...@127.0.0.1:5432/...` |
| 登录后限流频繁触发 / 审计 IP 全是 127.0.0.1 | nginx 未传 `X-Real-IP`，或 `TRUST_PROXY` 不是 `nginx`（启动日志有自检警告） |
| 实时通知延迟成批到达 | nginx 开了 proxy_buffering，见第 4 步 |
| 上传大图 413 | `client_max_body_size` 太小 |
| 启动即崩：`AUTH_SECRET must be set` | `.env` 缺 AUTH_SECRET 或短于 32 字符 |
| 后台改站点名不生效 | settings 有 10s 进程内缓存；多进程/多实例 ≤10s 收敛，无需重启 |

## 8. 安全清单（上线前过一遍）

- [ ] `.env` 600 权限，AUTH_SECRET 为 48 字节随机值
- [ ] PG 账号仅授权 myblogs 库；Redis 设置了 requirepass（若公网可跨界访问）
- [ ] app 只绑定 `127.0.0.1`（compose 内已固定 `-H 127.0.0.1`），公网无直连 3000 端口
- [ ] 宝塔 SSL 开启且强制 https（APP_URL 用 https，自动下发 HSTS）
- [ ] 防火墙：仅需放行 80/443/SSH；5432/6379 不得对公网开放
- [ ] 注册一台管理员账号后，按需关闭开放注册（后台「功能开关」）
