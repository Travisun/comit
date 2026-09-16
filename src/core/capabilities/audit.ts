import { db } from "@/db";
import { modLogs } from "@/db/schema";

/** 审计日志标准化（D9）— 统一写 mod_logs（现有 admin 审计页直接消费）。 */
export async function audit(input: {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  note?: string | null;
}): Promise<void> {
  await db
    .insert(modLogs)
    .values({
      // null = 系统 actor（非人工操作）；admin_id 已改为可空列
      adminId: input.actorId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      note: input.note ?? null,
    })
    .catch((err) => console.error("[audit] write failed:", err));
}
