import { queue } from "@/core/queue";
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

export async function dispatchQueuedEvent(name: string, payloadJson: string): Promise<void> {
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
  await queue.send("notify.dispatch", { userId, messageJson: JSON.stringify(message) });
}

export async function runNotifyDispatch(data: {
  userId: string;
  messageJson: string;
}): Promise<void> {
  if (!dispatcher) throw new Error("通知分发器未就绪 / Notification dispatcher not ready");
  await dispatcher(data.userId, JSON.parse(data.messageJson) as NotificationMessage);
}
