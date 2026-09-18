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
  /** 热门榜无限流（range: "day" | "week" | "month"） */
  hot: (range: string) => ["hot", range] as const,
  /** 新帖横幅的轻量探测（前缀可连带全部 scope） */
  feedCheck: (scope?: "following") => ["feed-check", scope ?? "all"] as const,
  feedCheckPrefix: () => ["feed-check"] as const,
  /** 单帖投票视图 */
  poll: (postId: string) => ["poll", postId] as const,
  /** 单帖收藏状态（行菜单打开时拉取；["bookmark", id] 亦为收藏按钮乐观键） */
  bookmark: (postId: string) => ["bookmark", postId] as const,
  /** 通行密钥列表（设置 → 安全） */
  passkeys: () => ["me", "passkeys"] as const,
  /** 本地未读计数（seen 时间戳作为键的一部分 → 推进 seen 自动换新） */
  unread: (seen: { latest: number; following: number; messages: number }) =>
    ["unread", seen] as const,
  /** 跨 seen 失效全部未读计数（实时事件推送后用） */
  unreadPrefix: () => ["unread"] as const,
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
  /** 设置域：API 令牌 / 邀请码 / 认证状态 / 数据导出 / Webhook */
  tokens: () => ["me", "tokens"] as const,
  invites: () => ["me", "invites"] as const,
  verification: () => ["me", "verification"] as const,
  exportJobs: () => ["me", "export-jobs"] as const,
  webhooks: () => ["me", "webhooks"] as const,
  /* ------------------------------ admin 域 ------------------------------ */
  /** admin 概览统计 */
  adminStats: () => ["admin", "stats"] as const,
  /** 站点设置（settings 页与 moderation-llm / llm-providers 面板共用，保存后失效连带重取） */
  adminSettings: () => ["admin", "settings"] as const,
  /** 单用户模式用户名联想（settings 键的子键，q 进键） */
  adminSettingsSuggest: (q: string) => ["admin", "settings", "suggest", q] as const,
  /** admin 文章列表（status + 搜索 + 分页）— 行内审核/删除按前缀批量失效 */
  adminPosts: (status: string, q: string, offset: number) =>
    ["admin", "posts", status, q, offset] as const,
  adminPostsPrefix: () => ["admin", "posts"] as const,
  /** admin 评论管理列表（offset 分页）— 隐藏/删除按前缀批量失效 */
  adminComments: (offset: number) => ["admin", "comments", offset] as const,
  adminCommentsPrefix: () => ["admin", "comments"] as const,
  /** admin 举报列表（status + type + 分页）— 处置后按前缀批量失效 */
  adminReports: (status: string, type: string, offset: number) =>
    ["admin", "reports", status, type, offset] as const,
  adminReportsPrefix: () => ["admin", "reports"] as const,
  /** 认证审核台（status tab + 搜索词）— 审核动作按前缀覆盖三个 tab */
  adminVerification: (status: string, q: string) =>
    ["admin", "verification", status, q] as const,
  adminVerificationPrefix: () => ["admin", "verification"] as const,
  /** admin 用户列表（filter + 搜索 + 分页）— 处置动作按前缀批量失效 */
  adminUsers: (filter: string, q: string, offset: number) =>
    ["admin", "users", filter, q, offset] as const,
  adminUsersPrefix: () => ["admin", "users"] as const,
  /** 通知模板注册表 — 保存/重置后失效重取 */
  adminTemplates: () => ["admin", "templates"] as const,
  /** 运维监控快照（手动 refetch 刷新） */
  adminOps: () => ["admin", "ops"] as const,
  /** 邀请码管理列表（筛选 + 搜索 + 分页）— 作废后按前缀批量失效 */
  adminInvites: (filter: string, q: string, offset: number) =>
    ["admin", "invites", filter, q, offset] as const,
  adminInvitesPrefix: () => ["admin", "invites"] as const,
  /** 媒体库管理（类型 + 搜索 + 分页）— 删除后按前缀批量失效 */
  adminMedia: (kind: string, q: string, offset: number) =>
    ["admin", "media", kind, q, offset] as const,
  adminMediaPrefix: () => ["admin", "media"] as const,
  /** 审计日志（动作筛选 + 分页） */
  adminAudit: (action: string, offset: number) => ["admin", "audit", action, offset] as const,
  /** 人工审核待审队列 — 通过/驳回后失效重取 */
  adminModerationQueue: () => ["admin", "moderation", "queue"] as const,
  /** 关键词黑名单 — 增/删/导入后失效重取 */
  adminKeywords: () => ["admin", "keywords"] as const,
  /** 扩展域：签名档扩展设置（/api/ext/signature/settings） */
  extSignatureSettings: () => ["ext", "signature", "settings"] as const,
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
  /** 左栏 System 会话预览（limit=1：最新一条 + 未读数） */
  notificationsPreview: () => ["notifications", "preview"] as const,
  /** System 聊天窗内的通知无限流 */
  notificationsInfinite: () => ["notifications", "infinite"] as const,
  /** 话题搜索联想（composer-panels 与 topic-input 共享同一份缓存） */
  topicsSearch: (q: string) => ["topics", "search", q] as const,
  /** 关注/屏蔽关系（按用户名；follow-button 走 RSC refresh 不占键） */
  relation: (username: string) => ["relation", username] as const,
} as const;
