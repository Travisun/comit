import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { ok, withUser, jsonBody } from "@/lib/http";
import { parseOrThrow } from "../_shared";
import { WIDGET_CATALOG } from "@/components/user-space/widget-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 背景值只接受三类：本站相对路径 / http(s) 绝对 URL / CSS 颜色。
// 显式拒绝 url(javascript:…)、url(data:…)、站外追踪图与任意 CSS 注入；
// accent 只接受标准颜色语法（会拼进 color-mix(in oklab, ${accent} 35%)）。
const CSS_COLOR_RE =
  /^(#[0-9a-fA-F]{3,8}|rgb[a]?\([^)]*\)|hsl[a]?\([^)]*\)|[a-zA-Z]+)$/;
const bgValue = z
  .string()
  .trim()
  .max(300)
  .refine(
    (v) =>
      // 站内相对路径必须 / 开头且非 //（协议相对 URL 会直连外站追踪访客 IP/UA）
      /^\/(?!\/)/.test(v) ||
      /^https?:\/\//i.test(v) ||
      (/^url\(/i.test(v)
        ? /^url\(["']?(\/(?!\/)|https?:\/\/)[^"';)\s]*["']?\)$/i.test(v) &&
          !/javascript:|data:/i.test(v)
        : CSS_COLOR_RE.test(v)),
    "不支持背景值格式",
  );
const appearanceSchema = z.object({
  homeBg: bgValue.nullable().optional(),
  postBg: bgValue.nullable().optional(),
  accent: z
    .string()
    .trim()
    .max(100)
    // var(...) 必须整体锚定：React 对自定义属性（--primary）按字面量序列化、
    // 不做 CSS 转义，`var(--x);background-image:url(https://evil/1)` 会以
    // 前缀合法、尾部越界的形式落进 style，变成访客页上的存储式 CSS 注入。
    .refine(
      (v) => CSS_COLOR_RE.test(v) || /^var\(--[A-Za-z][A-Za-z0-9_-]*\)$/.test(v),
      "不支持的颜色格式",
    )
    .nullable()
    .optional(),
  fontFamily: z.enum(["system", "serif", "mono"]).nullable().optional(),
  fontSize: z.enum(["sm", "md", "lg"]).nullable().optional(),
});

const bodySchema = z.object({
  appearance: appearanceSchema.optional(),
  widgets: z.array(z.string()).optional(),
});

/** PUT /api/me/appearance — page background/accent/font + sidebar widget selection. */
export async function PUT(req: Request) {
  return withUser(req, async (auth) => {
    const body = parseOrThrow(bodySchema, await jsonBody(req).catch(() => null));

    if (body.appearance || body.widgets) {
      const valid = new Set(WIDGET_CATALOG.map((w) => w.id));
      const widgets = body.widgets
        ? [...new Set(body.widgets)].filter((id) => valid.has(id))
        : undefined;

      // appearance / widgets 同在 users 行的 jsonb 列，读-改-写并发保存会互相
      // 覆盖。事务 + FOR UPDATE 行锁串行化；锁内重读最新值（auth.user.appearance
      // 只是会话快照，可能滞后），两列合一次 UPDATE 写回。
      await db.transaction(async (tx) => {
        const [row] = await tx
          .select({ appearance: users.appearance })
          .from(users)
          .where(eq(users.id, auth.user.id))
          .limit(1)
          .for("update");

        let appearance: typeof users.$inferSelect["appearance"] | undefined;
        if (body.appearance) {
          const next = { ...(row?.appearance ?? {}) };
          for (const [k, v] of Object.entries(body.appearance)) {
            (next as Record<string, unknown>)[k] = v ?? null;
          }
          appearance = next;
        }

        await tx
          .update(users)
          .set({ appearance, widgets, updatedAt: new Date() })
          .where(eq(users.id, auth.user.id));
      });
    }

    return ok();
  });
}
