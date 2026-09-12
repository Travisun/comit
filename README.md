# comit.sh — Commit your ideas.

> 提交，是技术世界最古老的仪式——从 1956 年 MIT 主机上的 COMIT 语言，到你指尖的每一次 `git commit`。comit.sh 把这个仪式，变成你的个人主页。

comit.sh 是为技术极客、设计师、科学家与领域学子打造的个人主页社交网络：记录科研日志、技术学习过程、研究发布与项目动态。简历风味浓厚的学术与技术交流聚集地，拥抱 AI 的下一代个人品牌内容发布与运营平台。

**命名语源**：COMIT（1956, MIT，最早的字符串处理语言之一）× `git commit`（每个工程师的日常动作）× COMIT Network（Web3 开源跨链路由协议）× Datacom COMIT（大型机 Datacom 数据库的事务提交命令）——四个时代的「提交」，一个域名。线上品牌故事见 `/about`，品牌手册见 [docs/brand.md](docs/brand.md)。

![comit.sh 首页截图（占位）](docs/assets/screenshot-home.png)
> 截图占位：补充首页社区时间线与个人主页两张截图（浅色 + 深色），建议存放于 `docs/assets/`。

多用户写作与社交平台：深度 Markdown 排版、公式/图表渲染、独立子域名、RSS 分发、强制 2FA、LLM 内容审核、MCP 开放接口、插件化博客主题系统、角色与认证体系。

> 系统设计与持续演进的完整文档见 [docs/](docs/README.md)（品牌 / 架构 / 并发 / 主题 / 权限 / 通知 / 运维 / API / 路线图）。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 框架 | Next.js 16（App Router, RSC）+ React 19 + TypeScript strict |
| UI | Tailwind CSS v4（CSS 变量主题 Token）+ shadcn/ui 风格组件（Radix primitives） |
| ORM | Drizzle ORM + PostgreSQL（`drizzle-kit` 版本化 SQL 迁移） |
| 认证 | 自研会话（DB session + httpOnly cookie）+ otplib TOTP（强制 2FA）+ Arctic OAuth + Discourse SSO + Cloudflare Access |
| 邮件 | Nodemailer SMTP + 双语 HTML 模板 |
| 队列 | pg-boss（PostgreSQL 作业队列：邮件/Webhook 投递/审核/导出） |
| 内容管道 | unified（remark/rehype）+ GFM + KaTeX + Shiki + Mermaid + rehype-sanitize |
| 图片 | sharp → 全格式转 WebP（头像 512²、封面 1920w、正文 2000w） |
| 事件 | Emittery 类型化事件总线 + hookable 钩子 |
| MCP | @modelcontextprotocol/sdk（`/api/mcp`，Bearer token） |

## 架构（Laravel 风格的可扩展设计）

```
src/
├── core/                    # 框架层（"framework"）
│   ├── container.ts         # 服务容器 / 门面（app.db / app.events / app.queue ...）
│   ├── config.ts            # 配置仓库（env）
│   ├── events.ts            # 类型化领域事件总线（AppEventPayloads）
│   ├── hooks.ts             # 全局钩子（action/filter，基于 hookable）
│   ├── queue.ts             # 队列门面（pg-boss）+ 类型化作业
│   ├── routes.ts            # 命名路由注册表
│   ├── errors.ts            # 应用异常 + HTTP 映射
│   ├── workers.ts           # 队列 worker 注册（instrumentation 启动）
│   └── plugins/
│       ├── types.ts         # 插件/扩展点契约（频道、MCP 工具、组件…）
│       └── registry.ts      # 插件管理器
├── plugins/                 # 内置功能全部以插件形式实现（验证扩展点）
│   ├── notifications.ts     # 多频道通知（database / mail / webhook，可扩展）
│   ├── webhooks.ts          # 用户事件订阅 + HMAC 签名投递
│   ├── moderation.ts        # 关键词黑名单 + LLM 审核流水线
│   ├── mcp.ts               # MCP 工具集（文章/媒体/信息流…）
│   └── export.ts            # Markdown+媒体 ZIP 全量导出
├── db/                      # Drizzle schema / 迁移入口 / 种子
├── lib/                     # 领域服务（auth / media / markdown / moderation / settings / i18n / seo …）
├── components/              # UI（shadcn 风格 + 业务组件）
├── app/                     # 路由（页面 + API）
└── middleware.ts            # 子域名 rewrite + 安全头
```

**扩展点**：插件可注册通知频道、MCP 工具、侧边栏组件、管理面板区块、渲染钩子（`post:render`）、队列作业。领域事件（`post:published`、`comment:created`…）是所有副作用（通知/Webhook/审核）的唯一触发源。

## 快速开始

```bash
docker compose up -d          # PostgreSQL(:5433) + Mailpit(:8025 收信 UI)
pnpm install
cp .env.example .env          # 按需修改
pnpm db:migrate               # 应用迁移
pnpm db:seed                  # 管理员 + 演示数据
pnpm dev                      # http://localhost:3000
```

- 管理员：`admin@myblogs.local / Admin123456`（登录后按引导强制绑定 TOTP）
- 开发邮箱在 Mailpit：http://localhost:8025
- 子域名模式本地测试：`lvh.me:3000` / `alice.lvh.me:3000`（或在 hosts 里加 `*.localhost`）

## 生产启动（高并发）

```bash
pnpm build
WEB_CONCURRENCY=4 PGPOOL_MAX=10 pnpm start:cluster
# master 进程按核数 fork worker（默认 min(4, cores-1)），每个 worker 独立
# Next SSR + pg-boss worker（队列竞争消费）；SIGTERM 优雅排水。
# 细节与扩容路径见 docs/concurrency.md，运维面板见 /admin/ops。
```

## 常用脚本

```bash
pnpm db:generate   # schema 变更 → 生成迁移
pnpm db:migrate    # 应用迁移
pnpm db:seed       # 种子数据（幂等）
pnpm db:studio     # Drizzle Studio
pnpm build && pnpm start
```

## 关键产品能力

- 多用户/单用户双模式（后台切换，单用户模式下首页即博主主页）
- 文章 + 短动态（无标题图文流）；合集（分类）与话题（每文 ≤5）
- Markdown 深度渲染：GFM、KaTeX 公式、Shiki 代码高亮、Mermaid 图表/思维导图、净化后的受限 HTML
- 编辑器：粘贴/拖拽图片自动上传转 WebP、工具栏、实时预览、⌘S 保存
- 审核：关键词硬拦截（提交前提示）→ LLM 审核或人工审核 → 发布/驳回（含通知邮件）
- 社交：关注/拉黑、点赞、评论（扁平无限加载）、转推、互关私信（图片私信）
- 强制 2FA（TOTP + 恢复码）、邮箱验证、找回密码、GitHub/Google/X/Discourse/Cloudflare 登录自动注册
- 邀请码注册（自动关注邀请人）、用户子域名（可锁定）、RSS/Atom（主站/用户/子域名）
- Webhook 订阅（HMAC-SHA256 签名重试投递）、MCP 令牌管理内容
- GDPR：全量导出 ZIP（Markdown + 按日期归档媒体）、账户删除（内容匿名化或彻底删除）
- SEO：metadata/OG/JSON-LD、sitemap/robots；外链 nofollow + 新窗口 + 离站确认
