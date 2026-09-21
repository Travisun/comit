// @vitest-environment happy-dom
/**
 * 被测模块：src/lib/realtime/sse-session.ts（纯判定部分）与
 * src/lib/client/comment-anchor.ts（选择器转义）。
 */
import { describe, expect, it } from "vitest";
import { sessionStillValid } from "./sse-session";
import { commentAnchorSelector, cssAttrValue, findCommentEl } from "@/lib/client/comment-anchor";

describe("sessionStillValid · SSE 会话复核纯判定", () => {
  const ok = { sessionAlive: true, emailVerified: true, notBanned: true };
  it("三条件全真 → 保留连接", () => {
    expect(sessionStillValid(ok)).toBe(true);
  });
  it("任一失效 → 终止：登出（会话行消失）/ 邮箱回退未验证 / 被封禁", () => {
    expect(sessionStillValid({ ...ok, sessionAlive: false })).toBe(false);
    expect(sessionStillValid({ ...ok, emailVerified: false })).toBe(false);
    expect(sessionStillValid({ ...ok, notBanned: false })).toBe(false);
  });
});

describe("comment-anchor · 抗 DOM-clobbering 选择器", () => {
  it("attribute selector 钉死 data-comment-id（不依赖全局 id）", () => {
    expect(commentAnchorSelector("abc-123")).toBe('[data-comment-id="abc-123"]');
  });
  it("引号/反斜杠转义，杜绝选择器注入；非法选择器安全兜底为未命中", () => {
    expect(cssAttrValue('a"b\\c')).toBe('a\\"b\\\\c');
    const evil = `x"], [data-comment-id="y`;
    // 转义后引号全部带反斜杠，不可能闭合出第二个属性条件
    expect(commentAnchorSelector(evil)).toBe('[data-comment-id="x\\"], [data-comment-id=\\"y"]');
    // findCommentEl 对严格解析器（happy-dom）的 DOMException 兜底为 null，不抛
    expect(findCommentEl(evil)).toBeNull();
  });
});
