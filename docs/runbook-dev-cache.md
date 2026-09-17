# Runbook：dev 依赖实例与编译缓存治理（module factory / flight 竞态类故障）

> 适用症状：浏览器控制台出现
> `Module …/next/dist/lib/framework/boundary-components.js … but the module factory is not available`、
> `enqueueModel` 崩溃、`unhandledRejection: … reading 'startsWith'`、
> 大量 flight 重复 resolve；多发生在**页面切换时**，刷新后恢复、随时间复发。

## 一、根因模型（2026-09 两天连环故障复盘）

1. **dev 模式 Turbopack 的 chunk URL 跨代际稳定，内容却随编译变化。**
   同一个 `/_next/static/chunks/xxx.js` URL，在依赖代际 A 和代际 B 下内容不同。
2. **`.next/dev` 持久缓存按绝对模块路径记录编译产物，对实例路径变化不会完全失效。**
   pnpm 下任何改变 `node_modules/next` 实例目录名的事件都会制造"代际切换"：
   - react / react-dom 升级（peer hash 变化，如 `react-dom@19.2.8` → `19.3.0`）
   - **pnpm patch 的增、删、改**（`patch_hash` 路径变化）
3. 旧代际材料的滞留点（✅ 2026-09-17 用户在 DevTools 中定位到确定性根因）：
   - **客户端：Chrome 里注册的 Service Worker（最终确认的元凶）**。SW 按
     origin（localhost:3000）注册，与代码仓库无关 —— 任何曾占用该端口的项目
     /实验留下的 SW，即使注册代码早已删除，仍会用**自己缓存的旧脚本**持续
     拦截 fetch、按稳定 chunk URL 回放旧代际产物。这解释了全部现象：
     仅 Chrome 出错（内嵌浏览器独立 profile 无 SW）、跨 dev 重启 /
     node_modules 重装 / .next 清除持续复发、引用已删除实例路径、刷新暂时
     恢复后复发。当时以"代码与 git 历史无 SW"排除该向量是误判 —— SW 的
     滞留性恰恰在仓库之外。
   - 服务端：`.next/dev/cache`（Turbopack 持久缓存，二进制格式）
   - 客户端：浏览器磁盘缓存 + 未刷新的旧标签页内存中的模块图

   **防护（dev 自愈守卫）**：根 layout 注入 dev-only 脚本（src/app/layout.tsx），
   每次页面加载自动卸载本 origin 全部 Service Worker 并清空 Cache API ——
   任何项目再往 localhost:3000 注册 SW 都会被下次加载自动驱逐。生产构建
   不含此脚本。
4. 新旧代际在同一页面混用 → flight 载荷引用**磁盘上已不存在的实例路径** →
   module factory 缺失 → 竞态雪崩（flight 重复 resolve / startsWith 崩溃）。
   服务端 SSR 输出本身是干净的（已验证），错误引用全部来自上述滞留点。

**结论：不是业务代码/页面架构问题，是"依赖代际切换 × 缓存不失效"的工具链问题；
此前用 pnpm patch 吞崩溃反而放大了代际切换频率，形成恶性循环。**

## 二、修复体系（四层防御）

| 层 | 机制 | 位置 |
|---|---|---|
| 1 | pnpm patch 退役（消除最大代际切换源） | `pnpm-workspace.yaml`、`patches/attic/` |
| 2 | 实例守卫：ref 变化/缺失即清 `.next/dev`，双入口（install + 启动） | `scripts/lib/instance-guard.mjs`、`scripts/postinstall.mjs`、`next.config.ts` |
| 3 | dev 静态资源 `no-store`（切断浏览器磁盘缓存代际滞留） | `next.config.ts` headers() |
| 4 | 架构层收窄 flight 竞态窗口 | 路由组/段 loading.tsx 流式边界、`dynamicOnHover`、`staleTimes`、SSE 连接去抖释放 |

守卫的保守策略：**无法证明缓存连续性（ref 变化或状态缺失）就清 `.next/dev`** ——
冷编译几秒的代价，远小于幽灵错误排查半天。守卫状态存于
`node_modules/.cache/mb-next-ref`（刻意放在 `.next` 之外，清 `.next` 不丢状态）。

## 三、运维规则

1. **任何依赖变更（`pnpm add`/`update`/`remove`、改 patch、切 node 版本）之后，
   重启 `next dev`。** 守卫会自动清缓存并打日志
   `[instance-guard] next 实例路径变化或状态缺失 → 已清除 .next/dev …`，看到该日志即已自愈。
2. **经历过代际切换的浏览器标签页，做一次硬刷新（⌘⇧R）。** 旧标签页内存里的
   模块图无法被服务端纠正；no-store 头已保证之后不再滞留。
3. dev 会话里出现 `[flight-fix]` 类日志**属预期**之外——该日志来自已退役的补丁；
   现在若见 `enqueueModel` 崩溃（落入 error boundary，刷新恢复），按第四节评估是否恢复补丁。

## 四、flight 竞态回归时的恢复预案（补丁退役通道）

> **✅ 已激活（2026-09-17）**：纯净环境下竞态在真实使用中复发 —— Chrome 悬停
> 触发 dynamicOnHover 预取，快速导航时预取流与导航流交叠，日志捕获
> `enqueueModel` 崩溃 7 次（/explore 等）。按本节流程恢复补丁；实例守卫
> v2 在 `pnpm install` 时自动清缓存（日志见 [instance-guard]），恢复过程
> 无混代际风险。补丁退役结论保持有效：等 16.4 stable 含上游修复后再退役。

上游状态：截至 `next@16.4.0-canary.33`，`resolveModelChunk` 的
`chunk.reason.enqueueModel` 仍无守卫（已实测 canary 产物），即该竞态为 React
flight 客户端已知缺陷、Next 稳定版尚无修复可升。若纯净环境下竞态频繁回落为硬崩溃：

```bash
# 1. 恢复补丁原件
cp patches/attic/next@16.3.5.flight-fix.patch patches/next@16.3.5.patch
# 2. pnpm-workspace.yaml 追加：
#    patchedDependencies:
#      next@16.3.5: patches/next@16.3.5.patch
pnpm install        # postinstall 守卫自动清 .next/dev
# 3. 重启 dev，浏览器硬刷新一次
```

> 注意：恢复补丁 = 主动制造一次代际切换，务必让守卫清缓存后再继续开发。
> 上游发布包含 flight 修复的 16.4.x stable 后，优先升级而非恢复补丁。

## 五、验证清单

- [x] `node_modules/.pnpm` 无重复/孤儿 next 实例（全量重装后仅一份）
- [x] `pnpm test` 含实例守卫回归用例（`src/lib/instance-guard.test.ts`）
- [x] 干净 dev 启动：HTML/chunks/RSC 载荷 grep 无旧实例路径（`19.2.8`/`_@babel`）
- [x] `next build` 生产构建通过（生产无此向量：chunk 带内容哈希 + 不可变缓存头）
