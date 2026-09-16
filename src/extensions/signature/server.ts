import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { signatureEvents } from "./schema";
import { apiUser } from "@/lib/auth/guards";
import { forbidden } from "@/core/errors";
import { jsonBody, ok } from "@/lib/http";
import {
  coerceExtSettings,
  type ExtensionManifest,
} from "@/core/capabilities/manifest";
import type { Plugin, PluginContext } from "@/core/plugins/types";
import manifest from "./manifest";

/**
 * 签名档扩展 · 服务端：
 *  - 文章渲染管线过滤器：按作者的用户级设置在正文前/后插入签名 HTML，
 *    可选「仅登录可见」打断渲染（客户端由 post:interrupt 渲染器接手）；
 *  - 扩展 API：GET/PUT /api/ext/signature/settings（当前登录用户的设置）。
 */

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** 读取某用户在本扩展命名空间下的设置（已按 manifest 收敛）。 */
export async function loadSignatureSettings(userId: string) {
  const [row] = await db
    .select({ ext: users.extSettings })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const raw = (row?.ext as Record<string, Record<string, unknown>> | null)?.signature;
  return coerceExtSettings(manifest as ExtensionManifest, raw);
}

async function saveSignatureSettings(userId: string, input: unknown) {
  const settings = coerceExtSettings(manifest as ExtensionManifest, input);
  const [row] = await db
    .select({ ext: users.extSettings })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const merged = { ...((row?.ext as object) ?? {}), signature: settings };
  await db.update(users).set({ extSettings: merged }).where(eq(users.id, userId));
  return settings;
}

const plugin: Plugin = {
  name: "signature",
  description: "Per-user article signature with optional sign-in gating",
  version: "1.0.0",
  register(ctx: PluginContext) {
    // ---- 文章渲染管线 ----
    ctx.registerPostRenderFilter("signature", async (p) => {
      const s = await loadSignatureSettings(p.post.authorId);

      // 登录可见：打断渲染（首次 interrupt 生效，正文不再输出）
      if (s.loginRequired && !p.viewer) {
        p.interrupt({
          code: "ext.signature.login",
          message: "本文已开启「仅登录可见」",
          data: { author: p.author.username },
        });
        return;
      }

      if (!s.enabled || !s.content) return;
      const html = `<div class="ext-signature mt-4 border-t border-border pt-3 text-sm text-muted-foreground whitespace-pre-wrap">${escapeHtml(String(s.content))}</div>`;
      if (s.placement === "prepend") p.prepend(html);
      else p.append(html);
      p.meta["ext.signature.content"] = String(s.content);

      // 扩展自有表 — 直接经 ORM（drizzle）访问；表声明在扩展目录内
      void db
        .insert(signatureEvents)
        .values({ userId: p.post.authorId, kind: "rendered" })
        .catch(() => undefined);
    }, 50);

    // ---- 扩展 API（挂载在 /api/ext/signature/ 下）----
    ctx.registerExtApiRoute("signature", {
      method: "GET",
      path: "settings",
      auth: "user",
      handler: async () => {
        const user = await apiUser();
        if (!user) throw forbidden("请先登录 / Sign in required");
        return ok({ settings: await loadSignatureSettings(user.user.id) });
      },
    });
    ctx.registerExtApiRoute("signature", {
      method: "PUT",
      path: "settings",
      auth: "user",
      handler: async (req) => {
        const user = await apiUser();
        if (!user) throw forbidden("请先登录 / Sign in required");
        const body = await jsonBody<Record<string, unknown>>(req);
        return ok({ settings: await saveSignatureSettings(user.user.id, body) });
      },
    });
  },
};

export default plugin;
