import type { Hookable } from "hookable";
import { queue } from "@/core/queue";

/**
 * 定时任务（Laravel scheduler 对应物）— 扩展声明 cron 任务，
 * 由 pg-boss 原生 schedule 驱动（数据库持久化、多进程不重复触发）。
 *
 * 扩展内：`ctx.cron.register({ name: "ext.<id>.<task>", cron: "0 3 * * *" }, handler)`
 * name 需全局唯一（约定 ext 前缀）；cron 为 5 段标准表达式。
 */

export interface CronTaskDef {
  /** 全局唯一队列名，约定 `ext.<extensionId>.<task>` */
  name: string;
  /** 5 段 cron 表达式（pg-boss 原生支持） */
  cron: string;
}

type CronHandler = () => Promise<void> | void;

const g = globalThis as unknown as { __mbCronTasks?: Map<string, { def: CronTaskDef; handler: CronHandler }> };
const tasks: Map<string, { def: CronTaskDef; handler: CronHandler }> = (g.__mbCronTasks ??= new Map());

export function registerCronTask(def: CronTaskDef, handler: CronHandler): void {
  if (tasks.has(def.name)) return; // 幂等（boot 可能因 HMR 重放）
  tasks.set(def.name, { def, handler });
}

/** instrumentation 阶段调用（bootPlugins 之后）— 把全部 cron 落到 pg-boss。 */
export async function startScheduledTasks(): Promise<void> {
  for (const [name, { def, handler }] of tasks) {
    try {
      await queue.cron(def, handler);
      console.log(`[cron] scheduled: ${name} (${def.cron})`);
    } catch (err) {
      console.error(`[cron] failed to schedule ${name}:`, err);
    }
  }
}

/** PluginContext.cron 的实现载体 */
export function createCronCapability(_hooks: Hookable) {
  return {
    register: (def: CronTaskDef, handler: CronHandler) => registerCronTask(def, handler),
  };
}
