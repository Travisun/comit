# MyBlogs 博客主题系统（Blog Theme Framework）

> 插件化、继承式、增量覆盖的主题框架，服务于用户主页（home）与博文页（post）。
> 契约代码：`src/themes/types.ts`、`src/themes/registry.ts`；内置主题包：`src/themes/packs/`。

## 一、分层架构

```
┌────────────────────────────────────────────────────────────────┐
│ 4. 用户自定义 CSS   users.theme.customCss                        │  最高优先级
│    渲染为 .bt-scope 内的 <style>（经 sanitizeCss 清洗）           │
├────────────────────────────────────────────────────────────────┤
│ 3. 用户选项覆盖     users.theme.options                          │
│    只存被用户修改过的键（增量），由 resolve() 与默认值合并           │
├────────────────────────────────────────────────────────────────┤
│ 2. 主题包默认值     BlogTheme.resolve({})                        │
│    主题包声明选项清单 + 默认值，输出 --bt-* 内联 CSS 变量           │
├────────────────────────────────────────────────────────────────┤
│ 1. 基础设计令牌     globals.css :root / .dark                    │  最低优先级
│    （--background/--card/--primary/--radius … shadcn 命名）      │
└────────────────────────────────────────────────────────────────┘
```

实现载体是 CSS 自定义属性的级联：

1. `globals.css` 的 `.bt-scope` 为每个 `--bt-*` 声明**回落默认值**（引用基础令牌）；
2. 主题包 `resolve()` 返回的变量以**内联 style** 写在 `.bt-scope` 包装层上（第 2/3 层合并结果）；
3. 用户自定义 CSS 在包装层内部以 `<style>` 注入（第 4 层）。

### 增量覆盖与回落机制

- **合并逻辑**（`createResolver`，见 `src/themes/packs/_internal.ts`）：
  `merged = { ...Object.fromEntries(options.map(o => [o.key, o.default])), ...provided }`
  —— 用户配置里缺失的键自动回落主题默认值。
- **颜色回落**：颜色类选项的值 `'inherit'`（或空）→ `resolve()` **不输出**该变量
  → 级联回落到基础令牌，浅色/深色模式天然兼容。设为具体色值时才覆盖对应 `--bt-*`。
- **图片回落**：图片选项为空 → 不输出变量，无背景图层。
- **恢复默认**：清空 `options` 与 `customCss` 后仅存 `{ id }`，全部变量回落。

## 二、内置主题包

| 主题 | id | 风格 | preview |
| --- | --- | --- | --- |
| 晨晰 Classic | `classic` | 极简杂志风：白底卡片、蓝紫 accent、清爽 sans（站点默认） | bg `#ffffff` / accent `#4f46e5` / radius 12px |
| 墨韵 Ink | `ink` | 文学书卷气：Noto Serif SC 衬线、墨黑 + 朱砂红、字距加宽、竖排点缀、首字下沉 | bg `#f7f3ea` / accent `#a83f39` / radius 2px |

- 两包共享同一套基础选项键（布局/颜色/字体/背景/头图/细节），仅默认值不同 →
  用户切换主题时选项语义可迁移；Ink 额外独有「装饰」组（装饰边框/首字下沉/分节符）。
- Classic 29 个选项，Ink 32 个。
- 每主题内置 3 个推荐预设（`src/themes/packs/presets.ts`）：
  Classic「极简白 / 夜间蓝 / 暖纸」，Ink「宣纸 / 夜墨 / 青竹」。
- 主题包在 **import 时自注册**（`registerTheme`）；`ensureThemes()` 通过动态 import
  懒加载内置包（`globalThis` 单例、幂等），服务端渲染与定制中心均调用它。

## 三、选项类型与控件映射

设置页「主题定制中心」（`src/components/settings/appearance-form.tsx`）按
`ThemeOption` 自动生成控件：

| type | 控件 | 存储值 |
| --- | --- | --- |
| `color` | 取色器 + hex 文本框 + 「跟随默认」 | hex 字符串；`''`/`'inherit'` = 回落默认 |
| `select` | 下拉框 | 枚举字符串（服务端按 `options[].value` 校验） |
| `range` | 滑杆 + 数值（带单位） | 数字（服务端 clamp 到 min/max） |
| `toggle` | Switch | 布尔 |
| `image` | URL 输入 + 上传按钮（`POST /api/media/upload kind=cover`）+ 缩略图 | URL 字符串（http(s) / 站内 / `data:image/`） |
| `font` | 下拉 + 自定义字体名输入 | 选择值存 `key`，自定义名存 `key + "Custom"` |
| `text` | 文本框 | 字符串 |

分组 Tab 按 `option.group` 生成（布局 / 颜色 / 字体 / 背景 / 头图 / 细节 / 装饰）。
面板内含实时预览：内嵌迷你 mock 直接复用 `.bt-scope` 类与 `resolve()` 输出，
改动即所见；可切换 主页/文章页 两种 scope 预览。

## 四、槽位与语义变量全表

页面结构抽象为稳定槽位，主题通过令牌与布局选项驱动（全站移动端优先，媒体查询仅 `min-width`）：

```
[bt-header] [bt-hero] [bt-layout → bt-main(bt-content) | bt-aside] [bt-footer]
  bt-post-card · bt-post-list · bt-post-cover · bt-container
```

| 变量 | 消费方式 |
| --- | --- |
| `--bt-bg` / `--bt-card` / `--bt-fg` / `--bt-heading` / `--bt-link` / `--bt-accent` | 页面底色 / 卡片底 / 正文 / 标题 / 链接 / 强调（按钮、引用、装饰） |
| `--bt-bg-image` / `--bt-bg-opacity` / `--bt-bg-attachment` | 主页背景多层：底色 + 遮罩(color-mix) + 图片 |
| `--bt-post-bg` / `--bt-post-bg-image` | 文章页背景组，`data-scope="post"` 时优先消费 |
| `--bt-radius` / `--bt-card-shadow` / `--bt-content-width` | 卡片圆角 / 阴影(none·sm·md) / 内容列宽 |
| `--bt-font-body` / `--bt-font-heading` / `--bt-font-size` / `--bt-line-height` / `--bt-heading-weight` | 排版（`.article-prose` 同步消费） |
| `--bt-hero-image` / `--bt-hero-gradient` / `--bt-hero-display` / `--bt-hero-height` | 头图区（6 种渐变预设） |
| `--bt-link-underline` / `--bt-img-radius` / `--bt-table-style` | 细节（下划线开关 / 图片圆角 / 表格 default·striped·minimal） |
| `--bt-density`（→ `--bt-list-gap`） | 列表密度 compact·cozy·spacious |
| `--bt-deco-frame` / `--bt-dropcap` / `--bt-section-divider` | Ink 装饰：边框 frame·double / 首字下沉 / 分节符 dot·line·ornament |
| `--bt-post-cover-display` | 文章页封面图开关 |

枚举型变量同时由 `UserStyleShell` 映射为 data 属性供纯 CSS 分支：
`data-sidebar`、`data-density`、`data-table-style`、`data-deco-frame`、`data-dropcap`、
`data-section-divider`（配合 `data-blog-theme`、`data-scope`）。

## 五、主题 API

- `GET /api/me/theme` →
  `{ theme: UserThemeConfig|null, themes: [{id,name,description,preview}], optionSchemas: {[themeId]: ThemeOption[]} }`
- `PUT /api/me/theme` body `{ id?, options?, customCss? }`（zod 校验）：
  - `customCss ≤ 20000` 字符；
  - `options` 按 schema 粗验（颜色 hex/空、select 枚举、range clamp、toggle 布尔、image URL 前缀、font 枚举），
    未知键丢弃、等于默认值/空值的键不存 → **只存增量**；
  - 写 `users.theme` jsonb，返回保存后的配置。
- 组件数据流：定制中心挂载时 `GET`，保存时 `PUT` 增量差集（`diffAgainstDefaults`）。

## 六、开发新主题包

1. 复制 `src/themes/packs/classic.ts`（或直接复用 `_internal.ts` 的 `baseOptions` /
   `createResolver`），改造默认值、preview、文案；需要新选项时在 options 数组追加
   `ThemeOption`（新组只需新的 `group` 字符串）。
2. 末尾 `registerTheme({ id, name, description, preview, options, resolve })` ——
   import 即自注册。
3. 在 `src/themes/registry.ts` 的 `ensureThemes()` 中追加一行
   `await import("./packs/<your-pack>")`。
4. （可选）在 `packs/presets.ts` 加推荐预设。
5. 完成：`GET /api/me/theme` 会自动带出新主题与 schema，定制中心自动渲染。

## 七、自定义 CSS 可用变量与示例

`.bt-scope` 内可使用全部 `--bt-*` 变量（见第四节）与任意选择器，例如：

```css
/* 标题染色 + 去掉二级标题下划线 */
.article-prose h2 { color: var(--bt-accent); border-bottom: none; }

/* 卡片悬浮上浮 */
.bt-post-card:hover { transform: translateY(-2px); }

/* 只改文章页底色 */
.bt-scope[data-scope="post"] { --bt-post-bg: #f6f1e7; }
```

## 八、安全策略

- 自定义 CSS 由 `UserStyleShell.sanitizeCss` 清洗：移除 `</style`、`javascript:`、
  `@import`、`expression(`，并截断到 20000 字符；API 层同样限制长度。
- 这是**博客作者对自己公开页面的样式**，不属于多租户注入面：CSS 无法执行脚本，
  风险面限于作者自身页面的观感；定制中心的编辑器会对将过滤的片段即时标红提示。
- 图片 URL 只接受 `https?://`、站内 `/…`、`data:image/`；引号/反斜杠/换行在拼入
  `url("…")` 前被剥离。

## 九、移动端优先规则

- `globals.css` 主题层全部使用 `min-width` 媒体查询；默认（手机）单列布局，
  侧边栏自然下落到内容之后；`≥768px` 才启用 `bt-layout` 两列网格
  （`data-sidebar="left|right"` 决定列序）。
- 背景图使用 `background-size: cover`，深浅色模式通过 `'inherit'` 回落基础令牌保证可读性。
