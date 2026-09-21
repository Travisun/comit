// 被测模块：src/extensions/webhooks/server.ts 的投递作用域策略（纯判定 + 注入式 db mock）。
// mock：@/db（只有所谓"回查作者"的 resolver 用到，绝不触网/触库）、@/core/queue（不加载 pg-boss）。
import { describe, expect, it, vi } from "vitest";
import { comments, posts } from "@/db/schema";
import {
  AUTO_DISABLE_AFTER_CONSECUTIVE_FAILURES,
  DELIVERY_RETRY_LIMIT,
  PARTICIPANT_SCOPED_EVENTS,
  prepareOutboundPayload,
  isPermanentDeliveryError,
  sanitizeDeliveryError,
  STRIPPED_PAYLOAD_FIELDS,
  WEBHOOK_EVENTS,
  WEBHOOK_VIEW_COLUMNS,
} from "@/extensions/webhooks/server";

/** 受控 db：记录 from(表) 调用并返回预设行，用于验证作用域 resolver 查了哪张表 */
const dbMock = vi.hoisted(() => {
  const state = { rows: [] as Array<Record<string, unknown>>, tables: [] as Array<unknown>, fail: false };
  const db = {
    select: () => ({
      from: (table: unknown) => {
        state.tables.push(table);
        if (state.fail) return { where: () => ({ limit: () => Promise.reject(new Error("db down")) }) };
        return { where: () => ({ limit: () => Promise.resolve(state.rows) }) };
      },
    }),
  };
  return { db, state };
});

vi.mock("@/core/queue", () => ({ queue: { send: vi.fn() } }));
vi.mock("@/db", () => ({ db: dbMock.db }));

const scope = async (event: string, payload: Record<string, unknown>) =>
  await PARTICIPANT_SCOPED_EVENTS[event]!(payload);

/** 白名单里的「公开语义」事件（无作用域 = 全平台扇出），新增公开事件须在此登记 */
const PUBLIC_FANOUT_EVENTS = ["post:published", "comment:created", "user:followed"];

describe("webhook 投递作用域策略", () => {
  it("message:created 限定收发双方", async () => {
    await expect(scope("message:created", { senderId: "u-1", receiverId: "u-2" })).resolves.toEqual(["u-1", "u-2"]);
  });

  it("message:created 缺参与者时作用域为空数组（投递给无人）", async () => {
    await expect(scope("message:created", {})).resolves.toEqual([]);
  });

  it("post:liked 限定点赞人与作者（获赞名单无公开枚举接口，不得全局扇出）", async () => {
    await expect(scope("post:liked", { postId: "p1", actorId: "u-1", authorId: "u-2" })).resolves.toEqual(["u-1", "u-2"]);
    await expect(scope("post:liked", { postId: "p1" })).resolves.toEqual([]);
  });

  it("payload 字段非字符串（被扩展写成对象/数组）时不入 IN 条件", async () => {
    await expect(scope("post:liked", { actorId: { id: "u-1" }, authorId: ["u-2"] })).resolves.toEqual([]);
    await expect(scope("message:created", { senderId: "u-1".repeat(40), receiverId: "u-2" })).resolves.toEqual(["u-2"]);
  });

  it("moderation:review.completed 带 commentId → 只投评论作者", async () => {
    dbMock.state.fail = false;
    dbMock.state.rows = [{ userId: "comment-author" }];
    dbMock.state.tables.length = 0;
    await expect(
      scope("moderation:review.completed", { postId: "host-post", commentId: "c-1", approved: false }),
    ).resolves.toEqual(["comment-author"]);
    // 评论审核时 postId 指向宿主帖子：必须查 comments 而不是 posts，否则投给无关的帖子作者
    expect(dbMock.state.tables.at(-1)).toBe(comments);
  });

  it("moderation:review.completed 仅 postId → 只投帖子作者", async () => {
    dbMock.state.rows = [{ authorId: "post-author" }];
    dbMock.state.tables.length = 0;
    await expect(scope("moderation:review.completed", { postId: "p-1", approved: false })).resolves.toEqual(["post-author"]);
    expect(dbMock.state.tables.at(-1)).toBe(posts);
  });

  it("moderation:review.completed 内容已删/查不到 → 空作用域（无人收到，不降级为全局）", async () => {
    dbMock.state.rows = [];
    await expect(scope("moderation:review.completed", { postId: "gone", approved: true })).resolves.toEqual([]);
  });

  it("resolver 查库失败会 reject（调用侧 dispatchWebhooks 据此 fail closed 丢弃）", async () => {
    dbMock.state.fail = true;
    await expect(scope("moderation:review.completed", { postId: "p-1", approved: true })).rejects.toThrow("db down");
    dbMock.state.fail = false;
  });

  it("公开语义事件没有作用域限制", () => {
    for (const event of PUBLIC_FANOUT_EVENTS) {
      expect(PARTICIPANT_SCOPED_EVENTS[event], `${event} 应为全局扇出`).toBeUndefined();
    }
  });

  it("审核事件的 reason 与 by 出站前剥离，其余字段原样保留", () => {
    expect(STRIPPED_PAYLOAD_FIELDS["moderation:review.completed"]).toEqual(expect.arrayContaining(["reason", "by"]));
    const raw = { postId: "p1", approved: false, by: "llm", reason: "命中词 X", extra: 1 };
    const outbound = prepareOutboundPayload("moderation:review.completed", raw);
    expect(outbound).toEqual({ postId: "p1", approved: false, extra: 1 });
    // 关键：不得原地删除 —— 同一 payload 对象被 notifications 等其它监听器共享
    expect(raw).toHaveProperty("reason", "命中词 X");
    expect(raw).toHaveProperty("by", "llm");
  });

  it("无剥离配置的事件直接透传（不产生多余拷贝）", () => {
    const raw = { postId: "p1", authorId: "u1" };
    expect(prepareOutboundPayload("post:published", raw)).toBe(raw);
  });

  it("白名单内每个事件都必须有明确的作用域语义：公开扇出 / 限定当事人 / 剥离内部字段", () => {
    for (const event of WEBHOOK_EVENTS) {
      const hasPolicy =
        PARTICIPANT_SCOPED_EVENTS[event] !== undefined ||
        STRIPPED_PAYLOAD_FIELDS[event] !== undefined ||
        // 公开语义事件白名单（新增公开事件请在此登记，否则本测试失败强制评估）
        PUBLIC_FANOUT_EVENTS.includes(event);
      expect({ event, hasPolicy }).toEqual({ event, hasPolicy: true });
    }
  });

  it("post:liked / moderation 已不再落在公开扇出白名单里", () => {
    expect(PUBLIC_FANOUT_EVENTS).not.toContain("post:liked");
    expect(PUBLIC_FANOUT_EVENTS).not.toContain("moderation:review.completed");
  });
});

describe("端点列表的密钥投影", () => {
  it("读取投影里没有 secret 列（结构上无法回显私钥，只带固定前缀）", () => {
    expect(Object.keys(WEBHOOK_VIEW_COLUMNS)).not.toContain("secret");
    expect(Object.keys(WEBHOOK_VIEW_COLUMNS)).toContain("secretPrefix");
    // 投影里不得出现 userId：列表出口只暴露端点自身字段
    expect(Object.keys(WEBHOOK_VIEW_COLUMNS)).not.toContain("userId");
  });
});

describe("投递错误文本出站收敛（webhook_deliveries.error）", () => {
  it("SSRF 拦截只留固定文案，不外泄解析到的内网地址", () => {
    const err = new Error("SSRF guard: internal-svc.example resolves to a forbidden address (10.0.0.5)");
    expect(sanitizeDeliveryError(err)).toBe("delivery blocked by egress policy (SSRF guard)");
    expect(sanitizeDeliveryError(err)).not.toContain("10.0.0.5");
    expect(isPermanentDeliveryError(err)).toBe(true);
  });

  it("非法 URL 属永久性失败（重投必然再失败）—— 含 undici 挂在 cause 上的 ERR_INVALID_URL", () => {
    expect(isPermanentDeliveryError(new Error("ERR_INVALID_URL: Invalid URL"))).toBe(true);
    const undici = Object.assign(new TypeError("Failed to parse URL from bad:url"), {
      cause: Object.assign(new Error("Invalid URL"), { code: "ERR_INVALID_URL" }),
    });
    expect(isPermanentDeliveryError(undici)).toBe(true);
    expect(sanitizeDeliveryError(undici)).toBe("delivery blocked by egress policy (SSRF guard)");
  });

  it("普通投递错误保留原文（单行化 + 截断），且必须重试", () => {
    const noisy = new Error("delivery HTTP 500\n<html>" + "x".repeat(600) + "</html>");
    const out = sanitizeDeliveryError(noisy);
    expect(out.length).toBeLessThanOrEqual(500);
    expect(out).not.toContain("\n");
    expect(isPermanentDeliveryError(noisy)).toBe(false);
  });

  it("自动停用阈值 > 单次投递的总尝试数（一轮重试不会误停用端点）", () => {
    // 一条投递最多产生 DELIVERY_RETRY_LIMIT + 1 次失败尝试，必须小于停用阈值，
    // 否则"偶发一次网络抖动"就会直接杀掉端点
    expect(AUTO_DISABLE_AFTER_CONSECUTIVE_FAILURES).toBeGreaterThan(DELIVERY_RETRY_LIMIT + 1);
  });
});
