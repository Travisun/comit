/**
 * 被测模块：src/lib/realtime/sse-counter.ts —— SSE 跨进程连接槽位计数。
 * 纯逻辑单测：键构造、内存驱动（注入假时钟）、Redis/内存降级组合（注入
 * fake eval），不触碰真实 ioredis。
 */
import { describe, expect, it, vi } from "vitest";
import {
  createMemorySlots,
  createSseSlotManager,
  SLOT_TTL_MS,
  sseCounterKey,
  type SseSlots,
} from "./sse-counter";

describe("sseCounterKey · 键构造", () => {
  it("key 含 userId，前缀与限流键（mb:rl:）隔离", () => {
    expect(sseCounterKey("u1")).toBe("mb:sse:conns:u1");
    expect(sseCounterKey("u1")).not.toMatch(/^mb:rl:/);
  });
});

describe("createMemorySlots · 进程内降级计数（Redis 挂掉时保持旧行为）", () => {
  it("acquire 递增 / release 递减、归零删桶", async () => {
    const slots = createMemorySlots(new Map(), () => 1_000);
    expect(await slots.acquire("u1")).toBe(1);
    expect(await slots.acquire("u1")).toBe(2);
    expect(await slots.release("u1")).toBe(1);
    expect(await slots.release("u1")).toBe(0);
    expect(await slots.release("u1")).toBe(0); // 迟到/重复释放钳 0，不产生负数
    expect(await slots.acquire("u1")).toBe(1); // 归零后重新从 1 起
  });

  it("不同用户互不影响", async () => {
    const slots = createMemorySlots(new Map(), () => 1_000);
    await slots.acquire("a");
    await slots.acquire("a");
    expect(await slots.acquire("b")).toBe(1);
  });

  it("TTL 过期后残槽自动清零（模拟 worker 崩溃未 release）", async () => {
    let now = 1_000;
    const slots = createMemorySlots(new Map(), () => now);
    await slots.acquire("u1");
    await slots.acquire("u1");
    now += SLOT_TTL_MS + 1; // 超过 TTL 且无心跳续期
    expect(await slots.renew("u1")).toBe(1); // renew 自愈：过期桶重置为 1
    expect(await slots.acquire("u1")).toBe(2);
  });

  it("renew 刷新过期时刻，活连接不被 TTL 误清", async () => {
    let now = 1_000;
    const slots = createMemorySlots(new Map(), () => now);
    await slots.acquire("u1");
    now += SLOT_TTL_MS - 1_000;
    expect(await slots.renew("u1")).toBe(1);
    now += 1_000; // 距上次 renew 仅 1s，未过期
    expect(await slots.acquire("u1")).toBe(2);
  });
});

describe("createSseSlotManager · Redis 优先 + 失败降级内存", () => {
  const fakeRedis = () => {
    const store = new Map<string, number>();
    const evalOp = vi.fn(async (_script: string, key: string, _ttl: number) => {
      const n = (store.get(key) ?? 0) + 1; // 简化：只测调用路径与键
      store.set(key, n);
      return n;
    });
    return { evalOp, store };
  };

  it("Redis 可用：三操作全部打到 Redis，键含 userId", async () => {
    const { evalOp } = fakeRedis();
    const mem: SseSlots = {
      acquire: vi.fn(async () => 99),
      release: vi.fn(async () => 99),
      renew: vi.fn(async () => 99),
    };
    const mgr = createSseSlotManager(mem, () => true, evalOp);
    expect(await mgr.acquire("u1")).toBe(1);
    expect(await mgr.renew("u1")).toBe(2);
    expect(await mgr.lastDriver()).toBe("redis");
    expect(evalOp).toHaveBeenLastCalledWith(expect.any(String), "mb:sse:conns:u1", SLOT_TTL_MS);
    expect(mem.acquire).not.toHaveBeenCalled();
  });

  it("Redis 抛错：本次操作降级内存层，不 throw（连接不被计数故障掐断）", async () => {
    const evalOp = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const mgr = createSseSlotManager(createMemorySlots(new Map(), () => 1_000), () => true, evalOp);
    expect(await mgr.acquire("u1")).toBe(1); // 内存计数顶上
    expect(await mgr.acquire("u1")).toBe(2);
    expect(await mgr.lastDriver()).toBe("memory");
  });

  it("Redis 未配置：完全走内存驱动（旧 per-worker 行为）", async () => {
    const evalOp = vi.fn(async () => 1);
    const mgr = createSseSlotManager(createMemorySlots(new Map(), () => 1_000), () => false, evalOp);
    await mgr.acquire("u1");
    await mgr.release("u1");
    // 归零后 renew（活连接心跳自愈语义）重置占 1 槽，再 acquire 累计为 2
    expect(await mgr.renew("u1")).toBe(1);
    expect(await mgr.acquire("u1")).toBe(2);
    expect(evalOp).not.toHaveBeenCalled();
  });
});
