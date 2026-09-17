/**
 * 查询键工厂 — 全站 query key 的唯一出处。
 * 约定：`[域, ...参数]`；invalidate 时可按域前缀批量失效
 * （`invalidateQueries({ queryKey: queryKeys.poll(postId) })`）。
 */
export const queryKeys = {
  /** 时间线无限流（scope: "following" | "all"） */
  feed: (scope?: "following") => ["feed", scope ?? "all"] as const,
  /** 跨 scope 失效全部时间线（发帖/删帖后用，invalidate 按前缀匹配） */
  feedPrefix: () => ["feed"] as const,
  /** 新帖横幅的轻量探测（前缀可连带全部 scope） */
  feedCheck: (scope?: "following") => ["feed-check", scope ?? "all"] as const,
  feedCheckPrefix: () => ["feed-check"] as const,
  /** 单帖投票视图 */
  poll: (postId: string) => ["poll", postId] as const,
  /** 本地未读计数（seen 时间戳作为键的一部分 → 推进 seen 自动换新） */
  unread: (seen: { latest: number; following: number; messages: number }) =>
    ["unread", seen] as const,
  /** 编辑器目录树：合集 + 我的作品列表 */
  collections: () => ["collections"] as const,
  myPosts: (type: "article" | "short" | "all" = "all") => ["posts", "mine", type] as const,
  /** 我的管理列表（status + 搜索过滤）— 前缀 ["posts","mine-list"] 可批量失效 */
  myPostList: (status: string, q: string) => ["posts", "mine-list", status, q] as const,
  /** 跨过滤条件失效全部管理列表（删帖/审核后用） */
  myPostListPrefix: () => ["posts", "mine-list"] as const,
  /** 设置域：OAuth 连接 / 邮箱状态 */
  connections: () => ["me", "connections"] as const,
  emailStatus: () => ["me", "email"] as const,
  /** 评论：无限分页 + 新评论探测（前缀 ["comments", postId]） */
  comments: (postId: string) => ["comments", postId] as const,
  /** 置顶楼层（始终置顶渲染）/ 解决方案摘要盒 —— 前缀失效可一并覆盖 */
  commentsPinned: (postId: string) => ["comments", postId, "pinned"] as const,
  commentsSolutions: (postId: string) => ["comments", postId, "solutions"] as const,
  commentsCheck: (postId: string) => ["comments-check", postId] as const,
  /** 私信：会话列表 / 单会话消息 / 新私信人选 */
  conversations: () => ["messages", "conversations"] as const,
  messages: (userId: string) => ["messages", "thread", userId] as const,
  /** 会话新消息轻量探测（只拉第一页；thread 为无限流，不直接挂 interval） */
  messagesCheck: (userId: string) => ["messages", "thread-check", userId] as const,
  allowedDmUsers: () => ["messages", "allowed"] as const,
  /** 通知列表（前缀 ["notifications"] 可连带未读角标一起失效） */
  notifications: () => ["notifications"] as const,
  notificationBadge: () => ["notifications", "badge"] as const,
  /** 话题搜索联想（composer-panels 与 topic-input 共享同一份缓存） */
  topicsSearch: (q: string) => ["topics", "search", q] as const,
  /** 关注/屏蔽关系（按用户名；follow-button 走 RSC refresh 不占键） */
  relation: (username: string) => ["relation", username] as const,
} as const;
