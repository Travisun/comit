/**
 * Next.js server bootstrap — runs once per server process:
 *  1. boot plugins (register channels/tools/widgets/listeners)
 *  2. start pg-boss queue workers
 *  3. recover stale webhook deliveries (best-effort, 不阻塞启动)
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { bootPlugins } = await import("@/core/plugins/registry");
    await bootPlugins();
    const { startWorkers } = await import("@/core/workers");
    await startWorkers();
    const { recoverStaleDeliveries } = await import("@/core/workers");
    // 崩溃恢复：遗留 pending 投递标记失败；失败仅告警，不影响启动
    await recoverStaleDeliveries().catch((err) => {
      console.warn("[instrumentation] recoverStaleDeliveries failed (non-fatal):", err);
    });
  } catch (err) {
    console.error("[instrumentation] bootstrap failed:", err);
  }
}
