/**
 * 跨端共享的 API 响应形状（客户端 `@/lib/client/*` 与服务端 `src/app/api/*`
 * 的契约层）。领域 DTO 见 `src/components/user-space/types.ts`。
 */

/** 错误响应体 — 所有 API 路由的统一错误契约（见 src/lib/http.ts → toErrorResponse） */
export interface ApiErrorBody {
  error?: string;
  /** 内容审核命中词 */
  blocked?: string[];
}

/** offset 分页列表 — /api/feed 及各类时间线接口的统一分页契约 */
export interface Paginated<T> {
  items: T[];
  /** null ⇒ 已到末页 */
  nextOffset: number | null;
}

/** 纯动作类接口的成功响应（POST /api/likes、/api/bookmarks …） */
export interface ActionOk {
  ok: true;
}
