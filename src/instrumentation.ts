/**
 * Next.js server bootstrap — runs once per server process:
 *  1. boot plugins (register channels/tools/widgets/listeners)
 *  2. start pg-boss queue workers
 *  3. recover stale webhook deliveries (best-effort, 不阻塞启动)
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    // 部署形态启动自检：real-ip 的限流键/审计归因依赖 TRUST_PROXY 与真实部署
    // 一致 —— 声称有反代而实际直连时，X-Real-IP 可被伪造使所有限流桶失效。
    // 生产环境未显式设置或值非法时打警告（不阻断启动，保持向后兼容）。
    if (process.env.NODE_ENV === "production") {
      const raw = process.env.TRUST_PROXY;
      if (raw === undefined) {
        console.warn(
          "[boot] TRUST_PROXY 未显式设置，默认按 nginx 反代信任 X-Real-IP/X-Forwarded-For。" +
            "直连部署（无反代）请设 TRUST_PROXY=direct，否则限流键可被伪造头绕过",
        );
      } else if (!["nginx", "cloudflare", "direct"].includes(raw.toLowerCase())) {
        console.warn(
          `[boot] TRUST_PROXY="${raw}" 不是合法值（nginx|cloudflare|direct），已回退 nginx`,
        );
      }
    }
    const { bootPlugins } = await import("@/extensions/_boot/server");
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
