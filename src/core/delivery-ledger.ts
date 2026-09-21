import "server-only";
import { randomUUID } from "crypto";
import { db } from "@/db";
import { notificationDeliveries } from "@/db/schema";

/**
 * 队列任务的投递幂等台账（对照 schema 里 notification_deliveries 的说明）。
 *
 * 用法：入队方 `newDeliveryKey()` 生成一个键并随 payload 一起持久化（重投时拿到的
 * 是同一个键），处理器执行副作用前 `claimDelivery(key)` 原子认领。
 */

export function newDeliveryKey(): string {
  return randomUUID();
}

/** true = 首次认领，本次执行应当做副作用；false = 这是 at-least-once 重投。 */
export async function claimDelivery(key: string): Promise<boolean> {
  const rows = await db
    .insert(notificationDeliveries)
    .values({ dedupeKey: key })
    .onConflictDoNothing()
    .returning({ dedupeKey: notificationDeliveries.dedupeKey });
  return rows.length > 0;
}
