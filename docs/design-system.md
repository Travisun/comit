# comit.sh 控制台设计规范（对齐 Stripe Dashboard）

> 基调：**白纸 + 发丝线 + 留白**。来源：Stripe Dashboard 生产 CSS（Sail 设计系统）与页面 DOM 提取。
> 本文档是全站契约。所有页面/组件只允许消费本文定义的令牌与 `src/components/ui/` 组件，禁止自造阴影、渐变、圆角、硬编码色值。

## 前台纸感主题（theme-paper，E-Ink / Paper）

前台（`SiteShell` 包裹的页面，含 auth bare 页）在浅色模式下启用纸感主题：SiteShell
挂载时给 `<body>` 加 `.theme-paper`，卸载时移除——**管理后台（dashboard 组）不经过
SiteShell，永远保持本文件的 Stripe 原版令牌**。

- 作用域：`:root:not(.dark) .theme-paper`（深色模式维持原深色调色板）
- 画布 `#f1ece1` / 面板 `#fdfbf7` / 墨黑前景 `#1c1b18` / 暖发丝线 `#e6dfd0`
- `--primary` 为墨黑（编辑风黑色 CTA），`--link` 同为墨色
- 文章正文（`.article-prose`）在前台使用衬线阅读字体（系统宋体栈，后续可换自托管
  子集化的思源宋体），UI 控件仍为无衬线
- 社交动作的语义色（点赞红/转推绿/强调蓝）保留，作为单色系里的功能 affordance


## 令牌速查

| 令牌 | 值 | 用途 |
|---|---|---|
| `--background` | #ffffff | 页面画布（全白） |
| `--foreground` | #1a1f36 | 标题/重点文字 |
| `--text-body` | #4f566b | 正文（gray-600） |
| `--muted-foreground` | #697386 | 次要文字（gray-500） |
| `--border` | #e3e8ee | 发丝线（gray-100） |
| `--primary` | #5469d4 | 主色（blue-500） |
| `--link` | #5469d4 | 链接 |
| `--success / --warning / --destructive` | #09825d / #983705 / #cd3d64 | 状态色 |
| `--selected` | #eceef4 | 激活药丸/计数徽章底 |
| `--hover` | #eef1f5 | 行/控件 hover |
| `--shadow-card` | none | 卡片无投影，仅 1px 边框 |

## 页面骨架（固定，勿改）

```
固定左侧栏 240px（品牌 + 分组导航，右缘 1px 竖线）
右侧：sticky 无边框 header（44px）+ 白底内容区
admin 内容区：max-w-7xl + p-4 md:p-6 lg:p-8
```

## 页面级模式

### 1. 页头（PageHeader — admin/bits.tsx）
标题 `text-xl font-semibold tracking-tight`（仅一处 h1）；描述 `text-sm text-muted-foreground`；动作右置、仅一个主操作。

### 2. 列表页三件套（Transactions/Customers/Invoices 模式）
`PageHeader → 工具栏（搜索框 + FilterChips + 右侧主操作）→ DataTable → Pagination`。
搜索框宽 ≤ 320px（Sail 字段样式：白底 + keyline + 前置搜索图标）。

### 3. 数据表（ui/table.tsx DataTable）
白色平面 + 1px 发丝边框，**无投影**（db-NewChrome 规范）。表头透明 + 底部发丝线 + `text-xs text-muted-foreground`（th px-3 py-2）。行底部发丝线、`hover:bg-[var(--hover)]`（td px-3 py-2.5）。徽章用 `Badge` 描边药丸。数字/时间列右对齐 + `tabular-nums` + muted。行内操作用 `size-sm`（28px）按钮。

### 4. 筛选 chips（Stripe `db-InlineFilterButton`）
未选中：`rounded-md px-2.5 py-1.5 bg-[var(--muted)] text-[color:var(--text-body)]`；hover `var(--hover)`；选中：浅色填充 + 同系 500 文字色。用 `bits.FilterChips`。

### 5. 空状态（Stripe `bs-MissingWell`）
**无虚线边框**。`bg-[var(--muted)]` 圆角、居中 `py-12`、标题 foreground + 描述 muted + 可选主按钮。用 `bits.EmptyState`。

### 6. 分页
左「共 N 条 · 第 x/y 页」text-xs muted；右 上一页/下一页 `outline size-sm`。用 `bits.Pagination`。

### 7. 统计卡（Home 模式）
Card（keyline 白卡）：标签 muted + 数值 `text-2xl font-semibold tabular-nums` + 副信息 text-xs muted；右上 `size-9` 图标位（主色 10% tint）。用 `bits.StatCard`。

### 8. 表单（ui/settings.tsx）
标题/描述裸排白底（tab 页内**不重复标题**）。`SettingField`（label 上/控件/hint 下）、`PropertyRow`（属性行）、`SettingRow`（开关行 + divide-y）、`SettingsFooter`（主按钮左置、无分割条）、`RadioOption / CheckOption`、`Notice`。脏状态：无改动时保存按钮禁用 + 「没有未保存的更改」提示；保存中显示「保存中…」。

### 9. tab（多小节页面）
`SectionTabs`：文本 tab、行底发丝线、激活项 `border-b-[3px] border-primary`。页面标题 → tab 条 → 仅渲染当前小节，小节内**不再重复标题文字**。

### 10. 状态语义
success（已发布/正常）→ Badge "success"；pending/待审 → "warning"；rejected/封禁 → "destructive"；草稿/类型 → "secondary"/"outline"。

## 禁止事项

- ❌ 卡片套卡片：面板不包边框盒子，只有表格/数据列表有 keyline
- ❌ 卡片投影（--shadow-card = none）
- ❌ 硬编码色值（一切走令牌）
- ❌ 页面多个大标题
- ❌ 虚线边框空状态
