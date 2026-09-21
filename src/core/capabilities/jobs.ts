import { queue } from "@/core/queue";
import { claimDelivery, newDeliveryKey } from "@/core/delivery-ledger";
import type { NotificationMessage } from "@/core/plugins/types";

/**
 * 任务与异步通知能力（Laravel Jobs / ShouldQueue 对应物）：
 *  - 扩展任务：`jobs.dispatch(task, payload)` 入队异步执行，
 *    `jobs.work(task, handler)` 注册处理器（多进程安全）；
 *  - 队列化事件：`emitQueued(name, payload)` 把事件投递到队列，
 *    监听器在 worker 进程异步消费（ShouldQueue 语义）；
 *  - 通知双通道：`notifications.send` 同步投递 / `sendAsync` 入队投递。
 */

/* ------------------------------ 扩展任务 --------------------------------- */

type ExtJobHandler = (payload: Record<string, unknown>) => Promise<void> | void;

const g = globalThis as unknown as { __mbExtJobs?: Map<string, ExtJobHandler> };
const handlers: Map<string, ExtJobHandler> = (g.__mbExtJobs ??= new Map());

export function createJobsCapability(extensionId: string) {
  return {
    /** 入队异步任务（支持 pg-boss 延迟/重试选项） */
    dispatch(
      task: string,
      payload: Record<string, unknown> = {},
      opts?: { startAfterSeconds?: number; retryLimit?: number; retryDelay?: number },
    ): Promise<string | null> {
      return queue.send(
        "ext.job",
        { extensionId, task, payloadJson: JSON.stringify(payload) },
        opts,
      );
    },
    /** 注册任务处理器（幂等） */
    work(task: string, handler: ExtJobHandler): void {
      handlers.set(`${extensionId}.${task}`, handler);
    },
  };
}

/* ---------------------------- 队列化事件 --------------------------------- */

export async function dispatchQueuedEvent(
  name: string,
  payloadJson: string,
  deliveryKey?: string,
): Promise<void> {
  // 与 notify.dispatch 同一闸口：一个队列化事件的重投会把所有监听器的副作用
  // （含再次入队的通知与 webhook 投递）整体再做一遍，认领失败即整次跳过。
  if (deliveryKey && !(await claimDelivery(deliveryKey))) {
    console.info(`[event] duplicate dispatch skipped (name=${name}, key=${deliveryKey})`);
    return;
  }
  const { bus } = await import("@/core/events");
  await bus.emit(name as never, JSON.parse(payloadJson) as never);
}

export async function runExtJob(data: {
  extensionId: string;
  task: string;
  payloadJson: string;
}): Promise<void> {
  const handler = handlers.get(`${data.extensionId}.${data.task}`);
  if (!handler) {
    console.warn(`[ext.job] no handler for ${data.extensionId}.${data.task}`);
    return;
  }
  await handler(JSON.parse(data.payloadJson) as Record<string, unknown>);
}

/* ---------------------------- 通知分发 ----------------------------------- */

type NotifyDispatcher = (userId: string, message: NotificationMessage) => Promise<void>;

let dispatcher: NotifyDispatcher | null = null;

/** 通知扩展启动时登记同步分发实现（渠道扇出）。 */
export function setNotificationDispatcher(fn: NotifyDispatcher): void {
  dispatcher = fn;
}

/** 同步通知 — 当前进程直接走渠道扇出。 */
export async function notifySync(userId: string, message: NotificationMessage): Promise<void> {
  if (!dispatcher) throw new Error("通知分发器未就绪 / Notification dispatcher not ready");
  await dispatcher(userId, message);
}

/** 异步通知 — 入队（event/通知高峰时避免阻塞请求路径）。 */
export async function notifyAsync(userId: string, message: NotificationMessage): Promise<void> {
  await queue.send("notify.dispatch", {
    userId,
    messageJson: JSON.stringify(message),
    // 入队即定键：键随 payload 落库，pg-boss 重投拿到的是同一个键 → 处理器可认领去重
    deliveryKey: newDeliveryKey(),
  });
}

export async function runNotifyDispatch(data: {
  userId: string;
  messageJson: string;
  deliveryKey?: string;
}): Promise<void> {
  if (!dispatcher) throw new Error("通知分发器未就绪 / Notification dispatcher not ready");
  // 认领放在分发之前：一次分发 = 站内信 + 邮件等多渠道扇出，重投若不做闸口会把
  // 整串副作用再做一遍（用户收到重复站内信与重复邮件）。
  const key = data.deliveryKey;
  if (key) {
    if (!(await claimDelivery(key))) {
      console.info(`[notify] duplicate delivery skipped (key=${key})`);
      return;
    }
  }
  await dispatcher(data.userId, JSON.parse(data.messageJson) as NotificationMessage);
}
