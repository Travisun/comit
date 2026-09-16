import { hooks } from "@/core/hooks";

/**
 * 博文生命周期钩子 — 扩展可在**写入前**修改载荷或拒绝保存，
 * 在**写入后**做后续处理（同步到外部系统、生成衍生数据等）。
 *
 * 注册（扩展的 server.ts 内）：
 *   ctx.hooks.on("post:saving", (ctx) => { ctx.payload.label = "…"; ctx.reject("…") });
 *   ctx.hooks.on("post:saved", (ctx) => { … });
 */

export interface PostSavingContext {
  action: "create" | "update";
  /** update 时的帖子 id */
  postId?: string;
  /** 即将写入的列值 — 过滤器可直接改写 */
  payload: Record<string, unknown>;
  author: { id: string; username: string; role: string };
  /** 首次 reject 生效；非空 ⇒ 中止写入并返回 422 */
  rejection: string | null;
  reject: (reason: string) => void;
}

export interface PostSavedContext {
  action: "create" | "update";
  post: { id: string; type: "article" | "short"; status: string; title: string | null };
  author: { id: string };
}

/** 写入前调用 — 返回拒绝原因（null = 放行）。 */
export async function runPostSaving(ctx: PostSavingContext): Promise<string | null> {
  try {
    await hooks.callHook("post:saving", ctx);
  } catch (err) {
    console.error("[post:saving] listener failed:", err);
  }
  return ctx.rejection;
}

/** 写入后调用（fire-and-forget 语义，错误只记日志）。 */
export async function runPostSaved(ctx: PostSavedContext): Promise<void> {
  try {
    await hooks.callHook("post:saved", ctx);
  } catch (err) {
    console.error("[post:saved] listener failed:", err);
  }
}
