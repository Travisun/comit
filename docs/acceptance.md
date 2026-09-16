# 平台能力面验收审计报告

> 审计范围：当前 App 架构全部能力面（服务端 + 客户端 + 扩展体系）。
> 验证命令：`pnpm exec tsc --noEmit`（0 错误）· `pnpm exec eslint src scripts`（0 error）·
> `pnpm exec vitest run`（4/4 通过）· `pnpm build`（成功）· `pnpm ext list/routes`（正常）·
> `pnpm install`（workspace 布局正常）。审计日期：2026-09-15。

## 1. 能力面清单与验收状态

### 品牌体系
| 项 | 状态 | 验证 |
| --- | --- | --- |
| SVG 优先 Logo 组件族（LogoMark/LogoFull/BrandMark） | ✅ | tsc/build；旧 comit.sh.svg、favicon*、icon-* 旧资产已删除 |
| favicon 兼容链（SVG + 16/32/128/256 PNG + apple） | ✅ | seo.ts icons 切换新链 |
| PWA manifest 图标 | ✅ | manifest.ts（svg any + 256 any/maskable） |
| 各端适配：收起侧栏（mark）/展开（full）/移动顶栏（mark+站名）/后台侧栏（full）/旧站点头（full） | ✅ | 全部替换为 /icons/logo-* 资产（源：/logos） |

### HTTP 层
| 项 | 状态 | 验证 |
| --- | --- | --- |
| Action 工厂（A1/A2：声明式 鉴权+校验+中间件+业务） | ✅ | likes.toggle 全量迁移示范，route 3 行接线 |
| 中间件管道（A3：全局 + 动作级；维护模式/限流内置工厂） | ✅ | registerGlobalMiddleware + rateLimitAction/maintenanceGuard |
| OpenAPI 文档（A4） | ✅ | /api/openapi.json 由 Action 目录自动生成 |
| 错误码注册表（A5） | ✅ | core/error-codes.ts 13 个码集中定义 |
| 存量路线 | route.ts 渐进迁移至 Action；likes 为样板 | 文档化 |

### 提供者/容器层
| 项 | 状态 | 验证 |
| --- | --- | --- |
| Service Provider 装配 | ✅ | extensions/_boot/server.ts（bootPlugins） |
| DI 容器（B2） | ✅ | core/container-di.ts：bind/singleton/instance/resolve/tryResolve |
| 依赖拓扑排序（B4） | ✅ | plugin.requires Kahn 稳定排序 + 环回退 |
| 延迟 Provider（B3） | ✅ | plugin.deferred → container.singleton 懒注册 |
| 扩展能力自标注 | ✅ | package.json `comit` 字段 + pnpm ext list 盘点 |

### ORM/数据
| 项 | 状态 | 验证 |
| --- | --- | --- |
| 扩展表聚合 + 迁移自动注册 | ✅ | _boot/tables.ts → db/schema.ts；0012/0013 已生成 |
| postRepo（C1 observers 集中） | ✅ | posts POST/PUT 路由已迁移；钩子在仓储内触发 |
| 扩展 Seeder（C3） | ✅ | ctx.seeds.register + pnpm ext seed（settings 防重放） |

### 横切能力
| 项 | 状态 | 验证 |
| --- | --- | --- |
| 结构化日志（D1） | ✅ | core/logger.ts：级别/上下文/AsyncLocalStorage requestId |
| 应用缓存（D2） | ✅ | core/cache.ts：remember/put/forget/flushTags + 上限淘汰 |
| HTTP Client（D5） | ✅ | core/http-client.ts：超时/重试退避/日志；llm/webhooks/oauth 已迁移 |
| Feature Flags（D3） | ✅ | capabilities/flags.ts：define/enabled/set（settings 存储 + 5s 缓存） |
| 维护模式（D4） | ✅ | site.maintenance 设置 + maintenanceGuard 中间件（放行 auth/admin/health） |
| 通知模板注册制（D6） | ✅ | capabilities/notify-templates.ts |
| 实时广播 SSE（D7） | ✅ | broadcast + /api/realtime/stream + useRealtime；未读徽标已接入实时失效（60s 轮询兜底） |
| 搜索抽象（D8） | ✅ | capabilities/search.ts：registerProvider + searchAll 聚合 |
| 审计标准化（D9） | ✅ | capabilities/audit.ts（写 mod_logs，审计页直接消费） |
| i18n 扩展命名空间（D10） | ✅ | manifest.i18n + getT().tExt（zh 回退链） |

### 钩子/事件总表
post:saving/saved（仓储级）· post:publishing（审核放行前，可拦截）· comment:saving/saved ·
media:uploading（可拒绝）· register:saving（可拒绝）· password:changing（可拒绝）·
profile:saving/saved · user:deleting（可阻止注销）· message:sending（可拒绝）/sent ·
auth:login/logout/registered · auth:password.forgot/reset/changed · message:read ·
既有 22 领域事件 + emitQueued 队列化事件。**状态：全部有真实触发点。**

### 扩展体系
| 项 | 状态 |
| --- | ---|
| 目录制（一个扩展一个目录，含 package.json/manifest/server/client） | ✅ |
| 客户端槽位：feed:row:after / post:detail:after / post:actions / post:row-menu | ✅ |
| 注入：导航项 / 用户菜单 / rail widget / 打断渲染器 | ✅ |
| 设置「扩展」tab（manifest 驱动自动表单 + 服务端同规则校验） | ✅ |
| 扩展页面 /e/<path>（site/bare 布局） | ✅ |
| 扩展 API /api/ext/<id>/...（public/user 鉴权） | ✅ |
| 依赖 workspace（声明在扩展、安装在根） | ✅ pnpm-workspace + install 验证 |
| CLI：list/make/test/routes/seed | ✅（make 实测：脚手架+登记后 tsc 直接通过） |
| 测试：vitest + useZodForm/manifest 示范测试 + DB 工厂 + callAction 直调 | ✅ |

## 2. 稳定性/可靠性验证记录

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 类型 | `tsc --noEmit` | 0 错误 |
| Lint | `eslint src scripts` | 0 error（遗留：5 条 <img> 等风格警告） |
| 单测 | `vitest run` | 4/4 通过 |
| 构建 | `next build` | 成功（全路由） |
| 工作区 | `pnpm install` | 成功；esbuild 构建脚本审批已解决 |
| CLI | `ext list/routes` | 输出正确 |
| 竞态防护 | SafeResult 收窄 / singleflight / 渲染期 ref 禁用 | lint 规则集 0 违例 |
| 失败隔离 | post-render 过滤器 / 媒体处理器 / 搜索源 / sitemap 源 | 单点失败只记日志不阻断 |

## 3. 已知边界（不阻塞验收）

1. `post:render` 管线的 prepend/append 为信任 HTML（内置扩展）；第三方开放需沙箱。
2. 短动态正文在客户端渲染：管线 `ctx.html` 改写对其不生效（prepend/append/meta/打断生效）。
3. broadcast 为进程内 pub/sub：水平扩展需替换为 Redis pub/sub（API 不变）。
4. 缓存/限流为进程内实现：水平扩展需 Redis 后端（调用面不变，已在文件头注明）。
5. 旧路由 → Action 层为渐进迁移（likes 已完成），其余 35 个路由按 A1 模式渐进。
6. `widgets`/`adminSections` 注册表消费方、composer:tools/settings:tabs 槽位为下一轮路线（P0-P1 已确认清单之外的遗留）。
