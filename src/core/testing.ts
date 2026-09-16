import { like } from "drizzle-orm";
import { hashPassword } from "@/lib/auth/password";
import { db } from "@/db";
import { posts, users } from "@/db/schema";

/**
 * 扩展测试工厂 — 直接作用于 DATABASE_URL 指向的数据库（建议本地开发库）。
 * 所有工厂创建的数据带 `test-` 前缀标识，`cleanupTestFixtures()` 一键清理。
 */

export async function createTestUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const username = `test-user-${Math.random().toString(36).slice(2, 8)}`;
  const [row] = await db
    .insert(users)
    .values({
      email: `${username}@test.local`,
      username,
      displayName: "测试用户",
      passwordHash: await hashPassword("test-password-1"),
      ...overrides,
    })
    .returning();
  return row;
}

export async function createTestPost(
  authorId: string,
  overrides: Partial<typeof posts.$inferInsert> = {},
) {
  const [row] = await db
    .insert(posts)
    .values({
      authorId,
      type: "short",
      content: "测试动态内容",
      status: "published",
      ...overrides,
    })
    .returning();
  return row;
}

/** 清理本工厂产生的数据（按 test- 用户名前缀）。 */
export async function cleanupTestFixtures() {
  await db.delete(users).where(__likeUsername());
}

function __likeUsername() {
  return like(users.username, "test-user-%");
}

/* ------------------------- Action 集成测试工具（E2） ------------------------- */

/**
 * 直接调用 Action（无需启动 HTTP 服务器）：
 *
 *   const res = await callAction(toggleLike, { json: { targetType: "post", targetId } });
 *   expect(res.status).toBe(200);
 *
 * 鉴权：auth: "user" 的 Action 需要真实会话 —— 集成测试里先走
 * /api/auth/login 流程拿 cookie（或用 createTestUser + createSession 注入），
 * 把 cookie 传入 opts.cookie。
 */
export async function callAction(
  def: {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    path: string;
  },
  opts: { json?: unknown; cookie?: string; method?: string } = {},
): Promise<Response> {
  const method = opts.method ?? def.method;
  const req = new Request(`http://localhost${def.path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    body: method === "GET" ? undefined : JSON.stringify(opts.json ?? {}),
  });
  const { runAction } = await import("@/core/capabilities/actions");
  return runAction(req, def as never);
}
