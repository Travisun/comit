import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, pool } from "./index";
import {
  comments,
  follows,
  keywords,
  likes,
  postTopics,
  posts,
  topics,
  users,
} from "./schema";
import { hashPassword } from "../lib/auth/password";
import { makeExcerpt, slugifyTitle } from "../lib/utils";

/**
 * Development seed: admin + two demo users, demo articles/short post,
 * keyword blacklist samples, topics, follows, comments and a like.
 * Idempotent: exits early when the admin account already exists.
 * Run via `pnpm db:seed`.
 */

const daysAgo = (n: number, hourOffset = 0): Date =>
  new Date(Date.now() - n * 86400_000 + hourOffset * 3600_000);

const ALICE_ARTICLE_1 = `设计系统的核心挑战在于**一致性**。Token 化是把颜色、字号、间距这些视觉决策抽象为命名变量的过程，让"像素级还原"变成"契约级还原"。

## 为什么需要 Token

当组件库需要跨 Web 与客户端复用时，硬编码的样式会迅速失控。Token 提供了一层与平台无关的契约：

| 层级 | 示例 | 说明 |
| --- | --- | --- |
| 基础 | \`gray.500\` | 原始色板，不直接用于业务 |
| 语义 | \`surface.primary\` | 与用途绑定，主题切换的最小单位 |
| 组件 | \`button.bg\` | 组件级覆盖，收敛特例 |

## 代码即真相

Token 的单一来源放在仓库里，随 CI 同步到 Figma 与各端：

\`\`\`ts
export const space = {
  xs: "4px",
  sm: "8px",
  md: "16px",
  lg: "24px",
} as const;
\`\`\`

## 一致性守恒

设计系统的质量守恒公式同样成立：$E = mc^2$ —— 一致性（$E$）等于规范程度（$m$）乘以执行力的平方（$c^2$）。规范再好，执行松散一次，成本就是平方级的。

构建流程可以用下面的流程图概括：

\`\`\`mermaid
flowchart LR
  A[Figma Tokens] --> B[token.json]
  B --> C[Style Dictionary]
  C --> D[CSS Variables]
  C --> E[iOS / Android]
\`\`\`

> 小结：先立标准，再谈组件。Token 是设计系统得以规模化的地基。`;

const ALICE_ARTICLE_2 = `组件库最常见的死法不是写得烂，而是**没人敢改**。可维护性是被流程设计出来的，不是被重构出来的。

## 设计与工程共用一份语言

Figma 中的变体（Variants）应与代码 Props 一一对应：

1. 用 Figma Variables 管理颜色与字号 Token
2. 组件命名与代码导出名保持一致
3. 每个变体对应一条 Storybook story，视觉回归自动化

## 版本策略

\`\`\`bash
pnpm changeset      # 语义化版本
pnpm build:tokens   # 重新生成样式产物
\`\`\`

| 发布类型 | 触发条件 | 通知对象 |
| --- | --- | --- |
| patch | 视觉微调 | 全体 |
| minor | 新组件 | 前端组 |
| major | 破坏性变更 | 全员评审 |

> 工具会过时，流程不会。可维护性的本质是"改变的成本"足够低。`;

const BOB_ARTICLE = `三年前我用 Node.js 写了第一版博客引擎，上周我决定用 Rust 重写它。

## 为什么是 Rust

- 单二进制部署，不再折腾服务器依赖
- \`cargo\` 的构建缓存让 CI 从 3 分钟降到 20 秒
- 类型系统逼我把 Markdown 渲染管线的每一步都想清楚

## 渲染管线

\`\`\`rust
fn render(md: &str) -> Result<String, RenderError> {
    let ast = markdown::parse(md)?;
    let html = highlight(&ast)?;
    Ok(html.to_string())
}
\`\`\`

## 收获

重写最大的收获不是性能，而是**约束**：编译器不允许我偷懒，错误路径必须显式处理。

如果你也在维护一个年久失修的小项目，重写未必是坏选择——前提是你已经知道所有旧坑在哪里。`;

const BOB_SHORT = `深夜把博客引擎的构建时间从 3 分钟压到 20 秒。Rust 的增量编译是真香，喝茶，看日志，等 CI 变绿。`;

async function main() {
  console.log("[seed] checking admin account…");
  const [existingAdmin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, "admin@myblogs.local"))
    .limit(1);
  if (existingAdmin) {
    console.log("[seed] admin@myblogs.local 已存在，跳过种子数据。");
    return;
  }

  const passwordHash = await hashPassword("Admin123456");

  /* ------------------------------ users ------------------------------ */
  const [admin, alice, bob] = await db
    .insert(users)
    .values([
      {
        email: "admin@myblogs.local",
        username: "admin",
        displayName: "站长",
        bio: "平台管理员",
        role: "admin",
        emailVerifiedAt: new Date(),
        passwordHash,
      },
      {
        email: "alice@myblogs.local",
        username: "alice",
        displayName: "Alice Chen",
        bio: "设计工程师 ✏️",
        role: "user",
        emailVerifiedAt: new Date(),
        passwordHash,
      },
      {
        email: "bob@myblogs.local",
        username: "bob",
        displayName: "Bob Wang",
        bio: "Rust 与分布式系统",
        role: "user",
        emailVerifiedAt: new Date(),
        passwordHash,
      },
    ])
    .returning({ id: users.id, username: users.username });
  console.log(`[seed] users created: ${admin.username}, ${alice.username}, ${bob.username}`);

  /* ---------------------------- keywords ----------------------------- */
  await db
    .insert(keywords)
    .values([
      { word: "spam-link-01", severity: "block", category: "spam" },
      { word: "fake-giveaway", severity: "block", category: "scam" },
      { word: "test-banned", severity: "block", category: "general" },
      { word: "促销链接", severity: "warn", category: "marketing" },
      { word: "test-warn", severity: "warn", category: "general" },
      { word: "sample-ad", severity: "warn", category: "marketing" },
    ])
    .onConflictDoNothing({ target: keywords.word });
  console.log("[seed] keyword blacklist seeded (6 harmless demo words)");

  /* ----------------------------- topics ------------------------------ */
  const topicRows = await db
    .insert(topics)
    .values([
      { slug: "design-systems", name: "设计系统", description: "Token、组件库与设计工程实践" },
      { slug: "frontend-engineering", name: "前端工程", description: "构建、发布与工程化" },
      { slug: "rust", name: "Rust", description: "系统编程与性能优化" },
    ])
    .onConflictDoNothing({ target: topics.slug })
    .returning({ id: topics.id, slug: topics.slug });
  const topicBySlug = new Map(topicRows.map((t) => [t.slug, t.id]));

  /* ------------------------------ posts ------------------------------ */
  const [alicePost1, alicePost2, bobPost] = await db
    .insert(posts)
    .values([
      {
        authorId: alice.id,
        type: "article",
        slug: slugifyTitle("设计系统 Token 化实践"),
        title: "设计系统 Token 化实践",
        summary: makeExcerpt(ALICE_ARTICLE_1),
        content: ALICE_ARTICLE_1,
        status: "published",
        publishedAt: daysAgo(3, 2),
        createdAt: daysAgo(3, 2),
        updatedAt: daysAgo(3, 2),
        views: 128,
      },
      {
        authorId: alice.id,
        type: "article",
        slug: slugifyTitle("从 Figma 到代码：构建可维护的组件库"),
        title: "从 Figma 到代码：构建可维护的组件库",
        summary: makeExcerpt(ALICE_ARTICLE_2),
        content: ALICE_ARTICLE_2,
        status: "published",
        publishedAt: daysAgo(2, 5),
        createdAt: daysAgo(2, 5),
        updatedAt: daysAgo(2, 5),
        views: 86,
      },
      {
        authorId: bob.id,
        type: "article",
        slug: slugifyTitle("用 Rust 重写我的博客引擎"),
        title: "用 Rust 重写我的博客引擎",
        summary: makeExcerpt(BOB_ARTICLE),
        content: BOB_ARTICLE,
        status: "published",
        publishedAt: daysAgo(1, 3),
        createdAt: daysAgo(1, 3),
        updatedAt: daysAgo(1, 3),
        views: 203,
      },
      {
        authorId: bob.id,
        type: "short",
        slug: null,
        title: null,
        summary: makeExcerpt(BOB_SHORT, 80),
        content: BOB_SHORT,
        status: "published",
        publishedAt: daysAgo(1, 9),
        createdAt: daysAgo(1, 9),
        updatedAt: daysAgo(1, 9),
        views: 42,
      },
    ])
    .returning({ id: posts.id, title: posts.title });

  await db.insert(postTopics).values(
    [
      { postId: alicePost1.id, topicId: topicBySlug.get("design-systems") },
      { postId: alicePost2.id, topicId: topicBySlug.get("frontend-engineering") },
      { postId: alicePost2.id, topicId: topicBySlug.get("design-systems") },
      { postId: bobPost.id, topicId: topicBySlug.get("rust") },
    ].filter((r): r is { postId: string; topicId: string } => Boolean(r.topicId)),
  );
  console.log("[seed] posts created: 3 articles + 1 short, topics linked");

  /* -------------------------- social graph --------------------------- */
  await db.insert(follows).values([
    { followerId: alice.id, followeeId: bob.id },
    { followerId: bob.id, followeeId: alice.id },
  ]);

  await db.insert(comments).values([
    {
      postId: bobPost.id,
      userId: alice.id,
      body: "单二进制部署太爽了，我们内部工具也这么干，运维成本几乎为零。",
      createdAt: daysAgo(1, 5),
    },
    {
      postId: bobPost.id,
      userId: alice.id,
      body: "求一篇代码高亮部分的展开，好奇你是怎么处理语法树的？",
      createdAt: daysAgo(0, 4),
    },
  ]);
  await db.update(posts).set({ commentCount: 2 }).where(eq(posts.id, bobPost.id));

  await db.insert(likes).values({ userId: alice.id, targetType: "post", targetId: bobPost.id });
  await db.update(posts).set({ likeCount: 1 }).where(eq(posts.id, bobPost.id));
  console.log("[seed] follows / comments / like seeded");

  console.log(`
[seed] done. 登录账号：
  管理员  admin@myblogs.local / Admin123456
  演示    alice@myblogs.local / Admin123456
  演示    bob@myblogs.local   / Admin123456`);
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error("[seed] failed:", err);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
