# comit.sh Design System

> 基调：**工程感、扁平、锐利、可信赖**。对齐 Cloudflare 的扁平化设计语言——纯色表面、可见 1px 边框、紧凑尺寸、无装饰性阴影。
>
> 本文档是全站契约。所有页面/组件只允许消费本文定义的令牌与 `src/components/ui/` 组件，禁止自造阴影、渐变、圆角。

---

## 1. 核心原则

1. **纯色扁平**：所有表面为纯色填充。禁止 body 渐变、径向光斑、玻璃拟态。
2. **无阴影**：层级关系由 **1px 可见边框**（`--border`）表达，不使用阴影。唯一例外是浮层（dropdown / dialog / popover / tooltip 容器），允许一枚极轻阴影 `--shadow-overlay`。
3. **锐利圆角**：面板 8px（`rounded-lg`），控件 6px（`rounded-md`），键帽/徽章小件 4px。禁用 16px+ 的大圆角。
4. **橙色唯一强调**：品牌橙 `#f6821f` 是唯一的强强调色（主按钮、选中态、开关、链接下划线引用色）；正文/编辑器链接用蓝 `--link`。
5. **紧凑尺寸**：控件高度 32/36/40px（sm/default/lg），行高紧凑，密度优先。

---

## 2. 令牌 — 亮色（`:root`）

定义位置：`src/app/globals.css`。所有颜色经 `@theme inline` 映射为 Tailwind 工具类（如 `bg-primary`、`text-muted-foreground`、`bg-hover`）。

### 2.1 色板

| 令牌 | Hex | OKLCH | 用途 |
| --- | --- | --- | --- |
| `--background` | `#f2f3f5` | `oklch(0.964 0.003 264.5)` | 页面画布（body 纯色，无渐变） |
| `--foreground` | `#22252a` | `oklch(0.264 0.010 260.7)` | 主文本 |
| `--card` | `#ffffff` | `oklch(1.000 0.000 89.9)` | 卡片/面板表面 |
| `--card-foreground` | `#22252a` | 同 foreground | 卡片内文本 |
| `--popover` | `#ffffff` | `#ffffff` | 浮层表面 |
| `--popover-foreground` | `#22252a` | 同 foreground | 浮层文本 |
| `--primary` | `#f6821f` | `oklch(0.723 0.172 53.8)` | Cloudflare 橙：主按钮/选中/开关 |
| `--primary-hover` | `#e0730f` | `oklch(0.669 0.165 53.6)` | 主按钮 hover（加深） |
| `--primary-foreground` | `#ffffff` | — | 橙底上的文字 |
| `--secondary` | `#f0f1f3` | `oklch(0.958 0.003 264.5)` | 次级按钮底 |
| `--secondary-foreground` | `#22252a` | 同 foreground | |
| `--muted` | `#f0f1f3` | 同 secondary | 静默表面：行内 code、表头、Skeleton |
| `--muted-foreground` | `#6b6f76` | `oklch(0.541 0.012 261.8)` | 次要文本/placeholder |
| `--accent` / `--accent-foreground` | `#f0f1f3` / `#22252a` | 同 muted | shadcn 兼容槽位（= muted） |
| `--success` | `#2e7d46` | `oklch(0.527 0.115 150.5)` | 成功（深绿字，配浅绿底） |
| `--warning` | `#b7791f` | `oklch(0.626 0.125 70.4)` | 警告（深黄字，配浅黄底） |
| `--destructive` | `#c52228` | `oklch(0.533 0.197 25.7)` | 危险按钮/错误文本 |
| `--destructive-foreground` | `#ffffff` | — | |
| `--border` | `#dedee3` | `oklch(0.902 0.007 286.3)` | 可见 1px 扁平分隔 |
| `--input` | `#c9ccd1` | `oklch(0.844 0.008 260.7)` | 输入控件边框（比 border 深一档） |
| `--ring` | `rgba(246,130,31,.35)` | — | focus ring（橙 35%） |
| `--hover` | `#f7f8f8` | `oklch(0.978 0.001 197.1)` | 行/控件悬停表面 |
| `--selected` | `#eef4fb` | `oklch(0.965 0.011 252.1)` | 选中浅蓝灰（列表选中项、nav 激活） |
| `--link` | `#1c64d9` | `oklch(0.531 0.193 260.2)` | 编辑器/正文链接蓝 |

### 2.2 圆角

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--radius` | `8px` | 基准（面板） |
| `--radius-sm` | `4px` | kbd 键帽、tabs 内激活块、小徽章 |
| `--radius-md` | `6px` | **控件**：按钮、输入框、checkbox、dropdown item |
| `--radius-lg` | `8px` | **面板**：卡片、dialog、popover、dropdown 容器 |
| `--radius-xl` | `12px` | 大型 hero/横幅表面（节制使用） |

### 2.3 间距与尺寸

- 控件高度：`sm = h-8 (32px)`、`default = h-9 (36px)`、`lg = h-10 (40px)`。
- 卡片内边距：`p-4`（<640px）/ `p-5`（≥640px）。
- 浮层 `sideOffset: 6px`；行内边距 `px-2.5 py-1.5`（menu item）。
- 头部高度：`--header-h: 3.75rem`（60px，锚点滚动偏移依赖它）。

### 2.4 边框规则与“无阴影”

- 全局 `* { border-color: var(--border) }`，分隔一律 `1px solid var(--border)`。
- 输入类控件用更深的 `--input`，在灰底画布上仍清晰可辨。
- **禁止** `shadow-sm/xs/lg/xl` 及 `--shadow-soft` / `--shadow-lift`（已删除）。
- 唯一阴影令牌：

| 令牌 | 亮色值 | 暗色值 | 适用范围 |
| --- | --- | --- | --- |
| `--shadow-overlay` | `0 4px 16px rgba(34,37,42,.08)` | `0 4px 16px rgba(0,0,0,.5)` | 仅 dropdown / dialog / popover |

---

## 3. 令牌 — 暗色（`.dark`）

| 令牌 | Hex | OKLCH |
| --- | --- | --- |
| `--background` | `#16181c` | `oklch(0.209 0.009 264.4)` |
| `--foreground` | `#e8eaed` | `oklch(0.936 0.005 258.3)` |
| `--card` | `#1e2126` | `oklch(0.247 0.010 260.7)` |
| `--popover` | `#23262b` | `oklch(0.268 0.010 260.7)` |
| `--primary` | `#f6821f`（不变） | 同亮色 |
| `--primary-hover` | `#ff9438` | `oklch(0.766 0.163 56.7)` |
| `--secondary` | `#26292e` | `oklch(0.280 0.010 260.7)` |
| `--muted` | `#24272c` | `oklch(0.272 0.010 260.7)` |
| `--muted-foreground` | `#9aa0a6` | `oklch(0.703 0.011 248.0)` |
| `--success` | `#4ea768` | `oklch(0.657 0.127 151.0)` |
| `--warning` | `#d9a53f` | `oklch(0.752 0.131 80.9)` |
| `--destructive` | `#e05252` | `oklch(0.629 0.178 23.7)` |
| `--border` | `#33373d` | `oklch(0.335 0.012 258.4)` |
| `--input` | `#4a4e55` | `oklch(0.423 0.013 261.8)` |
| `--ring` | `rgba(246,130,31,.45)` | — |
| `--hover` | `#24272c` | 同 muted |
| `--selected` | `#232d3f` | `oklch(0.296 0.036 261.9)` |
| `--link` | `#6ba4f5` | `oklch(0.714 0.133 257.3)` |

暗色规则：**hover 加深 → 改为提亮**（`--primary-hover: #ff9438`）；橙保持不变；`--card` 比背景亮一档制造层级（仍靠边框，不靠阴影）。

---

## 4. 组件规格速览

源码：`src/components/ui/`。以下为 HTML + class 速查，与实现一一对应。

### 4.1 Button（`button.tsx`）

```html
<!-- default：橙底白字，hover 加深 -->
<button class="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4
               text-sm font-medium text-primary-foreground transition-colors
               hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-[var(--ring)]
               disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4">发布</button>

<!-- outline：白底 + 灰边（--input），hover 变 --hover 表面 -->
<button class="h-9 rounded-md border border-input bg-card px-4 text-sm hover:bg-hover">取消</button>

<!-- secondary：muted 底；ghost：透明，hover:bg-hover；destructive：红底白字 -->
```

| Variant | 底色 | hover |
| --- | --- | --- |
| `default` | `bg-primary` 橙 | `bg-primary-hover` 加深 |
| `outline` | `border-input bg-card` | `bg-hover` |
| `secondary` | `bg-secondary` | 加深 6%（color-mix foreground） |
| `ghost` | 透明 | `bg-hover` |
| `destructive` | `bg-destructive` 红 | 加深 |
| `link` | `text-link` | 下划线 |

尺寸：`sm h-8 text-xs` / `default h-9` / `lg h-10` / `icon size-9` / `icon-sm size-8`。统一 `rounded-md`、无阴影、无缩放动效。

### 4.2 Input / Textarea / Label（`input.tsx`）

```html
<input class="flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm
              placeholder:text-muted-foreground transition-colors
              focus-visible:outline-none focus-visible:border-primary
              focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary)_25%,transparent)]" />
```

- CF 式 focus：**边框变橙** + 橙 25% ring（不是阴影式 focus）。
- 高度 `h-9`，`rounded-md`，白底（暗色 = `--card`），无 shadow。

### 4.3 Card（`card.tsx`）

```html
<div class="rounded-lg border border-border bg-card text-card-foreground">
  <div class="flex flex-col gap-1.5 p-4 sm:p-5">…</div>
</div>
```

无阴影。卡片并列时靠 1px 边框分隔；灰底画布与白卡的对比即层级。

### 4.4 Badge（`primitives.tsx`）

```html
<!-- default：橙底白字 -->
<span class="inline-flex items-center gap-1 rounded-md border border-transparent bg-primary
             px-2 py-0.5 text-xs font-medium text-primary-foreground">PRO</span>
<!-- success：浅绿底 + 深绿字；warning：浅黄底 + 深黄字；destructive：浅红底 + 深红字 -->
<span class="rounded-md bg-[color-mix(in_srgb,var(--success)_14%,transparent)] text-[var(--success)] …">merged</span>
```

方角 `rounded-md`；状态色 = `color-mix` 透明软底 + 令牌深色文字；`secondary` = muted 灰；`outline` = 1px border 灰。

### 4.5 Tabs（`primitives.tsx`）

「白底容器 + 激活白块带边框」（与时间线页签协调）：

```html
<div role="tablist" class="inline-flex h-9 items-center gap-1 rounded-md border border-border
                           bg-card p-1 text-muted-foreground">
  <button role="tab" data-state="active"
          class="rounded-[4px] border border-transparent px-3 py-1 text-sm font-medium
                 data-[state=active]:border-border data-[state=active]:bg-card
                 data-[state=active]:text-foreground hover:text-foreground">文章</button>
</div>
```

激活项与容器同底色，仅以 1px 边框浮出——扁平且清晰。

### 4.6 开关 / 勾选（`primitives.tsx`）

- Switch：选中 `bg-primary` 橙，未选中 `bg-input` 灰；thumb 白色无阴影。
- Checkbox：`size-4 rounded-[4px] border-input`，选中橙底白勾。

### 4.7 Dialog / DropdownMenu / Popover（`dialog.tsx` / `dropdown-menu.tsx` / `primitives.tsx`）

```html
<!-- 容器：8px 圆角 + 1px 边框 + 唯一允许的浮层阴影 -->
<div class="rounded-lg border border-border bg-popover shadow-[var(--shadow-overlay)]">
<!-- menu item：hover 变 --hover 表面 -->
<div class="rounded-md px-2.5 py-1.5 text-sm focus:bg-hover">…</div>
```

Tooltip 保持深底白字（`bg-foreground text-background`），`rounded-md`。Avatar 带 `border border-border`。Skeleton `bg-muted rounded-md`。

### 4.8 品牌 Logo（`src/components/brand/logo.tsx`）

```tsx
import { BrandLogo } from "@/components/brand/logo";

<BrandLogo />                    // 图形 + "comit.sh" 字标，默认 24px
<BrandLogo size={20} />          // 导航条尺寸
<BrandLogo withWordmark={false} /> // 仅图形
```

图形 = "commit 节点"：一条水平时间线段 + 实心圆点。线段用 `currentColor`（自适应深浅色），圆点用 `var(--primary)` 橙（双模式恒定品牌色）。字标 `font-mono font-bold tracking-tight`，尺寸随 `size` 缩放（×0.58）。

---

## 5. 文章排版（`.article-prose`）与键帽

- 结构性排版（标题层级、间距、表格、代码块、KaTeX、mermaid）保留在 `globals.css`，调色全部走令牌。
- 正文链接：`color: var(--link)`，下划线 35% 透明同色。
- 行内 code：`background: var(--muted)`（亮色 = `#f0f1f3`）+ `1px solid var(--border)`，6px 圆角，mono 字体。
- blockquote：3px 橙色左边线 + 橙 5% 混白底。
- `.kbd` 键帽（CF 风）：`4px` 方角、灰边 `--input`、`--muted` 底、mono 字体、**无阴影**。
- 旧博客主题层 `.bt-*`（约 300 行）与 `.user-theme` 残留已全部删除，主题系统下线。

---

## 6. 图标规范

- 库：**lucide-react**，仅线性（stroke）图标，禁止混用填充风格。
- 默认尺寸 **16px**（ui 组件内由 `[&_svg]:size-4` 统一），行内小图标签 12–14px（badge 内 `[&_svg]:size-3`）。
- `strokeWidth` 沿用 lucide 默认 2；与文本同排时对齐 `text-muted-foreground` 或继承前景色。
- Logo 图形不使用 lucide，一律用 `BrandLogo`。

---

## 7. 可访问性

| 组合 | 对比度 | 说明 |
| --- | --- | --- |
| `--foreground` on `--background` | **13.85 : 1** | 正文，AAA |
| `--muted-foreground` on `#fff` | **5.05 : 1** | 次要文本，AA |
| `--link` on `#fff` | **5.42 : 1** | 正文链接，AA |
| `--success` on `#fff` | **5.07 : 1** | AA |
| white on `--destructive` | **5.78 : 1** | AA |
| white on `--primary` | 2.58 : 1 | 品牌取舍（同 Cloudflare 生产橙底白按钮）；hover 加深后 3.17 : 1 |
| white on `--primary-hover` | **3.17 : 1** | 大字号/UI 组件边界达标 |

- **Focus ring**：所有可交互控件 `focus-visible:ring-2 ring-[var(--ring)]`（橙 35%，暗色 45%），输入类 focus 额外 `border-primary`。禁止移除 outline 而不提供 ring 替代。
- 状态不得仅靠颜色传达：Badge/Tabs 同时有文字/边框差异；selected 表面需叠加边框或勾选标记。
- 暗色模式下 `--primary-hover` 提亮而非加深，保证 hover 反馈可见。
- 动效仅限 `fade-in / slide-up / pop-in` 三个 keyframes（150–300ms），无持续动画。

---

## 8. 迁移备注（给页面层代理）

- `shadow-[var(--shadow-soft)]` / `shadow-[var(--shadow-lift)]` → **直接删除**，卡片改 `rounded-lg border border-border bg-card`。
- `rounded-2xl/3xl` 面板 → `rounded-lg`；控件 `rounded-xl` → `rounded-md`。
- 行悬停 `hover:bg-muted` → `hover:bg-hover`（语义更准）；选中表面用 `bg-selected`。
- 深底导航/页脚可继续用 `--foreground`/`--card` 反转，不要引入新 hex。
