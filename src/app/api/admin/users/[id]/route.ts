import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { ok, jsonBody } from "@/lib/http";
import { withPermission } from "@/lib/permissions";
import { sendOperationNotification } from "@/lib/operation-notify";
import { forbidden } from "@/core/errors";
import { assertUuid, logAdmin, parseOrThrow } from "@/app/api/admin/_shared";
import { banUser, getModerationTarget, unbanUser, warnUser } from "../_moderation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/users/[id] — full user-management semantics.
 *
 *   { action: "warn", message }                 → notify + audit, no state change
 *   { action: "ban_timed", days, reason }       → suspend + bannedUntil, wipe sessions
 *   { action: "ban_permanent", reason }         → suspend + bannedUntil=null, wipe sessions
 *   { action: "unban" }                         → back to active, clear ban fields
 *   { role: "admin" | "editor" | "user" }       → role change (legacy: no action)
 *   { status: "active" | "suspended" }          → raw status flip (legacy: no reason)
 *
 * Role changes and moderation are admin-only ("admin.users"); self-modification
 * is always blocked.
 */
const bodySchema = z
  .union([
    z.object({ action: z.literal("warn"), message: z.string().trim().min(1).max(500) }),
    z.object({
      action: z.literal("ban_timed"),
      days: z.number().int().min(1).max(365),
      reason: z.string().trim().min(1).max(500),
    }),
    z.object({ action: z.literal("ban_permanent"), reason: z.string().trim().min(1).max(500) }),
    z.object({ action: z.literal("unban") }),
    z.object({ role: z.enum(["admin", "editor", "user"]) }),
    z.object({ status: z.enum(["active", "suspended"]) }),
  ])
  .refine(
    (v) =>
      "action" in v || "role" in v || "status" in v,
    { message: "Nothing to update" },
  );

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withPermission(req, "admin.users", async ({ user }) => {
    const { id } = await params;
    assertUuid(id);
    const body = parseOrThrow(bodySchema, await jsonBody(req));

    if (id === user.id) {
      throw forbidden("不能修改自己的角色或状态 / You cannot modify your own role or status");
    }
    const target = await getModerationTarget(id);

    if ("action" in body) {
      switch (body.action) {
        case "warn":
          await warnUser({ adminId: user.id, userId: id, message: body.message });
          return ok({ ok: true, action: "warn" });
        case "ban_timed":
          await banUser({ adminId: user.id, userId: id, days: body.days, reason: body.reason });
          return ok({ ok: true, action: "ban_timed", days: body.days });
        case "ban_permanent":
          await banUser({ adminId: user.id, userId: id, days: null, reason: body.reason });
          return ok({ ok: true, action: "ban_permanent" });
        case "unban":
          await unbanUser({ adminId: user.id, userId: id });
          return ok({ ok: true, action: "unban" });
      }
    }

    // legacy / explicit role & status changes
    if ("role" in body) {
      await db.update(users).set({ role: body.role }).where(eq(users.id, id));
      await logAdmin(user.id, "user.role", "user", id, `role → ${body.role} (@${target.username})`);
      if (body.role === "editor") {
        await sendOperationNotification(id, {
          key: "system.role",
          title: { zh: "角色变更通知", en: "Role updated" },
          body: { zh: "你已被授予「编辑」角色，现在可以访问内容审核工作台。", en: "You have been granted the Editor role with moderation console access." },
        });
      }
    }
    if ("status" in body) {
      await db.update(users).set({ status: body.status }).where(eq(users.id, id));
      await logAdmin(
        user.id,
        "user.status",
        "user",
        id,
        `status → ${body.status} (@${target.username})`,
      );
    }

    return ok({ ok: true, ...("role" in body ? { role: body.role } : {}), ...("status" in body ? { status: body.status } : {}) });
  });
}
