// 被测模块：src/extensions/mcp/server.ts —— MCP 工具 handler 的越权绑定、
// 入参上限与返回投影（公开前的攻击面清单：IDOR、拖库分页、审核绕过、信息泄露）。
// 依赖 mock 风格参照 src/lib/storage/storage.test.ts：vi.hoisted 收口可编程
// fake db（thenable 链式构建器 + 队列化结果 + 方法调用记录），全程无真实 DB。
// drizzle-orm 的 eq/ilike 被包成 spy：用列对象同一性断言「WHERE userId 绑定」。
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { eq, ilike } from "drizzle-orm";
import { media, posts } from "@/db/schema";
import { AppError } from "@/core/errors";
import { TOOLS } from "@/extensions/mcp/server";
import { emit } from "@/core/events";
import { preSubmitCheck } from "@/lib/moderation";
import { getInteractablePost } from "@/lib/interactions";
import { deleteMediaFile } from "@/lib/media";
import { rateLimitBucket } from "@/lib/rate-limit/buckets";

/** 可编程 fake db：每条 await 的语句按队列取结果，方法调用逐参记录 */
const { store, dbMock } = vi.hoisted(() => {
  const store = {
    queue: [] as unknown[],
    calls: new Map<string, unknown[][]>(),
  };
  const makeChain = (): unknown => {
    const builder: unknown = new Proxy(function () {}, {
      get(_t, prop: string) {
        if (prop === "then") {
          return (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
            const next = store.queue.length > 0 ? store.queue.shift() : [];
            Promise.resolve(next).then(resolve, reject);
          };
        }
        if (prop === "transaction") {
          return async (fn: (tx: unknown) => Promise<unknown>) => fn(makeChain());
        }
        return (...args: unknown[]) => {
          const list = store.calls.get(prop) ?? [];
          list.push(args);
          store.calls.set(prop, list);
          return builder;
        };
      },
    });
    return builder;
  };
  return { store, dbMock: makeChain() };
});

vi.mock("@/db", () => ({ db: dbMock }));
vi.mock("@/core/events", () => ({ emit: vi.fn() }));
vi.mock("@/lib/moderation", () => ({
  preSubmitCheck: vi.fn(async () => ({ blocked: [], warned: [] })),
}));
vi.mock("@/lib/interactions", () => ({ getInteractablePost: vi.fn() }));
vi.mock("@/lib/media", () => ({ deleteMediaFile: vi.fn(async () => {}) }));
vi.mock("@/lib/storage", () => ({ asStorageTag: (t: unknown) => t }));
vi.mock("@/lib/rate-limit/buckets", () => ({ rateLimitBucket: vi.fn() }));
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, eq: vi.fn(actual.eq), ilike: vi.fn(actual.ilike) };
});

const USER = "11111111-1111-4111-8111-111111111111";
const POST_ID = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

const CTX = { userId: USER, tokenScopes: ["posts:read", "posts:write", "media:read", "media:write"] };

function tool(name: string) {
  const def = TOOLS.find((t) => t.name === name);
  if (!def) throw new Error(`tool ${name} not registered`);
  return def;
}

const eqMock = eq as unknown as Mock;
const ilikeMock = ilike as unknown as Mock;
const emitMock = emit as unknown as Mock;
const preMock = preSubmitCheck as unknown as Mock;
const gateMock = getInteractablePost as unknown as Mock;
const deleteFileMock = deleteMediaFile as unknown as Mock;
const bucketMock = rateLimitBucket as unknown as Mock;

/** 断言 handler 期间出现过 eq(<指定列对象>, <期望值>) —— 对象级授权绑定 */
function expectEqBinding(column: unknown, value: unknown) {
  const hit = eqMock.mock.calls.some((c) => c[0] === column && c[1] === value);
  expect(hit, `expected eq(column=${JSON.stringify((column as { name?: string })?.name)}, value=${String(value)})`).toBe(true);
}

beforeEach(() => {
  store.queue = [];
  store.calls = new Map();
  eqMock.mockClear();
  ilikeMock.mockClear();
  emitMock.mockReset();
  emitMock.mockResolvedValue(undefined);
  preMock.mockReset();
  preMock.mockResolvedValue({ blocked: [], warned: [] });
  gateMock.mockReset();
  deleteFileMock.mockClear();
  bucketMock.mockReset();
  bucketMock.mockResolvedValue(undefined);
});

describe("分页/入参上限（拖库与异常值面）", () => {
  it("list_my_posts 钳制超限 limit、负 offset 与非法字符串", async () => {
    store.queue = [[]];
    await tool("list_my_posts").handler({ limit: 9999, offset: -50 }, CTX);
    expect(store.calls.get("limit")!.at(-1)).toEqual([100]);
    expect(store.calls.get("offset")!.at(-1)).toEqual([0]);

    store.queue = [[]];
    await tool("list_my_posts").handler({ limit: "abc", offset: "xyz" }, CTX);
    expect(store.calls.get("limit")!.at(-1)).toEqual([20]);
    expect(store.calls.get("offset")!.at(-1)).toEqual([0]);
  });

  it("list_my_posts 拒绝未知 status 枚举", async () => {
    await expect(tool("list_my_posts").handler({ status: "whatever" }, CTX)).rejects.toThrow(AppError);
  });

  it("get_feed / search_posts / list_my_media / list_post_comments 的 limit 均有上限", async () => {
    store.queue = [[]];
    await tool("get_feed").handler({ limit: 100_000, offset: -50 }, CTX);
    expect(store.calls.get("limit")!.at(-1)).toEqual([50]);
    expect(store.calls.get("offset")!.at(-1)).toEqual([0]);
    store.queue = [[]];
    await tool("get_feed").handler({ offset: 12.7 }, CTX);
    expect(store.calls.get("offset")!.at(-1)).toEqual([12]); // 截断为非负整数

    store.queue = [[]];
    await tool("search_posts").handler({ query: "hello", limit: 10_000 }, CTX);
    expect(store.calls.get("limit")!.at(-1)).toEqual([50]);

    store.queue = [[]];
    await tool("list_my_media").handler({ limit: 99_999 }, CTX);
    expect(store.calls.get("limit")!.at(-1)).toEqual([200]);
  });

  it("search_posts 转义 LIKE 通配符（% _ 不得放大为全表扫描）", async () => {
    store.queue = [[]];
    await tool("search_posts").handler({ query: "a%b_c" }, CTX);
    const patterns = ilikeMock.mock.calls.map((c) => c[1]);
    expect(patterns).toContain("%a\\%b\\_c%");
  });

  it("search_posts 拒绝超长查询串", async () => {
    await expect(tool("search_posts").handler({ query: "x".repeat(201) }, CTX)).rejects.toThrow(AppError);
  });

  it("非 uuid 的 postId/mediaId/collectionId 在进入 DB 前即被拒绝", async () => {
    await expect(tool("get_post").handler({ postId: "1; drop table posts" }, CTX)).rejects.toThrow(/uuid/);
    await expect(tool("delete_media").handler({ mediaId: "../etc/passwd" }, CTX)).rejects.toThrow(/uuid/);
    await expect(
      tool("create_article").handler({ title: "t", content: "c", collectionId: "not-a-uuid" }, CTX),
    ).rejects.toThrow(/uuid/);
    expect(store.calls.size, "非法入参不得触达 db").toBe(0);
  });
});

describe("对象级授权（IDOR）", () => {
  it("get_post 作者可读自己的草稿，不触发可见性门控", async () => {
    store.queue = [[{ post: { id: POST_ID, authorId: USER, type: "article", title: "t", publicId: "p", content: "secret draft", status: "draft" }, author: { username: "u", displayName: "D" } }]];
    const res = (await tool("get_post").handler({ postId: POST_ID }, CTX)) as { content: string };
    expect(res.content).toBe("secret draft");
    expect(gateMock).not.toHaveBeenCalled();
  });

  it("get_post 他人帖子必须过 getInteractablePost（草稿/回收站按其抛错）", async () => {
    gateMock.mockRejectedValue(new AppError("post not found", 404, "not_found"));
    store.queue = [[{ post: { id: POST_ID, authorId: OTHER, type: "article", title: "t", publicId: "p", content: "x", status: "draft" }, author: { username: "v", displayName: "V" } }]];
    await expect(tool("get_post").handler({ postId: POST_ID }, CTX)).rejects.toThrow(AppError);
    expect(gateMock).toHaveBeenCalledWith(POST_ID, USER);
  });

  it("update_post 预读与更新均绑定 authorId=token 属主；非本人 404", async () => {
    store.queue = [[]]; // 归属预读落空（他人帖子按不存在处理）
    await expect(
      tool("update_post").handler({ postId: POST_ID, content: "owned by other" }, CTX),
    ).rejects.toMatchObject({ status: 404 });
    expectEqBinding(posts.id, POST_ID);
    expectEqBinding(posts.authorId, USER);
  });

  it("delete_post 条件更新绑定 authorId；0 行返回 404", async () => {
    store.queue = [[]];
    await expect(tool("delete_post").handler({ postId: POST_ID }, CTX)).rejects.toMatchObject({ status: 404 });
    expectEqBinding(posts.authorId, USER);
  });

  it("delete_media 查不到他人文件时返回 deleted:false 且不动物理文件", async () => {
    store.queue = [[]];
    const mediaId = "44444444-4444-4444-8444-444444444444";
    const res = await tool("delete_media").handler({ mediaId }, CTX);
    expect(res).toEqual({ deleted: false });
    expectEqBinding(media.userId, USER);
    expect(deleteFileMock).not.toHaveBeenCalled();
  });

  it("get_profile 只回显公开资料投影（无 passwordHash/email/TOTP 字段）", async () => {
    store.queue = [[{ id: USER, username: "u", displayName: "D", bio: "", github: null, orcid: null, website: null, subdomain: null, passwordHash: "scrypt$16384$dead$beef", email: "a@b.c", totpSecret: null }]];
    const res = await tool("get_profile").handler({}, CTX);
    expect(res).toEqual({ username: "u", displayName: "D", bio: "", github: null, orcid: null, website: null, subdomain: null });
    expect(JSON.stringify(res)).not.toMatch(/scrypt|totp|password|email/i);
  });

  it("get_profile 用户行缺失（级联删除竞态）→ 404 而非 TypeError", async () => {
    store.queue = [[]];
    await expect(tool("get_profile").handler({}, CTX)).rejects.toMatchObject({ status: 404 });
  });
});

describe("审核与限流钩子与 web 对齐", () => {
  it("create_article 走 web 同款 write.post 桶（按 userId，不与 MCP token 桶混用）", async () => {
    store.queue = [[{ id: POST_ID, publicId: "abc123" }], [{ status: "published" }]];
    const res = await tool("create_article").handler({ title: "T", content: "body" }, CTX);
    expect(bucketMock).toHaveBeenCalledWith("write.post", USER);
    expect(res).toEqual({ id: POST_ID, publicId: "abc123", status: "published" });
    expect(emitMock).toHaveBeenCalledWith("post:submitted", expect.objectContaining({ postId: POST_ID, authorId: USER }));
  });

  it("create_article 命中关键词时不落库（preSubmitCheck 在事务之前）", async () => {
    preMock.mockResolvedValue({ blocked: ["违禁词"], warned: [] });
    await expect(
      tool("create_article").handler({ title: "T", content: "bad" }, CTX),
    ).rejects.toMatchObject({ status: 422 });
    expect(emitMock).not.toHaveBeenCalled();
    expect(store.calls.has("insert")).toBe(false);
  });

  it("create_article 内容超长（web 200k 上限）直接拒绝，不进 preSubmitCheck", async () => {
    await expect(
      tool("create_article").handler({ title: "T", content: "x".repeat(200_001) }, CTX),
    ).rejects.toMatchObject({ status: 400 });
    expect(preMock).not.toHaveBeenCalled();
  });

  it("update_post 编辑已发布内容回到 pending_review 并重新提审（防过审后改文绕审）", async () => {
    store.queue = [[{ id: POST_ID, type: "article", status: "published" }], [{ id: POST_ID }]];
    const res = await tool("update_post").handler({ postId: POST_ID, content: "rewritten" }, CTX);
    const setArg = store.calls.get("set")!.at(-1)![0] as Record<string, unknown>;
    expect(setArg.status).toBe("pending_review");
    expect(setArg.rejectReason).toBeNull();
    expect(res).toMatchObject({ updated: true, status: "pending_review" });
    expect(emitMock).toHaveBeenCalledWith("post:submitted", expect.objectContaining({ postId: POST_ID, needReview: true }));
  });

  it("update_post 草稿编辑不动 status、不 emit", async () => {
    store.queue = [[{ id: POST_ID, type: "article", status: "draft" }], [{ id: POST_ID }]];
    await tool("update_post").handler({ postId: POST_ID, title: "new title" }, CTX);
    const setArg = store.calls.get("set")!.at(-1)![0] as Record<string, unknown>;
    expect(setArg.status).toBeUndefined();
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("update_post 短动态正文超 8000 字拒绝（web SHORT_CONTENT_MAX 同口径）", async () => {
    store.queue = [[{ id: POST_ID, type: "short", status: "draft" }]];
    await expect(
      tool("update_post").handler({ postId: POST_ID, content: "x".repeat(8001) }, CTX),
    ).rejects.toMatchObject({ status: 400 });
    expect(store.calls.has("update")).toBe(false);
  });

  it("update_post 空标题/超长标题/无字段更新均 400", async () => {
    await expect(tool("update_post").handler({ postId: POST_ID, title: "   " }, CTX)).rejects.toThrow(AppError);
    await expect(
      tool("update_post").handler({ postId: POST_ID, title: "x".repeat(201) }, CTX),
    ).rejects.toThrow(AppError);
    await expect(tool("update_post").handler({ postId: POST_ID }, CTX)).rejects.toThrow(AppError);
  });
});
