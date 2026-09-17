import { describe, expect, it } from "vitest";
import { optionalUuid, pagination } from "@/app/api/admin/_shared";

/**
 * admin 查询参数防御回归：浮点 limit/offset 直传 drizzle 会打穿成 PG
 * bigint 解析错误 500；垃圾 UUID 查询参数同理（22P02 → 500）。
 */
const url = (qs: string) => new URL(`https://x.test/api/admin/list?${qs}`);

describe("pagination", () => {
  it("浮点数被取整（12.5 → 12，不打穿 PG bigint）", () => {
    expect(pagination(url("limit=12.5&offset=3.7"))).toEqual({ limit: 12, offset: 3 });
  });

  it("非法/缺失值回默认", () => {
    expect(pagination(url("limit=abc"))).toEqual({ limit: 25, offset: 0 });
    expect(pagination(url(""))).toEqual({ limit: 25, offset: 0 });
    expect(pagination(url("limit=NaN"))).toEqual({ limit: 25, offset: 0 });
  });

  it("越界钳制与 Infinity", () => {
    expect(pagination(url("limit=99999"))).toEqual({ limit: 100, offset: 0 });
    expect(pagination(url("limit=-5&offset=-10"))).toEqual({ limit: 1, offset: 0 });
    expect(pagination(url("limit=Infinity&offset=Infinity")).limit).toBe(100);
  });

  it("覆盖默认与上限（invites/keywords 200 上限）", () => {
    expect(pagination(url("limit=500"), { defaultLimit: 100, maxLimit: 200 }).limit).toBe(200);
    expect(pagination(url(""), { defaultLimit: 50 }).limit).toBe(50);
  });
});

describe("optionalUuid", () => {
  const UUID = "123e4567-e89b-12d3-a456-426614174000";

  it("空值放行（表示不过滤）", () => {
    expect(optionalUuid(url(""), "adminId")).toBeNull();
    expect(optionalUuid(url("adminId="), "adminId")).toBeNull();
  });

  it("合法 UUID 原样返回", () => {
    expect(optionalUuid(url(`adminId=${UUID}`), "adminId")).toBe(UUID);
  });

  it("垃圾值抛 400（而非打穿成 PG 500）", () => {
    try {
      optionalUuid(url("adminId=<script>"), "adminId");
      expect.unreachable("should throw");
    } catch (err) {
      expect((err as { status?: number }).status).toBe(400);
    }
  });
});
