/**
 * Next.js server bootstrap — runs once per server process:
 *  1. boot plugins (register channels/tools/widgets/listeners)
 *  2. start pg-boss queue workers
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { bootPlugins } = await import("@/core/plugins/registry");
    await bootPlugins();
    const { startWorkers } = await import("@/core/workers");
    await startWorkers();
  } catch (err) {
    console.error("[instrumentation] bootstrap failed:", err);
  }
}
