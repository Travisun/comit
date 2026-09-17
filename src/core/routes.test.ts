import { describe, expect, it } from "vitest";
import { buildPath, routes, TPL } from "@/core/routes";

/**
 * 路由模板生成回归（Laravel route() / urlcat 风格的单一出处）：
 * 个人主页 canonical = /{username}，帖子 permalink = /post/{internalId}。
 */
describe("buildPath 模板生成", () => {
  it(":param 段替换并 encodeURIComponent", () => {
    expect(buildPath("/topics/:slug", { slug: "前端框架" })).toBe(
      `/topics/${encodeURIComponent("前端框架")}`,
    );
    expect(buildPath("/post/:id", { id: "5eae12d0-89e9-4ee8-98dd-9a56f22346d3" })).toBe(
      "/post/5eae12d0-89e9-4ee8-98dd-9a56f22346d3",
    );
  });

  it("缺参直接抛错（URL 拼错炸在开发期）", () => {
    expect(() => buildPath("/post/:id", {})).toThrow(/missing param "id"/);
  });

  it("多段模板与多参数", () => {
    expect(
      buildPath("/u/:username/posts/:slug", { username: "alice", slug: "hello-world" }),
    ).toBe("/u/alice/posts/hello-world");
  });
});

describe("canonical 路由形状", () => {
  it("个人主页生成 /{username}（不再是 /u/{username}）", () => {
    expect(routes.profile("alice")).toBe("/alice");
    expect(routes.profileTab("alice", "posts")).toBe("/alice?tab=posts");
  });

  it("帖子 permalink 统一 /post/{internalId}（短动态与长文同形）", () => {
    expect(routes.post("abc-123")).toBe("/post/abc-123");
  });

  it("旧形态入口保留兼容（/u/{username}/posts/{slug}、/u/{username}/feed.xml）", () => {
    expect(routes.userPost("alice", "hello")).toBe("/u/alice/posts/hello");
    expect(routes.userRss("alice")).toBe("/u/alice/feed.xml");
  });

  it("模板表覆盖关键形状（防漂移哨兵）", () => {
    expect(TPL.userProfile).toBe("/:username");
    expect(TPL.post).toBe("/post/:id");
  });
});
