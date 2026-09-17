import { describe, expect, it } from "vitest";
import { routeParam } from "@/lib/route-params";

/**
 * 动态路由参数归一回归：Next params 已解码一次，历史二次 decodeURIComponent
 * 对含 % 序列的 slug 抛 URIError → 整页 500。
 */
describe("routeParam", () => {
  it("普通已解码参数原样返回", () => {
    expect(routeParam("hello-world")).toBe("hello-world");
    expect(routeParam("前端话题")).toBe("前端话题");
  });

  it("含 % 序列但非法（100%-guide）不抛 URIError，回落原值", () => {
    expect(routeParam("100%-guide")).toBe("100%-guide");
    expect(routeParam("%zz")).toBe("%zz");
    expect(routeParam("%")).toBe("%");
  });

  it("历史编码入库的 slug 仍能命中（兼容解码）", () => {
    expect(routeParam("%E5%89%8D%E7%AB%AF")).toBe("前端");
  });

  it("已经是解码形态且含 % 的值保持稳定（不产生二次变化）", () => {
    expect(routeParam("a%20b")).toBe("a b"); // 解码成功且不同 → 采用
  });

  it("空串", () => {
    expect(routeParam("")).toBe("");
  });
});
