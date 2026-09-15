# 前端架构：数据流、模型与状态

> 适用范围：`src/app/(site)`、`src/app/(dashboard)`、`src/components`。
> 目标：任何新功能都有唯一确定的位置可放、唯一确定的取数方式可用、
> 数据模型错误在边界被拦截、任何非核心功能都能以插件身份接入而不改动布局代码。

## 0. 技术栈（主流选型）

| 层 | 库 | 职责 |
| --- | --- | --- |
| 服务端状态 | **TanStack Query v5** | 请求缓存、去重、轮询、无限分页、失效回流 |
| 客户端状态 | **Zustand v5**（+ persist） | 纯浏览器侧 UI 状态（如未读 seen 标记、未来的面板开合等） |
| 模型层 | **Zod v4** | DTO schema = 类型 = 运行时校验器，单一事实来源 |
| 传输层 | `src/lib/client/api.ts` | 全站唯一 fetch 入口 + 统一错误契约 |
| UI 插件 | `src/lib/plugins/ui.tsx` + `src/plugins.client/` | 槽位注册，非核心功能零侵入挂载 |

分工口诀：**server state 归 TanStack Query，client state 归 Zustand，
模型形状归 Zod，HTTP 归 api.ts，扩展点归插件槽位。**

## 1. 数据流总览

```
┌─────────────────────────── 服务端（RSC）────────────────────────────┐
│  page.tsx / layout.tsx                                               │
│    │  直接 await 查询函数（server-only）                              │
│    ▼                                                                 │
│  src/components/user-space/queries.ts   ←—— 领域查询层（DAL）        │
│    │  drizzle 查询 + toFeedItemDTO 序列化（Date → ISO string）       │
│    ▼                                                                 │
│  DTO（models/*.ts 推导）──props──▶ Server/Client 组件               │
│                                                                      │
│  变更走 API：src/app/api/** = withUser/withApi + 领域校验 + ok()     │
│  错误契约：{ error: string, blocked?: string[] } + 语义化状态码      │
└──────────────────────────────────────────────────────────────────────┘
┌─────────────────────────── 客户端（浏览器）──────────────────────────┐
│  读：useQuery(apiQueryOptions({ queryKey, url, schema }))            │
│      无限流：useInfiniteQuery + queryKeys.feed(scope)                │
│      轮询：useQuery({ refetchInterval, refetchIntervalInBackground })│
│  写：useApiMutation(fn, { successToast, invalidate, refresh })       │
│  UI 状态：Zustand store（src/lib/store/）                            │
│    │                                                                    │
│    ▼ queryFn 内 = apiGet(url) → schema.parse → 入缓存                │
│  src/lib/client/api.ts ──fetch──▶ /api/**                            │
└──────────────────────────────────────────────────────────────────────┘
```

三条铁律：

1. **组件里禁止直接 `fetch`。** 读数据用 `useQuery(apiQueryOptions(…))`，
   提交用 `@/lib/client/api` 的 post/put/patch/delete 系列（需要按状态码
   分支时用 `requestSafe`/`postJsonSafe`），UI 状态用 Zustand store。
2. **服务端数据只在服务端查。** 首屏数据在 `page.tsx` 里 await `queries.ts`
   的函数，以 props 下发；客户端增量读取一律走 TanStack Query。
   新查询加进 `queries.ts` 并返回 DTO（绝不出 db 行对象、绝不出 Date）。
3. **模型 schema 先行。** 新增跨 HTTP 的数据形状：先在 `src/lib/models/`
   写 Zod schema，类型用 `z.infer` 推导，查询层 `apiQueryOptions` 自动
   `safeParse`——服务端字段漂移在边界报错，不进渲染。

## 2. 模型层（`src/lib/models/`）

schema 即文档即校验器。已建模：`feed.ts`（UserBrief / PostBrief /
FeedItemDTO / TopicRef / Paginated / FeedPage）、`poll.ts`（PollView）、
`unread.ts`（UnreadCounts）。

```ts
// 定义（src/lib/models/poll.ts）
export const pollViewSchema = z.object({ id: z.string(), /* … */ });
export type PollView = z.infer<typeof pollViewSchema>;

// 消费（组件内）— 响应进缓存前已通过校验
const { data } = useQuery(apiQueryOptions({
  queryKey: queryKeys.poll(postId),
  url: `/api/posts/${postId}/poll`,
  schema: pollViewSchema,
}));
```

约定：

- **跨 HTTP 的形状必须建模**；仅经 RSC props 传递（编译期类型安全、
  无运行时边界）的形状留在 `user-space/types.ts`，不要过度建模。
- 可选演进字段用 `.nullish()`（`label?: string | null`），保持旧载荷兼容。
- 改 schema = 改契约：同步检查服务端序列化函数（`queries.ts`、各 route）。
- `user-space/types.ts` 对既有模型做再导出（兼容旧引用），新代码直接
  `import … from "@/lib/models/*"`。

## 3. 数据层（`src/lib/query/`）

| 模块 | 内容 |
| --- | --- |
| `provider.tsx` | `DataProvider`（QueryClientProvider），挂在根 layout。默认 staleTime 15s、gcTime 5min、retry 1、不聚焦重拉 |
| `keys.ts` | `queryKeys` 工厂：`feed(scope)` / `poll(postId)` / `unread(seen)`… **键只能从这里造**，失效才可按前缀批量命中 |
| `options.ts` | `apiQueryOptions({ queryKey, url, schema, ...opts })`：fetch → `safeParse` → 缓存；模型不匹配抛带 URL 上下文的 `ApiError` |
| `mutation.ts` | `useApiMutation(fn, opts)`：pending + 错误 toast + `successToast` + 成功后 `invalidate` 指定键 + `router.refresh()`（可关） |

典型片段：

```tsx
// 无限流（feed-stream）
const q = useInfiniteQuery({
  queryKey: queryKeys.feed(scope),
  queryFn: ({ pageParam }) => feedPageSchema.parse(apiGet(feedUrl(pageParam))),
  initialPageParam: 0,
  getNextPageParam: (last) => last.nextOffset,
  initialData: { pages: [{ items: initialItems, nextOffset: initialCursor }], pageParams: [0] },
});

// 提交（点赞/收藏/删除…）
const { mutate, pending } = useApiMutation(
  (postId: string) => postJson("/api/bookmarks", { postId }),
  { successToast: "已收藏", invalidate: [queryKeys.feed()] },
);

// 服务器响应即最新视图 → 直接写缓存（投票）
queryClient.setQueryData(queryKeys.poll(postId), r.data);
```

乐观更新模板（点赞类）：先 `queryClient.setQueryData` 本地翻转 →
`useApiMutation(silent: true, refresh: false)` 提交 → 失败回滚 +
`invalidateQueries`。

## 4. 状态层（`src/lib/store/`）

Zustand 只放**纯客户端状态**（不来自服务端的数据）。已建：
`unread.ts`（未读 seen 标记，persist 到 localStorage）。服务端数据
（哪怕轮询来的）永远进 TanStack Query，不进 store。

```ts
export const usePanelStore = create<PanelState>()(persist((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
}), { name: "panel.v1", storage: createJSONStorage(() => localStorage) }));
```

## 5. 传输层（`src/lib/client/api.ts`）

| 导出 | 用途 |
| --- | --- |
| `apiGet<T>` / `requestJson<T>(url, init)` | GET，失败抛 `ApiError` |
| `postJson` / `putJson` / `patchJson` / `deleteJson` | 写操作，失败抛 `ApiError` |
| `requestSafe<T>` / `postJsonSafe<T>` | 判别联合返回，永不抛错；用于“失败是正常分支”的流程（发布审核 422、登录 2FA、投票 410） |
| `ApiError` / `isAuthError` | 错误识别（401/403 引导登录、静默降级） |
| `mediaUrl` / `mediaPathFromUrl`、`*_DRAFT_KEY` | 媒体路径、编辑器草稿键 |

## 6. 组件抽离约定

```
src/components/
  shell/            布局子件：brand / left-nav / mobile-chrome /
                    timeline-header / user-menu / types
  site-shell.tsx    布局组合根：只装配 shell/* + 再导出公共 API
  social/ user-space/ editor/ settings/ dashboard/  域组件
  ui/               无业务原语
```

- **新文件超 ~400 行即拆**（参考 site-shell 682 → 组合根 140 + 5 子件）。
- 布局组件不取数、不 import 具体功能组件；扩展点挂
  `<FeedRowAfterSlot postId hasPoll />`（见下）。
- 首屏必需的数据不许改成客户端取（会闪 loading）；客户端查询只用于
  交互后的增量数据（投票、评论分页、未读计数…）。

## 7. 前端插件机制

与服务端 `src/core/plugins` 同构的**槽位注册**：

```
src/lib/plugins/ui.tsx        SlotContexts 清单 + 注册表 + SlotRenderer
src/plugins.client/index.tsx  装配点（UI_PLUGINS 数组）
src/plugins.client/poll.tsx   投票插件（feed:row:after + post:detail:after）
```

- 新 UI 插件三步：写组件（ctx 形状见 `PostSlotContext`）→ 导出
  `UiPlugin` → 加入 `UI_PLUGINS`。布局零改动。
- 新槽位：`SlotContexts` 登记 id + ctx（必须可 JSON 序列化）→ 布局挂
  `SlotRenderer`。
- 规划槽位：`composer:tools`、`composer:panel`、`settings:tabs`、`admin:nav`。

## 8. 存量迁移清单

组件仍直接 `fetch` 的文件（用 `grep -rl "fetch(" $(grep -rl "use client" ) ` 盘点），
按 recipe 逐个替换；改一个少一个：

| 文件 | 迁移方式 |
| --- | --- |
| `social/poll-card.tsx`、`user-space/feed-stream.tsx`、`user-space/use-local-unread.ts`、`shell/user-menu.tsx` | ✅ 已迁移（useQuery / useInfiniteQuery / Zustand+useQuery / postJson） |
| `site-header.tsx`、`dashboard/console-topbar.tsx` | 未读/上下文轮询 → `useQuery({ refetchInterval, refetchIntervalInBackground: false })` |
| `dashboard/my-posts-manager.tsx`、`user-space/row-actions-menu.tsx` | 动作 → `useApiMutation` + `invalidate` |
| `social/like-button.tsx`、`repost-button.tsx`、`follow-button.tsx`、`block-button.tsx` | 乐观更新模板（§3） |
| `social/comments.tsx`、`chat.tsx`、`inbox-list.tsx` | 列表 → `useQuery`；发送 → `postJson` |
| `social/pinned-composer.tsx`、`composer-panels.tsx`、`preview-banner.tsx` | 发布流 → `postJsonSafe`（422 blocked 分支） |
| `editor/*` | 同上；草稿键已在新层 |
| `settings/verification-panel.tsx` | → `useApiMutation` |
| `app/(site)/auth/**` 表单 | 需按状态码分支 → `postJsonSafe`，其余 `useApiMutation` |

通用 recipe：

```diff
- const res = await fetch(url, { method: "POST", … });
- if (!res.ok) throw new Error("failed");
- const data = await res.json() as X;
+ const { mutate, pending } = useApiMutation((p) => postJson<X>(url, p), { … });
+ // 或列表读取：
+ const { data } = useQuery(apiQueryOptions({ queryKey: queryKeys.x, url, schema: xSchema }));
```

## 9. 已知问题与说明

- **`enqueueModel` / flight 竞态**：Next 16 dev 下快速切换动态路由时
  React Flight 客户端缓存竞态（上游问题）。已在 `next.config.ts` 用
  `dynamicOnHover + staleTimes` 缓解；本架构把交互数据引导到普通 fetch
  （TanStack Query）也减少触发面。
- **成功响应的两种形状**：动作用 `ok({ ok: true })`、列表用
  `Paginated<T>`，不要发明第三种。
- Zustand persist 的旧 localStorage 键（`unread-seen:*`）未做迁移，
  升级后首次未读计数可能偏高，一次点击即归零。
- pnpm v10+ 对新依赖的构建脚本需 `pnpm approve-builds` 批准；TanStack
  Query / Zustand 为纯 JS 包，无构建脚本，不受影响。
