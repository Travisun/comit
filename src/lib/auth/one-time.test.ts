// 被测模块：src/lib/auth/one-time.ts（一次性键三级存储：Redis→PG→内存）。
// 依赖 mock：@/lib/rate-limit/redis（驱动原语 + 可用性开关）、@/db（可控 PG 层）。
// 关键语义：签发写穿可达层级；消费任一层原子命中即成功；全部未命中 ⇒ 重放；
// 层级故障不抛出、继续向下一级判定。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { consumeOneTimeKey, issueOneTimeKey } from "./one-time";

const redis = vi.hoisted(() => ({
  configured: true,
  setex: vi.fn(async (..._args: unknown[]) => undefined),
  getdel: vi.fn(async (..._args: unknown[]) => true),
  del: vi.fn(async (..._args: unknown[]) => undefined),
}));

vi.mock("@/lib/rate-limit/redis", () => ({
  isRedisConfigured: () => redis.configured,
  redisSetex: redis.setex,
  redisGetdel: redis.getdel,
  redisDel: redis.del,
}));

/**
 * PG 层 mock：
 *  - insert().values().onConflictDoNothing() ⇒ 记一次签发；
 *  - delete().where().returning() ⇒ 按 pgRows 队列返回消费结果；
 *  - pgFail=true 时全部 reject（模拟 PG 故障，验证降级内存）。
 */
const pg = vi.hoisted(() => ({
  fail: false,
  rows: [] as Array<Array<{ key: string }>>,
  inserts: [] as string[],
}));

vi.mock("@/db", () => {
  const chain = (behavior: () => Promise<unknown>) => {
    const self: unknown = new Proxy(function () {}, {
      apply: () => self,
      get: (_t, prop) => {
        if (prop === "then") {
          return (res: (v: unknown) => void, rej?: (e: unknown) => void) =>
            behavior().then(res, rej);
        }
        return self;
      },
    });
    return self;
  };
  return {
    db: {
      insert: () =>
        chain(async () => {
          pg.inserts.push("insert");
          if (pg.fail) throw new Error("pg down");
          return [];
        }),
      delete: () =>
        chain(async () => {
          if (pg.fail) throw new Error("pg down");
          return pg.rows.shift() ?? [];
        }),
    },
  };
});

let n = 0;
const nextKey = () => `mb:otc:test:key-${n++}`;

beforeEach(() => {
  redis.configured = true;
  redis.setex.mockClear();
  redis.getdel.mockClear();
  redis.del.mockClear();
  redis.getdel.mockImplementation(async () => true);
  pg.fail = false;
  pg.rows = [];
  pg.inserts = [];
});

describe("issueOneTimeKey", () => {
  it("写穿：Redis 配置时 SETEX + PG insert + 内存层", async () => {
    const key = nextKey();
    await issueOneTimeKey(key, 300);
    expect(redis.setex).toHaveBeenCalledWith(key, 300, "1");
    expect(pg.inserts).toHaveLength(1);
  });

  it("Redis 未配置时不触碰 Redis，仍写 PG + 内存", async () => {
    redis.configured = false;
    await issueOneTimeKey(nextKey(), 60);
    expect(redis.setex).not.toHaveBeenCalled();
    expect(pg.inserts).toHaveLength(1);
  });

  it("远端层级故障不抛出（签发继续，内存层兜底）", async () => {
    redis.setex.mockRejectedValueOnce(new Error("redis down"));
    pg.fail = true;
    await expect(issueOneTimeKey(nextKey(), 60)).resolves.toBeUndefined();
  });
});

describe("consumeOneTimeKey", () => {
  it("Redis GETDEL 命中 ⇒ 首次消费成功，并清理 PG/内存残留", async () => {
    const key = nextKey();
    await issueOneTimeKey(key, 300);
    redis.getdel.mockResolvedValueOnce(true);
    await expect(consumeOneTimeKey(key)).resolves.toBe(true);
    expect(redis.getdel).toHaveBeenCalledWith(key);
    // 二次消费：Redis 未命中且各层已清 ⇒ 重放
    redis.getdel.mockResolvedValueOnce(false);
    pg.rows = [[]];
    await expect(consumeOneTimeKey(key)).resolves.toBe(false);
  });

  it("Redis 命中后即使低层残留也不能再次消费（内存已在首次消费时清除）", async () => {
    const key = nextKey();
    await issueOneTimeKey(key, 300);
    redis.getdel.mockResolvedValueOnce(true);
    expect(await consumeOneTimeKey(key)).toBe(true);
    // 模拟低层未清理成功的情形：PG 无行、内存已删 ⇒ 判定重放
    redis.getdel.mockResolvedValueOnce(false);
    pg.rows = [[]];
    expect(await consumeOneTimeKey(key)).toBe(false);
  });

  it("跨层级签发兼容：签发时 Redis 故障（键在 PG），恢复后 Redis 未命中 → PG 命中仍有效", async () => {
    redis.setex.mockRejectedValueOnce(new Error("redis down"));
    const key = nextKey();
    await issueOneTimeKey(key, 300);
    redis.getdel.mockResolvedValueOnce(false); // 恢复后 Redis 无此键
    pg.rows = [[{ key }]]; // PG 消费命中
    await expect(consumeOneTimeKey(key)).resolves.toBe(true);
  });

  it("Redis 故障降级 PG：DELETE RETURNING 有行 ⇒ 有效", async () => {
    redis.getdel.mockRejectedValueOnce(new Error("redis down"));
    pg.rows = [[{ key: "k" }]];
    await expect(consumeOneTimeKey("mb:otc:test:degrade")).resolves.toBe(true);
  });

  it("Redis 与 PG 双故障降级内存：签发过 ⇒ 首次 true、重放 false", async () => {
    const key = nextKey();
    redis.getdel.mockRejectedValue(new Error("down"));
    pg.fail = true;
    await issueOneTimeKey(key, 300); // setex/pgPut 失败均被吞
    expect(await consumeOneTimeKey(key)).toBe(true);
    expect(await consumeOneTimeKey(key)).toBe(false);
  });

  it("从未签发的键 ⇒ 所有层级未命中 ⇒ false（重放/伪造）", async () => {
    redis.getdel.mockResolvedValue(false);
    pg.rows = [[]];
    await expect(consumeOneTimeKey("mb:otc:test:never-issued")).resolves.toBe(false);
  });

  it("已过期的键不可消费（内存层 TTL 判定）", async () => {
    const key = nextKey();
    redis.configured = false;
    pg.fail = true; // 只走内存层
    await issueOneTimeKey(key, -5); // 已过期
    await expect(consumeOneTimeKey(key)).resolves.toBe(false);
  });
});
