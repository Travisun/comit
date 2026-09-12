import { emit } from "@/core/events";
import { sendOperationNotification } from "@/lib/operation-notify";
import { verificationTypeName } from "@/lib/verification";
import { logAdmin } from "../_shared";

/**
 * Post-review side effects shared by the verification admin routes:
 * domain events, user notifications, and the mod_logs audit row.
 * DB mutations happen first (inside verification.server transactions).
 *
 * ⚠️ approved/rejected：站内通知由 `src/plugins/notifications.ts` 的事件监听器
 * （`verification:approved` / `verification:rejected` → notifySend）负责，
 * 这里只 emit 事件——再调一次 sendOperationNotification 会造成用户收到双份通知。
 * revoked 没有对应事件/监听器，因此显式走 sendOperationNotification。
 */

type ReviewedRequest = import("@/lib/verification").VerificationRequestView & { userId: string };

const SETTINGS_URL = "/settings/verification";

export async function afterApproval(reviewerId: string, request: ReviewedRequest): Promise<void> {
  await emit("verification:approved", {
    userId: request.userId,
    type: request.type,
    label: request.label,
  });
  await logAdmin(reviewerId, "verification.approve", "verification_request", request.id, request.label);
}

export async function afterRejection(
  reviewerId: string,
  request: ReviewedRequest & { rejectReason: string | null },
): Promise<void> {
  const reason = request.rejectReason ?? "";
  await emit("verification:rejected", { userId: request.userId, reason });
  await logAdmin(reviewerId, "verification.reject", "verification_request", request.id, reason);
}

export async function afterRevoke(reviewerId: string, request: ReviewedRequest): Promise<void> {
  await sendOperationNotification(request.userId, {
    key: "verification.revoked",
    title: { zh: "认证已被撤销", en: "Verification revoked" },
    body: {
      zh: `你的「${request.label}」${verificationTypeName(request.type, "zh")}已被管理员撤销。如有疑问请联系管理员。`,
      en: `Your ${verificationTypeName(request.type, "en")} verification "${request.label}" has been revoked by an administrator.`,
    },
    url: SETTINGS_URL,
    payload: { requestId: request.id, type: request.type, label: request.label },
  });
  await logAdmin(reviewerId, "verification.revoke", "verification_request", request.id, request.label);
}
