import { describe, expect, it } from "vitest";
import {
  PARTICIPANT_SCOPED_EVENTS,
  STRIPPED_PAYLOAD_FIELDS,
  WEBHOOK_EVENTS,
} from "@/extensions/webhooks/server";

/**
 * Webhook 投递作用域策略回归：全局扇出只允许"公开语义"事件 ——
 * 私密事件必须限定当事人（否则任意订阅者会持续收到全平台私信全文），
 * 内部字段（审核理由）必须出站前剥离。
 */
describe("webhook 投递作用域策略", () => {
  it("message:created 限定收发双方", () => {
    const scope = PARTICIPANT_SCOPED_EVENTS["message:created"]({
      senderId: "u-1",
      receiverId: "u-2",
    });
    expect(scope).toEqual(["u-1", "u-2"]);
  });

  it("message:created 缺参与者时作用域为空数组（投递给无人）", () => {
    const scope = PARTICIPANT_SCOPED_EVENTS["message:created"]({});
    expect(scope).toEqual([]);
  });

  it("公开语义事件没有作用域限制（post:published 等）", () => {
    expect(PARTICIPANT_SCOPED_EVENTS["post:published"]).toBeUndefined();
    expect(PARTICIPANT_SCOPED_EVENTS["post:liked"]).toBeUndefined();
    expect(PARTICIPANT_SCOPED_EVENTS["comment:created"]).toBeUndefined();
    expect(PARTICIPANT_SCOPED_EVENTS["user:followed"]).toBeUndefined();
  });

  it("审核事件的 reason 出站前剥离", () => {
    expect(STRIPPED_PAYLOAD_FIELDS["moderation:review.completed"]).toContain("reason");
  });

  it("白名单内每个事件都必须有明确的作用域语义：要么公开、要么限定、要么剥离", () => {
    for (const event of WEBHOOK_EVENTS) {
      const hasPolicy =
        PARTICIPANT_SCOPED_EVENTS[event] !== undefined ||
        STRIPPED_PAYLOAD_FIELDS[event] !== undefined ||
        // 公开语义事件白名单（新增公开事件请在此登记，否则本测试失败强制评估）
        ["post:published", "post:liked", "comment:created", "user:followed"].includes(event);
      expect({ event, hasPolicy }).toEqual({ event, hasPolicy: true });
    }
  });
});
