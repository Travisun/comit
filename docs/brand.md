# comit.sh 品牌手册（Brand Book）

> 最后更新：2026-09-21 · 维护人：品牌文案与内容策略
> 线上品牌故事页：`/about`（`src/app/(site)/about/page.tsx`）· 全量文案字典：`src/lib/i18n/dict.ts`（`brand.*` / `about.*` / `empty.*` 命名空间）

## 一、命名

**comit.sh**（小写，读作 /kəˈmɪt/，与 commit 同音）。

品牌一句话主张：

- 英文：**Commit your ideas.**
- 中文：**把想法，提交给时间。**

叙事主旨：提交，是技术世界最古老的仪式——从 1956 年的 MIT 主机，到你指尖的每一次 git commit。comit.sh 把这个仪式，变成你的个人主页。

产品定位：**技术人的个人主页——长文与动态，住在同一条时间线**；占位一句话：**有社交的主权，有沉淀的日常**。定位策划全案（竞争格局、平台故事、人群、社区文化、氛围、文案体系）见 [docs/positioning.md](positioning.md)，README 顶部与 /about 的定位表述以该文档为准。

## 二、语源叙事（four origins）

四处叙事是品牌的核心资产，/about 页、对外介绍、法务文本的呼应均出自这里（dict 键 `brand.commit.line1/2/3` 为标准三行版本）：

| # | 语源 | 年代/领域 | 一句话 |
| --- | --- | --- | --- |
| 1 | **COMIT（MIT, 1956）** | 1956 · 编程语言 | 史上最早的字符串处理与模式匹配编程语言之一——"提交"作为计算原语的历史起点 |
| 2 | **git commit** | 2005 至今 · 每个工程师 | 每个工程师每天的动作——把想法固化为版本 |
| 3 | **COMIT Network** | Web3 · 开源协议 | 著名的开源跨链路由协议（去中心化原子交换，comit.network） |
| 4 | **Datacom COMIT** | 大型机 · 事务命令 | 大型机 Datacom 数据库中执行事务提交、释放独占锁定的底层命令 |

**叙事纪律**：四个语源并列时保持同一节奏（年份/领域标签 + 名称 + 2-3 句正文）；第 3 条（COMIT Network）必须写明"同名不同命/与本项目无隶属关系"的界限感（当前 about 页正文已体现），不得暗示任何关联或背书。

## 三、语调（Voice）

三个关键词：**工程感、克制、有历史纵深**。

- 像一个资深工程师在 README 里说话，不像市场部在写横幅。
- 中文为第一语言（zh 默认），英文同步维护且语义对等；英文不是中文的机翻腔。
- 数字、版本、年代、代码使用等宽字体/`num` 类（tabular-nums），让"记录感"可视化。
- 空态是品牌的最佳广告位：用"第一次 commit"的仪式感替代"暂无数据"的冰冷。

### 文案 Do

- Do：用"提交 / commit / 时间线 / 主页 / 记录 / 版本"等词建立隐喻一致性
- Do：空态给行动指引与情绪（「时间线是空的 —— commit something.」）
- Do：法务文本在精确的前提下呼应品牌（如版权页强调"提交的主角始终是你"）
- Do：中英键值同步修改，`en` 由 TS 类型强制与 `zh` 键集一致
- Do：UI 文案短句优先，动词开头

### 文案 Don't

- Don't：营销腔与感叹号轰炸（"立即加入！超赞体验！！"）
- Don't：把产品叫"博客平台"或"社交网络"——是"技术人的个人主页"；内容称"内容/文章/研究"按语境（去博客腔）
- Don't：承诺平台没有的功能，或在品牌文案里引入法务未确认的权利表述
- Don't：滥用 emoji 与网络流行语；克制不是冷漠，幽默限于空态与低风险场景
- Don't：在品牌物料之外硬编码品牌色/品牌名——品牌名走 `config.app.name` 或 dict `app.name`，色彩走主题 token（见下）

## 四、色彩与排版（引用关系）

品牌主色为 **#f6821f**（Cloudflare 橙，设计代理已落地为设计系统）。**注意：实际取值以设计系统为准，品牌物料不得硬编码**——一律引用主题 token：

| 用途 | 引用 | 说明 |
| --- | --- | --- |
| 品牌主色（浅/深色） | `--primary` → `src/app/globals.css`（`#f6821f`，hover 态另有 `--primary-hover`） | Tailwind class 用 `text-primary` / `bg-primary` |
| 表面/边框/文字层级 | `--card` / `--border` / `--muted-foreground` 等同文件 token | 扁平设计：实色 + 1px 边框，阴影仅浮层可用 |
| 数值/年代等宽 | `.num` 工具类（`globals.css`，`font-variant-numeric: tabular-nums`）与 `font-mono` | 代码、commit log、统计数据必用 |
| 圆角 | `--radius`（8px）及 sm/md/lg/xl 派生 | 控件 6px、面板 8px、大面 12px |

字体：正文 `--font-sans`（系统栈）、标题同栈加粗、代码 `--font-mono`（SF Mono / JetBrains Mono 栈）；可选衬线 `--font-serif` 用于文章正文偏好。

排版基线：单列叙事页 `max-w-2xl`，法务页 `max-w-3xl`，社区页 `max-w-6xl`；行高正文 1.6-1.75，标题 `tracking-tight`。

## 五、资产与落点

| 资产 | 位置 |
| --- | --- |
| 品牌故事页 | `src/app/(site)/about/page.tsx` |
| 中英文案字典（品牌/空态命名空间） | `src/lib/i18n/dict.ts` |
| SEO 品牌文案（title 模板 / description / OG） | `src/lib/seo.ts` |
| 法务文风（服务协议 / 隐私 / 版权） | `src/app/(site)/legal/**` |
| 截图占位 | `docs/assets/`（待补充首页与主页截图） |
