# 内容标注体系（Content Labels）

MyBlogs 的发布内容标注体系，参考抖音等主流平台的「内容标柱事项」惯例：让作者在发布时声明内容属性（原创 / AI 参与 / 转载 / 观点 / 推广），并在阅读侧以统一徽章展示，提升平台合规性与社区信任。

## 1. 标注类型总表

定义位于 `src/lib/content-labels.ts`（`CONTENT_LABELS`），与 `posts.label` 列（`varchar(24)`，默认 `original`）一一对应。

| id | 名称（zh / en） | 颜色 | 适用场景 | 需要来源 | 图标 |
|---|---|---|---|---|---|
| `original` | 原创 / Original | 绿 `#16a34a` | 作者声明内容为本人原创（默认值） | 否 | UserCheck |
| `ai_assisted` | AI 辅助 / AI-assisted | 蓝 `#2563eb` | 部分内容由 AI 工具辅助生成，作者已审核修改 | 否 | Sparkles |
| `ai_generated` | AI 生成 / AI-generated | 靛 `#4f46e5` | 内容主要由 AI 自动生成 | 否 | Bot |
| `repost` | 转载 / Repost | 灰 `#6b7280` | 内容转载自外部来源，版权归原作者 | **是（强制 http(s) URL）** | Repeat2 |
| `opinion` | 个人观点 / Opinion | 橙 `#ea580c` | 评论性内容，仅代表作者个人立场 | 否 | Lightbulb |
| `sponsored` | 赞助内容 / Sponsored | 黄 `#ca8a04` | 商业推广 / 赞助 / 恰饭内容 | 否 | Megaphone |

每篇内容**有且仅有一个** label；`repost` 额外携带 `posts.source_url`（原文地址）与 `posts.source_name`（来源名称，可选）。

## 2. 为什么需要内容标注

- **平台合规**：AI 生成内容标识、转载授权与署名、商业推广披露等正在成为各国监管与主流平台的通用要求（如抖音要求 AI 内容与广告内容主动标注；中国《生成式人工智能服务管理暂行办法》《人工智能生成合成内容标识办法》均提出标识要求）。
- **社区信任**：读者能一眼区分「原创经验 / AI 汇总 / 转载资讯 / 恰饭推荐」，减少误导；如实标注的作者获得更多推荐与信任，未如实标注的内容会损失社区信用。
- **免责与版权**：转载标注 + 原文链接（`nofollow`）是对原作者的基本尊重，也降低平台与作者的版权风险；「个人观点」标注帮助平台与读者区分内容与平台立场。
- **不参与审核**：label 仅是声明性元数据，**不参与**关键词 / LLM 审核流的判定（见 `src/lib/moderation.ts`）。

## 3. 编辑器使用说明

### 文章编辑器（`src/components/editor/article-editor.tsx`）

- 发布设置面板新增「内容标注」卡片组（位于「可见性」与「摘要」之间）：
  - 单选列表：每个 label 一行（radio 圆点 + 彩色徽章预览，hover 徽章显示说明 tooltip）；
  - 默认选中 `original`；切换选择后，列表下方立即显示所选标注的说明文案；
  - 选中 `repost`：展开「原文地址（必填）」与「来源名称（可选）」输入框；保存前做客户端校验（必须 `http(s)://…`），不通过则 toast 阻断提交；
  - 选中 `ai_assisted` / `ai_generated`：显示温馨提示（平台鼓励如实披露 AI 参与；未如实标注可能影响推荐与社区信任）；
  - 标注数据随「保存草稿 / 发布」一并提交；编辑已有文章时从 `EditorPost` 回显（`/write/[id]` 页面传入 `label/sourceUrl/sourceName`）。
- 未知 / 历史 label 值会通过 `getLabelDef()` 归一化为 `original`。

### 短动态编辑器（`src/components/editor/short-post-editor.tsx`）

- 编辑器上方一行轻量标注 chips：`original`（默认）/ `repost` / `opinion`；
- 点选 chip 即切换；选中 `repost` 时在 chips 下方展开简化的原文地址输入框（必填校验同上）。

## 4. API 字段说明与校验规则

实现位于 `src/app/api/posts/_shared.ts`（`labelFieldsSchema` / `resolveLabelFields`），`POST /api/posts` 与 `PUT /api/posts/[id]` 共用。

### 请求字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `label` | `string` enum，可选 | `original \| ai_assisted \| ai_generated \| repost \| opinion \| sponsored`；POST 缺省为 `original`；PUT 缺省表示**保持不变** |
| `sourceUrl` | `string` ≤2048，可选 | 转载原文地址；非 repost 请求会被忽略并清库为 `null` |
| `sourceName` | `string` ≤200，可选 | 来源名称；非 repost 同上 |

### 校验规则

| 场景 | 行为 |
|---|---|
| `label=repost` 且无有效 `sourceUrl`（含 PUT 时库里也没有） | **400**「转载内容需填写原文地址 / Reposts require a valid http(s) source URL」，code `validation_error` |
| `label=repost` 且 `sourceUrl` 非 `http(s)://` 前缀 | 同上 400 |
| `label=repost`，PUT 未传 `sourceUrl` | 回退使用该行已存的 `sourceUrl` / `sourceName`（编辑时无需重复填写） |
| `label` ≠ `repost` | 忽略请求中的 `sourceUrl` / `sourceName`，**清库为 `null`**（例：PUT 改回 `original` → 来源字段被清空） |
| `ai_assisted` / `ai_generated` / 其他 | 无附加条件，直接持久化 |
| `label` 取值不在枚举内 | zod 400（`label: Invalid option`） |

### 持久化与返回

- 写入 `posts.label / posts.source_url / posts.source_name`；
- `GET /api/posts/[id]` 与 POST/PUT 的响应均包含 `label / sourceUrl / sourceName`。

## 5. 展示规范

组件：`src/components/posts/annotation-badge.tsx` 的 `AnnotationBadge`（客户端组件，带 hover 说明 tooltip；`repost` 渲染为指向原文的 `<a target="_blank" rel="nofollow noopener noreferrer">`，附带来源名后缀与外链图标）。

| 场景 | 规范 |
|---|---|
| 文章页顶部 | `size="md"`；**`original` 也展示**（原创声明是重要信息）；建议位置：标题之下、特色图之上 |
| 列表 / 卡片 | `size="sm"`；卡片场景调用方可自行决定隐藏 `original`（组件保持简单，由调用方条件渲染） |
| 短动态 feed | `size="sm"`，同卡片规范 |
| 链接行为 | 仅 `repost` 且有 `sourceUrl` 时为链接；点击不冒泡（不会触发卡片整体跳转） |

> 主代集成提示：在 `src/components/user-space/post-view.tsx` 中，于 `<h1>`（约 L108）与特色图（约 L139）之间插入
> `<AnnotationBadge label={post.label} sourceUrl={post.sourceUrl} sourceName={post.sourceName} size="md" />`。

## 6. 后续扩展建议

- **新标注类型**：`fiction`（虚构演绎 / 同人创作）、`news`（资讯 / 快讯，需注明时效）等，只需在 `CONTENT_LABELS` 增加定义并保持枚举同步（`label` 列长 24 足够）。
- **强制 AI 标注的站点开关**：站点设置增加「AI 内容必须标注」开关，提交时在 `runSubmitCheck` 一并校验。
- **多标签**：当前为一维 label（对齐抖音主标注模式）；如需组合（如「转载 + AI 翻译」），可演进为 jsonb 数组列并让 Badge 支持并列展示。
- **社区举报联动**：标注与实际内容不符（如原创声明实为搬运）可接入举报理由与信用分体系。
- **SEO / 元信息**：AI 标注可输出到 JSON-LD 或 `<meta name="generator">` 类信号（视搜索引擎规范）。
