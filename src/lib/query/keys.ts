/**
 * 查询键工厂 — 全站 query key 的唯一出处。
 * 约定：`[域, ...参数]`；invalidate 时可按域前缀批量失效
 * （`invalidateQueries({ queryKey: queryKeys.poll(postId) })`）。
 */
export const queryKeys = {
  /** 时间线无限流（scope: "following" | "all"） */
  feed: (scope?: "following") => ["feed", scope ?? "all"] as const,
  /** 新帖横幅的轻量探测 */
  feedCheck: (scope?: "following") => ["feed-check", scope ?? "all"] as const,
  /** 单帖投票视图 */
  poll: (postId: string) => ["poll", postId] as const,
  /** 本地未读计数（seen 时间戳作为键的一部分 → 推进 seen 自动换新） */
  unread: (seen: { latest: number; following: number; messages: number }) =>
    ["unread", seen] as const,
} as const;
