// 被测模块：src/extensions/webhooks/server.ts 的签名/验签契约（纯计算，绝不触网）。
// mock：@/db（切断 pg Pool，模块加载即建连池但不连库；测试不触任何查询）、
// @/core/queue（不加载 pg-boss 真实模块）。
import { describe, expect, it, vi } from "vitest";
import {
  buildSignatureHeader,
  EVENT_HEADER,
  parseSignatureHeader,
  safeSignatureEqual,
  SIGNATURE_HEADER,
  SIGNATURE_TOLERANCE_SECONDS,
  TIMESTAMP_HEADER,
  signPayload,
  verifyWebhookSignature,
} from "@/extensions/webhooks/server";
import { createHmac } from "crypto";

vi.mock("@/core/queue", () => ({ queue: { send: vi.fn() } }));
vi.mock("@/db", () => ({ db: {} }));

const SECRET = "whsec_test_test_test_test_test_00";
const NOW = 1_800_000_000;
/** 与投递侧完全一致的 body 形态：{event, data, deliveryId} 序列化后的原始字节 */
const BODY = JSON.stringify({ event: "post:published", data: { postId: "p1", title: "中文标题" }, deliveryId: "d1" });

describe("signPayload · 签名串构成", () => {
  it("等于 HMAC-SHA256(`<timestamp>.<body>`)", () => {
    const expected = createHmac("sha256", SECRET).update(`${String(NOW)}.${BODY}`).digest("hex");
    expect(signPayload(SECRET, BODY, String(NOW))).toBe(expected);
  });

  it("时间戳参与签名（否则整条签名可无限期重放）", () => {
    expect(signPayload(SECRET, BODY, String(NOW))).not.toBe(signPayload(SECRET, BODY, String(NOW + 1)));
  });

  it("覆盖原始 body 字节：键序/空白/转义变化即换签名（禁止重序列化后比对）", () => {
    const a = '{"x":1,"y":2}';
    const b = '{"y":2,"x":1}';
    expect(signPayload(SECRET, a, String(NOW))).not.toBe(signPayload(SECRET, b, String(NOW)));
    expect(signPayload(SECRET, a, String(NOW))).not.toBe(signPayload(SECRET, '{"x": 1,"y":2}', String(NOW)));
    // 同一份字节重算稳定（接收方按收到的字节重算即可对上）
    expect(signPayload(SECRET, a, String(NOW))).toBe(signPayload(SECRET, a, String(NOW)));
  });

  it("换密钥即换签名", () => {
    expect(signPayload("whsec_other", BODY, String(NOW))).not.toBe(signPayload(SECRET, BODY, String(NOW)));
  });

  it("输出 64 位小写 hex", () => {
    expect(signPayload(SECRET, BODY, String(NOW))).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("签名头 build / parse", () => {
  it("round-trip：t= 与 v1= 都能取回", () => {
    const sig = signPayload(SECRET, BODY, String(NOW));
    expect(parseSignatureHeader(buildSignatureHeader(String(NOW), sig))).toEqual({
      timestamp: String(NOW),
      signature: sig,
    });
  });

  it("顺序无关、多余键忽略、重复键取首个", () => {
    expect(parseSignatureHeader(`v1=abc,t=123,extra=x`)).toEqual({ timestamp: "123", signature: "abc" });
    expect(parseSignatureHeader("t=1,t=2,v1=a,v1=b")).toEqual({ timestamp: "1", signature: "a" });
  });

  it("缺失/畸形头返回 null 而不是抛错", () => {
    expect(parseSignatureHeader(undefined)).toEqual({ timestamp: null, signature: null });
    expect(parseSignatureHeader("garbage")).toEqual({ timestamp: null, signature: null });
    expect(parseSignatureHeader("t=123")).toEqual({ timestamp: "123", signature: null });
  });
});

describe("safeSignatureEqual · 恒定时间比较", () => {
  const sig = signPayload(SECRET, BODY, String(NOW));

  it("相等为 true", () => {
    expect(safeSignatureEqual(sig, sig)).toBe(true);
  });

  it("不等 / 长度不等 / 非 hex 均为 false（且不吃 timingSafeEqual 的抛错）", () => {
    expect(safeSignatureEqual(sig, "f".repeat(64))).toBe(false);
    expect(safeSignatureEqual(sig, "abc")).toBe(false);
    expect(safeSignatureEqual(sig, "")).toBe(false);
    expect(safeSignatureEqual(sig, "z".repeat(64))).toBe(false); // 长度对但非 hex
    expect(() => safeSignatureEqual(sig, sig.toUpperCase())).not.toThrow();
    expect(safeSignatureEqual(sig, sig.toUpperCase())).toBe(false); // 契约是小写 hex
  });
});

describe("verifyWebhookSignature · 接收方参考实现", () => {
  const header = () => buildSignatureHeader(String(NOW), signPayload(SECRET, BODY, String(NOW)));

  it("合法签名通过", () => {
    expect(verifyWebhookSignature({ secret: SECRET, body: BODY, signatureHeader: header(), nowSeconds: NOW })).toBe(true);
  });

  it("body 被改动 1 字节即拒绝", () => {
    expect(
      verifyWebhookSignature({ secret: SECRET, body: BODY.replace("p1", "p2"), signatureHeader: header(), nowSeconds: NOW }),
    ).toBe(false);
  });

  it("密钥不符即拒绝", () => {
    expect(
      verifyWebhookSignature({ secret: "whsec_other", body: BODY, signatureHeader: header(), nowSeconds: NOW }),
    ).toBe(false);
  });

  it("容忍窗内（±300s）通过，窗外拒绝 —— 两端各测一次", () => {
    const h = header();
    expect(verifyWebhookSignature({ secret: SECRET, body: BODY, signatureHeader: h, nowSeconds: NOW + SIGNATURE_TOLERANCE_SECONDS })).toBe(true);
    expect(verifyWebhookSignature({ secret: SECRET, body: BODY, signatureHeader: h, nowSeconds: NOW - SIGNATURE_TOLERANCE_SECONDS })).toBe(true);
    expect(verifyWebhookSignature({ secret: SECRET, body: BODY, signatureHeader: h, nowSeconds: NOW + SIGNATURE_TOLERANCE_SECONDS + 1 })).toBe(false);
    expect(verifyWebhookSignature({ secret: SECRET, body: BODY, signatureHeader: h, nowSeconds: NOW - SIGNATURE_TOLERANCE_SECONDS - 1 })).toBe(false);
  });

  it("旧签名换时间戳重放不成立（时间戳被签名覆盖）", () => {
    const oldHeader = header();
    const forged = oldHeader.replace(`t=${String(NOW)}`, `t=${String(NOW + 400)}`);
    expect(verifyWebhookSignature({ secret: SECRET, body: BODY, signatureHeader: forged, nowSeconds: NOW + 400 })).toBe(false);
  });

  it("只发 X-Comit-Timestamp（无 t=）时回落时间戳头", () => {
    const sig = signPayload(SECRET, BODY, String(NOW));
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        body: BODY,
        signatureHeader: `v1=${sig}`,
        timestampHeader: String(NOW),
        nowSeconds: NOW,
      }),
    ).toBe(true);
    // 时间戳头与签名不一致 → 拒（改头救不了重放）
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        body: BODY,
        signatureHeader: `v1=${sig}`,
        timestampHeader: String(NOW + 600),
        nowSeconds: NOW + 600,
      }),
    ).toBe(false);
  });

  it("畸形输入一律 false，不抛错", () => {
    const bad = ["", "t=abc,v1=def", "t=1e10,v1=def", `t=${String(NOW)}`, `t=-5,v1=${"a".repeat(64)}`, "t=99999999999999999999999,v1=" + "a".repeat(64)];
    for (const signatureHeader of bad) {
      expect(verifyWebhookSignature({ secret: SECRET, body: BODY, signatureHeader, nowSeconds: NOW }), signatureHeader).toBe(false);
    }
    expect(verifyWebhookSignature({ secret: SECRET, body: BODY, signatureHeader: null, nowSeconds: NOW })).toBe(false);
  });
});

describe("投递侧接线常量（worker 发送的头必须与此一致）", () => {
  it("签名头/时间戳头/事件头名称固定 —— 改名会让全部接收方验签失效，属破坏性变更", () => {
    expect([SIGNATURE_HEADER, TIMESTAMP_HEADER, EVENT_HEADER]).toEqual([
      "X-Comit-Signature",
      "X-Comit-Timestamp",
      "X-Comit-Event",
    ]);
  });
});
