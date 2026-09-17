# 扩展（Extension）开发指南

> 平台插件架构参考：Laravel Service Provider（服务端引导）、WordPress
> hooks/filters（渲染管线）、VS Code `contributes.*`（声明式清单）。
> 铁律：**每个能力面 = 注册表/槽位 + 消费方接线 + 至少一个内置扩展证明**。

## 1. 目录结构 — 一个扩展一个目录

```
src/extensions/
  _boot/
    server.ts        # 服务端装配点：bootPlugins()（instrumentation.ts 调用）
    client.tsx       # 客户端装配点：import 各扩展 client 模块即完成注册
    registry.ts      # 静态 refs：扩展页面 + 自定义设置面板（双端可导入）
    manifests.ts     # 清单聚合：EXTENSION_MANIFESTS / 资料字段汇总
  notifications/
    server.ts        # Plugin（通知渠道 database/webhook）
  webhooks/server.ts
  moderation/server.ts
  mcp/server.ts
  export/server.ts
  poll/
    manifest.ts      # 声明式贡献点（标题/设置字段/资料字段）
    server.ts        # 到期通知任务（queue worker 调用）
    client.tsx       # 槽位组件注册（feed:row:after / post:detail:after）
    components/poll-card.tsx
  signature/         # ★ 全能力面示范：见 §4
    manifest.ts  server.ts  client.tsx
  share/             # 最小纯前端扩展示范
    manifest.ts  client.tsx
```

**扩展的所有文件都在自己的目录里**（组件、schema、清单），跨目录只允许
`@/core/*`、`@/lib/*`、`@/db` 等平台框架导入。

## 2. 双端装配

| 端 | 装配点 | 机制 |
| --- | --- | --- |
| 服务端 | `extensions/_boot/server.ts` → `bootPlugins()` | 逐个 `plugin.register(ctx)`，ctx 提供全部服务端注册 API |
| 客户端 | `extensions/_boot/client.tsx` | import 扩展 client 模块（注册为模块侧效）+ 槽位再导出 |
| 双端静态 | `extensions/_boot/registry.ts` / `manifests.ts` | 页面组件、清单数据（server component 无法读取 client 运行时注册表，故用静态装配） |

## 3. 能力面总览

### 3.1 服务端（PluginContext，扩展 `server.ts` 的 `register(ctx)` 内调用）

| 注册 API | 消费方 | 说明 |
| --- | --- | --- |
| `registerChannel(ch)` | notifySend 扇出 | 通知渠道（database/webhook/…） |
| `registerMcpTool(tool)` | /api/mcp | MCP 工具 |
| `registerPostRenderFilter(name, fn, order?)` | 文章/短动态详情页 | 渲染管线，见 §3.2 |
| `registerMediaProcessor(name, fn, order?)` | /api/media/upload | 上传后处理（水印/扫描/alt 生成），失败仅记日志 |
| `registerSitemapSource(name, fn)` | /sitemap.xml | 额外 URL 源，单源失败不影响整体 |
| `registerExtApiRoute(id, def)` | /api/ext/[...slug] | 扩展 API；`auth: "user"` 套登录 |
| `ctx.hooks.on("post:saving"/"post:saved")` | POST/PUT /api/posts | 写入前可改载荷 / 拒绝（`ctx.reject(reason)` → 422）；写入后异步处理 |
| `ctx.events`（bus） | 各处 `emit()` | 28 个领域事件订阅 |

### 3.2 文章渲染管线（`core/capabilities/post-render.ts`）

```ts
ctx.registerPostRenderFilter("signature", async (p) => {
  if (loginRequired && !p.viewer) {
    p.interrupt({ code: "ext.signature.login", message: "仅登录可见" });
    return;                       // 打断后正文不输出
  }
  p.prepend(`<div>…</div>`);      // 正文前输出（信任 HTML）
  p.append(`<div>…</div>`);       // 正文后输出
  p.html = p.html.replaceAll(…);  // 改写渲染结果（文章页；短动态正文在客户端渲染）
  p.meta["ext.signature.content"] = "…"; // 随 RSC 下发给客户端槽位
}, 50);
```

- 打断 UI：客户端 `registerInterruptRenderer(code 前缀, 组件)` 注册渲染器，
  详情页经 `<InterruptView info={ctx.interrupted} />` 渲染（无匹配时通用卡片）。
  付费墙 = `interrupt({ code: "ext.paywall.locked", data: { price } })` + 注册渲染器。
- `meta` 键约定 `ext.<id>.*`，经 `PostSlotContext.meta` 传入
  `post:detail:after` 槽位。

### 3.3 客户端注册表（`lib/plugins/registry.tsx`，扩展 `client.tsx` 内调用）

| 注册 API | 消费方 |
| --- | --- |
| `registerNavItem({ label:{zh,en}, href, icon?, audience?, order })` | 左侧主导航（audience: "user" 仅登录） |
| `registerUserMenuItem({ label, href })` | 用户菜单（左下角头像菜单，退出登录上方） |
| `registerRailWidget({ title?, component })` | 右侧栏面板（`<ExtensionRailWidgets />`） |
| `registerInterruptRenderer(code, component)` | 渲染打断 UI |
| `registerUiPlugin({ registrations: [{ slot, component }] })` | 内容槽位 |

### 3.4 内容槽位（`lib/plugins/ui.tsx` `SlotContexts`）

| 槽位 | ctx | 挂载点 |
| --- | --- | --- |
| `feed:row:after` | `{ postId, hasPoll, meta? }` | 时间线卡片尾部（投票卡片） |
| `post:detail:after` | 同上 | 详情正文之后 |
| `post:actions` | `{ postId, postType, publicId }` | 详情快捷操作栏（点赞/转发一排） |
| `post:row-menu` | 同上 | 时间线行「···」菜单项（组件渲染 DropdownMenuItem） |

### 3.5 声明式贡献（manifest，`extensions/<id>/manifest.ts`）

```ts
export default {
  id: "signature",                    // 命名空间：/api/ext/signature、ext.signature.*
  title: { zh: "签名档", en: "Signature" },
  version: "1.0.0",
  settingsFields: [                   // 设置 → 扩展：自动表单 + 服务端同规则校验
    { key: "enabled", type: "boolean", label: "启用", default: false },
    { key: "content", type: "textarea", label: "内容", maxLength: 200 },
    { key: "placement", type: "select", label: "位置", options: [...] },
  ],
  profileFields: [                    // 资料编辑表单 + 主页「关于」展示
    { key: "ext.signature.tagline", type: "text", label: "一句话签名", maxLength: 80 },
  ],
} satisfies ExtensionManifest;
```

字段类型：`text / textarea / number / boolean / select`（设置）、
`text / textarea / url`（资料）。存储：
- 扩展设置 → `users.ext_settings` jsonb（键 = 扩展 id），API
  `GET/PUT /api/me/ext/<id>/settings`，服务端 `coerceExtSettings` 校验；
- 资料字段 → `users.custom_fields` jsonb，随 `PUT /api/me/profile` 的
  `customFields` 提交，`coerceProfileFields` 校验。

### 3.6 扩展页面

`extensions/_boot/registry.ts` 登记 `{ path, title, layout, component }` →
路由 `/e/<path>`；`layout: "bare"` 时 SiteShell 按路径跳过三栏壳（全屏，
auth 页同款），`"site"` 含右栏。

## 4. 参考实现

- **`extensions/signature`**（全能力面）：渲染管线 + 打断 + 用户级设置 +
  资料字段 + 扩展 API + 独立页 + rail widget + 导航/用户菜单注入。
- **`extensions/share`**（最小纯前端）：`post:actions` + `post:row-menu`。
- **`extensions/poll`**（双端）：槽位展示 + 到期通知任务 + 服务端校验。

## 5. 已知边界

- 渲染管线的 prepend/append 是**信任 HTML**（内置扩展可用；第三方接入需
  引入沙箱/白名单后再开放）。短动态正文在客户端渲染，`ctx.html` 改写不生效。
- `widgets` / `adminSections`（服务端注册表）与 `composer:tools`、
  `settings:tabs` 等槽位仍是声明接缝，消费方接线在路线图 P0/P1
  （见 git history 与 frontend-architecture.md §4）。
- 扩展设置目前为**用户级**（存 users 表）；站点级全局扩展设置待接入
  `lib/settings` 后再开放。

## 6. 平台级能力（Laravel 对应物）

| 能力 | 平台实现 | 扩展接入 |
| --- | --- | --- |
| 队列 Queue | pg-boss（core/queue） | `queue.send/work`；任务类型在 JobPayloads |
| **调度 Scheduler** | `boss.schedule` 原生 cron | `ctx.cron.register({ name: "ext.<id>.<task>", cron: "0 3 * * *" }, handler)` — 持久化、多进程不重复 |
| **LLM** | lib/llm.ts（OpenAI-compatible） | `ctx.llm.chat({ messages, model?, json? })`、`ctx.llm.listLlmModels()/listRemoteModels()` 查询可用型号、`ctx.llm.registerPrompt/renderPrompt` 提示词模板、`ctx.llm.registerModel` 注册型号 |
| 事件 Events | Emittery bus（22+ 事件） | `ctx.events.on(...)`；含 auth:login/logout/registered、auth:password.forgot/reset、message:created/read 等 |
| **生命周期钩子**（可改写/可拒绝） | hookable | `post:saving/saved`、`register:saving`、`message:sending/sent` — reject(reason) → 422 |
| **ORM/迁移** | drizzle + journal | 扩展表声明在 `extensions/<id>/schema.ts` → 登记 `_boot/tables.ts` → `pnpm db:generate/migrate` 自动版本化；运行时直接 `import { db }` |
| **表单验证** | lib/validation.ts（zod） | `useZodForm(schema, initial)` → values/errors/setField/submit，服务端同一 schema 复核 |
| **Toast** | lib/client/toast.ts | `appToast.success/error/info`、`appToast.fromError(err)` |
| **授权 Policy** | core/capabilities/policies | `ctx.policies.register("post.update", fn)`（AND 叠加）；路由内 `authorize(user, "post.update", post)`；内置 post.update/delete = 作者本人 |
| **存储 Storage** | core/capabilities/storage | `ctx.storage.disk()`（默认 local，`registerStorageAdapter` 可换 S3/R2）；put/read/delete/exists/url/size |
| **通知双通道** | core/capabilities/jobs.ts | `ctx.notifications.send()` 同步直投 / `sendAsync()` 入队 |
| **异步任务** | ctx.jobs | `jobs.dispatch(task, payload)` 入队 + `jobs.work(task, handler)` 消费（自动绑定扩展命名空间） |
| **队列化事件** | `emitQueued(name, payload)` | ShouldQueue 语义：监听器在 worker 异步消费 |
| HTTP 中间件 | proxy.ts（平台级） | 暂不开放扩展接入 |
| 通知 | 渠道注册表 | `registerChannel` |

### 6.1 生命周期钩子总表（可拒绝 = reject(reason) → 422）

| 钩子/事件 | 触发点 | 可拒绝 |
| --- | --- | --- |
| `post:saving` / `post:saved` | 文章/动态创建与更新 | ✅ / - |
| `post:publishing` | 审核通过即将发布（含 reviewMode=off） | ✅（拦截发布） |
| `comment:saving` / `comment:saved` | 评论发布 | ✅ / - |
| `media:uploading` | 图片上传前（配额/风控） | ✅ |
| `register:saving` | 注册提交 | ✅ |
| `password:changing` | 密码修改 | ✅ |
| `profile:saving` / `profile:saved` | 资料更新（头像/封面/自定义字段） | ✅ / - |
| `user:deleting` | 账户注销 | ✅（阻止注销） |
| `message:sending` / `message:sent` | 私信发送前/后 | ✅ / - |
| `auth:login` / `auth:logout` / `auth:registered` | 登录完成/登出/注册完成 | 事件 |
| `auth:password.forgot` / `auth:password.reset` / `auth:password.changed` | 找回/重置/修改密码 | 事件 |
| `message:read` | 会话消息已读 | 事件 |

## 6.2 测试设施（vitest）

- 测试约定：`src/extensions/<id>/tests/*.test.ts`；
- 运行：`pnpm test`（全部）/ `pnpm ext test <id>`（单扩展）；
- 工厂：`src/core/testing.ts` 提供 `createTestUser` / `createTestPost` /
  `cleanupTestFixtures`（作用于 DATABASE_URL 指向的库，数据带 test- 前缀）；
- 纯函数（清单收敛、校验、提示词插值）无需数据库，见
  `extensions/signature/tests/manifest.test.ts`。

## 6.3 CLI（Laravel artisan 对应物）

```
pnpm ext list          列出扩展及其能力声明（读各扩展 package.json 的 comit 字段）
pnpm ext make <id>     脚手架新扩展（manifest/server/client/package.json）+ 自动登记装配点
pnpm ext test <id>     运行单扩展测试
pnpm ext routes        列出扩展页面
```

扩展的 package.json `comit` 字段是能力声明标注（启动发现与 CLI 盘点依据）：
```json
{ "comit": { "server": "./server.ts", "client": "./client.tsx", "cron": ["ext.x.cleanup"] } }
```

## 7. 依赖管理（workspace）

每个扩展目录是一个 pnpm workspace 包（自带 `package.json`，名 `@ext/<id>`）：
- 扩展**引入的第三方依赖声明在自己的 package.json**；
- 安装统一进**根 node_modules**（pnpm 提升 + 去重），锁文件只有根目录一份；
- 平台共享依赖（react/zod/…）仍声明在根 package.json，扩展直接使用。

新增依赖流程：在扩展 package.json 写入依赖 → 根目录 `pnpm install` → 导入使用。
